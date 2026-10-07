import { z } from "zod";
import { privateSourceCitationSchema } from "../shared/product-agent.ts";
import { agentDecisionSchema, agentProposalSchema, agentPendingPageSchema, type AgentDecision, type AgentProposal, type AgentPendingPage, type ProductAgentResult } from "../shared/product-agent.ts";

export type ProductAgentErrorCode = "invalid_input" | "unauthorized" | "not_found" | "session_changed"
  | "account_precondition_required" | "version_conflict" | "confirmation_expired" | "confirmation_scope_changed"
  | "agent_run_expired" | "sharing_confirmation_required" | "source_changed" | "fact_key_conflict"
  | "ai_unavailable" | "check_original_run";
const knownCodes = new Set<ProductAgentErrorCode>(["invalid_input", "unauthorized", "not_found", "session_changed",
  "account_precondition_required", "version_conflict", "confirmation_expired", "confirmation_scope_changed",
  "agent_run_expired", "sharing_confirmation_required", "source_changed", "fact_key_conflict", "ai_unavailable", "check_original_run"]);
const knownStatuses = new Set([400, 401, 403, 404, 405, 409, 415, 428, 429, 500, 502, 503, 504]);
export const requiresFreshAgentConfirmation = (error: ProductAgentApiError): boolean => error.status === 409 && error.code !== "session_changed";

export class ProductAgentApiError extends Error {
  readonly status: number;
  readonly code: ProductAgentErrorCode | null;
  constructor(status = 0, code: ProductAgentErrorCode | null = null) {
    super("Agent request could not be confirmed");
    this.name = "ProductAgentApiError";
    this.status = knownStatuses.has(status) ? status : 0;
    this.code = code !== null && knownCodes.has(code) ? code : null;
  }
}

import { agentWorkPageSchema, agentHistoryPageSchema, agentHistoryMessageSchema, type AgentWorkPage, type AgentHistoryPage, type AgentHistoryMessage } from "../shared/agent-work.ts";
export interface ProductAgentApi {
  getWork(childId: string, signal: AbortSignal, userId: string, workId?: string | null, cursor?: string | null): Promise<AgentWorkPage>;
  searchHistory(childId: string, kind: "message" | "private_instruction" | "memory_fact", query: string, signal: AbortSignal, userId: string, cursor?: string | null): Promise<AgentHistoryPage>;
  readHistory(childId: string, messageId: string, offset: number, signal: AbortSignal, userId: string): Promise<AgentHistoryMessage>;
  getPendingProposals(childId: string, signal: AbortSignal, userId: string, cursor?: string | null): Promise<AgentPendingPage>;
  getRun(childId: string, runId: string, signal: AbortSignal, userId: string): Promise<ProductAgentResult>;
  decideProposal(childId: string, runId: string, proposalId: string, input: AgentDecision, signal: AbortSignal, userId: string): Promise<AgentProposal>;
}

const uuid = z.uuid();
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const proposalSchema = z.object({
  id: uuid, runId: uuid, childId: uuid, version,
  status: z.enum(["pending", "accepted", "dismissed", "expired"]),
  createdAt: timestamp, expiresAt: timestamp, value: agentProposalSchema, targetLabel: z.string().nullable(), targetVisibility: z.enum(["private", "family"]).optional(),
  result: z.object({ kind: z.enum(["task", "memory_fact", "private_source", "concern"]), id: uuid, version }).nullable(),
}).refine(value => value.status === "accepted"
  ? value.result !== null && value.result.kind === (value.value.kind.startsWith("concern_")?"concern":value.value.kind.startsWith("private_source_")?"private_source":value.value.kind.startsWith("memory_fact") ? "memory_fact" : "task")
  : value.result === null);
