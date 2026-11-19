import type { KnowledgeCandidate, KnowledgeEvidence } from "../src/shared/knowledge.ts";

const RRF_K = 60;
const MAX_RESULTS = 6;
const QUESTION_PHRASES = /請問|想知道|想知|點樣|點算|點解|有冇|有無|係咪|是否|如何|怎樣|甚麼|什麼|乜嘢|可唔可以|可以|應該|(?<!頭|這|呢|近|首|前|上|下)幾多?個月大?|幾時|邊度|洗唔洗|使唔使|要唔要|會唔會|好唔好/gu;
const QUESTION_PARTICLES = /[嗎呢呀啊嘛啦吧㗎嘅]/gu;
const LATIN_FILLERS = new Set(["a", "an", "the", "is", "are", "what", "how", "can", "should", "please"]);
/** Generic caregiver subject terms and generic colloquial verbs ignored on question queries so unrelated topics never false-match via a shared seed keyword (e.g. "BB食嘢"). */
const QUESTION_LATIN_FILLERS = new Set(["bb", "baby", "babies"]);
const QUESTION_HAN_FILLERS = new Set(["食嘢", "講嘢", "正常", "醫生", "睇醫", "要睇", "求醫", "求診"]);
/** Age modifiers are applicability filter criteria, never standalone topic evidence on question queries. */
const QUESTION_AGE_MODIFIERS = /(?:半歲|歲半|足月|滿月|[\d一二三四五六七八九十百兩]+(?:\s*(?:個?月(?:大|以下|以上|未滿)?|歲(?:半|大|以下|以上)?|週大?|周大?|天大?))|\b\d+(?:\s*-\s*|\s+)(?:months?|mos?|yrs?|years?|weeks?|wks?|days?)(?:\s+old)?\b)/giu;
/** Colloquial Cantonese parenting query terms mapped to official guidance bigrams on question queries only. */
const COLLOQUIAL_QUERY_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  // Positive-intent anchor: only a bare "when can baby start solids" question may borrow starting-solids guidance.
  // Any extra clause (illness, refusal, medication, other symptoms) breaks the anchor, so correctness never depends on a symptom dictionary.
  [/開糊|糊仔|副食品?|輔食|^\s*(?:請問\s*[，,]?\s*)?(?:(?:半歲|歲半|[\d一二三四五六七八九十]+\s*(?:個月|歲))大?\s*)?(?:BB|寶寶|嬰兒|幼兒|孩子|小朋友|佢)?\s*(?:幾時|幾大|幾多?個月(?:大)?)[\s,]*(?:BB|寶寶|嬰兒|幼兒|孩子|小朋友|佢)?\s*(?:先至?|才)?(?:(?:可以|先可以|適合|適宜)\s*(?:開始)?|開始)食(?:嘢|固體食物)[呢呀啊嘅㗎嗎]*[\s？?。.!！]*$/iu, ["加固", "固體食物", "米糊"]],
  [/嘔奶|回奶|吐奶|溢奶/u, ["嘔奶", "吐奶", "溢奶"]],
  [/發熱|滾熱|發高燒|高燒/u, ["發燒"]],
  [/睇急症|去急症/u, ["急症"]],
  [/睇嘢|瞇眼|捽眼|斜視|弱視/u, ["視力", "驗眼", "眼睛"]],
  [/行路|學行|未識行/u, ["走路", "發展"]],
  [/(?:學|識|未識|唔識|幾時|開始|遲|慢|教|引導).{0,6}(?:講嘢|說話)|(?:講嘢|說話)(?:發展|遲緩|慢)/u, ["語言", "講嘢", "說話"]],
  [/肚痾|肚瀉|屙水/u, ["腹瀉"]],
  [/紅屁股|尿片疹/u, ["尿布疹"]],
  [/打針/u, ["疫苗", "接種"]],
];

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function extractTokenUnits(normalized: string, question: boolean): Set<string> {
  const result = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const word = match[0];
    if (/^[a-z0-9]+$/u.test(word)) {
      if (word.length > 1 && !LATIN_FILLERS.has(word) && (!question || !QUESTION_LATIN_FILLERS.has(word))) result.add(word);
      continue;
    }
    for (let index = 0; index + 1 < word.length; index++) {
      const bigram = word.slice(index, index + 2);
      if (!question || !QUESTION_HAN_FILLERS.has(bigram)) result.add(bigram);
    }
  }
  return result;
}

