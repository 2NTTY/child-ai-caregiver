import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import { knowledgeExtractionSchema, knowledgeHash } from "./knowledge-inputs.ts";
import { definitionHash, observationHash, observationId } from "./knowledge-observation.ts";
import { refreshJobSchema, type ObservedContent, type RefreshJob, type SourceFetcher, type SourceWatchDefinition } from "./knowledge-refresh-types.ts";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.iso.datetime({ offset: true });
const binding = { schemaVersion: z.literal(1), projectId: z.string(), namespace: z.string() };
const definitionSchema = z.strictObject({ id, url: z.url(), kind: z.enum(["page", "rss", "pdf"]), title: z.string().max(300).optional(),
  pdfPages: z.strictObject({ startPage: z.number().int().positive(), endPage: z.number().int().positive() }).optional(),
  classification: z.enum(["official_guidance", "recent_information"]), publisher: z.string().min(1).max(160), termsUrl: z.url(),
  audience: z.enum(["public_noncommercial", "internal_noncommercial"]), itemHosts: z.array(z.string().min(1).max(255)).max(8).optional(),
  selector: z.string().min(1).max(500).optional() });
const bodySchema: z.ZodType<ObservedContent> = z.strictObject({ url: z.url(), title: z.string().min(1).max(300),
  text: z.string().min(1).max(256020).refine(text => text.isWellFormed()), sourcePublishedAt: date.nullable(), sourceUpdatedAt: date.nullable(),
  sourceDateText: z.string().max(200).nullable(), extraction: knowledgeExtractionSchema.optional(),
  pages: z.array(z.strictObject({ page: z.number().int().positive(), text: z.string().max(32000), status: z.enum(["text", "empty", "unreadable"]) })).max(8).optional() });
/** Hash the same normalized representation that the durable observation stores. */
export function parseKnowledgeObservation(input: unknown): ObservedContent { return bodySchema.parse(input); }
const watchSchema = z.strictObject({ ...binding, id, definition: definitionSchema, definitionHash: hash, revision: z.uuid(), enabled: z.boolean(),
  registeredBy: z.string().min(1).max(80), registeredAt: date, lastAttemptAt: date.nullable(), lastSuccessfulCheckAt: date.nullable(),
  lastStatus: z.enum(["changed", "unchanged", "failed", "unavailable", "superseded"]).nullable(),
  lease: z.strictObject({ jobId: z.uuid(), token: z.uuid(), until: date }).nullable() });
const observationSchema = z.strictObject({ ...binding, sourceId: id, watchId: id, url: z.url(), contentHash: hash,
  bodyHash: hash, parts: z.number().int().min(1).max(40), fetchedAt: date, lastSuccessfulCheckAt: date, unavailable: z.boolean(),
  sourcePublishedAt: date.nullable(), approved: z.strictObject({ contentHash: hash, versionId: z.uuid(), watchRevision: z.uuid(),
    operator: z.string().min(1).max(80), at: date }).nullable() });
const partSchema = z.strictObject({ ...binding, sourceId: id, contentHash: hash, part: z.number().int().nonnegative().max(39), text: z.string().max(16001) });
const checkSchema = z.strictObject({ ...binding, jobId: z.uuid(), watchId: id, revision: z.uuid(), workerGeneration: z.uuid(), token: z.uuid(),
  state: z.enum(["running", "recorded", "unknown"]), attempts: z.number().int().min(1).max(2), checkedAt: date,
  status: z.enum(["changed", "unchanged", "failed", "unavailable", "superseded"]).nullable(), itemCount: z.number().int().min(0).max(50),
  changedCount: z.number().int().min(0).max(50), failureCode: z.enum(["network", "timeout", "response", "parse"]).nullable(),
  httpStatus: z.union([z.literal(404), z.literal(410)]).nullable() });
