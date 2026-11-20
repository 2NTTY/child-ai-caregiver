import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { FinishReason } from "@google/genai";
import ts from "typescript";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { assembleTurnBackground } from "../server/agent-context-assembly.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import {
  createChatDeliveryReviewObligation,
  enforceChatDeliveryReview,
  requiresChatDeliveryReview,
} from "../server/chat-delivery-review.ts";
import { createEmbeddingGateway, type EmbeddingActor } from "../server/embedding-gateway.ts";
import { FamilyError } from "../server/family-access.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { FirestoreDomainData } from "../server/firestore-domain-data.ts";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../server/firestore-knowledge.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreProductAgent } from "../server/firestore-product-agent.ts";
import { createFirestoreProactivePublicStore } from "../server/firestore-proactive-public.ts";
import { firestoreTopicStorageSchema } from "../server/firestore-memory.ts";
import { embeddingDocument, parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import {
  assertPublicKnowledgeQuery,
  findExternalQueryPrivacyViolation,
} from "../server/knowledge-query-minimization.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { knowledgeReviewHash, type KnowledgeReviewAssessment } from "../server/knowledge-review-assessment.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import {
  evaluateTimelyEligibility,
  proactiveKindForTimelyEvent,
  shouldAutoNotifyTimelyEvent,
  sqlTimelyEligibilityClause,
  TIMELY_KNOWLEDGE_POLICY_DEFAULTS,
} from "../server/knowledge-timely-policy.ts";
import {
  composeLiveSourceReaders,
  createLiveCommunityProductSearch,
  DEFAULT_LIVE_COMMUNITY_PRODUCT_DOMAINS,
  validateApprovedLiveUrl,
  validateLiveSourceClaims,
} from "../server/live-community-product-search.ts";
import { createOfficialLivePages } from "../server/official-live-pages.ts";
import { createProactiveEventSources } from "../server/proactive-event-sources.ts";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import {
  ALL_OFFICIAL_HELP_IDS,
  matchOfficialHelpForText,
  OFFICIAL_HELP,
} from "../src/shared/agent-feedback.ts";
import { agentStopMessage } from "../src/shared/agent-stop-message.ts";
import { sourceSeries } from "../src/shared/source-series.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import type { LiveSourceCitation } from "../src/shared/live-source-citation.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import { proactiveSettingsSchema } from "../frontend/src/production/proactive-settings-api.ts";
import { projectAgentRun, projectLiveCitation } from "../frontend/src/production/agent-projection.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const vector = [1, ...Array<number>(1023).fill(0)];
const generation = "44444444-4444-4444-8444-444444444444";

const baseAiConfig = readAiConfig({
  AI_ENABLED: "true",
  GCP_PROJECT_ID: "synthetic-req001-closeout",
  AI_DAILY_USER_ATTEMPTS: "20",
  AI_DAILY_GLOBAL_ATTEMPTS: "100",
});

function emptyMemoryContext(childId: string): MemoryContext {
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
    section: "嬰幼兒照護指引",
    sourceExcerpt: "滿6個月的健康足月嬰兒可開始按吞嚥準備信號引入固體食物。",
    originalText: "滿6個月的健康足月嬰兒可開始按吞嚥準備信號引入固體食物，繼續配合母乳或配方奶。",
    text: "衞生署指引：滿6個月嬰兒可按發展信號逐步引入固體食物。",
    keywords: ["加固", "6個月", "嬰兒飲食"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 4, maxAgeMonths: 12, topics: ["feeding"], conditions: [] },
    ...patch,
  };
}

function makeAssessment(current: KnowledgeSourceInput): KnowledgeReviewAssessment {
  return {
    comparedVersionId: null,
    comparedHash: null,
    observationHash: null,
    changes: current.chunks.map(chunk => ({
      key: chunk.key,
      oldQuote: null,
      newQuote: chunk.sourceExcerpt,
      meaning: "new",
      explanation: "Synthetic closeout verification assessment",
    })),
    checks: { age: "Reviewed", numbersAndUnits: "Reviewed", timing: "Reviewed", conditions: "Reviewed", exceptions: "Reviewed", prohibitions: "Reviewed", withdrawal: "Reviewed" },
    questions: [{ query: "6個月BB可以開始食糊仔嗎？", expectedKeys: current.chunks.map(c => c.key), reason: "Closeout check" }],
    growthRuleImpact: "none",
    growthRuleReason: "Synthetic fixture does not modify growth rules",
    decision: "approve",
  };
}