const citationSchema = z.object({
  key: z.string(), section: z.string(), sourceExcerpt: z.string(), text: z.string(), keywords: z.array(z.string()),
  applicability: z.object({ region: z.string(), ageBasis: z.enum(["actual", "corrected", "any"]),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(), maxAgeMonthsExclusive: z.boolean().optional(),
    topics: z.array(z.string()), conditions: z.array(z.string()) }),
  chunkId: uuid, sourceId: identifier, versionId: uuid, versionHash: z.string(), contentHash: z.string(),
  url: z.string(), title: z.string(), publisher: z.string(), classification: z.enum(["official_guidance", "recent_information"]),
  sourcePublishedAt: timestamp.nullable(), sourceUpdatedAt: timestamp.nullable(), sourceDateText: z.string().nullable().optional(),
  validUntil: timestamp.nullable().optional(), fetchedAt: timestamp, checkedAt: timestamp,
  lastSuccessfulCheckAt: timestamp.nullable().optional(), usageScope: z.enum(["public_noncommercial", "internal_noncommercial"]).optional(),
  reviewState: z.literal("reviewed"),
});
const resultSchema = z.object({
  provenance: z.object({ packVersion: z.string(), recipeId: z.string(), model: z.string() }).nullable(),
  runId: uuid, status: z.enum(["running", "completed", "stopped", "unknown"]), stopReason: z.string().nullable(),
  text: z.string(), citations: z.array(citationSchema), retrievalMode: z.enum(["vector_keyword", "keyword_degraded", "not_used"]),
  privateSourceCitations:z.array(privateSourceCitationSchema).max(6).optional(),
  tools: z.array(z.object({ name: z.string().min(1), status: z.enum(["succeeded", "rejected", "conflict", "failed", "unknown"]), reference: z.string().optional() })),
  countsKnown: z.boolean().optional(),
  counts: z.object({ modelCalls: count, toolCalls: count, queryEmbeddings: count }), proposals: z.array(proposalSchema),
});
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
interface PendingDecision { childId: string; runId: string; userId: string; proposalId: string; input: AgentDecision; reviewed: boolean; freshConfirmation: boolean }

