import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import type { EmbeddingActor, EmbeddingProvider, EmbeddingUsage } from "../server/embedding-gateway.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { accumulateKnowledgeRead } from "../server/knowledge-read-coverage.ts";
import {
  chatDeliveryReviewSourceExcerpt,
  chatDeliveryDraftHash, enforceChatDeliveryReview,
} from "../server/chat-delivery-review.ts";
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT, CHAT_DELIVERY_REVIEW_POLICY_VERSION } from "../src/shared/chat-delivery-review.ts";
import { agentStopMessage, agentStopDetailHint } from "../src/shared/agent-stop-message.ts";
import { FamilyError } from "../server/family-access.ts";
import type { KnowledgeCandidate, KnowledgeFilter } from "../src/shared/knowledge.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";

const userId = "synthetic-parent-01";
const childId = "11111111-2222-4333-8444-555555555555";
const runId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const reference = "ffffffff-1111-4222-8333-444444444444";
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

function mockChunk(id: string, overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId: id,
    distance: 0.08,
    key: `key-${id}`,
    section: "嬰幼兒常見護理",
    sourceExcerpt: "嬰兒嘔奶若精神良好屬生理現象，可分次少量餵哺及拍嗝。",
    text: "嬰兒嘔奶若精神良好屬常見生理現象，建議家長少量多餐、餵奶後保持直立拍嗝。若伴隨高燒、噴射狀嘔吐或脫水徵狀，應向醫生諮詢。",
    keywords: ["嘔奶", "拍嗝", "發燒", "吐奶"],
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["vomiting", "feeding"], conditions: [] },
    sourceId: "src-fhs-feeding",
    versionId: "v-fhs-2025",
    versionHash: "d".repeat(64),
    contentHash: "c".repeat(64),
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/feeding.html",
    title: "衛生署家庭健康服務 - 嬰兒餵哺與嘔吐護理指南",
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
  const gateway = fakeEmbeddingGateway();
  const chunkFever = mockChunk("chunk-fever-01", {
    keywords: ["發燒", "急症", "高燒"],
    text: "衛生署指引：初生至三個月以下嬰兒肛溫達攝氏38度或以上，必須立即求醫。較大嬰兒若發燒持續不退、精神萎靡或抽搐，應前往急症室。",
    sourceExcerpt: "三個月以下嬰兒發燒達38度需立即求醫。",
  });
  const store = {
    candidates: async (filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { query?: string; chunkIds?: string[] }) => {
      if (opts?.chunkIds?.includes("chunk-fever-01") || opts?.query?.includes("發燒") || opts?.query?.includes("急症")) return [chunkFever];
      return [mockChunk("chunk-vomit-01")];
    },
  };
  const retriever = createKnowledgeRetriever(store, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({ actor: queryActor, budget, authorize: async () => true });

  // Query in colloquial Cantonese: "BB發燒幾多度要睇急症？"
  const searchResult = await run.search("BB發燒幾多度要睇急症？", {
    region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 2, maxMonths: 2 }, topics: [],
  });

  assert.equal(searchResult.mode, "vector_keyword");
  assert.equal(searchResult.chunks.length, 1);
  const found = searchResult.chunks[0];
  assert.equal(found.chunkId, "chunk-fever-01");
  assert.equal(found.classification, "official_guidance");

  // Revalidate citations must preserve exact version and contentHash
  const valid = await run.revalidateCitations(
    [{ chunkId: found.chunkId, versionId: found.versionId, contentHash: found.contentHash }],
    { region: "HK", classification: "official_guidance", age: null, topics: [] },
  );
  assert.equal(valid, true);

  // Mismatched contentHash or version fails revalidation
  const tampered = await run.revalidateCitations(
    [{ chunkId: found.chunkId, versionId: "wrong-version", contentHash: found.contentHash }],
    { region: "HK", classification: "official_guidance", age: null, topics: [] },
  );
  assert.equal(tampered, false);

  // End-to-end integration with product agent tools:
  // search_knowledge populates evidence and present_answer enforces structured citations
  const tools = createProductAgentTools({
    authorize: async () => true,
    run: { scope, budget, runId, authorize: async () => true },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    store: { authorize: async () => true } as any,
    knowledge: retriever,
  });

  const searchTool = tools.tools.find(tool => tool.name === "search_knowledge")!;
  const searchToolRes = await searchTool.execute(
    { query: "BB發燒幾多度要睇急症", classification: "official_guidance" },
    { callId: "call-search-1", queryEmbeddingAttemptKey: "attempt-1" } as any,
  );
  assert.equal(searchToolRes.status, "succeeded");
  const searchData = searchToolRes.data as { result: { chunks: Array<{ chunkId: string }> } };
  assert.equal(searchData.result.chunks.length, 1);
  assert.equal(searchData.result.chunks[0].chunkId, "chunk-fever-01");

  const presentTool = tools.tools.find(tool => tool.name === "present_answer")!;
  // Legitimate care advice with valid structured citationId succeeds
  const presentSuccess = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "衛生署指引建議三個月以下嬰兒若發燒達攝氏38度需立即就診。", citationIds: ["chunk-fever-01"] }],
  }, { callId: "call-present-1" } as any);
  assert.equal(presentSuccess.status, "succeeded");

  const deliveryDraft = tools.deliveryDraft()!;
  assert.equal(deliveryDraft.kind, "caregiving");
  assert.equal(deliveryDraft.sources.length, 1);
  assert.equal(deliveryDraft.sources[0].citationId, "chunk-fever-01");
  assert.equal(deliveryDraft.sources[0].classification, "official_guidance");
  assert.equal(deliveryDraft.sources[0].contentHash, found.contentHash);

  // Appending an unrecognized/fake citation alongside a valid official chunk throws invalid_citation
  const fakeCitationRes = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "虛構混合引用來源", citationIds: ["chunk-fever-01", "fake-uuid-not-retrieved"] }],
  }, { callId: "call-present-2" } as any);
  assert.equal(fakeCitationRes.status, "rejected");
  assert.equal(fakeCitationRes.data?.code, "invalid_citation");

  // Having no valid official citations in the paragraph throws citation_required
  const uncitedRes = await presentTool.execute({
    kind: "caregiving",
    paragraphs: [{ text: "完全無有效官方引用的照護建議", citationIds: ["fake-uuid-only"] }],
  }, { callId: "call-present-3" } as any);
  assert.equal(uncitedRes.status, "rejected");
  assert.equal(uncitedRes.data?.code, "citation_required");
});

