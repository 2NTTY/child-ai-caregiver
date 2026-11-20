import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { FinishReason } from "@google/genai";
import type { Pool } from "pg";
import ts from "typescript";
import { readAiConfig } from "../server/ai-config.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createEmbeddingGateway, type EmbeddingActor, type EmbeddingUsage } from "../server/embedding-gateway.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { FirestoreDomainData } from "../server/firestore-domain-data.ts";
import { createFirestoreKnowledgeRefresh, parseKnowledgeObservation } from "../server/firestore-knowledge-refresh.ts";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../server/firestore-knowledge.ts";
import { firestoreTopicStorageSchema } from "../server/firestore-memory.ts";
import { embeddingDocument, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from "../server/knowledge-inputs.ts";
import { observationHash, observationId } from "../server/knowledge-observation.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { knowledgeReviewHash, type KnowledgeReviewAssessment } from "../server/knowledge-review-assessment.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import {
  evaluateTimelyEligibility,
  proactiveKindForTimelyEvent,
  sqlTimelyEligibilityClause,
  TIMELY_KNOWLEDGE_POLICY_DEFAULTS,
} from "../server/knowledge-timely-policy.ts";
import { createProactiveEventSources } from "../server/proactive-event-sources.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeChunkInput, type KnowledgeEvidence, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { isPersistentTimelyKind, isTimelyEventActive } from "../src/shared/knowledge-timely.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import { avatarMemoryBucket } from "./helpers/avatar-memory.ts";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const vector = [1, ...Array<number>(1023).fill(0)];
const userId = "synthetic-parent-timely-01";
const childId = "11111111-2222-4333-8444-555555555555";
const runId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const messageId = "ffffffff-1111-4222-8333-444444444444";
const generation = "33333333-3333-4333-8333-333333333333";
const recentFilter: KnowledgeFilter = { region: "HK", classification: "recent_information", age: null, ageMatch: "unknown", topics: [] };

const aiConfig = readAiConfig({
  AI_ENABLED: "true",
  GCP_PROJECT_ID: "synthetic-timely-project",
  AI_DAILY_USER_ATTEMPTS: "10",
  AI_DAILY_GLOBAL_ATTEMPTS: "50",
});

function emptyMemoryContext(): MemoryContext {
  return {
    profile: { childId, version: 0, data: null },
    profileApplicable: false,
    facts: [],
    topics: [],
    summary: null,
    recentMessages: [],
    conflictingKeys: [],
    unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false },
  } as unknown as MemoryContext;
}

function makeChunk(key: string, patch: Partial<KnowledgeChunkInput> = {}): KnowledgeChunkInput {
  return {
    key,
    section: "安全公告詳情",
    sourceExcerpt: "合成奶粉批號批次宣布預防性召回，請停用受影響批次並保留購買憑證。",
    originalText: "合成奶粉批號批次宣布預防性召回，請停用受影響批次並保留購買憑證。",
    text: "官方公告指出合成嬰幼兒配方奶粉相關批次正進行預防性召回。",
    keywords: ["奶粉", "召回", "安全警報"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["safety"], conditions: [] },
    ...patch,
  };
}

function makeAssessment(
  current: KnowledgeSourceInput,
  observationContentHash: string,
  compared: { document: KnowledgeSourceInput; versionId: string; hash: string } | null = null,
): KnowledgeReviewAssessment {
  const before = new Map(compared?.document.chunks.map(c => [c.key, c]) ?? []);
  const next = new Map(current.chunks.map(c => [c.key, c]));
  const keys = [...new Set([...before.keys(), ...next.keys()])];
  return {
    comparedVersionId: compared?.versionId ?? null,
    comparedHash: compared?.hash ?? null,
    observationHash: observationContentHash,
    changes: keys.map(key => ({
      key,
      oldQuote: before.get(key)?.sourceExcerpt ?? null,
      newQuote: next.get(key)?.sourceExcerpt ?? null,
      meaning: !before.has(key) ? "new" : !next.has(key) ? "removed" : knowledgeReviewHash(before.get(key)) === knowledgeReviewHash(next.get(key)) ? "unchanged" : "changed",
      explanation: "Synthetic timely lifecycle semantic verification",
    })),
    checks: { age: "Reviewed", numbersAndUnits: "Reviewed", timing: "Reviewed", conditions: "Reviewed", exceptions: "Reviewed", prohibitions: "Reviewed", withdrawal: "Reviewed" },
    questions: [{ query: "最近有沒有嬰兒奶粉召回？", expectedKeys: current.chunks.map(c => c.key), reason: "Recall lookup" }],
    growthRuleImpact: "none",
    growthRuleReason: "Synthetic timely lifecycle check does not touch growth rules",
    decision: "approve",
  };
}

function makeEmbeddings(document: KnowledgeSourceInput): FirestoreKnowledgeEmbedding[] {
  return document.chunks.map(chunk => ({
    chunkKey: chunk.key,
    inputHash: embeddingDocument(document.title, chunk.section, chunk.text).hash,
    ...KNOWLEDGE_EMBEDDING,
    values: vector,
  }));
}

function createFirestoreKnowledgeFixture(sourceIds: readonly string[], audience: "public" | "internal" = "internal") {
  const fake = firestoreDomainFixture();
  const encode = (value: any): any => value instanceof VectorValue ? { syntheticVector: value.toArray() }
    : Array.isArray(value) ? value.map(encode)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) : value;
  const decode = (value: any): any => value && typeof value === "object" && Object.keys(value).length === 1 && Array.isArray(value.syntheticVector)
    ? FieldValue.vector(value.syntheticVector)
    : Array.isArray(value) ? value.map(decode)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)])) : value;
  const snapshot = (snap: any) => ({ ...snap, data: () => decode(snap.data()), get: (key: string) => decode(snap.get(key)) });
  const wrap = (query: any): any => ({
    ...query,
    doc(id: string) {
      const ref = query.doc(id);
      return { ...ref, get: () => fake.database.runTransaction(tx => tx.get(ref)) };
    },
    where: (...args: any[]) => wrap(query.where(...args)),
    findNearest: (options: VectorQueryOptions) => ({
      async get() {
        const values = options.queryVector instanceof VectorValue ? options.queryVector.toArray() : options.queryVector;
        const docs = [...fake.records.entries()]
          .filter(([p]) => p.startsWith(query.path + "/"))
          .map(([p, raw]) => ({ p, row: decode(raw) }))
          .filter(({ row }) => query.filters.every(([k, op, val]: [string, string, any]) => op === "==" ? row[k] === val : op === "in" && val.includes(row[k])))
          .map(({ p, row }) => {
            const stored = row.embedding.toArray();
            const dot = stored.reduce((sum: number, val: number, idx: number) => sum + val * values[idx]!, 0);
            const norm = (arr: number[]) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
            const distance = 1 - Math.max(-1, Math.min(1, dot / (norm(stored) * norm(values))));
            return { id: p.split("/").at(-1), row: { ...row, [options.distanceResultField as string]: distance }, distance };
          })
          .filter(row => row.distance <= options.distanceThreshold!)
          .sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
          .slice(0, options.limit)
          .map(row => ({ id: row.id, data: () => row.row }));
        return { docs };
      },
    }),
  });
  const database = {
    collection: (collectionPath: string) => wrap(fake.database.collection(collectionPath)),
    runTransaction: (operation: (tx: any) => Promise<any>) => fake.database.runTransaction(tx => operation({
      get: async (target: any) => snapshot(await tx.get(target)),
      getAll: async (...targets: any[]) => (await tx.getAll(...targets)).map(snapshot),
      create: (ref: any, value: unknown) => tx.create(ref, encode(value)),
      set: (ref: any, value: unknown) => tx.set(ref, encode(value)),
      delete: (ref: any) => tx.delete(ref),
    })),
  } as unknown as Firestore;

  const domain = { database, projectId: "synthetic-timely-project", namespace: "synthetic_timely", cipher: createStorageCipher(Buffer.alloc(32, 7)) };
  const authority = createFirestoreAuthority(domain);
  const refresh = createFirestoreKnowledgeRefresh({
    ...domain,
    originalBucket: { bucketName: "demo-originals", bucket: avatarMemoryBucket("demo-originals").port },
    definitions: SOURCE_WATCHES,
    readControl: tx => authority.readControl(tx),
  });
  const nativeStore = createFirestoreKnowledgeStore({ ...domain, sourceIds, audience, observations: refresh.gate }, { KNOWLEDGE_FIRESTORE_TIMELY_WRITES: "reviewed-v1" });
  const store = {
    ...nativeStore,
    async importSource(input: unknown) {
      const result = await nativeStore.importSource(input);
      for (let i = 0; i < 16; i++) if ((await nativeStore.prepareSearch(result.versionId, result.hash)).complete) break;
      return result;
    },
  };
  return { ...fake, database, domain, authority, refresh, store };
}

