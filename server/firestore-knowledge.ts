import { createHash, randomUUID } from "node:crypto";
import { FieldValue, VectorValue, type Firestore, type Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { personalLibraryItemSchema } from "../src/shared/personal-library.ts";
import { embeddingDocument, internalKnowledgeSource, knowledgeChunkInputSchema, knowledgeExtractionSchema, knowledgeHash, parseKnowledgeFilter, parseKnowledgeQuery, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { knowledgeTokens } from "./knowledge-ranking.ts";
import { emptyLexicalHash, knowledgeLexicalIndex, KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS, KNOWLEDGE_LEXICAL_PIPELINE, lexicalBucket, lexicalTokenHash } from "./knowledge-lexical-index.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment, type KnowledgeReviewAssessment } from "./knowledge-review-assessment.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import { checkKnowledgeObservation } from "./knowledge-observation.ts";
import type { FirestoreKnowledgeObservation, FirestoreKnowledgeObservationPort } from "./firestore-knowledge-refresh.ts";

export interface FirestoreKnowledgeOptions { database: Firestore; projectId: string; namespace: string; sourceIds: readonly string[];
  observations?: FirestoreKnowledgeObservationPort; audience?: "public" | "internal" }
export interface FirestoreKnowledgeEmbedding {
  chunkKey: string; inputHash: string; model: string; dimensions: number; pipeline: string; values: readonly number[];
}
export interface FirestoreKnowledgeStore extends Pick<KnowledgeStore, "candidates" | "catalog"> {
  validatePublishedSource(transaction: Transaction, id: string): Promise<void>;
  importSource(input: unknown): Promise<{ versionId: string; hash: string; unchanged: boolean; state: "draft" | "reviewed" | "withdrawn" }>;
  prepareSearch(versionId: string, expectedHash: string): Promise<{ complete: boolean; bucketsCompleted: number; bucketsTotal: number; termCount: number }>;
  listVersions(afterVersionId?: string): Promise<{ items: { id: string; sourceId: string; hash: string; state: string; publishedAt: string | null; searchReady: boolean }[]; nextVersionId: string | null }>;
  missingDocuments(versionId: string): Promise<{ hash: string; title: string; text: string }[]>;
  embedDocument(document: { hash: string; title: string; text: string }, generate: () => Promise<readonly number[]>): Promise<{ reused: boolean }>;
  review(versionId: string, expectedHash: string, reviewer: string, assessment: KnowledgeReviewAssessment,
    expectedObservation?: { sourceId: string; contentHash: string }): Promise<{ status: "reviewed" | "held"; reason?: string }>;
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
  classification: z.enum(["official_guidance", "recent_information"]), sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(),
  sourceDateText: z.string().min(1).max(200).nullable().optional(), validUntil: date.nullable().optional(), fetchedAt: date,
  termsUrl: z.url(), extraction: knowledgeExtractionSchema.optional() });
const versionSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, versionHash: hash, header: headerSchema,
  chunks: z.array(z.strictObject({ chunkId: uuid, key: sourceId, order: z.number().int().min(1).max(32),
    contentHash: hash.optional(), embeddingHash: hash.optional(), applicability: knowledgeChunkInputSchema.shape.applicability.optional() })).min(1).max(32),
  search: z.strictObject({ pipeline: z.literal(KNOWLEDGE_LEXICAL_PIPELINE), hashes: z.array(hash).length(KNOWLEDGE_LEXICAL_BUCKETS),
    completed: z.number().int().min(0).max(KNOWLEDGE_LEXICAL_BUCKETS), termCount: z.number().int().nonnegative() }).optional(),
  reviewState: z.enum(["draft", "reviewed", "withdrawn"]), checkedAt: date.nullable(), publishedAt: date.nullable(),
  review: z.strictObject({ assessment: knowledgeReviewAssessmentSchema, assessmentHash: hash, reviewer: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
    reviewedAt: date, watchRevision: uuid.nullable().optional() }).nullable() });
const chunkSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, chunkId: uuid, order: z.number().int().min(1).max(32),
  document: z.custom<KnowledgeChunkInput>(value => Boolean(value && typeof value === "object" && !Array.isArray(value))),
  contentHash: hash, embeddingHash: hash, embedding: z.custom<VectorValue>((value): value is VectorValue => value instanceof VectorValue).nullable(), vectorHash: hash.nullable(),
  model: z.literal(KNOWLEDGE_EMBEDDING.model).nullable(), dimensions: z.literal(KNOWLEDGE_EMBEDDING.dimensions).nullable(),
  pipeline: z.literal(KNOWLEDGE_EMBEDDING.pipeline).nullable() });
