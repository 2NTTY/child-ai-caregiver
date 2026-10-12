import { createHash } from "node:crypto";
import { FieldValue, VectorValue, type Firestore, type Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { personalLibraryItemSchema } from "../src/shared/personal-library.ts";
import { embeddingDocument, internalKnowledgeSource, knowledgeExtractionSchema, knowledgeHash, parseKnowledgeFilter, parseKnowledgeQuery, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { knowledgeTokens } from "./knowledge-ranking.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment, type KnowledgeReviewAssessment } from "./knowledge-review-assessment.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";

export interface FirestoreKnowledgeOptions { database: Firestore; projectId: string; namespace: string; sourceIds: readonly string[] }
export interface FirestoreKnowledgeEmbedding {
  chunkKey: string; inputHash: string; model: string; dimensions: number; pipeline: string; values: readonly number[];
}
export interface FirestoreKnowledgeStore extends Pick<KnowledgeStore, "candidates" | "catalog"> {
  importSource(input: unknown): Promise<{ versionId: string; hash: string; unchanged: boolean; state: "draft" | "reviewed" | "withdrawn" }>;
  review(versionId: string, expectedHash: string, reviewer: string, assessment: KnowledgeReviewAssessment): Promise<{ status: "reviewed" | "held"; reason?: string }>;
  publish(versionId: string, expectedHash: string, embeddings?: readonly FirestoreKnowledgeEmbedding[]): Promise<{ status: "published" }>;
  disable(sourceId: string, reason: string): Promise<void>;
}
export class FirestoreKnowledgeError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.name = "FirestoreKnowledgeError"; this.code = code; this.status = status; }
}
function reject(code: string, status = 409): never { throw new FirestoreKnowledgeError(code, status); }
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.uuid(), sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const date = z.iso.datetime({ offset: true });
const binding = { schemaVersion: z.literal(1), projectId: z.string(), namespace: z.string() };
const sourceSchema = z.strictObject({ ...binding, sourceId, url: z.url(), activeVersionId: uuid.nullable(), enabled: z.boolean(),
  revision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/), disabledReason: z.string().min(1).max(400).nullable() });
const headerSchema = z.strictObject({ sourceId, url: z.url(), title: z.string().min(1).max(300), publisher: z.string().min(1).max(160),
  classification: z.literal("official_guidance"), sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(),
  sourceDateText: z.string().min(1).max(200).nullable().optional(), validUntil: date.nullable().optional(), fetchedAt: date,
  termsUrl: z.url(), extraction: knowledgeExtractionSchema.optional() });
const versionSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, versionHash: hash, header: headerSchema,
  chunks: z.array(z.strictObject({ chunkId: uuid, key: sourceId, order: z.number().int().min(1).max(32) })).min(1).max(32),
  reviewState: z.enum(["draft", "reviewed", "withdrawn"]), checkedAt: date.nullable(), publishedAt: date.nullable(),
  review: z.strictObject({ assessment: knowledgeReviewAssessmentSchema, assessmentHash: hash, reviewer: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/), reviewedAt: date }).nullable() });
const chunkSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, chunkId: uuid, order: z.number().int().min(1).max(32),
  document: z.custom<KnowledgeChunkInput>(value => Boolean(value && typeof value === "object" && !Array.isArray(value))),
  contentHash: hash, embeddingHash: hash, embedding: z.custom<VectorValue>((value): value is VectorValue => value instanceof VectorValue).nullable(), vectorHash: hash.nullable(),
  model: z.literal(KNOWLEDGE_EMBEDDING.model).nullable(), dimensions: z.literal(KNOWLEDGE_EMBEDDING.dimensions).nullable(),
  pipeline: z.literal(KNOWLEDGE_EMBEDDING.pipeline).nullable() });