function buildChpRssPayload(itemUrl: string, title: string, text: string, publishedAt: string) {
  const itemXml = `<item><title>${title}</title><link>${itemUrl}</link><description><![CDATA[${text}]]></description><pubDate>${new Date(publishedAt).toUTCString()}</pubDate></item>`;
  const feedXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CHP Press Releases</title>${itemXml}</channel></rss>`;
  const observation = parseKnowledgeObservation({
    url: itemUrl,
    title,
    text,
    sourcePublishedAt: publishedAt,
    sourceUpdatedAt: null,
    sourceDateText: null,
    rssItem: { xml: itemXml, copyright: "香港特別行政區政府衞生署衞生防護中心" },
  });
  return {
    observation,
    fetchResult: {
      status: "ok" as const,
      items: [observation],
      original: { mimeType: "application/rss+xml" as const, bytes: Buffer.from(feedXml, "utf8") },
    },
  };
}

test("timelyEvent schema validates classification, future timestamps, superseding links, and hash compatibility", () => {
  const baseInput: KnowledgeSourceInput = {
    sourceId: "synthetic-recent-item",
    url: "https://www.chp.gov.hk/tc/her/synthetic-1.html",
    title: "合成衛生防護中心公布",
    publisher: "衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: "2026-10-01T08:00:00Z",
    sourceUpdatedAt: null,
    fetchedAt: "2026-10-02T08:00:00Z",
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    chunks: [makeChunk("item-chunk")],
  };

  const parsedBase = parseKnowledgeSource(baseInput);
  assert.equal(Object.hasOwn(parsedBase, "timelyEvent"), false);
  assert.equal(sourceVersionHash(parsedBase), sourceVersionHash(parseKnowledgeSource({ ...baseInput, timelyEvent: undefined })));
  const withTimely = parseKnowledgeSource({
    ...baseInput,
    timelyEvent: { kind: "recall", status: "active", statusUpdatedAt: "2026-10-02T07:00:00Z", statusReason: "正進行預防性回收" },
  });
  assert.equal(withTimely.timelyEvent?.kind, "recall");
  assert.equal(isTimelyEventActive(withTimely.timelyEvent), true);
  assert.equal(isPersistentTimelyKind("recall"), true);
  assert.equal(isPersistentTimelyKind("safety_alert"), true);
  assert.equal(isPersistentTimelyKind("news"), false);

  assert.throws(() => parseKnowledgeSource({
    ...baseInput,
    classification: "official_guidance",
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html",
    termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html",
    timelyEvent: { kind: "recall", status: "active" },
  }), /Timely event lifecycle requires recent_information classification/);

  assert.throws(() => parseKnowledgeSource({
    ...baseInput,
    timelyEvent: { kind: "recall", status: "active", statusUpdatedAt: new Date(Date.now() + 3_600_000).toISOString() },
  }), /Future timely event status date/);

  assert.throws(() => parseKnowledgeSource({
    ...baseInput,
    timelyEvent: { kind: "recall", status: "active", supersededBySourceId: "chp-new-notice" },
  }), /supersededBySourceId requires superseded or corrected status/);

  assert.throws(() => parseKnowledgeSource({
    ...baseInput,
    timelyEvent: { kind: "recall", status: "lifted", supersededBySourceId: "chp-new-notice" },
  }), /supersededBySourceId requires superseded or corrected status/);

  const superseded = parseKnowledgeSource({
    ...baseInput,
    timelyEvent: { kind: "recall", status: "superseded", supersededBySourceId: "chp-new-notice" },
  });
  assert.equal(superseded.timelyEvent?.supersededBySourceId, "chp-new-notice");
  assert.equal(isTimelyEventActive(superseded.timelyEvent), false);
});

test("evaluateTimelyEligibility enforces persistent recalls, deadlines, 7-day rolling news, missing/future dates, and stale checks", () => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  const freshCheck = new Date(now - 2 * 3_600_000).toISOString();
  const staleCheck = new Date(now - 25 * 3_600_000).toISOString();
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const daysAhead = (days: number) => new Date(now + days * 86_400_000).toISOString();

  // Persistent recalls & safety alerts stay eligible past 7 days while active or corrected and checked within 24h
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(14), lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "recall", status: "active" } }, now),
    { eligible: true, reason: "active_safety_or_recall", retentionClass: "persistent_until_resolved", retainProvenanceOnly: false },
  );
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(45), lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "safety_alert", status: "corrected" } }, now),
    { eligible: true, reason: "active_safety_or_recall", retentionClass: "persistent_until_resolved", retainProvenanceOnly: false },
  );

  // Lifted / superseded / expired immediately exit even if published today
  for (const [status, reason] of [["lifted", "event_lifted"], ["superseded", "event_superseded"], ["expired", "event_expired"]] as const) {
    const decision = evaluateTimelyEligibility({
      classification: "recent_information",
      sourcePublishedAt: daysAgo(1),
      lastSuccessfulCheckAt: freshCheck,
      timelyEvent: { kind: "recall", status },
    }, now);
    assert.deepEqual(decision, { eligible: false, reason, retentionClass: "persistent_until_resolved", retainProvenanceOnly: true });
  }

  // Deadline / policy_change bounded by validUntil
  const futureDeadline = daysAhead(5);
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(12), validUntil: futureDeadline, lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "deadline", status: "active" } }, now),
    { eligible: true, reason: "active_until_deadline", retentionClass: "bounded_by_valid_until", retainProvenanceOnly: false },
  );
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(12), validUntil: futureDeadline, lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "policy_change", status: "active" } }, Date.parse(futureDeadline) + 1),
    { eligible: false, reason: "valid_until_expired", retentionClass: "bounded_by_valid_until", retainProvenanceOnly: true },
  );

  // Ordinary news / announcement / legacy without timelyEvent keep the 7-day rolling window
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(6.9), lastSuccessfulCheckAt: freshCheck }, now),
    { eligible: true, reason: "within_recent_window", retentionClass: "rolling_recent_window", retainProvenanceOnly: false },
  );
  assert.deepEqual(
    evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: new Date(now - 7 * 86_400_000 - 1).toISOString(), lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "news", status: "active" } }, now),
    { eligible: false, reason: "recent_window_elapsed", retentionClass: "rolling_recent_window", retainProvenanceOnly: true },
  );

  // Missing/future sourcePublishedAt and stale checks are rejected
  assert.equal(evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: null, lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "recall", status: "active" } }, now).reason, "publication_date_missing_or_future");
  assert.equal(evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAhead(1), lastSuccessfulCheckAt: freshCheck, timelyEvent: { kind: "recall", status: "active" } }, now).reason, "publication_date_missing_or_future");
  assert.equal(evaluateTimelyEligibility({ classification: "recent_information", sourcePublishedAt: daysAgo(1), lastSuccessfulCheckAt: staleCheck, timelyEvent: { kind: "recall", status: "active" } }, now).reason, "check_stale");
});

test("Firestore store retains reviewed recalls across RSS churn and original age, without bypassing freshness, rights or resolution", async t => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });

  const f = createFirestoreKnowledgeFixture(["chp-recent"], "internal");
  await f.authority.initializeControl({ enabled: true, generation });
  await f.refresh.register("chp-recent", "synthetic-operator");
  const watch = (await f.refresh.jobs()).find(j => j.definition.id === "chp-recent")!;

  const recallUrl = "https://www.chp.gov.hk/tc/features/recall-formula-01.html";
  const published14dAgo = new Date(now - 14 * 86_400_000).toISOString();
  const bodyV1 = "衞生防護中心安全公告：合成嬰幼兒配方奶粉批號 2026-A 預防性召回，請停用受影響批次。";
  const rssV1 = buildChpRssPayload(recallUrl, "合成奶粉預防性召回公告", bodyV1, published14dAgo);
  const recallSourceId = observationId(watch.definition, rssV1.observation);

  const poll1 = await f.refresh.process(watch.data, randomUUID(), async () => rssV1.fetchResult, new AbortController().signal);
  assert.equal(poll1.status, "changed");
  assert.equal(poll1.changed, 1);

  const docV1 = parseKnowledgeSource({
    sourceId: recallSourceId,
    url: recallUrl,
    title: "合成奶粉預防性召回公告",
    publisher: "香港特別行政區政府衞生署衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: published14dAgo,
    sourceUpdatedAt: null,
    fetchedAt: new Date(now).toISOString(),
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    timelyEvent: { kind: "recall", status: "active", statusUpdatedAt: published14dAgo, statusReason: "批號 2026-A 預防性召回中" },
    chunks: [makeChunk("recall-batch-a", { sourceExcerpt: bodyV1, originalText: bodyV1, text: bodyV1 })],
  });
  const impV1 = await f.store.importSource(docV1);
  await f.store.review(impV1.versionId, impV1.hash, "synthetic-operator", makeAssessment(docV1, observationHash(rssV1.observation)));
  await f.store.publish(impV1.versionId, impV1.hash, makeEmbeddings(docV1));

  async function replay(doc: KnowledgeSourceInput, imported: { versionId: string; hash: string }) {
    const paths = [`knowledge_sources/${doc.sourceId}`, `knowledge_versions/${imported.versionId}`,
      `knowledge_observations/${doc.sourceId}`, "knowledge_watches/chp-recent"];
    const state = () => paths.map(path => f.records.get("synthetic_timely_" + path));
    const before = structuredClone(state());
    await f.store.publish(imported.versionId, imported.hash, makeEmbeddings(doc));
    assert.deepEqual(state(), before, "An exact replay cannot revise the head, lifecycle, approval or check time");
  }

  // Verify 14-day-old active recall is found by daily search (would have failed under the old 7-day cutoff)
  assert.equal(TIMELY_KNOWLEDGE_POLICY_DEFAULTS.observationLookbackDays, 180);
  const hitsBeforeLift = await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" });
  assert.equal(hitsBeforeLift.length, 1);
  assert.equal(hitsBeforeLift[0]!.versionId, impV1.versionId);
  assert.deepEqual(hitsBeforeLift[0]!.timelyEvent, docV1.timelyEvent);

  // Two normal feed rotations push the reviewed item past the newest 60; neither is a lift.
  for (const page of [0, 1]) {
    const items = Array.from({ length: 30 }, (_, i) => buildChpRssPayload(
      `https://www.chp.gov.hk/tc/features/synthetic-newer-${page}-${i}.html`, "一般合成消息", "一般合成消息。", new Date(now).toISOString()).observation);
    const bytes = Buffer.from(`<rss><channel>${items.map(item => item.rssItem!.xml).join("")}</channel></rss>`);
    await f.refresh.process(watch.data, randomUUID(), async () => ({
      status: "ok", items, original: { mimeType: "application/rss+xml", bytes },
    }), new AbortController().signal);
  }
  const crowded = await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" });
  // Once the item itself is stale, no current hit; its reviewed lifecycle is still active.
  t.mock.timers.tick(181 * 86_400_000);
  assert.deepEqual(await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" }), []);
  const stale = await f.store.publishedEdition(recallSourceId);
  assert.equal(stale?.current, false);
  assert.deepEqual(stale?.source.timelyEvent, docV1.timelyEvent);
  await replay(docV1, impV1);
  assert.deepEqual(await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" }), []);

  // Unchanged daily check: zero changes, zero new versions, still searchable
  t.mock.timers.tick(3_600_000);
  const pollUnchanged = await f.refresh.process(watch.data, randomUUID(), async () => rssV1.fetchResult, new AbortController().signal);
  assert.equal(pollUnchanged.status, "unchanged");
  assert.equal(pollUnchanged.changed, 0);
  const hitsAfterUnchanged = await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" });
  // The authorized per-item observation was renewed, not its original publication date.
  assert.deepEqual([crowded, hitsAfterUnchanged].map(hits => hits.map(hit => hit.versionId)), [[impV1.versionId], [impV1.versionId]]);
  const hints = () => f.database.runTransaction(tx => f.refresh.gate.retainedInternalSourceIds(tx, ["chp-recent"]));
  assert.deepEqual(await hints(), [recallSourceId]);
  await f.refresh.register("chp-recent", "synthetic-operator"); // same catalog revision must not discard retained IDs
  assert.deepEqual(await hints(), [recallSourceId]);

  const publicStore = createFirestoreKnowledgeStore({ ...f.domain, sourceIds: ["chp-recent"], audience: "public", observations: f.refresh.gate });
  assert.deepEqual(await publicStore.candidates(recentFilter, vector, { query: "奶粉 召回" }), []);
  await assert.rejects(() => f.store.exportPublishedEdition(recallSourceId, impV1.hash), /internal_export_forbidden/);

  // Official lift update: publish v2 with status="lifted" -> immediately exits daily search, provenance preserved
  const liftedAt = new Date(Date.now()).toISOString();
  const bodyV2 = "衞生防護中心更新：上述合成奶粉批號 2026-A 預防性召回經覆檢後已解除。";
  const rssV2 = buildChpRssPayload(recallUrl, "合成奶粉召回解除公告", bodyV2, published14dAgo);
  const pollLift = await f.refresh.process(watch.data, randomUUID(), async () => rssV2.fetchResult, new AbortController().signal);
  assert.equal(pollLift.status, "changed");
  // Retention is not authority: the changed item hash blocks the prior version even before review.
  assert.deepEqual(await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" }), []);

  const docV2 = parseKnowledgeSource({
    ...docV1,
    title: "合成奶粉召回解除公告",
    sourceUpdatedAt: null,
    fetchedAt: liftedAt,
    timelyEvent: { kind: "recall", status: "lifted", statusUpdatedAt: liftedAt, statusReason: "官方已宣布解除召回" },
    chunks: [makeChunk("recall-batch-a", { sourceExcerpt: bodyV2, originalText: bodyV2, text: bodyV2 })],
  });
  const impV2 = await f.store.importSource(docV2);
  await f.store.review(impV2.versionId, impV2.hash, "synthetic-operator", makeAssessment(docV2, observationHash(rssV2.observation), { document: docV1, versionId: impV1.versionId, hash: impV1.hash }));
  await f.store.publish(impV2.versionId, impV2.hash, makeEmbeddings(docV2));

  assert.deepEqual(await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" }), []);
  assert.deepEqual(await hints(), []);
  await replay(docV2, impV2);
  // Version provenance remains stored even after exiting active search
  const storedVersions = [...f.records.keys()].filter(k => k.includes("_knowledge_versions/"));
  assert.equal(storedVersions.length, 2);

  // Superseded + corrected replacement: old notice exits daily search, new corrected notice replaces it
  const oldNoticeUrl = "https://www.chp.gov.hk/tc/features/alert-old-02.html";
  const newNoticeUrl = "https://www.chp.gov.hk/tc/features/alert-new-02.html";
  const oldRss = buildChpRssPayload(oldNoticeUrl, "舊安全警報", "合成初版安全警報正文。", published14dAgo);
  const newRss = buildChpRssPayload(newNoticeUrl, "更正安全警報", "合成更正後最新安全警報正文。", liftedAt);
  const replacementWatch = (await f.refresh.jobs()).find(j => j.definition.id === "chp-recent")!;
  await f.refresh.process(replacementWatch.data, randomUUID(), async () => ({
    status: "ok",
    items: [oldRss.observation, newRss.observation],
    original: { mimeType: "application/rss+xml", bytes: Buffer.concat([oldRss.fetchResult.original.bytes, newRss.fetchResult.original.bytes]) },
  }), new AbortController().signal);

  const oldSourceId = observationId(replacementWatch.definition, oldRss.observation);
  const newSourceId = observationId(replacementWatch.definition, newRss.observation);
  const oldSupersededDoc = parseKnowledgeSource({
    sourceId: oldSourceId,
    url: oldNoticeUrl,
    title: "舊安全警報",
    publisher: "香港特別行政區政府衞生署衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: published14dAgo,
    sourceUpdatedAt: null,
    fetchedAt: liftedAt,
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    timelyEvent: { kind: "safety_alert", status: "superseded", statusUpdatedAt: liftedAt, supersededBySourceId: newSourceId },
    chunks: [makeChunk("alert-old", { sourceExcerpt: "合成初版安全警報正文。", originalText: "合成初版安全警報正文。", text: "合成初版安全警報正文。" })],
  });
  const newCorrectedDoc = parseKnowledgeSource({
    sourceId: newSourceId,
    url: newNoticeUrl,
    title: "更正安全警報",
    publisher: "香港特別行政區政府衞生署衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: liftedAt,
    sourceUpdatedAt: null,
    fetchedAt: liftedAt,
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    timelyEvent: { kind: "safety_alert", status: "corrected", statusUpdatedAt: liftedAt, supersededBySourceId: oldSourceId },
    chunks: [makeChunk("alert-new", { sourceExcerpt: "合成更正後最新安全警報正文。", originalText: "合成更正後最新安全警報正文。", text: "合成更正後最新安全警報正文。" })],
  });
  for (const [doc, obs] of [[oldSupersededDoc, oldRss.observation], [newCorrectedDoc, newRss.observation]] as const) {
    const imp = await f.store.importSource(doc);
    await f.store.review(imp.versionId, imp.hash, "synthetic-operator", makeAssessment(doc, observationHash(obs)));
    if (doc.sourceId === newSourceId) {
      // A full retained directory must reject the new publication atomically, never evict an existing notice.
      const path = "synthetic_timely_knowledge_watches/chp-recent", original = f.records.get(path)!;
      const full = Array.from({ length: 60 }, (_, i) => `chp-recent-${i.toString(16).padStart(32, "0")}`);
      f.records.set(path, { ...original, retainedSourceIds: full });
      await assert.rejects(() => f.store.publish(imp.versionId, imp.hash, makeEmbeddings(doc)), /knowledge_retained_feed_full/);
      assert.equal(await f.store.publishedEdition(newSourceId), null);
      assert.deepEqual(await hints(), full);
      f.records.set(path, original);
    }
    await f.store.publish(imp.versionId, imp.hash, makeEmbeddings(doc));
    await replay(doc, imp);
  }
  const replacementHits = await f.store.candidates(recentFilter, vector, { query: "安全警報" });
  assert.equal(replacementHits.length, 1);
  assert.equal(replacementHits[0]!.sourceId, newSourceId);
  assert.equal(replacementHits[0]!.timelyEvent?.status, "corrected");
  assert.deepEqual(await hints(), [newSourceId]);
  await f.store.disable(newSourceId, "synthetic operator withdrawal");
  assert.deepEqual(await hints(), []);
  assert.deepEqual(await f.store.candidates(recentFilter, vector, { query: "安全警報" }), []);
});

// Only synthetic internal fixtures opt in to the new write format.
async function timedFixture(now: number) {
  const f = createFirestoreKnowledgeFixture(["chp-recent"], "internal");
  await f.authority.initializeControl({ enabled: true, generation });
  await f.refresh.register("chp-recent", "synthetic-operator");
  const watch = (await f.refresh.jobs()).find(job => job.definition.id === "chp-recent")!;
  const setup = async (key: string, ageDays: number, event: Pick<KnowledgeSourceInput, "timelyEvent" | "validUntil">) => {
    const date = new Date(now - ageDays * 86_400_000).toISOString();
    const url = `https://www.chp.gov.hk/tc/features/synthetic-${key}.html`;
    const body = `Synthetic notice about ${key}.`;
    const rss = buildChpRssPayload(url, "合成公告", body, date);
    await f.refresh.process(watch.data, randomUUID(), async () => rss.fetchResult, new AbortController().signal);
    const document = parseKnowledgeSource({ sourceId: observationId(watch.definition, rss.observation), url,
      title: "合成公告", publisher: watch.definition.publisher, classification: watch.definition.classification,
      sourcePublishedAt: date, sourceUpdatedAt: null, fetchedAt: new Date(now).toISOString(), termsUrl: watch.definition.termsUrl,
      ...event, chunks: [makeChunk(key, { sourceExcerpt: body, originalText: body, text: body })] });
    return { rss, document };
  };
  return { f, watch, setup };
}

test("Firestore store defaults to reader-first rollout and never silently downgrades a typed edition", async t => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const { f, setup } = await timedFixture(now);
  const options = { ...f.domain, sourceIds: ["chp-recent"], audience: "internal" as const, observations: f.refresh.gate };
  const reader = createFirestoreKnowledgeStore(options, {});
  const watchPath = "synthetic_timely_knowledge_watches/chp-recent";
  const keys = () => Object.keys(f.records.get(watchPath)!).sort();
  const snapshot = () => structuredClone([...f.records.entries()]);
  const typed = await setup("typed", 1, { timelyEvent: { kind: "recall", status: "active" } });
  const before = snapshot();
  await assert.rejects(reader.importSource(typed.document), /knowledge_timely_writes_disabled/);
  assert.deepEqual(snapshot(), before);
  const legacy = await setup("ordinary", 1, {});
  const legacyKeys = keys(); // Polling may legitimately add legacy confirmedGone metadata.
  assert.ok(!legacyKeys.includes("retainedSourceIds") && !legacyKeys.includes("retainedWindows"));
  const v = await reader.importSource(legacy.document);
  for (let i = 0; i < 16; i++) if ((await reader.prepareSearch(v.versionId, v.hash)).complete) break;
  await reader.review(v.versionId, v.hash, "synthetic-operator", makeAssessment(legacy.document, observationHash(legacy.rss.observation)));
  await reader.publish(v.versionId, v.hash, makeEmbeddings(legacy.document));
  await f.refresh.register("chp-recent", "synthetic-operator");
  assert.deepEqual(keys(), legacyKeys);
  const { chunks: _chunks, ...legacyHeader } = legacy.document;
  assert.deepEqual(f.records.get("synthetic_timely_knowledge_versions/" + v.versionId)!.header, legacyHeader);
  const next = await f.store.importSource(typed.document);
  const assessment = makeAssessment(typed.document, observationHash(typed.rss.observation));
  const beforeReview = snapshot();
  await assert.rejects(reader.review(next.versionId, next.hash, "synthetic-operator", assessment), /knowledge_timely_writes_disabled/);
  assert.deepEqual(snapshot(), beforeReview);
  await f.store.review(next.versionId, next.hash, "synthetic-operator", assessment);
  const beforePublish = snapshot();
  await assert.rejects(reader.publish(next.versionId, next.hash, makeEmbeddings(typed.document)), /knowledge_timely_writes_disabled/);
  assert.deepEqual(snapshot(), beforePublish);
  await f.store.publish(next.versionId, next.hash, makeEmbeddings(typed.document));
  const currentIds = async () => (await reader.candidates(recentFilter, vector, { query: "合成公告" })).map(hit => hit.versionId);
  assert.ok((await currentIds()).includes(next.versionId));
  // An operator can still withdraw a typed publication from a reader-compatible rollback.
  await reader.disable(typed.document.sourceId, "synthetic operator withdrawal");
  assert.deepEqual(await currentIds(), [v.versionId]);
});

test("Firestore store retains verified deadlines and policy changes independently of recent RSS until exact expiry", async t => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const { f, watch, setup } = await timedFixture(now);
  const until = new Date(now + 2 * 3_600_000).toISOString();
  const deadline = await setup("deadline", 181, { timelyEvent: { kind: "deadline", status: "active" }, validUntil: until });
  const policy = await setup("policy", 14, { timelyEvent: { kind: "policy_change", status: "corrected" }, validUntil: until });
  const rolling = await setup("no-horizon", 14, { timelyEvent: { kind: "deadline", status: "active" } });
  const reviewed = async (row: typeof deadline) => {
    const v = await f.store.importSource(row.document);
    await f.store.review(v.versionId, v.hash, "synthetic-operator", makeAssessment(row.document, observationHash(row.rss.observation)));
    return v;
  };
  const ids = [deadline, policy].map(row => row.document.sourceId).sort();
  const hints = () => f.database.runTransaction(tx => f.refresh.gate.retainedInternalSourceIds(tx, ["chp-recent"]));
  for (const row of [deadline, policy, rolling]) {
    const v = await reviewed(row);
    assert.ok(!(await hints()).includes(row.document.sourceId), "Review alone must not retain a notice");
    await f.store.publish(v.versionId, v.hash, makeEmbeddings(row.document));
  }
  for (const page of [0, 1]) {
    const items = Array.from({ length: 30 }, (_, i) => buildChpRssPayload(
      `https://www.chp.gov.hk/tc/features/synthetic-churn-${page}-${i}.html`, "新消息", "普通合成消息。", new Date(now).toISOString()).observation);
    await f.refresh.process(watch.data, randomUUID(), async () => ({ status: "ok", items,
      original: { mimeType: "application/rss+xml", bytes: Buffer.from(`<rss><channel>${items.map(x => x.rssItem!.xml).join("")}</channel></rss>`) } }),
    new AbortController().signal);
  }
  const hits = async () => (await f.store.candidates(recentFilter, vector, { query: "合成公告" })).map(hit => hit.sourceId).sort();
  assert.deepEqual(await hits(), ids);
  await f.refresh.register("chp-recent", "synthetic-operator");
  assert.deepEqual(await hints(), ids);
  t.mock.timers.tick(2 * 3_600_000 - 1);
  assert.deepEqual(await hits(), ids);
  t.mock.timers.tick(1);
  assert.deepEqual(await hits(), []);
  assert.deepEqual(await hints(), []);
  assert.equal((await f.store.publishedEdition(deadline.document.sourceId))?.source.validUntil, until);
  // Two expired timed slots cannot block the next reviewed publication; active slots remain intact.
  const path = "synthetic_timely_knowledge_watches/chp-recent", current = f.records.get(path)!;
  const active = Array.from({ length: 58 }, (_, i) => `chp-recent-${i.toString(16).padStart(32, "0")}`);
  f.records.set(path, { ...current, retainedSourceIds: active });
  const third = await setup("another-deadline", 20, { timelyEvent: { kind: "deadline", status: "active" }, validUntil: new Date(now + 86_400_000).toISOString() });
  const v = await reviewed(third);
  await f.store.publish(v.versionId, v.hash, makeEmbeddings(third.document));
  assert.deepEqual((await hints()).sort(), [...active, third.document.sourceId].sort());
});

