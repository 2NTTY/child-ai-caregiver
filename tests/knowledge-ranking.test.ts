import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { knowledgeIndexTokens, rankKnowledge } from "../server/knowledge-ranking.ts";
import type { KnowledgeCandidate } from "../src/shared/knowledge.ts";

function candidate(chunkId: string, distance: number | null, changes: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId, distance, key: chunkId, section: "一般資料", sourceExcerpt: "合成原文", text: "合成內容", keywords: [],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: [], conditions: [] },
    sourceId: "source", versionId: "version", versionHash: "version-hash", contentHash: "content-hash",
    url: "https://example.org/source", title: "一般指引", publisher: "Example",
    classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null,
    fetchedAt: "2026-01-01T00:00:00Z", checkedAt: "2026-01-01T00:00:00Z", reviewState: "reviewed",
    ...changes,
  };
}

test("RRF merges vector and keyword ranks and never exposes distance", () => {
  const result = rankKnowledge("BB 發燒點算呀", [
    candidate("vector", 0.1),
    candidate("both", 0.2, { title: "嬰兒發燒" }),
    candidate("keyword", null, { keywords: ["發燒"] }),
  ]);
  assert.deepEqual(result.map(item => item.chunkId), ["both", "keyword", "vector"]);
  assert.ok(result.every(item => !Object.hasOwn(item, "distance")));
});

test("default and requested limits cannot exceed six", () => {
  const input = Array.from({ length: 8 }, (_, index) => candidate("chunk-" + index, index / 100));
  assert.equal(rankKnowledge("發燒", input).length, 6);
  assert.equal(rankKnowledge("發燒", input, { limit: 100 }).length, 6);
  assert.equal(rankKnowledge("發燒", input, { limit: 2 }).length, 2);
});

test("duplicate chunk IDs use the closest candidate once", () => {
  const result = rankKnowledge("發燒", [
    candidate("same", 0.35),
    candidate("other", 0.2),
    candidate("same", 0.05),
  ]);
  assert.deepEqual(result.map(item => item.chunkId), ["same", "other"]);
});

test("equal ranks have a stable chunk ID tie break independent of input order", () => {
  const a = candidate("a", null, { title: "兒童咳嗽護理" });
  const b = candidate("b", null, { title: "兒童咳嗽護理" });
  assert.deepEqual(rankKnowledge("小朋友咳嗽點樣處理", [b, a]).map(item => item.chunkId), ["a", "b"]);
  assert.deepEqual(rankKnowledge("小朋友咳嗽點樣處理", [a, b]).map(item => item.chunkId), ["a", "b"]);
});

test("Traditional Chinese and Cantonese question wording retrieves substantive bigrams", () => {
  const fever = candidate("fever", null, { keywords: ["嬰兒發燒"] });
  const cough = candidate("cough", null, { title: "兒童咳嗽護理" });
  assert.deepEqual(rankKnowledge("請問 BB 發燒點算呀", [fever, cough]).map(item => item.chunkId), ["fever"]);
  assert.deepEqual(rankKnowledge("小朋友咳嗽點樣處理呢", [fever, cough]).map(item => item.chunkId), ["cough"]);
});

test("keyword rank needs a real token and a match, including body text", () => {
  const unrelated = candidate("unrelated", null, { title: "睡眠安排", text: "燒" });
  assert.deepEqual(rankKnowledge("發燒", [unrelated]), []);
  assert.deepEqual(rankKnowledge("請問呀", [candidate("vector", 0.1)]), []);
  assert.deepEqual(rankKnowledge("cat", [candidate("catalog", null, { title: "catalog" })]), []);
  assert.deepEqual(rankKnowledge("發燒", [candidate("body", null, { text: "兒童發燒資訊" })]).map(item => item.chunkId), ["body"]);
});

test("null distance supports keyword-only degradation and threshold excludes distant vectors", () => {
  const keyword = candidate("keyword", null, { applicability: {
    region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["發燒"], conditions: [],
  } });
  const distant = candidate("distant", 0.41);
  const edge = candidate("edge", 0.4);
  assert.deepEqual(rankKnowledge("發燒", [keyword, distant, edge]).map(item => item.chunkId), ["edge", "keyword"]);
  assert.deepEqual(rankKnowledge("發燒", [keyword, distant, edge], { maxCosineDistance: 0.3 })
    .map(item => item.chunkId), ["keyword"]);
});

test("invalid distances, thresholds and limits fail before ranking", () => {
  for (const distance of [Number.NaN, -0.01, 2.01, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rankKnowledge("發燒", [candidate("bad", distance)]), RangeError);
  }
  for (const maxCosineDistance of [Number.NaN, -1, 2.01, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rankKnowledge("發燒", [], { maxCosineDistance }), RangeError);
  }
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rankKnowledge("發燒", [], { limit }), RangeError);
  }
});

