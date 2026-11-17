import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { FinishReason } from "@google/genai";
import type { Pool } from "pg";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import type { EmbeddingActor, EmbeddingUsage } from "../server/embedding-gateway.ts";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../server/firestore-knowledge.ts";
import { embeddingDocument, parseKnowledgeFilter, parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import { baseAgentKnowledgeFilter, profileKnowledgeAge, resolveKnowledgeQueryContext } from "../server/knowledge-query-context.ts";
import { rankKnowledge } from "../server/knowledge-ranking.ts";
import { accumulateKnowledgeRead } from "../server/knowledge-read-coverage.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import type { KnowledgeReviewAssessment } from "../server/knowledge-review-assessment.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import {
  chatDeliveryDraftHash,
  chatDeliveryPassNeedsSources,
  chatDeliveryReviewSourceExcerpt,
  createChatDeliveryReviewObligation,
  draftLooksLikeDirectiveCareAdvice,
  draftLooksLikeSubstantiveCareAdvice,
  enforceChatDeliveryReview,
  isPureClarifyingQuestion,
  isPureScopeRefusalOrLimitation,
  isPureVerifiedOperationSummary,
  requiresChatDeliveryReview,
} from "../server/chat-delivery-review.ts";
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT } from "../src/shared/chat-delivery-review.ts";
import { agentStopDetailHint, agentStopMessage } from "../src/shared/agent-stop-message.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { LOCAL_OFFICIAL_SEED_IDS, buildLocalOfficialSeedAssessment } from "../scripts/local-knowledge-assessments.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";

const userId = "synthetic-parent-01";
const childId = "11111111-2222-4333-8444-555555555555";
const runId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const messageId = "ffffffff-1111-4222-8333-444444444444";
const versionUuid = "22222222-3333-4444-8555-666666666666";
const chunkFeverId = "33333333-4444-4555-8666-777777777777";
const chunkVomitId = "44444444-5555-4666-8777-888888888888";
const chunkSolidId = "55555555-6666-4777-8888-999999999999";
const scope = { userId, childId, workspaceId: "workspace-hk", authorizationVersion: "1", dataVersion: "epoch:1" };
const vector = [1, ...Array<number>(1023).fill(0)];
const visionVector = [0, 1, ...Array<number>(1022).fill(0)];
const unrelatedTopicVector = [0, 0, 1, ...Array<number>(1021).fill(0)];

function topicVectorForText(text: string): number[] {
  if (/視力|護眼|驗眼|vision/i.test(text)) return visionVector;
  if (/發熱|發燒|打針|肚瀉|紅屁股|唔肯食|唔開胃/u.test(text)) return unrelatedTopicVector;
  return vector;
}

const queryActor: EmbeddingActor = {
  kind: "query_embedding", actorId: userId, operationId: runId,
};

const config = readAiConfig({
  AI_ENABLED: "true",
  GCP_PROJECT_ID: "synthetic-project",
  AI_DAILY_USER_ATTEMPTS: "5",
  AI_DAILY_GLOBAL_ATTEMPTS: "50",
});

function fakeUsage(): EmbeddingUsage {
  return {
    reserve: async () => true,
    record: async () => {},
  };
}

function fakeEmbeddingGateway(useTopicVectors = false) {
  return createEmbeddingGateway({
    config,
    usage: fakeUsage(),
    provider: {
      embed: async request => ({
        values: useTopicVectors ? topicVectorForText(request.text) : vector,
        inputTokens: 4,
        billableCharacters: 16,
      }),
    },
  });
}

async function loadCuratedSeedSources(): Promise<KnowledgeSourceInput[]> {
  const rawSeed = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8")) as unknown[];
  return rawSeed.map(item => parseKnowledgeSource(item));
}

async function loadLocalDevelopmentManifest(): Promise<{ sourceId?: string; versionHash?: string; assessment?: unknown }> {
  return JSON.parse(await readFile(new URL("../knowledge/local-development-seed.json", import.meta.url), "utf8")) as {
    sourceId?: string;
    versionHash?: string;
    assessment?: unknown;
  };
}

function createInMemoryFirestoreKnowledgeStore(sourceIds: readonly string[]) {
  const fake = firestoreDomainFixture();
  const encode = (value: any): any => value instanceof VectorValue
    ? { syntheticVector: value.toArray() }
    : Array.isArray(value)
      ? value.map(encode)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))
        : value;
  const decode = (value: any): any => value && typeof value === "object" && Object.keys(value).length === 1 && Array.isArray(value.syntheticVector)
    ? FieldValue.vector(value.syntheticVector)
    : Array.isArray(value)
      ? value.map(decode)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]))
        : value;
  const snapshot = (snap: any) => ({ ...snap, data: () => decode(snap.data()), get: (k: string) => decode(snap.get(k)) });
  const wrapQuery = (query: any): any => ({
    ...query,
    where: (...args: any[]) => wrapQuery(query.where(...args)),
    findNearest: (options: VectorQueryOptions) => ({
      async get() {
        const qVec = options.queryVector instanceof VectorValue ? options.queryVector.toArray() : options.queryVector;
        const docs = [...fake.records.entries()]
          .filter(([path]) => path.startsWith(query.path + "/"))
          .map(([path, raw]) => ({ path, row: decode(raw) }))
          .filter(({ row }) => query.filters.every(([k, op, v]: [string, string, any]) => (op === "==" ? row[k] === v : op === "in" && v.includes(row[k]))))
          .map(({ path, row }) => {
            const stored = row.embedding.toArray() as number[];
            const dot = stored.reduce((sum, val, idx) => sum + val * qVec[idx]!, 0);
            const norm = (arr: number[]) => Math.sqrt(arr.reduce((sum, val) => sum + val * val, 0));
            const distance = 1 - Math.max(-1, Math.min(1, dot / (norm(stored) * norm(qVec))));
            return { id: path.split("/").at(-1), row: { ...row, [options.distanceResultField as string]: distance }, distance };
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
    collection: (path: string) => wrapQuery(fake.database.collection(path)),
    runTransaction: (op: (tx: any) => Promise<any>) => fake.database.runTransaction(tx => op({
      get: async (target: any) => snapshot(await tx.get(target)),
      getAll: async (...targets: any[]) => (await tx.getAll(...targets)).map(snapshot),
      create: (ref: any, val: unknown) => tx.create(ref, encode(val)),
      set: (ref: any, val: unknown) => tx.set(ref, encode(val)),
      delete: (ref: any) => tx.delete(ref),
    })),
  } as unknown as Firestore;

  const store = createFirestoreKnowledgeStore({
    database,
    projectId: "synthetic-knowledge-project",
    namespace: "synthetic_knowledge",
    sourceIds: [...sourceIds],
  });

  async function publishSource(
    document: KnowledgeSourceInput,
    assessment: KnowledgeReviewAssessment,
    valuesForChunk: (chunkKey: string) => number[],
  ) {
    const imported = await store.importSource(document);
    for (let page = 0; page < 16; page++) {
      if ((await store.prepareSearch(imported.versionId, imported.hash)).complete) break;
    }
    await store.review(imported.versionId, imported.hash, "synthetic-operator", assessment);
    const vectors: FirestoreKnowledgeEmbedding[] = document.chunks.map(ch => ({
      chunkKey: ch.key,
      inputHash: embeddingDocument(document.title, ch.section, ch.text).hash,
      ...KNOWLEDGE_EMBEDDING,
      values: valuesForChunk(ch.key),
    }));
    await store.publish(imported.versionId, imported.hash, vectors);
    return imported;
  }

  return { store, publishSource };
}

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

function mockChunk(id: string, overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId: id,
    distance: 0.08,
    key: `key-${id.slice(0, 8)}`,
    section: "嬰幼兒常見護理",
    sourceExcerpt: "嬰兒吐奶或溢奶若精神良好屬生理現象，可分次少量餵哺及拍嗝。",
    text: "嬰兒吐奶或溢奶若精神良好屬常見生理現象，建議家長少量多餐、餵奶後保持直立拍嗝。若伴隨高燒、噴射狀嘔吐或脫水徵狀，應向醫生求診。",
    keywords: ["吐奶", "溢奶", "拍嗝"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["vomiting", "feeding"], conditions: [] },
    sourceId: "src-fhs-feeding",
    versionId: versionUuid,
    versionHash: "d".repeat(64),
    contentHash: "c".repeat(64),
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/feeding.html",
    title: "衛生署家庭健康服務 - 嬰兒餵哺與吐奶護理指南",
    publisher: "香港特別行政區政府衛生署",
    classification: "official_guidance",
    sourcePublishedAt: "2024-01-01T00:00:00Z",
    sourceUpdatedAt: "2025-01-01T00:00:00Z",
    sourceDateText: "2025年1月修訂",
    validUntil: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    checkedAt: "2026-01-01T00:00:00Z",
    reviewState: "reviewed",
    ...overrides,
  };
}

test("colloquial parenting queries map to official guidance with structured citations (REQ-001 §7 Line 1)", async (t) => {
  // Part A: Real rankKnowledge lexical matching against curated HK official seed chunks & explicit seed-scope negative checks
  const parsedSeed = await loadCuratedSeedSources();
  const seedCandidates: KnowledgeCandidate[] = parsedSeed.flatMap((src, sIdx) =>
    src.chunks.map((ch, cIdx) => mockChunk(`55555555-6666-4777-8888-${String(sIdx * 10 + cIdx).padStart(12, "0")}`, {
      distance: null,
      key: ch.key,
      section: ch.section,
      sourceExcerpt: ch.sourceExcerpt,
      originalText: ch.originalText,
      text: ch.text,
      keywords: ch.keywords,
      applicability: ch.applicability,
      sourceId: src.sourceId,
      title: src.title,
      publisher: src.publisher,
      url: src.url,
    })),
  );

  // Colloquial Cantonese queries in keyword_degraded mode (distance = null) map to the right official FHS seed chunks
  for (const colloquialSolidQuery of ["BB幾時可以食糊仔？", "半歲BB點樣開糊？", "幾多個月開始食副食品？", "BB幾時可以食嘢？"]) {
    const ranked = rankKnowledge(colloquialSolidQuery, seedCandidates);
    assert.ok(ranked.length >= 1, `Expected official match for ${colloquialSolidQuery}`);
    assert.equal(ranked[0].key, "starting-solids", `Top match for ${colloquialSolidQuery} should be starting-solids`);
    assert.equal(ranked[0].sourceId, "fhs-solid-food");
  }

  const rankedToddler = rankKnowledge("歲半BB仲未識行路同講嘢點算？", seedCandidates);
  assert.ok(rankedToddler.length >= 1);
  assert.equal(rankedToddler[0].key, "play-and-language");
  assert.equal(rankedToddler[0].sourceId, "fhs-toddler-development");

  const rankedVision = rankKnowledge("四歲小朋友睇嘢成日瞇眼去邊度驗眼？", seedCandidates);
  assert.ok(rankedVision.length >= 1);
  assert.equal(rankedVision[0].key, "preschool-screening");
  assert.equal(rankedVision[0].sourceId, "fhs-child-vision");

  // Honest negative regression checks against real hk-official-seed.json:
  // Appetite refusal ("唔肯食嘢"/"唔開胃"), bare "BB食嘢", off-topic speech ("BB講嘢粗口"), and uncovered topics
  // (fever, spitting up + "正常", vaccines, diarrhea, diaper rash) must return [] without false-matching existing seeds
  for (const uncoveredOrRefusalQuery of [
    "BB唔肯食嘢點算？",
    "BB食嘢唔開胃",
    "今晚BB唔肯食嘢，係咪生病？",
    "BB食嘢",
    "BB發燒點算",
    "BB發熱點算？",
    "BB發熱幾多度要睇醫生？",
    "BB回奶係咪正常？",
    "BB講嘢粗口",
    "BB幾時打針",
    "BB喺邊度打針？",
    "BB肚瀉點算？",
    "BB紅屁股點算？",
  ]) {
    assert.deepEqual(
      rankKnowledge(uncoveredOrRefusalQuery, seedCandidates),
      [],
      `Expected empty seed match for uncovered/refusal/off-topic query: ${uncoveredOrRefusalQuery}`,
    );
  }

  // Synthetic symptom-chunk ranking check ("嘔奶/回奶" -> "吐奶/溢奶", "發熱/睇醫生" -> "發燒/求醫");
  // note that hk-official-seed.json currently covers feeding/development/vision only and omits fever/vomiting seeds
  const chunkFever = mockChunk(chunkFeverId, {
    distance: null,
    key: "fever-care",
    title: "Synthetic 官方參考 - 嬰幼兒發燒護理",
    keywords: ["發燒", "體溫", "求醫"],
    text: "Synthetic fever guidance: 三個月以下嬰兒肛溫達攝氏38度或以上，必須立即求醫。",
    sourceExcerpt: "三個月以下嬰兒發燒達38度需立即求醫。",
  });
  const chunkVomit = mockChunk(chunkVomitId, {
    distance: null,
    key: "spitting-up",
    title: "Synthetic 官方參考 - 嬰兒吐奶護理",
  });
  assert.equal(rankKnowledge("BB成日嘔奶點算？", [chunkFever, chunkVomit])[0]?.chunkId, chunkVomitId);
  assert.equal(rankKnowledge("BB回奶係咪正常？", [chunkFever, chunkVomit])[0]?.chunkId, chunkVomitId);
  assert.equal(rankKnowledge("BB發熱幾多度要睇醫生？", [chunkVomit, chunkFever])[0]?.chunkId, chunkFeverId);

  // Part B: End-to-end createProductAgent interactive turn enforcing structured citationIds/citations and rejecting Markdown URLs (F3)
  const gateway = fakeEmbeddingGateway();
  const solidSeedChunk = mockChunk(chunkSolidId, {
    ...seedCandidates.find(item => item.key === "starting-solids")!,
    chunkId: chunkSolidId,
    distance: 0.06,
  });
  const store = {
    candidates: async (_filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { query?: string; chunkIds?: string[] }) => {
      if (opts?.chunkIds) return [solidSeedChunk, chunkFever, chunkVomit].filter(item => opts.chunkIds!.includes(item.chunkId));
      return [solidSeedChunk, chunkFever, chunkVomit];
    },
  };
  const retriever = createKnowledgeRetriever(store, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({ actor: queryActor, budget, authorize: async () => true });

  const searchResult = await run.search("半歲BB點樣開糊？", {
    region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 6, maxMonths: 6 }, topics: [],
  });
  assert.equal(searchResult.mode, "vector_keyword");
  assert.equal(searchResult.chunks[0]?.chunkId, chunkSolidId);
  assert.equal(await run.revalidateCitations(
    [{ chunkId: chunkSolidId, versionId: solidSeedChunk.versionId, contentHash: solidSeedChunk.contentHash }],
    { region: "HK", classification: "official_guidance", age: null, topics: [] },
  ), true);
  assert.equal(await run.revalidateCitations(
    [{ chunkId: chunkSolidId, versionId: "wrong-version", contentHash: solidSeedChunk.contentHash }],
    { region: "HK", classification: "official_guidance", age: null, topics: [] },
  ), false);

  // Verify programmatic tool rejections for raw Markdown URLs (use_citation_ids), fake citationIds (invalid_citation), and missing citations (citation_required)
  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => emptyMemoryContext() } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: retriever,
  });
  const searchTool = tools.tools.find(tool => tool.name === "search_knowledge")!;
  const presentTool = tools.tools.find(tool => tool.name === "present_answer")!;
  const toolSearchRes = await searchTool.execute(
    { query: "半歲BB點樣開糊", classification: "official_guidance" },
    { callId: "call-search-1", queryEmbeddingAttemptKey: "attempt-1" } as any,
  );
  assert.equal(toolSearchRes.status, "succeeded");

  const markdownUrlRejected = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "可參考衛生署網頁 [引進固體食物](https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html)。", citationIds: [chunkSolidId] }],
  }, { callId: "call-present-url" } as any);
  assert.equal(markdownUrlRejected.status, "rejected");
  assert.equal(markdownUrlRejected.data?.code, "use_citation_ids");

  const fakeCitationRejected = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "虛構混合引用來源", citationIds: [chunkSolidId, "99999999-9999-4999-8999-999999999999"] }],
  }, { callId: "call-present-fake" } as any);
  assert.equal(fakeCitationRejected.status, "rejected");
  assert.equal(fakeCitationRejected.data?.code, "invalid_citation");

  const uncitedRejected = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "完全無有效官方引用的照護建議", citationIds: [] }],
  }, { callId: "call-present-uncited" } as any);
  assert.equal(uncitedRejected.status, "rejected");
  assert.equal(uncitedRejected.data?.code, "citation_required");

  // Full createProductAgent interactive turn delivering structured citations and passing semantic review
  let modelStep = 0;
  let savedResult: ProductAgentResult | null = null;
  const paragraphText = "衞生署指引指出，約六個月時可開始以匙羹餵稀滑固體食物；未滿四個月不應加入奶以外食物。";
  const runtime = createAgentRuntime({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as {
            draftHash: string;
            sources: Array<{ citationId: string; classification: string; excerpt: string }>;
          };
          assert.equal(payload.sources.length, 1);
          assert.equal(payload.sources[0].citationId, chunkSolidId);
          assert.equal(payload.sources[0].classification, "official_guidance");
          assert.ok(payload.sources[0].excerpt.includes("未滿四個月不應加入奶以外食物"));
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        const currentStep = modelStep++;
        const functionCall = currentStep === 0
          ? { id: "search-1", name: "search_knowledge", args: { query: "半歲BB點樣開糊", classification: "official_guidance" } }
          : { id: "present-1", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: paragraphText, citationIds: [chunkSolidId] }] } };
        return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
      },
    },
  });

  const agent = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
      get: async () => savedResult,
    } as any,
    memory: { context: async () => emptyMemoryContext() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "請問半歲BB點樣開糊？未滿四個月食唔食得？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retriever,
  });

  const reply = await agent.reply(userId, childId, messageId, async () => true);
  assert.ok(reply);
  productAgentResultSchema.parse(reply);
  assert.equal(reply.status, "completed");
  assert.equal(reply.retrievalMode, "vector_keyword");
  assert.equal(reply.text, `${paragraphText} [1]`);
  assert.equal(reply.citations.length, 1);
  assert.equal(reply.citations[0].chunkId, chunkSolidId);
  assert.equal(reply.deliveryReview?.decision, "pass");
  assert.deepEqual(reply.deliveryReview?.sourceVersions, [{
    citationId: chunkSolidId,
    version: solidSeedChunk.versionId,
    contentHash: solidSeedChunk.contentHash,
  }]);
});

