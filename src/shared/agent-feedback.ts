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
export const ALL_OFFICIAL_HELP_IDS: readonly OfficialHelpId[] = ['emergency-hk-v1', 'medical-consult-hk-v1'];
export const OFFICIAL_HELP_ENTRY_COPY = {
  buttonLabel: '官方求助入口',
  highlightedButtonLabel: '緊急／醫療官方求助入口',
  accessibilityLabel: '查看香港緊急求助、急症室、母嬰健康院及安全用藥官方入口（毋須等待 AI 回覆）',
  urgentNotice: '偵測到可能涉及緊急症狀或用藥諮詢；毋須等待 AI 搜尋或審核，請優先參考以下官方求助及醫療諮詢入口。',
} as const;

const URGENT_EMERGENCY_HELP_PATTERN = /(?:(?<!\d)999(?!\d)|急症|急救|抽搐|抽筋|痙攣|呼吸困難|抖唔到氣|透唔到氣|氣促|嘴唇發紫|面色發紫|意識改變|意識不清|昏迷|叫唔醒|嗜睡|嚴重脫水|高燒不退|大出血|誤服|中毒|窒息|哽塞|休克|convulsions?|seizures?|difficulty\s+breathing|unconscious|unresponsive|choking|emergency)/iu;
const MEDICAL_CONSULT_HELP_PATTERN = /(?:退燒藥|藥水|藥物|食藥|餵藥|服藥|劑量|毫克|幾多\s*(?:ml|mg|毫升|毫克)\b|抗生素|撲熱息痛|布洛芬|阿士匹靈|處方|開藥|改動醫囑|母嬰健康院|睇醫生|求醫|診斷|dosage|medication|paracetamol|ibuprofen|aspirin|antibiotics?)/iu;

/**
 * Deterministic client/server matcher for surfacing official help cards without
 * waiting on the main Agent to call show_official_help (REQ-001 §4.3, design proposal).
 */
export function matchOfficialHelpForText(text: string | null | undefined): OfficialHelpId[] {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];
  const matched: OfficialHelpId[] = [];
  if (URGENT_EMERGENCY_HELP_PATTERN.test(trimmed)) matched.push('emergency-hk-v1');
  if (MEDICAL_CONSULT_HELP_PATTERN.test(trimmed)) matched.push('medical-consult-hk-v1');
  return matched;
}
export function officialHelpFromTools(tools: readonly { name: string; status: string; reference?: string }[]): OfficialHelpId[] {
  return [...new Set(tools.filter(tool => tool.name === 'show_official_help' && tool.status === 'succeeded')
    .flatMap(tool => { const id = officialHelpIdSchema.safeParse(tool.reference); return id.success ? [id.data] : []; }))];
}
