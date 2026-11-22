import { z } from 'zod';
import type { FunctionDeclaration } from '@google/genai';
import { discussionRoles, discussionLabels } from '../src/shared/chat-discussion.ts';
import { agentAnswerSchema, MAX_ANSWER_PARAGRAPHS, type AgentAnswer } from '../src/shared/product-agent.ts';
import type { AgentTool } from './agent-runtime.ts';
import { FamilyError } from './family-access.ts';

export const viewpointParameters = z.strictObject({
  kind: agentAnswerSchema.shape.paragraphs.element.shape.kind.describe('Optional. Omit for the ordinary speaker role. If specified, use exactly one enum value.'),
  text: z.string().trim().min(1).max(900).describe('Only this speaker’s one or two sentences. The independent main answer goes in present_answer.paragraphs.'),
  citationIds: z.array(z.string().min(1).max(80)).max(6).describe('Use the official passage chunkId for caregiving. A selected task has its own private_reference paragraph. Copy the corresponding presentation.citationIds from the current evidence.'),
});
export const discussionToolNames = ['share_knowledge_view', 'ask_parent_view', 'compare_methods_view'] as const;
const clauseIndex = z.int().nonnegative();
export const discussionRepairSchema = z.strictObject({
  excerpts: z.array(z.strictObject({
    speakerIndex: z.int().min(0).max(2),
    firstClause: clauseIndex,
    lastClause: clauseIndex,
  })).max(3),
  main: agentAnswerSchema,
});

export function discussionTextClauses(text: string) {
  return text.split(/(?<=[，,。.!！?？；;：:\n])/u).filter(Boolean);
}

export function discussionRepairClauses(paragraphs: ReadonlyArray<{ text: string }>, flagged: readonly number[]) {
  return flagged.map(speakerIndex => ({
    speakerIndex,
    clauses: discussionTextClauses(paragraphs[speakerIndex]!.text),
  }));
}

export function assembleDiscussionRepair<T extends { text: string }>(
  originalSpeakers: readonly T[], choices: ReturnType<typeof discussionRepairClauses>, wire: unknown,
) {
  const result = discussionRepairSchema.safeParse(wire);
  if (!result.success) return null;
  const speakers = originalSpeakers.map(speaker => ({ ...speaker }));
  const remaining = new Map(choices.map(choice => [choice.speakerIndex, choice.clauses]));
  for (const { speakerIndex, firstClause, lastClause } of result.data.excerpts) {
    const clauses = remaining.get(speakerIndex);
    if (!clauses || !speakers[speakerIndex] || firstClause > lastClause || lastClause >= clauses.length) return null;
    const excerpt = clauses.slice(firstClause, lastClause + 1).join('').trim().replace(/[，,；;：:]$/u, '。');
    if (!isContributionExcerpt(speakers[speakerIndex].text, excerpt)) return null;
    speakers[speakerIndex] = { ...speakers[speakerIndex], text: excerpt };
    remaining.delete(speakerIndex);
  }
  const main = result.data.main;
  const mainParagraphs = main.paragraphs.map(paragraph => ({ ...paragraph, kind: paragraph.kind ?? main.kind }));
  return { kind: 'mixed', paragraphs: [...speakers, ...mainParagraphs] };
}

export type DiscussionPresentationStage = 'speaker' | 'closing';
export function closingDiscussionDeclaration(declaration: FunctionDeclaration, includeSpeaker: boolean, sourcePair = false): FunctionDeclaration {
  const fields = declaration.parameters?.properties;
  if (declaration.name !== 'present_answer' || !fields?.closingView) return declaration;
  if (sourcePair && fields.selectedItemText && fields.officialAdviceText) {
    return { ...declaration, description:'Finish the main answer in two plain text fields. State only the facts in the selected item and give practical advice supported by the supplied official passage.',
      parameters:{...declaration.parameters, properties:{selectedItemText:fields.selectedItemText,officialAdviceText:fields.officialAdviceText},
        required:['selectedItemText','officialAdviceText']} };
  }
  const paragraphs = fields.paragraphs;
  const { closingView, selectedItemText, officialAdviceText, ...mainFields } = fields;
  // Text paragraphs in a mixed main answer need individual kinds. Verbatim history quotes keep their own shape.
  const forms = paragraphs?.items?.anyOf?.map(form => form.properties?.kind
    ? { ...form, required: [...new Set([...(form.required ?? []), 'kind'])] } : form);
  return { ...declaration, parameters: { ...declaration.parameters,
    required: ['kind','paragraphs', ...(includeSpeaker ? ['closingView'] : [])],
    properties: { ...mainFields, ...(includeSpeaker && {closingView}),
      ...(forms && { paragraphs: { ...paragraphs, items: { ...paragraphs.items, anyOf: forms } } }) },
  } };
}
const speakerParameters = viewpointParameters.extend({
  endDiscussion: z.literal('no_tradeoff').optional().describe('Only when there is genuinely no choice to compare. Explain why in your contribution. Omit for ordinary trade-offs.'),
});
const draftRejectionCodes = ['invalid_parameters', 'invalid_input', 'discussion_turn_order', 'discussion_main_too_long',
  'citation_required', 'invalid_citation', 'citation_limit', 'original_quote_mismatch', 'attached_claim_needs_evidence', 'use_citation_ids'] as const;