export function createProductAgentApi(baseUrl = "", fetcher: typeof fetch = fetch): ProductAgentApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  let pending: PendingDecision | null = null;
  const sameScope = (attempt: PendingDecision, childId: string, runId: string, userId: string) =>
    attempt.childId === childId && attempt.runId === runId && attempt.userId === userId;
  function checkScope(childId: string, runId: string, userId: string) {
    if (!uuid.safeParse(childId).success || !uuid.safeParse(runId).success || !identifier.safeParse(userId).success) throw new ProductAgentApiError(400, "invalid_input");
  }
  const path = (childId: string, runId: string) => `/children/${encodeURIComponent(childId)}/agent/runs/${encodeURIComponent(runId)}`;
  async function request(url: string, signal: AbortSignal, userId: string, body?: AgentDecision): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, body === undefined ? 15_000 : 20_000);
    try {
      const response = await fetcher(`${apiUrl}${url}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.ok) {
        let code: ProductAgentErrorCode | null = null;
        try {
          const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string" && knownCodes.has(value.error.code as ProductAgentErrorCode)) code = value.error.code as ProductAgentErrorCode;
        } catch { /* Keep the allowlisted status when the response body is malformed. */ }
        throw new ProductAgentApiError(response.status, code);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ProductAgentApiError) throw error;
      throw new ProductAgentApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  return {
    async getWork(childId, signal, userId, workId = null, cursor = null) {
      if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success || workId !== null && !uuid.safeParse(workId).success || cursor !== null && !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new ProductAgentApiError(400, "invalid_input");
      const data = await request(`/children/${encodeURIComponent(childId)}/agent/work${workId ? "/" + workId : ""}${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`, signal, userId);
      const parsed = agentWorkPageSchema.safeParse(data);
      if (!parsed.success || parsed.data.items.some(item => item.childId !== childId)) throw new ProductAgentApiError();
      return parsed.data;
    },
    async searchHistory(childId, kind, query, signal, userId, cursor = null) {
      if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success || query.length > 200 || !["message", "private_instruction", "memory_fact"].includes(kind) || cursor !== null && !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new ProductAgentApiError(400, "invalid_input");
      const params = new URLSearchParams({ kind, query }); if (cursor) params.set("cursor", cursor);
      const parsed = agentHistoryPageSchema.safeParse(await request(`/children/${encodeURIComponent(childId)}/agent/history?${params}`, signal, userId));
      if (!parsed.success) throw new ProductAgentApiError(); return parsed.data;
    },
    async readHistory(childId, messageId, offset, signal, userId) {
      if (!uuid.safeParse(childId).success || !uuid.safeParse(messageId).success || !identifier.safeParse(userId).success || !Number.isInteger(offset) || offset < 0) throw new ProductAgentApiError(400, "invalid_input");
      const parsed = agentHistoryMessageSchema.safeParse(await request(`/children/${encodeURIComponent(childId)}/agent/history/messages/${messageId}?offset=${offset}&limit=4000`, signal, userId));
      if (!parsed.success || parsed.data.childId !== childId || parsed.data.id !== messageId || parsed.data.offset !== offset) throw new ProductAgentApiError(); return parsed.data;
    },
    async getPendingProposals(childId, signal, userId, cursor = null) {
      if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success
        || (cursor !== null && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor))) throw new ProductAgentApiError(400, "invalid_input");
      const value = await request(`/children/${encodeURIComponent(childId)}/agent/pending${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, signal, userId);
      const parsed = agentPendingPageSchema.safeParse(value);
      if (!parsed.success || parsed.data.proposals.some(item => item.childId !== childId)
        || new Set(parsed.data.proposals.map(item => item.id)).size !== parsed.data.proposals.length) throw new ProductAgentApiError();
      return parsed.data;
    },
    async getRun(childId, runId, signal, userId) {
      checkScope(childId, runId, userId);
      const value = await request(path(childId, runId), signal, userId);
      const parsed = object(value) ? resultSchema.safeParse(value.result) : null;
      if (!parsed?.success || parsed.data.runId !== runId || parsed.data.proposals.some(item => item.childId !== childId || item.runId !== runId)
        || new Set(parsed.data.proposals.map(item => item.id)).size !== parsed.data.proposals.length) throw new ProductAgentApiError();
      if (pending && sameScope(pending, childId, runId, userId)) {
        const proposal = parsed.data.proposals.find(item => item.id === pending!.proposalId);
        if (proposal && (proposal.status !== "pending" || proposal.version !== pending.input.expectedVersion || pending.freshConfirmation)) pending = null;
        else pending.reviewed = !!proposal;
      }
      return parsed.data;
    },
    async decideProposal(childId, runId, proposalId, raw, signal, userId) {
      checkScope(childId, runId, userId);
      const parsed = agentDecisionSchema.safeParse(raw);
      if (!uuid.safeParse(proposalId).success || !parsed.success) throw new ProductAgentApiError(400, "invalid_input");
      const input = parsed.data;
      if (pending && (!pending.reviewed || !sameScope(pending, childId, runId, userId) || pending.proposalId !== proposalId
        || JSON.stringify(pending.input) !== JSON.stringify(input))) throw new ProductAgentApiError(0, "check_original_run");
      const attempt: PendingDecision = { childId, runId, userId, proposalId, input, reviewed: false, freshConfirmation: false };
      pending = attempt;
      try {
        const value = await request(`${path(childId, runId)}/proposals/${encodeURIComponent(proposalId)}/decide`, signal, userId, input);
        const proposal = object(value) ? proposalSchema.safeParse(value.proposal) : null;
        if (!proposal?.success || proposal.data.childId !== childId || proposal.data.runId !== runId || proposal.data.id !== proposalId
          || proposal.data.version !== input.expectedVersion + 1 || proposal.data.status !== (input.decision === "accept" ? "accepted" : "dismissed")) throw new ProductAgentApiError();
        pending = null;
        return proposal.data;
      } catch (error) {
        if (error instanceof ProductAgentApiError) attempt.freshConfirmation = requiresFreshAgentConfirmation(error);
        throw error;
      }
    },
  };
}
