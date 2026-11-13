import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { Pool } from "pg";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import type { EmbeddingActor, EmbeddingUsage } from "../server/embedding-gateway.ts";
import { parseKnowledgeFilter, parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import { baseAgentKnowledgeFilter, profileKnowledgeAge, resolveKnowledgeQueryContext } from "../server/knowledge-query-context.ts";
import { rankKnowledge } from "../server/knowledge-ranking.ts";
import { accumulateKnowledgeRead } from "../server/knowledge-read-coverage.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import {
  chatDeliveryDraftHash,
  chatDeliveryPassNeedsSources,
  chatDeliveryReviewSourceExcerpt,
  draftLooksLikeSubstantiveCareAdvice,
  enforceChatDeliveryReview,
  isPureClarifyingQuestion,
  requiresChatDeliveryReview,
} from "../server/chat-delivery-review.ts";
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT } from "../src/shared/chat-delivery-review.ts";
import { agentStopDetailHint, agentStopMessage } from "../src/shared/agent-stop-message.ts";
import type { KnowledgeCandidate, KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
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

function fakeEmbeddingGateway() {
  return createEmbeddingGateway({
    config,
    usage: fakeUsage(),
    provider: {
      embed: async () => ({ values: vector, inputTokens: 4, billableCharacters: 16 }),
    },
  });
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
  // Part A: Real rankKnowledge lexical matching against curated HK official seed chunks & symptom chunks
  const rawSeed = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8")) as unknown[];
  const parsedSeed = rawSeed.map(item => parseKnowledgeSource(item));
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
  for (const colloquialSolidQuery of ["BB幾時可以食糊仔？", "半歲BB點樣開糊？", "幾多個月開始食副食品？"]) {
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

  // Colloquial symptom queries ("嘔奶" -> "吐奶/溢奶", "發熱/睇醫生" -> "發燒/求醫") rank the matching official chunk first
  const chunkFever = mockChunk(chunkFeverId, {
    distance: null,
    key: "fever-care",
    title: "衛生署家庭健康服務 - 嬰幼兒發燒護理",
    keywords: ["發燒", "體溫", "求醫"],
    text: "衛生署指引：初生至三個月以下嬰兒肛溫達攝氏38度或以上，必須立即求醫。較大嬰兒若發燒持續不退、精神萎靡或抽搐，應前往急症室求診。",
    sourceExcerpt: "三個月以下嬰兒發燒達38度需立即求醫。",
  });
  const chunkVomit = mockChunk(chunkVomitId, {
    distance: null,
    key: "spitting-up",
  });
  assert.equal(rankKnowledge("BB成日嘔奶點算？", [chunkFever, chunkVomit])[0]?.chunkId, chunkVomitId);
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
  assert.equal(baseAgentKnowledgeFilter(approxSixYearContext, now).ageMatch, "overlap");
  assert.equal(baseAgentKnowledgeFilter(approxSixYearContext, now).region, "HK");

  // Part B: Real createKnowledgeStore(pool).candidates SQL parameter binding & applicability predicate evaluation
  const preschoolVisionId = "66666666-7777-4888-8999-000000000001";
  const schoolVisionId = "66666666-7777-4888-8999-000000000002";
  const ukFeverId = "66666666-7777-4888-8999-000000000003";

  const chunkPreschoolVision = mockChunk(preschoolVisionId, {
    key: "preschool-screening",
    text: "家庭健康服務的學前視力普查面向四至五歲孩子（48至未滿72個月）。",
    keywords: ["視力普查", "驗眼"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 48, maxAgeMonths: 72, maxAgeMonthsExclusive: true, topics: ["vision"], conditions: [] },
  });
  const chunkSchoolVision = mockChunk(schoolVisionId, {
    key: "school-eye-care",
    text: "學童護眼：6歲至10歲小學生閱讀時應保持30厘米距離及充足光線。",
    keywords: ["護眼", "視力檢查"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 72, maxAgeMonths: 120, topics: ["vision"], conditions: [] },
  });
  const chunkUkInfant = mockChunk(ukFeverId, {
    key: "uk-infant-vision",
    text: "NHS UK infant eye check guideline.",
    keywords: ["視力檢查", "驗眼"],
    applicability: { region: "UK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["vision"], conditions: [] },
  });

  const allDbChunks = [chunkPreschoolVision, chunkSchoolVision, chunkUkInfant];
  const recordedSql: Array<{ sql: string; values: unknown[] }> = [];
  const fakePool = {
    connect: async () => ({
      release() {},
      query: async (sql: string, values: unknown[] = []) => {
        recordedSql.push({ sql, values });
        if (!sql.includes("WITH eligible")) return { rows: [], rowCount: 0 };
        const classification = values[4] as string;
        const region = values[5] as string;
        const ageBasis = values[6] as string | null;
        const minMonths = values[7] as number | null;
        const maxMonths = values[8] as number | null;
        const ageMatch = values[11] as "contained" | "overlap" | "unknown";
        const chunkIds = values[12] as string[] | null;

        const matching = allDbChunks.filter(item => {
          if (item.classification !== classification) return false;
          if (item.applicability.region !== region) return false;
          if (chunkIds && !chunkIds.includes(item.chunkId)) return false;
          const app = item.applicability;
          if (app.ageBasis !== "any" && ageMatch !== "unknown") {
            if (!ageBasis || app.ageBasis !== ageBasis || minMonths === null || maxMonths === null) return false;
            const lowBound = ageMatch === "overlap" ? maxMonths : minMonths;
            const highBound = ageMatch === "overlap" ? minMonths : maxMonths;
            if ((app.minAgeMonths ?? 0) > lowBound) return false;
            if (app.maxAgeMonthsExclusive ? (app.maxAgeMonths ?? 0) <= highBound : (app.maxAgeMonths ?? 0) < highBound) return false;
          }
          return true;
        });

        return {
          rows: matching.map(item => ({
            id: item.chunkId,
            source_id: item.sourceId,
            version_id: item.versionId,
            version_hash: item.versionHash,
            content_hash: item.contentHash,
            source_document: {
              sourceId: item.sourceId,
              url: item.url,
              title: item.title,
              publisher: item.publisher,
              classification: item.classification,
              sourcePublishedAt: item.sourcePublishedAt,
              sourceUpdatedAt: item.sourceUpdatedAt,
              sourceDateText: item.sourceDateText,
              validUntil: item.validUntil,
              fetchedAt: item.fetchedAt,
              termsUrl: "https://www.fhs.gov.hk/terms",
              chunks: [item],
            } satisfies KnowledgeSourceInput,
            document: item,
            checked_at: new Date(item.checkedAt),
            last_successful_check_at: null,
            usage_scope: "public_noncommercial" as const,
            distance: 0.1,
            rank_score: "0.03",
          })),
          rowCount: matching.length,
        };
      },
    }),
  } as unknown as Pool;

  const pgStore = createKnowledgeStore(fakePool);
  const gateway = fakeEmbeddingGateway();
  const retriever = createKnowledgeRetriever(pgStore, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({ actor: queryActor, budget, authorize: async () => true });

  // 1) 6-month-old HK infant searching vision/eye care: 48-72m, 72-120m, and UK 0-12m are all excluded by KnowledgeStore
  const infantVisionResult = await run.search("視力檢查與護眼", resolvedSixMonth.filter);
  assert.equal(infantVisionResult.chunks.length, 0);
  const eligibleQuery = recordedSql.find(entry => entry.sql.includes("WITH eligible"))!;
  assert.equal(eligibleQuery.values[4], "official_guidance");
  assert.equal(eligibleQuery.values[5], "HK");
  assert.equal(eligibleQuery.values[6], "actual");
  assert.equal(eligibleQuery.values[7], 6);
  assert.equal(eligibleQuery.values[8], 6);
  assert.equal(eligibleQuery.values[11], "contained");

  // Revalidating older-child or foreign-region chunks under the 6-month HK filter fails
  assert.equal(await run.revalidateCitations(
    [{ chunkId: schoolVisionId, versionId: chunkSchoolVision.versionId, contentHash: chunkSchoolVision.contentHash }],
    resolvedSixMonth.filter,
  ), false);
  assert.equal(await run.revalidateCitations(
    [{ chunkId: ukFeverId, versionId: chunkUkInfant.versionId, contentHash: chunkUkInfant.contentHash }],
    resolvedSixMonth.filter,
  ), false);

  // 2) At exactly 72 months (6 years old) in HK, preschool-screening (48-72m exclusive) is excluded while school-eye-care (72-120m) matches
  const sixYearFilter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 72, maxMonths: 72 },
    ageMatch: "contained",
    topics: [],
  });
  const sixYearResult = await run.search("視力檢查與護眼", sixYearFilter);
  assert.deepEqual(sixYearResult.chunks.map(item => item.chunkId), [schoolVisionId]);
  assert.equal(sixYearResult.chunks[0]?.applicabilityStatus, "applicable");

  // Part C: When age/region applicability filters out all candidates, unapplicable care advice cannot be delivered
  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => confirmedSixMonthContext } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: retriever,
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

  // Build an originalText > 1200 chars where the critical contraindication/exception table is past char 1000 (beyond the 800-char default excerpt cap)
  const tableHeaderAndDosage = "衛生署幼兒退燒指引 表格一：撲熱息痛（Paracetamol）按體重計算劑量標準。"
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
  // Part A: Pure Cantonese & Mandarin clarifying questions skip semantic review and need no sources
  for (const pureClarifyText of [
    "請問BB目前幾多個月大？發燒持續咗幾多日？",
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

  // Part B: Disguised care advice or medication claims wrapped in questions fail closed
  for (const disguisedText of [
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
    assert.equal(draftLooksLikeSubstantiveCareAdvice(disguisedDraft), true);
    assert.equal(requiresChatDeliveryReview(disguisedDraft), true);
    assert.equal(chatDeliveryPassNeedsSources(disguisedDraft), true);
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