export function isDiscussionDraftRejection(tool: string, code: unknown): code is typeof draftRejectionCodes[number] {
  return (tool === 'present_answer' || discussionToolNames.some(name => name === tool))
    && draftRejectionCodes.some(value => value === code);
}
export class DiscussionMainTooLong extends FamilyError {
  readonly maxParagraphs: number;
  constructor(maxParagraphs: number) {
    super(400, 'discussion_main_too_long');
    this.maxParagraphs = maxParagraphs;
  }
}
const viewpoints = [
  '從已讀教材揀一個具體做法，用「我會……」的一句說清楚你會在甚麼情況試，讓下一席可以回應。沿用 reusedOfficialEvidence 的 presentation 引用該教材。教材只列舉做法時，發言可以在做法說完時結束，毋須另推斷孩子的狀態或保證成效。主答會交代 selectedItem 的家庭事實。你是 AI，不自稱有親身經驗。',
  '站在新手家長的位置，接住上一席的具體做法，直接用一句完整的問句提出實行時會遇到的選擇。可以問「如果……我該怎樣選？」保留假設語氣，把家長的感受和做法的成效分開。你是 AI，不虛構經驗或替家長認定感受。',
  '直接回答上一席的疑問。用一句「我會先……；如果見到……，我就……」交代你的選擇及改選條件。在選擇說清楚時結束發言，讓主助手說明教材。你是 AI，不冒稱有親身育兒經驗。',
];
export const discussionInstruction = '家長已選這一題討論。三個 AI 觀點共用本輪背景及已讀來源。先用本輪已有的有效片段，只為實際缺少的依據補讀。每席按當前工具直接回應上一席。主助手另用 paragraphs 提交可獨立閱讀的主回答及引用。若本輪要求合併收尾，在 closingView 放當前角色的原話。遇急切求助或沒有可比較之處，優先給主回答。發言與原回答不能當成家庭事實、操作同意或獨立來源。';

// Keep whole clauses from one speaker. The subsequent review also receives the original wording and issues.
function isContributionExcerpt(original: string, replacement: string): boolean {
  const excerpt = replacement.replace(/。$/u, '');
  if (!/[\p{L}\p{N}]/u.test(excerpt)) return false;
  const boundary = /[，,。.!！?？；;：:\n]/u;
  for (let at = original.indexOf(excerpt); at >= 0; at = original.indexOf(excerpt, at + 1)) {
    const end = at + excerpt.length;
    if (original[end] === '？' || original[end] === '?') continue;
    if ((at === 0 || boundary.test(original[at - 1]!)) &&
        (end === original.length || boundary.test(original[end]!) || boundary.test(excerpt.at(-1)!))) return true;
  }
  return false;
}

