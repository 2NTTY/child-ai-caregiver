import type { Transaction } from '@google-cloud/firestore';
import type { PlatformMediaStore } from './firestore-platform-media.ts';
import { mediaWithoutPages } from '../src/shared/platform-media.ts';
import { platformMaterials } from './platform-materials.ts';
import { platformCardCommand, type PlatformCardPreview } from '../src/shared/admin-platform-cards.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { parseKnowledgeSource } from './knowledge-inputs.ts';
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash } from './knowledge-review-assessment.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS } from './knowledge-lexical-index.ts';

export function createAdminPlatformCards(store: FirestoreKnowledgeStore, readControl: (tx: Transaction) => Promise<{ enabled: boolean }>, media?: PlatformMediaStore,
  processMedia?: (id: string, signal: AbortSignal) => Promise<void>, indexReviewed?: (id: string, hash: string) => Promise<void>) {
  async function enabled(tx: Transaction) {
    if (!(await readControl(tx)).enabled) domainReject('knowledge_treatment_maintenance');
  }
  async function preview(sourceId: string, versionId: string): Promise<PlatformCardPreview> {
    const { base, selected } = await store.platformEditions(sourceId, versionId);
    const { chunks, ...header } = selected.source;
    const { chunks: before = [], ...previous } = base?.source ?? {};
    const headerChanges = [...new Set([...Object.keys(previous), ...Object.keys(header)])].flatMap(field => {
      const a = Reflect.get(previous, field), b = Reflect.get(header, field);
      return knowledgeReviewHash(a) === knowledgeReviewHash(b) ? [] : [{ field, previous: JSON.stringify(a) ?? null, current: JSON.stringify(b) ?? null }];
    });
    const old = new Map(before.map(chunk => [chunk.key, chunk])), next = new Map(chunks.map(chunk => [chunk.key, chunk]));
    const changes = [...new Set([...old.keys(), ...next.keys()])].flatMap(key => {
      const a = old.get(key), b = next.get(key);
      if (knowledgeReviewHash(a) === knowledgeReviewHash(b)) return [];
      return [{ key, previous: a ? JSON.stringify(a, null, 2) : null, current: b ? JSON.stringify(b, null, 2) : null,
        oldQuote: a?.sourceExcerpt || null, newQuote: b?.sourceExcerpt || null }];
    });
    return { sourceId, versionId, versionHash: selected.versionHash, baseId: base?.versionId ?? null,
      baseHash: base?.versionHash ?? null, state: selected.state, title: header.title, url: header.url, termsUrl: header.termsUrl,
      observationHash: selected.observationHash, published: base?.versionId === versionId,
      headerChanged: headerChanges.length > 0, headerChanges, changes };
  }
  async function submit(raw: unknown, reviewer: string) {
    const cmd = domainParse(platformCardCommand, raw);
    if (cmd.action === 'media') {
      if (!media) domainReject('knowledge_media_unavailable', 503);
      const changed = await media.database.runTransaction(async tx => {
        await enabled(tx); return media.toggle(tx, cmd.sourceId, cmd.enabled, cmd.revision);
      });
      if (!cmd.enabled || !processMedia) return mediaWithoutPages(changed);
      await processMedia(cmd.sourceId, AbortSignal.timeout(300000));
      return mediaWithoutPages(await media.database.runTransaction(tx => media.read(tx, cmd.sourceId)));
    }
    if (cmd.action === 'draft') {
      const source = parseKnowledgeSource(cmd.source);
      if (source.classification !== 'official_guidance') domainReject('knowledge_source_not_allowed', 403);
      const saved = await store.importSource(source, enabled);
      return { sourceId: source.sourceId, versionId: saved.versionId, versionHash: saved.hash };
    }
    const { sourceId, versionId, versionHash } = cmd;
    const identity = { sourceId, versionId, versionHash };
    const { base, selected } = await store.platformEditions(sourceId, versionId);
    if (selected.versionHash !== versionHash) domainReject('knowledge_review_version_mismatch');
    if (cmd.action === 'sync' && base?.versionId === versionId && selected.state === 'reviewed') return identity;
    if ((base?.versionId ?? null) !== cmd.baseId || base?.versionId === versionId) domainReject('knowledge_review_baseline_changed');
    if (cmd.action === 'review') {
      const assessment = domainParse(knowledgeReviewAssessmentSchema, cmd.assessment);
      await store.review(versionId, versionHash, reviewer, assessment,
        selected.observationHash ? { sourceId, contentHash: selected.observationHash } : undefined, enabled);
    } else {
      if (selected.state !== 'reviewed') domainReject('knowledge_version_unreviewed');
      await indexReviewed?.(versionId, versionHash);
      for (let bucket = 0; bucket < KNOWLEDGE_LEXICAL_BUCKETS; bucket += KNOWLEDGE_LEXICAL_BATCH)
        if ((await store.prepareSearch(versionId, versionHash, enabled)).complete) break;
      await store.publish(versionId, versionHash, undefined, { syncReviewedObservation: true, async prepare(tx, publication) {
        await enabled(tx);
        if (publication.previousVersionId !== cmd.baseId && publication.previousVersionId !== versionId)
          domainReject('knowledge_review_baseline_changed');
        return () => {};
      } });
    }
    return identity;
  }
  return { preview, submit, async active(id: string) {
    if (!platformMaterials.has(id)) domainReject('knowledge_source_not_allowed', 403);
    const edition = await store.publishedEdition(id);
    return edition?.enabled ? { versionId: edition.versionId, source: edition.source } : null;
  }, async mediaStatus(id: string) {
    if (!media) domainReject('knowledge_media_unavailable', 503);
    return mediaWithoutPages(await media.database.runTransaction(tx => media.read(tx, id), { readOnly: true }));
  } };
}