function createFirestoreKnowledgeHarness(sourceIds: readonly string[]) {
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
        const qVec = options.queryVector instanceof VectorValue ? options.queryVector.toArray() : options.queryVector;
        const docs = [...fake.records.entries()]
          .filter(([p]) => p.startsWith(query.path + "/"))
          .map(([p, raw]) => ({ p, row: decode(raw) }))
          .filter(({ row }) => query.filters.every(([k, op, val]: [string, string, any]) => op === "==" ? row[k] === val : op === "in" && val.includes(row[k])))
          .map(({ p, row }) => {
            const stored = row.embedding.toArray() as number[];
            const dot = stored.reduce((sum, val, idx) => sum + val * qVec[idx]!, 0);
            const norm = (arr: number[]) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
            const distance = 1 - Math.max(-1, Math.min(1, dot / (norm(stored) * norm(qVec))));
            return { id: p.split("/").at(-1), row: { ...row, [options.distanceResultField as string]: distance }, distance };
          })
          .filter(item => item.distance <= options.distanceThreshold!)
          .sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
          .slice(0, options.limit)
          .map(item => ({ id: item.id, data: () => item.row }));
        return { docs };
      },
    }),
  });
  const database = {
    collection: (pathKey: string) => wrap(fake.database.collection(pathKey)),
    runTransaction: (op: (tx: any) => Promise<any>) => fake.database.runTransaction(tx => op({
      get: async (target: any) => snapshot(await tx.get(target)),
      getAll: async (...targets: any[]) => (await tx.getAll(...targets)).map(snapshot),
      create: (ref: any, val: unknown) => tx.create(ref, encode(val)),
      set: (ref: any, val: unknown) => tx.set(ref, encode(val)),
      update: (ref: any, val: unknown) => tx.update(ref, encode(val)),
      delete: (ref: any) => tx.delete(ref),
    })),
  } as unknown as Firestore;

  const store = createFirestoreKnowledgeStore({
    database,
    projectId: "synthetic-req001-closeout",
    namespace: "synthetic_req001_closeout",
    cipher: createStorageCipher(Buffer.alloc(32, 42)),
    sourceIds: [...sourceIds],
  });

  async function publishSource(doc: KnowledgeSourceInput) {
    const imp = await store.importSource(doc);
    for (let page = 0; page < 8; page += 1) {
      if ((await store.prepareSearch(imp.versionId, imp.hash)).complete) break;
    }
    await store.review(imp.versionId, imp.hash, "synthetic-operator", makeAssessment(doc));
    const vectors: FirestoreKnowledgeEmbedding[] = doc.chunks.map(chunk => ({
      chunkKey: chunk.key,
      inputHash: embeddingDocument(doc.title, chunk.section, chunk.text).hash,
      ...KNOWLEDGE_EMBEDDING,
      values: vector,
    }));
    await store.publish(imp.versionId, imp.hash, vectors);
    return imp;
  }

  async function joinSeries(owner: string, doc: KnowledgeSourceInput, versionId: string) {
    const seriesId = sourceSeries(doc).id;
    await database.runTransaction(tx =>
      store.saveLibraryPreference(tx, owner, {
        action: "join",
        seriesId,
        expectedRevision: 0,
        editions: [{ sourceId: doc.sourceId, versionId }],
      }));
  }

  return { store, publishSource, joinSeries };
}