test("age and region applicability mismatches block unapplicable advice from formal delivery (REQ-001 §7 Line 2)", async (t) => {
  // Part A: Real profileKnowledgeAge, baseAgentKnowledgeFilter and resolveKnowledgeQueryContext
  const now = new Date("2026-10-08T00:00:00Z");
  const confirmedSixMonthContext = {
    ...emptyMemoryContext(),
    profileApplicable: true,
    profile: { childId, version: 3, data: { age: { kind: "birth_date", date: "2026-04-08" }, region: "香港" } },
  } as unknown as MemoryContext;
  const resolvedSixMonth = await resolveKnowledgeQueryContext(confirmedSixMonthContext, undefined, {
    childId, visibility: "private", readHistory: async () => null,
  }, now);
  assert.equal(resolvedSixMonth.filter.region, "HK");
  assert.equal(resolvedSixMonth.filter.ageMatch, "contained");
  assert.deepEqual(resolvedSixMonth.filter.age, { basis: "actual", minMonths: 6, maxMonths: 6 });
  assert.equal(resolvedSixMonth.queryContext.precision, "confirmed");

  const approxSixYearContext = {
    profileApplicable: true,
    profile: { childId, version: 4, data: { age: { kind: "approximate", rawValue: "6", unit: "years", asOf: "2026-10-08" }, region: "Hong Kong" } },
  } as unknown as MemoryContext;
  assert.equal(profileKnowledgeAge(approxSixYearContext, now).precision, "approximate");
  const approxSixYearFilter = baseAgentKnowledgeFilter(approxSixYearContext, now);
  assert.equal(approxSixYearFilter.ageMatch, "overlap");
  assert.equal(approxSixYearFilter.region, "HK");

  // Part B: Real production runtime store (createFirestoreKnowledgeStore) with all 5 curated HK seeds + synthetic UK source
  // Exercises real server/firestore-knowledge.ts applies(), eligibility, lexical buckets, FindNearest vectors, and revalidation
  const seedSources = await loadCuratedSeedSources();
  const ukVisionSource: KnowledgeSourceInput = {
    sourceId: "synthetic-uk-vision",
    url: "https://www.fhs.gov.hk/synthetic-uk-vision-control",
    title: "Synthetic UK Infant Vision Check",
    publisher: "Synthetic Non-HK Regional Control",
    classification: "official_guidance",
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    fetchedAt: "2026-01-01T00:00:00Z",
    termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html",
    chunks: [{
      key: "uk-infant-vision",
      section: "UK Infant Eye Screening",
      sourceExcerpt: "Synthetic UK infant eye check excerpt.",
      originalText: "Synthetic UK infant eye check original guidance body for UK families.",
      text: "Synthetic UK infant eye check guidance: 視力檢查與護眼及發燒評估適用於英國地區 0-12 個月。",
      keywords: ["視力檢查", "驗眼", "護眼", "發燒"],
      applicability: { region: "UK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["vision"], conditions: [] },
    }],
  };
  const ukVisionAssessment: KnowledgeReviewAssessment = {
    comparedVersionId: null,
    comparedHash: null,
    observationHash: null,
    changes: [{
      key: "uk-infant-vision",
      oldQuote: null,
      newQuote: "Synthetic UK infant eye check excerpt.",
      meaning: "new",
      explanation: "Synthetic UK control source for cross-region blocking test",
    }],
    checks: { age: "Reviewed", numbersAndUnits: "Reviewed", timing: "Reviewed", conditions: "Reviewed", exceptions: "Reviewed", prohibitions: "Reviewed", withdrawal: "Reviewed" },
    questions: [{ query: "Synthetic UK check", expectedKeys: ["uk-infant-vision"], reason: "Region control check" }],
    growthRuleImpact: "none",
    growthRuleReason: "Synthetic UK control source",
    decision: "approve",
  };

  const fsEnv = createInMemoryFirestoreKnowledgeStore([...LOCAL_OFFICIAL_SEED_IDS, ukVisionSource.sourceId]);
  const localManifest = await loadLocalDevelopmentManifest();
  for (const src of seedSources) {
    await fsEnv.publishSource(src, buildLocalOfficialSeedAssessment(src, localManifest), () => (src.sourceId === "fhs-child-vision" ? visionVector : vector));
  }
  await fsEnv.publishSource(ukVisionSource, ukVisionAssessment, () => visionVector);

  const gateway = fakeEmbeddingGateway(true);
  const firestoreRetriever = createKnowledgeRetriever(fsEnv.store, gateway);
  const newFsRun = () => {
    const runBudget = new AgentBudget();
    t.after(() => runBudget.close());
    return { budget: runBudget, run: firestoreRetriever.createRun({ actor: queryActor, budget: runBudget, authorize: async () => true }) };
  };
  const { run: sixYearRun } = newFsRun();

  // Fetch published citations via valid region/age filters to verify out-of-scope citation revalidation fails
  const sixYearFilter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 72, maxMonths: 72 },
    ageMatch: "contained",
    topics: [],
  });
  const sixYearResult = await sixYearRun.search("視力檢查與護眼", sixYearFilter);
  assert.equal(sixYearResult.chunks[0]?.key, "school-eye-care", "At 72 months HK, school-eye-care (72-120m) must rank first");
  assert.equal(sixYearResult.chunks.some(ch => ch.key === "preschool-screening"), false, "preschool-screening (maxAgeMonths=72 exclusive) must be excluded at 72 months");
  assert.equal(sixYearResult.chunks.some(ch => ch.applicability.region !== "HK"), false, "Foreign-region chunks must be excluded under HK filter");
  assert.ok(sixYearResult.chunks.every(ch => ch.applicabilityStatus === "applicable"));

  const [preschoolVisionCandidate] = await fsEnv.store.candidates(
    parseKnowledgeFilter({ region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 60, maxMonths: 60 }, ageMatch: "contained", topics: ["vision"] }),
    visionVector,
  );
  assert.equal(preschoolVisionCandidate?.key, "preschool-screening");

  const [ukCandidate] = await fsEnv.store.candidates(
    parseKnowledgeFilter({ region: "UK", classification: "official_guidance", age: { basis: "actual", minMonths: 6, maxMonths: 6 }, ageMatch: "contained", topics: ["vision"] }),
    visionVector,
  );
  assert.ok(ukCandidate, "UK synthetic chunk should exist under UK 6-month filter");

  // 1) 6-month HK infant searching vision OR fever+doctor: real Firestore applies() excludes 48-72m, 72-120m, and UK (even when vector cosine distance is 0.0)
  const { run: infantRun } = newFsRun();
  const infantVisionResult = await infantRun.search("視力檢查與護眼", resolvedSixMonth.filter);
  assert.equal(infantVisionResult.chunks.length, 0);
  const infantFeverDoctorResult = await infantRun.search("BB發熱幾多度要睇醫生？", resolvedSixMonth.filter);
  assert.equal(infantFeverDoctorResult.chunks.length, 0);
  const { run: infantSpitUpRun } = newFsRun();
  const infantSpitUpNormalResult = await infantSpitUpRun.search("BB回奶係咪正常？", resolvedSixMonth.filter);
  assert.equal(infantSpitUpNormalResult.chunks.some(ch => ch.key === "school-eye-care"), false, "6m applies() excludes school-eye-care even when '正常' matches");

  // Positive control at 6 months HK: solids guidance (0-12m HK) retrieves cleanly
  const { run: infantSolidRun } = newFsRun();
  const infantSolidResult = await infantSolidRun.search("半歲BB點樣開糊？", resolvedSixMonth.filter);
  assert.equal(infantSolidResult.chunks[0]?.key, "starting-solids");
  assert.equal(infantSolidResult.chunks[0]?.applicabilityStatus, "applicable");

  // Revalidating older-child, maxAgeMonthsExclusive boundary, or foreign-region real published chunks fails while starting-solids passes
  assert.equal(await infantSolidRun.revalidateCitations(
    [{ chunkId: sixYearResult.chunks[0]!.chunkId, versionId: sixYearResult.chunks[0]!.versionId, contentHash: sixYearResult.chunks[0]!.contentHash }],
    resolvedSixMonth.filter,
  ), false);
  assert.equal(await sixYearRun.revalidateCitations(
    [{ chunkId: preschoolVisionCandidate.chunkId, versionId: preschoolVisionCandidate.versionId, contentHash: preschoolVisionCandidate.contentHash }],
    sixYearFilter,
  ), false);
  assert.equal(await infantSolidRun.revalidateCitations(
    [{ chunkId: ukCandidate.chunkId, versionId: ukCandidate.versionId, contentHash: ukCandidate.contentHash }],
    resolvedSixMonth.filter,
  ), false);
  assert.equal(await infantSolidRun.revalidateCitations(
    [{ chunkId: infantSolidResult.chunks[0]!.chunkId, versionId: infantSolidResult.chunks[0]!.versionId, contentHash: infantSolidResult.chunks[0]!.contentHash }],
    resolvedSixMonth.filter,
  ), true);

  // Approximate age overlap yields conditional applicability while still enforcing region=HK
  const { run: approxRun } = newFsRun();
  const approxVisionResult = await approxRun.search("視力檢查與護眼", approxSixYearFilter);
  assert.ok(approxVisionResult.chunks.length >= 1);
  assert.ok(approxVisionResult.chunks.every(item => item.applicabilityStatus === "conditional" && item.applicability.region === "HK"));

  // Part B2: Secondary verification of Postgres createKnowledgeStore(pool) SQL query predicates & parameter bindings
  // (SQL migrations are retired in this repo via scripts/sql-retired.mjs; Postgres SQL execution itself is not run offline)
  const recordedSql: Array<{ sql: string; values: unknown[] }> = [];
  const fakePool = {
    connect: async () => ({
      release() {},
      query: async (sql: string, values: unknown[] = []) => {
        recordedSql.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    }),
  } as unknown as Pool;
  const pgStore = createKnowledgeStore(fakePool);
  await pgStore.candidates(resolvedSixMonth.filter, vector, { query: "視力檢查與護眼" });
  const eligibleQuery = recordedSql.find(entry => entry.sql.includes("WITH eligible"))!;
  assert.ok(eligibleQuery.sql.includes("v.document->>'classification' = $5"));
  assert.ok(eligibleQuery.sql.includes("c.document->'applicability'->>'region' = $6"));
  assert.ok(eligibleQuery.sql.includes("maxAgeMonthsExclusive"));
  assert.ok(eligibleQuery.sql.includes("CASE WHEN $12='overlap'"));
  assert.equal(eligibleQuery.values[4], "official_guidance");
  assert.equal(eligibleQuery.values[5], "HK");
  assert.equal(eligibleQuery.values[6], "actual");
  assert.equal(eligibleQuery.values[7], 6);
  assert.equal(eligibleQuery.values[8], 6);
  assert.equal(eligibleQuery.values[11], "contained");

  // Part C: When real Firestore applicability filters out all candidates, unapplicable care advice cannot be delivered
  const { budget } = newFsRun();
  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => confirmedSixMonthContext } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: firestoreRetriever,
  });
  const searchTool = tools.tools.find(tool => tool.name === "search_knowledge")!;
  const presentTool = tools.tools.find(tool => tool.name === "present_answer")!;
  const searchRes = await searchTool.execute(
    { query: "視力檢查與護眼", classification: "official_guidance" },
    { callId: "call-age-mismatch", queryEmbeddingAttemptKey: "attempt-age-1" } as any,
  );
  assert.equal(searchRes.status, "succeeded");
  assert.equal((searchRes.data as { result: { chunks: unknown[] } }).result.chunks.length, 0);

  // Attempting to present caregiving advice without applicable chunks is rejected with citation_required
  const rejectedCare = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "六個月大嬰兒閱讀時書本應距離眼睛30厘米。", citationIds: [] }],
  }, { callId: "call-present-mismatch-1" } as any);
  assert.equal(rejectedCare.status, "rejected");
  assert.equal(rejectedCare.data?.code, "citation_required");

  // Attempting to bypass by relabelling substantive dosage/care advice as "operation" stops at delivery review with delivery_review_no_sources
  const relabelled = await presentTool.execute({
    kind: "operation",
    paragraphs: [{ text: "建議每天給六個月大BB服用 10ml 學童退燒藥水。", citationIds: [] }],
  }, { callId: "call-present-mismatch-2" } as any);
  assert.equal(relabelled.status, "succeeded");
  const presentation = (await tools.presentation())!;
  await assert.rejects(
    enforceChatDeliveryReview({
      presentation,
      tools,
      context: {
        scope,
        budget,
        runId,
        authorize: async () => true,
        completeText: async ({ user }) => {
          const payload = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string };
          return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
        },
      },
      provenance: { packVersion: "0.1.39", model: "gemini-3.1-flash-lite" },
    }),
    (error: unknown) => error instanceof AgentStopped && error.reason === "delivery_review_no_sources",
  );
});