test("Postgres SQL eligibility clause and row mapping preserve timelyEvent parity", async () => {
  const sqlClause = sqlTimelyEligibilityClause();
  assert.match(sqlClause, /timelyEvent'->>'status', 'active'\) IN \('active', 'corrected'\)/);
  assert.match(sqlClause, /timelyEvent'->>'kind' IN \('recall', 'safety_alert'\)/);
  assert.match(sqlClause, /timelyEvent'->>'kind' IN \('policy_change', 'deadline'\)/);
  assert.match(sqlClause, /interval '7 days'/);
  assert.match(sqlClause, /interval '24 hours'/);

  const queries: string[] = [];
  const doc: KnowledgeSourceInput = {
    sourceId: "synthetic-pg-recall",
    url: "https://www.chp.gov.hk/tc/features/pg-recall.html",
    title: "Postgres 合成召回",
    publisher: "衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: "2026-11-01T00:00:00Z",
    sourceUpdatedAt: null,
    fetchedAt: "2026-11-19T00:00:00Z",
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    timelyEvent: { kind: "recall", status: "active", statusReason: "進行中" },
    chunks: [makeChunk("pg-recall-chunk")],
  };
  const fakePool = {
    async connect() {
      return {
        async query(sql: string) {
          queries.push(sql);
          if (sql.includes("WITH eligible AS MATERIALIZED")) {
            return {
              rows: [{
                id: "99999999-8888-4777-8666-555555555555",
                source_id: doc.sourceId,
                version_id: "77777777-6666-4555-8444-333333333333",
                version_hash: "a".repeat(64),
                content_hash: "b".repeat(64),
                source_document: doc,
                document: doc.chunks[0]!,
                checked_at: new Date("2026-11-19T01:00:00Z"),
                last_successful_check_at: new Date("2026-11-19T08:00:00Z"),
                usage_scope: "internal_noncommercial",
                distance: 0.12,
                rank_score: "0.032",
              }],
            };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  } as unknown as Pool;

  const pgStore = createKnowledgeStore(fakePool, { audience: "internal" });
  const hits = await pgStore.candidates(recentFilter, vector, { query: "奶粉 召回" });
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0]!.timelyEvent, doc.timelyEvent);
  assert.ok(queries.some(sql => sql.includes(sqlClause)));
});

test("Main chat queries active B-class recalls with timelyEvent citations, and fails closed after recall is lifted", async t => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });

  const f = createFirestoreKnowledgeFixture(["chp-recent"], "internal");
  await f.authority.initializeControl({ enabled: true, generation });
  await f.refresh.register("chp-recent", "synthetic-operator");
  const watch = (await f.refresh.jobs()).find(j => j.definition.id === "chp-recent")!;

  const recallUrl = "https://www.chp.gov.hk/tc/features/chat-recall-01.html";
  const published14dAgo = new Date(now - 14 * 86_400_000).toISOString();
  const bodyV1 = "衞生防護中心公布：合成嬰幼兒配方奶粉 X 批號因安全檢查正進行預防性召回。";
  const rssV1 = buildChpRssPayload(recallUrl, "合成奶粉召回通知", bodyV1, published14dAgo);
  const recallSourceId = observationId(watch.definition, rssV1.observation);
  await f.refresh.process(watch.data, randomUUID(), async () => rssV1.fetchResult, new AbortController().signal);

  const docV1 = parseKnowledgeSource({
    sourceId: recallSourceId,
    url: recallUrl,
    title: "合成奶粉召回通知",
    publisher: "香港特別行政區政府衞生署衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: published14dAgo,
    sourceUpdatedAt: null,
    fetchedAt: new Date(now).toISOString(),
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    timelyEvent: { kind: "recall", status: "active", statusUpdatedAt: published14dAgo, statusReason: "合成批號召回中" },
    chunks: [makeChunk("chat-recall-chunk", { sourceExcerpt: bodyV1, originalText: bodyV1, text: bodyV1 })],
  });
  const impV1 = await f.store.importSource(docV1);
  await f.store.review(impV1.versionId, impV1.hash, "synthetic-operator", makeAssessment(docV1, observationHash(rssV1.observation)));
  await f.store.publish(impV1.versionId, impV1.hash, makeEmbeddings(docV1));

  const queryActor: EmbeddingActor = { kind: "query_embedding", actorId: userId, operationId: runId };
  const fakeUsage: EmbeddingUsage = { reserve: async () => true, record: async () => {} };
  const embeddings = createEmbeddingGateway({
    config: aiConfig,
    usage: fakeUsage,
    provider: { embed: async () => ({ values: vector, inputTokens: 4, billableCharacters: 12 }) },
  });
  const retrieverFactory = createKnowledgeRetriever(f.store, embeddings);
  const preHit = (await f.store.candidates(recentFilter, vector, { query: "奶粉 召回" }))[0]!;

  let modelStep = 0;
  let savedResult: ProductAgentResult | null = null;
  const answerParagraph = "衞生防護中心近期安全公告指出，合成嬰幼兒配方奶粉 X 批號目前正進行預防性召回，請停用受影響批次。";
  const runtime = createAgentRuntime({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string; sources: Array<{ classification: string }> };
          assert.equal(payload.sources[0]?.classification, "recent_information");
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        const step = modelStep++;
        const functionCall = step === 0
          ? { id: "search-recent-1", name: "search_knowledge", args: { query: "香港 奶粉 召回", classification: "recent_information" } }
          : { id: "present-recent-1", name: "present_answer", args: { kind: "public_information", paragraphs: [{ text: answerParagraph, citationIds: [preHit.chunkId] }] } };
        return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
      },
    },
  });

  const agent = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope: { userId, childId, workspaceId: "workspace-hk", authorizationVersion: "1", dataVersion: "epoch:1" }, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
      get: async () => savedResult,
    } as any,
    memory: { context: async () => emptyMemoryContext() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "最近有冇嬰兒奶粉召回消息？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retrieverFactory,
  });

  const reply = await agent.reply(userId, childId, messageId, async () => true);
  assert.ok(reply);
  productAgentResultSchema.parse(reply);
  assert.equal(reply.status, "completed");
  assert.equal(reply.citations.length, 1);
  assert.equal(reply.citations[0]!.classification, "recent_information");
  assert.deepEqual(reply.citations[0]!.timelyEvent, docV1.timelyEvent);

  // Lift the recall -> old citations fail revalidation while saved history keeps snapshot
  const liftedAt = new Date(Date.now()).toISOString();
  const bodyV2 = "衞生防護中心公布：合成嬰幼兒配方奶粉 X 批號預防性召回已正式解除。";
  const rssV2 = buildChpRssPayload(recallUrl, "合成奶粉召回解除通知", bodyV2, published14dAgo);
  await f.refresh.process(watch.data, randomUUID(), async () => rssV2.fetchResult, new AbortController().signal);
  const docV2 = parseKnowledgeSource({
    ...docV1,
    title: "合成奶粉召回解除通知",
    sourceUpdatedAt: null,
    fetchedAt: liftedAt,
    timelyEvent: { kind: "recall", status: "lifted", statusUpdatedAt: liftedAt, statusReason: "召回已解除" },
    chunks: [makeChunk("chat-recall-chunk", { sourceExcerpt: bodyV2, originalText: bodyV2, text: bodyV2 })],
  });
  const impV2 = await f.store.importSource(docV2);
  await f.store.review(impV2.versionId, impV2.hash, "synthetic-operator", makeAssessment(docV2, observationHash(rssV2.observation), { document: docV1, versionId: impV1.versionId, hash: impV1.hash }));
  await f.store.publish(impV2.versionId, impV2.hash, makeEmbeddings(docV2));

  const checkRun = retrieverFactory.createRun({
    actor: queryActor,
    budget: { check() {}, take() {}, wait: async (fn: any) => fn(), signal: new AbortController().signal } as any,
    authorize: async () => true,
  });
  const stillValid = await checkRun.revalidateCitations(
    [{ chunkId: preHit.chunkId, versionId: preHit.versionId, contentHash: preHit.contentHash }],
    recentFilter,
  );
  assert.equal(stillValid, false);
  const followUpSearch = await checkRun.search("香港 奶粉 召回", recentFilter);
  assert.equal(followUpSearch.chunks.length, 0);
  // Historical saved result retains immutable citation metadata
  assert.deepEqual(savedResult!.citations[0]!.timelyEvent, { kind: "recall", status: "active", statusUpdatedAt: published14dAgo, statusReason: "合成批號召回中" });
});

