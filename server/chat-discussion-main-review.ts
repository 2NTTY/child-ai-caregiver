import { z } from 'zod';
import type { ChatDeliveryDraft } from './chat-delivery-review.ts';
import { discussionTextClauses } from './chat-discussion.ts';

export const discussionMainReviewSchema = z.strictObject({
  requestChecks: z.array(z.strictObject({
    status: z.enum(['constraint_applied', 'addressed', 'background', 'missing']),
    mainQuote: z.string().max(400).describe('Verbatim words in the main answer applying this request or constraint. Empty for background or missing.'),
    constraintAnchor: z.string().trim().min(1).max(160).optional().describe('For constraint_applied only. A distinctive value or phrase from the request, repeated in mainQuote with the action it constrains.'),
  })).describe('One judgment per request clause, in order. A constraint affecting the choice is never background.'),
  clauseChecks: z.array(z.strictObject({
    basis: z.enum(['no_outcome_claim', 'open_hypothesis', 'supported_outcome', 'supported_comparison', 'unsupported']),
    sourceQuote: z.string().max(400).describe('For a supported outcome or comparison, quote exact evidence for the claim in this clause. Otherwise empty.'),
    comparison: z.strictObject({
      firstApproach: z.string().trim().min(1).max(160),
      secondApproach: z.string().trim().min(1).max(160),
      relativeOutcome: z.string().trim().min(1).max(160),
    }).optional().describe('For supported_comparison only. Quote the two different approaches and their relative result verbatim from sourceQuote.'),
  })).describe('One assessment per main clause, in order. Assess each assertion in context. A comparison requires direct comparative evidence.'),
});

export const discussionMainInstruction = '單獨閱讀主答，逐項對照家長原題。requestClauses 中影響選擇的時間、資源、孩子狀態或其他界限，主答要讓家長看得出在該條件下可以怎做。明說的限制用 constraint_applied，從原題選可辨識該限制的短語或數值作 constraintAnchor，mainQuote 須包含該原詞及相應做法。原題的其他要求以 addressed 連到主答原文；只在某一席出現，或主答只泛稱有選擇，填 missing。純背景才填 background。按 mainClauses 原次序逐分句填 clauseChecks，以整句語境判斷該分句本身的斷言。做法與觀察條件可填 no_outcome_claim；宣稱不同方法相若、更好或更差，須有材料直接比較同一條件下的結果才可填 supported_comparison。相鄰做法的引文不能用作比較依據。欠證據填 unsupported 並要求修訂。';

export function discussionMainReviewInput(draft: ChatDeliveryDraft) {
  const speakerCount = draft.discussionRoles?.length ?? 0;
  const mainClauses = draft.paragraphs.slice(speakerCount).flatMap((p, i) =>
    discussionTextClauses(p.text).map(text => ({ paragraph: speakerCount + i, text })));
  return { requestClauses: discussionTextClauses(draft.userRequest ?? ''), mainClauses };
}

export function discussionMainIssue(original: ChatDeliveryDraft, candidate: ChatDeliveryDraft, review?: z.infer<typeof discussionMainReviewSchema>) {
  const { requestClauses, mainClauses } = discussionMainReviewInput(original);
  if (!mainClauses.length) return;
  const main = candidate.paragraphs.slice(candidate.discussionRoles!.length);
  const paragraph = mainClauses.find(c => candidate.paragraphs[c.paragraph].kind === 'caregiving')?.paragraph ?? mainClauses[0].paragraph;
  const issue = (reason: string, support: string, at = paragraph) => ({ paragraph: at, reason: reason.slice(0, 240), support });
  const guidance = '在主答明確應用影響選擇的原題條件，指出可行做法及何時轉換。教材沒有直接比較成效時，只保留玩法及選擇條件。';
  if (!review || review.requestChecks.length !== requestClauses.length || review.clauseChecks.length !== mainClauses.length)
    return issue('主答尚欠完整的原題條件或逐分句成效核對。', guidance);
  const missing = requestClauses.filter((request, i) => {
    const { status, mainQuote, constraintAnchor } = review.requestChecks[i];
    if (status === 'background') return mainQuote !== '' || constraintAnchor !== undefined;
    if (status === 'constraint_applied' && (!constraintAnchor || !/[\p{L}\p{N}]/u.test(constraintAnchor)
      || !request.includes(constraintAnchor) || !mainQuote.includes(constraintAnchor))) return true;
    return status === 'missing' || !/[\p{L}\p{N}]/u.test(mainQuote) || !main.some(p => p.text.includes(mainQuote));
  });
  if (requestClauses.length && !review.requestChecks.some(check => check.status === 'addressed' || check.status === 'constraint_applied') && !missing.length)
    return issue('主答沒有核實任何一項原題要求。', guidance);
  const gaps: string[] = missing.map(text => '主答未回應「' + text + '」');
  let firstOutcomeParagraph: number | undefined;
  let offset = 0;
  for (const [i, clause] of mainClauses.entries()) {
    const check = review.clauseChecks[i], p = candidate.paragraphs[clause.paragraph];
    if (mainClauses[i - 1]?.paragraph !== clause.paragraph) offset = 0;
    const start = offset;
    offset += clause.text.length;
    // Selections are verbatim. Only clauses overlapping the retained sentence can affect delivery.
    const retained = original.paragraphs[clause.paragraph].text.indexOf(p.text);
    if (offset <= retained || start >= retained + p.text.length) continue;
    const supported = check.basis === 'supported_outcome' || check.basis === 'supported_comparison';
    const pair = check.comparison;
    const comparisonBound = check.basis === 'supported_comparison' ? !!pair
      && !pair.firstApproach.includes(pair.secondApproach) && !pair.secondApproach.includes(pair.firstApproach)
      && Object.values(pair).every(part => check.sourceQuote.includes(part))
      && ![pair.firstApproach, pair.secondApproach].includes(pair.relativeOutcome) : pair === undefined;
    if (!comparisonBound || check.basis === 'unsupported' || (supported ? !check.sourceQuote.trim() || !candidate.sources.some(s =>
      p.citationIds.includes(s.citationId) && s.excerpt.includes(check.sourceQuote)) : check.sourceQuote !== '')) {
      gaps.push('成效欠直接依據「' + clause.text + '」');
      firstOutcomeParagraph ??= clause.paragraph;
    }
  }
  if (gaps.length) return issue(gaps.join('；'), guidance, firstOutcomeParagraph);
}
