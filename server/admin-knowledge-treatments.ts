import type { Transaction } from '@google-cloud/firestore';
import type { ChunkTreatment } from '../src/shared/source-series.ts';
import { treatmentCommand, type TreatmentView } from '../src/shared/admin-knowledge-treatment.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash } from './knowledge-review-assessment.ts';
import { treatmentContentHash } from './knowledge-inputs.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS } from './knowledge-lexical-index.ts';

const defaultTreatment: ChunkTreatment = { kind: 'detailed', policyVersion: 1 };

export function createAdminKnowledgeTreatments(store: FirestoreKnowledgeStore, readControl: (tx: Transaction) => Promise<{ enabled: boolean }>) {
  async function read(sourceId: string, versionId?: string) {
    const editions = await store.treatmentEditions(sourceId, versionId);
    if (versionId && treatmentContentHash(editions.selected.source) !== treatmentContentHash(editions.base.source))
      domainReject('knowledge_treatment_content_changed');
    return editions;
  }
  return {
    async view(sourceId: string, versionId?: string): Promise<TreatmentView> {
      const { base, selected } = await read(sourceId, versionId);
      return {
        sourceId,
        baseId: base.versionId,
        baseHash: base.versionHash,
        versionId: selected.versionId,
        versionHash: selected.versionHash,
        title: selected.source.title,
        url: selected.source.url,
        termsUrl: selected.source.termsUrl,
        observationHash: selected.observationHash,
        state: selected.state,
        published: selected.versionId === base.versionId,
        chunks: selected.source.chunks.map((chunk, index) => ({
          key: chunk.key,
          section: chunk.section,
          sourceExcerpt: chunk.sourceExcerpt,
          previousTreatment: base.source.chunks[index]!.treatment ?? defaultTreatment,
          treatment: chunk.treatment ?? defaultTreatment,
        })),
      };
    },
    async submit(sourceId: string, raw: unknown, reviewer: string) {
      const input = domainParse(treatmentCommand, raw);
      const candidate = input.action === 'draft' ? undefined : input.versionId;
      const { base, selected } = await read(sourceId, candidate);
      if (input.action === 'publish' && base.versionId === input.versionId && base.versionHash === input.versionHash)
        return { versionId: base.versionId, versionHash: base.versionHash, state: 'published' };
      function checkBaseline(edition: typeof base) {
        if (edition.versionId !== input.baseId || edition.versionHash !== input.baseHash) {
          domainReject('knowledge_review_baseline_changed');
        }
      }
      checkBaseline(base);
      async function ensureEnabled(tx: Transaction) {
        if (!(await readControl(tx)).enabled) domainReject('knowledge_treatment_maintenance');
      }
      async function guard(tx: Transaction) {
        await ensureEnabled(tx);
        const current = await store.treatmentEditions(sourceId, undefined, tx);
        checkBaseline(current.base);
      }
      if (input.action === 'draft') {
        const changes = new Map(input.changes.map(c => [c.key, c.treatment]));
        if (changes.size !== input.changes.length || [...changes.keys()].some(k => !base.source.chunks.some(c => c.key === k)))
          domainReject('knowledge_treatment_key_invalid', 400);
        const chunks = base.source.chunks.map(c => changes.has(c.key) ? { ...c, treatment: changes.get(c.key)! } : c);
        const changed = chunks.some((chunk, index) => knowledgeReviewHash(chunk.treatment ?? defaultTreatment)
          !== knowledgeReviewHash(base.source.chunks[index]!.treatment ?? defaultTreatment));
        if (!changed) domainReject('knowledge_treatment_unchanged');
        const draft = await store.importSource({ ...base.source, chunks }, guard);
        return { versionId: draft.versionId, versionHash: draft.hash, state: draft.state };
      }
      if (selected.versionId === base.versionId || selected.versionHash !== input.versionHash || selected.state === 'withdrawn')
        domainReject('knowledge_review_version_mismatch');
      const binding = { versionId: selected.versionId, versionHash: selected.versionHash };
      if (input.action === 'review') {
        const assessment = domainParse(knowledgeReviewAssessmentSchema, input.assessment);
        if (assessment.comparedVersionId !== base.versionId || assessment.comparedHash !== base.versionHash || assessment.observationHash !== base.observationHash)
          domainReject('knowledge_review_baseline_changed');
        const result = await store.review(selected.versionId, selected.versionHash, reviewer, assessment,
          base.observationHash ? { sourceId, contentHash: base.observationHash } : undefined, guard);
        return { ...binding, state: result.status };
      }
      if (selected.state !== 'reviewed') domainReject('knowledge_version_unreviewed');
      for (let bucket = 0; bucket < KNOWLEDGE_LEXICAL_BUCKETS; bucket += KNOWLEDGE_LEXICAL_BATCH)
        if ((await store.prepareSearch(selected.versionId, selected.versionHash, ensureEnabled)).complete) break;
      const result = await store.publish(selected.versionId, selected.versionHash, undefined, {
        treatmentBaseline: base.versionId,
        async prepare(tx) {
          await guard(tx);
          return () => { };
        },
      });
      return { ...binding, state: result.status };
    },
  };
}
