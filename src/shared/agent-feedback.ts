import { z } from 'zod';
import { EMERGENCY_HELP } from './emergency-help.ts';

export const officialHelpIdSchema = z.enum(['emergency-hk-v1', 'medical-consult-hk-v1']);
export type OfficialHelpId = z.infer<typeof officialHelpIdSchema>;
/** Immutable published cards. A change in meaning requires a new ID. */
export const OFFICIAL_HELP = {
  'emergency-hk-v1': { title: '緊急求助', ...EMERGENCY_HELP },
  'medical-consult-hk-v1': { title: '醫療與用藥諮詢', checkedOn: '2026-10-15',
    text: '診斷及用藥判斷須由醫護專業人員處理。對用藥有疑問，請先向醫生或藥劑師查詢，不要自行改動醫囑。Agent 可以繼續協助整理觀察及到診問題。',
    sources: [{ title: '衞生署藥物辦公室：安全用藥', url: 'https://www.drugoffice.gov.hk/eps/do/tc/consumer/news_informations/knowledge_on_medicines/handling_medicines_safety.html' }] },
} as const;
export const agentProgressSchema = z.object({ runId: z.uuid(), messageId: z.uuid(),
  phase: z.enum(['started', 'model', 'reading', 'searching', 'working', 'tool_finished', 'reviewing', 'help']),
  card: officialHelpIdSchema.optional(),
}).strict().refine(event => (event.phase === 'help') === (event.card !== undefined));
export type AgentProgress = z.infer<typeof agentProgressSchema>;
export const AGENT_PROGRESS_LABELS: Record<AgentProgress['phase'], string> = {
  started: '已開始處理', model: '正在整理下一步', reading: '正在讀取相關資料', searching: '正在查詢來源',
  working: '正在處理事項', tool_finished: '工具已返回結果，正在核對', reviewing: '正在獨立核對回覆', help: '請先查看官方提示；對話可繼續',
};
export function officialHelpFromTools(tools: readonly { name: string; status: string; reference?: string }[]): OfficialHelpId[] {
  return [...new Set(tools.filter(tool => tool.name === 'show_official_help' && tool.status === 'succeeded')
    .flatMap(tool => { const id = officialHelpIdSchema.safeParse(tool.reference); return id.success ? [id.data] : []; }))];
}
