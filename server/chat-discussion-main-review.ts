import { z } from 'zod';
import type { ChatDeliveryDraft } from './chat-delivery-review.ts';
import { discussionTextClauses } from './chat-discussion.ts';

const position = z.int().nonnegative();
const semanticSupport = z.strictObject({
  sourceId: position.describe('Segment stating the result. For comparisons select relativeResult; otherwise select first. An adjacent activity is not a result.'),
  match: z.enum(['same_result_and_conditions', 'both_methods_and_relative_result', 'related_only', 'different_or_unclear']),
  methods: z.strictObject({ first: position, second: position }).optional()
    .describe('For a comparison, map the two candidate methods to their source segments in the same order as the source reading.'),
});
export const discussionOutcomeSchema = z.strictObject({
  basis: z.enum(['no_outcome_claim', 'open_hypothesis', 'supported_outcome', 'supported_comparison', 'unsupported']),
  support: semanticSupport.optional(),
});

export const discussionMainReviewSchema = z.strictObject({
  sourceReadings: z.array(z.strictObject({
    first: position, last: position,
    meaning: z.enum(['activity_only', 'outcome', 'direct_comparison', 'unrelated_or_unclear']),
    comparison: z.strictObject({ firstMethod: position, secondMethod: position, relativeResult: position }).optional(),
  })).describe('Read each used passage on its own. Select a continuous range from one excerpt. For a direct comparison locate both different methods and their relative outcome within that range; IDs may coincide if one clause explicitly states several parts.'),
  requestChecks: z.array(z.strictObject({
    requestId: position, status: z.enum(['constraint_applied', 'addressed', 'background', 'missing']),
    mainId: position.optional(), actionId: position.optional(),
  })).describe('For each request ID select the retained main clause answering it. For a governing constraint also select the practical action applying it. Equivalent wording is valid.'),
  clauseChecks: z.array(discussionOutcomeSchema.extend({
    mainId: position,
    requestLinks: z.array(z.strictObject({ requestId: position,
      role: z.enum(['answers', 'states_condition', 'adapts_action', 'condition_and_action']) })).optional(),
  })).describe('Read each main clause in context. Identify which requests it actually answers, which material conditions it expresses and which actions it adapts. Assess its own outcome claims. Return each mainId once.'),
});

type MainReview = z.infer<typeof discussionMainReviewSchema>;
type Outcome = z.infer<typeof discussionOutcomeSchema>;
export const discussionMainInstruction = '按本次 draftHash 內的編號選取原文位置。先單獨閱讀來源，在 sourceReadings 記下每個用到的連續段落實際說明的是活動、某項結果，還是明確比較兩個不同做法及相對結果。以 first、last 圈出完整語意及限制。比較的三個位置指向做法一、做法二、相對結果；若同一分句已說齊，可選相同位置。逐項把原題與家長實際會讀到的主答連起來。影響取捨的條件用 constraint_applied，mainId 指保留該條件的位置，actionId 指怎樣在該條件下行動；判斷意思、數量及單位是否相符，接受同義改寫。未有應用條件或只在某一席提過時填 missing，純背景可填 background。逐分句評估主答，並逐段核對各席的斷言。直接支持的結果須就對象、做法、條件及結果方向一致；比較還須同一來源直接支持兩個相同做法及相對結果。僅提到活動、相鄰原句談另一個效果、語意不明或刪去了否定、前提、疑問時要求修訂。選擇的 ID 均屬當前成品與來源，不能從舊稿借用。';

const sentences = new Intl.Segmenter('zh-HK', { granularity: 'sentence' });
export function discussionSentenceOptions(draft: ChatDeliveryDraft) {
  const options: { id: number; paragraph: number; text: string; start: number }[] = [];
  for (const [paragraph, entry] of draft.paragraphs.entries()) {
    for (const { segment, index } of sentences.segment(entry.text)) {
      const text = segment.trim();
      if (text !== entry.text.trim() && /[。！？.!?][」』”’）)]*$/u.test(text) && /[\p{L}\p{N}]/u.test(text))
        options.push({ id: options.length, paragraph, text, start: index + segment.indexOf(text) });
    }
  }
  return options;
}