test("long documents, tables and exception conditions maintain end-to-end traceability across chunks (REQ-001 §7 Line 5)", async (t) => {
  const gateway = fakeEmbeddingGateway();
  const anchorChunkId = "77777777-8888-4999-8aaa-111111111111";
  const neighborChunkId = "77777777-8888-4999-8aaa-222222222222";

  // Synthetic multi-chunk Paracetamol table fixture (>1200 chars) where the critical contraindication/exception table starts past char 800
  const tableHeaderAndDosage = "Synthetic 官方參考 幼兒退燒指引 表格一：撲熱息痛（Paracetamol）按體重計算劑量標準。"
    + "一般建議按幼兒體重每公斤每次服用 10 至 15 毫克，每隔四至六小時一次，二十四小時內不可超過四次。"
    + "請使用附設量杯或針筒準確量度毫升數，切勿使用普通家用湯匙以免劑量過高。".repeat(26);
  const tableExceptions = "【表格二：重要禁忌與例外情況】患有葡萄糖六磷酸去氫酵素缺乏症（蠶豆症 G6PD）或肝腎功能異常之幼兒，必須先經醫生處方評估；切勿給16歲以下兒童服用阿士匹靈（Aspirin），以免誘發雷氏綜合症（Reye's syndrome）。";
  const longOriginalText = `${tableHeaderAndDosage}\n${tableExceptions}`;
  assert.ok(tableHeaderAndDosage.length > 950, "Exception section must start past the 800-character head excerpt limit");
  assert.ok(longOriginalText.length <= 4000);

  const chunk1 = mockChunk(anchorChunkId, {
    key: "doc-page-01",
    sourceExcerpt: "衛生署幼兒退燒指引 表格一：撲熱息痛按體重計算劑量標準。",
    text: "衛生署幼兒退燒指引：撲熱息痛按幼兒體重計算每次 10-15mg/kg，蠶豆症幼兒須經醫生處方，16歲以下切勿服用阿士匹靈。",
    originalText: longOriginalText,
  });
  const chunk2 = mockChunk(neighborChunkId, {
    key: "doc-page-02",
    sourceExcerpt: "附表三：服藥後體溫觀察與急症求診條件。",
    text: "附表三：服藥後應每四小時量度體溫並補充水分；若持續高燒或出現抽搐應立即求醫。",
    originalText: "附表三：服藥後體溫觀察與急症求診條件。服藥後應每四小時紀錄體溫變化，切勿同時混合服用兩種含撲熱息痛成分的成藥。",
  });

  const store = {
    candidates: async (_filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { chunkIds?: string[]; afterKey?: string | null }) => {
      if (opts?.chunkIds) return [chunk1, chunk2].filter(item => opts.chunkIds!.includes(item.chunkId));
      if (opts?.afterKey === "doc-page-01") return [chunk2];
      if (opts?.afterKey === "doc-page-02") return [];
      return [chunk1];
    },
  };

  const retriever = createKnowledgeRetriever(store, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());

  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => emptyMemoryContext() } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: retriever,
  });

  const searchTool = tools.tools.find(tool => tool.name === "search_knowledge")!;
  const readContextTool = tools.tools.find(tool => tool.name === "read_knowledge_context")!;
  const presentTool = tools.tools.find(tool => tool.name === "present_answer")!;

  const searchRes = await searchTool.execute(
    { query: "退燒劑量與禁忌", classification: "official_guidance" },
    { callId: "call-search-long", queryEmbeddingAttemptKey: "attempt-long-1" } as any,
  );
  assert.equal(searchRes.status, "succeeded");

  // Constrain toolResponseCharacters so read_knowledge_context must paginate chunk1 across multiple calls before reaching chunk2
  budget.prepareToolResponseBudget(budget.limits.inputCharacters - 4096 - 2600, 0, 0);
  assert.equal(budget.toolResponseCharacters, 2600);

  let cursor: import("../src/shared/knowledge.ts").KnowledgeContextCursor | null = null;
  let anchorReads = 0;
  let firstSegmentChunk: import("../src/shared/knowledge.ts").KnowledgeContextChunk | null = null;
  let sawNeighborChunk = false;

  for (let step = 0; step < 6; step++) {
    const pageRes = await readContextTool.execute(
      { anchorChunkId, cursor },
      { callId: `call-read-ctx-${step + 1}` } as any,
    );
    assert.equal(pageRes.status, "succeeded");
    const page = (pageRes.data as { result: import("../src/shared/knowledge.ts").KnowledgeContextResult }).result;
    for (const item of page.chunks) {
      if (item.chunkId === anchorChunkId) {
        anchorReads++;
        if (!firstSegmentChunk) {
          firstSegmentChunk = item;
          assert.equal(item.readCoverage?.complete, false, "First paginated read of long chunk must be partial");
        }
      }
      if (item.chunkId === neighborChunkId && item.original.text.includes("附表三")) {
        sawNeighborChunk = true;
      }
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  assert.ok(anchorReads >= 2, `Expected anchor chunk to require >= 2 paginated reads, got ${anchorReads}`);
  assert.equal(sawNeighborChunk, true, "Expected pagination to reach following chunk2 (doc-page-02)");

  // Verify accumulateKnowledgeRead merged page1 + page2 of chunk1 into a complete, contiguous 4000-char-bounded source excerpt for delivery review
  const presentRes = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{
      text: "撲熱息痛按體重每公斤每次 10-15 毫克；患有蠶豆症（G6PD）幼兒須先經醫生處方，16歲以下切勿服用阿士匹靈，且切勿同時混服兩種含撲熱息痛成藥。",
      citationIds: [anchorChunkId, neighborChunkId],
    }],
  }, { callId: "call-present-long" } as any);
  assert.equal(presentRes.status, "succeeded");

  const draft = tools.deliveryDraft()!;
  const anchorSource = draft.sources.find(src => src.citationId === anchorChunkId)!;
  assert.equal(anchorSource.excerptComplete, true);
  assert.equal(anchorSource.excerpt.length, longOriginalText.length);
  assert.ok(anchorSource.excerpt.includes("表格一：撲熱息痛"));
  assert.ok(anchorSource.excerpt.includes("蠶豆症 G6PD"));
  assert.ok(anchorSource.excerpt.includes("阿士匹靈"));

  // Verify enforceChatDeliveryReview passes with full accumulated excerpt (>800 chars) visible to the reviewer
  const presentation = (await tools.presentation())!;
  const reviewed = await enforceChatDeliveryReview({
    presentation,
    tools,
    context: {
      scope,
      budget,
      runId,
      authorize: async () => true,
      completeText: async ({ user }) => {
        const payload = JSON.parse(user.slice(user.indexOf("{"))) as {
          draftHash: string;
          sources: Array<{ citationId: string; excerpt: string; excerptComplete: boolean }>;
        };
        const source1 = payload.sources.find(item => item.citationId === anchorChunkId)!;
        assert.equal(source1.excerptComplete, true);
        assert.ok(source1.excerpt.length > 1000);
        assert.ok(source1.excerpt.includes("蠶豆症 G6PD"));
        return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
      },
    },
    provenance: { packVersion: "0.1.39", model: "gemini-3.1-flash-lite" },
  });
  assert.equal(reviewed.review?.decision, "pass");
  assert.equal(chatDeliveryReviewSourceExcerpt(longOriginalText).excerptComplete, true);
  assert.equal(accumulateKnowledgeRead(undefined, firstSegmentChunk!).readCoverage?.complete, false);

  // Also verify paginated originalText reconstruction on a real >1000-char curated HK official seed chunk
  // (fhs-child-vision/preschool-screening contains inclusion/exclusion criteria & medical-seeking exception past char 800)
  const seedSourcesForLongRead = await loadCuratedSeedSources();
  const preschoolSeed = seedSourcesForLongRead.find(src => src.sourceId === "fhs-child-vision")!;
  const preschoolChunkInput = preschoolSeed.chunks.find(ch => ch.key === "preschool-screening")!;
  const preschoolOriginalText = preschoolChunkInput.originalText ?? "";
  assert.ok(preschoolOriginalText.length > 1000, `Expected real preschool-screening originalText > 1000 chars, got ${preschoolOriginalText.length}`);
  const realSeedLongChunk = mockChunk("77777777-8888-4999-8aaa-333333333333", {
    key: preschoolChunkInput.key,
    sourceId: preschoolSeed.sourceId,
    title: preschoolSeed.title,
    url: preschoolSeed.url,
    publisher: preschoolSeed.publisher,
    section: preschoolChunkInput.section,
    sourceExcerpt: preschoolChunkInput.sourceExcerpt,
    originalText: preschoolOriginalText,
    text: preschoolChunkInput.text,
    keywords: preschoolChunkInput.keywords,
    applicability: preschoolChunkInput.applicability,
  });
  const realLongRetriever = createKnowledgeRetriever({
    candidates: async (_filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { chunkIds?: string[]; afterKey?: string | null }) => {
      if (opts?.chunkIds) return opts.chunkIds.includes(realSeedLongChunk.chunkId) ? [realSeedLongChunk] : [];
      if (opts?.afterKey) return [];
      return [realSeedLongChunk];
    },
  }, gateway);
  const realLongBudget = new AgentBudget();
  t.after(() => realLongBudget.close());
  const realLongTools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget: realLongBudget, runId, authorize: async () => true },
    memory: { context: async () => emptyMemoryContext() } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: realLongRetriever,
  });
  await realLongTools.tools.find(tool => tool.name === "search_knowledge")!.execute(
    { query: "四歲視力普查包括咩項目", classification: "official_guidance" },
    { callId: "call-search-real-long", queryEmbeddingAttemptKey: "attempt-real-long-1" } as any,
  );
  realLongBudget.prepareToolResponseBudget(realLongBudget.limits.inputCharacters - 4096 - 2600, 0, 0);
  const realReadCtxTool = realLongTools.tools.find(tool => tool.name === "read_knowledge_context")!;
  let realCursor: import("../src/shared/knowledge.ts").KnowledgeContextCursor | null = null;
  let realAnchorPages = 0;
  for (let step = 0; step < 20; step++) {
    const pageRes = await realReadCtxTool.execute(
      { anchorChunkId: realSeedLongChunk.chunkId, cursor: realCursor },
      { callId: `call-read-real-${step + 1}` } as any,
    );
    assert.equal(pageRes.status, "succeeded");
    const page = (pageRes.data as { result: import("../src/shared/knowledge.ts").KnowledgeContextResult }).result;
    if (page.chunks.some(ch => ch.chunkId === realSeedLongChunk.chunkId)) realAnchorPages++;
    realCursor = page.nextCursor;
    if (!realCursor) break;
  }
  assert.equal(realCursor, null, "Paginated read of real seed chunk must reach EOF");
  assert.ok(realAnchorPages >= 2, `Expected >=2 paginated reads on real preschool-screening originalText, got ${realAnchorPages}`);
  const realPresentRes = await realLongTools.tools.find(tool => tool.name === "present_answer")!.execute({
    kind: "caregiving",
    paragraphs: [{
      text: "學前兒童視力普查涵蓋四至五歲孩子，但不包括色覺檢查或近視度數評估；發現眼睛異常應盡快求醫。",
      citationIds: [realSeedLongChunk.chunkId],
    }],
  }, { callId: "call-present-real-long" } as any);
  assert.equal(realPresentRes.status, "succeeded");
  const realSeedDraftSource = realLongTools.deliveryDraft()!.sources.find(s => s.citationId === realSeedLongChunk.chunkId)!;
  assert.equal(realSeedDraftSource.excerptComplete, true);
  assert.equal(realSeedDraftSource.excerpt.length, preschoolOriginalText.length);
  assert.ok(realSeedDraftSource.excerpt.includes("不包括"));
  assert.ok(realSeedDraftSource.excerpt.includes("若孩子現已佩戴眼鏡"));
  assert.ok(realSeedDraftSource.excerpt.includes("請盡快到家庭或眼科醫生求診"));
  assert.ok(preschoolOriginalText.indexOf("請盡快到家庭或眼科醫生求診") >= 800, "Final eye-doctor clause lies past char 800");
});

