import { feedingBookletId, fullBookletDefinitionHash, matchesPriorPdfRevision, selectedBookletDefinitionHash, pdfReadMethod, pdfReadback, type PdfRangeRequest } from './knowledge-reviewed-pdf.ts';
import { randomUUID } from "node:crypto";
import { createFirestoreKnowledgeOriginals, type KnowledgeOriginalBucket } from "./firestore-knowledge-originals.ts";
import { FieldPath, type Firestore, type Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import { knowledgeExtractionSchema, knowledgeHash } from "./knowledge-inputs.ts";
import { definitionHash, observationHash, observationId } from "./knowledge-observation.ts";
import { refreshJobSchema, type ObservedContent, type RefreshJob, type SourceFetcher, type SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import { adminKnowledgeStatusSchema, knowledgeCheckStatus, pdfEditionReviewSchema, type AdminKnowledgeStatus } from '../src/shared/admin.ts';
import { domainReject } from './firestore-domain-data.ts';
import { TIMELY_KNOWLEDGE_POLICY_DEFAULTS } from "./knowledge-timely-policy.ts";
import { createPlatformMediaStore } from './firestore-platform-media.ts';
import { campaignMaterialWatches } from './platform-materials.ts';

const campaignSources = new Set(campaignMaterialWatches.map(source => source.id));

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.iso.datetime({ offset: true });
const binding = { schemaVersion: z.literal(1), projectId: z.string(), namespace: z.string() };
const definitionSchema = z.strictObject({ id, url: z.url(), kind: z.enum(["page", "rss", "pdf"]), title: z.string().max(300).optional(),
  leafletPage: z.url().optional(),
  pdfPages: z.strictObject({ startPage: z.number().int().positive(), endPage: z.number().int().positive() }).optional(),
  classification: z.enum(["official_guidance", "recent_information"]), publisher: z.string().min(1).max(160), termsUrl: z.url(),
  audience: z.enum(["public_noncommercial", "internal_noncommercial"]), itemHosts: z.array(z.string().min(1).max(255)).max(8).optional(),
  selector: z.string().min(1).max(500).optional() });
const bodySchema: z.ZodType<ObservedContent> = z.strictObject({ url: z.url(), title: z.string().min(1).max(300),
  text: z.string().max(256020).refine(text => text.isWellFormed()), nativeWindowMethod: z.literal("native-pdf-window/1").optional(), sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(),
  sourceDateText: z.string().max(200).nullable(), extraction: knowledgeExtractionSchema.optional(),
  rssItem: z.strictObject({ xml: z.string().min(1).max(48000), copyright: z.string().min(1).max(160) }).optional(),
  pages: z.array(z.strictObject({ page: z.number().int().positive(), text: z.string().max(32000), status: z.enum(["text", "empty", "unreadable"]) })).max(32).optional() }).refine(doc => doc.nativeWindowMethod
    ? !doc.pages && doc.text === "" && doc.extraction?.format === "text_pdf" && doc.extraction.complete === false
      && doc.extraction.pageStart === 1 && doc.extraction.pageEnd === doc.extraction.totalPages
    : doc.text.length > 0);
/** Hash the same normalized representation that the durable observation stores. */
export function parseKnowledgeObservation(input: unknown): ObservedContent { return bodySchema.parse(input); }
// Bounded lookup hints, not evidence of freshness, approval, applicability or rights.
const MAX_RETAINED_PER_FEED = 60;
const watchSchema = z.strictObject({ ...binding, id, definition: definitionSchema, definitionHash: hash, revision: z.uuid(), enabled: z.boolean(),
  manualOnly: z.literal(true).optional(),
  retainedSourceIds: z.array(id).max(MAX_RETAINED_PER_FEED).optional(),
  retainedWindows: z.array(z.strictObject({ sourceId: id, until: date })).max(MAX_RETAINED_PER_FEED).optional(),
  registeredBy: z.string().min(1).max(80), registeredAt: date, lastAttemptAt: date.nullable(), lastSuccessfulCheckAt: date.nullable(),
  priorPdfRevision: z.uuid().nullable().optional(), lastScheduledFor: date.optional(), confirmedGone: z.boolean().optional(), lastStatus: knowledgeCheckStatus.nullable(),
  pdfEditionReview: pdfEditionReviewSchema.optional(),
  lease: z.strictObject({ jobId: z.uuid(), token: z.uuid(), until: date }).nullable() });
const observationSchema = z.strictObject({ ...binding, sourceId: id, watchId: id, url: z.url(), contentHash: hash,
  feedOriginalHash: hash.optional(), pdfReadback: pdfReadback.optional(),
  bodyHash: hash, parts: z.number().int().min(1).max(40), fetchedAt: date, lastSuccessfulCheckAt: date, unavailable: z.boolean(),
  sourcePublishedAt: date.nullable(), approved: z.strictObject({ contentHash: hash, versionId: z.uuid(), watchRevision: z.uuid(),
    operator: z.string().min(1).max(80), at: date }).nullable() });
const partSchema = z.strictObject({ ...binding, sourceId: id, contentHash: hash, part: z.number().int().nonnegative().max(39), text: z.string().max(16001) });
const checkSchema = z.strictObject({ ...binding, jobId: z.uuid(), watchId: id, revision: z.uuid(), workerGeneration: z.uuid(), token: z.uuid(),
  state: z.enum(["running", "recorded", "unknown"]), attempts: z.number().int().min(1).max(2), checkedAt: date,
  status: knowledgeCheckStatus.nullable(), pdfEditionReview: pdfEditionReviewSchema.optional(), itemCount: z.number().int().min(0).max(50),
  changedCount: z.number().int().min(0).max(50), failureCode: z.enum(["network", "timeout", "response", "parse"]).nullable(),
  readMethod: z.string().min(1).max(80).optional(), originalHash: hash.optional(), itemHashes: z.array(z.strictObject({ sourceId: id, contentHash: hash })).max(50).optional(),
  httpStatus: z.union([z.literal(404), z.literal(410)]).nullable() });
const adminStatusCursorSchema = z.object({ checkedAt: date, jobId: z.uuid() }).strict();
type Watch = z.infer<typeof watchSchema>;
type Observation = z.infer<typeof observationSchema>;
export interface FirestoreKnowledgeObservation { watch: Watch; observation: Observation | null; catalogMatches: boolean }
export interface FirestoreKnowledgeObservationPort {
  recentSourceIds(transaction: Transaction, watchIds: readonly string[], documentUrl?: string): Promise<string[]>;
  retainedInternalSourceIds(transaction: Transaction, watchIds: readonly string[]): Promise<string[]>;
  setRetainedInternalSource(transaction: Transaction, context: FirestoreKnowledgeObservation, retain: { until: string | null } | null): void;
  read(transaction: Transaction, sourceId: string): Promise<FirestoreKnowledgeObservation | null>;
  content(transaction: Transaction, observed: Observation): Promise<ObservedContent>;
  recordPdfReadback?(tx: Transaction, context: FirestoreKnowledgeObservation, request: PdfRangeRequest, reviewHash: string, reviewedRevision: string): Promise<void>;
  approve(transaction: Transaction, context: FirestoreKnowledgeObservation, versionId: string, operator: string, at: string): void;
}
export interface FirestoreKnowledgeRefreshOptions {
  originalBucket?: KnowledgeOriginalBucket;
  database: Firestore; projectId: string; namespace: string; definitions: readonly SourceWatchDefinition[];
  readControl(transaction: Transaction): Promise<{ enabled: boolean; generation: string }>;
}
const operator = (value: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(value)) throw new Error("knowledge_operator_invalid"); };
function reject(code: string): never { throw new Error(code); }
function bounded(values: unknown[]) {
  const sizes = values.map(value => Buffer.byteLength(JSON.stringify(value)));
  if (sizes.some(size => size > 900 * 1024) || sizes.reduce((a, b) => a + b, 0) > 8 * 1024 * 1024) reject("knowledge_document_too_large");
}
function parts(text: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 16000);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end++;
    result.push(text.slice(start, end)); start = end;
  }
  if (!result.length || result.length > 40) reject("knowledge_document_too_large");
  return result;
}