function clauses(text: string) {
  return [...sentences.segment(text)].flatMap(({ segment }) => discussionTextClauses(segment));
}

export function discussionMainReviewInput(draft: ChatDeliveryDraft) {
  const speakerCount = draft.discussionRoles?.length ?? 0;
  const outcomeClauses = draft.paragraphs.map(p => clauses(p.text));
  const mainClauses = outcomeClauses.slice(speakerCount).flatMap((parts, i) =>
    parts.map((text, clauseIndex) => ({ paragraph: speakerCount + i, clauseIndex, text })))
    .map((clause, id) => ({ id, ...clause }));
  const sourceSegments = draft.sources.flatMap(s => clauses(s.excerpt).map(text => ({ citationId: s.citationId, text })))
    .map((part, id) => ({ id, ...part }));
  const requestClauses = clauses(draft.userRequest ?? '').map((text, id) => ({ id, text }));
  return { requestClauses, mainClauses, outcomeClauses, sourceSegments };
}
type ReviewInput = ReturnType<typeof discussionMainReviewInput>;
type Selection = Pick<ReturnType<typeof discussionSentenceOptions>[number], 'text' | 'start'>;

export function retainedDiscussionClauses(input: ReviewInput, paragraph: number, selected?: Selection): Set<number> {
  let offset = 0;
  const retained = new Set<number>();
  for (const [index, text] of input.outcomeClauses[paragraph].entries()) {
    const start = offset + text.length - text.trimStart().length;
    offset += text.length;
    if (!selected || (start >= selected.start && start + text.trim().length <= selected.start + selected.text.length)) retained.add(index);
  }
  return retained;
}

/** The draft hash covers the ordered source versions and complete excerpt contents used to mint these IDs. */
export function discussionEvidence(input: ReviewInput, review?: MainReview) {
  const readings = new Map<number, { citationId: string; row: MainReview['sourceReadings'][number] }>();
  const hasWords = (id: number) => /[\p{L}\p{N}]/u.test(input.sourceSegments[id]?.text ?? '');
  for (const row of review?.sourceReadings ?? []) {
    const first = input.sourceSegments[row.first], last = input.sourceSegments[row.last];
    if (!first || !last || row.last < row.first || first.citationId !== last.citationId) return;
    const scope = input.sourceSegments.slice(row.first, row.last + 1);
    if (scope.some(part => part.citationId !== first.citationId)) return;
    if (row.meaning === 'direct_comparison') {
      if (!row.comparison || !Object.values(row.comparison).every(id => id >= row.first && id <= row.last && hasWords(id))) return;
    } else if (row.comparison) return;
    const resultId = row.comparison?.relativeResult ?? row.first;
    if (readings.has(resultId) || !hasWords(resultId)) return;
    readings.set(resultId, { citationId: first.citationId, row });
  }
  return readings;
}

export function discussionOutcomeSupported(check: Outcome, citationIds: readonly string[], readings: NonNullable<ReturnType<typeof discussionEvidence>>) {
  if (check.basis !== 'supported_comparison' && check.basis !== 'supported_outcome') return !check.support;
  const passage = check.support && readings.get(check.support.sourceId);
  if (!passage || !citationIds.includes(passage.citationId)) return false;
  const support = check.support!;
  if (check.basis === 'supported_comparison') {
    const comparison = passage.row.comparison;
    return passage.row.meaning === 'direct_comparison' && support.match === 'both_methods_and_relative_result'
      && !!comparison && support.methods?.first === comparison.firstMethod && support.methods.second === comparison.secondMethod;
  }
  return !support.methods && (passage.row.meaning === 'outcome' || passage.row.meaning === 'direct_comparison')
    && support.match === 'same_result_and_conditions';
}