test("insufficient evidence cleanly stops with delivery_review_no_sources while retaining sources without hallucinated text (REQ-001 §7 Line 6)", async (t) => {
  // Check existing stop copy contract (F4: no self-invented copy)
  assert.equal(agentStopMessage("delivery_review_no_sources"), "缺少可核對的來源依據，未成為正式回覆");
  assert.ok(agentStopDetailHint("delivery_review_no_sources")?.includes("目前沒有足夠依據"));

  const gateway = fakeEmbeddingGateway();
  const budget = new AgentBudget();
  t.after(() => budget.close());

  // Part A: When search_knowledge returns 0 chunks and the model attempts uncited care advice, reply() stops with delivery_review_no_sources
  const emptyRetriever = createKnowledgeRetriever({ candidates: async () => [] }, gateway);
  let stepA = 0;
  let savedA: ProductAgentResult | null = null;
  const runtimeA = createAgentRuntime({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
          return {
            content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        const current = stepA++;
        const functionCall = current === 0
          ? { id: "search-empty", name: "search_knowledge", args: { query: "嬰兒罕見皮疹處理", classification: "official_guidance" } }
          : { id: "present-uncited-care", name: "present_answer", args: {
            kind: "clarification",
            paragraphs: [{ text: "BB出疹建議先塗抹類固醇藥膏並每天用熱水清洗。", citationIds: [] }],
          } };
        return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
      },
    },
  });

  const agentA = createProductAgent({
    runtime: runtimeA,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedA = result; return true; },
      get: async () => savedA,
    } as any,
    memory: { context: async () => emptyMemoryContext() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "BB出疹點算？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: emptyRetriever,
  });

  const resultA = await agentA.reply(userId, childId, messageId, async () => true);
  assert.ok(resultA);
  assert.equal(resultA.status, "stopped");
  assert.equal(resultA.stopReason, "delivery_review_no_sources");
  assert.equal(resultA.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(resultA.text.includes("類固醇藥膏"), false, "Unverified draft text must never leak on stop");
  assert.deepEqual(resultA.citations, []);
  assert.equal(resultA.deliveryReview, undefined);

  // Part B: When official sources were retrieved and cited, but delivery review stops (e.g. insufficient_evidence),
  // retainedSourcesForStoppedReview retains live-revalidated citations while wiping the unsupported draft text.
  const chunkFever = mockChunk(chunkFeverId, {
    keywords: ["發燒", "求醫"],
    text: "衛生署指引：三個月以下嬰兒肛溫達攝氏38度或以上，必須立即求醫。",
    sourceExcerpt: "三個月以下嬰兒發燒達38度需立即求醫。",
  });
  const feverRetriever = createKnowledgeRetriever({
    candidates: async (_filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { chunkIds?: string[] }) => {
      if (opts?.chunkIds) return opts.chunkIds.includes(chunkFeverId) ? [chunkFever] : [];
      return [chunkFever];
    },
  }, gateway);

  let stepB = 0;
  let savedB: ProductAgentResult | null = null;
  const hallucinatedText = "衛生署指引建議三個月以下嬰兒發燒可自行購買抗生素服用。";
  const runtimeB = createAgentRuntime({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        if (promptText.includes("chat-delivery-review")) {
          const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
          return {
            content: {
              role: "model",
              parts: [{
                text: JSON.stringify({
                  draftHash: payload.draftHash,
                  decision: "insufficient_evidence",
                  issues: [{ paragraph: 0, reason: "source does not support antibiotics", support: "三個月以下嬰兒發燒達38度需立即求醫" }],
                }),
              }],
            },
            finishReason: FinishReason.STOP,
          };
        }
        const current = stepB++;
        const functionCall = current === 0
          ? { id: "search-fever", name: "search_knowledge", args: { query: "BB發燒幾多度要睇醫生", classification: "official_guidance" } }
          : { id: "present-hallucinated", name: "present_answer", args: {
            kind: "caregiving",
            paragraphs: [{ text: hallucinatedText, citationIds: [chunkFeverId] }],
          } };
        return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
      },
    },
  });

  const agentB = createProductAgent({
    runtime: runtimeB,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedB = result; return true; },
      get: async () => savedB,
    } as any,
    memory: { context: async () => emptyMemoryContext() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "BB發燒幾多度要睇醫生？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: feverRetriever,
  });

  const resultB = await agentB.reply(userId, childId, messageId, async () => true);
  assert.ok(resultB);
  productAgentResultSchema.parse(resultB);
  assert.equal(resultB.status, "stopped");
  assert.equal(resultB.stopReason, "delivery_review_rejected");
  assert.equal(resultB.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(resultB.text.includes("抗生素"), false, "Unsupported draft text must be cleared on review rejection");
  assert.equal(resultB.citations.length, 1, "Live-revalidated official source must be retained on review stop");
  assert.equal(resultB.citations[0].chunkId, chunkFeverId);
  assert.equal(resultB.retrievalMode, "vector_keyword");
});

test("pure clarifying questions deliver cleanly while uncited care claims wrapped in questions are held to review (REQ-001 §7 Lines 1, 6)", async (t) => {
  // Part A: Pure Cantonese & Mandarin clarifying questions (including leading time adverbs like "目前BB幾多個月大？") skip semantic review
  for (const pureClarifyText of [
    "請問BB目前幾多個月大？發燒持續咗幾多日？",
    "目前BB幾多個月大？",
    "請問目前BB幾多個月大？",
    "持續咗幾多日？",
    "BB而家幾大？",
    "BB而家幾多個月？體溫幾多度？",
    "小朋友幾多歲？有冇發燒？",
    "寶寶幾個月大？症狀持續了多久？",
  ]) {
    assert.equal(isPureClarifyingQuestion(pureClarifyText), true, `Expected pure clarifying question: ${pureClarifyText}`);
    const clarifyDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: pureClarifyText, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(clarifyDraft), false);
    assert.equal(requiresChatDeliveryReview(clarifyDraft), false);
    assert.equal(chatDeliveryPassNeedsSources(clarifyDraft), false);
  }

  // End-to-end interactive turn: pure clarifying question delivers in 1 model call without invoking delivery review
  const gateway = fakeEmbeddingGateway();
  const retriever = createKnowledgeRetriever({ candidates: async () => [] }, gateway);
  let clarifyModelCalls = 0;
  let savedClarify: ProductAgentResult | null = null;
  const clarifyText = "請問BB目前幾多個月大？發燒持續咗幾多日？";
  const clarifyRuntime = createAgentRuntime({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
        assert.equal(promptText.includes("chat-delivery-review"), false, "Pure clarifying question must not invoke delivery review");
        clarifyModelCalls++;
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "present-clarify",
                name: "present_answer",
                args: { kind: "clarification", paragraphs: [{ text: clarifyText, citationIds: [] }] },
              },
            }],
          },
          finishReason: FinishReason.STOP,
        };
      },
    },
  });

  const clarifyAgent = createProductAgent({
    runtime: clarifyRuntime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedClarify = result; return true; },
      get: async () => savedClarify,
    } as any,
    memory: { context: async () => emptyMemoryContext() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "BB發燒點算？" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retriever,
  });

  const clarifyResult = await clarifyAgent.reply(userId, childId, messageId, async () => true);
  assert.ok(clarifyResult);
  assert.equal(clarifyResult.status, "completed");
  assert.equal(clarifyResult.text, clarifyText);
  assert.equal(clarifyModelCalls, 1);
  assert.deepEqual(clarifyResult.counts, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(clarifyResult.deliveryReview, undefined);

  // Part B: Disguised care advice or medication/dosage claims wrapped in questions fail closed and force delivery review
  for (const disguisedText of [
    "目前BB幾多個月大？可以食退燒藥水嗎？",
    "撲熱息痛持續咗幾多日？",
    "食藥持續咗幾多日？",
    "藥要食幾多個月？",
    "每次餵 10ml，持續咗幾多日？",
    "BB發燒可以食撲熱息痛退燒藥水，你要唔要而家試下餵？",
    "請問BB幾多個月大？建議先餵退燒藥水？",
    "BB未滿四個月可以試下食米糊嗎？",
    "BB發燒39度使唔使食阿士匹靈？",
  ]) {
    assert.equal(isPureClarifyingQuestion(disguisedText), false, `Must reject disguised care question: ${disguisedText}`);
    const disguisedDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: disguisedText, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(disguisedDraft), true, `Must classify as substantive care/medication: ${disguisedText}`);
    assert.equal(requiresChatDeliveryReview(disguisedDraft), true, `Must require delivery review: ${disguisedText}`);
    assert.equal(chatDeliveryPassNeedsSources(disguisedDraft), true, `Must require sources: ${disguisedText}`);
    assert.notEqual(chatDeliveryDraftHash(disguisedDraft), chatDeliveryDraftHash({
      ...disguisedDraft,
      paragraphs: [{ text: clarifyText, citationIds: [] }],
    }));
  }

  // Part C: Bounded revise -> repair -> rereview loop (S4) repairs an incomplete official summary on the same root budget
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const solidChunk = mockChunk(chunkSolidId, {
    text: "衞生署指引：孩子約六個月時應開始加入固體食物；未滿四個月不應加入奶以外食物。",
    sourceExcerpt: "未足四個月大的寶寶不應吃奶以外的食物",
  });
  const solidRetriever = createKnowledgeRetriever({
    candidates: async () => [solidChunk],
  }, gateway);
  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => emptyMemoryContext() } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: solidRetriever,
  });

  await tools.tools.find(tool => tool.name === "search_knowledge")!.execute(
    { query: "BB幾時開糊", classification: "official_guidance" },
    { callId: "call-revise-search", queryEmbeddingAttemptKey: "attempt-revise-1" } as any,
  );
  await tools.tools.find(tool => tool.name === "present_answer")!.execute({
    kind: "caregiving",
    paragraphs: [{ text: "孩子約六個月時可開始加入固體食物。", citationIds: [chunkSolidId] }],
  }, { callId: "call-revise-present" } as any);

  const initialPresentation = (await tools.presentation())!;
  const repairedParagraphText = "衞生署指引：孩子約六個月時應開始加入固體食物；未滿四個月不應加入奶以外食物。";
  let reviewCalls = 0;
  let repairCalls = 0;
  const repairedOutcome = await enforceChatDeliveryReview({
    presentation: initialPresentation,
    tools,
    context: {
      scope,
      budget,
      runId,
      authorize: async () => true,
      completeText: async ({ user, purpose }) => {
        if (purpose === "delivery_repair") {
          repairCalls++;
          return JSON.stringify({
            kind: "caregiving",
            paragraphs: [{ text: repairedParagraphText, citationIds: [chunkSolidId] }],
          });
        }
        reviewCalls++;
        const payload = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string; paragraphs: Array<{ text: string }> };
        if (reviewCalls === 1) {
          return JSON.stringify({
            draftHash: payload.draftHash,
            decision: "revise",
            issues: [{ paragraph: 0, reason: "omitted under-4-month prohibition", support: "未滿四個月不應加入奶以外食物" }],
          });
        }
        assert.ok(payload.paragraphs[0].text.includes("未滿四個月不應加入奶以外食物"));
        return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
      },
    },
    provenance: { packVersion: "0.1.39", model: "gemini-3.1-flash-lite" },
  });

  assert.equal(repairCalls, 1);
  assert.equal(reviewCalls, 2);
  assert.equal(repairedOutcome.review?.decision, "pass");
  assert.equal(repairedOutcome.presentation.text, `${repairedParagraphText} [1]`);
});