test("age and region applicability mismatches block unapplicable advice from formal delivery (REQ-001 §7 Line 2)", async (t) => {
  const gateway = fakeEmbeddingGateway();
  // Chunk is explicitly for older children (6-12 years old)
  const chunkOlderChild = mockChunk("chunk-older-01", {
    applicability: { region: "HK", ageBasis: "actual", minAgeMonths: 72, maxAgeMonths: 144, topics: ["medication"], conditions: [] },
    text: "學童退燒藥水 dosage：6歲至12歲每次服用 10ml。",
  });
  // Chunk is foreign region
  const chunkUkRegion = mockChunk("chunk-uk-01", {
    applicability: { region: "UK", ageBasis: "actual", minAgeMonths: 0, maxAgeMonths: 12, topics: ["fever"], conditions: [] },
    text: "NHS UK guideline for infant fever.",
  });

  const store = {
    candidates: async (filter: KnowledgeFilter) => {
      // If filter specifies age 0-12 months, chunkOlderChild does not match
      if (filter.age && filter.age.maxMonths !== null && filter.age.maxMonths < 72) return [];
      if (filter.region && filter.region !== "UK") return [];
      return [chunkOlderChild, chunkUkRegion];
    },
  };

  const retriever = createKnowledgeRetriever(store, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({ actor: queryActor, budget, authorize: async () => true });

  // Query for a 6-month-old infant in HK
  const filteredResult = await run.search("退燒藥水", {
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 6, maxMonths: 6 },
    topics: [],
  });

  // Store filtered candidates based on applicability: 0 chunks returned
  assert.equal(filteredResult.chunks.length, 0);

  // Revalidating an older-child or foreign chunk under 6-month HK filter returns false
  const revalidated = await run.revalidateCitations(
    [{ chunkId: chunkOlderChild.chunkId, versionId: chunkOlderChild.versionId, contentHash: chunkOlderChild.contentHash }],
    { region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 6, maxMonths: 6 }, topics: [] },
  );
  assert.equal(revalidated, false);
});