test("Proactive public event discovery maps active recalls to kind='recall' and withdraws lifted recalls", async () => {
  const f = firestoreDomainFixture();
  const definition = SOURCE_WATCHES[0]!;
  const at = "2026-11-19T08:00:00Z";
  const options = {
    database: f.database,
    cipher: createStorageCipher(Buffer.alloc(32, 81)),
    projectId: "synthetic-proactive-timely",
    namespace: "synthetic_proactive_timely",
    serverClock: () => Date.parse(at),
  };
  await createFirestoreAuthority(options).initializeControl({ generation, enabled: true });

  let status: "active" | "lifted" = "active";
  let versionHash = "c".repeat(64);
  let contentHash = "d".repeat(64);
  const pointerPath = `${options.namespace}_knowledge_sources/synthetic-recall-source`;
  f.records.set(pointerPath, {
    schemaVersion: 1,
    projectId: options.projectId,
    namespace: options.namespace,
    sourceId: "synthetic-recall-source",
    activeVersionId: "77777777-7777-4777-8777-777777777777",
    enabled: true,
    revision: "1",
  });

  const makeEvidence = (): KnowledgeCandidate & { termsUrl: string } => ({
    chunkId: "66666666-6666-4666-8666-666666666666",
    sourceId: "synthetic-recall-source",
    versionId: "77777777-7777-4777-8777-777777777777",
    versionHash,
    contentHash,
    key: "recall-section",
    section: "安全公告",
    sourceExcerpt: "嬰幼兒配方奶粉預防性召回通知。",
    text: "嬰幼兒配方奶粉預防性召回通知。",
    keywords: ["奶粉", "召回"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["care"], conditions: [] },
    url: definition.url,
    termsUrl: definition.termsUrl,
    title: "配方奶粉安全通知",
    publisher: definition.publisher,
    classification: "recent_information",
    sourcePublishedAt: "2026-11-05T08:00:00Z",
    sourceUpdatedAt: null,
    validUntil: null,
    timelyEvent: { kind: "recall", status },
    fetchedAt: at,
    checkedAt: at,
    lastSuccessfulCheckAt: at,
    usageScope: "public_noncommercial",
    reviewState: "reviewed",
    distance: null,
  });

  const profile = {
    childId,
    version: 1,
    confirmedBy: userId,
    confirmedAt: at,
    reason: "Confirmed profile",
    data: {
      age: { kind: "birth_date" as const, date: "2026-01-01" },
      region: "香港",
      dueDate: null,
      gestationalWeeksRaw: null,
      language: null,
      allergies: null,
      specialNeeds: null,
      preferences: null,
      source: "Confirmed",
      validUntil: null,
    },
  };

  assert.equal(proactiveKindForTimelyEvent("recent_information", { kind: "recall", status: "active" }), "recall");
  assert.equal(proactiveKindForTimelyEvent("recent_information", { kind: "deadline", status: "active" }), "deadline");
  assert.equal(proactiveKindForTimelyEvent("official_guidance", null), "guidance");

  const sources = createProactiveEventSources({
    ...options,
    sourceIds: ["synthetic-recall-source"],
    care: { async readProfile() { return profile as any; } },
    knowledge: {
      async publishedEdition() {
        const current = makeEvidence();
        return {
          versionId: current.versionId,
          versionHash: current.versionHash,
          observationHash: null,
          chunkIdentities: [{ key: current.key, chunkId: current.chunkId, contentHash: current.contentHash }],
          enabled: true,
          current: status === "active",
          source: {
            sourceId: current.sourceId,
            url: current.url,
            title: current.title,
            publisher: current.publisher,
            classification: current.classification,
            sourcePublishedAt: current.sourcePublishedAt,
            sourceUpdatedAt: null,
            validUntil: null,
            timelyEvent: current.timelyEvent,
            fetchedAt: at,
            termsUrl: current.termsUrl,
            chunks: [{ key: current.key, section: current.section, sourceExcerpt: current.sourceExcerpt, text: current.text, applicability: current.applicability, keywords: current.keywords }],
          },
        };
      },
      async ruleCandidates() {
        return status === "active" ? [makeEvidence()] : [];
      },
    },
  });

  const data = new FirestoreDomainData(options);
  const txBinding = (tx: any) => ({
    transaction: tx,
    actorUserId: userId,
    childAccessVersion: "1",
    scope: { ownerUserId: userId, childId, workspaceId: "55555555-5555-4555-8555-555555555555", storageEpoch: "66666666-6666-4666-8666-666666666666" },
    async readChild() { return { id: childId }; },
  }) as any;
  const topicId = "88888888-8888-4888-8888-888888888888";
  const scope = txBinding(null).scope;
  f.records.set(data.ref("memory_topics", "memory-topic", topicId).path, {
    ...data.tags(scope),
    live: true,
    visibility: "family",
    entityId: topicId,
    ...data.seal("memory-topic", topicId, scope, firestoreTopicStorageSchema, {
      id: topicId, childId, visibility: "family", title: "奶粉召回", note: "", status: "pending", version: 1,
      updatedBy: userId, updatedAt: at, resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true,
    }),
  });

  const readyActive = await sources.prepareGlobal({ force: true });
  assert.equal(readyActive.state, "ready");
  const activeRes = await f.database.runTransaction(tx => sources.readCandidates(txBinding(tx)));
  assert.equal(activeRes.candidates.length, 1);
  assert.equal(activeRes.candidates[0]!.kind, "recall");

  // Lift the recall and bump pointer revision
  status = "lifted";
  versionHash = "e".repeat(64);
  contentHash = "f".repeat(64);
  f.records.get(pointerPath).revision = "2";
  const readyLifted = await sources.prepareGlobal({ force: true });
  assert.equal(readyLifted.state, "ready");
  const liftedRes = await f.database.runTransaction(tx => sources.readCandidates(txBinding(tx)));
  assert.equal(liftedRes.candidates.length, 0);
  assert.ok(liftedRes.excluded.some(item => item.reason === "inactive"));
});