export function discussionMainIssue(input: ReviewInput, candidate: ChatDeliveryDraft, review?: MainReview,
  selected = new Map<number, Selection>(), paragraphChecks?: (Outcome & { clauseIndex: number })[]) {
  const { requestClauses, mainClauses } = input;
  if (!mainClauses.length) return;
  const paragraph = mainClauses.find(c => candidate.paragraphs[c.paragraph].kind === 'caregiving')?.paragraph ?? mainClauses[0].paragraph;
  const issue = (reason: string, at = paragraph) => ({ paragraph: at, reason: reason.slice(0, 240),
    support: '在主答應用影響選擇的條件。保留可行做法及其限制，只有教材直接比較的成效才可列作比較。' });
  const exactIds = (ids: number[], count: number) => ids.length === count && new Set(ids).size === count && ids.every(id => id >= 0 && id < count);
  if (!review || !exactIds(review.requestChecks.map(c => c.requestId), requestClauses.length)
    || !exactIds(review.clauseChecks.map(c => c.mainId), mainClauses.length)) return issue('主答尚欠完整的原題或分句核對。');
  const readings = discussionEvidence(input, review);
  if (!readings) return issue('來源位置未能連到同一處完整的原文。');
  const retainedByParagraph = input.outcomeClauses.map((_, i) => retainedDiscussionClauses(input, i, selected.get(i)));
  const retained = new Set(mainClauses.filter(c => retainedByParagraph[c.paragraph].has(c.clauseIndex)).map(c => c.id));
  const assessments = new Map(review.clauseChecks.map(c => [c.mainId, c]));
  if (review.clauseChecks.some(c => c.requestLinks?.some(link => !requestClauses[link.requestId]))) return issue('主答的位置指向不存在的原題要求。');
  const materialRequests = new Set(review.clauseChecks.filter(c => retained.has(c.mainId)).flatMap(c =>
    (c.requestLinks ?? []).filter(link => link.role !== 'answers').map(link => link.requestId)));
  const linked = (id: number | undefined, requestId: number, role: 'answers' | 'states_condition' | 'adapts_action') =>
    id !== undefined && retained.has(id) && assessments.get(id)?.requestLinks?.some(link =>
      link.requestId === requestId && (link.role === role || role !== 'answers' && link.role === 'condition_and_action'));
  for (const { requestId, status, mainId, actionId } of review.requestChecks) {
    if (materialRequests.has(requestId) && status !== 'constraint_applied')
      return issue('主答未核實這項限制及相應做法「' + requestClauses[requestId].text + '」');
    if (status === 'background' && mainId === undefined && actionId === undefined) continue;
    if (status === 'addressed' && actionId === undefined && linked(mainId, requestId, 'answers')) continue;
    if (status === 'constraint_applied' && linked(mainId, requestId, 'states_condition') && linked(actionId, requestId, 'adapts_action')) continue;
    return issue('主答未回應「' + requestClauses[requestId].text + '」');
  }
  if (requestClauses.length && review.requestChecks.every(c => c.status === 'background')) return issue('主答沒有核實任何一項原題要求。');
  for (const check of review.clauseChecks) {
    const clause = mainClauses[check.mainId];
    if (!retained.has(clause.id)) continue;
    if (check.basis === 'unsupported' || !discussionOutcomeSupported(check, candidate.paragraphs[clause.paragraph].citationIds, readings))
      return issue('成效欠直接依據「' + clause.text + '」', clause.paragraph);
    const aggregate = paragraphChecks?.[clause.paragraph];
    if (aggregate && (aggregate.basis === 'no_outcome_claim' || aggregate.clauseIndex === clause.clauseIndex) && aggregate.basis !== check.basis)
      return issue('逐段與逐分句對這項成效的判斷不一致「' + clause.text + '」', clause.paragraph);
  }
}
