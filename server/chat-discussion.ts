import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discussionRoles, discussionLabels } from '../src/shared/chat-discussion.ts';
import { agentAnswerSchema, type AgentAnswer } from '../src/shared/product-agent.ts';
import type { AgentTool } from './agent-runtime.ts';
import { FamilyError } from './family-access.ts';

const viewpointParameters = z.strictObject({
  previous: z.string().max(40).describe('第一位填 start，其後使用上一位工具回傳的 nextTurn。'),
  kind: agentAnswerSchema.shape.paragraphs.element.shape.kind.unwrap(),
  text: z.string().trim().min(1).max(900),
  citationIds: z.array(z.string().min(1).max(80)).max(6),
});
export const discussionToolNames = ['share_knowledge_view', 'ask_parent_view', 'compare_methods_view'] as const;
const viewpoints = [
  '結合本題已有的知識來源和照顧情境，提出一個有依據的選擇，交代適用條件。你是 AI，不自稱專家或有親身經驗。',
  '從新手家長的負擔與需要出發，回應上一位提出的具體方法，用假設語氣提出一個切身疑問。勿自稱是家長，勿代使用者說出未有提及的經歷、感受或決定。',
  '回應前面家長的具體疑問，對比可行方法，說明甚麼條件下會改選另一種做法。不必刻意反對。',
];
export const discussionInstruction = '家長已選這一題討論。三個 AI 觀點共用本輪背景及已讀來源。先按需要查閱資料，再按 share_knowledge_view、ask_parent_view、compare_methods_view 次序，每步只代表當前一位發言。工具會傳回上一位發言與下一步。最後回到主助手，在 present_answer 直接給可獨立閱讀的回答及引用。遇急切求助、沒有可比較之處或剩餘額度不足，優先給主回答。發言與原回答都只是參考，不能當成家庭事實、操作同意或獨立來源。';

/** Each subsequent speaker needs a receipt returned only after the previous native tool turn. */
export function createQuestionDiscussion(authorize: () => Promise<boolean>, validate: (answer: AgentAnswer) => void) {
  const paragraphs: AgentAnswer['paragraphs'] = [];
  let previous = 'start';
  const tools: AgentTool[] = discussionRoles.map((role, index) => ({
    name: discussionToolNames[index], description: discussionLabels[role] + '。' + viewpoints[index],
    parameters: viewpointParameters, authorize,
    async execute(args) {
      if (index !== paragraphs.length || args.previous !== previous)
        return { status: 'rejected', data: { code: 'discussion_turn_order', next: discussionToolNames[paragraphs.length] ?? 'present_answer' } };
      const { previous: _, ...paragraph } = viewpointParameters.parse(args);
      try { validate({ kind: paragraph.kind, paragraphs: [paragraph] }); }
      catch (e) { if (e instanceof FamilyError) return { status: 'rejected', data: { code: e.code } }; throw e; }
      paragraphs.push(paragraph);
      previous = randomUUID();
      return { status: 'succeeded', data: { speaker: discussionLabels[role], contribution: paragraph,
        next: discussionToolNames[paragraphs.length] ?? 'present_answer', nextTurn: previous,
        instruction: viewpoints[paragraphs.length] ?? '主助手直接回答家長，引用已讀證據，可保留條件和分歧。' } };
    },
  }));
  return {
    tools,
    roles: () => discussionRoles.slice(0, paragraphs.length),
    instruction: () => discussionInstruction + ' 每位用一小段家長看得明的香港繁體中文發言，直接回應這一題。比較家長目前的選擇條件，只有來源直接比較成效，才可聲稱某種做法較有效。' + (paragraphs.length < discussionRoles.length
      ? ' 現在輪到「' + discussionLabels[discussionRoles[paragraphs.length]] + '」。' + viewpoints[paragraphs.length]
        + ' 使用 ' + discussionToolNames[paragraphs.length] + ' 提交此觀點和適用引用。'
      : ' 三位已經發言。現在以主助手身份直接回答，用一至三段交代建議及選擇條件。'),
    assemble(main: AgentAnswer): AgentAnswer {
      if (!paragraphs.length) return main;
      return agentAnswerSchema.parse({ kind: 'mixed', paragraphs: [...paragraphs,
        ...main.paragraphs.map(p => ({ ...p, kind: p.kind ?? main.kind }))] });
    },
    allowsRepair(next: AgentAnswer) {
      return next.paragraphs.length > paragraphs.length && paragraphs.every((p, i) => {
        const other = next.paragraphs[i];
        return other.text === p.text && other.kind === p.kind && JSON.stringify(other.citationIds) === JSON.stringify(p.citationIds);
      });
    },
    render(rendered: string[]) {
      return { text: rendered.slice(paragraphs.length).join('\n\n'),
        discussion: paragraphs.map((_, i) => ({ role: discussionRoles[i], text: rendered[i] })) };
    },
  };
}