test("Frontend projection and AnswerSources keep collapsed cards concise while exposing timelyEvent status inside expanded OriginalCard", () => {
  const placeholder = new Proxy({}, { get: (_t, key) => String(key) });
  const node = (type: unknown, props: unknown) => ({ type, props });

  function createLoader(overrides: Record<string, any>) {
    const cache = new Map<string, any>();
    const load = (entry: string): any => {
      const file = path.resolve(root, entry);
      if (cache.has(file)) return cache.get(file).exports;
      const mod = { exports: {} };
      cache.set(file, mod);
      const code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText;
      new Function("require", "module", "exports", code)((name: string) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith(".")) return require(name);
        let target = path.resolve(path.dirname(file), name);
        if (!existsSync(target) && existsSync(target + ".ts")) target += ".ts";
        else if (!existsSync(target) && existsSync(target + ".tsx")) target += ".tsx";
        return load(target);
      }, mod, mod.exports);
      return mod.exports;
    };
    return load;
  }

  function renderCollect(value: any): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(renderCollect).join("");
    if (value && typeof value === "object") {
      if (typeof value.type === "function") return renderCollect(value.type(value.props));
      const parts = [renderCollect(value.props?.children)];
      for (const prop of ["title", "byline", "label", "value"]) {
        if (typeof value.props?.[prop] === "string") parts.push(value.props[prop]);
      }
      return parts.join(" ");
    }
    return "";
  }

  const baseOverrides = (selectedId: string | null, showMetadata: boolean): Record<string, any> => ({
    react: {
      createContext: () => ({ Provider: "Provider" }),
      useContext: () => null,
      useId: () => "synthetic",
      useLayoutEffect() {},
      useRef: (v: unknown) => ({ current: v ?? null }),
      useState: (initial: unknown) => {
        if (initial === null) return [selectedId, () => {}];
        return [showMetadata && initial === false ? true : initial, () => {}];
      },
      Fragment: "Fragment",
    },
    "react/jsx-runtime": { jsx: node, jsxs: node, Fragment: "Fragment" },
    "react-native": {
      Platform: { OS: "web" },
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      StyleSheet: { create: (v: unknown) => v },
      View: "View",
      useWindowDimensions: () => ({ width: 1024, fontScale: 1 }),
      Linking: { openURL: async () => {} },
    },
    "react-native-paper": { Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "../../preview/PreviewNavigationGuard": { PreviewLink: "PreviewLink" },
    "../AppDialog": { AppDialog: Object.assign("AppDialog", { ScrollArea: "ScrollArea", Actions: "Actions" }) },
    "../memory/SourceDocumentCard": { SourceDocumentCard: "SourceDocumentCard" },
    "../memory/PlatformCardJoin": { PlatformCardJoin: "PlatformCardJoin" },
    "../AppScrollView": { AppScrollView: "AppScrollView" },
    "../HorizontalOverflowRail": { HorizontalOverflowRail: "HorizontalOverflowRail" },
    "../ui": { AppButton: "AppButton" },
    "../AppIcon": { AppIcon: "AppIcon" },
    "../StatusAnnouncement": { StatusAnnouncement: "StatusAnnouncement" },
    "../../theme": { colors: placeholder, spacing: placeholder, chineseFont: "synthetic" },
    "../../motion": { MotionDisclosure: ({ children }: any) => children, MotionEntrance: ({ children }: any) => children },
    "../../motion/MotionSelectionMarker": { MotionSelectionMarker: "MotionSelectionMarker" },
    "./CitationMarker": { CitationMarker: "CitationMarker" },
    "./locateCitationSource": { locateCitationSource() {} },
    "./chat-presentation": { chatColors: placeholder, chatFont: "synthetic", chatLayout: placeholder, chatType: placeholder },
  });

  const { projectAgentCitation } = createLoader(baseOverrides(null, false))("frontend/src/production/agent-projection.ts");
  const evidence: KnowledgeEvidence = {
    chunkId: "chunk-recall-ui-1",
    sourceId: "chp-recall-1",
    versionId: "ver-1",
    versionHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    key: "recall-item",
    section: "召回公告",
    sourceExcerpt: "合成召回批次摘錄。",
    text: "合成召回批次摘錄。",
    keywords: ["召回"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["safety"], conditions: [] },
    url: "https://www.chp.gov.hk/tc/features/recall-ui.html",
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html",
    title: "合成產品召回公告",
    publisher: "衞生防護中心",
    classification: "recent_information",
    sourcePublishedAt: "2026-11-01T08:00:00Z",
    sourceUpdatedAt: "2026-11-19T08:00:00Z",
    timelyEvent: {
      kind: "recall",
      status: "lifted",
      statusUpdatedAt: "2026-11-19T08:00:00Z",
      statusReason: "批次覆檢完成已解除",
      supersededBySourceId: "chp-recall-2",
    },
    fetchedAt: "2026-11-19T08:00:00Z",
    checkedAt: "2026-11-19T08:00:00Z",
    reviewState: "reviewed",
  };
  const projected = projectAgentCitation(evidence);
  assert.deepEqual(projected.timelyEvent, evidence.timelyEvent);

  const collapsedLoader = createLoader(baseOverrides(null, false));
  const { AnswerSources: CollapsedSources } = collapsedLoader("frontend/src/components/chat/AnswerSources.tsx");
  const collapsedText = renderCollect(CollapsedSources({ sources: [projected], children: "正文【1】" }));
  assert.ok(collapsedText.includes("合成產品召回公告"));
  assert.doesNotMatch(collapsedText, /狀態說明|批次覆檢完成已解除|不再作為現行最新有效指引/);

  const expandedLoader = createLoader(baseOverrides(projected.id, true));
  const { AnswerSources: ExpandedSources } = expandedLoader("frontend/src/components/chat/AnswerSources.tsx");
  const expandedText = renderCollect(ExpandedSources({ sources: [projected], children: "正文【1】" }));
  assert.ok(expandedText.includes("產品召回（已解除）"));
  assert.ok(expandedText.includes("此近期事項狀態為「已解除」，不再作為現行最新有效指引。"));
  assert.ok(expandedText.includes("狀態更新時間"));
  assert.ok(expandedText.includes("狀態說明"));
  assert.ok(expandedText.includes("批次覆檢完成已解除"));
  assert.ok(expandedText.includes("取代來源"));
  assert.ok(expandedText.includes("chp-recall-2"));
});
