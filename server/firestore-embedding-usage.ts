import { FirestoreAiUsage, KNOWLEDGE_MAINTENANCE_PAYER, KNOWLEDGE_PUBLICATION_PAYER } from "./firestore-ai-usage.ts";
import type { CommissionedKnowledgePublication } from './firestore-ai-usage.ts';
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { DurableAiUsageRequest } from "./durable-ai-usage.ts";
import type { EmbeddingActor, EmbeddingUsage } from "./embedding-gateway.ts";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import { knowledgeHash } from "./knowledge-inputs.ts";
import type { CampaignDayAdmission } from "./knowledge-campaign-budget.ts";

type Sponsor = { userId: string; dailyLimit: number; binding: string };
export function operatorEmbeddingRequest(actor: EmbeddingActor, sequence: number, deadlineAtMs: number, userLimit: number,
  globalLimit: number, manualPublication: CommissionedKnowledgePublication | undefined, sponsor?: Sponsor): DurableAiUsageRequest {
  const key = knowledgeHash(actor);
  return { kind: 'embedding', rootRunId: actor.operationId, attemptKey: 'operator-embedding:' + sequence,
    bindingFingerprint: sponsor ? knowledgeHash([key, sponsor.binding]) : key, requestFingerprint: knowledgeHash([actor, sequence]),
    userId: sponsor?.userId ?? (actor.kind === 'corpus_maintenance' ? (manualPublication ? KNOWLEDGE_PUBLICATION_PAYER : KNOWLEDGE_MAINTENANCE_PAYER) : actor.actorId),
    ...(sponsor ? {budgetPurpose: 'knowledge_maintenance', maintenanceLimit: userLimit} : {}),
    childId: '00000000-0000-0000-0000-000000000000', model: KNOWLEDGE_EMBEDDING.model, deadlineAtMs, userLimit: sponsor?.dailyLimit ?? userLimit, globalLimit };
}

/** Host-operator gateway adapter, using the exact shared platform daily counters. */
export function createFirestoreOperatorEmbeddingUsage(options: FirestoreDomainOptions, deadlineAtMs: number,
  sponsor?: Sponsor, campaignAdmission?: CampaignDayAdmission,
  manualPublication?: CommissionedKnowledgePublication): EmbeddingUsage {
  const usage = new FirestoreAiUsage({ ...options, namespace: options.namespace + "_ai_usage", billingSource: sponsor ? "personal" : "platform", campaignAdmission, manualPublication });
  let sequence = 0, current: { key: string; request: DurableAiUsageRequest } | null = null;
  return {
    async reserve(actor, userLimit, globalLimit) {
      if (current || ++sequence > 16 || !actor.actorId.startsWith("operator:") || Date.now() >= deadlineAtMs) throw new Error("knowledge_maintenance_scope_invalid");
      if (sponsor && actor.kind !== 'corpus_maintenance') throw new Error("knowledge_maintenance_scope_invalid");
      const key = knowledgeHash(actor), request = operatorEmbeddingRequest(actor,sequence,deadlineAtMs,userLimit,globalLimit,manualPublication,sponsor);
      const admitted = await usage.reserve(request, actor.kind);
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
