import type { KnowledgeCandidate, KnowledgeEvidence, KnowledgeFilter } from "../src/shared/knowledge.ts";

type Identity = Pick<KnowledgeEvidence, "chunkId" | "versionId" | "contentHash">
  & Partial<Pick<KnowledgeEvidence, "sourceId" | "versionHash" | "classification">>;

/** Comparable passages can agree or differ. Only their reviewed text establishes the relationship. */
export function comparableCardPassages(a: KnowledgeEvidence, b: KnowledgeEvidence): boolean {
  if (!a.series || !b.series || a.series.id !== b.series.id || a.series.institutionId !== b.series.institutionId
    || a.sourceId === b.sourceId || a.classification !== b.classification || !a.sourceExcerpt || !b.sourceExcerpt
    || a.sourceExcerpt === b.sourceExcerpt) return false;
  const conditions = a.applicability.conditions, other = b.applicability.conditions;
  return a.section === b.section || (conditions.length > 0 && conditions.length === other.length
    && conditions.every(condition => other.includes(condition)));
}

export function isKnowledgeEvidenceFresh(chunk: Pick<KnowledgeEvidence, "reviewState" | "validUntil">, now = Date.now()): boolean {
  if (chunk.reviewState !== "reviewed") return false;
  if (chunk.validUntil === undefined || chunk.validUntil === null) return true;
  const ends = Date.parse(chunk.validUntil);
  return Number.isFinite(ends) && ends > now;
}

export function sameReviewedEdition(prior: Identity, live: KnowledgeEvidence, filter: KnowledgeFilter, now: number): boolean {
  return (live.applicability?.use !== 'original_lookup' || filter.purpose === 'read_originals')
    && live.chunkId === prior.chunkId && live.versionId === prior.versionId && live.contentHash === prior.contentHash
    && (prior.sourceId === undefined || live.sourceId === prior.sourceId)
    && (prior.versionHash === undefined || live.versionHash === prior.versionHash)
    && (prior.classification === undefined || live.classification === prior.classification)
    && live.classification === filter.classification && isKnowledgeEvidenceFresh(live, now);
}

/** Only the authorized library's fresh read supplies wording; never import the previous run's text or original-read coverage. */
export async function readReusableEvidence(owner: string, filter: KnowledgeFilter, prior: readonly KnowledgeEvidence[],
  read: (filter: KnowledgeFilter, selection: { libraryUserId: string; chunkIds: string[]; limit: number }) => Promise<KnowledgeCandidate[]>) {
  const unique = [...new Map(prior.map(item => [item.chunkId, item])).values()].slice(0, 6);
  const valid: KnowledgeEvidence[] = [], invalidated: KnowledgeEvidence[] = [];
  if (!owner || filter.classification !== "official_guidance" || !unique.length) return { valid, invalidated: unique };
  const current = await read(filter, { libraryUserId: owner, chunkIds: unique.map(item => item.chunkId), limit: 6 });
  const now = Date.now();
  for (const item of unique) {
    const chunk = item.sourceId && item.versionHash && item.classification === "official_guidance"
      && current.find(row => sameReviewedEdition(item, row, filter, now));
    if (!chunk) { invalidated.push(item); continue; }
    const { distance: _distance, rankScore: _rank, originalText: _original, citedExcerpt: _quote, ...reviewed } = chunk;
    valid.push({ ...reviewed, readCoverage: { kind: "reviewed_text_and_excerpt", complete: false } });
  }
  return { valid, invalidated };
}

/** Capture checks, not excerpts; a source without an independent live check cannot be replayed. */
export function bindRepairSourceChecks(ids: readonly string[], resolve: (id: string) => (() => Promise<boolean>) | undefined) {
  const checks = [...new Set(ids)].map(resolve);
  return async () => {
    for (const check of checks) if (!check || !await check()) return false;
    return true;
  };
}

export function needsQueryEmbeddingKey(durable: boolean, tool: string): boolean {
  return durable && (tool === "search_knowledge" || tool === "find_official_material" || tool === "search_source_card_evidence");
}
