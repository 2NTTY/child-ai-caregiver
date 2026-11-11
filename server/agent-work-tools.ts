import { z } from "zod";
import { readAgentWorkSchema, saveAgentWorkSchema, historySearchSchema, historyReadSchema, memoryFactReadSchema, requestAgentConfirmationSchema } from "../src/shared/agent-work.ts";
import { agentProposalSchema, type AgentProposal } from "../src/shared/product-agent.ts";
import { AGENT_WORK_TOOL_DESCRIPTIONS } from "./agent-work-tool-descriptions.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { MemoryStore } from "./memory.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { AgentStopped } from "./agent-budget.ts";
import { FamilyError } from "./family-access.ts";
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { normalizedFactKey } from "./memory-policy.ts";
import type { MemoryFact } from "../src/shared/memory.ts";

/** Bind the confirmation question immediately so pending receipts stay complete without a duplicate tool call. */
export async function prepareProposalConfirmation(
  store: ProductAgentStore,
  run: Pick<AgentRunContext, "scope" | "runId">,
  proposal: AgentProposal,
): Promise<AgentProposal & { confirmationPrepared?: boolean }> {
  if (proposal.status !== "pending" || typeof store.requestConfirmation !== "function") return proposal;
  const confirmation = await store.requestConfirmation(run.scope, run.runId, {
    runId: proposal.runId,
    proposalId: proposal.id,
    expectedVersion: proposal.version,
    workId: null,
  });
  if (!confirmation) throw new AgentStopped("unauthorized");
  return { ...proposal, confirmationPrepared: true };
}

