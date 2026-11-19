import { EmbeddingAdmissionDeferred } from "./embedding-failure.ts";
import type { PlatformMediaStore } from './firestore-platform-media.ts';
import { createHash, randomUUID } from "node:crypto";
import { FieldPath, FieldValue, VectorValue, type Firestore, type Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { personalLibraryItemSchema, type RegisteredLibrarySource } from "../src/shared/personal-library.ts";
import { embeddingDocument, internalKnowledgeSource, knowledgeChunkInputSchema, knowledgeExtractionSchema, knowledgeHash, parseKnowledgeFilter, parseKnowledgeQuery, parseKnowledgeSource, sourceVersionHash, treatmentContentHash } from "./knowledge-inputs.ts";
import { knowledgeTokens, questionAgeTokens, structuredQueryMatches } from "./knowledge-ranking.ts";
import { emptyLexicalHash, knowledgeLexicalIndex, KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS, KNOWLEDGE_LEXICAL_PIPELINE, lexicalBucket, lexicalTokenHash } from "./knowledge-lexical-index.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment, type KnowledgeReviewAssessment } from "./knowledge-review-assessment.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import { checkKnowledgeObservation, observationHash } from "./knowledge-observation.ts";
import { extractKnowledgePdf } from './knowledge-pdf.ts';
import { parsedKnowledgePdfContent } from './knowledge-source-parser.ts';
import { parseKnowledgeObservation } from './firestore-knowledge-refresh.ts';
import { fullBookletDefinitionHash, matchesPriorPdfRevision, priorBookletWatch, pdfRangeRequest, type PdfRangeRequest } from './knowledge-reviewed-pdf.ts';
import type { FirestoreKnowledgeObservation, FirestoreKnowledgeObservationPort } from "./firestore-knowledge-refresh.ts";
import type { CitedPdf, SavedCitationIdentity } from "./knowledge-cited-pdf.ts";

import { publicMaintenanceWatch, SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { healthServiceDirectory, serviceProfile } from './official-service-directory.ts';
import { needsKnowledgeVector, sourceSeries, sourceSeriesSchema, type SourceSeries, type LibrarySelectionCommand } from '../src/shared/source-series.ts';
import { createLibrarySelections, explicitlyDisabled, selectedEdition, type ListedPlatformCard } from './knowledge-library-selection.ts';
import { checkPortableSeries, familySharingAllowed, portableSeries, portableSeriesSchema, verifyPortableMethod, type PortableSeries } from './knowledge-portable-series.ts';
import { canonical } from './firestore-session-codec.ts';
import { isTimelyEventActive, timelyEventLifecycleSchema } from "../src/shared/knowledge-timely.ts";
import { evaluateTimelyEligibility, timelyRetentionClass } from "./knowledge-timely-policy.ts";
import type { StorageCipher } from './storage-crypto.ts';
import { externalMaterialAllowed } from './platform-materials.ts';

export interface FirestoreKnowledgeOptions { database: Firestore; projectId: string; namespace: string; sourceIds: readonly string[]; cipher?: StorageCipher;
  platformMaterials?: ReadonlyMap<string, { url: string; mediaLinks: string[] }>;
  media?: PlatformMediaStore;
  observations?: FirestoreKnowledgeObservationPort; audience?: "public" | "internal" }
export interface FirestoreKnowledgeEmbedding {
  chunkKey: string; inputHash: string; model: string; dimensions: number; pipeline: string; values: readonly number[];
}
/** Read-only operator material. Redistribution approval belongs to the operator workflow. */
export interface FirestoreKnowledgeEditionExporter {
  exportPublishedEdition(sourceId: string, expectedHash: string, familySeries?: string): Promise<{
    source: KnowledgeSourceInput; versionHash: string; embeddings: FirestoreKnowledgeEmbedding[]; library?: PortableSeries }>;
}
export type FirestoreKnowledgeImportResult = { versionId: string; hash: string; unchanged: boolean; state: "draft" | "reviewed" | "withdrawn" };
/** Operator checkpoint commits with the domain write, after the final transaction read. */
export type FirestoreKnowledgeImportCommit = (tx: Transaction, edition: FirestoreKnowledgeImportResult & { sourceId: string }) => Promise<void>;
/** Trusted operator work participates in the publication transaction, never a model argument. */
export interface FirestoreKnowledgePublicationFence {
  /** A treatment-only draft keeps the old observation binding until atomic publication. */
  treatmentBaseline?: string;
  syncReviewedObservation?: boolean;
  prepare(transaction: Transaction, publication: {
    sourceId: string; versionId: string; versionHash: string; observationHash: string | null;
    previousVersionId: string | null; sourceEnabled: boolean;
  }): Promise<() => void>;
}
export interface TreatmentEdition {
  versionId: string; versionHash: string; state: "draft" | "reviewed" | "withdrawn";
  source: KnowledgeSourceInput; observationHash: string | null;
}
export interface FirestoreKnowledgeStore extends Pick<KnowledgeStore, "candidates" | "catalog"> {
  readonly enforcesPersonalLibrarySelection?: boolean;
  recheckPdfRange(input: PdfRangeRequest, readPdf: (id: string, sha256: string) => Promise<Buffer>): Promise<{ versionId: string; versionHash: string; pageStart: number; pageEnd: number }>;
  citedPdf(citation: SavedCitationIdentity): Promise<CitedPdf | null>;
  mayReadLivePage(userId: string, sourceId: string): Promise<boolean>;
  publishedLiveSeries(sourceId: string, url: string): Promise<SourceSeries | null>;
  catalogForUser(owner: string, afterSourceId: string | null): Promise<Awaited<ReturnType<KnowledgeStore['catalog']>> & { registered?: RegisteredLibrarySource[] }>;
  saveLibraryPreference(tx: Transaction, owner: string, change: LibrarySelectionCommand): Promise<{ revision: number }>;
  platformCards(tx: Transaction, owner: string, after?: string, url?: string): Promise<{ cards: ListedPlatformCard[]; next: string | null }>;
  joinListedPlatformCard(tx: Transaction, owner: string, card: ListedPlatformCard): Promise<{ revision: number }>;
  publishedEdition(sourceId: string): Promise<{ versionId: string; versionHash: string; observationHash: string | null;
    source: KnowledgeSourceInput; enabled: boolean; current: boolean } | null>;
  treatmentEditions(sourceId: string, candidateId?: string, transaction?: Transaction): Promise<{ base: TreatmentEdition; selected: TreatmentEdition }>;
  platformEditions(sourceId: string, candidateId: string, transaction?: Transaction): Promise<{ base: TreatmentEdition | null; selected: TreatmentEdition }>;
  continuationSources(transaction: Transaction, ids: readonly string[]): Promise<import('./agent-work-continuation-core.ts').KnowledgeCurrent[]>;
  validatePublishedSource(transaction: Transaction, id: string): Promise<void>;
  ruleCandidates(transaction: Transaction, rules: readonly { sourceId: string; key: string }[], filter: KnowledgeFilter): Promise<KnowledgeCandidate[]>;
  importSource(input: unknown, commit?: FirestoreKnowledgeImportCommit, library?: PortableSeries): Promise<FirestoreKnowledgeImportResult>;
  prepareSearch(versionId: string, expectedHash: string, guard?: (tx: Transaction) => Promise<void>): Promise<{ complete: boolean; bucketsCompleted: number; bucketsTotal: number; termCount: number }>;
  rebuildSearchPageIn(transaction: Transaction, versionId: string, expectedHash: string, start: number): Promise<{
    complete: boolean; bucketsCompleted: number; bucketsTotal: number; termCount: number }>;
  growthReviewCandidate(versionId: string): Promise<{ versionId: string; hash: string; source: KnowledgeSourceInput; assessment: KnowledgeReviewAssessment }>;
  listVersions(afterVersionId?: string, includeGrowthReview?: boolean): Promise<{ items: { id: string; sourceId: string; hash: string; state: string; publishedAt: string | null; searchReady: boolean; growthRuleReason?: string; comparedVersionId?:string|null }[]; nextVersionId: string | null }>;
  missingDocuments(versionId: string): Promise<{ hash: string; title: string; text: string }[]>;
  embedDocument(document: { hash: string; title: string; text: string }, generate: () => Promise<readonly number[]>): Promise<{ reused: boolean }>;
  review(versionId: string, expectedHash: string, reviewer: string, assessment: KnowledgeReviewAssessment,
    expectedObservation?: { sourceId: string; contentHash: string; verifyWindowedReview?: (tx:Transaction, versionHash:string)=>Promise<boolean> }, treatmentGuard?: (tx: Transaction) => Promise<void>): Promise<{ status: "reviewed" | "held"; reason?: string }>;
  publish(versionId: string, expectedHash: string, embeddings?: readonly FirestoreKnowledgeEmbedding[],
    fence?: FirestoreKnowledgePublicationFence): Promise<{ status: "published" }>;
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
  heldGrowthUpdate: z.strictObject({ previousVersionId: uuid, previousHash: hash, candidateId: uuid, observationHash: hash, observedAt: date, watchRevision: uuid }).optional(),
  revision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/), disabledReason: z.string().min(1).max(400).nullable() });
const headerSchema = z.strictObject({ series: sourceSeriesSchema.optional(), sourceId, url: z.url(), title: z.string().min(1).max(300), publisher: z.string().min(1).max(160),
  classification: z.enum(["official_guidance", "recent_information"]), sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(),
  sourceDateText: z.string().min(1).max(200).nullable().optional(), validUntil: date.nullable().optional(), timelyEvent: timelyEventLifecycleSchema.optional(), fetchedAt: date,
  termsUrl: z.url(), extraction: knowledgeExtractionSchema.optional() });
const versionSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, versionHash: hash, header: headerSchema,
  chunks: z.array(z.strictObject({ chunkId: uuid, key: sourceId, order: z.number().int().min(1).max(32),
    mediaClipHash: hash.optional(), excluded: z.literal(true).optional(), treatment: z.enum(['detailed', 'overview', 'structured', 'excluded']).optional(), contentHash: hash.optional(), embeddingHash: hash.optional(), applicability: knowledgeChunkInputSchema.shape.applicability.optional() })).min(1).max(32),
  imported: z.strictObject({ library: portableSeriesSchema, methodState: z.enum(['not_supplied', 'pending_local_check', 'verified_locally']) }).optional(),
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
type Edition = { source: Source; version: Version; document: Omit<KnowledgeSourceInput, "chunks">; observed: FirestoreKnowledgeObservation | null; permittedClips?: string[] };
type Corpus = { sources: { id: string; source: Source | null }[]; editions: Edition[] };
const lexicalSchema = z.strictObject({ ...binding, sourceId, versionId: uuid, versionHash: hash, pipeline: z.literal(KNOWLEDGE_LEXICAL_PIPELINE),
  bucket: z.number().int().min(0).max(255), termsHash: hash,
  terms: z.record(hash, z.array(z.strictObject({ chunkId: uuid, score: z.number().int().positive().max(300) })).min(1).max(32)) });
