import type { KnowledgeCandidate, KnowledgeEvidence } from "../src/shared/knowledge.ts";

const RRF_K = 60;
const MAX_RESULTS = 6;
const QUESTION_PHRASES = /請問|想知道|想知|點樣|點算|點解|有冇|有無|係咪|是否|如何|怎樣|甚麼|什麼|乜嘢|可唔可以|可以|應該|幾時|邊度|洗唔洗|使唔使|要唔要|會唔會|好唔好/gu;
const QUESTION_PARTICLES = /[嗎呢呀啊嘛啦吧㗎嘅]/gu;
const LATIN_FILLERS = new Set(["a", "an", "the", "is", "are", "what", "how", "can", "should", "please"]);
/** Colloquial Cantonese parenting query terms mapped to official guidance bigrams on question queries only. */
const COLLOQUIAL_QUERY_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/開糊|糊仔|副食品?|輔食|食嘢/u, ["加固", "固體食物", "米糊"]],
  [/半歲/u, ["六個月"]],
  [/嘔奶|回奶|吐奶|溢奶/u, ["嘔奶", "吐奶", "溢奶"]],
  [/發熱|滾熱|發高燒|高燒/u, ["發燒"]],
  [/睇醫生|睇急症|去急症/u, ["求醫", "求診", "急症"]],
  [/睇嘢|瞇眼|捽眼|斜視|弱視/u, ["視力", "驗眼", "眼睛"]],
  [/行路|學行|未識行/u, ["走路", "發展"]],
  [/講嘢|學講|未識講|說話/u, ["語言", "講嘢"]],
  [/肚痾|肚瀉|屙水/u, ["腹瀉"]],
  [/紅屁股|尿片疹/u, ["尿布疹"]],
  [/打針/u, ["疫苗", "接種"]],
];

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function knowledgeIndexTokens(text: string, question = false): Set<string> {
  const rawNormalized = text.normalize("NFKC").toLowerCase();
  const normalized = question ? rawNormalized.replace(QUESTION_PHRASES, " ").replace(QUESTION_PARTICLES, "") : rawNormalized;
  const result = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const word = match[0];
    if (/^[a-z0-9]+$/u.test(word)) {
      if (word.length > 1 && !LATIN_FILLERS.has(word)) result.add(word);
      continue;
    }
    for (let index = 0; index + 1 < word.length; index++) result.add(word.slice(index, index + 2));
  }
  if (question) {
    for (const [pattern, synonyms] of COLLOQUIAL_QUERY_EXPANSIONS) {
      if (!pattern.test(rawNormalized)) continue;
      for (const synonym of synonyms) {
        for (let index = 0; index + 1 < synonym.length; index++) result.add(synonym.slice(index, index + 2));
      }
    }
  }
  return result;
}

export function knowledgeTokens(text: string, question = false): Set<string> {
  return new Set([...knowledgeIndexTokens(text, question)].slice(0, 64));
}

function matches(query: ReadonlySet<string>, text: string): number {
  const field = knowledgeTokens(text);
  let count = 0;
  for (const token of query) if (field.has(token)) count++;
  return count;
}

function keywordScore(query: ReadonlySet<string>, candidate: KnowledgeCandidate): number {
  return matches(query, candidate.title) * 4
    + matches(query, candidate.section) * 3
    + candidate.keywords.reduce((score, keyword) => score + matches(query, keyword) * 5, 0)
    + candidate.applicability.topics.reduce((score, topic) => score + matches(query, topic) * 4, 0)
    + matches(query, candidate.text);
}

/**
 * Rank server-filtered public knowledge by reciprocal rank fusion.
 * Distance only controls vector retrieval order; it is not citation support.
 */
export function rankKnowledge(
  query: string,
  candidates: readonly KnowledgeCandidate[],
  options: { maxCosineDistance?: number; limit?: number } = {},
): KnowledgeEvidence[] {
  const maxDistance = options.maxCosineDistance ?? 0.4;
  const requestedLimit = options.limit ?? MAX_RESULTS;
  if (!Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > 2) {
    throw new RangeError("maxCosineDistance must be between 0 and 2");
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new RangeError("limit must be a positive integer");
  }
  const limit = Math.min(requestedLimit, MAX_RESULTS);
  const unique = new Map<string, KnowledgeCandidate>();
  for (const candidate of candidates) {
    const distance = candidate.distance;
    if (distance !== null && (!Number.isFinite(distance) || distance < 0 || distance > 2)) {
      throw new RangeError("candidate distance must be null or between 0 and 2");
    }
    const previous = unique.get(candidate.chunkId);
    if (!previous || (distance !== null && (previous.distance === null || distance < previous.distance))) {
      unique.set(candidate.chunkId, candidate);
    }
  }

  if (candidates.length && candidates.every(candidate => candidate.rankScore !== undefined)) return candidates
    .slice(0, limit).map(({ distance: _distance, rankScore: _rankScore, ...item }) => item);
  const queryTokens = knowledgeTokens(query, true);
  if (queryTokens.size === 0) return [];
  const items = [...unique.values()];
  const vectorRank = items
    .filter(candidate => candidate.distance !== null && candidate.distance <= maxDistance)
    .sort((left, right) => left.distance! - right.distance! || compareId(left.chunkId, right.chunkId));
  const keywordRank = items
    .map(candidate => ({ candidate, score: keywordScore(queryTokens, candidate) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || compareId(left.candidate.chunkId, right.candidate.chunkId));

  const combined = new Map<string, { candidate: KnowledgeCandidate; score: number; bestRank: number }>();
  function add(candidate: KnowledgeCandidate, rank: number): void {
    const previous = combined.get(candidate.chunkId);
    if (previous) {
      previous.score += 1 / (RRF_K + rank);
      previous.bestRank = Math.min(previous.bestRank, rank);
    } else {
      combined.set(candidate.chunkId, { candidate, score: 1 / (RRF_K + rank), bestRank: rank });
    }
  }
  vectorRank.forEach((candidate, index) => add(candidate, index + 1));
  keywordRank.forEach((item, index) => add(item.candidate, index + 1));

  return [...combined.values()]
    .sort((left, right) => right.score - left.score
      || left.bestRank - right.bestRank
      || compareId(left.candidate.chunkId, right.candidate.chunkId))
    .slice(0, limit)
    .map(({ candidate }) => {
      const { distance: _distance, ...evidence } = candidate;
      return evidence;
    });
}