test("colloquial Cantonese question queries expand to official bigrams", () => {
  const solids = candidate("solids", null, { title: "引進固體食物", keywords: ["加固", "六個月"] });
  const vomiting = candidate("vomiting", null, { keywords: ["吐奶", "溢奶"] });
  const vision = candidate("vision", null, { keywords: ["視力", "驗眼"] });
  const fever = candidate("fever", null, { keywords: ["發燒", "求醫"] });
  assert.deepEqual(rankKnowledge("BB幾時可以食糊仔？", [solids, vision]).map(item => item.chunkId), ["solids"]);
  assert.deepEqual(rankKnowledge("半歲食開糊仔未？", [solids, vision]).map(item => item.chunkId), ["solids"]);
  assert.deepEqual(rankKnowledge("BB嘔奶點算", [vomiting, vision]).map(item => item.chunkId), ["vomiting"]);
  assert.deepEqual(rankKnowledge("四歲睇嘢瞇眼要唔要驗眼？", [vision, solids]).map(item => item.chunkId), ["vision"]);
  assert.deepEqual(rankKnowledge("BB發熱要去急症嗎？", [fever, solids]).map(item => item.chunkId), ["fever"]);
});

test("question=false corpus indexing stays invariant without query expansions or subject filtering", () => {
  const indexTokens = knowledgeIndexTokens("請問 BB 食糊仔點算 BB食嘢", false);
  assert.ok(indexTokens.has("bb"));
  assert.ok(indexTokens.has("食嘢"));
  assert.ok(indexTokens.has("請問"));
  assert.ok(indexTokens.has("點算"));
  assert.ok(!indexTokens.has("加固"));

  const questionTokens = knowledgeIndexTokens("請問 BB 食糊仔點算 BB食嘢", true);
  assert.ok(!questionTokens.has("bb"));
  assert.ok(!questionTokens.has("食嘢"));
  assert.ok(!questionTokens.has("請問"));
  assert.ok(!questionTokens.has("點算"));
  assert.ok(questionTokens.has("加固"));
  assert.ok(questionTokens.has("米糊"));
});

test("appetite refusal and missing official seed topics do not false-match starting-solids via BB", () => {
  const rawSeed = JSON.parse(readFileSync(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8")) as Array<{
    sourceId: string;
    url: string;
    title: string;
    publisher: string;
    classification: KnowledgeCandidate["classification"];
    sourcePublishedAt: string | null;
    sourceUpdatedAt: string | null;
    fetchedAt: string;
    chunks: Array<{
      key: string;
      section: string;
      sourceExcerpt: string;
      text: string;
      keywords: string[];
      applicability: KnowledgeCandidate["applicability"];
    }>;
  }>;
  const realSeedCandidates: KnowledgeCandidate[] = rawSeed.flatMap(source =>
    source.chunks.map(chunk => candidate(`${source.sourceId}/${chunk.key}`, null, {
      sourceId: source.sourceId,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      classification: source.classification,
      sourcePublishedAt: source.sourcePublishedAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
      fetchedAt: source.fetchedAt,
      key: chunk.key,
      section: chunk.section,
      sourceExcerpt: chunk.sourceExcerpt,
      text: chunk.text,
      keywords: chunk.keywords,
      applicability: chunk.applicability,
    })));
  assert.equal(realSeedCandidates.length, 6);
  for (const query of [
    "BB唔肯食嘢點算？",
    "BB食嘢唔開胃",
    "今晚BB唔肯食嘢，係咪生病？",
    "BB幾時可以食嘢？",
    "BB食嘢",
    "BB發燒點算",
    "BB發熱點算？",
    "BB幾時打針",
    "BB喺邊度打針？",
    "BB肚瀉點算？",
    "BB紅屁股點算？",
  ]) {
    assert.deepEqual(
      rankKnowledge(query, realSeedCandidates).map(item => item.chunkId),
      [],
      `Expected no official seed match for missing/refusal/narrowed-generic query: ${query}`,
    );
  }
  assert.ok(
    !rankKnowledge("BB發熱幾多度要睇醫生？", realSeedCandidates).some(item => item.sourceId === "fhs-solid-food"),
    "Fever + see-doctor query must never false-match fhs-solid-food",
  );
  // Document current 5-seed shared-word behavior on unfiltered queries (pending Owner decision on generic common words / additional seeds):
  // - "BB回奶係咪正常？" matches school-eye-care via shared generic bigram "正常" (never fhs-solid-food)
  // - "BB講嘢粗口" matches play-and-language via shared bigram "講嘢"
  const spitUpNormalUnfiltered = rankKnowledge("BB回奶係咪正常？", realSeedCandidates);
  assert.ok(!spitUpNormalUnfiltered.some(item => item.sourceId === "fhs-solid-food"));
  assert.deepEqual(spitUpNormalUnfiltered.map(item => item.chunkId), ["fhs-child-vision/school-eye-care"]);
  assert.deepEqual(
    rankKnowledge("BB講嘢粗口", realSeedCandidates).map(item => item.chunkId),
    ["fhs-toddler-development/play-and-language"],
  );
  assert.equal(
    rankKnowledge("BB半歲開糊要食啲咩？", realSeedCandidates)[0]?.chunkId,
    "fhs-solid-food/starting-solids",
  );
});
