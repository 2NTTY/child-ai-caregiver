import assert from "node:assert/strict";
import test from "node:test";
import { rankKnowledge } from "../server/knowledge-ranking.ts";
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