test("1. [R001-S01 & R001-S02] Colloquial A-class query cites reviewed official source; missing condition asks focused clarification", async () => {
  const userId = "parent-r001-01";
  const childId = "11111111-1111-4111-8111-111111111111";
  const runId1 = "22222222-2222-4222-8222-222222222222";
  const runId2 = "33333333-3333-4333-8333-333333333333";
  const msg1 = "44444444-4444-4444-8444-444444444441";
  const msg2 = "44444444-4444-4444-8444-444444444442";
  const harness = createFirestoreKnowledgeHarness(["fhs-solid-food"]);
  const doc = parseKnowledgeSource({
    sourceId: "fhs-solid-food",
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html",
    title: "嬰幼兒加固指引",
    publisher: "香港特別行政區政府衞生署家庭健康服務",
    classification: "official_guidance",
    sourcePublishedAt: "2026-01-01T00:00:00Z",
    sourceUpdatedAt: null,
    fetchedAt: "2026-10-01T00:00:00Z",
    termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html",
    chunks: [makeChunk("solid-food-start")],
  });
  const published = await harness.publishSource(doc);
  await harness.joinSeries(userId, doc, published.versionId);

  const embeddings = createEmbeddingGateway({
    config: baseAiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: { embed: async () => ({ values: vector, inputTokens: 4, billableCharacters: 12 }) },
  });
  const retriever = createKnowledgeRetriever(harness.store, embeddings);
  const preHit = (await harness.store.candidates({ region: "HK", classification: "official_guidance", age: null, ageMatch: "unknown", topics: [] }, vector, { query: "加固", libraryUserId: userId }))[0]!;

  // Run 1: Official guidance answer with citation & reviewer pass.
  let turn1 = 0;
  let saved1: ProductAgentResult | null = null;
  const agent1 = createProductAgent({
    runtime: createAgentRuntime({
      config: baseAiConfig,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const text = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
          if (text.includes("chat-delivery-review")) {
            const payload = JSON.parse(text.slice(text.indexOf("{"))) as { draftHash: string };
            return { content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] }, finishReason: FinishReason.STOP };
          }
          const call = turn1++ === 0
            ? { id: "s1", name: "search_knowledge", args: { query: "6個月BB 食糊仔 加固", classification: "official_guidance" } }
            : { id: "p1", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: "衞生署建議寶寶滿 6 個月並出現坐穩及吞嚥準備信號時開始引入固體食物。", citationIds: [preHit.chunkId] }] } };
          return { content: { role: "model", parts: [{ functionCall: call }] }, finishReason: FinishReason.STOP };
        },
      },
    }),
    store: {
      claim: async () => ({ runId: runId1, scope: { userId, childId, workspaceId: "ws-1", authorizationVersion: "1", dataVersion: "1" }, created: true, sourceMessageId: msg1, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      finish: async (_s: unknown, r: ProductAgentResult) => { saved1 = r; return true; },
      get: async () => saved1,
    } as any,
    memory: { context: async () => emptyMemoryContext(childId) } as any,
    chat: { listForUser: async () => ({ messages: [{ id: msg1, role: "user", text: "BB啱啱半歲可唔可以試食糊仔？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retriever,
  });

  const res1 = await agent1.reply(userId, childId, msg1, async () => true);
  assert.equal(res1?.status, "completed", `Test 1 stopped unexpectedly: ${JSON.stringify(res1)}`);
  assert.equal(res1?.citations.length, 1);
  assert.equal(res1?.citations[0]?.chunkId, preHit.chunkId);
  productAgentResultSchema.parse(res1);

  // R001-S02: Non-matching age bracket (2 months) excluded from age-contained filter.
  const wrongAge = await harness.store.candidates(
    { region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 2, maxMonths: 2 }, ageMatch: "contained", topics: [] },
    vector,
    { query: "加固", libraryUserId: userId },
  );
  assert.equal(wrongAge.length, 0);

  // Run 2: Missing decisive clinical detail triggers focused clarification without reviewer waste.
  let saved2: ProductAgentResult | null = null;
  let reviewCalled = false;
  const agent2 = createProductAgent({
    runtime: createAgentRuntime({
      config: baseAiConfig,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const text = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
          if (text.includes("chat-delivery-review")) {
            reviewCalled = true;
            const payload = JSON.parse(text.slice(text.indexOf("{"))) as { draftHash: string };
            return { content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] }, finishReason: FinishReason.STOP };
          }
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "c1",
                  name: "present_answer",
                  args: { kind: "clarification", paragraphs: [{ text: "請問孩子現時幾個月大？體溫多少度？發燒持續了多久？", citationIds: [] }] },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    }),
    store: {
      claim: async () => ({ runId: runId2, scope: { userId, childId, workspaceId: "ws-1", authorizationVersion: "1", dataVersion: "1" }, created: true, sourceMessageId: msg2, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      authorize: async () => true,
      finish: async (_s: unknown, r: ProductAgentResult) => { saved2 = r; return true; },
      get: async () => saved2,
    } as any,
    memory: { context: async () => emptyMemoryContext(childId) } as any,
    chat: { listForUser: async () => ({ messages: [{ id: msg2, role: "user", text: "退燒藥點食？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retriever,
  });

  const res2 = await agent2.reply(userId, childId, msg2, async () => true);
  assert.equal(res2?.status, "completed");
  assert.equal(reviewCalled, false);
  assert.match(res2?.text ?? "", /請問孩子現時幾個月大/);
});

test("2. [R001-S03 & R001-S04] Outbound query minimization blocks PII across main and ephemeral modes without clearing authorized internal context", async () => {
  const childId = "11111111-1111-4111-8111-111111111111";
  const privateIdentifiers = ["陳小明", "A123456(7)"];
  const leakyQueries = [
    "陳小明 2024-05-12 出生 住喺沙田瀝源邨福海樓12樓C室 +852 9123 4567 6個月發燒",
    "身份證：A123456(7) 沙田區幼兒疫苗",
    "家長：BB發燒點算\n助手：請提供年齡",
  ];
  for (const leaky of leakyQueries) {
    assert.notEqual(findExternalQueryPrivacyViolation(leaky, privateIdentifiers), null);
    assert.throws(() => assertPublicKnowledgeQuery(leaky, privateIdentifiers), err => err instanceof FamilyError && err.code === "public_query_required");
  }

  const minimized = "6個月 嬰兒 發燒 沙田區";
  assert.equal(findExternalQueryPrivacyViolation(minimized, privateIdentifiers), null);
  assert.equal(assertPublicKnowledgeQuery(minimized, privateIdentifiers), minimized);

  // Ephemeral mode uses blank private profile while maintaining external minimization.
  let memoryReadAttempted = false;
  const ephemeralBg = await assembleTurnBackground({
    scope: { userId: "parent-1", childId, workspaceId: "ws-1", authorizationVersion: "1", dataVersion: "1" },
    mode: "ephemeral",
    userText: "陳小明 6個月 沙田區 發燒點處理",
    authorize: async () => true,
    memory: {
      context: async () => {
        memoryReadAttempted = true;
        return emptyMemoryContext(childId);
      },
    } as any,
  });
  assert.equal(ephemeralBg.childProfile.reasonCode, "ephemeral_blank_scope");
  assert.equal(memoryReadAttempted, false);

  const liveSearch = createLiveCommunityProductSearch({
    knownPrivateIdentifiers: privateIdentifiers,
    discover: async () => {
      throw new Error("discover_must_not_run_on_pii");
    },
  });
  await assert.rejects(
    () => liveSearch.searchDetailed!("陳小明 2024-05-12 嬰兒奶粉", new AbortController().signal, "recent_information"),
    err => err instanceof FamilyError && err.code === "public_query_required",
  );
});

test("3. [R001-S05 & R001-S06] Long document adjacent segment read, insufficient-evidence honesty, and independent emergency help entry", async t => {
  const userId = "parent-r001-03";
  const childId = "11111111-1111-4111-8111-111111111111";
  const harness = createFirestoreKnowledgeHarness(["fhs-toddler-development"]);
  const doc = parseKnowledgeSource({
    sourceId: "fhs-toddler-development",
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/15654.html",
    title: "幼兒發展手冊例外條款",
    publisher: "香港特別行政區政府衞生署家庭健康服務",
    classification: "official_guidance",
    sourcePublishedAt: "2026-01-01T00:00:00Z",
    sourceUpdatedAt: null,
    fetchedAt: "2026-10-01T00:00:00Z",
    termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html",
    chunks: [
      makeChunk("part-1", { keywords: ["牛奶", "例外", "過敏"], section: "第一章：飲食通則", sourceExcerpt: "幼兒一歲後應逐步飲用全脂牛奶。", originalText: "幼兒一歲後應逐步飲用全脂牛奶，但切勿過早以普通牛奶代替母乳。", text: "一歲後可轉飲全脂牛奶，勿早於一歲代替母乳。" }),
      makeChunk("part-2", { keywords: ["牛奶", "例外", "過敏"], section: "第二章：例外與注意", sourceExcerpt: "早產或有對牛奶蛋白過敏病史者除外，須依醫護評估調整。", originalText: "例外：早產或曾對牛奶蛋白嚴重過敏者須按醫護評估選擇配方。", text: "牛奶蛋白嚴重過敏者屬於例外情況，須依醫護評估。" }),
    ],
  });
  const published = await harness.publishSource(doc);
  await harness.joinSeries(userId, doc, published.versionId);

  const embeddings = createEmbeddingGateway({
    config: baseAiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: { embed: async () => ({ values: vector, inputTokens: 4, billableCharacters: 12 }) },
  });
  const retriever = createKnowledgeRetriever(harness.store, embeddings);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  budget.configurePersonal({ modelCalls: 4, queryEmbeddings: 4, toolCalls: 8 });
  const run = retriever.createRun({
    actor: { kind: "query_embedding", actorId: userId, operationId: randomUUID() } satisfies EmbeddingActor,
    budget,
    authorize: async () => true,
  });
  const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, ageMatch: "unknown", topics: [] };
  const found = await run.search("牛奶 例外 過敏", filter);
  assert.equal(found.chunks.length, 2);
  const adj = await run.readContext(found.chunks[0]!, filter, null);
  assert.ok(adj.chunks.some(c => c.key === "part-2" && c.original.text.includes("牛奶蛋白嚴重過敏")));

  // Independent urgent help entry vs medication caution distinction.
  assert.deepEqual(matchOfficialHelpForText("BB 抽筋 呼吸困難 叫唔醒"), ["emergency-hk-v1"]);
  assert.deepEqual(matchOfficialHelpForText("發燒想知退燒藥點食"), ["medical-consult-hk-v1"]);
  assert.ok(ALL_OFFICIAL_HELP_IDS.includes("emergency-hk-v1"));
  assert.ok(OFFICIAL_HELP["emergency-hk-v1"].title.length > 0);
});

test("4. [R001-S10, R001-S11 & R001-S12] B-class checkpoint reuse when unchanged, news filtered out of auto push, recall withdrawn when lifted, and user preferences validated", async () => {
  const f = firestoreDomainFixture();
  const watchRecall = SOURCE_WATCHES[0]!;
  const watchNews = SOURCE_WATCHES[1]!;
  const at = "2026-11-20T08:00:00Z";
  const childId = "11111111-1111-4111-8111-111111111111";
  const userId = "parent-r001-04";
  const options = {
    database: f.database,
    cipher: createStorageCipher(Buffer.alloc(32, 91)),
    projectId: "synthetic-req001-proactive",
    namespace: "synthetic_req001_proactive",
    serverClock: () => Date.parse(at),
  };
  await createFirestoreAuthority(options).initializeControl({ generation, enabled: true });

  // Validate setting toggle schema (enable / opt-out).
  assert.equal(proactiveSettingsSchema.parse({ enabled: true, timeZone: "Asia/Hong_Kong", version: 1 }).enabled, true);
  assert.equal(proactiveSettingsSchema.parse({ enabled: false, timeZone: "Asia/Hong_Kong", version: 2 }).enabled, false);

  // Verify shouldAutoNotifyTimelyEvent allows rolling news in 7-day chat search while suppressing auto push.
  assert.equal(shouldAutoNotifyTimelyEvent("recent_information", { kind: "news", status: "active" }), false);
  assert.equal(shouldAutoNotifyTimelyEvent("recent_information", { kind: "recall", status: "active" }), true);
  assert.equal(
    evaluateTimelyEligibility({
      classification: "recent_information",
      sourcePublishedAt: "2026-11-18T08:00:00Z",
      lastSuccessfulCheckAt: at,
      timelyEvent: { kind: "news", status: "active" },
    }, Date.parse(at)).reason,
    "within_recent_window",
  );

  f.records.set(`${options.namespace}_knowledge_sources/src-recall`, {
    schemaVersion: 1, projectId: options.projectId, namespace: options.namespace,
    sourceId: "src-recall", activeVersionId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", enabled: true, revision: "1",
  });
  f.records.set(`${options.namespace}_knowledge_sources/src-news`, {
    schemaVersion: 1, projectId: options.projectId, namespace: options.namespace,
    sourceId: "src-news", activeVersionId: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", enabled: true, revision: "1",
  });

  let recallStatus: "active" | "lifted" = "active";
  let versionHash = "a".repeat(64);
  let contentHash = "b".repeat(64);
  let editionReads = 0;

  const makeCandidate = (sourceId: string, kind: "recall" | "news", url: string, termsUrl: string, publisher: string): KnowledgeCandidate & { termsUrl: string } => ({
    chunkId: kind === "recall" ? "77777777-7777-4777-8777-777777777777" : "88888888-8888-4888-8888-888888888888",
    sourceId,
    versionId: kind === "recall" ? "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    versionHash,
    contentHash,
    key: kind === "recall" ? "recall-k" : "news-k",
    section: kind === "recall" ? "配方安全召回" : "一般社區新聞",
    sourceExcerpt: kind === "recall" ? "預防性奶粉批次召回。" : "一般親子活動新聞。",
    text: kind === "recall" ? "預防性奶粉批次召回。" : "一般親子活動新聞。",
    keywords: ["奶粉", "活動"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["care"], conditions: [] },
    url,
    termsUrl,
    title: kind === "recall" ? "重要產品召回" : "一般日常新聞",
    publisher,
    classification: "recent_information",
    sourcePublishedAt: "2026-11-18T08:00:00Z",
    sourceUpdatedAt: null,
    validUntil: null,
    timelyEvent: { kind, status: kind === "recall" ? recallStatus : "active" },
    fetchedAt: at,
    checkedAt: at,
    lastSuccessfulCheckAt: at,
    usageScope: "public_noncommercial",
    reviewState: "reviewed",
    distance: null,
  });

  const sources = createProactiveEventSources({
    ...options,
    sourceIds: ["src-recall", "src-news"],
    care: {
      async readProfile() {
        return {
          childId, version: 1, confirmedBy: userId, confirmedAt: at, reason: "confirmed",
          data: { age: { kind: "birth_date", date: "2026-01-01" }, region: "香港", dueDate: null, gestationalWeeksRaw: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: "confirmed", validUntil: null },
        } as any;
      },
    },
    knowledge: {
      async publishedEdition(id: string) {
        editionReads += 1;
        const ev = id === "src-recall"
          ? makeCandidate("src-recall", "recall", watchRecall.url, watchRecall.termsUrl, watchRecall.publisher)
          : makeCandidate("src-news", "news", watchNews.url, watchNews.termsUrl, watchNews.publisher);
        return {
          versionId: ev.versionId, versionHash: ev.versionHash, observationHash: null,
          chunkIdentities: [{ key: ev.key, chunkId: ev.chunkId, contentHash: ev.contentHash }],
          enabled: true, current: id === "src-news" || recallStatus === "active",
          source: {
            sourceId: ev.sourceId, url: ev.url, title: ev.title, publisher: ev.publisher,
            classification: ev.classification, sourcePublishedAt: ev.sourcePublishedAt, sourceUpdatedAt: null,
            validUntil: null, timelyEvent: ev.timelyEvent, fetchedAt: at, termsUrl: ev.termsUrl,
            chunks: [{ key: ev.key, section: ev.section, sourceExcerpt: ev.sourceExcerpt, text: ev.text, applicability: ev.applicability, keywords: ev.keywords }],
          },
        };
      },
      async ruleCandidates() {
        return recallStatus === "active"
          ? [makeCandidate("src-recall", "recall", watchRecall.url, watchRecall.termsUrl, watchRecall.publisher)]
          : [];
      },
    },
  });

  const data = new FirestoreDomainData(options);
  const scope = { ownerUserId: userId, childId, workspaceId: "55555555-5555-4555-8555-555555555555", storageEpoch: "66666666-6666-4666-8666-666666666666" };
  const topicId = "99999999-9999-4999-8999-999999999999";
  f.records.set(data.ref("memory_topics", "memory-topic", topicId).path, {
    ...data.tags(scope), live: true, visibility: "family", entityId: topicId,
    ...data.seal("memory-topic", topicId, scope, firestoreTopicStorageSchema, {
      id: topicId, childId, visibility: "family", title: "奶粉", note: "", status: "pending", version: 1,
      updatedBy: userId, updatedAt: at, resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true,
    }),
  });

  await sources.prepareGlobal({ force: true });
  const readsAfterFirst = editionReads;
  assert.equal(readsAfterFirst, 2);

  // R001-S10: Unchanged source pointers reuse checkpoint without redundant rebuild/notification.
  await sources.prepareGlobal({ force: false });
  assert.equal(editionReads, readsAfterFirst);

  const txBinding = (tx: any) => ({ transaction: tx, actorUserId: userId, childAccessVersion: "1", scope, async readChild() { return { id: childId }; } }) as any;
  const cand1 = await f.database.runTransaction(tx => sources.readCandidates(txBinding(tx)));
  const cand2 = await f.database.runTransaction(tx => sources.readCandidates(txBinding(tx)));
  // General news filtered out; recall present and stably deduplicated by semanticId & assessmentId.
  assert.equal(cand1.candidates.length, 1);
  assert.equal(cand1.candidates[0]!.kind, "recall");
  assert.equal(cand1.candidates[0]!.semanticId, cand2.candidates[0]!.semanticId);
  assert.equal(cand1.candidates[0]!.assessmentId, cand2.candidates[0]!.assessmentId);

  // R001-S11: Lifting recall withdraws proactive candidate cleanly.
  recallStatus = "lifted";
  versionHash = "c".repeat(64);
  contentHash = "d".repeat(64);
  f.records.get(`${options.namespace}_knowledge_sources/src-recall`).revision = "2";
  await sources.prepareGlobal({ force: true });
  const afterLift = await f.database.runTransaction(tx => sources.readCandidates(txBinding(tx)));
  assert.equal(afterLift.candidates.length, 0);
  assert.ok(afterLift.excluded.some(e => e.reason === "inactive"));
});

test("5. [R001-S11] Timely lifecycle statuses (corrected, lifted, superseded, expired, stale check) fail closed across policy & SQL clause", () => {
  const now = Date.parse("2026-11-20T09:00:00Z");
  const recentPub = "2026-11-18T08:00:00Z";
  const oldPub = "2026-11-01T08:00:00Z";
  const freshCheck = "2026-11-20T05:00:00Z";
  const staleCheck = "2026-11-18T00:00:00Z";

  assert.equal(evaluateTimelyEligibility({
    classification: "recent_information", sourcePublishedAt: recentPub, lastSuccessfulCheckAt: freshCheck,
    timelyEvent: { kind: "policy_change", status: "corrected", supersededBySourceId: "chp-new-policy" },
    validUntil: "2026-12-01T00:00:00Z",
  }, now).reason, "active_until_deadline");

  for (const status of ["lifted", "superseded", "expired"] as const) {
    const decision = evaluateTimelyEligibility({
      classification: "recent_information", sourcePublishedAt: oldPub, lastSuccessfulCheckAt: freshCheck,
      timelyEvent: { kind: "recall", status, ...(status === "superseded" ? { supersededBySourceId: "chp-recall-v2" } : {}) },
    }, now);
    assert.equal(decision.eligible, false);
    assert.equal(decision.retainProvenanceOnly, true);
  }

  assert.equal(evaluateTimelyEligibility({
    classification: "recent_information", sourcePublishedAt: recentPub, lastSuccessfulCheckAt: staleCheck,
    timelyEvent: { kind: "safety_alert", status: "active" },
  }, now).reason, "check_stale");

  assert.equal(evaluateTimelyEligibility({
    classification: "recent_information", sourcePublishedAt: recentPub, lastSuccessfulCheckAt: freshCheck,
    validUntil: "2026-11-19T00:00:00Z",
    timelyEvent: { kind: "deadline", status: "active" },
  }, now).reason, "valid_until_expired");

  const sql = sqlTimelyEligibilityClause();
  assert.match(sql, /IN \('active', 'corrected'\)/);
  assert.match(sql, /interval '24 hours'/);
});

test("6. [R001-S13 & R001-S14] C-class reader composition enforces allowlist, cautions, conflict detection, claim guard, and zero persistent forum library", async () => {
  const officialLive = createOfficialLivePages({
    sourceIds: ["fhs-solid-food"],
    mayRead: async () => true,
    fetchSource: async () => ({
      status: "ok",
      items: [{
        url: "https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html",
        title: "衞生署配方奶指引",
        text: "一般嬰兒可選用第一階段配方奶粉。",
        sourcePublishedAt: "2026-01-01",
        sourceUpdatedAt: null,
        sourceDateText: null,
      }],
    }),
  });
  const communityLive = createLiveCommunityProductSearch({
    now: () => new Date("2026-11-20T09:00:00Z"),
    discover: async () => [
      { url: "https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=1", title: "1號奶粉沖調經驗" },
      { url: "https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=2", title: "同款奶粉另位家長分享" },
      { url: "https://www.baby-kingdom.com/member/login.php", title: "會員專區" },
    ],
    transport: async (url, validate) => {
      validate(url);
      if (url.includes("tid=1")) {
        return {
          status: "response",
          response: {
            status: 200, url, contentType: "text/html; charset=utf-8",
            body: Buffer.from(`<html><body><time datetime="2026-10-10">2026-10-10</time><main>品牌：BrandX 型號：Stage-1 港版 HK$280 好用易溶無結塊。</main></body></html>`, "utf8"),
          },
        };
      }
      return {
        status: "response",
        response: {
          status: 200, url, contentType: "text/html; charset=utf-8",
          body: Buffer.from(`<html><body><time datetime="2026-11-01">2026-11-01</time><main>品牌：BrandX 型號：Stage-1 歐版 HK$240 合作試用推薦，但我仔飲完少許便秘不適。</main></body></html>`, "utf8"),
        },
      };
    },
  });
  const composed = composeLiveSourceReaders(officialLive, communityLive);
  const res = await composed.searchDetailed!("BrandX 1號 奶粉", new AbortController().signal, "recent_information");
  assert.equal(res.reads.length, 2);
  assert.ok(res.reads.some(r => r.cautions?.includes("self_reported_unverified")));
  assert.ok(res.reads.some(r => r.cautions?.includes("conflicting_claims")));
  assert.ok(res.reads.some(r => r.cautions?.includes("suspected_promotional")));
  assert.ok(res.limitations.some(l => l.reason === "login_or_access_restricted"));

  assert.throws(() => validateApprovedLiveUrl("https://evil.example.org/post"), /unapproved_live_url/);
  const c1Citation = { id: "c1", sourceKind: "community_discussion", classification: "recent_information" } as LiveSourceCitation;
  assert.throws(
    () => validateLiveSourceClaims([{ text: "90%家長實測推薦必買這款最好奶粉。", citationIds: ["c1"] }], "public_information", new Map([["c1", c1Citation]]), () => false),
    err => err instanceof FamilyError && err.code === "unsupported_live_claim",
  );
  assert.doesNotThrow(
    () => validateLiveSourceClaims([{ text: "兩位家長分別分享港版（HK$280）較易溶及歐版（HK$240）偏便秘的個別經驗。", citationIds: ["c1"] }], "public_information", new Map([["c1", c1Citation]]), () => false),
  );
});

test("7. [R001-S15] Progressive disclosure keeps collapsed AnswerSources concise and shows timelyEvent & live non-color markers on expand", () => {
  const placeholder = new Proxy({}, { get: (_t, key) => String(key) });
  const node = (type: unknown, props: unknown) => ({ type, props });
  function createLoader(selectedId: string | null) {
    const cache = new Map<string, any>();
    const load = (entry: string): any => {
      const file = path.resolve(root, entry);
      if (cache.has(file)) return cache.get(file).exports;
      const mod = { exports: {} };
      cache.set(file, mod);
      const code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText;
      const overrides: Record<string, any> = {
        react: {
          createContext: (def: unknown) => ({ _def: def, Provider: "Provider" }),
          useContext: (ctx: any) => ctx._current ?? ctx._def ?? null,
          useId: () => "synthetic-r001",
          useLayoutEffect() {},
          useRef: (v: unknown) => ({ current: v ?? null }),
          useState: (initial: unknown) => [initial === null ? selectedId : initial, () => {}],
          Fragment: "Fragment",
        },
        "react/jsx-runtime": { jsx: node, jsxs: node, Fragment: "Fragment" },
        "react-native": { Platform: { OS: "web" }, Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: (v: unknown) => v }, View: "View", useWindowDimensions: () => ({ width: 1024, fontScale: 1 }), Linking: { openURL: async () => {} } },
        "react-native-paper": { Text: "Text", ActivityIndicator: "ActivityIndicator" },
        "../../preview/PreviewNavigationGuard": { PreviewLink: "PreviewLink" },
        "../AppDialog": { AppDialog: Object.assign("AppDialog", { ScrollArea: "ScrollArea", Actions: "Actions" }) },
        "../memory/SourceDocumentCard": { SourceDocumentCard: "SourceDocumentCard" },
        "../memory/PlatformCardJoin": { PlatformCardJoin: "PlatformCardJoin" },
        "../ui": { AppButton: "AppButton" },
        "../AppIcon": { AppIcon: "AppIcon" },
        "../../theme": { colors: { ink: "#272343", deepTeal: "#272343", paper: "#FFFFFE", canvas: "#F7FCFC", sage: "#BAE8E8", line: "#CAC9D4", controlOutline: "#737284", quietSurface: "#EDFAF9", paleAmber: "#FFF7D8", statusWarmLine: "#A38B19", warningInk: "#5E4F0C" }, spacing: placeholder, chineseFont: "synthetic" },
        "../../motion": { MotionDisclosure: ({ children }: any) => children, MotionEntrance: ({ children }: any) => children },
        "./locateCitationSource": { locateCitationSource() {} },
        "./chat-presentation": { chatColors: placeholder, chatFont: "synthetic", chatLayout: placeholder, chatType: placeholder },
      };
      new Function("require", "module", "exports", code)((name: string) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith(".")) return require(name);
        let target = path.resolve(path.dirname(file), name);
        if (!existsSync(target) && existsSync(`${target}.ts`)) target += ".ts";
        else if (!existsSync(target) && existsSync(`${target}.tsx`)) target += ".tsx";
        return load(target);
      }, mod, mod.exports);
      return mod.exports;
    };
    return load;
  }
  const collectText = (v: any): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(collectText).join(" ");
    if (v && typeof v === "object") {
      if (typeof v.type === "function") return collectText(v.type(v.props));
      return [collectText(v.props?.children), v.props?.title, v.props?.byline, v.props?.label].filter(x => typeof x === "string").join(" ");
    }
    return "";
  };

  const markerTree = createLoader(null)("frontend/src/components/chat/CitationMarker.tsx").CitationMarker({
    number: 1, label: "查看引用【1】（即時搜尋）", live: true, onPress() {},
  });
  assert.ok(collectText(markerTree).includes("【1·即時】"));

  const liveCitation: LiveSourceCitation = {
    id: randomUUID(), acquisition: "live", classification: "recent_information", sourceKind: "community_discussion",
    documentId: "bk:test", title: "討論串", publisher: "親子王國 Baby Kingdom",
    url: "https://www.baby-kingdom.com/forum.php?mod=viewthread&tid=55",
    termsUrl: "https://www.baby-kingdom.com/terms.php", fetchedAt: "2026-11-20T08:00:00Z", version: null,
    sourceDate: "2026-11-01", section: null, page: null, conditions: [],
    productSpec: { model: "S1", priceText: "HK$260" }, cautions: ["self_reported_unverified"],
    contentHash: "a".repeat(64), range: { start: 0, end: 8 }, rights: "retain_excerpt", excerpt: "家長自述沖調經驗",
  };
  const view = projectLiveCitation(liveCitation);
  const collapsed = collectText(createLoader(null)("frontend/src/components/chat/AnswerSources.tsx").AnswerSources({
    sources: [view], children: "參考【1】。",
  }));
  assert.ok(collapsed.includes("即時搜尋 · 社群經驗"));
  assert.doesNotMatch(collapsed, /a{64}|自述未經獨立核實/);
  const expanded = collectText(createLoader(view.id)("frontend/src/components/chat/AnswerSources.tsx").AnswerSources({
    sources: [view], children: "參考【1】。",
  }));
  assert.ok(expanded.includes("商品規格／型號"));
  assert.ok(expanded.includes("使用者自述"));
});

test("8. [R001-S07, R001-S08 & R001-S09] Delivery review blocks uncited care claims, enforces single terminal status, and allows safe original run recovery", async t => {
  const userId = "parent-r001-08";
  const childId = "11111111-1111-4111-8111-111111111111";
  const msgId = "66666666-6666-4666-8666-666666666666";
  const runId = "77777777-7777-4777-8777-777777777777";
  const scope = { userId, childId, workspaceId: "ws-1", authorizationVersion: "1", dataVersion: "epoch:1" };

  // Uncited high-risk directive claim fails closed.
  const budget = new AgentBudget();
  t.after(() => budget.close());
  budget.configurePersonal({ modelCalls: 4, queryEmbeddings: 2, toolCalls: 4 });
  const presentation = {
    text: "可自行給三個月嬰兒服用退燒藥水 5ml。",
    citations: [],
    privateSourceCitations: [],
    retrievalMode: "not_used" as const,
  };
  const draft = {
    kind: "caregiving" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    scope,
    paragraphs: [{ text: presentation.text, citationIds: [] }],
    sources: [],
  };
  await assert.rejects(
    () => enforceChatDeliveryReview({
      presentation,
      tools: { presentation: async () => presentation, deliveryDraft: () => draft, replaceDeliveryAnswer() {} },
      context: {
        runId,
        scope,
        budget,
        authorize: async () => true,
        deliveryReview: createChatDeliveryReviewObligation(),
        completeText: async ({ user }: { user: string }) => {
          const parsed = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string };
          return JSON.stringify({ draftHash: parsed.draftHash, decision: "pass", issues: [] });
        },
      } as any,
      provenance: { packVersion: "0.1.68", model: "gemini-3.1-flash-lite" },
    }),
    err => err instanceof AgentStopped && err.reason === "delivery_review_no_sources",
  );
  assert.equal(requiresChatDeliveryReview(draft), true);

  // Disconnected/stopped original run recovers via original messageId without duplicating execution.
  assert.match(agentStopMessage("model_limit") ?? "", /次數/);
  const existingReply = { id: randomUUID(), childId, role: "model" as const, authorUserId: null, text: "已核對原回答", inReplyTo: msgId, agentRunId: runId, createdAt: "2026-11-20T09:00:00Z" };
  let agentInvocations = 0;
  const response = await handleProductAgentRequest(
    new Request(`https://synthetic.invalid/api/children/${childId}/messages/${msgId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-expected-user-id": userId },
      body: "{}",
    }),
    userId,
    {
      agent: { reply: async () => { agentInvocations += 1; return null; }, cancelReply: async () => false } as any,
      store: { get: async () => ({ runId, provenance: null, status: "completed", stopReason: null, text: "已核對原回答", citations: [], retrievalMode: "not_used", tools: [], countsKnown: true, counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] }) } as any,
      chat: { listForUser: async () => ({ messages: [existingReply] }), getOriginalMessageForUser: async () => existingReply } as any,
      isCurrentUser: async expected => expected === userId,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(agentInvocations, 0);
  const body = await response.json() as { message: { text: string; agentRunId: string } };
  assert.equal(body.message.agentRunId, runId);
});

test("9. [R001-D01..R001-D08] Programmatic policy constants & liveSourceReader seam match settled REQ-001 §8 decisions", async () => {
  assert.equal(TIMELY_KNOWLEDGE_POLICY_DEFAULTS.recentNewsWindowDays, 7);
  assert.equal(TIMELY_KNOWLEDGE_POLICY_DEFAULTS.checkFreshnessHours, 24);
  assert.equal(TIMELY_KNOWLEDGE_POLICY_DEFAULTS.observationLookbackDays, 180);
  assert.ok(SOURCE_WATCHES.some(w => w.id === "fhs-solid-food" && w.url.endsWith(".html") && new URL(w.url).hostname.endsWith(".gov.hk")));
  assert.deepEqual(
    DEFAULT_LIVE_COMMUNITY_PRODUCT_DOMAINS.map(d => d.host),
    ["www.baby-kingdom.com", "www.consumer.org.hk", "www.cfs.gov.hk"],
  );
  assert.equal(SERVICE_POLICY_VERSION.length > 0, true);
  assert.equal(proactiveKindForTimelyEvent("recent_information", { kind: "recall", status: "active" }), "recall");

  // End-to-end Firestore ProductAgent works cleanly with liveSourceReader seam.
  const f = firestoreDomainFixture();
  const options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 77)), projectId: "synthetic-r001-d08", namespace: "synthetic_r001_d08" };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation });
  const user = "parent-r001-d08";
  const email = "parent-r001-d08@example.test";
  await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 90_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: user, email, emailVerified: true });
  await authority.acknowledge({ userId: user, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { scope } = await authority.createChild({ userId: user, operationId: randomUUID(), displayName: "合成寶寶" });
  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const message = await chat.createUserMessageForUser(user, scope.childId, "一般照顧參考");
  assert.ok(message);
  const liveCommunity = createLiveCommunityProductSearch({
    discover: async () => [],
  });
  const runtimeAgent = await createFirestoreProductAgent({
    ...options,
    chat,
    care,
    memory,
    online,
    liveSourceReader: liveCommunity,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId }),
    platformProvider: {
      generate: async request => {
        const txt = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
        if (txt.includes("chat-delivery-review")) {
          const payload = JSON.parse(txt.slice(txt.indexOf("{"))) as { draftHash: string };
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
          };
        }
        return {
          content: { role: "model", parts: [{ functionCall: { id: "c", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: "請問孩子現時幾個月大？", citationIds: [] }] } } }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
        };
      },
    },
  });
  const reply = await runtimeAgent.agent.reply(user, scope.childId, message.id, async () => true);
  assert.equal(reply?.status, "completed", JSON.stringify(reply));
  assert.deepEqual(projectAgentRun(reply!, scope.childId, null).citations, []);
});

test("10. [§7 & §8 Audit] PLAN.md and docs/REQUIREMENTS_BACKLOG.md stay consistent, honest on remaining live gates, and free of forbidden working codes", () => {
  const plan = readFileSync(path.join(root, "PLAN.md"), "utf8");
  const backlog = readFileSync(path.join(root, "docs", "REQUIREMENTS_BACKLOG.md"), "utf8");
  const worklog = readFileSync(path.join(root, "WORKLOG.md"), "utf8");

  assert.ok(plan.includes('<a id="req001-closeout01"></a>'));
  assert.ok(backlog.includes("PLAN.md#req001-closeout01"));

  for (let i = 1; i <= 15; i += 1) {
    const id = `R001-S${String(i).padStart(2, "0")}`;
    assert.ok(plan.includes(`**${id}**`), `PLAN.md#req001-closeout01 missing ${id}`);
  }
  for (let i = 1; i <= 8; i += 1) {
    const id = `R001-D${String(i).padStart(2, "0")}`;
    assert.ok(plan.includes(`**${id}**`), `PLAN.md#req001-closeout01 missing ${id}`);
  }

  // Honest disclosure on unexecuted live/device gates and unmerged REQ-003 stack.
  const closeoutSection = plan.slice(plan.indexOf('<a id="req001-closeout01"></a>'));
  assert.match(closeoutSection, /--live/);
  assert.match(closeoutSection, /#690.*#701/);
  assert.match(closeoutSection, /實機/);

  const forbidden = /\b(?:B-P\d+|PR-[A-E]|BND-\w+|H2-R\d+|N18-\w+|R\d{1,2}|Slice\s+B)\b/u;
  assert.equal(forbidden.test(closeoutSection), false, "Forbidden working code detected in PLAN closeout section");
  const worklogTail = worklog.slice(worklog.lastIndexOf("### 2026-11-20　REQ-001"));
  assert.equal(forbidden.test(worklogTail), false, "Forbidden working code detected in WORKLOG REQ-001 entry");
});
