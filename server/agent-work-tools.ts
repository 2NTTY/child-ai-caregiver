import { z } from "zod";
import { readAgentWorkSchema, saveAgentWorkSchema, historySearchSchema, historyReadSchema, memoryFactReadSchema, requestAgentConfirmationSchema, type AgentHistoryMessage } from "../src/shared/agent-work.ts";
import { agentProposalSchema, type AgentProposal } from "../src/shared/product-agent.ts";
import { AGENT_WORK_TOOL_DESCRIPTIONS } from "./agent-work-tool-descriptions.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import type { MemoryStore } from "./memory.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { AgentStopped } from "./agent-budget.ts";
import { FamilyError } from "./family-access.ts";
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { factIsApplicable, memoryFactReferencedByParagraph, normalizedFactKey } from "./memory-policy.ts";
import type { MemoryFact } from "../src/shared/memory.ts";

// In an ordinary chat search, an omitted cursor means the first page.
// The store and public API still receive the explicit discriminator and cursor.
const chatHistorySearchSchema = z.strictObject({ ...historySearchSchema.shape,
  kind: historySearchSchema.shape.kind.default('message'),
  cursor: historySearchSchema.shape.cursor.default(null),
});

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
  onConfirmedMemoryFacts?: (facts: MemoryFact[]) => void, onPendingMemoryProposal?: () => void,
  onHistoryRead?: (message: AgentHistoryMessage, reread: () => Promise<AgentHistoryMessage | null>, precedingMatch?: string) =>
    { citationId: string; quoteHistory: string }, currentMessageId?: string, onRecallExpiry?: (until: string) => void,
  currentUserText?: string): AgentTool[] {
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
  async function originalQuote(fact: MemoryFact) {
    if (!onHistoryRead || !fact.applicable || !factIsApplicable(fact) || fact.childId !== childId
      || fact.source.kind !== 'private_chat' || !fact.source.messageId) return undefined;
    const input = { messageId: fact.source.messageId, offset: 0, limit: 400 };
    const read = () => store.readHistory(userId, childId, input, 'memory');
    const message = await read();
    if (!message || message.role !== 'user' || message.importedSource || message.voice || message.childId !== childId
      || message.nextOffset !== null || !fact.content.split(/[。！？!?;；，,\n]+/u).filter(clause => clause.trim())
        .every(clause => memoryFactReferencedByParagraph(clause, message.text))) return undefined;
    const reference = onHistoryRead(message, async () => {
      const current = await memory.getFact(userId, childId, fact.id);
      if (!current || current.version !== fact.version || !current.applicable || !factIsApplicable(current)) return null;
      return read();
    });
    return { ...reference, quoteAnswer: { kind: 'private_reference', paragraphs: [{ quoteHistory: reference.quoteHistory }] },
      answerGuidance: '若家長要求引用這項安排的原話，把 quoteAnswer 作為 present_answer 的完整參數。Server 會代入該句，再獨立核對。',
      original: { messageId: message.id, role: message.role, text: message.text, createdAt: message.createdAt,
      version: message.version, offset: message.offset, totalCharacters: message.totalCharacters } };
  }
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
    make("search_history", chatHistorySearchSchema, args => guard(async () => {
      const input = historySearchSchema.parse(chatHistorySearchSchema.parse(args));
      const page = await store.searchHistory(userId, childId, input, true);
      if (!page || !onHistoryRead) return page;
      if (input.kind === 'memory_fact') for (const hit of page.matches) {
        if ('applicable' in hit && hit.applicable === true && 'validUntil' in hit && typeof hit.validUntil === 'string') onRecallExpiry?.(hit.validUntil);
      }
      if (input.kind === 'memory_fact' && page.matches.length === 1) {
        const match = page.matches[0], current = await memory.getFact(userId, childId, match.id);
        if (!current || current.version !== match.version) throw new FirestoreDomainError(409, 'version_conflict');
        onConfirmedMemoryFacts?.([current]);
        const original = await originalQuote(current);
        return { ...page, matches: [{ ...match, status: current.status, applicable: current.applicable, validUntil: current.validUntil,
          source: current.source, ...original }], ...(original ? { answerGuidance: '回覆目前已確認的安排，可用 private_reference 和該項 quoteHistory 引用家長原句。' } : {}) };
      }
      const cite = (slice: Omit<AgentHistoryMessage, 'childId' | 'nextOffset'>, precedingMatch?: string): { citationId?: string; quoteHistory?: string } => {
        if (!slice.text || slice.role !== 'user') return {};
        const end = slice.offset + slice.text.length;
        const reread = () => store.readHistory(userId, childId, { messageId: slice.id, offset: slice.offset,
          limit: slice.text.length, ...(slice.contentVersion ? { contentVersion: slice.contentVersion } : {}) });
        return onHistoryRead({ ...slice, childId, nextOffset: end < slice.totalCharacters ? end : null }, reread, precedingMatch);
      };
      const matches = page.matches.filter(match => match.id !== currentMessageId).map(({ excerptRange, ...match }) => {
        if (!excerptRange || !match.role) return match;
        const anchor = cite({ id: match.id, role: match.role, version: match.version, createdAt: match.createdAt, text: match.excerpt, ...excerptRange });
        return { ...match, ...anchor, followingMessages: match.followingMessages?.filter(neighbor => neighbor.id !== currentMessageId).map(neighbor =>
          ({ ...neighbor, ...cite({ ...neighbor, offset: 0 }, anchor.citationId) })) };
      });
      const isAnotherStatement = (role: string | null, text: string) => role === 'user' && text.trim() !== currentUserText?.trim();
      const noParentStatement = input.kind === 'message' && !matches.some(match => isAnotherStatement(match.role, match.excerpt) ||
        match.followingMessages?.some(message => message.id !== currentMessageId && isAnotherStatement(message.role, message.text)));
      const noFactMatch = input.kind === 'memory_fact' && !matches.length;
      if (currentMessageId && currentUserText && input.query.trim() && !input.cursor && !input.createdFrom && !input.createdBefore && (noParentStatement || noFactMatch)) {
        // Supply bounded navigation even if the parent's wording shares no terms with the saved fact.
        // A topic is not evidence. Reading the selected ID revalidates its version and original.
        const facts = await memory.facts(userId, childId, undefined, 10);
        const applicable = facts?.items.filter(fact => fact.childId === childId && fact.applicable && factIsApplicable(fact)) ?? [];
        if (applicable.length) {
          for (const fact of applicable) if (fact.validUntil) onRecallExpiry?.(fact.validUntil);
          return { ...page, matches, currentFactTopics: applicable.map(fact => ({ factId: fact.id, key: fact.key })), factTopicsNextAfterId: facts?.nextAfterId ?? null,
            answerGuidance: '若家長追問之前定下的安排，先按意思在 currentFactTopics 選與問題相關的主題，用 read_memory_facts({factId}) 核對現行內容及家長原句。主題名稱只供定位。取得 quoteHistory 後可用 private_reference 引用。' };
        }
      }
      return { ...page, matches, ...(page.matches.some(match => match.excerptRange) ? {
        answerGuidance: '選能回答問題的家長原句，把該句的 quoteHistory 原樣填入 present_answer 的 paragraphs，kind 用 private_reference。缺片段才需續讀。'
      } : {}) };
    })),
    make("read_history", historyReadSchema, async args => {
      let reference: string | undefined;
      const response = await guard(async () => {
        const input = historyReadSchema.parse(args);
        const reread = () => store.readHistory(userId, childId, input);
        const message = await reread();
        if (!message || !message.text || message.importedSource || !onHistoryRead) return message;
        reference = message.id;
        return { ...message, ...onHistoryRead(message, reread) };
      });
      return reference && response.status === 'succeeded' ? { ...response, reference } : response;
    }),
    make("read_memory_facts", memoryFactReadSchema, args => guard(async () => {
      const parsed = memoryFactReadSchema.parse(args);
      const input = { factId: parsed.factId ?? null, afterId: parsed.afterId ?? null, ...(parsed.keys?.length ? { keys: parsed.keys } : {}) };
      const note = (facts: Array<MemoryFact | null | undefined>) => {
        onConfirmedMemoryFacts?.(facts.filter((fact): fact is MemoryFact => Boolean(fact)));
      };
      if (input.factId) {
        const fact = await memory.getFact(userId, childId, input.factId);
        note([fact]);
        return fact ? { ...fact, ...await originalQuote(fact) } : fact;
      }
      if (input.keys) {
        if (!memory.recall) throw new FirestoreDomainError(503, "memory_lookup_unavailable");
        const result = await memory.recall(userId, childId, input.keys);
        // Never truncate a keyed response into a false complete result. The caller can narrow the keys.
        if (JSON.stringify(result).length > run.budget.toolResponseCharacters - 900) throw new FirestoreDomainError(413, "response_limit");
        note(result.facts);
        const fact = result.facts.length === 1 ? result.facts[0] : null;
        const quote = fact && await originalQuote(fact);
        return {
          ...result,
          ...(fact && quote ? { facts: [{ ...fact, ...quote }] } : {}),
          lookup: "exact_current_keys",
          historicalSearchAvailable: true,
          ...(result.missingKeys?.length
            ? { note: "部分或全部 keys 未有確切命中（keys 只作完全一致比對）。切勿繼續猜測鍵名；請改為呼叫不帶 keys 的 read_memory_facts({})（或 read_context）分頁查看事實及真正鍵名，亦可用 search_history 的 memory_fact 按主題定位。" }
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
      const quote = items.length === 1 ? await originalQuote(items[0]) : undefined;
      return { items: quote ? [{ ...items[0], ...quote }] : items, nextAfterId: items.length < page.items.length ? items.at(-1)?.id ?? input.afterId : page.nextAfterId, partial: more,
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
