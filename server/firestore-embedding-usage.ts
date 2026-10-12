import { FirestoreAiUsage } from "./firestore-ai-usage.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { DurableAiUsageRequest } from "./durable-ai-usage.ts";
import type { EmbeddingUsage } from "./embedding-gateway.ts";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import { knowledgeHash } from "./knowledge-inputs.ts";

/** Host-operator gateway adapter, using the exact shared platform daily counters. */
export function createFirestoreOperatorEmbeddingUsage(options: FirestoreDomainOptions, deadlineAtMs: number): EmbeddingUsage {
  const usage = new FirestoreAiUsage({ ...options, namespace: options.namespace + "_ai_usage", billingSource: "platform" });
  let sequence = 0, current: { key: string; request: DurableAiUsageRequest } | null = null;
  return {
    async reserve(actor, userLimit, globalLimit) {
      if (current || ++sequence > 16 || !actor.actorId.startsWith("operator:") || Date.now() >= deadlineAtMs) throw new Error("knowledge_maintenance_scope_invalid");
      const key = knowledgeHash(actor), request: DurableAiUsageRequest = { kind: "embedding", rootRunId: actor.operationId,
        attemptKey: "operator-embedding:" + sequence, bindingFingerprint: key, requestFingerprint: knowledgeHash([actor, sequence]),
        userId: actor.kind === "corpus_maintenance" ? "system:knowledge-maintenance" : actor.actorId,
        childId: "00000000-0000-0000-0000-000000000000", model: KNOWLEDGE_EMBEDDING.model, deadlineAtMs, userLimit, globalLimit };
      const admitted = await usage.reserve(request);
      if (admitted.decision === "quota_exceeded") return false;
      if (admitted.decision !== "execute") throw new Error("knowledge_embedding_result_unknown");
      current = { key, request }; return true;
    },
    async record(attempt) {
      const key = knowledgeHash({ kind: attempt.kind, actorId: attempt.actorId, operationId: attempt.operationId });
      if (!current || current.key !== key) throw new Error("knowledge_maintenance_scope_invalid");
      await usage.record(current.request, { kind: "embedding", outcome: attempt.outcome, inputTokens: attempt.inputTokens,
        billableCharacters: attempt.billableCharacters, durationMs: attempt.durationMs });
      current = null;
    },
  };
}