test("post-illness timing, bare Cantonese operation claims, and Chinese-numeral doses fail closed end-to-end (R3 F1-F3)", async (t) => {
  // Part A: Real Firestore knowledge store + retriever with 5 curated HK seeds must not retrieve starting-solids for post-illness/refusal timing
  const seedSources = await loadCuratedSeedSources();
  const fsEnv = createInMemoryFirestoreKnowledgeStore([...LOCAL_OFFICIAL_SEED_IDS]);
  const localManifest = await loadLocalDevelopmentManifest();
  for (const src of seedSources) {
    await fsEnv.publishSource(src, buildLocalOfficialSeedAssessment(src, localManifest), () => vector);
  }
  const gateway = createEmbeddingGateway({
    config,
    usage: fakeUsage(),
    provider: {
      embed: async request => ({
        values: /嘔|吐|瀉|痾|發燒|發熱|唔肯食/u.test(request.text) ? unrelatedTopicVector : vector,
        inputTokens: 4,
        billableCharacters: 16,
      }),
    },
  });
  const retriever = createKnowledgeRetriever(fsEnv.store, gateway);
  const hkFilter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 6, maxMonths: 6 },
    topics: [],
  });
  for (const query of ["BB幾時嘔完可以食嘢？", "BB幾個月唔肯食嘢點算？", "BB肚瀉幾時先可以食嘢？"]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const res = await retriever.createRun({ actor: queryActor, budget, authorize: async () => true }).search(query, hkFilter);
    assert.deepEqual(res.chunks, [], `Firestore retriever must not false-match starting-solids for: ${query}`);
  }
  const legitimateBudget = new AgentBudget();
  t.after(() => legitimateBudget.close());
  const legitimateRes = await retriever.createRun({ actor: queryActor, budget: legitimateBudget, authorize: async () => true }).search("BB幾時可以食嘢？", hkFilter);
  assert.equal(legitimateRes.chunks[0]?.key, "starting-solids");

  // Part B: Real createAgentRuntime + createProductAgent fail closed on bare Cantonese operation claims without verified receipts
  for (const draftClaim of ["改咗提醒時間。", "刪咗所有紀錄。", "唔該，改咗啦。"]) {
    const draft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: draftClaim, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(draft), true, `Must require review for bare operation claim: ${draftClaim}`);

    let modelTurn = 0;
    let reviewCalls = 0;
    let savedResult: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({
      config,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as {
              draftHash: string;
              verifiedOperations?: unknown[];
            };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "insufficient_evidence", issues: [{ paragraph: 0, reason: "unverified operation claim" }] }) }],
              },
              finishReason: FinishReason.STOP,
            };
          }
          modelTurn++;
          const functionCall = {
            id: `present-op-${modelTurn}`,
            name: "present_answer",
            args: { kind: "clarification", paragraphs: [{ text: draftClaim, citationIds: [] }] },
          };
          return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
        },
      },
    });
    const agent = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
        get: async () => savedResult,
      } as any,
      memory: { context: async () => emptyMemoryContext() } as any,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "幫我更新提醒時間。" }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: retriever,
    });
    const result = await agent.reply(userId, childId, messageId, async () => true);
    assert.ok(result);
    assert.equal(reviewCalls, 1, `Unverified operation claim must invoke delivery review: ${draftClaim}`);
    assert.equal(result.status, "stopped");
    assert.equal(result.text.includes("改咗") || result.text.includes("刪咗"), false);
  }

  // Part C: Real createAgentRuntime + createProductAgent fail closed on Chinese-numeral/unit dosing disguised as clarification
  const emptyRetriever = createKnowledgeRetriever({ candidates: async () => [] }, fakeEmbeddingGateway());
  for (const [userMsg, dosingText] of [
    ["隻藥應該點食？", "每次半粒。"],
    ["隻藥應該點食？", "每次一粒。"],
    ["退燒藥粉食幾多？", "每次半包。"],
    ["隻藥應該點食？", "半粒。"],
  ] as const) {
    const draft = {
      userRequest: userMsg,
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: dosingText, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(isPureClarifyingQuestion(dosingText), false);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `Must classify dosing fragment as substantive care: ${dosingText}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `Must require review for dosing fragment: ${dosingText}`);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, `Must require sources for dosing fragment: ${dosingText}`);

    let step = 0;
    let savedResult: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({
      config,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          const current = step++;
          const functionCall = current === 0
            ? { id: "search-dosing-empty", name: "search_knowledge", args: { query: userMsg, classification: "official_guidance" } }
            : { id: "present-dosing", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: dosingText, citationIds: [] }] } };
          return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
        },
      },
    });
    const agent = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
        get: async () => savedResult,
      } as any,
      memory: { context: async () => emptyMemoryContext() } as any,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: emptyRetriever,
    });
    const result = await agent.reply(userId, childId, messageId, async () => true);
    assert.ok(result);
    assert.equal(result.status, "stopped");
    assert.equal(result.stopReason, "delivery_review_no_sources");
    assert.equal(result.text.includes("半粒") || result.text.includes("一粒") || result.text.includes("半包"), false);
  }
});

test("R4: illness synonyms never borrow starting-solids, and unverified completion or dose wording is never plain text (F1-F3)", async (t) => {
  // F1: embedding is uniformly unavailable for every query, so keyword_degraded retrieval is the only path
  // (no symptom-aware fake vectors). Only the bare "when can baby start solids" question may retrieve starting-solids.
  const seedSources = await loadCuratedSeedSources();
  const fsEnv = createInMemoryFirestoreKnowledgeStore([...LOCAL_OFFICIAL_SEED_IDS]);
  const localManifest = await loadLocalDevelopmentManifest();
  for (const src of seedSources) {
    await fsEnv.publishSource(src, buildLocalOfficialSeedAssessment(src, localManifest), () => vector);
  }
  const degradedGateway = createEmbeddingGateway({
    config,
    usage: fakeUsage(),
    provider: { embed: async () => { throw new Error("Synthetic embedding provider unavailable"); } },
  });
  const degradedRetriever = createKnowledgeRetriever(fsEnv.store, degradedGateway);
  const hkFilter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 6, maxMonths: 6 },
    topics: [],
  });
  for (const query of [
    "BB幾時嘔完可以食嘢？",
    "BB幾個月唔肯食嘢？",
    "BB肚瀉幾時先可以食嘢？",
    "BB屙水完幾時可以食嘢？",
    "BB腸胃炎之後幾時可以食嘢？",
    "BB做完手術幾時可以食嘢？",
    "BB長濕疹幾時可以食嘢？",
  ]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const res = await degradedRetriever.createRun({ actor: queryActor, budget, authorize: async () => true }).search(query, hkFilter);
    assert.equal(res.mode, "keyword_degraded", `Control must stay in keyword_degraded mode: ${query}`);
    assert.deepEqual(res.chunks, [], `Illness/other-clause timing must not borrow starting-solids: ${query}`);
  }
  for (const query of ["BB幾時可以食嘢？", "半歲BB幾時可以食嘢？", "請問BB幾時可以開始食嘢呢？"]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const res = await degradedRetriever.createRun({ actor: queryActor, budget, authorize: async () => true }).search(query, hkFilter);
    assert.equal(res.mode, "keyword_degraded");
    assert.equal(res.chunks[0]?.key, "starting-solids", `Bare solids-timing question must keep official recall: ${query}`);
  }

  // F2/F3: real runtime + product agent. The model only calls present_answer; no operation tool ever writes a receipt.
  async function presentOnly(userMsg: string, draftText: string, kind: "clarification" | "caregiving" = "clarification") {
    let reviewCalls = 0;
    let savedResult: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({
      config,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "insufficient_evidence", issues: [{ paragraph: 0, reason: "unverified claim" }] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          const functionCall = { id: "present-r4", name: "present_answer", args: { kind, paragraphs: [{ text: draftText, citationIds: [] }] } };
          return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
        },
      },
    });
    const agent = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
        get: async () => savedResult,
      } as any,
      memory: { context: async () => emptyMemoryContext() } as any,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: createKnowledgeRetriever({ candidates: async () => [] }, fakeEmbeddingGateway()),
    });
    const result = await agent.reply(userId, childId, messageId, async () => true);
    assert.ok(result);
    return { result, reviewCalls };
  }

  for (const [userMsg, claim] of [
    ["幫我更改提醒", "提醒時間改好喇。"],
    ["刪除紀錄", "所有紀錄都清空晒。"],
    ["幫我取消提醒", "搞掂喇，提醒已經冇咗。"],
    ["幫我更新提醒時間", "提醒時間已經轉做七點。"],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: claim, citationIds: [] }],
      sources: [],
      scope,
    }), true, `Bare completion wording without userRequest must require review: ${claim}`);
    const draft = {
      userRequest: userMsg,
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: claim, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(draft), true, `Completion wording without a receipt must require review: ${claim}`);
    const { result, reviewCalls } = await presentOnly(userMsg, claim);
    assert.equal(reviewCalls, 1, `Unverified completion must reach delivery review: ${claim}`);
    assert.equal(result.status, "stopped");
    assert.equal(result.text.includes(claim), false);
  }

  for (const [userMsg, dose] of [
    ["BB發燒點算？", "每次四分之一粒。"],
    ["BB發燒點算？", "每晚半粒，連續三日。"],
    ["BB發燒點算？", "一日兩次，每次1/4粒。"],
    ["BB發燒點算？", "睡前食半茶匙。"],
    ["BB發燒點算？", "四分一粒。"],
    ["BB發燒點算？", "每4小時四分之一粒。"],
  ] as const) {
    const bareDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: dose, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(bareDraft), true, `Bare dose wording must classify as care advice: ${dose}`);
    assert.equal(requiresChatDeliveryReview(bareDraft), true, `Bare dose wording must require review: ${dose}`);
    const draft = {
      ...bareDraft,
      userRequest: userMsg,
    };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `Dose wording is care advice without a medicine word in the question: ${dose}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `Dose wording must require review: ${dose}`);
    const { result } = await presentOnly(userMsg, dose);
    assert.equal(result.status, "stopped", `Ungrounded dose must not be delivered: ${dose}`);
    assert.equal(result.text.includes("粒") || result.text.includes("茶匙"), false);
  }

  // Controls: genuine small talk, bounded clarifying questions, and a question back to the user stay exempt.
  for (const [userMsg, text] of [
    ["你好", "你好！有咩可以幫到你？"],
    ["幫我更改提醒", "你想改成幾點？"],
    ["BB發燒點算？", "BB而家幾個月大？"],
  ] as const) {
    const draft = {
      userRequest: userMsg,
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(draft), false, `Control must stay exempt: ${text}`);
  }
});