type Source = z.infer<typeof sourceSchema>;
type Version = z.infer<typeof versionSchema>;
type Chunk = z.infer<typeof chunkSchema>;
type Loaded = { source: Source; version: Version; chunks: Chunk[]; document: KnowledgeSourceInput };
type Corpus = { sources: (Source | null)[]; editions: Loaded[] };
const MAX_DOCUMENT_BYTES = 900 * 1024, MAX_TRANSACTION_BYTES = 8 * 1024 * 1024;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function deterministicUuid(value: unknown): string {
  const bytes = createHash("sha256").update(JSON.stringify(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const text = bytes.toString("hex"); return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
function vectorValues(raw: readonly number[]): number[] {
  if (!Array.isArray(raw) || raw.length !== KNOWLEDGE_EMBEDDING.dimensions || raw.some(value => !Number.isFinite(value) || Math.abs(value) > 1e10)
    || !raw.some(value => value !== 0)) reject("knowledge_vector_invalid", 400);
  return [...raw];
}
function writeBudget(values: unknown[]): void {
  const sizes = values.map(value => Buffer.byteLength(JSON.stringify(value), "utf8"));
  if (sizes.some(size => size > MAX_DOCUMENT_BYTES) || sizes.reduce((sum, size) => sum + size, 0) > MAX_TRANSACTION_BYTES)
    reject("knowledge_document_too_large", 413);
}
function applies(chunk: KnowledgeChunkInput, filter: KnowledgeFilter): boolean {
  const a = chunk.applicability;
  if (a.region !== filter.region || filter.topics.length && !filter.topics.some(topic => a.topics.includes(topic))) return false;
  if (a.ageBasis === "any" || filter.ageMatch === "unknown") return true;
  if (!filter.age || a.ageBasis !== filter.age.basis) return false;
  const overlap = filter.ageMatch === "overlap", lower = overlap ? filter.age.maxMonths : filter.age.minMonths;
  const upper = overlap ? filter.age.minMonths : filter.age.maxMonths;
  return a.minAgeMonths! <= lower && (a.maxAgeMonthsExclusive ? a.maxAgeMonths! > upper : a.maxAgeMonths! >= upper);
}
function keywordScore(tokens: ReadonlySet<string>, candidate: KnowledgeCandidate): number {
  const matches = (text: string) => {
    const normalized = text.normalize("NFKC").toLowerCase(); let score = 0;
    for (const token of tokens) if (/^[a-z0-9]+$/u.test(token)
      ? new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "u").test(normalized) : normalized.includes(token)) score++;
    return score;
  };
  return matches(candidate.title) * 4 + matches(candidate.section) * 3
    + candidate.keywords.reduce((sum, text) => sum + matches(text) * 5, 0)
    + candidate.applicability.topics.reduce((sum, text) => sum + matches(text) * 4, 0) + matches(candidate.text);
}

/** Selected public official editions only. Maintenance ports are for a trusted operator, never HTTP or Agent tools. */
export function createFirestoreKnowledgeStore(options: FirestoreKnowledgeOptions): FirestoreKnowledgeStore {
  const { database, projectId, namespace } = options;
  if (!database || typeof database.runTransaction !== "function" || !/^[a-z][a-z0-9-]{3,62}$/u.test(projectId)
    || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(namespace) || !Array.isArray(options.sourceIds) || options.sourceIds.length < 1
    || options.sourceIds.length > 10 || options.sourceIds.some(id => !sourceId.safeParse(id).success)
    || new Set(options.sourceIds).size !== options.sourceIds.length) reject("knowledge_configuration_invalid", 400);
  const sourceIds = [...options.sourceIds].sort(compareId), allowed = new Set(sourceIds), scope = { schemaVersion: 1 as const, projectId, namespace };
  const sourceRef = (id: string) => database.collection(namespace + "_knowledge_sources").doc(id);
  const versionRef = (id: string) => database.collection(namespace + "_knowledge_versions").doc(id);
  const chunks = database.collection(namespace + "_knowledge_chunks"), chunkRef = (id: string) => chunks.doc(id);
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value); if (!result.success) reject("knowledge_record_invalid", 503); return result.data;
  }
  function scoped<T extends { projectId: string; namespace: string; sourceId: string }>(value: T): T {
    if (value.projectId !== projectId || value.namespace !== namespace || !allowed.has(value.sourceId)) reject("knowledge_binding_invalid", 503);
    return value;
  }
  async function readSource(tx: Transaction, id: string): Promise<Source | null> {
    const snap = await tx.get(sourceRef(id)); if (!snap.exists) return null;
    const row = scoped(parse(sourceSchema, snap.data())); if (row.sourceId !== id) reject("knowledge_binding_invalid", 503); return row;
  }
  async function load(tx: Transaction, id: string, knownSource?: Source): Promise<Loaded> {
    if (!uuid.safeParse(id).success) reject("knowledge_version_invalid", 400);
    const snapshot = await tx.get(versionRef(id)); if (!snapshot.exists) reject("knowledge_version_unknown", 404);
    const version = scoped(parse(versionSchema, snapshot.data()));
    if (version.versionId !== id || version.header.sourceId !== version.sourceId
      || id !== deterministicUuid([projectId, namespace, "version", version.sourceId, version.versionHash])) reject("knowledge_binding_invalid", 503);
    const source = knownSource ?? await readSource(tx, version.sourceId);
    if (!source || source.sourceId !== version.sourceId || source.url !== version.header.url) reject("knowledge_binding_invalid", 503);
    if (new Set(version.chunks.map(chunk => chunk.key)).size !== version.chunks.length) reject("knowledge_record_invalid", 503);
    const snapshots = await tx.getAll(...version.chunks.map(chunk => chunkRef(chunk.chunkId)));
    const records = snapshots.map((snap, index) => {
      if (!snap.exists) reject("knowledge_chunk_missing", 503);
      const row = scoped(parse(chunkSchema, snap.data())), listed = version.chunks[index]!;
      if (listed.order !== index + 1 || row.order !== listed.order || row.versionId !== id || row.sourceId !== source.sourceId
        || row.chunkId !== listed.chunkId || row.document.key !== listed.key
        || row.chunkId !== deterministicUuid([projectId, namespace, "chunk", id, listed.key])
        || row.contentHash !== knowledgeHash(row.document) || row.embeddingHash !== embeddingDocument(version.header.title, row.document.section, row.document.text).hash)
        reject("knowledge_binding_invalid", 503);
      if (row.embedding !== null) {
        const values = vectorValues(row.embedding.toArray());
        if (row.vectorHash !== knowledgeHash(values) || row.model !== KNOWLEDGE_EMBEDDING.model || row.dimensions !== KNOWLEDGE_EMBEDDING.dimensions
          || row.pipeline !== KNOWLEDGE_EMBEDDING.pipeline) reject("knowledge_vector_binding_invalid", 503);
      } else if ([row.vectorHash, row.model, row.dimensions, row.pipeline].some(value => value !== null)) reject("knowledge_vector_binding_invalid", 503);
      return row;
    });
    let document: KnowledgeSourceInput;
    try { document = parseKnowledgeSource({ ...version.header, chunks: records.map(row => row.document) }); }
    catch { reject("knowledge_record_invalid", 503); }
    if (document.classification !== "official_guidance" || internalKnowledgeSource(document.url) || sourceVersionHash(document) !== version.versionHash)
      reject("knowledge_binding_invalid", 503);
    if (version.review && version.review.assessmentHash !== knowledgeReviewHash(version.review.assessment)) reject("knowledge_review_binding_invalid", 503);
    return { source, version, chunks: records, document };
  }
  function publication(edition: Loaded, now = Date.now()): boolean {
    const { source, version, document } = edition, review = version.review;
    return source.enabled && source.activeVersionId === version.versionId && version.reviewState === "reviewed" && version.checkedAt !== null
      && version.publishedAt !== null && review !== null && review.assessment.decision === "approve" && review.assessment.growthRuleImpact !== "requires_review"
      && (!document.validUntil || Date.parse(document.validUntil) > now) && edition.chunks.every(chunk => chunk.embedding !== null);
  }
  async function corpus(tx: Transaction): Promise<Corpus> {
    const sources: (Source | null)[] = [], editions: Loaded[] = [];
    for (const id of sourceIds) {
      const source = await readSource(tx, id); sources.push(source);
      if (source?.enabled && source.activeVersionId) { const edition = await load(tx, source.activeVersionId, source); if (publication(edition)) editions.push(edition); }
    }
    return { sources, editions };
  }
  async function unchanged(previous: Corpus): Promise<boolean> {
    return database.runTransaction(async tx => {
      for (let index = 0; index < sourceIds.length; index++) {
        const current = await readSource(tx, sourceIds[index]!), old = previous.sources[index];
        if (knowledgeHash(current) !== knowledgeHash(old)) return false;
      }
      for (const edition of previous.editions) {
        const snapshot = await tx.get(versionRef(edition.version.versionId)); if (!snapshot.exists) return false;
        const current = scoped(parse(versionSchema, snapshot.data()));
        if (knowledgeHash(current) !== knowledgeHash(edition.version)) return false;
      }
      return previous.editions.every(edition => publication(edition));
    }, { readOnly: true });
  }
  function candidate(edition: Loaded, chunk: Chunk, filter: KnowledgeFilter): KnowledgeCandidate {
    const { document, version } = edition;
    return { ...chunk.document, chunkId: chunk.chunkId, sourceId: document.sourceId, versionId: version.versionId, versionHash: version.versionHash,
      contentHash: chunk.contentHash, url: document.url, title: document.title, publisher: document.publisher, classification: document.classification,
      sourcePublishedAt: document.sourcePublishedAt, sourceUpdatedAt: document.sourceUpdatedAt, sourceDateText: document.sourceDateText ?? null,
      validUntil: document.validUntil ?? null, fetchedAt: document.fetchedAt, checkedAt: version.checkedAt!, lastSuccessfulCheckAt: null,
      usageScope: "public_noncommercial", reviewState: "reviewed", ...(document.extraction ? { extraction: document.extraction } : {}),
      originalCoverage: chunk.document.originalText ? "chunk_original" : "excerpt_only",
      applicabilityStatus: chunk.document.applicability.ageBasis === "any" ? "applicable"
        : filter.ageMatch === "unknown" ? "requires_clarification" : filter.ageMatch === "overlap" ? "conditional" : "applicable", distance: null };
  }
  function bump(source: Source): Source { return { ...source, revision: (BigInt(source.revision) + 1n).toString() }; }
  return {
    async importSource(input) {
      if (input && typeof input === "object" && ["watch", "watchId", "observation", "audience"].some(key => key in input)) reject("domain_not_ready", 503);
      const document = JSON.parse(JSON.stringify(parseKnowledgeSource(input))) as KnowledgeSourceInput;
      if (!allowed.has(document.sourceId)) reject("knowledge_source_not_configured", 403);
      if (document.classification !== "official_guidance" || internalKnowledgeSource(document.url)) reject("domain_not_ready", 503);
      const versionHash = sourceVersionHash(document), versionId = deterministicUuid([projectId, namespace, "version", document.sourceId, versionHash]);
      const { chunks: inputChunks, ...header } = document;
      const records: Chunk[] = inputChunks.map((chunk, index) => ({ ...scope, sourceId: document.sourceId, versionId,
        chunkId: deterministicUuid([projectId, namespace, "chunk", versionId, chunk.key]), order: index + 1, document: chunk,
        contentHash: knowledgeHash(chunk), embeddingHash: embeddingDocument(document.title, chunk.section, chunk.text).hash,
        embedding: null, vectorHash: null, model: null, dimensions: null, pipeline: null }));
      const version: Version = { ...scope, sourceId: document.sourceId, versionId, versionHash, header: parse(headerSchema, header),
        chunks: records.map(row => ({ chunkId: row.chunkId, key: row.document.key, order: row.order })), reviewState: "draft", checkedAt: null, publishedAt: null, review: null };
      const fresh: Source = { ...scope, sourceId: document.sourceId, url: document.url, enabled: false, activeVersionId: null, revision: "0", disabledReason: null };
      writeBudget([version, fresh, ...records]);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, document.sourceId);
        if (source && source.url !== document.url) reject("knowledge_source_url_changed");
        const prior = await tx.get(versionRef(versionId));
        if (prior.exists) { const old = await load(tx, versionId, source ?? undefined); return { versionId, hash: versionHash, unchanged: true, state: old.version.reviewState }; }
        const existing = await tx.getAll(...records.map(row => chunkRef(row.chunkId)));
        if (existing.some(snapshot => snapshot.exists)) reject("knowledge_binding_invalid", 503);
        if (!source) tx.create(sourceRef(document.sourceId), fresh);
        tx.create(versionRef(versionId), version); for (const row of records) tx.create(chunkRef(row.chunkId), row);
        return { versionId, hash: versionHash, unchanged: false, state: "draft" as const };
      });
    },
    async review(versionId, expectedHash, reviewer, raw) {
      if (!hash.safeParse(expectedHash).success || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(reviewer)) reject("knowledge_review_invalid", 400);
      const assessment = knowledgeReviewAssessmentSchema.parse(raw), assessmentHash = knowledgeReviewHash(assessment), reviewedAt = new Date().toISOString();
      if (assessment.observationHash !== null) reject("domain_not_ready", 503);
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version, document } = edition;
        if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
        if (version.reviewState === "reviewed" && version.review?.assessmentHash === assessmentHash
          && (source.activeVersionId === assessment.comparedVersionId || source.activeVersionId === versionId)) return { status: "reviewed" as const };
        const compared = source.activeVersionId ? await load(tx, source.activeVersionId, source) : null;
        if ((compared?.version.versionId ?? null) !== assessment.comparedVersionId || (compared?.version.versionHash ?? null) !== assessment.comparedHash)
          reject("knowledge_review_baseline_changed");
        validateKnowledgeAssessment(assessment, document, compared?.document ?? null);
        if (version.reviewState === "withdrawn" && document.chunks.some(chunk => !assessment.changes.some(change => change.key === chunk.key)))
          reject("knowledge_withdrawn_full_review_required");
        const approved = assessment.decision === "approve" && assessment.growthRuleImpact !== "requires_review";
        const next: Version = { ...version, reviewState: approved ? "reviewed" : version.reviewState === "draft" ? "draft" : "withdrawn",
          checkedAt: approved ? reviewedAt : version.checkedAt, review: { assessment, assessmentHash, reviewer, reviewedAt } };
        const nextSource = bump(source); writeBudget([next, nextSource]); tx.set(versionRef(versionId), next); tx.set(sourceRef(source.sourceId), nextSource);
        return approved ? { status: "reviewed" as const } : { status: "held" as const, reason: assessment.decision === "hold" ? "operator_hold" : "growth_rules_require_review" };
      });
    },
    async publish(versionId, expectedHash, supplied) {
      if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
      if (supplied && (!Array.isArray(supplied) || supplied.length > 32 || new Set(supplied.map(row => row.chunkKey)).size !== supplied.length)) reject("knowledge_vector_invalid", 400);
      const publishedAt = new Date().toISOString();
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version } = edition, review = version.review;
        if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
        if (version.reviewState !== "reviewed" || !review || review.assessment.decision !== "approve" || review.assessment.growthRuleImpact === "requires_review")
          reject("knowledge_version_unreviewed");
        if (edition.document.validUntil && Date.parse(edition.document.validUntil) <= Date.now()) reject("knowledge_version_expired");
        if (source.activeVersionId !== versionId && source.activeVersionId !== review.assessment.comparedVersionId) reject("knowledge_review_baseline_changed");
        if (review.assessment.comparedVersionId && source.activeVersionId !== versionId) {
          const baseline = await load(tx, review.assessment.comparedVersionId, source);
          if (baseline.version.versionHash !== review.assessment.comparedHash) reject("knowledge_review_baseline_changed");
        }
        if (supplied && supplied.length !== edition.chunks.length) reject("knowledge_vectors_incomplete");
        const updated = edition.chunks.map(chunk => {
          const input = supplied?.find(row => row.chunkKey === chunk.document.key);
          if (!input) { if (chunk.embedding === null) reject("knowledge_vectors_incomplete"); return chunk; }
          if (Object.keys(input).some(key => !["chunkKey", "inputHash", "model", "dimensions", "pipeline", "values"].includes(key))
            || input.inputHash !== chunk.embeddingHash || input.model !== KNOWLEDGE_EMBEDDING.model || input.dimensions !== KNOWLEDGE_EMBEDDING.dimensions
            || input.pipeline !== KNOWLEDGE_EMBEDDING.pipeline) reject("knowledge_vector_binding_invalid", 400);
          const values = vectorValues(input.values), vectorHash = knowledgeHash(values);
          if (chunk.embedding !== null && chunk.vectorHash !== vectorHash) reject("knowledge_vector_conflict");
          return { ...chunk, embedding: FieldValue.vector(values), vectorHash, ...KNOWLEDGE_EMBEDDING };
        });
        if (publication(edition) && updated.every((chunk, index) => chunk.vectorHash === edition.chunks[index]!.vectorHash)) return { status: "published" as const };
        const nextVersion = { ...version, publishedAt: version.publishedAt ?? publishedAt };
        const nextSource = { ...bump(source), activeVersionId: versionId, enabled: true, disabledReason: null };
        writeBudget([nextVersion, nextSource, ...updated]);
        for (const chunk of updated) if (edition.chunks.find(old => old.chunkId === chunk.chunkId)!.embedding === null) tx.set(chunkRef(chunk.chunkId), chunk);
        tx.set(versionRef(versionId), nextVersion); tx.set(sourceRef(source.sourceId), nextSource);
        return { status: "published" as const };
      });
    },
    async disable(id, reason) {
      if (!allowed.has(id) || typeof reason !== "string" || !reason.trim() || reason.length > 400) reject("knowledge_disable_invalid", 400);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, id); if (!source) reject("knowledge_source_unknown", 404);
        const edition = source.activeVersionId ? await load(tx, source.activeVersionId, source) : null;
        const next = { ...bump(source), enabled: false, disabledReason: reason };
        const withdrawn = edition ? { ...edition.version, reviewState: "withdrawn" as const } : null; writeBudget([next, ...(withdrawn ? [withdrawn] : [])]);
        if (withdrawn) tx.set(versionRef(withdrawn.versionId), withdrawn); tx.set(sourceRef(id), next);
      });
    },
    async catalog(afterSourceId = null) {
      if (afterSourceId !== null && !sourceId.safeParse(afterSourceId).success) reject("knowledge_catalog_cursor_invalid", 400);
      return database.runTransaction(async tx => {
        const current = await corpus(tx), eligible = current.editions.filter(edition => afterSourceId === null || edition.source.sourceId > afterSourceId);
        const items = eligible.slice(0, 10).map(({ document, version }) => personalLibraryItemSchema.parse({ sourceId: document.sourceId, versionId: version.versionId,
          title: document.title, publisher: document.publisher, url: document.url, classification: document.classification, checkedAt: version.checkedAt!,
          sourceUpdatedAt: document.sourceUpdatedAt, validUntil: document.validUntil ?? null }));
        return { items, nextSourceId: eligible.length > 10 ? items.at(-1)!.sourceId : null };
      }, { readOnly: true });
    },
    async candidates(input, vector, selection = {}) {
      const filter = parseKnowledgeFilter(input), query = selection.query ? parseKnowledgeQuery(selection.query) : null;
      const values = vector === null ? null : vectorValues(vector);
      if (selection.chunkIds && (!selection.chunkIds.length || selection.chunkIds.length > 6 || new Set(selection.chunkIds).size !== selection.chunkIds.length
        || selection.chunkIds.some(id => !uuid.safeParse(id).success)) || selection.versionId && !uuid.safeParse(selection.versionId).success
        || selection.afterKey && !sourceId.safeParse(selection.afterKey).success) reject("knowledge_selection_invalid", 400);
      const limit = Math.min(selection.limit ?? (query ? 6 : 60), query ? 6 : 60);
      if (!Number.isInteger(limit) || limit < 1) reject("knowledge_selection_invalid", 400);
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await database.runTransaction(tx => corpus(tx), { readOnly: true });
        const eligible: { item: KnowledgeCandidate; chunk: Chunk }[] = [];
        for (const edition of current.editions) {
          if (edition.document.classification !== filter.classification || selection.versionId && edition.version.versionId !== selection.versionId) continue;
          const after = selection.afterKey ? edition.document.chunks.findIndex(chunk => chunk.key === selection.afterKey) : -1;
          if (selection.afterKey && after < 0) continue;
          for (const chunk of edition.chunks) if (chunk.order > after + 1 && applies(chunk.document, filter)
            && (!selection.chunkIds || selection.chunkIds.includes(chunk.chunkId))) eligible.push({ item: candidate(edition, chunk, filter), chunk });
        }
        if (!query) {
          const result = eligible.sort((a, b) => a.chunk.order - b.chunk.order || compareId(a.item.chunkId, b.item.chunkId)).slice(0, limit).map(row => row.item);
          if (await unchanged(current)) return result; continue;
        }
        const byId = new Map(eligible.map(row => [row.item.chunkId, row])), distances = new Map<string, number>();
        if (values !== null) for (const versionId of new Set(eligible.map(row => row.item.versionId))) {
          const ids = eligible.filter(row => row.item.versionId === versionId).map(row => row.item.chunkId);
          for (let start = 0; start < ids.length; start += 30) {
            const nearest = await chunks.where("versionId", "==", versionId).where("chunkId", "in", ids.slice(start, start + 30)).findNearest({
              vectorField: "embedding", queryVector: FieldValue.vector(values), distanceMeasure: "COSINE", limit: 60,
              distanceThreshold: 0.4, distanceResultField: "knowledgeDistance" }).get();
            for (const snapshot of nearest.docs) {
              const { knowledgeDistance: distance, ...raw } = snapshot.data(), row = scoped(parse(chunkSchema, raw)), expected = byId.get(row.chunkId);
              if (!expected || row.versionId !== versionId || row.sourceId !== expected.chunk.sourceId || row.order !== expected.chunk.order
                || row.model !== expected.chunk.model || row.dimensions !== expected.chunk.dimensions || row.pipeline !== expected.chunk.pipeline
                || snapshot.id !== row.chunkId || knowledgeHash(row.document) !== row.contentHash
                || row.contentHash !== expected.chunk.contentHash || row.embeddingHash !== expected.chunk.embeddingHash || row.vectorHash !== expected.chunk.vectorHash
                || row.embedding === null || knowledgeHash(vectorValues(row.embedding.toArray())) !== row.vectorHash
                || !Number.isFinite(distance) || distance < 0 || distance > 2) reject("knowledge_vector_binding_invalid", 503);
              if (distance <= 0.4) distances.set(row.chunkId, distance);
            }
          }
        }
        const vectorTop = eligible.filter(row => distances.has(row.item.chunkId)).sort((a, b) => distances.get(a.item.chunkId)! - distances.get(b.item.chunkId)!
          || compareId(a.item.chunkId, b.item.chunkId)).slice(0, 60);
        const tokens = knowledgeTokens(query, true), keywordTop = eligible.map(row => ({ ...row, score: keywordScore(tokens, row.item) }))
          .filter(row => row.score > 0).sort((a, b) => b.score - a.score || compareId(a.item.chunkId, b.item.chunkId)).slice(0, 60);
        const fused = new Map<string, { item: KnowledgeCandidate; rankScore: number; bestRank: number }>();
        const add = (item: KnowledgeCandidate, rank: number) => {
          const old = fused.get(item.chunkId); if (old) { old.rankScore += 1 / (60 + rank); old.bestRank = Math.min(old.bestRank, rank); }
          else fused.set(item.chunkId, { item, rankScore: 1 / (60 + rank), bestRank: rank });
        };
        vectorTop.forEach((row, index) => add(row.item, index + 1)); keywordTop.forEach((row, index) => add(row.item, index + 1));
        const result = [...fused.values()].sort((a, b) => b.rankScore - a.rankScore || a.bestRank - b.bestRank || compareId(a.item.chunkId, b.item.chunkId))
          .slice(0, limit).map(row => ({ ...row.item, distance: distances.get(row.item.chunkId) ?? null, rankScore: row.rankScore }));
        if (await unchanged(current)) return result;
      }
      return reject("knowledge_publication_changed");
    },
  };
}

export const firestoreKnowledgeSchemas = { source: sourceSchema, version: versionSchema, chunk: chunkSchema } as const;