export function createAgentWorkTools(store: ProductAgentStore, memory: MemoryStore, run: AgentRunContext, authorize: () => Promise<boolean>,
  onConfirmedMemoryFacts?: (facts: MemoryFact[]) => void, onPendingMemoryProposal?: () => void): AgentTool[] {
  const { userId, childId } = run.scope;
  const guard = async (fn: () => Promise<unknown>): Promise<AgentToolResult> => {
    try { const value = await fn(); if (value === null) throw new AgentStopped("unauthorized"); return { status: "succeeded", data: { result: value } }; }
    catch (error) {
      if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
      if (error instanceof FamilyError || error instanceof FirestoreDomainError) {
        if (error.code === "fact_key_conflict") {
          return { status: "conflict", data: { code: error.code,
            nextAction: "已有相同鍵（key）的有效確認事實或本輪重複候選。先用 read_memory_facts 查明現有事實 ID 與版本；更正同一事實請用 propose_fact_revision，若是另一獨立事實請改用具體不重複的新 key 後再 propose_fact。" } };
        }
        return { status: error.status === 409 ? "conflict" : error.status >= 500 ? "failed" : "rejected", data: { code: error.code } };
      }
      throw error;
    }
  };
  const make = (name: keyof typeof AGENT_WORK_TOOL_DESCRIPTIONS, parameters: z.ZodObject,
    execute: AgentTool["execute"]): AgentTool => ({ name, description: AGENT_WORK_TOOL_DESCRIPTIONS[name], parameters, authorize, execute });
  const revision = agentProposalSchema.options.find(schema => schema.shape.kind.value === "memory_fact_revise")!;
  const deactivation = agentProposalSchema.options.find(schema => schema.shape.kind.value === "memory_fact_deactivate")!;
  const { kind: _revisionKind, ...revisionShape } = revision.shape;
  const { kind: _deactivationKind, ...deactivationShape } = deactivation.shape;
  return [
    make("read_work", readAgentWorkSchema, async args => {
      const result = await guard(() => store.readWork(userId, childId, readAgentWorkSchema.parse(args)));
      if (result.status === "succeeded"
        && JSON.stringify(result).length > Math.max(0, run.budget.toolResponseCharacters - 512))
        return { status: "rejected", data: { code: "response_limit" } };
      return result;
    }),
    make("read_background_result", z.object({ runId: z.uuid(), offset: z.number().int().min(0).max(1000000),
      limit: z.number().int().min(1).max(4000) }).strict(), args => guard(async () => {
      const input = args as { runId: string; offset: number; limit: number };
      const value = await store.get(userId, childId, input.runId);
      if (!value) return null;
      if (input.offset > value.text.length) throw new FamilyError(400, "invalid_input");
      const metadata = { runId: value.runId, status: value.status, stopReason: value.stopReason, counts: value.counts,
        tools: value.tools, citationReferences: value.citations.map(item => ({ chunkId: item.chunkId, sourceId: item.sourceId, versionId: item.versionId })),
        evidenceUse: "historical_result_not_current_evidence", offset: input.offset, totalCharacters: value.text.length };
      const available = Math.max(0, Math.min(input.limit, run.budget.toolResponseCharacters - JSON.stringify(metadata).length - 900));
      const text = value.text.slice(input.offset, input.offset + available), end = input.offset + text.length;
      return { ...metadata, text, complete: end === value.text.length, nextOffset: end < value.text.length ? end : null,
        budgetLimited: available < input.limit && end < value.text.length };
    })),
    make("save_work", saveAgentWorkSchema, (args, call) => guard(() => store.saveWork(run.scope, run.runId, call.callId, saveAgentWorkSchema.parse(args)))),
    make("search_history", historySearchSchema, args => guard(() => store.searchHistory(userId, childId, historySearchSchema.parse(args)))),
    make("read_history", historyReadSchema, args => guard(() => store.readHistory(userId, childId, historyReadSchema.parse(args)))),
    make("read_memory_facts", memoryFactReadSchema, args => guard(async () => {
      const parsed = memoryFactReadSchema.parse(args);
      const input = { factId: parsed.factId ?? null, afterId: parsed.afterId ?? null, ...(parsed.keys?.length ? { keys: parsed.keys } : {}) };
      const note = (facts: Array<MemoryFact | null | undefined>) => {
        onConfirmedMemoryFacts?.(facts.filter((fact): fact is MemoryFact => Boolean(fact)));
      };
      if (input.factId) {
        const fact = await memory.getFact(userId, childId, input.factId);
        note([fact]);
        return fact;
      }
      if (input.keys) {
        if (!memory.recall) throw new FirestoreDomainError(503, "memory_lookup_unavailable");
        const result = await memory.recall(userId, childId, input.keys);
        // Never truncate a keyed response into a false complete result. The caller can narrow the keys.
        if (JSON.stringify(result).length > run.budget.toolResponseCharacters - 900) throw new FirestoreDomainError(413, "response_limit");
        note(result.facts);
        return {
          ...result,
          lookup: "exact_current_keys",
          historicalSearchAvailable: true,
          ...(result.missingKeys?.length
            ? { note: "部分或全部 keys 未有確切命中（keys 只作完全一致比對）。切勿繼續猜測鍵名；請改為呼叫不帶 keys 的 read_memory_facts({})（或 read_context）直接列出目前所有已確認事實及真正鍵名。" }
            : {}),
        };
      }
      const page = await memory.facts(userId, childId, input.afterId ?? undefined, 10);
      if (!page) return null;
      const items: typeof page.items = [];
      for (const item of page.items) {
        if (JSON.stringify({ items: [...items, item] }).length > run.budget.toolResponseCharacters - 900) break;
        items.push(item);
      }
      const more = items.length < page.items.length || page.nextAfterId !== null;
      const keys = new Map<string, Set<string>>();
      for (const fact of items.filter(item => item.applicable)) {
        const key = normalizedFactKey(fact.key), values = keys.get(key) ?? new Set<string>(); values.add(fact.content); keys.set(key, values);
      }
      note(items);
      return { items, nextAfterId: items.length < page.items.length ? items.at(-1)?.id ?? input.afterId : page.nextAfterId, partial: more,
        conflictingKeys: [...keys].filter(([, values]) => values.size > 1).map(([key]) => key),
        unavailableFactKeys: items.filter(item => !item.applicable).map(item => normalizedFactKey(item.key)) };
    })),
    make("propose_fact_revision", z.object(revisionShape).strict(), (args, call) => guard(async () => {
      const proposal = await store.propose(run.scope, run.runId, call.callId, agentProposalSchema.parse({ ...args, kind: "memory_fact_revise" }));
      if (!proposal) throw new AgentStopped("unauthorized");
      onPendingMemoryProposal?.();
      return prepareProposalConfirmation(store, run, proposal);
    })),
    make("propose_fact_deactivation", z.object(deactivationShape).strict(), (args, call) => guard(async () => {
      const proposal = await store.propose(run.scope, run.runId, call.callId, agentProposalSchema.parse({ ...args, kind: "memory_fact_deactivate" }));
      if (!proposal) throw new AgentStopped("unauthorized");
      onPendingMemoryProposal?.();
      return prepareProposalConfirmation(store, run, proposal);
    })),
    { ...make("request_confirmation", requestAgentConfirmationSchema, async args => {
      const response = await guard(() => {
        const parsed = requestAgentConfirmationSchema.parse(args);
        return store.requestConfirmation(run.scope, run.runId, { ...parsed, workId: parsed.workId ?? null });
      });
      if (response.status === "conflict" || (response.status === "rejected" && response.data?.code)) {
        return { ...response, data: { ...response.data,
          nextAction: "若前一步 propose_fact／propose_fact_revision／propose_fact_deactivation／propose_family_document_change 已返回 confirmationPrepared=true，確認問題已經準備，請直接呼叫 present_answer（毋須重複呼叫 request_confirmation）。否則只可傳入本 run 待確認候選的最新 runId、proposalId、expectedVersion 與 workId（無工作傳 null）。" } };
      }
      return response;
    }), parameterErrorHints: () => [{ path: "$", reason: "invalid_parameters",
      expected: "Pass {runId, proposalId, expectedVersion, workId?: uuid|null} from a pending proposal in this run. Skip request_confirmation if the proposal already returned confirmationPrepared=true." }] },
  ];
}