type Watch = z.infer<typeof watchSchema>;
type Observation = z.infer<typeof observationSchema>;
export interface FirestoreKnowledgeObservation { watch: Watch; observation: Observation | null; catalogMatches: boolean }
export interface FirestoreKnowledgeObservationPort {
  recentSourceIds(transaction: Transaction, watchIds: readonly string[]): Promise<string[]>;
  read(transaction: Transaction, sourceId: string): Promise<FirestoreKnowledgeObservation | null>;
  content(transaction: Transaction, observed: Observation): Promise<ObservedContent>;
  approve(transaction: Transaction, context: FirestoreKnowledgeObservation, versionId: string, operator: string, at: string): void;
}
export interface FirestoreKnowledgeRefreshOptions {
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
  const definitions = options.definitions.map(definition => definitionSchema.parse(definition));
  if (definitions.length > 32 || new Set(definitions.map(row => row.id)).size !== definitions.length) reject("knowledge_watch_catalog_invalid");
  const catalog = new Map(definitions.map(row => [row.id, row]));
  const watchRef = (id: string) => database.collection(namespace + "_knowledge_watches").doc(id);
  const observationRef = (id: string) => database.collection(namespace + "_knowledge_observations").doc(id);
  const partRef = (sourceId: string, hash: string, part: number) => database.collection(namespace + "_knowledge_observation_parts").doc(knowledgeHash([sourceId, hash, part]));
  const checkRef = (id: string) => database.collection(namespace + "_knowledge_checks").doc(id);
  function parse<T extends { projectId: string; namespace: string }>(schema: z.ZodType<T>, raw: unknown): T {
    const value = schema.parse(raw);
    if (value.projectId !== projectId || value.namespace !== namespace) reject("knowledge_binding_invalid");
    return value;
  }
  async function watch(tx: Transaction, id: string): Promise<Watch | null> {
    const snapshot = await tx.get(watchRef(id)); if (!snapshot.exists) return null;
    const row = parse(watchSchema, snapshot.data());
    if (row.id !== id || row.definition.id !== id || row.definitionHash !== definitionHash(row.definition)) reject("knowledge_binding_invalid");
    return row;
  }
  const matches = (row: Watch) => Boolean(catalog.has(row.id) && definitionHash(catalog.get(row.id)!) === row.definitionHash);
  const gate: FirestoreKnowledgeObservationPort = {
    async recentSourceIds(tx, watchIds) {
      const feeds = watchIds.filter(id => catalog.get(id)?.kind === "rss");
      if (!feeds.length) return [];
      if (feeds.length > 10) reject("knowledge_watch_catalog_invalid");
      const page = await tx.get(database.collection(namespace + "_knowledge_observations").where("watchId", "in", feeds)
        .where("sourcePublishedAt", ">=", new Date(Date.now() - 7 * 86400_000).toISOString())
        .orderBy("sourcePublishedAt", "desc").orderBy("sourceId").limit(60));
      return page.docs.map(snapshot => {
        const row = parse(observationSchema, snapshot.data());
        if (snapshot.id !== row.sourceId || !feeds.includes(row.watchId)) reject("knowledge_binding_invalid");
        return row.sourceId;
      });
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
    approve(tx, context, versionId, by, at) {
      if (!context.observation || !context.watch.enabled || !context.catalogMatches || context.observation.unavailable) reject("knowledge_observation_review_mismatch");
      const row = context.observation;
      tx.set(observationRef(row.sourceId), { ...row, approved: { contentHash: row.contentHash, versionId, operator: by, at, watchRevision: context.watch.revision } });
    },
  };
  return {
    gate,
    async register(id: string, by: string) {
      operator(by); const definition = catalog.get(id); if (!definition) reject("knowledge_watch_not_in_catalog");
      await database.runTransaction(async tx => {
        const old = await watch(tx, id), unchanged = old?.enabled && old.definitionHash === definitionHash(definition);
        const row: Watch = { ...scope, id, definition, definitionHash: definitionHash(definition), enabled: true,
          revision: unchanged ? old.revision : randomUUID(), registeredBy: by, registeredAt: new Date().toISOString(),
          lastAttemptAt: old?.lastAttemptAt ?? null, lastSuccessfulCheckAt: old?.lastSuccessfulCheckAt ?? null, lastStatus: old?.lastStatus ?? null,
          lease: unchanged ? old.lease : null };
        bounded([row]); tx.set(watchRef(id), row);
      });
    },
    async disable(id: string) {
      await database.runTransaction(async tx => {
        const row = await watch(tx, id); if (!row) reject("knowledge_watch_unknown");
        // A new revision invalidates every prior approval without an unbounded fan-out write.
        tx.set(watchRef(id), { ...row, enabled: false, revision: randomUUID(), lease: null });
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
    async jobs(): Promise<{ definition: SourceWatchDefinition; data: RefreshJob; registeredAt: string }[]> {
      return database.runTransaction(async tx => {
        const control = await options.readControl(tx); if (!control.enabled) return [];
        const watches = await Promise.all([...catalog.keys()].map(id => watch(tx, id)));
        return watches.filter((row): row is Watch => Boolean(row?.enabled && matches(row))).map(row => ({ definition: row.definition, registeredAt: row.registeredAt,
          data: { watchId: row.id, revision: row.revision, workerGeneration: control.generation } }));
      }, { readOnly: true });
    },
    async process(raw: RefreshJob, jobId: string, fetcher: SourceFetcher, signal: AbortSignal) {
      const job = refreshJobSchema.parse(raw); z.uuid().parse(jobId);
      const token = randomUUID(), now = new Date().toISOString();
      const claim = await database.runTransaction(async tx => {
        const row = await watch(tx, job.watchId), control = await options.readControl(tx), prior = await tx.get(checkRef(jobId));
        const receipt = prior.exists ? parse(checkSchema, prior.data()) : null;
        if (receipt && (receipt.watchId !== job.watchId || receipt.revision !== job.revision || receipt.workerGeneration !== job.workerGeneration)) reject("knowledge_job_conflict");
        if (receipt?.state === "recorded") return { status: "already_recorded" as const };
        if (!row?.enabled || !matches(row) || row.revision !== job.revision || !control.enabled || control.generation !== job.workerGeneration || signal.aborted) return { status: "inactive" as const };
        if (row.lease && Date.parse(row.lease.until) > Date.now()) reject("knowledge_check_in_progress");
        if (receipt && (receipt.state === "unknown" || receipt.attempts >= 2)) return { status: "unknown" as const };
        const check = { ...scope, ...job, jobId, token, state: "running" as const, attempts: (receipt?.attempts ?? 0) + 1,
          checkedAt: now, status: null, itemCount: 0, changedCount: 0, failureCode: null, httpStatus: null };
        tx.set(checkRef(jobId), check); tx.set(watchRef(row.id), { ...row, lease: { jobId, token, until: new Date(Date.now() + 90_000).toISOString() } });
        return { status: "execute" as const, definition: row.definition };
      });
      if (claim.status !== "execute") return { status: claim.status };
      const fetched = await fetcher(claim.definition, signal);
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
          && Date.parse(row.lease.until) > Date.now() && control.enabled && control.generation === job.workerGeneration && !signal.aborted;
        const previous = new Map<string, Observation | null>();
        if (eligible) for (const item of prepared) {
          const snapshot = await tx.get(observationRef(item.sourceId));
          const observed = snapshot.exists ? parse(observationSchema, snapshot.data()) : null;
          if (observed && (observed.sourceId !== item.sourceId || observed.watchId !== job.watchId || observed.url !== item.document.url)) reject("knowledge_binding_invalid");
          previous.set(item.sourceId, observed);
        }
        const at = new Date().toISOString(); let changed = 0;
        const writes: { ref: ReturnType<typeof observationRef>; value: unknown }[] = [];
        if (eligible) for (const item of prepared) {
          const old = previous.get(item.sourceId), same = old?.contentHash === item.contentHash;
          if (!same || old.unavailable) changed++;
          const next: Observation = { ...scope, sourceId: item.sourceId, watchId: job.watchId, url: item.document.url, contentHash: item.contentHash,
            bodyHash: item.bodyHash, parts: item.segments.length, fetchedAt: at, lastSuccessfulCheckAt: at, unavailable: false,
            sourcePublishedAt: item.document.sourcePublishedAt, approved: old?.approved ?? null };
          writes.push({ ref: observationRef(item.sourceId), value: next });
          if (!same) item.segments.forEach((text, part) => writes.push({ ref: partRef(item.sourceId, item.contentHash, part),
            value: { ...scope, sourceId: item.sourceId, contentHash: item.contentHash, part, text } }));
        }
        const status = !eligible ? "superseded" as const : fetched.status === "ok" ? changed ? "changed" as const : "unchanged" as const
          : fetched.status === "unavailable" ? "unavailable" as const : "failed" as const;
        const nextCheck = { ...receipt, state: "recorded" as const, status, itemCount: eligible ? prepared.length : 0, changedCount: changed,
          checkedAt: at, failureCode: eligible && fetched.status === "failed" ? fetched.reason : null, httpStatus: eligible && fetched.status === "unavailable" ? fetched.httpStatus : null };
        if (row?.lease?.token === token) writes.push({ ref: watchRef(row.id), value: { ...row, lease: null,
          ...(eligible ? { lastAttemptAt: at, lastStatus: status, lastSuccessfulCheckAt: fetched.status === "ok" ? at : row.lastSuccessfulCheckAt,
            // Invalidate old editions immediately, while a network failure merely records a failed attempt.
            revision: fetched.status === "unavailable" ? randomUUID() : row.revision } : {}) } });
        writes.push({ ref: checkRef(jobId), value: nextCheck }); bounded(writes.map(row => row.value));
        for (const write of writes) tx.set(write.ref, write.value);
        return { status, items: nextCheck.itemCount, changed };
      });
    },
  };
}
export const firestoreKnowledgeRefreshSchemas = { watch: watchSchema, observation: observationSchema, part: partSchema, check: checkSchema };
export type FirestoreKnowledgeRefresh = ReturnType<typeof createFirestoreKnowledgeRefresh>;
