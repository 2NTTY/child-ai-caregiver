import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { knowledgeIndexTokens, knowledgeTokens, rankKnowledge } from "../server/knowledge-ranking.ts";
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
      rankKnowledge(query, realSeedCandidates).map(item => item.chunkId),
      [],
      `Expected no official seed match for missing/refusal/off-topic query: ${query}`,
    );
  }
  assert.equal(
    rankKnowledge("BB幾時可以食嘢？", realSeedCandidates)[0]?.chunkId,
    "fhs-solid-food/starting-solids",
  );
  assert.equal(
    rankKnowledge("歲半BB仲未識行路同講嘢點算？", realSeedCandidates)[0]?.chunkId,
    "fhs-toddler-development/play-and-language",
  );
  assert.equal(
    rankKnowledge("BB半歲開糊要食啲咩？", realSeedCandidates)[0]?.chunkId,
    "fhs-solid-food/starting-solids",
  );
});

test("post-illness and feeding-refusal timing queries do not false-expand into starting-solids", () => {
  for (const query of [
    "BB幾時嘔完可以食嘢？",
    "BB幾個月唔肯食嘢點算？",
    "BB嘔完幾時可以食嘢？",
    "BB發燒幾時可以食嘢？",
    "BB肚瀉幾時先可以食嘢？",
    "BB屙水完幾時可以食嘢？",
    "BB腸胃炎之後幾時可以食嘢？",
    "BB做完手術幾時可以食嘢？",
    "BB長濕疹幾時可以食嘢？",
  ]) {
    const tokens = [...knowledgeTokens(query, true)];
    assert.equal(tokens.includes("加固"), false, `Unexpected 加固 expansion for: ${query}`);
    assert.equal(tokens.includes("固體"), false, `Unexpected 固體 expansion for: ${query}`);
    assert.equal(tokens.includes("米糊"), false, `Unexpected 米糊 expansion for: ${query}`);
    assert.deepEqual(
      rankKnowledge(query, [
        candidate("fhs-solid-food/starting-solids", null, {
          key: "starting-solids",
          title: "引進固體食物",
          section: "約六個月大時開始",
          sourceExcerpt: "未足四個月大的寶寶不應吃奶以外的食物。",
          text: "大約在寶寶六個月大時可開始加入米糊及固體食物。",
          keywords: ["加固", "固體食物", "米糊", "六個月"],
        }),
      ]).map(item => item.chunkId),
      [],
      `Expected no starting-solids match for post-illness/refusal query: ${query}`,
    );
  }
  for (const timingQuery of [
    "BB幾時可以食嘢？",
    "BB幾多個月先可以食嘢？",
    "BB幾大開始食固體食物？",
    "半歲BB幾時可以食嘢？",
    "六個月BB幾時可以食嘢？",
    "請問BB幾時可以開始食嘢呢？",
    "BB幾時先可以開始食嘢？",
    "寶寶幾多個月先可以食固體食物？",
  ]) {
    const tokens = [...knowledgeTokens(timingQuery, true)];
    assert.equal(tokens.includes("加固"), true, `Expected 加固 expansion for: ${timingQuery}`);
  }
});

test("age modifiers alone never pull starting-solids for post-illness queries while corpus index tokens stay invariant (R5 F1)", () => {
  const solidsCandidate = candidate("fhs-solid-food/starting-solids", null, {
    key: "starting-solids",
    title: "引進固體食物",
    section: "約六個月大時開始",
    sourceExcerpt: "未足四個月大的寶寶不應吃奶以外的食物。",
    text: "到了六個月大後，單靠吃母乳已不能滿足寶寶的營養需要。",
    keywords: ["加固", "固體食物", "米糊", "六個月"],
  });
  const solidsEnCandidate = candidate("fhs-feeding-booklet-en/introducing-solids-page-3", null, {
    key: "introducing-solids-page-3",
    title: "Healthy Eating for 6 to 24 month old children (1) — Getting Started",
    section: "PDF p.3 — Introduce solid foods at around 6 months",
    sourceExcerpt: "After 6 months, babies have a higher demand for iron;",
    text: "約六個月開始加入固體食物。",
    keywords: ["固體食物", "六個月", "solid foods"],
  });
  for (const query of [
    "半歲BB屙水完幾時可以食嘢？",
    "六個月BB腸胃炎之後幾時可以食嘢？",
    "3個月BB嘔完幾時可以食嘢？",
    "半歲BB發燒點算？",
    "6 month old baby diarrhea when can eat?",
  ]) {
    assert.deepEqual(
      rankKnowledge(query, [solidsCandidate, solidsEnCandidate]).map(item => item.chunkId),
      [],
      `Age tokens must not false-match starting-solids for: ${query}`,
    );
  }
  for (const timingQuery of ["半歲BB幾時可以食嘢？", "六個月BB幾時可以開始食嘢？", "半歲食開糊仔未？"]) {
    const ranked = rankKnowledge(timingQuery, [solidsCandidate, solidsEnCandidate]);
    assert.equal(ranked.length, 2, `Legitimate timing query must still recall solids: ${timingQuery}`);
  }
  assert.ok(knowledgeIndexTokens("到了六個月大後開始加固", false).has("六個"));
  assert.ok(knowledgeIndexTokens("到了六個月大後開始加固", false).has("個月"));
});
