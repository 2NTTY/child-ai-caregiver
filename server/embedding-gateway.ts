import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { ModelBillingSource } from "../src/shared/model-settings.ts";
import type { AiConfig } from "./ai-config.ts";
import { createAiUsageStore } from "./ai-usage.ts";
import { vectorLiteral } from "./knowledge-store.ts";
import { knowledgeHash } from "./knowledge-inputs.ts";

export interface EmbeddingInput { text: string; task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"; title?: string }
export interface EmbeddingReply { values: number[]; inputTokens: number | null; billableCharacters: number | null }
export interface EmbeddingProvider { embed(input: EmbeddingInput, signal: AbortSignal): Promise<EmbeddingReply> }
export class EmbeddingFailure extends Error {
  readonly code: "unavailable" | "invalid_response" | "invalid_input" | "cancelled" | "quota_exceeded" | "unauthorized" | "disabled";
  constructor(code: EmbeddingFailure["code"]) { super(`Embedding ${code}`); this.code = code; }
}
export interface EmbeddingActor {
  kind: "query_embedding" | "corpus_maintenance";
  actorId: string;
  operationId: string;
}
interface EmbeddingAttempt extends EmbeddingActor {
  outcome: "succeeded" | "unavailable" | "invalid_response" | "invalid_input" | "unauthorized" | "timeout" | "cancelled";
  documentHash: string | null;
  inputTokens: number | null; billableCharacters: number | null; durationMs: number;
}
export interface EmbeddingUsage {
  reserve(actor: EmbeddingActor, userLimit: number, globalLimit: number): Promise<boolean>;
  record(attempt: EmbeddingAttempt): Promise<void>;
}
export function createEmbeddingUsage(pool: Pool, source: ModelBillingSource = "platform"): EmbeddingUsage {
  const counters = createAiUsageStore(pool, source);
  function requireActor(actor: EmbeddingActor) {
    if (source === "personal" && actor.kind === "corpus_maintenance") throw new EmbeddingFailure("unauthorized");
  }
  return {
    // Generation and query embeddings share their billing source counters and the existing global lock.
    async reserve(actor, userLimit, globalLimit) {
      requireActor(actor);
      return counters.reserve(actor.kind === "query_embedding" ? actor.actorId : "system:knowledge-maintenance", userLimit, globalLimit);
    },
    async record(attempt) {
      requireActor(attempt);
      try {
        await pool.query(`INSERT INTO embedding_attempts (id,kind,actor_id,operation_id,model,dimensions,outcome,input_tokens,billable_characters,duration_ms,document_hash,billing_source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [randomUUID(), attempt.kind, attempt.actorId, attempt.operationId,
          KNOWLEDGE_EMBEDDING.model, KNOWLEDGE_EMBEDDING.dimensions, attempt.outcome, attempt.inputTokens, attempt.billableCharacters, attempt.durationMs, attempt.documentHash, source]);
      } catch { throw new Error("Embedding usage storage unavailable"); }
    },
  };
}
export function createEmbeddingGateway(options: { config: AiConfig; provider?: EmbeddingProvider; usage: EmbeddingUsage }) {
  return {
    async embed(input: EmbeddingInput, actor: EmbeddingActor, signal: AbortSignal, authorize: () => Promise<boolean>): Promise<number[]> {
      const { config, provider, usage } = options;
      if (signal.aborted) throw new EmbeddingFailure("cancelled");
      if (!await authorize()) throw new EmbeddingFailure("unauthorized");
      if (!config.enabled || !provider) throw new EmbeddingFailure("disabled");
      if (!input.text.trim() || input.text.length > (input.task === "RETRIEVAL_QUERY" ? 2000 : 4000)
        || /[\u0000\uD800-\uDFFF]/u.test(input.text) || (input.title?.length ?? 0) > 600 || /[\u0000\uD800-\uDFFF]/u.test(input.title ?? "")
        || !["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"].includes(input.task)
        || (input.task === "RETRIEVAL_QUERY" && input.title !== undefined)
        || (input.task === "RETRIEVAL_DOCUMENT" && !input.title?.trim())
        || !actor.actorId || actor.actorId.length > 160 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.operationId)
        || !["query_embedding", "corpus_maintenance"].includes(actor.kind)
        || (actor.kind === "query_embedding") !== (input.task === "RETRIEVAL_QUERY")) throw new EmbeddingFailure("invalid_input");
      // Maintenance has its own finite per-day counter but cannot increase the shared global limit.
      const limit = actor.kind === "corpus_maintenance" ? Math.min(16, config.dailyGlobalAttempts) : config.dailyUserAttempts;
      if (!await usage.reserve(actor, limit, config.dailyGlobalAttempts)) throw new EmbeddingFailure("quota_exceeded");
      const started = Date.now();
      const controller = new AbortController();
      const onAbort = () => controller.abort(new EmbeddingFailure("cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      const timer = setTimeout(() => controller.abort(new EmbeddingFailure("unavailable")), config.timeoutMs);
      let onStop: (() => void) | undefined;
      let outcome: EmbeddingAttempt["outcome"] = "unavailable";
      let inputTokens: number | null = null, billableCharacters: number | null = null;
      try {
        if (controller.signal.aborted) throw controller.signal.reason;
        const reply = await Promise.race([provider.embed(input, controller.signal), new Promise<never>((_, reject) => {
          onStop = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", onStop, { once: true });
          if (controller.signal.aborted) onStop();
        })]);
        inputTokens = reply.inputTokens; billableCharacters = reply.billableCharacters;
        if (![inputTokens, billableCharacters].every(value => value === null || (Number.isSafeInteger(value) && value >= 0))) throw new EmbeddingFailure("invalid_response");
        try { vectorLiteral(reply.values); } catch { throw new EmbeddingFailure("invalid_response"); }
        if (!await authorize()) throw new EmbeddingFailure("unauthorized");
        if (controller.signal.aborted) throw controller.signal.reason;
        outcome = "succeeded";
        return reply.values;
      } catch (error) {
        const failure = error instanceof EmbeddingFailure ? error : new EmbeddingFailure("unavailable");
        outcome = signal.aborted ? "cancelled" : controller.signal.aborted ? "timeout"
          : failure.code === "invalid_response" || failure.code === "invalid_input" || failure.code === "unauthorized" ? failure.code : "unavailable";
        // Do not persist invalid provider statistics as believable usage.
        if (!Number.isSafeInteger(inputTokens) || (inputTokens ?? -1) < 0) inputTokens = null;
        if (!Number.isSafeInteger(billableCharacters) || (billableCharacters ?? -1) < 0) billableCharacters = null;
        throw failure;
      } finally {
        clearTimeout(timer); signal.removeEventListener("abort", onAbort);
        if (onStop) controller.signal.removeEventListener("abort", onStop);
        await usage.record({ ...actor, outcome, inputTokens, billableCharacters, durationMs: Math.max(0, Date.now() - started),
          documentHash: input.task === "RETRIEVAL_DOCUMENT" ? knowledgeHash([input.title, input.text]) : null });
      }
    },
  };
}
export type EmbeddingGateway = ReturnType<typeof createEmbeddingGateway>;
