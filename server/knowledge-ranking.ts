import type { KnowledgeCandidate, KnowledgeEvidence } from "../src/shared/knowledge.ts";

const RRF_K = 60;
const MAX_RESULTS = 6;
const QUESTION_PHRASES = /請問|想知道|想知|點樣|點算|點解|有冇|有無|係咪|是否|如何|怎樣|甚麼|什麼|乜嘢|可唔可以|可以|應該/gu;
const QUESTION_PARTICLES = /[嗎呢呀啊嘛啦吧㗎嘅]/gu;
const LATIN_FILLERS = new Set(["a", "an", "the", "is", "are", "what", "how", "can", "should", "please"]);

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tokens(text: string, question = false): Set<string> {
  let normalized = text.normalize("NFKC").toLowerCase();
  if (question) normalized = normalized.replace(QUESTION_PHRASES, " ").replace(QUESTION_PARTICLES, "");
  const result = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const word = match[0];
    if (/^[a-z0-9]+$/u.test(word)) {
      if (word.length > 1 && !LATIN_FILLERS.has(word)) result.add(word);
      continue;
    }
    for (let index = 0; index + 1 < word.length; index++) result.add(word.slice(index, index + 2));
  }
  return result;
}

function matches(query: ReadonlySet<string>, text: string): number {
  const field = tokens(text);
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

  const queryTokens = tokens(query, true);
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
