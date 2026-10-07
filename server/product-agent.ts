import type { MemoryStore } from "./memory.ts";
import type { TaskStore } from "./tasks.ts";
import type { ChatStore } from "./chat.ts";
import type { createKnowledgeRetriever } from "./knowledge-retriever.ts";
import type { createAgentRuntime } from "./agent-runtime.ts";
import { createProductAgentTools } from "./product-agent-tools.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { AgentPresentation, ProductAgentResult } from "../src/shared/product-agent.ts";
import { AgentStopped } from "./agent-budget.ts";
import { agentActionToolNames } from "../src/shared/agent-actions.ts";
import { productToolSelection } from "./product-tool-selection.ts";

export function createProductAgent(options: {
  documents?: import("./family-document-store.ts").FamilyDocumentStore;
  concerns?: import("./concern-store.ts").ConcernStore;
  sources?: import("./shared-input-store.ts").SharedInputStore;
  actions?: import("./agent-actions-store.ts").AgentActionsStore;
  summary?:import("./care-summary-store.ts").CareSummaryStore;
  contact?:import("./contact-store.ts").ContactStore;
  growth?: import("./growth-store.ts").GrowthStore;
  runtime: ReturnType<typeof createAgentRuntime>; store: ProductAgentStore;
  memory: MemoryStore; tasks: TaskStore; chat: ChatStore; knowledge: ReturnType<typeof createKnowledgeRetriever>;
}) {
  const activeReplies = new Map<string, AbortController>();
  const replyKey = (userId: string, childId: string, messageId: string) => JSON.stringify([userId, childId, messageId]);
  return {
    async cancelReply(userId: string, childId: string, messageId: string, isCurrentUser: () => Promise<boolean>) {
      if (!await isCurrentUser() || !await options.chat.listForUser(userId, childId)) return false;
      const controller = activeReplies.get(replyKey(userId, childId, messageId));
      if (!controller) return false;
      controller.abort();
      return true;
    },
    async background(input: { userId: string; childId: string; reference: string; context: Record<string, unknown>; authorize: () => Promise<boolean>; signal?: AbortSignal }): Promise<ProductAgentResult | null> {
      if (!await input.authorize()) return null;
      const claim = await options.store.claim(input.userId, input.childId, { kind: "worker", reference: input.reference }, "product-background");
      if (!claim) return null;
      if (!claim.created) return options.store.get(input.userId, input.childId, claim.runId);
      const authorize = async () => await input.authorize() && await options.store.authorize(claim.scope,claim.runId);
      let tools: ReturnType<typeof createProductAgentTools> | undefined;
      const rendered: { value: AgentPresentation | null } = { value: null };
      const result = await options.runtime.run({ scope: claim.scope, runId: claim.runId,
        deadlineMs: Math.max(1, Math.min(90_000, Date.parse(claim.expiresAt) - Date.now())),
        trigger: { kind: "worker", reference: input.reference }, recipeId: "product-background",
        availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"], context: input.context,
        messages: [{ role: "user", text: "這是 Server 核准的背景事件（context.eventType 或事件資料）。按需要讀取家庭共享資料，提供站內說明。若是成長關注，只解釋 Server 已核對的規則、適用性和來源；不創造醫療规则或把未知當未做。不自動改任務或披露私人資料。若是到期任務，按需要用 read_contact_options 及 contact_caregiver 在目前預授權內入列；缺授權只作站內說明。" }],
        tools: run => { tools = createProductAgentTools({ ...options, contact: input.context.eventType === "concern_followup" ? undefined : options.contact, run, authorize, visibility: "family",
          reviewedGrowthPresentation: input.context.eventType === "growth_attention" }); return tools.tools; },
        authorize, signal: input.signal, finalizeOnModelLimit: true, presentationRepair: "present_answer", finalize: async () => { rendered.value = await tools!.presentation();
          if (!rendered.value) throw new AgentStopped("invalid_response"); return rendered.value.text; },
      });
      if(result.status==="stopped" && options.contact && await input.authorize()){
        const recorded=await options.contact.recordedForRun?.(claim.scope.userId,claim.scope.childId,claim.runId);
        for(const reference of recorded??[])if(!result.tools.some(tool=>tool.name==="contact_caregiver"&&tool.reference===reference))result.tools.push({name:"contact_caregiver",callId:"persisted-ledger",status:"succeeded",reference});
      }
      const presentation = result.status === "completed" ? rendered.value : null;
      const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status, stopReason: result.stopReason ?? null,
        text: presentation?.text ?? (result.tools.some(tool=>tool.name==="contact_caregiver"&&tool.status==="succeeded") ? "已記錄獲授權聯絡請求，但未完成文字收尾。請查看聯絡台帳的真實投遞結果；入列不等於送達或完成。" : ""), citations: presentation?.citations ?? [], privateSourceCitations:presentation?.privateSourceCitations ?? [], retrievalMode: presentation?.retrievalMode ?? "not_used",
        tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })), countsKnown: true, counts: result.counts, proposals: [] };
      if (!await input.authorize() || !await options.store.finish(claim.scope, value)) return null;
      return options.store.get(input.userId, input.childId, claim.runId);
    },
    async reply(userId: string, childId: string, messageId: string, isCurrentUser: () => Promise<boolean>, signal?: AbortSignal): Promise<ProductAgentResult | null> {
      const page = await options.chat.listForUser(userId, childId), context = await options.memory.context(userId, childId, "private");
      const index = page?.messages.findIndex(item => item.id === messageId && item.role === "user") ?? -1;
      if (!page || index < 0 || !context || !await isCurrentUser()) return null;
      const operationPolicy = options.actions ? await options.actions.policy(userId, childId) : null;
      const recipeId=options.summary&&/摘要|總結|总结|報告|报告|(?:到診|到诊|覆診|复诊).{0,4}(?:準備|准备|問題|问题)|summary|report/iu.test(page.messages[index].text)?"summary-visit":"product-interactive";
      const claim = await options.store.claim(userId, childId, { kind: "interactive", reference: messageId }, recipeId);
      if (!claim) return null;
      if (!claim.created) return options.store.get(userId, childId, claim.runId);
      const cancellation = new AbortController(), key = replyKey(userId, childId, messageId);
      activeReplies.set(key, cancellation);
      try {
      const authorize = async () => await isCurrentUser() && await options.store.authorize(claim.scope,claim.runId);
      let tools: ReturnType<typeof createProductAgentTools> | undefined;
      const rendered: { value: AgentPresentation | null } = { value: null };
      const result = await options.runtime.run({
        scope: claim.scope, runId: claim.runId, deadlineMs: Math.max(1, Math.min(90_000, Date.parse(claim.expiresAt) - Date.now())), trigger: { kind: "interactive", reference: messageId }, recipeId,
        availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
        context: { currentMessageId: messageId, serverNow: new Date().toISOString(), timeZone: "Asia/Hong_Kong", memoryAvailability: { hasSummary: Boolean(context.summary),
          earlierMessagesNotFullySummarized: context.truncated.messages },
          confirmationPolicy: options.actions ? "ordinary_instructions_with_current_preauthorization_otherwise_explicit_confirmation" : "explicit_selection_only",
          operationPolicy,
          instructionPolicy: options.actions ? "本次清楚的普通交代可按 operationPolicy 使用對應普通操作工具。政策不足或重要健康資料、AI 主動建議、含糊指向、刪除及擴大共享仍用候選或補問。需要孩子資料、原任務或舊版本時先 read_context；每次執行由 Server 重查政策。結果依收據，不把站內安排稱為外發通知。" : null,
          outputPolicy: "present_answer is required; all advice paragraphs require supporting official citation IDs; final text cannot execute actions" },
        // A bounded recent window is distinct from the coverage-tracked summary and confirmed facts.
        messages: page.messages.slice(Math.max(0, index - 5), index + 1).map(item => ({ role: item.role, text: item.text })),
        tools: run => {
          tools = createProductAgentTools({ ...options, ...productToolSelection(page.messages.slice(0,index+1)
            .filter(message=>message.role==="user").slice(-2).map(message=>message.text)), run, authorize });
          return tools.tools;
        }, authorize, signal: signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal, finalizeOnModelLimit: true, presentationRepair: "present_answer",
        finalize: async () => {
          rendered.value = await tools!.presentation();
          if (!rendered.value) throw new AgentStopped("invalid_response");
          return rendered.value.text;
        },
      });
      if(result.status==="stopped" && options.contact && await isCurrentUser()){
        const recorded=await options.contact.recordedForRun?.(claim.scope.userId,claim.scope.childId,claim.runId);
        for(const reference of recorded??[])if(!result.tools.some(tool=>tool.name==="contact_caregiver"&&tool.reference===reference))result.tools.push({name:"contact_caregiver",callId:"persisted-ledger",status:"succeeded",reference});
      }
      const receipts = options.actions && await isCurrentUser()
        ? await options.actions.receipts(userId, childId, claim.runId) ?? [] : [];
      for (const receipt of receipts) if (!result.tools.some(tool => tool.reference === receipt.id))
        result.tools.push({ name: agentActionToolNames[receipt.kind], callId: "persisted-ledger", status: "succeeded", reference: receipt.id });
      const presentation = result.status === "completed" ? rendered.value : null;
      const value: ProductAgentResult = { runId: result.runId, provenance: result.provenance ?? null, status: result.status, stopReason: result.stopReason ?? null,
        text: presentation?.text ?? (receipts.length ? "已有 " + receipts.length + " 項操作保存了 Server 收據，但未完成文字收尾。請查看操作結果，勿重新提交同一操作；已安排不代表已發通知或照護已完成。" : result.tools.some(tool=>["generate_family_document","change_family_document"].includes(tool.name)&&tool.status==="succeeded") ? "文件操作已保存，但未完成文字收尾。請在準備單／成長檔案查看原文件及版本，勿重複建立；文件清單不代表照護任務完成。" : result.tools.some(tool=>tool.name==="contact_caregiver"&&tool.status==="succeeded") ? "已記錄獲授權聯絡請求，但未完成文字收尾。請查看聯絡台帳的真實投遞結果；入列不等於送達或完成。" : ""), citations: presentation?.citations ?? [], privateSourceCitations:presentation?.privateSourceCitations ?? [], retrievalMode: presentation?.retrievalMode ?? "not_used",
        tools: result.tools.map(({ name, status, reference }) => ({ name, status, ...(reference ? { reference } : {}) })),
        countsKnown: true, counts: result.counts, proposals: [] };
      if (!await isCurrentUser()) return null;
      if (!await options.store.finish(claim.scope, value, result.status === "completed" ? tools?.summaryDraft() : undefined)) return null;
      return options.store.get(userId, childId, claim.runId);
      } finally { if (activeReplies.get(key) === cancellation) activeReplies.delete(key); }
    },
  };
}
export type ProductAgent = ReturnType<typeof createProductAgent>;