/** Trusted source maintenance only. No family context, model, embedding or automatic publication. */
export function createFirestoreKnowledgeRefresh(options: FirestoreKnowledgeRefreshOptions) {
  const { database, projectId, namespace } = options, scope = { schemaVersion: 1 as const, projectId, namespace };
  const originals = createFirestoreKnowledgeOriginals(options);
  const media = createPlatformMediaStore(database, namespace);
  const definitions = options.definitions.map(definition => definitionSchema.parse(definition));
  if (definitions.length > 512 || new Set(definitions.map(row => row.id)).size !== definitions.length) reject("knowledge_watch_catalog_invalid");
  const catalog = new Map(definitions.map(row => [row.id, row]));
  const cardIds = definitions.filter(row => campaignSources.has(row.id) && row.classification === 'official_guidance'
    && row.audience === 'public_noncommercial').map(row => row.id).sort();
  const watchRef = (id: string) => database.collection(namespace + "_knowledge_watches").doc(id);
  const observationRef = (id: string) => database.collection(namespace + "_knowledge_observations").doc(id);
  const partRef = (sourceId: string, hash: string, part: number) => database.collection(namespace + "_knowledge_observation_parts").doc(knowledgeHash([sourceId, hash, part]));
  const checkRef = (id: string) => database.collection(namespace + "_knowledge_checks").doc(id);
  async function publishedCard(tx: Transaction, row: Watch, through?: string) {
    const source = await tx.get(database.collection(namespace + '_knowledge_sources').doc(row.id));
    if (!source.exists || source.get('enabled') !== true || !source.get('activeVersionId')) return false;
    if (source.get('projectId') !== projectId || source.get('namespace') !== namespace || source.get('sourceId') !== row.id
      || source.get('url') !== row.definition.url || !z.uuid().safeParse(source.get('activeVersionId')).success) reject('knowledge_binding_invalid');
    if (source.get('disabledReason') !== null) return false;
    const versionId = source.get('activeVersionId');
    const [edition] = await tx.getAll(database.collection(namespace + '_knowledge_versions').doc(versionId),
      { fieldMask: ['projectId', 'namespace', 'sourceId', 'versionId', 'reviewState', 'publishedAt'] });
    const version = edition?.data();
    if (version?.projectId !== projectId || version.namespace !== namespace || version.sourceId !== row.id || version.versionId !== versionId)
      reject('knowledge_binding_invalid');
    return version.reviewState === 'reviewed' && !!version.publishedAt && (!through || version.publishedAt <= through);
  }
  function parse<T extends { projectId: string; namespace: string }>(schema: z.ZodType<T>, raw: unknown): T {
    const value = schema.parse(raw);
    if (value.projectId !== projectId || value.namespace !== namespace) reject("knowledge_binding_invalid");
    return value;
  }
  async function watch(tx: Transaction, id: string): Promise<Watch | null> {
    const snapshot = await tx.get(watchRef(id)); if (!snapshot.exists) return null;
    const row = parse(watchSchema, snapshot.data());
    if (row.id !== id || row.definition.id !== id || row.definitionHash !== definitionHash(row.definition)) reject("knowledge_binding_invalid");
    const ids = [...row.retainedSourceIds ?? [], ...(row.retainedWindows ?? []).map(window => window.sourceId)];
    if (ids.length > MAX_RETAINED_PER_FEED || new Set(ids).size !== ids.length
      || ids.some(sourceId => !sourceId.startsWith(id + "-") || !/^[a-f0-9]{32}$/u.test(sourceId.slice(id.length + 1))))
      reject("knowledge_binding_invalid");
    return row;
  }
  const matches = (row: Watch) => Boolean(catalog.has(row.id) && definitionHash(catalog.get(row.id)!) === row.definitionHash);
  const gate: FirestoreKnowledgeObservationPort = {
    async recentSourceIds(tx, watchIds, documentUrl) {
      const feeds = watchIds.filter(id => catalog.get(id)?.kind === 'rss');
      if (!feeds.length) return [];
      if (documentUrl && !feeds.some(id => catalog.get(id)?.audience === 'public_noncommercial')) return [];
      if (feeds.length > 10) reject("knowledge_watch_catalog_invalid");
      const page = await tx.get(database.collection(namespace + "_knowledge_observations").where("watchId", "in", feeds)
        .where("sourcePublishedAt", ">=", new Date(Date.now() - TIMELY_KNOWLEDGE_POLICY_DEFAULTS.observationLookbackDays * 86400_000).toISOString())
        .orderBy("sourcePublishedAt", "desc").orderBy("sourceId").limit(60));
      return page.docs.flatMap(snapshot => {
        const row = parse(observationSchema, snapshot.data());
        if (snapshot.id !== row.sourceId || !feeds.includes(row.watchId)) reject("knowledge_binding_invalid");
        return !documentUrl || new URL(row.url).href.split('#')[0] === documentUrl ? [row.sourceId] : [];
      });
    },
    async retainedInternalSourceIds(tx, watchIds) {
      const feeds = watchIds.filter(id => catalog.get(id)?.kind === "rss" && catalog.get(id)?.audience === "internal_noncommercial");
      const watches = await Promise.all(feeds.map(id => watch(tx, id)));
      const now = Date.now();
      return watches.flatMap(row => row?.enabled && matches(row)
        ? [...row.retainedSourceIds ?? [], ...(row.retainedWindows ?? []).filter(window => Date.parse(window.until) > now).map(window => window.sourceId)]
        : []).sort();
    },
    setRetainedInternalSource(tx, { watch: row, observation, catalogMatches }, retain) {
      if (!observation || row.definition.kind !== "rss" || row.definition.audience !== "internal_noncommercial") return;
      const sourceId = observation.sourceId, ids = row.retainedSourceIds ?? [], windows = row.retainedWindows ?? [];
      if (sourceId !== row.id + "-" + knowledgeHash(observation.url).slice(0, 32)) reject("knowledge_binding_invalid");
      const oldUntil = ids.includes(sourceId) ? null : windows.find(entry => entry.sourceId === sourceId)?.until;
      if (oldUntil === retain?.until) return;
      if (retain && (!catalogMatches || !row.enabled || observation.unavailable)) reject("knowledge_observation_review_mismatch");
      const now = Date.now(), nextIds = ids.filter(id => id !== sourceId);
      const nextWindows = windows.filter(window => window.sourceId !== sourceId && Date.parse(window.until) > now);
      if (retain) {
        if (retain.until === null) nextIds.push(sourceId);
        else if (Date.parse(date.parse(retain.until)) > now) nextWindows.push({ sourceId, until: retain.until });
        else reject("knowledge_version_expired");
      }
      if (nextIds.length + nextWindows.length > MAX_RETAINED_PER_FEED) reject("knowledge_retained_feed_full");
      // Omit empty extension fields rather than changing legacy watch documents for ordinary news.
      const { retainedSourceIds: _ids, retainedWindows: _windows, ...watch } = row;
      tx.set(watchRef(row.id), { ...watch, ...(nextIds.length ? { retainedSourceIds: nextIds.sort() } : {}),
        ...(nextWindows.length ? { retainedWindows: nextWindows.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) } : {}) });
    },
    async read(tx, sourceId) {
      id.parse(sourceId);
      const snapshot = await tx.get(observationRef(sourceId)), observed = snapshot.exists ? parse(observationSchema, snapshot.data()) : null;
      if (observed && observed.sourceId !== sourceId) reject("knowledge_binding_invalid");
      const current = await watch(tx, observed?.watchId ?? sourceId);
      if (!current) { if (observed) reject("knowledge_binding_invalid"); return null; }
      return { watch: current, observation: observed, catalogMatches: matches(current) };
    },
    async content(tx, observed) {
      const snapshots = await tx.getAll(...Array.from({ length: observed.parts }, (_, part) => partRef(observed.sourceId, observed.contentHash, part)));
      const text = snapshots.map((snapshot, index) => {
        if (!snapshot.exists) reject("knowledge_observation_incomplete");
        const row = parse(partSchema, snapshot.data());
        if (row.sourceId !== observed.sourceId || row.contentHash !== observed.contentHash || row.part !== index) reject("knowledge_binding_invalid");
        return row.text;
      }).join("");
      if (knowledgeHash(text) !== observed.bodyHash) reject("knowledge_binding_invalid");
      const document = bodySchema.parse(JSON.parse(text));
      if (observationHash(document) !== observed.contentHash || document.url !== observed.url) reject("knowledge_binding_invalid");
      return document;
    },
    async recordPdfReadback(tx, context, request, reviewHash, reviewedRevision) {
      const { watch, observation } = context;
      const snap = await tx.get(checkRef(request.checkId)), control = await options.readControl(tx);
      const check = snap.exists ? parse(checkSchema, snap.data()) : null;
      const method = pdfReadMethod.safeParse(check?.readMethod);
      if (!observation?.approved || watch.definitionHash !== fullBookletDefinitionHash
        || !matchesPriorPdfRevision(watch.priorPdfRevision, reviewedRevision, request.confirmedLegacyExpansion)
        || !['changed', 'unchanged'].includes(watch.lastStatus ?? '') || !control.enabled || !check || !method.success || check.state !== 'recorded' || check.jobId !== request.checkId
        || !['changed', 'unchanged'].includes(check.status ?? '') || check.watchId !== request.sourceId
        || check.workerGeneration !== control.generation || check.revision !== watch.revision || check.originalHash !== request.pdfHash
        || check.checkedAt !== observation.lastSuccessfulCheckAt || check.checkedAt !== watch.lastSuccessfulCheckAt
        || check.itemHashes?.length !== 1 || check.itemHashes[0]?.sourceId !== request.sourceId
        || check.itemHashes[0]?.contentHash !== request.observationHash) reject('knowledge_pdf_range_check_mismatch');
      // The deployed collection only indexes checkedAt. Read one extra receipt to detect a truncated millisecond.
      const receiptLimit = 8;
      const concurrent = await tx.get(database.collection(namespace + '_knowledge_checks')
        .where('checkedAt', '==', check.checkedAt).limit(receiptLimit + 1));
      if (concurrent.size > receiptLimit) reject('knowledge_pdf_range_check_mismatch');
      const sameWatch = concurrent.docs.filter(doc => {
        const receipt = parse(checkSchema, doc.data());
        if (receipt.jobId !== doc.id) reject('knowledge_binding_invalid');
        return receipt.watchId === watch.id;
      });
      if (sameWatch.length !== 1 || sameWatch[0]?.id !== request.checkId) reject('knowledge_pdf_range_check_mismatch');
      const proof = { ...request, watchRevision: watch.revision, reviewHash, readMethod: method.data, checkedAt: check.checkedAt };
      tx.set(observationRef(request.sourceId), { ...observation, pdfReadback: proof });
    },
    approve(tx, context, versionId, by, at) {
      if (!context.observation || !context.watch.enabled || !context.catalogMatches || context.observation.unavailable) reject("knowledge_observation_review_mismatch");
      const row = context.observation;
      tx.set(observationRef(row.sourceId), { ...row, approved: { contentHash: row.contentHash, versionId, operator: by, at, watchRevision: context.watch.revision } });
    },
  };
  return {
    gate, originals, media,
    /** Organization-internal exact RSS evidence, never a public summary or a full article. */
    async internalFeedOriginal(sourceId: string, expectedHash: string) {
      const selected = await database.runTransaction(async tx => {
        const state = await gate.read(tx, sourceId), current = state?.observation;
        if (!state?.catalogMatches || !state.watch.enabled || state.watch.id !== "chp-recent"
          || state.watch.definition.audience !== "internal_noncommercial" || !current?.feedOriginalHash
          || current.unavailable || current.contentHash !== expectedHash) reject("knowledge_feed_edition_unavailable");
        const document = await gate.content(tx, current);
        if (!document.rssItem) reject("knowledge_feed_original_missing");
        return { sourceId, contentHash: expectedHash, feedHash: current.feedOriginalHash, fetchedAt: current.fetchedAt,
          url: document.url, publisher: state.watch.definition.publisher, termsUrl: state.watch.definition.termsUrl,
          audience: state.watch.definition.audience, rssItem: document.rssItem, feedUrl: state.watch.definition.url };
      }, { readOnly: true });
      const feed = await originals.readFeed("chp-recent", selected.feedHash);
      if (!feed.includes(Buffer.from(selected.rssItem.xml))) reject("knowledge_feed_original_mismatch");
      return selected;
    },
    async resumeCheck(job: RefreshJob, jobId: string, includeObservationTime = false) {
      return database.runTransaction(async tx => {
        const snap = await tx.get(checkRef(jobId));
        if (!snap.exists) return null;
        const receipt = parse(checkSchema, snap.data());
        if (receipt.watchId !== job.watchId || receipt.revision !== job.revision
          || receipt.workerGeneration !== job.workerGeneration || receipt.state !== "recorded") return null;
        if (receipt.status === "unavailable" && receipt.httpStatus)
          return { status: "unavailable" as const, httpStatus: receipt.httpStatus };
        if (receipt.status === 'needs_review' && receipt.pdfEditionReview)
          return { status: 'failed' as const, reason: 'response' as const, pdfEditionReview: receipt.pdfEditionReview };
        if (receipt.status === "failed" && receipt.failureCode)
          return { status: "failed" as const, reason: receipt.failureCode };
        if (!receipt.itemHashes || !["changed", "unchanged"].includes(receipt.status ?? "")) return null;
        const items: ObservedContent[] = [];
        let firstObservedAt: string | undefined;
        for (const pin of receipt.itemHashes) {
          const current = await gate.read(tx, pin.sourceId);
          if (!current?.catalogMatches || !current.watch.enabled || current.watch.revision !== job.revision
            || current.observation?.contentHash !== pin.contentHash || current.observation.unavailable) return null;
          if (includeObservationTime && receipt.itemHashes.length === 1) firstObservedAt = current.observation.fetchedAt;
          items.push(await gate.content(tx, current.observation));
        }
        return { status: "ok" as const, items, ...(firstObservedAt ? {firstObservedAt} : {}) };
      }, { readOnly: true });
    },
    async adminStatus(cursor: string | null = null): Promise<AdminKnowledgeStatus> {
      let after: z.infer<typeof adminStatusCursorSchema> | null = null;
      if (cursor !== null) {
        try {
          if (!z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/u).safeParse(cursor).success) throw Error('Invalid cursor');
          const bytes = Buffer.from(cursor, 'base64url');
          if (bytes.toString('base64url') !== cursor) throw Error('Invalid cursor');
          after = adminStatusCursorSchema.parse(JSON.parse(bytes.toString('utf8')));
        } catch { domainReject('invalid_cursor', 400); }
      }
      return database.runTransaction(async tx => {
        const savedWatches = await tx.get(database.collection(namespace + '_knowledge_watches'));
        const registered = new Map(savedWatches.docs.filter(doc => catalog.has(doc.id)).map(doc => [doc.id, parse(watchSchema, doc.data())]));
        if (after) {
          const saved = await tx.get(checkRef(after.jobId));
          if (!saved.exists) domainReject('invalid_cursor', 400);
          const position = parse(checkSchema, saved.data());
          if (saved.id !== position.jobId) reject('knowledge_binding_invalid');
          if (position.checkedAt !== after.checkedAt) domainReject('invalid_cursor', 400);
        }
        let query = database.collection(namespace + '_knowledge_checks').orderBy('checkedAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(21);
        if (after) query = query.startAfter(after.checkedAt, after.jobId);
        const page = await tx.get(query), checked = page.docs.map(snapshot => {
          const row = parse(checkSchema, snapshot.data());
          if (snapshot.id !== row.jobId) reject('knowledge_binding_invalid');
          const { jobId, watchId, checkedAt, state, status, attempts, itemCount, changedCount, failureCode, httpStatus } = row;
          return { jobId, watchId, checkedAt, state, status, attempts, itemCount, changedCount, failureCode, httpStatus,
            ...(row.pdfEditionReview ? { pdfEditionReview: row.pdfEditionReview } : {}) };
        });
        const checks = checked.slice(0, 20), last = checks.at(-1);
        return adminKnowledgeStatusSchema.parse({ watches: definitions.map(definition => {
          const row = registered.get(definition.id);
          return { id: definition.id, publisher: definition.publisher, url: definition.url, kind: definition.kind,
            registration: !row ? 'not_registered' : !matches(row) ? 'definition_changed' : row.enabled ? 'enabled' : 'disabled',
            lastAttemptAt: row?.lastAttemptAt ?? null, lastSuccessfulCheckAt: row?.lastSuccessfulCheckAt ?? null, lastStatus: row?.lastStatus ?? null,
            ...(row?.enabled && matches(row) && row.pdfEditionReview ? { pdfEditionReview: row.pdfEditionReview } : {}) };
        }), checks, nextCursor: checked.length > 20 && last ? Buffer.from(JSON.stringify({ checkedAt: last.checkedAt, jobId: last.jobId })).toString('base64url') : null });
      }, { readOnly: true });
    },
    async register(id: string, by: string, manualOnly = false) {
      operator(by); const definition = catalog.get(id); if (!definition) reject("knowledge_watch_not_in_catalog");
      await database.runTransaction(async tx => {
        const old = await watch(tx, id), nextHash = definitionHash(definition);
        if (manualOnly && old?.enabled && !old.manualOnly) reject('knowledge_watch_already_scheduled');
        const unchanged = old?.enabled && old.definitionHash === nextHash;
        if (unchanged && Boolean(old.manualOnly) === manualOnly) return;
        const priorPdfRevision = unchanged ? old.priorPdfRevision
          : nextHash === fullBookletDefinitionHash && old?.enabled && !old.confirmedGone && old.definitionHash === selectedBookletDefinitionHash
            ? old.revision : null;
        const row: Watch = { ...scope, id, definition, definitionHash: nextHash, enabled: true,
          ...(manualOnly ? { manualOnly: true as const } : {}),
          ...(id === feedingBookletId && priorPdfRevision !== undefined ? { priorPdfRevision } : {}),
          revision: unchanged ? old.revision : randomUUID(), registeredBy: by, registeredAt: new Date().toISOString(),
          lastAttemptAt: old?.lastAttemptAt ?? null, lastSuccessfulCheckAt: old?.lastSuccessfulCheckAt ?? null, lastStatus: old?.lastStatus ?? null,
          ...(old?.confirmedGone !== undefined ? { confirmedGone: old.confirmedGone } : {}),
          ...(unchanged && old.retainedSourceIds ? { retainedSourceIds: old.retainedSourceIds } : {}),
          ...(unchanged && old.retainedWindows ? { retainedWindows: old.retainedWindows } : {}),
          ...(unchanged && old.lastScheduledFor ? { lastScheduledFor: old.lastScheduledFor } : {}),
          ...(unchanged && old.pdfEditionReview ? { pdfEditionReview: old.pdfEditionReview } : {}),
          lease: unchanged ? old.lease : null };
        bounded([row]); tx.set(watchRef(id), row);
      });
    },
    async disable(id: string) {
      await database.runTransaction(async tx => {
        const row = await watch(tx, id); if (!row) reject("knowledge_watch_unknown");
        // A new revision invalidates every prior approval without an unbounded fan-out write.
        tx.set(watchRef(id), { ...row, ...(row.id === feedingBookletId ? { priorPdfRevision: null } : {}), enabled: false, revision: randomUUID(), lease: null });
      });
    },
    async inspect(sourceId: string) {
      return database.runTransaction(async tx => {
        const state = await gate.read(tx, sourceId); if (!state?.observation) reject("knowledge_observation_unknown");
        return { ...state, document: await gate.content(tx, state.observation) };
      }, { readOnly: true });
    },
    async list() {
      return database.runTransaction(async tx => {
        const watches = (await Promise.all([...catalog.keys()].map(id => watch(tx, id)))).filter(row => row !== null);
        const observations = await tx.get(database.collection(namespace + "_knowledge_observations").orderBy("lastSuccessfulCheckAt", "desc").limit(100));
        const checks = await tx.get(database.collection(namespace + "_knowledge_checks").orderBy("checkedAt", "desc").limit(50));
        return { watches, observations: observations.docs.map(row => parse(observationSchema, row.data())), checks: checks.docs.map(row => parse(checkSchema, row.data())) };
      }, { readOnly: true });
    },
    // Read existing publication pointers, including editions published by an older campaign worker.
    // Leave the original watch revision, paid work fingerprint and receipts intact.
    async publishedCardChecks(after: string | null, slot: string) {
      date.parse(slot);
      const remaining = after === null ? cardIds : cardIds.filter(id => id > after);
      const page = remaining.slice(0, 16);
      return database.runTransaction(async tx => {
        const control = await options.readControl(tx);
        const checked = control.enabled ? await Promise.all(page.map(async id => {
          const row = await watch(tx, id);
          if (!row?.manualOnly || !row.enabled || !matches(row) || row.registeredAt > slot || row.confirmedGone
            || !await publishedCard(tx, row, slot)) return null;
          return { definition: row.definition, registeredAt: row.registeredAt,
            data: { watchId: id, revision: row.revision, workerGeneration: control.generation } };
        })) : [];
        return { entries: checked.filter(row => row !== null), next: remaining.length > page.length ? page.at(-1)! : null };
      }, { readOnly: true });
    },
    async jobs(manualId?: string): Promise<{ definition: SourceWatchDefinition; data: RefreshJob; registeredAt: string }[]> {
      return database.runTransaction(async tx => {
        const control = await options.readControl(tx); if (!control.enabled) return [];
        const watches = manualId ? [await watch(tx, manualId)] : definitions.length <= 32 ? await Promise.all([...catalog.keys()].map(id => watch(tx, id)))
          : (await tx.get(database.collection(namespace + '_knowledge_watches'))).docs
            .filter(doc => catalog.has(doc.id)).map(doc => parse(watchSchema, doc.data()));
        return watches.filter((row): row is Watch => Boolean(row?.enabled && matches(row) && (manualId === row.id || !row.manualOnly))).map(row => ({ definition: row.definition, registeredAt: row.registeredAt,
          data: { watchId: row.id, revision: row.revision, workerGeneration: control.generation } }));
      }, { readOnly: true });
    },
    async process(raw: RefreshJob, jobId: string, fetcher: SourceFetcher, signal: AbortSignal, scheduledFor?: string) {
      if (scheduledFor !== undefined) date.parse(scheduledFor);
      const job = refreshJobSchema.parse(raw); z.uuid().parse(jobId);
      const token = randomUUID(), now = new Date().toISOString();
      const claim = await database.runTransaction(async tx => {
        const row = await watch(tx, job.watchId), control = await options.readControl(tx), prior = await tx.get(checkRef(jobId));
        const receipt = prior.exists ? parse(checkSchema, prior.data()) : null;
        if (receipt && (receipt.watchId !== job.watchId || receipt.revision !== job.revision || receipt.workerGeneration !== job.workerGeneration)) reject("knowledge_job_conflict");
        if (receipt?.state === "recorded") return { status: "already_recorded" as const };
        if (!row?.enabled || !matches(row) || row.revision !== job.revision || !control.enabled || control.generation !== job.workerGeneration || signal.aborted) return { status: "inactive" as const };
        if (scheduledFor && row.manualOnly && (!campaignSources.has(row.id) || row.confirmedGone || !await publishedCard(tx, row)))
          return { status: 'inactive' as const };
        if (scheduledFor && row.lastScheduledFor && Date.parse(scheduledFor) < Date.parse(row.lastScheduledFor)) return { status: "superseded" as const };
        if (row.lease && Date.parse(row.lease.until) > Date.now()) reject("knowledge_check_in_progress");
        if (receipt && (receipt.state === "unknown" || receipt.attempts >= 2)) return { status: "unknown" as const };
        const check = { ...scope, ...job, jobId, token, state: "running" as const, attempts: (receipt?.attempts ?? 0) + 1,
          checkedAt: now, status: null, itemCount: 0, changedCount: 0, failureCode: null, httpStatus: null };
        tx.set(checkRef(jobId), check); tx.set(watchRef(row.id), { ...row, ...(scheduledFor ? { lastScheduledFor: scheduledFor } : {}), lease: { jobId, token, until: new Date(Date.now() + 90_000).toISOString() } });
        return { status: "execute" as const, definition: row.definition };
      });
      if (claim.status !== "execute") return { status: claim.status };
      const fetched = await fetcher(claim.definition, signal);
      const original = fetched.status === "ok" ? fetched.original : undefined;
      if (fetched.status === "ok" && claim.definition.leafletPage && (!original || original.mimeType !== "application/pdf"))
        reject("knowledge_original_missing");
      if (fetched.status === "ok" && claim.definition.id === "chp-recent"
        && (!original || original.mimeType !== "application/rss+xml" || !fetched.items.length
          || fetched.items.some(item => !item.rssItem || !original.bytes.includes(Buffer.from(item.rssItem.xml)))))
        reject("knowledge_feed_original_missing");
      const originalHash = original ? await originals.save(job.watchId, original.mimeType, original.bytes) : undefined;
      if (claim.definition.leafletPage && fetched.status === "ok" && fetched.items[0]?.extraction?.contentHash !== originalHash)
        reject("knowledge_original_hash_mismatch");
      const items = fetched.status === "ok" ? fetched.items.map(parseKnowledgeObservation) : [];
      if (items.length > 50 || fetched.status === "ok" && claim.definition.kind !== "rss" && items.length !== 1) reject("knowledge_fetch_items_invalid");
      const prepared = items.map(document => {
        const sourceId = id.parse(observationId(claim.definition, document)), contentHash = observationHash(document), body = JSON.stringify(document), segments = parts(body);
        if (claim.definition.kind !== "rss" ? document.url !== claim.definition.url : !claim.definition.itemHosts?.includes(new URL(document.url).hostname)) reject("knowledge_fetch_scope_invalid");
        return { sourceId, contentHash, document, bodyHash: knowledgeHash(body), segments };
      });
      if (new Set(prepared.map(row => row.sourceId)).size !== prepared.length) reject("knowledge_fetch_items_invalid");
      return database.runTransaction(async tx => {
        const row = await watch(tx, job.watchId), control = await options.readControl(tx), snap = await tx.get(checkRef(jobId));
        if (!snap.exists) reject("knowledge_job_missing");
        const receipt = parse(checkSchema, snap.data());
        if (receipt.state === "recorded") return { status: "already_recorded" as const };
        if (receipt.token !== token) reject("knowledge_check_superseded");
        const eligible = row?.enabled && matches(row) && row.revision === job.revision && row.lease?.token === token
          && Date.parse(row.lease.until) > Date.now() && control.enabled && control.generation === job.workerGeneration && !signal.aborted
          && (!scheduledFor || !row.manualOnly || await publishedCard(tx, row));
        const previous = new Map<string, Observation | null>();
        if (eligible) for (const item of prepared) {
          const snapshot = await tx.get(observationRef(item.sourceId));
          const observed = snapshot.exists ? parse(observationSchema, snapshot.data()) : null;
          if (observed && (observed.sourceId !== item.sourceId || observed.watchId !== job.watchId || observed.url !== item.document.url)) reject("knowledge_binding_invalid");
          previous.set(item.sourceId, observed);
        }
        const at = new Date().toISOString(); let changed = 0;
        const writes: { ref: ReturnType<typeof observationRef>; value: unknown }[] = [];
        if (eligible && row.definitionHash === fullBookletDefinitionHash && fetched.status === 'failed'
          && (fetched.reason === 'parse' || fetched.reason === 'response')) {
          const snapshot = await tx.get(observationRef(row.id));
          const observed = snapshot.exists ? parse(observationSchema, snapshot.data()) : null;
          if (observed?.pdfReadback) {
            if (observed.watchId !== row.id || observed.sourceId !== row.id) reject('knowledge_binding_invalid');
            const { pdfReadback: _invalidated, ...next } = observed;
            writes.push({ ref: observationRef(row.id), value: next });
          }
        }
        if (eligible) for (const item of prepared) {
          const old = previous.get(item.sourceId), same = old?.contentHash === item.contentHash;
          if (!same || old.unavailable) changed++;
          const proof = old?.pdfReadback;
          const next: Observation = { ...scope, sourceId: item.sourceId, watchId: job.watchId, url: item.document.url, contentHash: item.contentHash,
            ...(same && !old.unavailable && proof && fetched.status === 'ok' && proof.readMethod === fetched.readMethod && proof.pdfHash === originalHash ? { pdfReadback: proof } : {}),
            ...(item.document.rssItem && originalHash ? { feedOriginalHash: same && old.feedOriginalHash ? old.feedOriginalHash : originalHash } : {}),
            bodyHash: item.bodyHash, parts: item.segments.length, fetchedAt: same ? old.fetchedAt : at, lastSuccessfulCheckAt: at, unavailable: false,
            sourcePublishedAt: item.document.sourcePublishedAt, approved: old?.approved ?? null };
          writes.push({ ref: observationRef(item.sourceId), value: next });
          if (!same) item.segments.forEach((text, part) => writes.push({ ref: partRef(item.sourceId, item.contentHash, part),
            value: { ...scope, sourceId: item.sourceId, contentHash: item.contentHash, part, text } }));
        }
        const pdfEditionReview = eligible && fetched.status === 'failed' ? fetched.pdfEditionReview : undefined;
        const status = !eligible ? "superseded" as const : pdfEditionReview ? 'needs_review' as const : fetched.status === "ok" ? changed ? "changed" as const : "unchanged" as const
          : fetched.status === "unavailable" ? "unavailable" as const : "failed" as const;
        const nextCheck = { ...receipt, state: "recorded" as const, status, itemCount: eligible ? prepared.length : 0, changedCount: changed,
          ...(eligible && fetched.status === "ok" ? { itemHashes: prepared.map(({ sourceId, contentHash }) => ({ sourceId, contentHash })),
            ...(fetched.readMethod ? { readMethod: fetched.readMethod } : {}), ...(originalHash ? { originalHash } : {}) } : {}),
          ...(pdfEditionReview ? { pdfEditionReview } : {}),
          checkedAt: at, failureCode: status === 'failed' && fetched.status === "failed" ? fetched.reason : null, httpStatus: eligible && fetched.status === "unavailable" ? fetched.httpStatus : null };
        if (row?.lease?.token === token) {
          const { pdfEditionReview: previousReview, ...watch } = row;
          const pending = pdfEditionReview ?? (eligible && (fetched.status === 'ok' || fetched.status === 'unavailable' && fetched.httpStatus === 410)
            ? undefined : previousReview);
          writes.push({ ref: watchRef(row.id), value: { ...watch, lease: null, ...(pending ? { pdfEditionReview: pending } : {}),
            ...(eligible ? { lastAttemptAt: at, lastStatus: status, lastSuccessfulCheckAt: fetched.status === "ok" ? at : row.lastSuccessfulCheckAt,
              // A single 404 or feed outage cannot withdraw its items. Explicit 410 on a document invalidates its revision.
              confirmedGone: fetched.status === "ok" ? false : fetched.status === "unavailable" && fetched.httpStatus === 410
                && row.definition.kind !== "rss" || (row.confirmedGone ?? row.lastStatus === "unavailable"),
              ...(fetched.status === 'unavailable' && fetched.httpStatus === 410 && row.id === feedingBookletId ? { priorPdfRevision: null } : {}),
              revision: fetched.status === "unavailable" && fetched.httpStatus === 410 && row.definition.kind !== "rss" ? randomUUID() : row.revision } : {}) } });
        }
        writes.push({ ref: checkRef(jobId), value: nextCheck }); bounded(writes.map(row => row.value));
        if (eligible && fetched.status === 'ok' && fetched.mediaLinks !== undefined) await media.reconcile(tx, job.watchId, fetched.mediaLinks);
        for (const write of writes) tx.set(write.ref, write.value);
        return { status, items: nextCheck.itemCount, changed };
      });
    },
  };
}
export const firestoreKnowledgeRefreshSchemas = { watch: watchSchema, observation: observationSchema, part: partSchema, check: checkSchema };
export type FirestoreKnowledgeRefresh = ReturnType<typeof createFirestoreKnowledgeRefresh>;