type Source = z.infer<typeof sourceSchema>;
type Version = z.infer<typeof versionSchema>;
type Chunk = z.infer<typeof chunkSchema>;
type Loaded = Edition & { chunks: Chunk[]; document: KnowledgeSourceInput };
type Edition = { source: Source; version: Version; document: Omit<KnowledgeSourceInput, "chunks">; observed: FirestoreKnowledgeObservation | null };
type Corpus = { sources: { id: string; source: Source | null }[]; editions: Edition[] };
const lexicalSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, versionHash: hash, pipeline: z.literal(KNOWLEDGE_LEXICAL_PIPELINE),
  bucket: z.number().int().min(0).max(255), termsHash: hash,
  terms: z.record(hash, z.array(z.strictObject({ chunkId: uuid, score: z.number().int().positive().max(300) })).min(1).max(32)) });
const cachedVectorSchema = z.strictObject({ ...binding, inputHash: hash, model: z.literal(KNOWLEDGE_EMBEDDING.model),
  dimensions: z.literal(KNOWLEDGE_EMBEDDING.dimensions), pipeline: z.literal(KNOWLEDGE_EMBEDDING.pipeline),
  state: z.enum(["running", "ready", "unknown"]), attemptId: uuid, startedAt: date,
  embedding: z.custom<VectorValue>((value): value is VectorValue => value instanceof VectorValue).nullable(), vectorHash: hash.nullable() });
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
function applies(a: KnowledgeChunkInput["applicability"], filter: KnowledgeFilter): boolean {
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
  const allowedId = (id: string) => allowed.has(id) || Boolean(options.observations && sourceIds.some(watchId =>
    id.startsWith(watchId + "-") && /^[a-f0-9]{32}$/u.test(id.slice(watchId.length + 1))));
  const sourceRef = (id: string) => database.collection(namespace + "_knowledge_sources").doc(id);
  const versionRef = (id: string) => database.collection(namespace + "_knowledge_versions").doc(id);
  const chunks = database.collection(namespace + "_knowledge_chunks"), chunkRef = (id: string) => chunks.doc(id);
  const lexicalRef = (versionId: string, bucket: number) => database.collection(namespace + "_knowledge_lexical")
    .doc(deterministicUuid([projectId, namespace, "lexical", KNOWLEDGE_LEXICAL_PIPELINE, versionId, bucket]));
  const vectorRef = (inputHash: string) => database.collection(namespace + "_knowledge_vectors").doc(knowledgeHash([KNOWLEDGE_EMBEDDING, inputHash]));
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value); if (!result.success) reject("knowledge_record_invalid", 503); return result.data;
  }
  function scoped<T extends { projectId: string; namespace: string; sourceId: string }>(value: T): T {
    if (value.projectId !== projectId || value.namespace !== namespace || !allowedId(value.sourceId)) reject("knowledge_binding_invalid", 503);
    return value;
  }
  async function readSource(tx: Transaction, id: string): Promise<Source | null> {
    const snap = await tx.get(sourceRef(id)); if (!snap.exists) return null;
    const row = scoped(parse(sourceSchema, snap.data())); if (row.sourceId !== id) reject("knowledge_binding_invalid", 503); return row;
  }
  async function readVector(tx: Transaction, inputHash: string) {
    const snapshot = await tx.get(vectorRef(inputHash)); if (!snapshot.exists) return null;
    const row = parse(cachedVectorSchema, snapshot.data());
    if (row.projectId !== projectId || row.namespace !== namespace || row.inputHash !== inputHash
      || (row.state === "ready") !== (row.embedding !== null && row.vectorHash !== null)
      || row.embedding !== null && row.vectorHash !== knowledgeHash(vectorValues(row.embedding.toArray()))) reject("knowledge_vector_binding_invalid", 503);
    return row;
  }
  async function metadata(tx: Transaction, id: string, knownSource?: Source): Promise<Edition> {
    if (!uuid.safeParse(id).success) reject("knowledge_version_invalid", 400);
    const snapshot = await tx.get(versionRef(id)); if (!snapshot.exists) reject("knowledge_version_unknown", 404);
    const version = scoped(parse(versionSchema, snapshot.data())), source = knownSource ?? await readSource(tx, version.sourceId);
    if (!source || version.versionId !== id || version.header.sourceId !== version.sourceId || source.sourceId !== version.sourceId
      || source.url !== version.header.url || id !== deterministicUuid([projectId, namespace, "version", version.sourceId, version.versionHash])
      || new Set(version.chunks.map(chunk => chunk.key)).size !== version.chunks.length
      || version.chunks.some((chunk, index) => chunk.order !== index + 1 || chunk.chunkId !== deterministicUuid([projectId, namespace, "chunk", id, chunk.key])))
      reject("knowledge_binding_invalid", 503);
    if (version.review && version.review.assessmentHash !== knowledgeReviewHash(version.review.assessment)) reject("knowledge_review_binding_invalid", 503);
    return { source, version, document: version.header, observed: await options.observations?.read(tx, source.sourceId) ?? null };
  }
  function checkedChunk(edition: Edition, raw: unknown): Chunk {
    const row = scoped(parse(chunkSchema, raw)), listed = edition.version.chunks.find(chunk => chunk.chunkId === row.chunkId);
    const document = parse(knowledgeChunkInputSchema, row.document);
    if (!listed || row.order !== listed.order || row.versionId !== edition.version.versionId || row.sourceId !== edition.source.sourceId
      || row.document.key !== listed.key || row.contentHash !== knowledgeHash(document)
      || row.embeddingHash !== embeddingDocument(edition.document.title, document.section, document.text).hash
      || listed.contentHash !== undefined && listed.contentHash !== row.contentHash
      || listed.embeddingHash !== undefined && listed.embeddingHash !== row.embeddingHash
      || listed.applicability !== undefined && knowledgeHash(listed.applicability) !== knowledgeHash(document.applicability)) reject("knowledge_binding_invalid", 503);
    if (row.embedding !== null) {
      if (row.vectorHash !== knowledgeHash(vectorValues(row.embedding.toArray())) || row.model !== KNOWLEDGE_EMBEDDING.model
        || row.dimensions !== KNOWLEDGE_EMBEDDING.dimensions || row.pipeline !== KNOWLEDGE_EMBEDDING.pipeline) reject("knowledge_vector_binding_invalid", 503);
    } else if ([row.vectorHash, row.model, row.dimensions, row.pipeline].some(value => value !== null)) reject("knowledge_vector_binding_invalid", 503);
    return row;
  }
  async function load(tx: Transaction, id: string, knownSource?: Source): Promise<Loaded> {
    const edition = await metadata(tx, id, knownSource), { version } = edition;
    const snapshots = await tx.getAll(...version.chunks.map(chunk => chunkRef(chunk.chunkId)));
    const records = snapshots.map((snap, index) => {
      if (!snap.exists) reject("knowledge_chunk_missing", 503);
      const row = checkedChunk(edition, snap.data());
      if (row.chunkId !== version.chunks[index]!.chunkId) reject("knowledge_binding_invalid", 503);
      return row;
    });
    let document: KnowledgeSourceInput;
    try { document = parseKnowledgeSource({ ...version.header, chunks: records.map(row => row.document) }); }
    catch { reject("knowledge_record_invalid", 503); }
    if (sourceVersionHash(document) !== version.versionHash) reject("knowledge_binding_invalid", 503);
    return { ...edition, chunks: records, document };
  }
  function observationCurrent(edition: Edition): boolean {
    const context = edition.observed, review = edition.version.review;
    if (!context) return !review?.assessment.observationHash && !review?.watchRevision && edition.document.classification !== "recent_information";
    const observed = context.observation;
    return context.catalogMatches && context.watch.enabled && context.watch.lastStatus !== "unavailable" && observed !== null && !observed.unavailable
      && observed.approved?.contentHash === observed.contentHash && observed.approved?.versionId === edition.version.versionId
      && observed.approved?.watchRevision === context.watch.revision && review?.watchRevision === context.watch.revision
      && review.assessment.observationHash === observed.contentHash;
  }
  function publication(edition: Edition, now = Date.now()): boolean {
    const { source, version, document } = edition, review = version.review;
    return source.enabled && source.activeVersionId === version.versionId && version.reviewState === "reviewed" && version.checkedAt !== null
      && version.publishedAt !== null && review !== null && review.assessment.decision === "approve" && review.assessment.growthRuleImpact !== "requires_review"
      && (!document.validUntil || Date.parse(document.validUntil) > now) && observationCurrent(edition)
      && (options.audience === "internal" || !internalKnowledgeSource(document.url) && edition.observed?.watch.definition.audience !== "internal_noncommercial")
      && (document.classification !== "recent_information" || document.sourcePublishedAt !== null
        && Date.parse(document.sourcePublishedAt) <= now && Date.parse(document.sourcePublishedAt) >= now - 7 * 86400_000
        && Date.parse(edition.observed!.observation!.lastSuccessfulCheckAt) >= now - 86400_000);
  }
  async function corpus(tx: Transaction): Promise<Corpus> {
    const sources: Corpus["sources"] = [], editions: Edition[] = [];
    const selected = [...new Set([...sourceIds, ...await options.observations?.recentSourceIds(tx, sourceIds) ?? []])].sort(compareId);
    for (const id of selected) {
      const source = await readSource(tx, id); sources.push({ id, source });
      if (source?.enabled && source.activeVersionId) { const edition = await metadata(tx, source.activeVersionId, source); if (publication(edition)) editions.push(edition); }
    }
    return { sources, editions };
  }
  async function unchanged(previous: Corpus): Promise<boolean> {
    return database.runTransaction(async tx => {
      for (const old of previous.sources) {
        const current = await readSource(tx, old.id);
        if (knowledgeHash(current) !== knowledgeHash(old.source)) return false;
      }
      for (const edition of previous.editions) {
        const snapshot = await tx.get(versionRef(edition.version.versionId)); if (!snapshot.exists) return false;
        const current = scoped(parse(versionSchema, snapshot.data()));
        if (knowledgeHash(current) !== knowledgeHash(edition.version)) return false;
        const observed = await options.observations?.read(tx, edition.source.sourceId) ?? null;
        if (!publication({ ...edition, observed })) return false;
      }
      return previous.editions.every(edition => publication(edition));
    }, { readOnly: true });
  }
  function candidate(edition: Edition, chunk: Chunk, filter: KnowledgeFilter): KnowledgeCandidate {
    const { document, version } = edition;
    return { ...chunk.document, chunkId: chunk.chunkId, sourceId: document.sourceId, versionId: version.versionId, versionHash: version.versionHash,
      contentHash: chunk.contentHash, url: document.url, title: document.title, publisher: document.publisher, classification: document.classification,
      sourcePublishedAt: document.sourcePublishedAt, sourceUpdatedAt: document.sourceUpdatedAt, sourceDateText: document.sourceDateText ?? null,
      validUntil: document.validUntil ?? null, fetchedAt: document.fetchedAt, checkedAt: version.checkedAt!,
      lastSuccessfulCheckAt: edition.observed?.observation?.lastSuccessfulCheckAt ?? null,
      usageScope: internalKnowledgeSource(document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial" ? "internal_noncommercial" : "public_noncommercial",
      reviewState: "reviewed", ...(document.extraction ? { extraction: document.extraction } : {}),
      originalCoverage: chunk.document.originalText ? "chunk_original" : "excerpt_only",
      applicabilityStatus: chunk.document.applicability.ageBasis === "any" ? "applicable"
        : filter.ageMatch === "unknown" ? "requires_clarification" : filter.ageMatch === "overlap" ? "conditional" : "applicable", distance: null };
  }
  function bump(source: Source): Source { return { ...source, revision: (BigInt(source.revision) + 1n).toString() }; }
  async function prepareSearch(versionId: string, expectedHash: string) {
    if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
    return database.runTransaction(async tx => {
      const edition = await load(tx, versionId), version = edition.version;
      if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
      const index = knowledgeLexicalIndex(edition.document.title, edition.chunks), prior = version.search;
      if (prior && (knowledgeHash(prior.hashes) !== knowledgeHash(index.hashes) || prior.termCount !== index.termCount)) reject("knowledge_search_binding_invalid", 503);
      const start = prior?.completed ?? 0, end = Math.min(start + KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS);
      const next: Version = { ...version, chunks: edition.chunks.map(row => ({ chunkId: row.chunkId, key: row.document.key, order: row.order,
        contentHash: row.contentHash, embeddingHash: row.embeddingHash, applicability: row.document.applicability })),
        search: { pipeline: KNOWLEDGE_LEXICAL_PIPELINE, hashes: index.hashes, completed: end, termCount: index.termCount } };
      const records = index.buckets.slice(start, end).flatMap((terms, offset) => Object.keys(terms).length ? [{ ...scope, sourceId: version.sourceId,
        versionId, versionHash: version.versionHash, pipeline: KNOWLEDGE_LEXICAL_PIPELINE, bucket: start + offset, termsHash: index.hashes[start + offset]!, terms }] : []);
      writeBudget([next, ...records]);
      // Only this trusted method writes derived postings. All source reads precede staged writes.
      for (const row of records) tx.set(lexicalRef(versionId, row.bucket), row);
      if (start !== end || !prior) tx.set(versionRef(versionId), next);
      return { complete: end === KNOWLEDGE_LEXICAL_BUCKETS, bucketsCompleted: end, bucketsTotal: KNOWLEDGE_LEXICAL_BUCKETS, termCount: index.termCount };
    });
  }
  return {
    prepareSearch,
    async listVersions(afterVersionId) {
      if (afterVersionId !== undefined && !uuid.safeParse(afterVersionId).success) reject("knowledge_version_invalid", 400);
      return database.runTransaction(async tx => {
        let query = database.collection(namespace + "_knowledge_versions").orderBy("versionId").limit(21);
        if (afterVersionId) query = query.startAfter(afterVersionId);
        const page = await tx.get(query);
        const items = page.docs.slice(0, 20).flatMap(snapshot => {
          const row = parse(versionSchema, snapshot.data());
          if (snapshot.id !== row.versionId || row.projectId !== projectId || row.namespace !== namespace) reject("knowledge_binding_invalid", 503);
          if (!allowedId(row.sourceId)) return [];
          return { id: row.versionId, sourceId: row.sourceId, hash: row.versionHash, state: row.reviewState, publishedAt: row.publishedAt,
            searchReady: row.search?.completed === KNOWLEDGE_LEXICAL_BUCKETS };
        });
        return { items, nextVersionId: page.size > 20 ? page.docs[19]!.id : null };
      }, { readOnly: true });
    },
    async missingDocuments(versionId) {
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId);
        if (edition.version.reviewState !== "reviewed") reject("knowledge_version_unreviewed");
        const missing = new Map<string, { hash: string; title: string; text: string }>();
        for (const chunk of edition.chunks) if (chunk.embedding === null && (await readVector(tx, chunk.embeddingHash))?.state !== "ready") {
          missing.set(chunk.embeddingHash, embeddingDocument(edition.document.title, chunk.document.section, chunk.document.text));
        }
        return [...missing.values()];
      }, { readOnly: true });
    },
    async embedDocument(document, generate) {
      if (document.hash !== knowledgeHash([document.title, document.text]) || !document.text.trim() || document.text.length > 4000
        || !document.title.trim() || document.title.length > 600) reject("knowledge_vector_invalid", 400);
      const attemptId = randomUUID(), startedAt = new Date().toISOString();
      const claimed = await database.runTransaction(async tx => {
        const saved = await readVector(tx, document.hash);
        if (saved?.state === "ready") return false;
        if (saved) reject("knowledge_embedding_result_unknown");
        tx.create(vectorRef(document.hash), { ...scope, inputHash: document.hash, ...KNOWLEDGE_EMBEDDING,
          state: "running", attemptId, startedAt, embedding: null, vectorHash: null });
        return true;
      });
      if (!claimed) return { reused: true };
      try {
        // External calls never run inside a retryable transaction. Lost results require operator reconciliation.
        const values = vectorValues(await generate());
        await database.runTransaction(async tx => {
          const saved = await readVector(tx, document.hash);
          if (!saved || saved.attemptId !== attemptId || saved.state !== "running") reject("knowledge_embedding_result_unknown");
          tx.set(vectorRef(document.hash), { ...saved, state: "ready", embedding: FieldValue.vector(values), vectorHash: knowledgeHash(values) });
        });
        return { reused: false };
      } catch (error) {
        await database.runTransaction(async tx => {
          const saved = await readVector(tx, document.hash);
          if (saved?.attemptId === attemptId && saved.state === "running") tx.set(vectorRef(document.hash), { ...saved, state: "unknown" });
        });
        throw error;
      }
    },
    async validatePublishedSource(tx, id) {
      if (!allowedId(id)) reject('knowledge_source_unknown', 404);
      const source = await readSource(tx, id);
      if (!source?.enabled || !source.activeVersionId) reject('knowledge_source_unavailable', 409);
      const edition = await metadata(tx, source.activeVersionId, source);
      if (!publication(edition)) reject('knowledge_source_unavailable', 409);
    },
    async importSource(input) {
      if (input && typeof input === "object" && ["watch", "watchId", "observation", "audience"].some(key => key in input)) reject("domain_not_ready", 503);
      const document = JSON.parse(JSON.stringify(parseKnowledgeSource(input))) as KnowledgeSourceInput;
      if (!allowedId(document.sourceId)) reject("knowledge_source_not_configured", 403);
      if (internalKnowledgeSource(document.url) && options.audience !== "internal") reject("knowledge_source_internal_review_required", 403);
      const versionHash = sourceVersionHash(document), versionId = deterministicUuid([projectId, namespace, "version", document.sourceId, versionHash]);
      const { chunks: inputChunks, ...header } = document;
      const records: Chunk[] = inputChunks.map((chunk, index) => ({ ...scope, sourceId: document.sourceId, versionId,
        chunkId: deterministicUuid([projectId, namespace, "chunk", versionId, chunk.key]), order: index + 1, document: chunk,
        contentHash: knowledgeHash(chunk), embeddingHash: embeddingDocument(document.title, chunk.section, chunk.text).hash,
        embedding: null, vectorHash: null, model: null, dimensions: null, pipeline: null }));
      const version: Version = { ...scope, sourceId: document.sourceId, versionId, versionHash, header: parse(headerSchema, header),
        chunks: records.map(row => ({ chunkId: row.chunkId, key: row.document.key, order: row.order, contentHash: row.contentHash,
          embeddingHash: row.embeddingHash, applicability: row.document.applicability })), reviewState: "draft", checkedAt: null, publishedAt: null, review: null };
      const fresh: Source = { ...scope, sourceId: document.sourceId, url: document.url, enabled: false, activeVersionId: null, revision: "0", disabledReason: null };
      writeBudget([version, fresh, ...records]);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, document.sourceId);
        if (!allowed.has(document.sourceId)) {
          const observed = await options.observations!.read(tx, document.sourceId);
          if (!observed?.catalogMatches || !allowed.has(observed.watch.id) || observed.watch.definition.kind !== "rss"
            || observed.observation?.url !== document.url) reject("knowledge_source_not_configured", 403);
        }
        if (source && source.url !== document.url) reject("knowledge_source_url_changed");
        const prior = await tx.get(versionRef(versionId));
        if (prior.exists) { const old = await load(tx, versionId, source ?? undefined); return { versionId, hash: versionHash, unchanged: true, state: old.version.reviewState }; }
        const previous = source?.activeVersionId ? await load(tx, source.activeVersionId, source) : null;
        const compatible = new Map(previous?.chunks.filter(row => row.embedding !== null).map(row => [row.embeddingHash, row]) ?? []);
        const reused = records.map(row => {
          const old = compatible.get(row.embeddingHash);
          return old ? { ...row, embedding: old.embedding, vectorHash: old.vectorHash, model: old.model, dimensions: old.dimensions, pipeline: old.pipeline } : row;
        });
        const existing = await tx.getAll(...records.map(row => chunkRef(row.chunkId)));
        if (existing.some(snapshot => snapshot.exists)) reject("knowledge_binding_invalid", 503);
        writeBudget([version, fresh, ...reused]);
        if (!source) tx.create(sourceRef(document.sourceId), fresh);
        tx.create(versionRef(versionId), version); for (const row of reused) tx.create(chunkRef(row.chunkId), row);
        return { versionId, hash: versionHash, unchanged: false, state: "draft" as const };
      });
    },
    async review(versionId, expectedHash, reviewer, raw, expectedObservation) {
      if (!hash.safeParse(expectedHash).success || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(reviewer)) reject("knowledge_review_invalid", 400);
      const assessment = knowledgeReviewAssessmentSchema.parse(raw), assessmentHash = knowledgeReviewHash(assessment), reviewedAt = new Date().toISOString();
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version, document } = edition;
        if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
        if (expectedObservation && (expectedObservation.sourceId !== source.sourceId || expectedObservation.contentHash !== assessment.observationHash))
          reject("knowledge_observation_review_mismatch");
        const observed = edition.observed;
        if (observed && (!observed.catalogMatches || observed.watch.lastStatus === "unavailable")) reject("knowledge_observation_review_mismatch");
        if (options.audience !== "internal" && (internalKnowledgeSource(document.url) || observed?.watch.definition.audience === "internal_noncommercial")) reject("knowledge_source_internal_review_required", 403);
        const original = observed?.observation ? await options.observations!.content(tx, observed.observation) : null;
        checkKnowledgeObservation(document, observed?.watch, original && observed?.observation ? {
          document: original, content_hash: observed.observation.contentHash, unavailable: observed.observation.unavailable, url: observed.observation.url } : undefined, assessment.observationHash);
        if (version.reviewState === "reviewed" && version.review?.assessmentHash === assessmentHash
          && (version.review.watchRevision ?? null) === (observed?.watch.revision ?? null)
          && (!observed || observationCurrent(edition))
          && (source.activeVersionId === assessment.comparedVersionId || source.activeVersionId === versionId)) return { status: "reviewed" as const };
        const compared = source.activeVersionId ? await load(tx, source.activeVersionId, source) : null;
        if ((compared?.version.versionId ?? null) !== assessment.comparedVersionId || (compared?.version.versionHash ?? null) !== assessment.comparedHash)
          reject("knowledge_review_baseline_changed");
        validateKnowledgeAssessment(assessment, document, compared?.document ?? null);
        if ((version.reviewState === "withdrawn" || version.review && (version.review.watchRevision ?? null) !== (observed?.watch.revision ?? null))
          && document.chunks.some(chunk => !assessment.changes.some(change => change.key === chunk.key)))
          reject("knowledge_withdrawn_full_review_required");
        if (original && assessment.changes.some(change => change.newQuote !== null && !original.text.includes(change.newQuote))) reject("knowledge_review_observation_quote_mismatch");
        const approved = assessment.decision === "approve" && assessment.growthRuleImpact !== "requires_review";
        const next: Version = { ...version, reviewState: approved ? "reviewed" : version.reviewState === "draft" ? "draft" : "withdrawn",
          checkedAt: approved ? reviewedAt : version.checkedAt, review: { assessment, assessmentHash, reviewer, reviewedAt, watchRevision: observed?.watch.revision ?? null } };
        const nextSource = bump(source); writeBudget([next, nextSource]);
        if (approved && observed) options.observations!.approve(tx, observed, versionId, reviewer, reviewedAt);
        tx.set(versionRef(versionId), next); tx.set(sourceRef(source.sourceId), nextSource);
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
        if (version.search?.completed !== KNOWLEDGE_LEXICAL_BUCKETS) reject("knowledge_search_incomplete");
        if (!observationCurrent(edition)) reject("knowledge_observation_review_required");
        if (options.audience !== "internal" && (internalKnowledgeSource(edition.document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial"))
          reject("knowledge_source_internal_review_required", 403);
        if (edition.document.validUntil && Date.parse(edition.document.validUntil) <= Date.now()) reject("knowledge_version_expired");
        if (source.activeVersionId !== versionId && source.activeVersionId !== review.assessment.comparedVersionId) reject("knowledge_review_baseline_changed");
        if (review.assessment.comparedVersionId && source.activeVersionId !== versionId) {
          const baseline = await load(tx, review.assessment.comparedVersionId, source);
          if (baseline.version.versionHash !== review.assessment.comparedHash) reject("knowledge_review_baseline_changed");
        }
        if (supplied?.some(row => !edition.chunks.some(chunk => chunk.document.key === row.chunkKey))) reject("knowledge_vector_binding_invalid", 400);
        const cached = new Map<string, Awaited<ReturnType<typeof readVector>>>();
        for (const chunk of edition.chunks) if (chunk.embedding === null && !supplied?.some(input => input.chunkKey === chunk.document.key)
          && !cached.has(chunk.embeddingHash)) cached.set(chunk.embeddingHash, await readVector(tx, chunk.embeddingHash));
        const updated = edition.chunks.map(chunk => {
          const input = supplied?.find(row => row.chunkKey === chunk.document.key);
          if (!input) {
            if (chunk.embedding !== null) return chunk;
            const saved = cached.get(chunk.embeddingHash);
            if (saved?.state !== "ready") reject("knowledge_vectors_incomplete");
            return { ...chunk, embedding: saved.embedding, vectorHash: saved.vectorHash, ...KNOWLEDGE_EMBEDDING };
          }
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
      if (!allowedId(id) || typeof reason !== "string" || !reason.trim() || reason.length > 400) reject("knowledge_disable_invalid", 400);
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
        const current = await corpus(tx), eligible = current.editions.filter(edition => (afterSourceId === null || edition.source.sourceId > afterSourceId)
          && !internalKnowledgeSource(edition.document.url) && edition.observed?.watch.definition.audience !== "internal_noncommercial");
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
        const eligible = new Map<string, { edition: Edition; manifest: Version["chunks"][number] }>();
        for (const edition of current.editions) {
          if (edition.document.classification !== filter.classification || selection.versionId && edition.version.versionId !== selection.versionId) continue;
          if (edition.version.search?.completed !== KNOWLEDGE_LEXICAL_BUCKETS) reject("knowledge_search_rebuild_required", 503);
          const after = selection.afterKey ? edition.version.chunks.findIndex(chunk => chunk.key === selection.afterKey) : -1;
          if (selection.afterKey && after < 0) continue;
          for (const manifest of edition.version.chunks) {
            if (!manifest.applicability || !manifest.contentHash || !manifest.embeddingHash) reject("knowledge_search_rebuild_required", 503);
            if (manifest.order > after + 1 && applies(manifest.applicability, filter)
              && (!selection.chunkIds || selection.chunkIds.includes(manifest.chunkId))) eligible.set(manifest.chunkId, { edition, manifest });
          }
        }
        async function readCandidates(ids: string[]) {
          if (!ids.length) return new Map<string, KnowledgeCandidate>();
          if (ids.length > 120) reject("knowledge_candidate_limit", 503);
          return database.runTransaction(async tx => {
            const snapshots = await tx.getAll(...ids.map(chunkRef)), result = new Map<string, KnowledgeCandidate>();
            snapshots.forEach((snapshot, index) => {
              const id = ids[index]!, selected = eligible.get(id)!;
              if (!snapshot.exists || snapshot.id !== id) reject("knowledge_chunk_missing", 503);
              const chunk = checkedChunk(selected.edition, snapshot.data());
              if (chunk.chunkId !== id || chunk.embedding === null || !applies(chunk.document.applicability, filter)) reject("knowledge_binding_invalid", 503);
              result.set(id, candidate(selected.edition, chunk, filter));
            });
            return result;
          }, { readOnly: true });
        }
        if (!query) {
          const ids = [...eligible].sort((a, b) => a[1].manifest.order - b[1].manifest.order || compareId(a[0], b[0])).slice(0, limit).map(([id]) => id);
          const result = await readCandidates(ids);
          if (await unchanged(current)) return ids.map(id => result.get(id)!); continue;
        }
        const distances = new Map<string, number>(), scores = new Map<string, number>();
        const tokens = knowledgeTokens(query, true), tokenHashes = [...tokens].map(lexicalTokenHash);
        for (const edition of current.editions) {
          const versionId = edition.version.versionId, ids = [...eligible].filter(([, row]) => row.edition.version.versionId === versionId).map(([id]) => id);
          if (!ids.length) continue;
          // Read only exact token buckets of eligible, published editions. Postings carry IDs/scores, never full bodies.
          const buckets = [...new Set(tokenHashes.map(lexicalBucket))].filter(bucket => edition.version.search!.hashes[bucket] !== emptyLexicalHash);
          if (buckets.length) {
            const bucketScores = await database.runTransaction(async tx => {
            const matches = new Map<string, number>();
            const snapshots = await tx.getAll(...buckets.map(bucket => lexicalRef(versionId, bucket)));
            snapshots.forEach((snapshot, index) => {
              const bucket = buckets[index]!;
              if (!snapshot.exists) reject("knowledge_search_missing", 503);
              const row = scoped(parse(lexicalSchema, snapshot.data()));
              if (row.versionId !== versionId || row.versionHash !== edition.version.versionHash || row.sourceId !== edition.source.sourceId
                || row.bucket !== bucket || row.termsHash !== edition.version.search!.hashes[bucket] || row.termsHash !== knowledgeHash(row.terms)) reject("knowledge_search_binding_invalid", 503);
              for (const token of tokenHashes.filter(hash => lexicalBucket(hash) === bucket)) for (const match of row.terms[token] ?? []) {
                if (!edition.version.chunks.some(chunk => chunk.chunkId === match.chunkId)) reject("knowledge_search_binding_invalid", 503);
                if (eligible.has(match.chunkId)) matches.set(match.chunkId, (matches.get(match.chunkId) ?? 0) + match.score);
              }
            });
            return matches;
          }, { readOnly: true });
            for (const [id, score] of bucketScores) scores.set(id, (scores.get(id) ?? 0) + score);
          }
          if (values === null) continue;
          for (let start = 0; start < ids.length; start += 30) {
            const nearest = await chunks.where("versionId", "==", versionId).where("chunkId", "in", ids.slice(start, start + 30)).findNearest({
              vectorField: "embedding", queryVector: FieldValue.vector(values), distanceMeasure: "COSINE", limit: 60,
              distanceThreshold: 0.4, distanceResultField: "knowledgeDistance" }).get();
            for (const snapshot of nearest.docs) {
              const { knowledgeDistance: distance, ...raw } = snapshot.data(), row = checkedChunk(edition, raw);
              if (!eligible.has(row.chunkId) || row.versionId !== versionId || snapshot.id !== row.chunkId || row.embedding === null
                || !Number.isFinite(distance) || distance < 0 || distance > 2) reject("knowledge_vector_binding_invalid", 503);
              if (distance <= 0.4) distances.set(row.chunkId, distance);
            }
          }
        }
        const vectorTop = [...distances].sort((a, b) => a[1] - b[1] || compareId(a[0], b[0])).slice(0, 60);
        const keywordTop = [...scores].sort((a, b) => b[1] - a[1] || compareId(a[0], b[0])).slice(0, 60);
        const fused = new Map<string, { id: string; rankScore: number; bestRank: number }>();
        const add = (id: string, rank: number) => {
          const old = fused.get(id); if (old) { old.rankScore += 1 / (60 + rank); old.bestRank = Math.min(old.bestRank, rank); }
          else fused.set(id, { id, rankScore: 1 / (60 + rank), bestRank: rank });
        };
        vectorTop.forEach(([id], index) => add(id, index + 1)); keywordTop.forEach(([id], index) => add(id, index + 1));
        const top = [...fused.values()].sort((a, b) => b.rankScore - a.rankScore || a.bestRank - b.bestRank || compareId(a.id, b.id)).slice(0, limit);
        const read = await readCandidates(top.map(row => row.id));
        const result = top.map(row => {
          const item = read.get(row.id)!;
          if (scores.has(row.id) && keywordScore(tokens, item) !== scores.get(row.id)) reject("knowledge_search_binding_invalid", 503);
          return { ...item, distance: distances.get(row.id) ?? null, rankScore: row.rankScore };
        });
        if (await unchanged(current)) return result;
      }
      return reject("knowledge_publication_changed");
    },
  };
}

export const firestoreKnowledgeSchemas = { source: sourceSchema, version: versionSchema, chunk: chunkSchema, lexical: lexicalSchema, vector: cachedVectorSchema } as const;