test("R5: age-bearing post-illness queries, statement+follow-up claims, and English/Chinese spoon doses fail closed (F1-F3)", async (t) => {
  // F1: Real Firestore keyword_degraded retrieval with all 5 curated seeds must not recall solids just from age bigrams.
  const seedSources = await loadCuratedSeedSources();
  const fsEnv = createInMemoryFirestoreKnowledgeStore([...LOCAL_OFFICIAL_SEED_IDS]);
  const localManifest = await loadLocalDevelopmentManifest();
  for (const src of seedSources) {
    await fsEnv.publishSource(src, buildLocalOfficialSeedAssessment(src, localManifest), () => vector);
  }
  const degradedGateway = createEmbeddingGateway({
    config,
    usage: fakeUsage(),
    provider: { embed: async () => { throw new Error("Synthetic embedding provider unavailable"); } },
  });
  const degradedRetriever = createKnowledgeRetriever(fsEnv.store, degradedGateway);
  const hkFilter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 6, maxMonths: 6 },
    topics: [],
  });
  for (const query of [
    "半歲BB屙水完幾時可以食嘢？",
    "六個月BB腸胃炎之後幾時可以食嘢？",
    "半歲BB發燒之後幾時先可以食嘢？",
  ]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const res = await degradedRetriever.createRun({ actor: queryActor, budget, authorize: async () => true }).search(query, hkFilter);
    assert.equal(res.mode, "keyword_degraded");
    assert.deepEqual(res.chunks, [], `Age-bearing post-illness timing must not recall solids: ${query}`);
  }
  for (const query of ["半歲BB幾時可以食嘢？", "六個月BB幾時可以開始食嘢？"]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const res = await degradedRetriever.createRun({ actor: queryActor, budget, authorize: async () => true }).search(query, hkFilter);
    assert.equal(res.mode, "keyword_degraded");
    assert.ok(
      res.chunks.some(c => c.key === "starting-solids" || c.key === "introducing-solids-page-3"),
      `Legitimate age-bearing solids timing must still recall solids: ${query}`,
    );
  }

  // F2/F3: Real runtime + ProductAgent end-to-end.
  async function presentOnly(userMsg: string, draftText: string) {
    let reviewCalls = 0;
    let savedResult: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({
      config,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "insufficient_evidence", issues: [{ paragraph: 0, reason: "unverified claim" }] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ functionCall: { id: "present-r5", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: draftText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const agent = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
        get: async () => savedResult,
      } as any,
      memory: { context: async () => emptyMemoryContext() } as any,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: createKnowledgeRetriever({ candidates: async () => [] }, fakeEmbeddingGateway()),
    });
    const result = await agent.reply(userId, childId, messageId, async () => true);
    assert.ok(result);
    return { result, reviewCalls };
  }

  for (const [userMsg, claim] of [
    ["幫我更改提醒時間", "提醒時間現為晚上八點。仲有其他事？"],
    ["刪除所有紀錄", "所有紀錄已經一筆不留。仲有其他事？"],
    ["幫我更改提醒時間", "提醒時間現為晚上八點，仲有其他事？"],
    ["幫我安排日程", "提醒時間現為晚上八點。"],
  ] as const) {
    const bareDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: claim, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(bareDraft), true, `Bare state-result claim must require review: ${claim}`);
    const draft = { ...bareDraft, userRequest: userMsg };
    assert.equal(requiresChatDeliveryReview(draft), true, `Statement + follow-up question must require review: ${claim}`);
    const { result, reviewCalls } = await presentOnly(userMsg, claim);
    assert.equal(reviewCalls, 1, `Unverified statement + question must reach delivery review: ${claim}`);
    assert.equal(result.status, "stopped");
    assert.equal(result.text.includes("晚上八點") || result.text.includes("一筆不留"), false);
  }

  for (const [userMsg, dose] of [
    ["BB發燒點算？", "Take one tablet at bedtime."],
    ["BB發燒點算？", "每餐一小匙，連續三日。"],
    ["BB發燒點算？", "Give two teaspoons once daily."],
    ["BB發燒點算？", "一日兩次，每次兩大匙。"],
    ["BB發燒點算？", "每次50微克。"],
  ] as const) {
    const bareDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: dose, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(bareDraft), true, `Bare dose wording must classify as care advice: ${dose}`);
    assert.equal(requiresChatDeliveryReview(bareDraft), true, `Bare dose wording must require review: ${dose}`);
    const draft = { ...bareDraft, userRequest: userMsg };
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `Dose wording must classify as care advice: ${dose}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `Dose wording must require review: ${dose}`);
    const { result } = await presentOnly(userMsg, dose);
    assert.equal(result.status, "stopped", `Ungrounded dose must not be delivered: ${dose}`);
    assert.equal(result.text.includes("tablet") || result.text.includes("小匙") || result.text.includes("teaspoon") || result.text.includes("微克"), false);
  }

  for (const [userMsg, text] of [
    ["你好", "你好！有咩可以幫到你？"],
    ["幫我更改提醒時間", "你想改成幾點？"],
    ["刪除所有紀錄", "請問你想刪除哪一項？"],
    ["BB發燒點算？", "BB而家幾個月大？"],
    ["BB發燒點算？", "請問，BB有沒有發燒？"],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      userRequest: userMsg,
      kind: "clarification",
      visibility: "private",
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    }), false, `Pure control must stay exempt: ${userMsg} -> ${text}`);
  }
});

test("structural review boundaries: state-claim+followup, receipt correspondence, arbitrary numerals/zero-number directives, and SPEC:301-304 separation", async t => {
  // 1. Result/state claim + follow-up question must fail closed even in bare drafts, while pure parameter choice stays exempt.
  for (const [userMsg, text] of [
    ["幫我更改提醒時間", "提醒時間而家係八點，想改邊一項？"],
    ["幫我更改提醒時間", "提醒時間而家係八點。想改邊一項？"],
    ["清空舊紀錄", "目前已清空舊紀錄，仲想做乜？"],
  ] as const) {
    const bareDraft = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(bareDraft), true, `Bare result/state+question must require review: ${text}`);
    assert.equal(requiresChatDeliveryReview({ ...bareDraft, userRequest: userMsg }), true, `Result/state+question must require review: ${text}`);
  }
  for (const [userMsg, choice] of [
    ["幫我更改提醒時間", "你想改成八點定九點？"],
    ["幫我更改提醒時間", "請問，你想改成八點定九點？"],
    ["刪除所有紀錄", "請問你想刪除哪一項提醒？"],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      userRequest: userMsg,
      kind: "clarification",
      visibility: "private",
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: choice, citationIds: [] }],
      sources: [],
      scope,
    }), false, `Legitimate parameter choice must stay exempt: ${choice}`);
  }

  // 2. Receipt correspondence: pending/failed/wrong-action/wrong-target receipts must NOT grant skip or pass acceptLivePass.
  const mismatchedCases = [
    {
      name: "pending_confirmation claiming executed create",
      text: "已幫你建立買牛奶提醒。",
      ops: [{ kind: "pending_confirmation" as const, id: "p1", tool: "propose_task", state: "pending_confirmation", summary: "買牛奶 (2026-11-17T09:00:00Z)" }],
    },
    {
      name: "failed action_receipt claiming completed cancel",
      text: "已經取消買牛奶提醒。",
      ops: [{ kind: "action_receipt" as const, id: "r1", tool: "change_ordinary_reminder", state: "failed", summary: "cancel: 買牛奶" }],
    },
    {
      name: "private note save receipt claiming task deletion",
      text: "已刪除買蛋待辦。",
      ops: [{ kind: "action_receipt" as const, id: "r2", tool: "save_private_instruction", state: "saved", summary: "準備手冊: 帶健康手冊" }],
    },
    {
      name: "create_ordinary_reminder receipt claiming cleared records",
      text: "已清空所有舊紀錄。",
      ops: [{ kind: "action_receipt" as const, id: "r3", tool: "create_ordinary_reminder", state: "saved", summary: "喝奶提醒 (2026-11-17T08:00:00+08:00)" }],
    },
    {
      name: "save_ordinary_record water receipt claiming feeding 240ml",
      text: "已幫你記錄餵奶 240ml。",
      ops: [{ kind: "action_receipt" as const, id: "r4", tool: "save_ordinary_record", state: "saved", recordKind: "feeding", summary: "喝水 100ml" }],
    },
    {
      name: "create_ordinary_reminder milk receipt claiming eggs reminder",
      text: "已幫你設定買蛋提醒。",
      ops: [{ kind: "action_receipt" as const, id: "r5", tool: "create_ordinary_reminder", state: "saved", summary: "買牛奶" }],
    },
  ];
  for (const item of mismatchedCases) {
    const draft = {
      kind: "operation" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      verifiedOperations: item.ops,
      paragraphs: [{ text: item.text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(isPureVerifiedOperationSummary(draft), false, `${item.name}: mismatched receipt must not qualify as verified summary`);
    assert.equal(requiresChatDeliveryReview(draft), true, `${item.name}: mismatched receipt must require review`);
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: item.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" },
        tools: {
          presentation: async () => ({ text: item.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" }),
          deliveryDraft: () => draft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: "pass", issues: [] });
          },
        } as any,
        provenance: { packVersion: "test-v1", model: "gemini-2.5-flash" },
      }),
      (err: unknown) => err instanceof AgentStopped && ["delivery_review_rejected", "delivery_review_no_sources"].includes(err.reason),
      `${item.name}: acceptLivePass must reject mismatched operation claim even on pass`,
    );
  }
  const matchingDraft = {
    kind: "operation" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    verifiedOperations: [{ kind: "action_receipt" as const, id: "ok-1", tool: "save_ordinary_record", state: "saved", recordKind: "feeding", summary: "配方奶 120ml" }],
    paragraphs: [{ text: "已為你記錄寶寶飲配方奶 120ml。", citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(matchingDraft), true);
  assert.equal(chatDeliveryPassNeedsSources(matchingDraft), false);

  // 3. Arbitrary English numerals + zero-number CN/EN intake/fluid/fasting directives, keeping SPEC:301-304 separation.
  for (const text of [
    "Administer thirteen drops.",
    "Administer two thousand drops.",
    "Give twenty-five tablets daily.",
    "退燒前停止飲水。",
    "發熱前停止飲水。",
    "嘔吐後禁止進食。",
    "Stop drinking water until fever subsides.",
    "Withhold fluids after vomiting.",
  ]) {
    const draft = {
      userRequest: "BB發燒點算？",
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeDirectiveCareAdvice(draft), true, `Directive care must match: ${text}`);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `Substantive care must match: ${text}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `Directive care must require review: ${text}`);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, `Uncited directive care must require sources: ${text}`);
    assert.equal(isPureScopeRefusalOrLimitation(draft), false, `Directive care is never scope refusal: ${text}`);
  }

  // SPEC.md:301-304: sourced family record restatement, matching op confirmation, and pure refusal do NOT require public official citations when user asked a health question.
  const sourcedMemoryRestatement = {
    userRequest: "BB發燒點算，仲有對牛奶粉過敏紀錄嗎？",
    kind: "record_restatement" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: ["mem-1"] }],
    sources: [{
      citationId: "mem-1",
      version: "1",
      contentHash: chatDeliveryReviewSourceExcerpt("家庭紀錄顯示寶寶對牛奶蛋白過敏。").excerpt,
      classification: "private" as const,
      excerpt: "家庭紀錄顯示寶寶對牛奶蛋白過敏。",
      excerptComplete: true,
    }],
    scope,
  };
  assert.equal(chatDeliveryPassNeedsSources(sourcedMemoryRestatement), false, "Sourced family record restatement must not force public official citations");
  assert.equal(chatDeliveryPassNeedsSources({
    userRequest: "BB發燒點算？",
    kind: "clarification",
    visibility: "private",
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: "這類醫療診斷問題超出本系統協助範圍，無法提供解答。", citationIds: [] }],
    sources: [],
    scope,
  }), false, "Pure scope refusal must not force public official citations");
  assert.equal(chatDeliveryPassNeedsSources({
    ...matchingDraft,
    userRequest: "BB發燒點算，同幫我記低飲配方奶 120ml",
  }), false, "Verified operation summary must not force public official citations");

  // 4. R7 F1: Embedded/subordinate state premises inside parameter questions must fail closed end-to-end.
  for (const [userMsg, premiseQuestion] of [
    ["Change my reminder time", "Which reminder do you want to change now that the milk reminder is set to 20:00?"],
    ["Change my reminder time", "Since the 8pm reminder has been updated, which one should I edit next?"],
    ["幫我更改提醒時間", "既然八點嘅飲奶提醒已經設好，你想改邊一項？"],
    ["幫我更改提醒時間", "想改邊一項（目前飲奶提醒為晚上八點）？"],
  ] as const) {
    const bare = {
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: premiseQuestion, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(bare), true, `Bare embedded-premise question must require review: ${premiseQuestion}`);
    assert.equal(requiresChatDeliveryReview({ ...bare, userRequest: userMsg }), true, `Embedded-premise question must require review: ${premiseQuestion}`);
  }
  for (const [userMsg, pureChoice] of [
    ["Change my reminder time", "Which reminder would you like to change?"],
    ["Change my reminder time", "Do you want to change it to 8pm or 9pm?"],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      userRequest: userMsg,
      kind: "clarification",
      visibility: "private",
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: pureChoice, citationIds: [] }],
      sources: [],
      scope,
    }), false, `Pure parameter question must stay exempt: ${pureChoice}`);
  }

  // 5. R7 F2: Task-anchored care obligation & physical/topical/sleep-position care directives with pronouns must fail closed.
  for (const text of [
    "Apply rubbing alcohol to the skin to cool them.",
    "Let them sleep face down.",
    "Put a cold towel on their forehead and sponge them with lukewarm water.",
    "幫佢用火酒抹身降溫。",
    "畀佢趴喺度瞓覺會舒服啲。",
  ]) {
    const draft = {
      userRequest: "BB發燒點算？",
      kind: "clarification" as const,
      visibility: "private" as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeDirectiveCareAdvice(draft), true, `R7 F2 directive care must match: ${text}`);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `R7 F2 substantive care must match: ${text}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `R7 F2 must require review: ${text}`);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, `R7 F2 uncited directive care must require sources: ${text}`);
  }

  // 6. R7 F3: Every-field receipt correspondence — wrong time ("今朝 8 點" -> "今晚 9 點") and extra unbacked target ("買牛奶同買雞蛋") must fail closed.
  const wrongTimeRecordDraft = {
    userRequest: "今朝 8 點張保仔食咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好，幫我記低佢。",
    kind: "record_restatement" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    verifiedOperations: [{
      kind: "action_receipt" as const,
      id: "r-time-1",
      tool: "save_ordinary_record",
      state: "saved",
      recordKind: "feeding",
      summary: "今朝 8 點飲咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好。",
      eventTime: "今朝 8 點",
    }],
    paragraphs: [{ text: "已記低張保仔今晚 9 點飲咗 120ml 配方奶及 2 茶匙純米糊，精神好好。", citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(wrongTimeRecordDraft), false, "Wrong event time (今晚 9 點 vs 今朝 8 點) must not qualify as verified summary");
  assert.equal(chatDeliveryPassNeedsSources(wrongTimeRecordDraft), true, "Wrong event time must not bypass source requirement");

  const extraTargetReminderDraft = {
    userRequest: "幫我設定買牛奶同買雞蛋提醒",
    kind: "operation" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    verifiedOperations: [{
      kind: "action_receipt" as const,
      id: "r-milk-only",
      tool: "create_ordinary_reminder",
      state: "saved",
      summary: "買牛奶 (2026-11-17T08:00:00+08:00)",
    }],
    paragraphs: [{ text: "已設定買牛奶同買雞蛋提醒。", citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(extraTargetReminderDraft), false, "Partial receipt (milk only vs milk + eggs) must not qualify as verified summary");
  for (const badDraft of [wrongTimeRecordDraft, extraTargetReminderDraft]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" },
        tools: {
          presentation: async () => ({ text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" }),
          deliveryDraft: () => badDraft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: "pass", issues: [] });
          },
        } as any,
        provenance: { packVersion: "test-v1", model: "gemini-2.5-flash" },
      }),
      (err: unknown) => err instanceof AgentStopped && ["delivery_review_rejected", "delivery_review_no_sources"].includes(err.reason),
      `acceptLivePass must reject partial/wrong-field receipt claim: ${badDraft.paragraphs[0]!.text}`,
    );
  }
});

test("N1: word-bounded health terms avoid Will/ill false positives while preserving real health obligations and sticky review", async () => {
  async function runSingleTurn(userMsg: string, draftText: string, kind: "clarification" | "operation" = "clarification") {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = "aaaaaaaa-0000-4000-8000-000000000011";
    const localRunId = "bbbbbbbb-0000-4000-8000-000000000011";
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ functionCall: { id: `call-n1-${calls}`, name: "present_answer", args: { kind, paragraphs: [{ text: draftText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, role: "user", text: userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, calls, reviews };
  }

  for (const benignQuery of [
    "Will you help organise my notes?",
    "Help organise my notes.",
    "What should I do with my notes?",
    "How should I handle this reminder?",
  ]) {
    const { result, calls, reviews } = await runSingleTurn(benignQuery, "Which note would you like to edit?");
    assert.equal(result.status, "completed", benignQuery);
    assert.equal(calls, 1, benignQuery);
    assert.equal(reviews, 0, benignQuery);
    assert.equal(result.text, "Which note would you like to edit?", benignQuery);
  }

  for (const [careQuery, draftText] of [
    ["My baby is ill, what should I do?", "Rest in a quiet room today."],
    ["My child is sick, what should I do?", "Try half a teaspoon of syrup."],
    ["BB病咗點算？", "Keep them warm with one blanket today."],
  ] as const) {
    const { result, reviews } = await runSingleTurn(careQuery, draftText, "operation");
    assert.equal(reviews, 1, careQuery);
    assert.equal(result.status, "stopped", careQuery);
    assert.equal(result.stopReason, "delivery_review_no_sources", careQuery);
    assert.equal(result.text.includes(draftText), false, careQuery);
  }

  // Existing sticky obligation in a run cannot be cleared by later neutral text.
  const budget = new AgentBudget();
  try {
    const obligation = createChatDeliveryReviewObligation();
    assert.equal(requiresChatDeliveryReview({
      userRequest: "My child is ill.",
      kind: "caregiving",
      visibility: "private",
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: "Give ibuprofen.", citationIds: [] }],
      sources: [],
      scope,
    }, obligation), true);
    assert.equal(requiresChatDeliveryReview({
      userRequest: "Will you help organise my notes?",
      kind: "clarification",
      visibility: "private",
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: "Which note would you like to edit?", citationIds: [] }],
      sources: [],
      scope,
    }, obligation), true);
    assert.equal(obligation.required, true);
  } finally {
    budget.close();
  }
});

test("N2: prefix-only claims fail closed across early and resolved stages; unrelated private sources cannot back clinical directives while real private facts still pass", async t => {
  const allergyFact = {
    id: "aaaaaaaa-1111-4000-8000-000000000021",
    childId,
    key: "allergy-milk",
    content: "BB 對牛奶蛋白過敏",
    source: { kind: "manual" as const, description: "家長確認" },
    validUntil: null,
    visibility: "private" as const,
    intendedVisibility: "private" as const,
    status: "confirmed" as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認",
    applicable: true,
    sourceState: "current" as const,
  };
  const privateInputId = "aaaaaaaa-2222-4000-8000-000000000022";

  async function runPrivateScenario(opts: {
    userMsg: string;
    answerText: string;
    answerKind?: "record_restatement" | "private_reference" | "clarification";
    citePrivateSource?: boolean;
    privateExcerpt?: string;
    facts?: (typeof allergyFact)[];
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = "cccccccc-0000-4000-8000-000000000021";
    const localRunId = "dddddddd-0000-4000-8000-000000000021";
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.citePrivateSource && calls === 1) {
            return {
              content: { role: "model", parts: [{ functionCall: { id: "load-priv", name: "load_capabilities", args: { capabilities: ["private_sources"] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.citePrivateSource && calls === 2) {
            return {
              content: { role: "model", parts: [{ functionCall: { id: "read-priv", name: "read_private_source", args: { inputId: privateInputId, expectedVersion: 1 } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          const cid = opts.citePrivateSource ? [`private:${privateInputId}:1`] : [];
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "ans-n2",
                  name: "present_answer",
                  args: { kind: opts.answerKind ?? "record_restatement", paragraphs: [{ text: opts.answerText, citationIds: cid }] },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const privateItem = {
      id: privateInputId,
      version: 1,
      sourceLabel: "Family Note",
      fetchState: "ready",
      text: opts.privateExcerpt ?? "BB 對雞蛋過敏",
      sha256: "e".repeat(64),
      management: {
        purpose: "personal_reference",
        nature: "parent_note",
        timeScope: "ongoing",
        validityText: "有效",
        enabled: true,
        modelExcerpt: opts.privateExcerpt ?? "BB 對雞蛋過敏",
      },
    };
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, role: "user", text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
      ...(opts.citePrivateSource ? {
        sources: {
          list: async () => ({ inputs: [privateItem], hasMore: false, nextCursor: null }),
          get: async () => privateItem,
        },
      } : {}),
    } as any);
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews };
  }

  // Negative Stage 1 (sources: []): prefixed and unprefixed nil-by-mouth directives must stop.
  for (const directive of [
    "Family records show: Maintain nil-by-mouth overnight.",
    "Maintain nil-by-mouth overnight.",
    "家庭紀錄顯示：應整晚禁飲食。",
  ]) {
    const { result } = await runPrivateScenario({ userMsg: "BB發燒點算？", answerText: directive });
    assert.equal(result.status, "stopped", directive);
    assert.equal(result.stopReason, "delivery_review_no_sources", directive);
    assert.equal(result.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT, directive);
  }

  // Negative Stage 2 (sources: [private]): unrelated private memory/source OR parent note containing directive text cannot pass.
  for (const [label, excerpt] of [
    ["unrelated private excerpt", "BB 對雞蛋過敏"],
    ["private excerpt repeating clinical directive", "Maintain nil-by-mouth overnight."],
  ] as const) {
    const { result } = await runPrivateScenario({
      userMsg: "BB發燒點算？",
      answerText: "Family records show: Maintain nil-by-mouth overnight.",
      answerKind: "private_reference",
      citePrivateSource: true,
      privateExcerpt: excerpt,
    });
    assert.equal(result.status, "stopped", label);
    assert.equal(result.stopReason, "delivery_review_no_sources", label);
  }

  // Non-regex statement with unrelated private source under care obligation must also fail closed at Stage 2.
  const unrelatedResolvedDraft = {
    userRequest: "BB發燒點算？",
    kind: "record_restatement" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: "家庭紀錄顯示今日只需多蓋被不用再量體溫。", citationIds: ["mem-unrelated"] }],
    sources: [{
      citationId: "mem-unrelated",
      version: "1",
      contentHash: "f".repeat(64),
      classification: "private" as const,
      excerpt: "BB 對雞蛋過敏",
      excerptComplete: true,
    }],
    scope,
  };
  const stageObl = createChatDeliveryReviewObligation();
  assert.equal(requiresChatDeliveryReview({ ...unrelatedResolvedDraft, sources: [] }, stageObl), true);
  assert.equal(stageObl.evidenceRequired, true);
  assert.equal(chatDeliveryPassNeedsSources(unrelatedResolvedDraft, stageObl), true);

  // Positive Controls (SPEC.md:301-304): real matching confirmed memory & bounded clarification deliver cleanly.
  const validPrivate = await runPrivateScenario({
    userMsg: "BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？",
    answerText: "家庭紀錄顯示寶寶對牛奶蛋白過敏。",
    facts: [allergyFact],
  });
  assert.equal(validPrivate.result.status, "completed");
  assert.equal(validPrivate.result.deliveryReview?.decision, "pass");
  assert.equal(validPrivate.result.text, "家庭紀錄顯示寶寶對牛奶蛋白過敏。");
  assert.equal(validPrivate.reviews, 1);

  const validClarify = await runPrivateScenario({
    userMsg: "BB發燒點算？",
    answerText: "寶寶幾個月大？",
    answerKind: "clarification",
  });
  assert.equal(validClarify.result.status, "completed");
  assert.equal(validClarify.reviews, 0);
});

test("N3: Server-verified operations avoid 300-char truncation and bind item-level quantities, units, subjects, and times across single/multi/duplicate receipts", async t => {
  async function runRecordRuntime(opts: {
    userMsg: string;
    records: Array<{ text: string; eventTime: string; at?: string }>;
    claimText: string;
  }) {
    let calls = 0;
    let reviews = 0;
    let seenOps: Array<{ summary?: string; recordKind?: string; eventTime?: string }> = [];
    let saved: ProductAgentResult | null = null;
    const msgId = "eeeeeeee-0000-4000-8000-000000000031";
    const localRunId = "ffffffff-0000-4000-8000-000000000031";
    const receipts = opts.records.map((_, idx) => ({
      id: `10000000-0000-4000-8000-00000000000${idx + 1}`,
      runId: localRunId,
      kind: "save_record" as const,
      resource: { kind: "care_record" as const, id: `20000000-0000-4000-8000-00000000000${idx + 1}`, version: 1 },
      state: "saved" as const,
      notification: "not_authorized" as const,
      channels: [] as const,
      createdAt: "2026-11-17T00:00:00Z",
    }));
    const persisted = opts.records.map((rec, idx) => ({
      id: receipts[idx]!.resource.id,
      childId,
      version: 1,
      authorUserId: userId,
      createdAt: "2026-11-17T00:00:00Z",
      confirmedBy: userId,
      confirmedAt: "2026-11-17T00:00:00Z",
      reason: "user statement",
      text: rec.text,
      source: "user statement",
      confirmationBasis: "preauthorized_user_statement" as const,
      details: {
        kind: "feeding" as const,
        quantity: null,
        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: "Asia/Hong_Kong" as const, precision: (rec.at ? "exact" : "approximate") as "exact" | "approximate" },
      },
    }));
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string; verifiedOperations?: typeof seenOps };
            seenOps = payload.verifiedOperations ?? [];
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (calls === 1) {
            return {
              content: { role: "model", parts: [{ functionCall: { id: "lc-n3", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (calls === 2) {
            return {
              content: {
                role: "model",
                parts: opts.records.map((rec, execIdx) => ({
                  functionCall: {
                    id: `save-n3-${execIdx}`,
                    name: "save_ordinary_record",
                    args: {
                      sourceQuote: opts.userMsg,
                      expectedPolicyVersion: 1,
                      text: rec.text,
                      details: {
                        kind: "feeding",
                        quantity: null,
                        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: "Asia/Hong_Kong", precision: rec.at ? "exact" : "approximate" },
                      },
                    },
                  },
                })),
              },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ functionCall: { id: "pres-n3", name: "present_answer", args: { kind: "record_restatement", paragraphs: [{ text: opts.claimText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    let execCount = 0;
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      actions: {
        policy: async () => ({ version: 1, effective: true, recordKinds: ["feeding"], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
        records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
        notes: async () => ({ items: [], nextAfterId: null }),
        execute: async () => receipts[execCount++]!,
        receipts: async () => receipts.slice(0, execCount),
        recordById: async (_u: string, _c: string, id: string) => persisted.find(p => p.id === id) ?? null,
      } as any,
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [{ id: msgId, childId, role: "user", text: opts.userMsg }], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: "user", text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews, seenOps };
  }

  // 1. Exact R1 counterexample: swapped 120ml配方奶 / 240ml水 MUST stop even on reviewer pass.
  const swappedSingle = await runRecordRuntime({
    userMsg: "今朝 8 點飲 120ml 配方奶，加 240ml 水，幫我記低。",
    records: [{ text: "今朝 8 點飲 120ml 配方奶，加 240ml 水。", eventTime: "今朝 8 點" }],
    claimText: "已記低今朝 8 點飲 240ml 配方奶及 120ml 水。",
  });
  assert.equal(swappedSingle.reviews, 1);
  assert.equal(swappedSingle.result.status, "stopped");
  assert.ok(["delivery_review_rejected", "delivery_review_no_sources"].includes(swappedSingle.result.stopReason ?? ""));
  assert.equal(swappedSingle.result.text.includes("240ml 配方奶"), false);
  assert.equal(swappedSingle.result.text.includes("120ml 水"), false);

  // 2. Long (>300 chars) Server-verified record must not truncate tail quantities; accurate claim passes while swapped stops.
  const longPrefix = `${"家長備註晨間照顧流程紀錄文字說明，".repeat(20)}`;
  assert.ok(longPrefix.length > 300);
  const longTailText = `${longPrefix}今朝 8 點飲 120ml 配方奶，加 240ml 水。`;
  const longPass = await runRecordRuntime({
    userMsg: longTailText,
    records: [{ text: longTailText, eventTime: "今朝 8 點" }],
    claimText: "已記低今朝 8 點飲 120ml 配方奶及 240ml 水。",
  });
  assert.ok((longPass.seenOps[0]?.summary?.length ?? 0) > 300, "Server receipt summary must not truncate at 300 chars");
  assert.equal(longPass.result.status, "completed");
  assert.equal(longPass.result.deliveryReview?.decision, "pass");

  const longSwapped = await runRecordRuntime({
    userMsg: longTailText,
    records: [{ text: longTailText, eventTime: "今朝 8 點" }],
    claimText: "已記低今朝 8 點飲 240ml 配方奶及 120ml 水。",
  });
  assert.equal(longSwapped.result.status, "stopped");
  assert.ok(["delivery_review_rejected", "delivery_review_no_sources"].includes(longSwapped.result.stopReason ?? ""));

  // 3. Multi-receipt shared time: faithful claim passes; swapped quantities fail closed.
  const multiPass = await runRecordRuntime({
    userMsg: "今朝 8 點飲 120ml 配方奶，同飲 240ml 水，分兩筆幫我記低。",
    records: [
      { text: "今朝 8 點飲 120ml 配方奶。", eventTime: "今朝 8 點" },
      { text: "今朝 8 點飲 240ml 水。", eventTime: "今朝 8 點" },
    ],
    claimText: "已記低今朝 8 點飲 120ml 配方奶及 240ml 水。",
  });
  assert.equal(multiPass.result.status, "completed");
  assert.equal(multiPass.result.deliveryReview?.decision, "pass");

  const multiSwapped = await runRecordRuntime({
    userMsg: "今朝 8 點飲 120ml 配方奶，同飲 240ml 水，分兩筆幫我記低。",
    records: [
      { text: "今朝 8 點飲 120ml 配方奶。", eventTime: "今朝 8 點" },
      { text: "今朝 8 點飲 240ml 水。", eventTime: "今朝 8 點" },
    ],
    claimText: "已記低今朝 8 點飲 240ml 配方奶及 120ml 水。",
  });
  assert.equal(multiSwapped.result.status, "stopped");

  // 4. Duplicate items: two receipts allow duplicate claims; single receipt blocks duplicated claims.
  const dupPass = await runRecordRuntime({
    userMsg: "今朝 8 點飲 120ml 配方奶，下午 2 點又飲 120ml 配方奶。",
    records: [
      { text: "今朝 8 點飲 120ml 配方奶。", eventTime: "今朝 8 點" },
      { text: "下午 2 點飲 120ml 配方奶。", eventTime: "下午 2 點" },
    ],
    claimText: "已記低今朝 8 點飲 120ml 配方奶，及下午 2 點飲 120ml 配方奶。",
  });
  assert.equal(dupPass.result.status, "completed");

  const dupOverclaimDraft = {
    kind: "record_restatement" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    verifiedOperations: [{ kind: "action_receipt" as const, id: "dup-1", tool: "save_ordinary_record", state: "saved", recordKind: "feeding", summary: "今朝 8 點飲 120ml 配方奶。", eventTime: "今朝 8 點" }],
    paragraphs: [{ text: "已記低今朝 8 點飲 120ml 配方奶，另外仲飲 120ml 配方奶。", citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(dupOverclaimDraft), false);

  // 5. Swapped reminder times, ambiguous grouped quantities, and Server-removed quantity fail closed.
  for (const badDraft of [
    {
      ...dupOverclaimDraft,
      kind: "operation" as const,
      verifiedOperations: [
        { kind: "action_receipt" as const, id: "t1", tool: "create_ordinary_reminder", state: "saved", summary: "買牛奶 (2026-11-17T08:00:00+08:00)", dueAt: "2026-11-17T08:00:00+08:00" },
        { kind: "action_receipt" as const, id: "t2", tool: "create_ordinary_reminder", state: "saved", summary: "買雞蛋 (2026-11-17T21:00:00+08:00)", dueAt: "2026-11-17T21:00:00+08:00" },
      ],
      paragraphs: [{ text: "已設定今晚 9 點買牛奶及今朝 8 點買雞蛋提醒。", citationIds: [] }],
    },
    {
      ...dupOverclaimDraft,
      verifiedOperations: [{ kind: "action_receipt" as const, id: "amb-1", tool: "save_ordinary_record", state: "saved", recordKind: "feeding", summary: "今朝 8 點飲 120ml 配方奶，加 240ml 水。", eventTime: "今朝 8 點" }],
      paragraphs: [{ text: "已記低今朝 8 點飲 120ml 同 240ml 配方奶及水。", citationIds: [] }],
    },
    {
      ...dupOverclaimDraft,
      verifiedOperations: [{ kind: "action_receipt" as const, id: "rem-1", tool: "save_ordinary_record", state: "saved", recordKind: "feeding", summary: "飲 120ml 配方奶。", quantity: null, quantityGroundingStatus: "removed" as const }],
      paragraphs: [{ text: "已記低飲 120ml 配方奶。", citationIds: [] }],
    },
  ]) {
    assert.equal(isPureVerifiedOperationSummary(badDraft), false, badDraft.paragraphs[0]!.text);
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" },
        tools: {
          presentation: async () => ({ text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: "not_used" }),
          deliveryDraft: () => badDraft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf("{"))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: "pass", issues: [] });
          },
        } as any,
        provenance: { packVersion: "test-v1", model: "gemini-2.5-flash" },
      }),
      (err: unknown) => err instanceof AgentStopped && ["delivery_review_rejected", "delivery_review_no_sources"].includes(err.reason),
    );
  }
});

test("N1-R / N2-R / N3-R: polysemous formula exclusion, per-clause private support, and full ISO calendar-date correspondence", async () => {
  const allergyFact = {
    id: "aaaaaaaa-1111-4000-8000-000000000091",
    childId,
    key: "allergy-milk-r9",
    content: "BB對牛奶蛋白過敏",
    source: { kind: "manual" as const, description: "家長確認" },
    validUntil: null,
    visibility: "private" as const,
    intendedVisibility: "private" as const,
    status: "confirmed" as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認",
    applicable: true,
    sourceState: "current" as const,
  };
  const sleepFact = {
    ...allergyFact,
    id: "aaaaaaaa-1111-4000-8000-000000000092",
    key: "sleep-nap-r9",
    content: "BB平時下晝 2 點會瞓晏晝覺",
  };

  async function runDeliveryFlow(opts: {
    userMsg: string;
    answerKind: "clarification" | "record_restatement" | "operation";
    answerText: string;
    facts?: (typeof allergyFact)[];
    records?: Array<{ text: string; eventTime: string; at?: string }>;
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = "dddddddd-1111-4000-8000-000000000091";
    const localRunId = "eeeeeeee-1111-4000-8000-000000000091";
    const receipts = (opts.records ?? []).map((_, idx) => ({
      id: `30000000-0000-4000-8000-00000000000${idx + 1}`,
      runId: localRunId,
      kind: "save_record" as const,
      resource: { kind: "care_record" as const, id: `40000000-0000-4000-8000-00000000000${idx + 1}`, version: 1 },
      state: "saved" as const,
      notification: "not_authorized" as const,
      channels: [] as const,
      createdAt: "2026-11-17T00:00:00Z",
    }));
    const persisted = (opts.records ?? []).map((rec, idx) => ({
      id: receipts[idx]!.resource.id,
      childId,
      version: 1,
      authorUserId: userId,
      createdAt: "2026-11-17T00:00:00Z",
      confirmedBy: userId,
      confirmedAt: "2026-11-17T00:00:00Z",
      reason: "user statement",
      text: rec.text,
      source: "user statement",
      confirmationBasis: "preauthorized_user_statement" as const,
      details: {
        kind: "feeding" as const,
        quantity: null,
        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: "Asia/Hong_Kong" as const, precision: (rec.at ? "exact" : "approximate") as "exact" | "approximate" },
      },
    }));
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.records?.length && calls === 1) {
            return {
              content: { role: "model", parts: [{ functionCall: { id: "lc-r", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.records?.length && calls === 2) {
            return {
              content: {
                role: "model",
                parts: opts.records.map((rec, idx) => ({
                  functionCall: {
                    id: `save-r-${idx}`,
                    name: "save_ordinary_record",
                    args: {
                      sourceQuote: opts.userMsg,
                      expectedPolicyVersion: 1,
                      text: rec.text,
                      details: {
                        kind: "feeding",
                        quantity: null,
                        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: "Asia/Hong_Kong", precision: rec.at ? "exact" : "approximate" },
                      },
                    },
                  },
                })),
              },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ functionCall: { id: "pres-r", name: "present_answer", args: { kind: opts.answerKind, paragraphs: [{ text: opts.answerText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    let execCount = 0;
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      ...(opts.records?.length ? {
        actions: {
          policy: async () => ({ version: 1, effective: true, recordKinds: ["feeding"], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
          records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
          notes: async () => ({ items: [], nextAfterId: null }),
          execute: async () => receipts[execCount++]!,
          receipts: async () => receipts.slice(0, execCount),
          recordById: async (_u: string, _c: string, id: string) => persisted.find(p => p.id === id) ?? null,
        } as any,
      } : {}),
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: opts.records?.length ? [{ id: msgId, childId, role: "user", text: opts.userMsg }] : [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: "user", text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, calls, reviews };
  }

  // N1-R: Spreadsheet formula vs equation complete in 1 call (0 review), while genuine infant formula / ill baby stay protected.
  for (const benign of ["How should I handle this spreadsheet formula?", "How should I handle this spreadsheet equation?", "How should I handle this Halloween treat?"]) {
    const out = await runDeliveryFlow({ userMsg: benign, answerKind: "clarification", answerText: "Which spreadsheet cell would you like to edit?" });
    assert.equal(out.result.status, "completed", benign);
    assert.equal(out.calls, 1, benign);
    assert.equal(out.reviews, 0, benign);
  }
  for (const infantQuery of ["How should I handle preparing infant formula?", "How should I handle formula milk storage?"]) {
    const out = await runDeliveryFlow({ userMsg: infantQuery, answerKind: "operation", answerText: "Keep it on the counter for a day." });
    assert.equal(out.reviews, 1, infantQuery);
    assert.equal(out.result.status, "stopped", infantQuery);
    assert.equal(out.result.stopReason, "delivery_review_no_sources", infantQuery);
  }

  // N2-R: Mixed contradictory / fabricated allergy claims inside a paragraph citing/hydrating one true memory fact MUST stop; faithful single/multi-fact controls pass.
  for (const badPrivateText of [
    "家庭紀錄顯示寶寶對牛奶蛋白過敏，但寶寶並無牛奶蛋白過敏。",
    "家庭紀錄顯示寶寶對牛奶蛋白過敏，亦對雞蛋過敏。",
    "家庭紀錄顯示寶寶對牛奶蛋白過敏但寶寶並無牛奶蛋白過敏。",
    "家庭紀錄顯示寶寶對牛奶蛋白及雞蛋過敏。",
    "家庭紀錄顯示寶寶並無牛奶蛋白過敏。",
  ]) {
    const out = await runDeliveryFlow({
      userMsg: "BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？",
      answerKind: "record_restatement",
      answerText: badPrivateText,
      facts: [allergyFact],
    });
    assert.equal(out.result.status, "stopped", badPrivateText);
    assert.equal(out.result.stopReason, "delivery_review_no_sources", badPrivateText);
    assert.equal(out.result.text.includes("牛奶蛋白"), false, badPrivateText);
  }
  const goodSingle = await runDeliveryFlow({
    userMsg: "BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？",
    answerKind: "record_restatement",
    answerText: "家庭紀錄顯示寶寶對牛奶蛋白過敏。",
    facts: [allergyFact],
  });
  assert.equal(goodSingle.result.status, "completed");
  assert.equal(goodSingle.result.deliveryReview?.decision, "pass");
  const goodMultiFact = await runDeliveryFlow({
    userMsg: "BB發燒點算，仲有對牛奶蛋白過敏同作息紀錄嗎？",
    answerKind: "record_restatement",
    answerText: "家庭紀錄顯示寶寶對牛奶蛋白過敏，平時下午 2 點會睡午覺。",
    facts: [allergyFact, sleepFact],
  });
  assert.equal(goodMultiFact.result.status, "completed");

  // N3-R: Wrong ISO day (18 vs 17), wrong date-space (11-18), or wrong timezone offset MUST stop; exact ISO & equivalent Z instant pass.
  for (const wrongDateClaim of [
    "已記低2026-11-18T08:00:00+08:00 飲120ml奶。",
    "已記低2026-11-18 08:00 飲120ml奶。",
    "已記低2026-11-17T08:00:00Z 飲120ml奶。",
  ]) {
    const out = await runDeliveryFlow({
      userMsg: "記低2026-11-17T08:00:00+08:00 飲120ml奶。",
      answerKind: "record_restatement",
      answerText: wrongDateClaim,
      records: [{ text: "2026-11-17T08:00:00+08:00 飲120ml奶。", eventTime: "2026-11-17T08:00:00+08:00", at: "2026-11-17T00:00:00Z" }],
    });
    assert.equal(out.reviews, 1, wrongDateClaim);
    assert.equal(out.result.status, "stopped", wrongDateClaim);
    assert.ok(["delivery_review_rejected", "delivery_review_no_sources"].includes(out.result.stopReason ?? ""), wrongDateClaim);
  }
  for (const exactDateClaim of [
    "已記低2026-11-17T08:00:00+08:00 飲120ml奶。",
    "已記低2026-11-17T00:00:00Z 飲120ml奶。",
  ]) {
    const out = await runDeliveryFlow({
      userMsg: "記低2026-11-17T08:00:00+08:00 飲120ml奶。",
      answerKind: "record_restatement",
      answerText: exactDateClaim,
      records: [{ text: "2026-11-17T08:00:00+08:00 飲120ml奶。", eventTime: "2026-11-17T08:00:00+08:00", at: "2026-11-17T00:00:00Z" }],
    });
    assert.equal(out.result.status, "completed", exactDateClaim);
    assert.equal(out.result.deliveryReview?.decision, "pass", exactDateClaim);
  }
});

test("BND-1: mixed-kind private drafts validate every paragraph by content without trusting sibling record or clarification labels", async () => {
  const allergyFact = {
    id: "aaaaaaaa-1111-4000-8000-000000000191",
    childId,
    key: "allergy-milk-bnd1",
    content: "BB 對牛奶蛋白過敏",
    source: { kind: "manual" as const, description: "家長確認" },
    validUntil: null,
    visibility: "private" as const,
    intendedVisibility: "private" as const,
    status: "confirmed" as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認",
    applicable: true,
    sourceState: "current" as const,
  };
  const officialChunk = {
    chunkId: "00000000-0000-4000-8000-000000000411",
    versionId: "00000000-0000-4000-8000-000000000412",
    sourceId: "fhs-solid-food",
    title: "嬰幼兒飲食－引進固體食物過渡期",
    classification: "official_guidance" as const,
    text: "嬰兒約六個月大時可開始嘗試固體食物。",
  };

  async function runMixedParagraphFlow(opts: {
    userMsg: string;
    answerKind: "record_restatement" | "clarification" | "mixed";
    paragraphs: Array<{ kind: "record_restatement" | "clarification" | "caregiving"; text: string; citationIds: string[] }>;
    facts?: (typeof allergyFact)[];
    searchOfficial?: boolean;
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = "dddddddd-1111-4000-8000-000000000191";
    const localRunId = "eeeeeeee-1111-4000-8000-000000000191";
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.searchOfficial && calls === 1) {
            return {
              content: { role: "model", parts: [{ functionCall: { id: "k-bnd1", name: "search_knowledge", args: { query: "六個月固體食物", classification: "official_guidance" } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ functionCall: { id: "pres-bnd1", name: "present_answer", args: { kind: opts.answerKind, paragraphs: opts.paragraphs } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as never,
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as never,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: "user", text: opts.userMsg }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: "vector_keyword", chunks: opts.searchOfficial ? [officialChunk] : [] }),
          revalidateCitations: async () => true,
        }),
      } as never,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews };
  }

  // Exact BND-1 reproducers: unsupported paragraph disguised as kind:"clarification" MUST fail closed even when sibling record paragraph is valid and reviewer passes.
  for (const neg of [
    {
      name: "BND-1 record_restatement + spoofed clarification allergy",
      answerKind: "record_restatement" as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
        { kind: "clarification" as const, text: "寶寶對腰果過敏。", citationIds: [] },
      ],
    },
    {
      name: "BND-1 top-level clarification + record_restatement + spoofed clarification",
      answerKind: "clarification" as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
        { kind: "clarification" as const, text: "寶寶對腰果過敏。", citationIds: [] },
      ],
    },
    {
      name: "BND-1 official citation + uncited spoofed allergy paragraph",
      answerKind: "mixed" as const,
      facts: [allergyFact],
      searchOfficial: true,
      paragraphs: [
        { kind: "caregiving" as const, text: "嬰兒約六個月大時可開始嘗試固體食物。", citationIds: [officialChunk.chunkId] },
        { kind: "clarification" as const, text: "寶寶對腰果過敏。", citationIds: [] },
      ],
    },
    {
      name: "BND-1 scope-refusal smuggling fake private allergy",
      answerKind: "record_restatement" as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
        { kind: "clarification" as const, text: "這類問題超出範圍，無法提供解答。但寶寶對腰果過敏。", citationIds: [] },
      ],
    },
  ]) {
    const out = await runMixedParagraphFlow({
      userMsg: "BB最近情況點樣，幫我查返已確認家庭紀錄？",
      answerKind: neg.answerKind,
      paragraphs: neg.paragraphs,
      facts: neg.facts,
      searchOfficial: neg.searchOfficial,
    });
    assert.equal(out.reviews, 1, neg.name);
    assert.equal(out.result.status, "stopped", neg.name);
    assert.equal(out.result.stopReason, "delivery_review_no_sources", neg.name);
    assert.equal(out.result.text.includes("腰果"), false, neg.name);
  }

  // Paired positive controls: faithful second paragraph and genuine bounded clarification both deliver cleanly.
  for (const pos of [
    {
      name: "BND-1 positive supported two-paragraph record",
      paragraphs: [
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
      ],
    },
    {
      name: "BND-1 positive record + genuine bounded clarification",
      paragraphs: [
        { kind: "record_restatement" as const, text: "家庭紀錄顯示寶寶對牛奶蛋白過敏。", citationIds: [] },
        { kind: "clarification" as const, text: "寶寶幾個月大？", citationIds: [] },
      ],
    },
  ]) {
    const out = await runMixedParagraphFlow({
      userMsg: "BB最近情況點樣，幫我查返已確認家庭紀錄？",
      answerKind: "record_restatement",
      paragraphs: pos.paragraphs,
      facts: [allergyFact],
    });
    assert.equal(out.result.status, "completed", pos.name);
    assert.equal(out.result.deliveryReview?.decision, "pass", pos.name);
  }
});