/** A native generator request admits only the speaker whose predecessor has already spoken. */
export function createQuestionDiscussion(authorize: () => Promise<boolean>, validate: (answer: AgentAnswer) => void) {
  const paragraphs: AgentAnswer['paragraphs'] = [];
  const maxMainParagraphs = () => MAX_ANSWER_PARAGRAPHS - paragraphs.length;
  let speakerAtRequestStart = -1;
  let presentationStage: DiscussionPresentationStage | undefined;
  let noTradeoff = false;
  function readView(view: z.infer<typeof viewpointParameters>) {
    return { ...view, kind: view.kind ?? (paragraphs.length === 1 ? 'clarification' : 'caregiving') };
  }
  const tools: AgentTool[] = discussionRoles.map((role, index) => ({
    name: discussionToolNames[index], description: discussionLabels[role] + '。' + viewpoints[index],
    parameters: speakerParameters, authorize,
    parameterErrorHints: () => [{ path: 'viewpoint', reason: 'invalid_parameters', expected: 'Use text and citationIds (an array). Omit kind for the ordinary role. Write one short paragraph.' }],
    async execute(args) {
      if (index !== paragraphs.length || index !== speakerAtRequestStart)
        return { status: 'rejected', data: { code: 'discussion_turn_order', next: discussionToolNames[paragraphs.length] ?? 'present_answer' } };
      const { endDiscussion, ...view } = speakerParameters.parse(args);
      const paragraph = readView(view);
      validate({ kind: paragraph.kind, paragraphs: [paragraph] });
      paragraphs.push(paragraph);
      noTradeoff ||= endDiscussion === 'no_tradeoff';
      return { status: 'succeeded', data: { speaker: discussionLabels[role], contribution: paragraph,
        ...(!noTradeoff && paragraphs.length === 2 ? {} : { next: noTradeoff ? 'present_answer' : discussionToolNames[paragraphs.length] ?? 'present_answer' }),
        maxMainParagraphs: maxMainParagraphs() - (paragraphs.length === 2 ? 1 : 0),
        instruction: noTradeoff ? '已說明這題只有單一做法。用 paragraphs 提交主回答。'
          : paragraphs.length === 2 ? viewpoints[2] + ' 按下一輪開放的工具提交這席發言。'
          : viewpoints[paragraphs.length] ?? '主助手直接回答家長，引用已讀證據，可保留條件和分歧。' } };
    },
  }));
  return {
    tools,
    beginNativeTurn(stage?: DiscussionPresentationStage) { speakerAtRequestStart = paragraphs.length; presentationStage = stage; },
    noTradeoff: () => noTradeoff,
    checkPresentation(hasClosing: boolean) {
      if (presentationStage === 'speaker' || presentationStage === 'closing' && !hasClosing)
        throw new FamilyError(400, 'discussion_turn_order');
    },
    nextTool: () => discussionToolNames[paragraphs.length],
    remainingSpeakers: () => discussionRoles.length - paragraphs.length,
    // The opening contribution can stand on its own if the final presentation is rejected.
    // Its original paragraph and citations still go through the independent delivery review.
    openingAnswer(): AgentAnswer | undefined {
      const opening = paragraphs[0];
      return opening?.kind && { kind: opening.kind, paragraphs: [opening] };
    },
    roles: () => discussionRoles.slice(0, paragraphs.length),
    instruction: (finishing: boolean) => noTradeoff ? '已交付的觀點指出這一題沒有可比較的選擇。現在用 present_answer 的 paragraphs 直接回答，不再加角色。' : discussionInstruction + ' 每位只講一兩句，直接回應上一位。用香港繁體中文，只有來源直接比較成效，才可聲稱某種做法較有效。' + (paragraphs.length < discussionRoles.length
      ? ' 現在輪到「' + discussionLabels[discussionRoles[paragraphs.length]] + '」。' + viewpoints[paragraphs.length]
        + (finishing
          ? ' 現在單獨使用 present_answer。closingView 只填當前角色的觀點及引用。paragraphs 另寫可獨立閱讀的主回答，逐項回答家長原題。所選項目的事實及官方教材的建議各自成段，填相應 kind 和 citationIds。'
          : ' 使用 ' + discussionToolNames[paragraphs.length] + ' 提交此觀點和適用引用。')
      : ' 三位已經發言。現在只填 present_answer 的主回答 paragraphs，逐項回答家長原題。待辦事實和官方建議各自成段，分別引用 selectedItem 和官方片段。主回答最多 ' + maxMainParagraphs() + ' 段。')
      + ' 先前的發言已保留，毋須重複。',
    closingParagraph(view: z.infer<typeof viewpointParameters>) {
      if (paragraphs.length >= discussionRoles.length || paragraphs.length !== speakerAtRequestStart) throw new FamilyError(400, 'discussion_turn_order');
      return readView(view);
    },
    acceptClosing(paragraph: AgentAnswer['paragraphs'][number]) { paragraphs.push(paragraph); },
    assemble(main: AgentAnswer, closing?: AgentAnswer['paragraphs'][number]): AgentAnswer {
      const speakers = closing ? [...paragraphs, closing] : paragraphs;
      if (!speakers.length) return main;
      if (main.paragraphs.length > MAX_ANSWER_PARAGRAPHS - speakers.length) throw new DiscussionMainTooLong(MAX_ANSWER_PARAGRAPHS - speakers.length);
      return agentAnswerSchema.parse({ kind: 'mixed', paragraphs: [...speakers,
        ...main.paragraphs.map(p => ({ ...p, kind: p.kind ?? main.kind }))] });
    },
    allowsRepair(next: AgentAnswer, flaggedParagraphs?: ReadonlySet<number>) {
      return next.paragraphs.length > paragraphs.length && paragraphs.every((p, i) => {
        const other = next.paragraphs[i];
        return other.kind === p.kind && JSON.stringify(other.citationIds) === JSON.stringify(p.citationIds)
          && (other.text === p.text || (flaggedParagraphs?.has(i) && isContributionExcerpt(p.text, other.text)));
      });
    },
    render(rendered: string[]) {
      return { text: rendered.slice(paragraphs.length).join('\n\n'),
        discussion: paragraphs.map((_, i) => ({ role: discussionRoles[i], text: rendered[i] })) };
    },
  };
}