const cachedVectorSchema = z.strictObject({ ...binding, inputHash: hash, model: z.literal(KNOWLEDGE_EMBEDDING.model),
  dimensions: z.literal(KNOWLEDGE_EMBEDDING.dimensions), pipeline: z.literal(KNOWLEDGE_EMBEDDING.pipeline),
  state: z.enum(["running", "ready", "unknown", "not_dispatched"]), attemptId: uuid, startedAt: date,
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
    + candidate.applicability.topics.reduce((sum, text) => sum + matches(text) * 4, 0) + matches(candidate.text)
    + (candidate.treatment?.kind === 'structured' ? candidate.treatment.fields.reduce((sum, field) => sum + matches(field.label) * 4 + matches(field.value) * 8, 0) : 0);
}

/** Selected public official editions only. Maintenance ports are for a trusted operator, never HTTP or Agent tools. */
export function createFirestoreKnowledgeStore(options: FirestoreKnowledgeOptions, env: Readonly<Record<string, string | undefined>> = process.env): FirestoreKnowledgeStore & FirestoreKnowledgeEditionExporter {
  // Reader-first rollout: keep this unset on initial deploy. Opt in only when every API,
  // worker, operator and designated rollback revision reads both typed headers and watch hints.
  // After the first typed write, turning the flag off does not migrate durable data for pre-reader binaries.
  const timelyWrites = env.KNOWLEDGE_FIRESTORE_TIMELY_WRITES === "reviewed-v1";
  function requireWritableEdition(document: Omit<KnowledgeSourceInput, 'chunks'>) {
    if (!externalMaterialAllowed(document)) reject('knowledge_transfer_source_binding_invalid', 403);
    if (document.timelyEvent && !timelyWrites) reject("knowledge_timely_writes_disabled");
  }
  const { database, projectId, namespace } = options;
  if (!database || typeof database.runTransaction !== "function" || !/^[a-z][a-z0-9-]{3,62}$/u.test(projectId)
    || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(namespace) || !Array.isArray(options.sourceIds) || options.sourceIds.length < 1
    || options.sourceIds.length > 10 || options.sourceIds.some(id => !sourceId.safeParse(id).success)
    || new Set(options.sourceIds).size !== options.sourceIds.length) reject("knowledge_configuration_invalid", 400);
  const sourceIds = [...options.sourceIds].sort(compareId), allowed = new Set(sourceIds), scope = { schemaVersion: 1 as const, projectId, namespace };
  const allowedId = (id: string) => allowed.has(id) || options.platformMaterials?.has(id) || Boolean(options.observations && sourceIds.some(watchId =>
    id.startsWith(watchId + "-") && /^[a-f0-9]{32}$/u.test(id.slice(watchId.length + 1))));
  const selections = options.cipher ? createLibrarySelections({ database, projectId, namespace, cipher: options.cipher }) : null;
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
    const mediaState = version.chunks.some(row => row.mediaClipHash) ? await options.media?.read(tx, source.sourceId) : undefined;
    return { source, version, document: version.header, observed: await options.observations?.read(tx, source.sourceId) ?? null,
      ...(mediaState ? { permittedClips: mediaState.enabled ? (mediaState.clips ?? []).map(clip => knowledgeHash(clip)) : [] } : {}) };
  }
  function checkedChunk(edition: Edition, raw: unknown): Chunk {
    const row = scoped(parse(chunkSchema, raw)), listed = edition.version.chunks.find(chunk => chunk.chunkId === row.chunkId);
    const document = parse(knowledgeChunkInputSchema, row.document);
    if (!listed || row.order !== listed.order || row.versionId !== edition.version.versionId || row.sourceId !== edition.source.sourceId
      || row.document.key !== listed.key || row.contentHash !== knowledgeHash(document)
      || listed.mediaClipHash !== (document.mediaClip ? knowledgeHash(document.mediaClip) : undefined)
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
  function observationCurrent(edition: Edition, approvedVersionId = edition.version.versionId): boolean {
    const context = edition.observed, review = edition.version.review;
    if (!context) return !review?.assessment.observationHash && !review?.watchRevision && edition.document.classification !== "recent_information";
    const observed = context.observation;
    return context.catalogMatches && context.watch.enabled && !(context.watch.confirmedGone ?? context.watch.lastStatus === "unavailable") && observed !== null && !observed.unavailable
      && observed.approved?.contentHash === observed.contentHash && observed.approved?.versionId === approvedVersionId
      && observed.approved?.watchRevision === context.watch.revision && review?.watchRevision === context.watch.revision
      && review.assessment.observationHash === observed.contentHash;
  }
  function verifiedPdfRange({ observed, document, version }: Edition): boolean {
    const watch = observed?.watch, row = observed?.observation, proof = row?.pdfReadback;
    return !!(proof && watch && row && observed.catalogMatches && watch.enabled && !(watch.confirmedGone ?? watch.lastStatus === 'unavailable')
      && watch.definitionHash === fullBookletDefinitionHash && watch.revision === proof.watchRevision
      && matchesPriorPdfRevision(watch.priorPdfRevision, version.review?.watchRevision, proof.confirmedLegacyExpansion)
      && !row.unavailable && row.url === document.url && row.contentHash === proof.observationHash
      && document.classification === 'official_guidance' && proof.sourceId === document.sourceId && proof.versionId === version.versionId
      && proof.versionHash === version.versionHash && proof.pdfHash === document.extraction?.contentHash && proof.reviewHash === version.review?.assessmentHash);
  }
  function previousPageUnderGrowthReview(edition: Edition) {
    const { source, version, document, observed } = edition, hold = source.heldGrowthUpdate;
    const watch = observed?.watch, row = observed?.observation, approved = row?.approved;
    return !!(hold && watch && row && approved && observed.catalogMatches && watch.enabled && !(watch.confirmedGone ?? watch.lastStatus === "unavailable")
      && !row.unavailable && watch.definition.kind === 'page' && watch.definition.audience === 'public_noncommercial'
      && document.classification === 'official_guidance' && hold.previousVersionId === version.versionId
      && hold.previousHash === version.versionHash && hold.observationHash === row.contentHash && hold.observedAt === row.fetchedAt && hold.watchRevision === watch.revision
      && approved.versionId === version.versionId && approved.contentHash === version.review?.assessment.observationHash
      && approved.watchRevision === watch.revision && version.review.watchRevision === watch.revision);
  }
  function publication(edition: Edition, operation: 'read' | 'publish' = 'publish'): boolean {
    const now = Date.now();
    const { source, version, document } = edition, review = version.review;
    const timely = evaluateTimelyEligibility({
      classification: document.classification,
      sourcePublishedAt: document.sourcePublishedAt,
      validUntil: document.validUntil ?? null,
      lastSuccessfulCheckAt: edition.observed?.observation?.lastSuccessfulCheckAt ?? null,
      timelyEvent: document.timelyEvent,
    }, now);
    return externalMaterialAllowed(document) && source.enabled && source.activeVersionId === version.versionId && version.reviewState === "reviewed" && version.checkedAt !== null
      && version.publishedAt !== null && review !== null && review.assessment.decision === "approve" && review.assessment.growthRuleImpact !== "requires_review"
      && timely.eligible && (observationCurrent(edition) || operation === 'read' && (verifiedPdfRange(edition) || previousPageUnderGrowthReview(edition)
        || Boolean(options.platformMaterials?.has(document.sourceId) && document.classification === 'official_guidance'
        && edition.observed?.catalogMatches && edition.observed.watch.enabled
        && !(edition.observed.watch.confirmedGone ?? edition.observed.watch.lastStatus === 'unavailable')
        && edition.observed.observation && !edition.observed.observation.unavailable
        && edition.observed.watch.revision === review.watchRevision && edition.observed.watch.definition.url === document.url
        && edition.observed.watch.definition.termsUrl === document.termsUrl)))
      && (options.audience === "internal" || !internalKnowledgeSource(document.url) && edition.observed?.watch.definition.audience !== "internal_noncommercial");
  }
  async function catalogIds(tx: Transaction, url?: string) {
    let materialIds: string[] = [];
    if (options.platformMaterials?.size) {
      if (url) materialIds = [...options.platformMaterials].filter(([, item]) => item.url === url).map(([id]) => id);
      else {
        const ids = [...options.platformMaterials.keys()];
        const sources = database.collection(namespace + '_knowledge_sources');
        for (let start = 0; start < ids.length; start += 30) {
          const page = await tx.get(sources.where(FieldPath.documentId(), 'in', ids.slice(start, start + 30)).select('enabled'));
          materialIds.push(...page.docs.filter(doc => doc.get('enabled') === true).map(doc => doc.id));
        }
      }
    }
    return [...new Set([...sourceIds, ...materialIds, ...await options.observations?.recentSourceIds(tx, sourceIds, url) ?? []])].sort(compareId);
  }
  async function corpus(tx: Transaction, selectedIds?: readonly string[]): Promise<Corpus> {
    const sources: Corpus["sources"] = [], editions: Edition[] = [];
    const retained = options.audience === "internal" ? await options.observations?.retainedInternalSourceIds(tx, sourceIds) ?? [] : [];
    const selected = selectedIds ?? [...new Set([...await catalogIds(tx), ...retained])].sort(compareId);
    for (const id of selected) {
      const source = await readSource(tx, id); sources.push({ id, source });
      if (source?.enabled && source.activeVersionId) { const edition = await metadata(tx, source.activeVersionId, source); if (publication(edition, 'read')) editions.push(edition); }
    }
    return { sources, editions };
  }
  const isPublicEdition = (edition: Edition) => !internalKnowledgeSource(edition.document.url)
    && edition.observed?.watch.definition.audience !== 'internal_noncommercial';
  async function activeHeads(tx: Transaction, ids: string[]) {
    if (!ids.length) return [];
    const snapshots = await tx.getAll(...ids.map(sourceRef));
    return snapshots.flatMap(snap => {
      if (!snap.exists) return [];
      const source = scoped(parse(sourceSchema, snap.data()));
      if (source.sourceId !== snap.id) reject('knowledge_binding_invalid', 503);
      return source.enabled && source.activeVersionId && !internalKnowledgeSource(source.url) ? [source] : [];
    });
  }
  async function publicEdition(tx: Transaction, source: Source) {
    const edition = await metadata(tx, source.activeVersionId!, source);
    return isPublicEdition(edition) && publication(edition, 'read') ? edition : null;
  }
  async function seriesEditions(tx: Transaction, seriesId: string) {
    const heads = await activeHeads(tx, await catalogIds(tx));
    if (!heads.length) return [];
    const headers = await tx.getAll(...heads.map(source => versionRef(source.activeVersionId!)),
      { fieldMask: ['header.series', 'header.sourceId', 'header.url'] });
    const members: Edition[] = [];
    for (const [index, snapshot] of headers.entries()) {
      const source = heads[index]!, header = snapshot.get('header');
      if (!header || snapshot.id !== source.activeVersionId || header.sourceId !== source.sourceId || header.url !== source.url)
        reject('knowledge_binding_invalid', 503);
      if (sourceSeries({ sourceId: source.sourceId, url: source.url, series: header.series, title: '' }).id !== seriesId) continue;
      const edition = await publicEdition(tx, source);
      if (edition) members.push(edition);
    }
    return members;
  }
  function readSelections(tx: Transaction, owner?: string) {
    return owner && selections ? selections.read(tx, owner) : [];
  }
  async function personalCorpus(tx: Transaction, owner?: string) {
    const preferences = await readSelections(tx, owner);
    const selectedIds = owner ? [...new Set(preferences.filter(row => row.enabled && row.mode !== 'platform')
      .flatMap(row => row.editions.map(pin => pin.sourceId)))].filter(allowedId).sort(compareId) : undefined;
    const current = await corpus(tx, selectedIds);
    if (!owner) return { ...current, preferences };
    const editions: Edition[] = [];
    for (const active of current.editions) {
      if (!isPublicEdition(active)) continue;
      const { view: choice, snapshotVersionId } = selectedEdition(preferences, selectionEdition(active));
      if (!choice.enabled) continue;
      if (choice.eligible) { editions.push(active); continue; }
      if (!snapshotVersionId) continue;
      const pinned = await metadata(tx, snapshotVersionId, active.source);
      if (pinnedAllowed(pinned, active)) editions.push(pinned);
    }
    return { sources: current.sources, editions, preferences };
  }
  function pinnedAllowed(pinned: Edition, active: Edition) {
    const { version, document } = pinned, watch = active.observed?.watch;
    // The live publication above has already rechecked withdrawal, rights, watch approval and scope.
    // Time-sensitive news needs the currently approved observation. Durable guidance can keep an older reviewed edition.
    return externalMaterialAllowed(document) && version.reviewState === 'reviewed' && !!version.publishedAt && !!version.checkedAt && version.review?.assessment.decision === 'approve'
      && version.review.assessment.growthRuleImpact !== 'requires_review' && document.classification === 'official_guidance'
      && active.document.classification === document.classification && active.document.url === document.url && active.document.termsUrl === document.termsUrl
      && ((version.review.watchRevision ?? null) === (watch?.revision ?? null) || verifiedPdfRange(pinned)) && (!document.validUntil || Date.parse(document.validUntil) > Date.now());
  }
  function candidate(edition: Edition, chunk: Chunk, filter: KnowledgeFilter): KnowledgeCandidate {
    const { document, version } = edition;
    return { ...chunk.document, series: sourceSeries(document), chunkId: chunk.chunkId, sourceId: document.sourceId, versionId: version.versionId, versionHash: version.versionHash,
      contentHash: chunk.contentHash, url: document.url, termsUrl: document.termsUrl, title: document.title, publisher: document.publisher, classification: document.classification,
      sourcePublishedAt: document.sourcePublishedAt, sourceUpdatedAt: document.sourceUpdatedAt, sourceDateText: document.sourceDateText ?? null,
      validUntil: document.validUntil ?? null, ...(document.timelyEvent ? { timelyEvent: document.timelyEvent } : {}), fetchedAt: document.fetchedAt, checkedAt: version.checkedAt!,
      lastSuccessfulCheckAt: edition.observed?.observation?.lastSuccessfulCheckAt ?? null,
      usageScope: internalKnowledgeSource(document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial" ? "internal_noncommercial" : "public_noncommercial",
      reviewState: "reviewed", ...(document.extraction ? { extraction: document.extraction } : {}),
      originalCoverage: chunk.document.originalText && !chunk.document.originalKind ? "chunk_original" : "excerpt_only",
      applicabilityStatus: chunk.document.applicability.ageBasis === "any" ? "applicable"
        : filter.ageMatch === "unknown" ? "requires_clarification" : filter.ageMatch === "overlap" ? "conditional" : "applicable", distance: null };
  }
  function selectionEdition(edition: Edition) {
    const doc = edition.document, series = sourceSeries(doc), extraction = doc.extraction;
    const conditions = edition.version.chunks.map(chunk => chunk.applicability ?? null);
    const registered = edition.observed?.watch.definition;
    const watch = registered && verifiedPdfRange(edition) ? priorBookletWatch(registered) : registered;
    const scopeHash = (watchScope: unknown) => knowledgeHash(canonical([series.institutionId, doc.url, doc.termsUrl, doc.classification,
      watchScope, extraction?.format ?? null, extraction?.pageStart ?? null, extraction?.pageEnd ?? null,
      [...new Set(conditions.map(value => canonical(value)))].sort()]));
    const identity = { sourceId: doc.sourceId, seriesId: series.id, versionId: edition.version.versionId };
    if (!watch) return { ...identity, scopeHash: scopeHash(null) };
    const { title: _title, publisher: _publisher, ...scope } = watch;
    return { ...identity, scopeHash: scopeHash(scope), legacyScopeHash: scopeHash(watch) };
  }
  function bump(source: Source): Source { return { ...source, revision: (BigInt(source.revision) + 1n).toString() }; }
  function writeSearchPageIn(tx: Transaction, edition: Loaded, start: number, repair: boolean) {
    requireWritableEdition(edition.document);
    const version = edition.version, versionId = version.versionId;
    const index = knowledgeLexicalIndex(edition.document.title, edition.chunks), prior = version.search;
    if (prior && (knowledgeHash(prior.hashes) !== knowledgeHash(index.hashes) || prior.termCount !== index.termCount)) reject("knowledge_search_binding_invalid", 503);
    const end = Math.min(start + KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS);
    const next: Version = { ...version, chunks: edition.chunks.map(row => ({ chunkId: row.chunkId, key: row.document.key, order: row.order,
      contentHash: row.contentHash, embeddingHash: row.embeddingHash, applicability: row.document.applicability,
      ...(row.document.mediaClip ? { mediaClipHash: knowledgeHash(row.document.mediaClip) } : {}),
      ...(row.document.treatment?.kind === 'excluded' ? { excluded: true as const } : {}), treatment: row.document.treatment?.kind ?? 'detailed' })),
      search: { pipeline: KNOWLEDGE_LEXICAL_PIPELINE, hashes: index.hashes, completed: Math.max(prior?.completed ?? 0, end), termCount: index.termCount } };
    const records = index.buckets.slice(start, end).flatMap((terms, offset) => Object.keys(terms).length ? [{ ...scope, sourceId: version.sourceId,
      versionId, versionHash: version.versionHash, pipeline: KNOWLEDGE_LEXICAL_PIPELINE, bucket: start + offset, termsHash: index.hashes[start + offset]!, terms }] : []);
    writeBudget([next, ...records]);
    // All source reads precede staged writes. Ordinary preparation still skips empty buckets.
    for (const row of records) tx.set(lexicalRef(versionId, row.bucket), row);
    if (repair) for (let bucket = start; bucket < end; bucket++) {
      if (!Object.keys(index.buckets[bucket]!).length) tx.delete(lexicalRef(versionId, bucket));
    }
    if (start !== end || !prior) tx.set(versionRef(versionId), next);
    return { complete: end === KNOWLEDGE_LEXICAL_BUCKETS, bucketsCompleted: end, bucketsTotal: KNOWLEDGE_LEXICAL_BUCKETS, termCount: index.termCount };
  }
  async function prepareSearch(versionId: string, expectedHash: string, guard?: (tx: Transaction) => Promise<void>) {
    if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
    return database.runTransaction(async tx => {
      const edition = await load(tx, versionId), version = edition.version;
      await guard?.(tx);
      if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
      return writeSearchPageIn(tx, edition, version.search?.completed ?? 0, false);
    });
  }
  async function catalog(afterSourceId: string | null = null, owner?: string) {
    if (afterSourceId !== null && !sourceId.safeParse(afterSourceId).success) reject('knowledge_catalog_cursor_invalid', 400);
    return database.runTransaction(async tx => {
      const preferences = await readSelections(tx, owner);
      const downloaded = new Set(preferences.filter(row => row.mode !== 'platform').flatMap(row => row.editions.map(pin => pin.sourceId)));
      const catalogueOrder = (a: string, b: string) => Number(downloaded.has(b)) - Number(downloaded.has(a)) || compareId(a, b);
      const ids = (await catalogIds(tx)).sort(catalogueOrder).filter(id => afterSourceId === null || catalogueOrder(id, afterSourceId) > 0);
      const visible: Edition[] = [];
      for (let offset = 0; offset < ids.length && visible.length <= 10; offset += 11) {
        const heads = await activeHeads(tx, ids.slice(offset, offset + 11));
        const editions = await Promise.all(heads.map(source => publicEdition(tx, source)));
        visible.push(...editions.filter((edition): edition is Edition => edition !== null));
      }
      const items = await Promise.all(visible.slice(0, 10).map(async edition => {
        const { document, version, observed } = edition, extraction = document.extraction;
        const { view: preference } = selectedEdition(preferences, selectionEdition(edition));
        const pinnedVersion = preference.selectedVersionId && preference.mode === 'fixed'
          ? preference.selectedVersionId === version.versionId ? edition : await metadata(tx, preference.selectedVersionId, edition.source) : null;
        if (!preference.eligible && preference.mode === 'fixed' && preference.selectedVersionId) {
          preference.eligible = !!pinnedVersion && sourceSeries(pinnedVersion.document).id === sourceSeries(document).id && pinnedAllowed(pinnedVersion, edition);
        }
        const media = options.platformMaterials?.has(document.sourceId) ? await options.media?.read(tx, document.sourceId) : undefined;
        return personalLibraryItemSchema.parse({ sourceId: document.sourceId, versionId: version.versionId, versionHash: version.versionHash,
          ...(media ? { media: { enabled: media.enabled, revision: media.revision, links: media.links } } : {}),
          series: sourceSeries(document), ...(owner && selections ? { preference: { ...preference, ...(pinnedVersion ? { selectedVersionHash: pinnedVersion.version.versionHash } : {}) } } : {}),
          title: document.title, publisher: document.publisher, url: document.url, classification: document.classification, checkedAt: version.checkedAt,
          fetchedAt: document.fetchedAt, publishedAt: version.publishedAt, lastCheckedAt: observed?.watch.lastAttemptAt ?? null,
          lastSuccessfulCheckAt: observed?.observation?.lastSuccessfulCheckAt ?? null, topics: [...new Set(version.chunks.flatMap(chunk => chunk.applicability?.topics ?? []))],
          coverage: extraction?.format === 'text_pdf' ? `第 ${extraction.pageStart}–${extraction.pageEnd} 頁 / 共 ${extraction.totalPages ?? '未知'} 頁` : `已收錄 ${version.chunks.length} 個段落`,
          methods: [...(version.chunks.every(row => row.treatment) ? [...new Set(version.chunks.map(row => row.treatment!))].map(kind =>
            ({ detailed: '精細保留', overview: '概括整理', structured: '結構化保存', excluded: '不進問答索引' })[kind] + ' · ' + version.chunks.filter(row => row.treatment === kind).length + ' 段') : []),
            ...(observed?.catalogMatches ? [observed.watch.definition.kind === 'pdf' ? '已登記 PDF 原件讀取' : '已登記網頁讀取'] : []),
            ...(version.imported ? [`ZIP 匯入 · ${({ not_supplied: '沒有附讀法', pending_local_check: '讀法待本機樣本驗證', verified_locally: '本機已核對讀法及原文樣本' })[version.imported.methodState]}`] : [])],
          sourceUpdatedAt: document.sourceUpdatedAt, validUntil: document.validUntil ?? null });
      }));
      const registered: RegisteredLibrarySource[] = [];
      if (owner && afterSourceId === null) for (const watch of SOURCE_WATCHES) {
        const id = watch.id;
        if (!allowed.has(id) || watch.audience !== 'public_noncommercial' || watch.kind === 'rss' || visible.some(edition => edition.source.sourceId === id)) continue;
        const source = await readSource(tx, id);
        if (source?.enabled && source.activeVersionId && await publicEdition(tx, source)) continue;
        const local = await options.observations?.read(tx, id);
        const withdrawn = !!source?.disabledReason || !!local && (!local.catalogMatches || !local.watch.enabled || !!local.observation?.unavailable);
        const series = sourceSeries({ sourceId: id, url: watch.url, title: watch.title ?? id });
        registered.push({ sourceId: id, series,
          publisher: watch.publisher, url: watch.url, kind: watch.kind, status: withdrawn ? 'withdrawn' : source || local?.observation ? 'pending' : 'registered',
          lastCheckedAt: local?.watch.lastAttemptAt ?? null, lastSuccessfulCheckAt: local?.observation?.lastSuccessfulCheckAt ?? null,
          live: false });
      }
      return { items, ...(registered.length ? { registered } : {}), nextSourceId: visible.length > 10 ? items.at(-1)!.sourceId : null };
    }, { readOnly: true });
  }
  const livePage = (id: string) => (allowed.has(healthServiceDirectory.id) && serviceProfile(id))
    || (allowed.has(id) ? SOURCE_WATCHES.find(watch => watch.id === id && watch.kind === 'page' && watch.audience === 'public_noncommercial') : undefined);
  return {
    enforcesPersonalLibrarySelection: selections !== null,
    async mayReadLivePage(userId, id) {
      const registered = livePage(id);
      if (!registered || !userId || !selections) return false;
      return database.runTransaction(async tx => {
        const source = await readSource(tx, id), local = await options.observations?.read(tx, id);
        if (source && (source.url !== registered.url || source.disabledReason !== null || source.activeVersionId && !source.enabled)
          || local && (!local.catalogMatches || !local.watch.enabled || local.watch.definition.url !== registered.url
            || local.watch.definition.audience !== 'public_noncommercial' || local.observation?.unavailable)) return false;
        const active = source?.activeVersionId && source.enabled ? await metadata(tx, source.activeVersionId, source) : null;
        const series = sourceSeries(active?.document ?? { sourceId: id, title: registered.title ?? id, url: registered.url });
        const rows = await selections.read(tx, userId);
        if (id === healthServiceDirectory.id || serviceProfile(id)) return !explicitlyDisabled(rows, series.id);
        if (!active || !publication(active, 'read')) return false;
        const { view } = selectedEdition(rows, selectionEdition(active));
        return view.enabled && view.eligible && view.mode === 'follow';
      }, { readOnly: true });
    },
    async publishedLiveSeries(id, url) {
      const watch = livePage(id);
      if (!watch || watch.url !== url) return null;
      const series = sourceSeries({ sourceId: id, title: watch.title ?? id, url });
      return database.runTransaction(async tx => {
        const current = await corpus(tx);
        const published = current.editions.filter(isPublicEdition);
        const matching = published.find(item => item.document.sourceId === id);
        return matching ? sourceSeries(matching.document) : published.map(item => sourceSeries(item.document)).find(item => item.id === series.id) ?? null;
      }, { readOnly: true });
    },
    async exportPublishedEdition(id, expectedHash, familySeries) {
      if (!allowedId(id)) reject("knowledge_source_not_allowed", 403);
      if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, id);
        if (!source?.enabled || !source.activeVersionId) reject("knowledge_source_unavailable");
        const active = await metadata(tx, source.activeVersionId, source);
        if (!publication(active)) reject("knowledge_source_unavailable");
        if (familySeries && (sourceSeries(active.document).id !== familySeries || !familySharingAllowed(active.document)))
          reject("knowledge_source_not_shareable", 403);
        const isCurrent = active.version.versionHash === expectedHash;
        if (!isCurrent && !familySeries) reject("knowledge_review_version_mismatch");
        const versionId = isCurrent ? source.activeVersionId : deterministicUuid([projectId, namespace, 'version', id, expectedHash]);
        const edition = await load(tx, versionId, source);
        if (!isCurrent && (!pinnedAllowed(edition, active) || !familySharingAllowed(edition.document))) reject("knowledge_source_unavailable");
        // An internal store can inspect restricted editions, but can never transfer them.
        if (internalKnowledgeSource(edition.document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial")
          reject("knowledge_source_internal_export_forbidden", 403);
        const embeddings = edition.chunks.filter(chunk => needsKnowledgeVector(chunk.document.treatment)).map(chunk => {
          if (chunk.embedding === null) reject("knowledge_vectors_incomplete");
          return { chunkKey: chunk.document.key, inputHash: chunk.embeddingHash, ...KNOWLEDGE_EMBEDDING,
            values: vectorValues(chunk.embedding.toArray()) };
        });
        const observation = edition.observed?.observation;
        const body = observation?.approved && options.observations ? await options.observations.content(tx, observation) : null;
        const library = portableSeries(edition.document, edition.observed, body);
        checkPortableSeries(edition.document, library);
        return { source: edition.document, versionHash: edition.version.versionHash, embeddings, library };
      }, { readOnly: true });
    },
    async recheckPdfRange(input, readPdf) {
      const request = pdfRangeRequest.parse(input);
      const { sourceId, versionId, versionHash, pdfHash, observationHash: currentHash } = request;
      const definition = SOURCE_WATCHES.find(w => w.id === sourceId), prior = definition && priorBookletWatch(definition);
      const gate = options.observations, recordReadback = gate?.recordPdfReadback;
      if (!prior || !allowedId(sourceId) || !gate || !recordReadback) reject('knowledge_pdf_range_unavailable');
      // The original store verifies object identity and generation. Reparse outside a retryable transaction.
      const bytes = await readPdf(sourceId, pdfHash);
      const { startPage, endPage } = prior.pdfPages;
      const parsed = await extractKnowledgePdf(bytes, { expectedHash: pdfHash, startPage, pageLimit: endPage - startPage + 1 });
      const old = parseKnowledgeObservation(parsedKnowledgePdfContent(prior, parsed)[0]);
      const oldHash = observationHash(old);
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version, document, observed } = edition;
        const review = version.review, row = observed?.observation, approved = row?.approved;
        if (!source.enabled || source.sourceId !== sourceId || source.activeVersionId !== versionId || version.versionHash !== versionHash
          || !version.publishedAt || !version.checkedAt || version.reviewState !== 'reviewed' || review?.assessment.decision !== 'approve'
          || review.assessment.growthRuleImpact === 'requires_review' || document.validUntil && Date.parse(document.validUntil) <= Date.now()
          || !observed?.catalogMatches || !observed.watch.enabled || (observed.watch.confirmedGone ?? observed.watch.lastStatus === 'unavailable')
          || observed.watch.definitionHash !== fullBookletDefinitionHash || !row || row.watchId !== sourceId || row.url !== prior.url || row.unavailable
          || currentHash !== row.contentHash || !approved || !review.watchRevision || review.watchRevision === observed.watch.revision
          || review.assessment.observationHash !== oldHash) reject('knowledge_pdf_range_unavailable');
        if (approved.versionId === versionId) {
          if (approved.contentHash !== oldHash || approved.watchRevision !== review.watchRevision) reject('knowledge_pdf_range_unavailable');
        } else {
          // An independent review may have approved the successor before its publication has switched the pointer.
          const successor = await metadata(tx, approved.versionId, source), assessment = successor.version.review?.assessment;
          if (!observationCurrent(successor) || successor.version.reviewState !== 'reviewed' || assessment?.decision !== 'approve'
            || assessment.growthRuleImpact === 'requires_review' || assessment.comparedVersionId !== versionId
            || assessment.comparedHash !== versionHash) reject('knowledge_pdf_range_unavailable');
        }
        if (document.chunks.some(c => c.pageStart === undefined || c.pageEnd === undefined || c.pageStart < startPage || c.pageEnd > endPage))
          reject('knowledge_pdf_range_mismatch');
        checkKnowledgeObservation(document, { enabled: true, definition: prior }, { document: old, content_hash: oldHash, url: old.url, unavailable: false }, oldHash);
        const body = await gate.content(tx, row), full = body.extraction;
        if (body.nativeWindowMethod || body.url !== old.url || full?.format !== 'text_pdf' || !full.complete
          || full.contentHash !== pdfHash || full.totalPages !== parsed.totalPages || full.pageStart !== 1 || full.pageEnd !== parsed.totalPages
          || body.pages?.length !== parsed.totalPages || !body.pages.every((p, index) => p.page === index + 1 && p.status === 'text')
          || !parsed.pages.every(page => body.pages![page.page - 1]?.text === page.text))
          reject('knowledge_pdf_range_mismatch');
        await recordReadback(tx, observed, request, review.assessmentHash, review.watchRevision);
        return { versionId, versionHash, pageStart: startPage, pageEnd: endPage };
      });
    },
    async citedPdf(citation) {
      // A historical citation can outlive the active edition. Current source permissions still apply.
      if (!allowedId(citation.sourceId)) return null;
      const policy = publicMaintenanceWatch(citation.sourceId);
      if (policy?.kind !== 'pdf' || policy.url !== citation.url) return null;
      return database.runTransaction(async tx => {
        const source = await readSource(tx, citation.sourceId);
        if (!source?.enabled || !source.activeVersionId) return null;
        const edition = await metadata(tx, citation.versionId, source).catch(error => {
          if (error instanceof FirestoreKnowledgeError && error.code === "knowledge_version_unknown") return null;
          throw error;
        });
        if (!edition) return null;
        const { version, document, observed } = edition;
        if (version.versionHash !== citation.versionHash || !version.publishedAt || version.reviewState !== "reviewed"
          || version.review?.assessment.decision !== "approve" || document.url !== citation.url || internalKnowledgeSource(document.url)
          || document.extraction?.format !== "text_pdf"
          || observed && (!observed.catalogMatches || !observed.watch.enabled || observed.watch.confirmedGone || observed.observation?.unavailable
            || observed.watch.definition.audience !== "public_noncommercial" || observed.watch.definition.termsUrl !== document.termsUrl)) return null;
        if (!version.chunks.some(chunk => chunk.chunkId === citation.chunkId)) return null;
        const snapshot = await tx.get(chunkRef(citation.chunkId));
        if (!snapshot.exists || checkedChunk(edition, snapshot.data()).contentHash !== citation.contentHash) return null;
        return { sourceId: source.sourceId, url: document.url, sha256: document.extraction.contentHash };
      }, { readOnly: true });
    },
    async platformEditions(id, candidateId, transaction) {
      if (!allowedId(id)) reject('knowledge_source_not_allowed', 403);
      const read = async (tx: Transaction) => {
        const selected = await load(tx, candidateId);
        if (selected.source.sourceId !== id || !isPublicEdition(selected)) reject('knowledge_source_not_allowed', 403);
        const active = selected.source.activeVersionId;
        const base = active === candidateId ? selected : active ? await load(tx, active, selected.source) : null;
        const describe = (edition: typeof selected): TreatmentEdition => ({
          versionId: edition.version.versionId, versionHash: edition.version.versionHash, source: edition.document,
          state: edition.version.reviewState, observationHash: edition.observed?.observation?.contentHash ?? null,
        });
        return { base: base && describe(base), selected: describe(selected) };
      };
      return transaction ? read(transaction) : database.runTransaction(read, { readOnly: true });
    },
    async treatmentEditions(id, candidateId, transaction) {
      if (!allowedId(id)) reject("knowledge_source_not_allowed", 403);
      const read = async (tx: Transaction) => {
        const source = await readSource(tx, id);
        if (!source?.enabled || !source.activeVersionId) reject("knowledge_source_unavailable");
        const current = await load(tx, source.activeVersionId, source);
        if (!isPublicEdition(current) || !publication(current)) reject("knowledge_source_unavailable");
        const selected = candidateId && candidateId !== source.activeVersionId ? await load(tx, candidateId) : current;
        if (selected.source.sourceId !== id || !isPublicEdition(selected)) reject("knowledge_source_not_allowed", 403);
        const view = (edition: typeof current): TreatmentEdition => {
          const { version } = edition;
          const needsReview = version.versionId !== current.version.versionId && version.reviewState === 'reviewed'
            && (version.review?.assessment.comparedVersionId !== current.version.versionId
              || version.review.assessment.comparedHash !== current.version.versionHash
              || version.review.assessment.observationHash !== (current.observed?.observation?.contentHash ?? null)
              || version.review.watchRevision !== (current.observed?.watch.revision ?? null));
          return {
            versionId: version.versionId, versionHash: version.versionHash, source: edition.document,
            state: needsReview ? 'draft' : version.reviewState,
            observationHash: edition.observed?.observation?.contentHash ?? null,
          };
        };
        return { base: view(current), selected: view(selected) };
      };
      return transaction ? read(transaction) : database.runTransaction(read, { readOnly:true });
    },
    async publishedEdition(id) {
      if (!allowedId(id)) reject("knowledge_source_not_allowed", 403);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, id);
        if (!source?.activeVersionId) return null;
        const edition = await load(tx, source.activeVersionId, source);
        return { versionId: edition.version.versionId, versionHash: edition.version.versionHash,
          observationHash: edition.version.review?.assessment.observationHash ?? null,
          source: edition.document, enabled: source.enabled, current: publication(edition) };
      }, { readOnly: true });
    },
    prepareSearch,
    async rebuildSearchPageIn(tx, versionId, expectedHash, start) {
      if (!Number.isInteger(start) || start < 0 || start >= KNOWLEDGE_LEXICAL_BUCKETS || start % KNOWLEDGE_LEXICAL_BATCH !== 0)
        reject("knowledge_search_page_invalid", 400);
      if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
      const edition = await load(tx, versionId), version = edition.version;
      if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
      if (version.reviewState !== "reviewed" || !version.review || version.review.assessment.decision !== "approve"
        || version.review.assessment.growthRuleImpact === "requires_review") reject("knowledge_version_unreviewed");
      if (options.audience !== "internal" && (internalKnowledgeSource(edition.document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial"))
        reject("knowledge_source_internal_review_required", 403);
      if (start > (version.search?.completed ?? 0)) reject("knowledge_search_prefix_incomplete");
      return writeSearchPageIn(tx, edition, start, true);
    },
    async growthReviewCandidate(versionId) {
      return database.runTransaction(async tx => {
        const { document, version, observed } = await load(tx, versionId);
        const assessment = version.review?.assessment;
        if (version.reviewState !== "draft" || assessment?.growthRuleImpact !== "requires_review"
          || document.classification !== "official_guidance" || observed?.watch.definition.audience !== "public_noncommercial"
          || observed.watch.definition.kind !== "page" || internalKnowledgeSource(document.url))
          reject("knowledge_growth_review_candidate_unknown", 404);
        return { versionId, hash: version.versionHash, source: document, assessment };
      }, { readOnly: true });
    },
    async listVersions(afterVersionId, includeGrowthReview = false) {
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
            ...(includeGrowthReview && row.review?.assessment.growthRuleImpact === 'requires_review' ? {
              growthRuleReason: row.review.assessment.growthRuleReason, comparedVersionId: row.review.assessment.comparedVersionId } : {}),
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
        for (const chunk of edition.chunks) if (needsKnowledgeVector(chunk.document.treatment) && chunk.embedding === null && (await readVector(tx, chunk.embeddingHash))?.state !== "ready") {
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
        if (saved && saved.state !== "not_dispatched") reject("knowledge_embedding_result_unknown");
        tx.set(vectorRef(document.hash), { ...scope, inputHash: document.hash, ...KNOWLEDGE_EMBEDDING,
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
          if (saved?.attemptId === attemptId && saved.state === "running") tx.set(vectorRef(document.hash), { ...saved, state: error instanceof EmbeddingAdmissionDeferred ? "not_dispatched" : "unknown" });
        });
        throw error;
      }
    },
    async continuationSources(tx, ids) {
      if (ids.length > 4 || new Set(ids).size !== ids.length) reject('knowledge_selection_invalid', 400);
      const result: import('./agent-work-continuation-core.ts').KnowledgeCurrent[] = [];
      for (const sourceId of ids) {
        const source = allowedId(sourceId) ? await readSource(tx, sourceId) : null;
        const edition = source?.enabled && source.activeVersionId ? await metadata(tx, source.activeVersionId, source) : null;
        const active = edition && publication(edition, 'read') && edition.document.classification === 'official_guidance' && !internalKnowledgeSource(edition.document.url);
        result.push(active ? { sourceId, versionId: edition.version.versionId, hash: edition.version.versionHash, available: true, assessment: edition.version.review!.assessment }
          : { sourceId, versionId: null, hash: null, available: false, assessment: null });
      }
      return result;
    },
    async validatePublishedSource(tx, id) {
      if (!allowedId(id)) reject('knowledge_source_unknown', 404);
      const source = await readSource(tx, id);
      if (!source?.enabled || !source.activeVersionId) reject('knowledge_source_unavailable', 409);
      const edition = await metadata(tx, source.activeVersionId, source);
      if (!publication(edition, 'read')) reject('knowledge_source_unavailable', 409);
    },
    async ruleCandidates(tx, rules, input) {
      const filter = parseKnowledgeFilter(input);
      if (rules.length > 8) reject('knowledge_selection_invalid', 400);
      const result: KnowledgeCandidate[] = [];
      for (const rule of rules) {
        if (!allowedId(rule.sourceId)) continue;
        const source = await readSource(tx, rule.sourceId); if (!source?.enabled || !source.activeVersionId) continue;
        const edition = await metadata(tx, source.activeVersionId, source); if (!publication(edition, 'read')) continue;
        const manifest = edition.version.chunks.find(chunk => chunk.key === rule.key);
        if (!manifest || manifest.excluded || manifest.mediaClipHash && !edition.permittedClips?.includes(manifest.mediaClipHash)) continue;
        const snapshot = await tx.get(chunkRef(manifest.chunkId)); if (!snapshot.exists) reject('knowledge_chunk_missing', 503);
        const chunk = checkedChunk(edition, snapshot.data());
        if (applies(chunk.document.applicability, filter)) result.push(candidate(edition, chunk, filter));
      }
      return result;
    },
    async importSource(input, commit, portable) {
      if (input && typeof input === "object" && ["watch", "watchId", "observation", "audience"].some(key => key in input)) reject("domain_not_ready", 503);
      const document = JSON.parse(JSON.stringify(parseKnowledgeSource(input))) as KnowledgeSourceInput;
      if (!allowedId(document.sourceId)) reject("knowledge_source_not_configured", 403);
      const material = options.platformMaterials?.get(document.sourceId);
      if (material && (material.url !== document.url || document.classification !== 'official_guidance'
        || new URL(document.termsUrl).hostname !== new URL(material.url).hostname)) reject('knowledge_transfer_source_binding_invalid', 403);
      if (internalKnowledgeSource(document.url) && options.audience !== "internal") reject("knowledge_source_internal_review_required", 403);
      requireWritableEdition(document);
      const versionHash = sourceVersionHash(document), versionId = deterministicUuid([projectId, namespace, "version", document.sourceId, versionHash]);
      const { chunks: inputChunks, ...header } = document;
      const records: Chunk[] = inputChunks.map((chunk, index) => ({ ...scope, sourceId: document.sourceId, versionId,
        chunkId: deterministicUuid([projectId, namespace, "chunk", versionId, chunk.key]), order: index + 1, document: chunk,
        contentHash: knowledgeHash(chunk), embeddingHash: embeddingDocument(document.title, chunk.section, chunk.text).hash,
        embedding: null, vectorHash: null, model: null, dimensions: null, pipeline: null }));
      const version: Version = { ...scope, sourceId: document.sourceId, versionId, versionHash, header: parse(headerSchema, header),
        chunks: records.map(row => ({ chunkId: row.chunkId, key: row.document.key, order: row.order, contentHash: row.contentHash,
          embeddingHash: row.embeddingHash, applicability: row.document.applicability,
          ...(row.document.mediaClip ? { mediaClipHash: knowledgeHash(row.document.mediaClip) } : {}),
          ...(row.document.treatment?.kind === 'excluded' ? { excluded: true as const } : {}), treatment: row.document.treatment?.kind ?? 'detailed' })), reviewState: "draft", checkedAt: null, publishedAt: null, review: null };
      const fresh: Source = { ...scope, sourceId: document.sourceId, url: document.url, enabled: false, activeVersionId: null, revision: "0", disabledReason: null };
      writeBudget([version, fresh, ...records]);
      return database.runTransaction(async tx => {
        const source = await readSource(tx, document.sourceId);
        const observed = (!allowed.has(document.sourceId) || commit) ? await options.observations?.read(tx, document.sourceId) : undefined;
        if (commit && (internalKnowledgeSource(document.url) || observed?.watch.definition.audience === "internal_noncommercial"))
          reject("knowledge_transfer_internal_source", 403);
        if (!allowed.has(document.sourceId) && !material) {
          if (!observed?.catalogMatches || !allowed.has(observed.watch.id) || observed.watch.definition.kind !== "rss"
            || observed.observation?.url !== document.url) reject("knowledge_source_not_configured", 403);
        }
        if (source && source.url !== document.url) reject("knowledge_source_url_changed");
        const library = portable ? checkPortableSeries(document, portable) : undefined;
        let imported: Version['imported'];
        if (library) {
          const local = library.method ? await options.observations?.read(tx, document.sourceId) ?? null : null;
          const sample = local?.catalogMatches && local.observation && local.watch.definition.audience === 'public_noncommercial' && options.observations
            ? await options.observations.content(tx, local.observation) : null;
          imported = { library, methodState: verifyPortableMethod(library, document, local, sample) };
        }
        const prior = await tx.get(versionRef(versionId));
        if (prior.exists) {
          const old = await load(tx, versionId, source ?? undefined);
          const result = { versionId, hash: versionHash, unchanged: true, state: old.version.reviewState };
          await commit?.(tx, { sourceId: document.sourceId, ...result });
          if (imported && (!old.version.imported || old.version.imported.methodState === 'pending_local_check' && imported.methodState === 'verified_locally'))
            tx.set(versionRef(versionId), { ...old.version, imported });
          return result;
        }
        const previous = source?.activeVersionId ? await load(tx, source.activeVersionId, source) : null;
        const compatible = new Map(previous?.chunks.filter(row => row.embedding !== null).map(row => [row.embeddingHash, row]) ?? []);
        const reused = records.map(row => {
          const old = needsKnowledgeVector(row.document.treatment) ? compatible.get(row.embeddingHash) : null;
          return old ? { ...row, embedding: old.embedding, vectorHash: old.vectorHash, model: old.model, dimensions: old.dimensions, pipeline: old.pipeline } : row;
        });
        const existing = await tx.getAll(...records.map(row => chunkRef(row.chunkId)));
        if (existing.some(snapshot => snapshot.exists)) reject("knowledge_binding_invalid", 503);
        writeBudget([version, fresh, ...reused]);
        const result = { versionId, hash: versionHash, unchanged: false, state: "draft" as const };
        await commit?.(tx, { sourceId: document.sourceId, ...result });
        if (!source) tx.create(sourceRef(document.sourceId), fresh);
        tx.create(versionRef(versionId), imported ? { ...version, imported } : version); for (const row of reused) tx.create(chunkRef(row.chunkId), row);
        return result;
      });
    },
    async review(versionId, expectedHash, reviewer, raw, expectedObservation, treatmentGuard) {
      if (!hash.safeParse(expectedHash).success || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(reviewer)) reject("knowledge_review_invalid", 400);
      const assessment = knowledgeReviewAssessmentSchema.parse(raw), assessmentHash = knowledgeReviewHash(assessment), reviewedAt = new Date().toISOString();
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version, document } = edition;
        requireWritableEdition(document);
        await treatmentGuard?.(tx);
        if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
        if (expectedObservation && (expectedObservation.sourceId !== source.sourceId || expectedObservation.contentHash !== assessment.observationHash))
          reject("knowledge_observation_review_mismatch");
        if (reviewer === "agent-knowledge-maintenance" && version.review?.assessment.decision === "hold")
          return { status: "held" as const, reason: "operator_hold" };
        const observed = edition.observed;
        if (observed && (!observed.catalogMatches || (observed.watch.confirmedGone ?? observed.watch.lastStatus === "unavailable"))) reject("knowledge_observation_review_mismatch");
        if (options.audience !== "internal" && (internalKnowledgeSource(document.url) || observed?.watch.definition.audience === "internal_noncommercial")) reject("knowledge_source_internal_review_required", 403);
        const original = observed?.observation ? await options.observations!.content(tx, observed.observation) : null;
        if (assessment.decision === 'approve' && document.chunks.some(chunk => chunk.mediaClip && (!edition.permittedClips?.includes(knowledgeHash(chunk.mediaClip))
          || !chunk.mediaClip.text.includes(chunk.sourceExcerpt) || chunk.originalText && !chunk.mediaClip.text.includes(chunk.originalText)))) reject('knowledge_media_evidence_changed');
        const windowBaseline = original?.nativeWindowMethod && treatmentGuard && source.activeVersionId
          ? await load(tx, source.activeVersionId, source) : null;
        // Only the original page evidence carries forward. The new treatment still needs its own assessment.
        const retainedWindows = windowBaseline && windowBaseline.version.versionId === assessment.comparedVersionId
          && windowBaseline.version.versionHash === assessment.comparedHash && publication(windowBaseline)
          && treatmentContentHash(document) === treatmentContentHash(windowBaseline.document);
        const checkedWindows = Boolean(original?.nativeWindowMethod &&
          (retainedWindows || assessment.decision === "hold" && version.review?.assessment.observationHash === assessment.observationHash ||
            expectedObservation?.verifyWindowedReview && await expectedObservation.verifyWindowedReview(tx, expectedHash)));
        checkKnowledgeObservation(document, observed?.watch, original && observed?.observation ? {
          document: original, content_hash: observed.observation.contentHash, unavailable: observed.observation.unavailable, url: observed.observation.url } : undefined, assessment.observationHash,checkedWindows);
        if (version.reviewState === "reviewed" && version.review?.assessmentHash === assessmentHash
          && (version.review.watchRevision ?? null) === (observed?.watch.revision ?? null)
          && (!observed || observationCurrent(edition) || treatmentGuard && assessment.comparedVersionId && observationCurrent(edition, assessment.comparedVersionId))
          && (source.activeVersionId === assessment.comparedVersionId || source.activeVersionId === versionId)) return { status: "reviewed" as const };
        const compared = windowBaseline ?? (source.activeVersionId ? await load(tx, source.activeVersionId, source) : null);
        if ((compared?.version.versionId ?? null) !== assessment.comparedVersionId || (compared?.version.versionHash ?? null) !== assessment.comparedHash)
          reject("knowledge_review_baseline_changed");
        validateKnowledgeAssessment(assessment, document, compared?.document ?? null);
        if ((version.reviewState === "withdrawn" || version.review && (version.review.watchRevision ?? null) !== (observed?.watch.revision ?? null))
          && document.chunks.some(chunk => !assessment.changes.some(change => change.key === chunk.key)))
          reject("knowledge_withdrawn_full_review_required");
        if (original && !checkedWindows && assessment.changes.some(change => {
          const clip = document.chunks.find(chunk => chunk.key === change.key)?.mediaClip;
          const evidence = clip && edition.permittedClips?.includes(knowledgeHash(clip)) ? clip.text : original.text;
          return change.newQuote !== null && !evidence.includes(change.newQuote);
        })) reject("knowledge_review_observation_quote_mismatch");
        const approved = assessment.decision === "approve" && assessment.growthRuleImpact !== "requires_review";
        const next: Version = { ...version, reviewState: approved ? "reviewed" : version.reviewState === "draft" ? "draft" : "withdrawn",
          checkedAt: approved ? reviewedAt : version.checkedAt, review: { assessment, assessmentHash, reviewer, reviewedAt, watchRevision: observed?.watch.revision ?? null } };
        const nextSource = bump(source);
        if (nextSource.heldGrowthUpdate?.candidateId === versionId) delete nextSource.heldGrowthUpdate;
        if (reviewer === "agent-knowledge-maintenance" && treatmentGuard && expectedObservation && compared && compared.version.versionId !== versionId
          && assessment.decision === "approve" && assessment.growthRuleImpact === "requires_review"
          && observed?.observation && observed.watch.definition.kind === "page" && observed.watch.definition.audience === "public_noncommercial") {
          nextSource.heldGrowthUpdate = { previousVersionId: compared.version.versionId, previousHash: compared.version.versionHash,
            candidateId: versionId, observationHash: expectedObservation.contentHash, observedAt: observed.observation.fetchedAt, watchRevision: observed.watch.revision };
        }
        writeBudget([next, nextSource]);
        if (approved && observed && !treatmentGuard) options.observations!.approve(tx, observed, versionId, reviewer, reviewedAt);
        tx.set(versionRef(versionId), next); tx.set(sourceRef(source.sourceId), nextSource);
        return approved ? { status: "reviewed" as const } : { status: "held" as const, reason: assessment.decision === "hold" ? "operator_hold" : "growth_rules_require_review" };
      });
    },
    async publish(versionId, expectedHash, supplied, fence) {
      if (!hash.safeParse(expectedHash).success) reject("knowledge_version_invalid", 400);
      if (supplied && (!Array.isArray(supplied) || supplied.length > 32 || new Set(supplied.map(row => row.chunkKey)).size !== supplied.length)) reject("knowledge_vector_invalid", 400);
      const publishedAt = new Date().toISOString();
      return database.runTransaction(async tx => {
        const edition = await load(tx, versionId), { source, version } = edition, review = version.review;
        if (version.versionHash !== expectedHash) reject("knowledge_review_version_mismatch");
        requireWritableEdition(edition.document);
        if (version.reviewState !== "reviewed" || !review || review.assessment.decision !== "approve" || review.assessment.growthRuleImpact === "requires_review")
          reject("knowledge_version_unreviewed");
        if (version.search?.completed !== KNOWLEDGE_LEXICAL_BUCKETS) reject("knowledge_search_incomplete");
        if (version.chunks.some(chunk => chunk.mediaClipHash && !edition.permittedClips?.includes(chunk.mediaClipHash)))
          reject('knowledge_media_evidence_changed');
        const treatmentTransfer = !!edition.observed && !!fence?.treatmentBaseline && source.enabled
          && source.activeVersionId === fence.treatmentBaseline && review.assessment.comparedVersionId === fence.treatmentBaseline
          && observationCurrent(edition, fence.treatmentBaseline);
        const observed = edition.observed;
        const syncedObservation = fence?.syncReviewedObservation && observed?.catalogMatches && observed.watch.enabled
          && !observed.watch.confirmedGone && observed.observation && !observed.observation.unavailable
          && observed.watch.revision === review.watchRevision && observed.observation.contentHash === review.assessment.observationHash;
        if (!observationCurrent(edition) && !treatmentTransfer && !syncedObservation) reject("knowledge_observation_review_required");
        if (options.audience !== "internal" && (internalKnowledgeSource(edition.document.url) || edition.observed?.watch.definition.audience === "internal_noncommercial"))
          reject("knowledge_source_internal_review_required", 403);
        if (edition.document.validUntil && Date.parse(edition.document.validUntil) <= Date.now()) reject("knowledge_version_expired");
        if (isPublicEdition(edition)) {
          const series = sourceSeries(edition.document), members = await seriesEditions(tx, series.id);
          if (members.some(other => other.source.sourceId !== source.sourceId && sourceSeries(other.document).institutionId !== series.institutionId))
            reject('knowledge_series_institution_conflict');
        }
        if (source.activeVersionId !== versionId && source.activeVersionId !== review.assessment.comparedVersionId) reject("knowledge_review_baseline_changed");
        if (review.assessment.comparedVersionId && source.activeVersionId !== versionId) {
          const baseline = await load(tx, review.assessment.comparedVersionId, source);
          if (baseline.version.versionHash !== review.assessment.comparedHash) reject("knowledge_review_baseline_changed");
        }
        if (supplied?.some(row => !edition.chunks.some(chunk => chunk.document.key === row.chunkKey))) reject("knowledge_vector_binding_invalid", 400);
        const cached = new Map<string, Awaited<ReturnType<typeof readVector>>>();
        for (const chunk of edition.chunks) if (needsKnowledgeVector(chunk.document.treatment) && chunk.embedding === null && !supplied?.some(input => input.chunkKey === chunk.document.key)
          && !cached.has(chunk.embeddingHash)) cached.set(chunk.embeddingHash, await readVector(tx, chunk.embeddingHash));
        const updated = edition.chunks.map(chunk => {
          if (!needsKnowledgeVector(chunk.document.treatment)) return chunk;
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
        const commitWork = await fence?.prepare(tx, { sourceId: source.sourceId, versionId, versionHash: version.versionHash,
          observationHash: review.assessment.observationHash, previousVersionId: source.activeVersionId, sourceEnabled: source.enabled });
        // Only an explicitly reviewed, published internal feed edition can enter this bounded lookup.
        // A same-edition operator replay can also restore a missing hint; no observation timestamp is updated.
        if (edition.observed && options.audience === "internal") {
          const lane = timelyRetentionClass(edition.document);
          const retain = (lane === "persistent_until_resolved" || lane === "bounded_by_valid_until") && isTimelyEventActive(edition.document.timelyEvent);
          options.observations!.setRetainedInternalSource(tx, edition.observed, retain ? { until: edition.document.validUntil ?? null } : null);
        }
        // Already published is an identity check, not a claim that a stale or resolved edition is retrievable.
        if (source.enabled && source.activeVersionId === versionId && version.publishedAt !== null && version.checkedAt !== null
          && observationCurrent(edition) && updated.every((chunk, index) => chunk.vectorHash === edition.chunks[index]!.vectorHash)) {
          commitWork?.(); return { status: "published" as const };
        }
        if (treatmentTransfer || syncedObservation) options.observations!.approve(tx,edition.observed!,versionId,review.reviewer,publishedAt);
        const nextVersion = { ...version, publishedAt: version.publishedAt ?? publishedAt };
        const nextSource = { ...bump(source), activeVersionId: versionId, enabled: true, disabledReason: null };
        delete nextSource.heldGrowthUpdate;
        writeBudget([nextVersion, nextSource, ...updated]);
        for (const chunk of updated) if (edition.chunks.find(old => old.chunkId === chunk.chunkId)!.embedding === null) tx.set(chunkRef(chunk.chunkId), chunk);
        tx.set(versionRef(versionId), nextVersion); tx.set(sourceRef(source.sourceId), nextSource);
        commitWork?.();
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
        if (options.audience === "internal" && edition?.observed) options.observations!.setRetainedInternalSource(tx, edition.observed, null);
        if (withdrawn) tx.set(versionRef(withdrawn.versionId), withdrawn); tx.set(sourceRef(id), next);
      });
    },
    catalog: after => catalog(after), catalogForUser: (owner, after) => catalog(after, owner),
    async platformCards(tx, owner, after, url) {
      // Ordinary private sites cannot appear in the public catalogue.
      if (url && !personalLibraryItemSchema.shape.url.safeParse(url).success) return { cards: [], next: null };
      const exact = url ? new URL(url).href.split('#')[0] : undefined;
      const ids = (await catalogIds(tx, exact)).filter(id => !after || id > after);
      const limit = 5;
      const heads = await activeHeads(tx, exact ? ids : ids.slice(0, limit));
      const matches = exact ? heads.filter(source => new URL(source.url).href.split('#')[0] === exact) : heads;
      const cards = new Map<string, ListedPlatformCard>();
      const preferences = matches.length ? await readSelections(tx, owner) : [];
      for (const source of matches) {
        const edition = await publicEdition(tx, source);
        if (!edition) continue;
        const series = sourceSeries(edition.document), pref = preferences.find(row => row.seriesId === series.id);
        if (!cards.has(series.id)) cards.set(series.id, { seriesId: series.id, name: series.name, publisher: edition.document.publisher,
          mode: pref?.mode ?? 'platform', enabled: pref?.enabled ?? true, revision: pref?.revision ?? 0,
          sourceId: source.sourceId, versionId: edition.version.versionId });
        if (exact && cards.size === limit) return { cards: [...cards.values()], next: source.sourceId };
      }
      return { cards: [...cards.values()], next: !exact && ids.length > limit ? ids[limit - 1]! : null };
    },
    async joinListedPlatformCard(tx, owner, card) {
      if (!selections) reject('knowledge_preferences_unavailable', 503);
      const editions = (await seriesEditions(tx, card.seriesId)).map(selectionEdition);
      if (!editions.some(row => row.sourceId === card.sourceId && row.versionId === card.versionId)) reject('library_selection_changed');
      return selections.save(tx, owner, { action: 'join', seriesId: card.seriesId, expectedRevision: card.revision, editions }, editions);
    },
    async saveLibraryPreference(tx, owner, change) {
      if (!selections) reject('knowledge_preferences_unavailable', 503);
      const publicEditions = await seriesEditions(tx, change.seriesId);
      if (change.wholeSeries) {
        const members = publicEditions.map(selectionEdition);
        if (!change.editions.every(pin => members.some(m => m.sourceId === pin.sourceId && m.versionId === pin.versionId))) reject('library_selection_changed');
        return selections.save(tx, owner, { ...change, editions: members }, members);
      }
      if ('action' in change || !change.imported) return selections.save(tx, owner, change, publicEditions.map(selectionEdition));
      const resolved = [];
      for (const ref of change.editions) {
        const active = publicEditions.find(item => item.source.sourceId === ref.sourceId);
        if (!active || !ref.versionHash || sourceSeries(active.document).id !== change.seriesId) reject('knowledge_reference_unavailable', 409);
        const id = deterministicUuid([projectId, namespace, 'version', ref.sourceId, ref.versionHash]);
        const pinned = id === active.version.versionId ? active : await metadata(tx, id, active.source);
        if (id !== active.version.versionId && !pinnedAllowed(pinned, active)) reject('knowledge_reference_unavailable', 409);
        resolved.push(selectionEdition(pinned));
      }
      return selections.save(tx, owner, { ...change, adopt: true, mode: 'fixed', editions: resolved }, resolved);
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
        const owner = selection.libraryUserId;
        const readCorpus = () => database.runTransaction(tx => personalCorpus(tx, owner), { readOnly: true });
        const current = await readCorpus();
        const stillCurrent = async () => canonical(await readCorpus()) === canonical(current);
        const eligible = new Map<string, { edition: Edition; manifest: Version["chunks"][number] }>();
        for (const edition of current.editions) {
          if (edition.document.classification !== filter.classification || selection.versionId && edition.version.versionId !== selection.versionId) continue;
          if (edition.version.search?.completed !== KNOWLEDGE_LEXICAL_BUCKETS) reject("knowledge_search_rebuild_required", 503);
          const after = selection.afterKey ? edition.version.chunks.findIndex(chunk => chunk.key === selection.afterKey) : -1;
          if (selection.afterKey && after < 0) continue;
          for (const manifest of edition.version.chunks) {
            if (!manifest.applicability || !manifest.contentHash || !manifest.embeddingHash) reject("knowledge_search_rebuild_required", 503);
            if (manifest.mediaClipHash && !edition.permittedClips?.includes(manifest.mediaClipHash)) continue;
            if (!manifest.excluded && manifest.order > after + 1 && applies(manifest.applicability, filter)
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
              if (chunk.chunkId !== id || (needsKnowledgeVector(chunk.document.treatment) && chunk.embedding === null) || !applies(chunk.document.applicability, filter)) reject("knowledge_binding_invalid", 503);
              result.set(id, candidate(selected.edition, chunk, filter));
            });
            return result;
          }, { readOnly: true });
        }
        if (!query) {
          const ids = [...eligible].sort((a, b) => a[1].manifest.order - b[1].manifest.order || compareId(a[0], b[0])).slice(0, limit).map(([id]) => id);
          const result = await readCandidates(ids);
          if (await stillCurrent()) return ids.map(id => result.get(id)!); continue;
        }
        const distances = new Map<string, number>(), scores = new Map<string, number>();
        const tokens = knowledgeTokens(query, true), tokenHashes = [...tokens].map(lexicalTokenHash);
        const ageTokens = questionAgeTokens(query), ageHashes = new Set([...ageTokens].map(lexicalTokenHash));
        const topicHashes = new Set(tokenHashes), searchHashes = [...new Set([...tokenHashes, ...ageHashes])];
        for (const edition of current.editions) {
          const versionId = edition.version.versionId, ids = [...eligible].filter(([, row]) => row.edition.version.versionId === versionId).map(([id]) => id);
          if (!ids.length) continue;
          // Read only exact token buckets of eligible, published editions. Postings carry IDs/scores, never full bodies.
          const buckets = [...new Set(searchHashes.map(lexicalBucket))].filter(bucket => edition.version.search!.hashes[bucket] !== emptyLexicalHash);
          if (buckets.length) {
            const bucketScores = await database.runTransaction(async tx => {
            const matches = new Map<string, number>(), ageMatches = new Map<string, number>();
            const snapshots = await tx.getAll(...buckets.map(bucket => lexicalRef(versionId, bucket)));
            snapshots.forEach((snapshot, index) => {
              const bucket = buckets[index]!;
              if (!snapshot.exists) reject("knowledge_search_missing", 503);
              const row = scoped(parse(lexicalSchema, snapshot.data()));
              if (row.versionId !== versionId || row.versionHash !== edition.version.versionHash || row.sourceId !== edition.source.sourceId
                || row.bucket !== bucket || row.termsHash !== edition.version.search!.hashes[bucket] || row.termsHash !== knowledgeHash(row.terms)) reject("knowledge_search_binding_invalid", 503);
              for (const token of searchHashes.filter(hash => lexicalBucket(hash) === bucket)) for (const match of row.terms[token] ?? []) {
                if (!edition.version.chunks.some(chunk => chunk.chunkId === match.chunkId)) reject("knowledge_search_binding_invalid", 503);
                if (eligible.has(match.chunkId)) {
                  if (topicHashes.has(token)) matches.set(match.chunkId, (matches.get(match.chunkId) ?? 0) + match.score);
                  if (ageHashes.has(token)) ageMatches.set(match.chunkId, (ageMatches.get(match.chunkId) ?? 0) + match.score);
                }
              }
            });
            // Age tokens refine only substantive topic matches, never create retrieval hits.
            for (const [id, score] of matches) matches.set(id, score + (ageMatches.get(id) ?? 0));
            return matches;
          }, { readOnly: true });
            for (const [id, score] of bucketScores) scores.set(id, (scores.get(id) ?? 0) + score);
          }
          if (values === null) continue;
          const vectorIds = ids.filter(id => eligible.get(id)!.manifest.treatment !== 'structured');
          for (let start = 0; start < vectorIds.length; start += 30) {
            const nearest = await chunks.where("versionId", "==", versionId).where("chunkId", "in", vectorIds.slice(start, start + 30)).findNearest({
              vectorField: "embedding", queryVector: FieldValue.vector(values), distanceMeasure: "COSINE", limit: 60,
              distanceThreshold: 0.4, distanceResultField: "knowledgeDistance" }).get();
            for (const snapshot of nearest.docs) {
              const { knowledgeDistance: distance, ...raw } = snapshot.data(), row = checkedChunk(edition, raw);
              if (!eligible.has(row.chunkId) || row.versionId !== versionId || snapshot.id !== row.chunkId || row.embedding === null
                || !Number.isFinite(distance) || distance < 0 || distance > 2) reject("knowledge_vector_binding_invalid", 503);
              if (distance <= 0.4 && row.document.treatment?.kind !== 'structured') distances.set(row.chunkId, distance);
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
        const top = [...fused.values()].sort((a, b) => b.rankScore - a.rankScore || a.bestRank - b.bestRank || compareId(a.id, b.id));
        const result: KnowledgeCandidate[] = [];
        for (let offset = 0; offset < top.length && result.length < limit; offset += limit) {
          const page = top.slice(offset, offset + limit);
          const read = await readCandidates(page.map(row => row.id));
          for (const row of page) {
            const item = read.get(row.id)!;
            const topicScore = keywordScore(tokens, item);
            if (scores.has(row.id) && (topicScore === 0 || topicScore + keywordScore(ageTokens, item) !== scores.get(row.id))) reject("knowledge_search_binding_invalid", 503);
            if (structuredQueryMatches(query, item.treatment)) result.push({ ...item, distance: distances.get(row.id) ?? null, rankScore: row.rankScore });
            if (result.length === limit) break;
          }
        }
        if (await stillCurrent()) return result;
      }
      return reject("knowledge_publication_changed");
    },
  };
}

export const firestoreKnowledgeSchemas = { source: sourceSchema, version: versionSchema, chunk: chunkSchema, lexical: lexicalSchema, vector: cachedVectorSchema } as const;