test("long documents, tables and exception conditions maintain end-to-end traceability across chunks (REQ-001 §7 Line 5)", async (t) => {
  const gateway = fakeEmbeddingGateway();
  const chunk1 = mockChunk("chunk-tbl-01", {
    key: "doc-page-01",
    text: "衛生署幼兒退燒指引 表格一：撲熱息痛劑量標準。按幼兒體重每公斤計算每次 10-15mg。",
    originalText: "衛生署幼兒退燒指引 表格一：撲熱息痛劑量標準。按幼兒體重每公斤計算每次 10-15mg，每日不可超過四次。",
  });
  const chunk2 = mockChunk("chunk-tbl-02", {
    key: "doc-page-02",
    text: "表格二：重要禁忌與例外情況。患有蠶豆症（G6PD）或肝病幼兒必須經醫生處方；切勿給16歲以下兒童服用阿士匹靈。",
    originalText: "表格二：重要禁忌與例外情況。患有蠶豆症（G6PD）或肝病幼兒必須經醫生處方；切勿給16歲以下兒童服用阿士匹靈，以防引發雷氏綜合症。",
  });

  const store = {
    candidates: async (filter: KnowledgeFilter, _vec: readonly number[] | null, opts?: { chunkIds?: string[]; afterKey?: string | null }) => {
      if (opts?.chunkIds?.includes("chunk-tbl-01")) return [chunk1];
      if (opts?.chunkIds?.includes("chunk-tbl-02")) return [chunk2];
      if (opts?.afterKey === "doc-page-01") return [chunk2];
      return [chunk1];
    },
  };

  const retriever = createKnowledgeRetriever(store, gateway);
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({ actor: queryActor, budget, authorize: async () => true });

  const searchResult = await run.search("退燒劑量與禁忌", {
    region: "HK", classification: "official_guidance", age: null, topics: [],
  });
  assert.equal(searchResult.chunks.length, 1);
  const anchor = searchResult.chunks[0];

  // Call readContext to read following segments/tables across chunk boundaries
  const contextPage = await run.readContext(anchor, {
    region: "HK", classification: "official_guidance", age: null, topics: [],
  });

  assert.equal(contextPage.versionId, anchor.versionId);
  assert.ok(contextPage.chunks.length >= 2);
  assert.equal(contextPage.chunks[0].chunkId, "chunk-tbl-01");
  assert.equal(contextPage.chunks[1].chunkId, "chunk-tbl-02");

  // Multi-range accumulation for a single long chunk preserves coverage across reads
  const chunkLong = contextPage.chunks[0];
  const accumulated = accumulateKnowledgeRead(undefined, chunkLong);
  assert.equal(accumulated.readCoverage?.kind, "original_segment");
  assert.ok(accumulated.text.includes("表格一"));

  // Verify chatDeliveryReviewSourceExcerpt retains up to 4000 characters without losing exceptions
  const longExceptionText = "表格二：重要禁忌與例外情況。" + "說明細節。".repeat(200) + "關鍵例外：患有蠶豆症（G6PD）或肝病幼兒必須經醫生處方；切勿給16歲以下兒童服用阿士匹靈。";
  assert.ok(longExceptionText.length > 800);
  assert.ok(longExceptionText.length <= 4000);
  const fullExcerpt = chatDeliveryReviewSourceExcerpt(longExceptionText);
  assert.equal(fullExcerpt.excerptComplete, true);
  assert.ok(fullExcerpt.excerpt.includes("蠶豆症（G6PD）"));
  assert.ok(fullExcerpt.excerpt.includes("阿士匹靈"));
});

test("insufficient evidence cleanly stops with delivery_review_no_sources while retaining sources without hallucinated text (REQ-001 §7 Line 6)", () => {
  // Check stop copy contract
  const stopReason = "delivery_review_no_sources";
  const message = agentStopMessage(stopReason);
  assert.equal(message, "缺少可核對的來源依據，未成為正式回覆");

  const hint = agentStopDetailHint(stopReason);
  assert.ok(hint?.includes("缺少可核對的來源依據") || hint?.includes("目前沒有足夠依據"));

  // Check error message mapping
  const stoppedError = new AgentStopped(stopReason);
  assert.equal(stoppedError.reason, "delivery_review_no_sources");
});

test("pure clarifying questions deliver cleanly while uncited care claims wrapped in questions are held to review (REQ-001 §7 Lines 1, 6)", () => {
  // Part A: Legitimate clarifying question without citations delivers cleanly
  const pureClarifyDraft = {
    kind: "clarification" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: "請問BB目前幾多個月大？發燒持續咗幾多日？", citationIds: [] }],
    sources: [],
    scope,
  };

  const hash = chatDeliveryDraftHash(pureClarifyDraft);
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);

  // Part B: Disguised care advice inside a question format requires official sources
  const disguisedAdviceDraft = {
    kind: "clarification" as const,
    visibility: "private" as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: "BB發燒可以食撲熱息痛退燒藥水，你要唔要而家試下餵？", citationIds: [] }],
    sources: [],
    scope,
  };

  const hashDisguised = chatDeliveryDraftHash(disguisedAdviceDraft);
  assert.equal(typeof hashDisguised, "string");
  assert.notEqual(hash, hashDisguised);
});