export function knowledgeIndexTokens(text: string, question = false): Set<string> {
  const rawNormalized = text.normalize("NFKC").toLowerCase();
  const normalized = question
    ? rawNormalized.replace(QUESTION_AGE_MODIFIERS, " ").replace(QUESTION_PHRASES, " ").replace(QUESTION_PARTICLES, "")
    : rawNormalized;
  const result = extractTokenUnits(normalized, question);
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

export function questionAgeTokens(text: string): Set<string> {
  const rawNormalized = text.normalize("NFKC").toLowerCase();
  const result = new Set<string>();
  for (const match of rawNormalized.matchAll(QUESTION_AGE_MODIFIERS)) {
    for (const token of extractTokenUnits(match[0], false)) result.add(token);
  }
  if (/半歲/u.test(rawNormalized)) {
    result.add("六個");
    result.add("個月");
  }
  return result;
}

export function knowledgeTokens(text: string, question = false): Set<string> {
  return new Set([...knowledgeIndexTokens(text, question)].slice(0, 64));
}

/** Locate the actual wording of a subject in either register. Incidental verbs are not alternative subjects. */
export function knowledgeTopicMatcher(query: string): (candidate: string) => string | undefined {
  const normalized = query.normalize('NFKC').toLowerCase();
  const groups = COLLOQUIAL_QUERY_EXPANSIONS.filter(([pattern, synonyms]) => pattern.test(normalized) || synonyms.some(term => normalized.includes(term)));
  return candidate => {
    const body = candidate.normalize('NFKC').toLowerCase();
    for (const [pattern, synonyms] of groups) {
      const anchor = body.match(pattern)?.[0] ?? synonyms.find(term => body.includes(term));
      if (anchor) return anchor;
    }
  };
}

function matches(query: ReadonlySet<string>, text: string): number {
  const field = knowledgeTokens(text);
  let count = 0;
  for (const token of query) if (field.has(token)) count++;
  return count;
}

/** A dated or alphanumeric lookup must match the recorded identifier in full. */
export function structuredQueryMatches(query: string, treatment: KnowledgeCandidate['treatment']) {
  if (treatment?.kind !== 'structured') return true;
  const identifiers = (text: string) => (text.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:[-/.][a-z0-9]+)*/gu) ?? [])
    .filter(word => /\d/u.test(word));
  const required = identifiers(query);
  const values = new Set(treatment.fields.flatMap(field => identifiers(field.value)));
  return required.every(word => values.has(word));
}

function keywordScore(query: ReadonlySet<string>, candidate: KnowledgeCandidate): number {
  return matches(query, candidate.title) * 4
    + matches(query, candidate.section) * 3
    + candidate.keywords.reduce((score, keyword) => score + matches(query, keyword) * 5, 0)
    + candidate.applicability.topics.reduce((score, topic) => score + matches(query, topic) * 4, 0)
    + matches(query, candidate.text)
    + (candidate.treatment?.kind === 'structured' ? candidate.treatment.fields.reduce((sum, field) => sum + matches(query, field.label) * 4 + matches(query, field.value) * 8, 0) : 0);
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
    .filter(item => item.treatment?.kind !== 'excluded' && structuredQueryMatches(query, item.treatment)).slice(0, limit).map(({ distance: _distance, rankScore: _rankScore, ...item }) => item);
  const queryTokens = knowledgeTokens(query, true);
  const ageTokens = questionAgeTokens(query);
  if (queryTokens.size === 0) return [];
  const items = [...unique.values()].filter(item => item.treatment?.kind !== 'excluded' && structuredQueryMatches(query, item.treatment));
  const vectorRank = items
    .filter(candidate => candidate.treatment?.kind !== 'structured' && candidate.distance !== null && candidate.distance <= maxDistance)
    .sort((left, right) => left.distance! - right.distance! || compareId(left.chunkId, right.chunkId));
  // Require substantive topic match (queryTokens > 0) before age-modifier tokens can boost specificity.
  const keywordRank = items
    .map(candidate => {
      const topicScore = keywordScore(queryTokens, candidate);
      const ageBoost = topicScore > 0 && ageTokens.size > 0 ? keywordScore(ageTokens, candidate) : 0;
      return { candidate, score: topicScore > 0 ? topicScore + ageBoost : 0 };
    })
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


