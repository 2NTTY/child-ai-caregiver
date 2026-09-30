import type { MemoryStore } from "./memory.ts";
import type { TaskStore } from "./tasks.ts";
import type { ChatStore } from "./chat.ts";
import type { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import type { createAgentRuntime } from "./agent-runtime.ts";
import { createProductAgentTools } from "./product-agent-tools.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { AgentPresentation, ProductAgentResult } from "../src/shared/product-agent.ts";
import { AgentStopped } from "./agent-budget.ts";

export function createProductAgent(options: {
  growth?: import("./growth-store.ts").GrowthStore;
  summary?:import("./care-summary-store.ts").CareSummaryStore;
  runtime: ReturnType<typeof createAgentRuntime>; store: ProductAgentStore;
  memory: MemoryStore; tasks: TaskStore; chat: ChatStore; knowledge: ReturnType<typeof createKnowledgeRetriever>;
}) {
  return {
    async background(input: { userId: string; childId: string; reference: string; context: Record<string, unknown>; authorize: () => Promise<boolean>; signal?: AbortSignal }): Promise<ProductAgentResult | null> {
      if (!await input.authorize()) return null;
      const claim = await options.store.claim(input.userId, input.childId, { kind: "worker", reference: input.reference }, "product-background");
      if (!claim) return null;
      if (!claim.created) return options.store.get(input.userId, input.childId, claim.runId);
      const authorize = async () => await input.authorize() && await options.store.authorize(claim.scope);
      let tools: ReturnType<typeof createProductAgentTools> | undefined;
      const rendered: { value: AgentPresentation | null } = { value: null };
      const result = await options.runtime.run({ scope: claim.scope, runId: claim.runId,
        deadlineMs: Math.max(1, Math.min(90_000, Date.parse(claim.expiresAt) - Date.now())),
        trigger: { kind: "worker", reference: input.reference }, recipeId: "product-background",
        availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"], context: input.context,
        messages: [{ role: "user", text: "這是 Server 核准的背景事件（context.eventType 或事件資料）。按需要讀取家庭共享資料，提供站內說明。若是成長關注，只解釋 Server 已核對的規則、適用性和來源；不創造醫療规则或把未知當未做。不自動改任務、不外發通知或披露私人資料。" }],
        tools: run => { tools = createProductAgentTools({ ...options, run, authorize, visibility: "family",
          reviewedGrowthPresentation: input.context.eventType === "growth_attention" }); return tools.tools; },
        authorize, signal: input.signal, finalize: async () => { rendered.value = await tools!.presentation();
          if (!rendered.value) throw new AgentStopped("invalid_response"); return rendered.value.text; },
      });
      const presentation = result.status === "completed" ? rendered.value : null;
      const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status, stopReason: result.stopReason ?? null,
        text: presentation?.text ?? "", citations: presentation?.citations ?? [], retrievalMode: presentation?.retrievalMode ?? "not_used",
        tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })), countsKnown: true, counts: result.counts, proposals: [] };
      if (!await input.authorize() || !await options.store.finish(claim.scope, value)) return null;
      return options.store.get(input.userId, input.childId, claim.runId);
    },
    async reply(userId: string, childId: string, messageId: string, isCurrentUser: () => Promise<boolean>, signal?: AbortSignal): Promise<ProductAgentResult | null> {
      const page = await options.chat.listForUser(userId, childId), context = await options.memory.context(userId, childId, "private");
      const index = page?.messages.findIndex(item => item.id === messageId && item.role === "user") ?? -1;
      if (!page || index < 0 || !context || !await isCurrentUser()) return null;
      const recipeId=options.summary&&/摘要|總結|总结|報告|报告|(?:到診|到诊|覆診|复诊).{0,4}(?:準備|准备|問題|问题)|summary|report/iu.test(page.messages[index].text)?"summary-visit":"product-interactive";
      const claim = await options.store.claim(userId, childId, { kind: "interactive", reference: messageId }, recipeId);
      if (!claim) return null;
      if (!claim.created) return options.store.get(userId, childId, claim.runId);
      const authorize = async () => await isCurrentUser() && await options.store.authorize(claim.scope);
      let tools: ReturnType<typeof createProductAgentTools> | undefined;
      const rendered: { value: AgentPresentation | null } = { value: null };
      const result = await options.runtime.run({
        scope: claim.scope, runId: claim.runId, deadlineMs: Math.max(1, Math.min(90_000, Date.parse(claim.expiresAt) - Date.now())), trigger: { kind: "interactive", reference: messageId }, recipeId,
        availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
        context: { currentMessageId: messageId, memoryAvailability: { hasSummary: Boolean(context.summary),
          earlierMessagesNotFullySummarized: context.truncated.messages }, confirmationPolicy: "explicit_selection_only",
          outputPolicy: "present_answer is required; all advice paragraphs require supporting official citation IDs; final text cannot execute actions" },
        // A bounded recent window is distinct from the coverage-tracked summary and confirmed facts.
        messages: page.messages.slice(Math.max(0, index - 5), index + 1).map(item => ({ role: item.role, text: item.text })),
        tools: run => {
          tools = createProductAgentTools({ ...options, run, authorize });
          return tools.tools;
        }, authorize, signal,
        finalize: async () => {
          rendered.value = await tools!.presentation();
          if (!rendered.value) throw new AgentStopped("invalid_response");
          return rendered.value.text;
        },
      });
      const presentation = result.status === "completed" ? rendered.value : null;
      const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status, stopReason: result.stopReason ?? null,
        text: presentation?.text ?? "", citations: presentation?.citations ?? [], retrievalMode: presentation?.retrievalMode ?? "not_used",
        tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })),
        countsKnown: true, counts: result.counts, proposals: [] };
      if (!await isCurrentUser()) return null;
      if (!await options.store.finish(claim.scope, value, result.status === "completed" ? tools?.summaryDraft() : undefined)) return null;
      return options.store.get(userId, childId, claim.runId);
    },
  };
}
export type ProductAgent = ReturnType<typeof createProductAgent>;
