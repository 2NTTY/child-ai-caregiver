import { z } from 'zod';
import { EMERGENCY_HELP } from './emergency-help.ts';
import type { KnowledgeEvidence } from './knowledge.ts';

export const officialHelpIdSchema = z.enum(['emergency-hk-v1', 'medical-consult-hk-v1']);
export type OfficialHelpId = z.infer<typeof officialHelpIdSchema>;
/** Immutable published cards. A change in meaning requires a new ID. */
export const OFFICIAL_HELP = {
  'emergency-hk-v1': { title: '緊急求助', ...EMERGENCY_HELP },
  'medical-consult-hk-v1': { title: '醫療與用藥諮詢', checkedOn: '2026-10-15',
    text: '診斷及用藥判斷須由醫護專業人員處理。對用藥有疑問，請先向醫生或藥劑師查詢，不要自行改動醫囑。Agent 可以繼續協助整理觀察及到診問題。',
    sources: [{ title: '衞生署藥物辦公室：安全用藥', url: 'https://www.drugoffice.gov.hk/eps/do/tc/consumer/news_informations/knowledge_on_medicines/handling_medicines_safety.html' }] },
} as const;

export const AGENT_PROGRESS_MAX_SOURCES = 6;

export const agentProgressSourceSchema = z.object({
  chunkId: z.string().min(1).max(120),
  sourceId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  section: z.string().min(1).max(200),
  publisher: z.string().min(1).max(120),
  url: z.string().url().max(500).refine(value => /^https:\/\//iu.test(value), { message: 'Only https:// URLs are permitted' }).nullable(),
  excerpt: z.string().min(1).max(400),
  fetchedAt: z.string().min(1).max(64).nullable(),
  sourceUpdatedAt: z.string().min(1).max(64).nullable(),
  sourceDateText: z.string().min(1).max(120).nullable().optional(),
  stage: z.enum(['found', 'read']),
  applicabilityStatus: z.enum(['conditional', 'requires_clarification']).optional(),
}).strict();
export type AgentProgressSource = z.infer<typeof agentProgressSourceSchema>;

export const agentProgressSchema = z.object({ runId: z.uuid(), messageId: z.uuid(),
  phase: z.enum(['started', 'model', 'reading', 'searching', 'working', 'tool_finished', 'reviewing', 'help']),
  card: officialHelpIdSchema.optional(),
  sources: z.array(agentProgressSourceSchema).max(AGENT_PROGRESS_MAX_SOURCES).optional(),
}).strict().refine(event =>
  (event.phase === 'help') === (event.card !== undefined)
  && (event.sources === undefined || (
    event.sources.length > 0
    && (event.phase === 'searching' || event.phase === 'reading' || event.phase === 'tool_finished')
  )),
);
export type AgentProgress = z.infer<typeof agentProgressSchema>;
export const AGENT_PROGRESS_LABELS: Record<AgentProgress['phase'], string> = {
  started: '已開始處理', model: '正在整理下一步', reading: '正在讀取相關資料', searching: '正在查詢來源',
  working: '正在處理事項', tool_finished: '工具已返回結果，正在核對', reviewing: '正在獨立核對回覆', help: '請先查看官方提示；對話可繼續',
};
export const AGENT_PROGRESS_SOURCE_STAGE_LABELS: Record<AgentProgressSource['stage'], string> = {
  found: '已找到官方來源',
  read: '已讀取官方來源上下文',
};
export const AGENT_PROGRESS_SOURCE_DISCLAIMER = '以下僅為已找到／已讀取的官方來源片段，尚未完成適用性與獨立安全核對。';

export function toAgentProgressSource(
  chunk: Partial<KnowledgeEvidence> & { chunkId: string; original?: { text: string } },
  stage: AgentProgressSource['stage'],
): AgentProgressSource | null {
  if (typeof chunk.title !== 'string' || !chunk.title.trim() || typeof chunk.publisher !== 'string' || !chunk.publisher.trim()) {
    return null;
  }
  const rawExcerpt = (typeof chunk.sourceExcerpt === 'string' && chunk.sourceExcerpt.trim())
    || (typeof chunk.text === 'string' && chunk.text.trim())
    || (typeof chunk.original?.text === 'string' && chunk.original.text.trim())
    || chunk.title.trim();
  const parsed = agentProgressSourceSchema.safeParse({
    chunkId: chunk.chunkId,
    sourceId: typeof chunk.sourceId === 'string' && chunk.sourceId.trim() ? chunk.sourceId.trim() : chunk.chunkId,
    title: chunk.title.trim().slice(0, 200),
    section: typeof chunk.section === 'string' && chunk.section.trim() ? chunk.section.trim().slice(0, 200) : chunk.title.trim().slice(0, 200),
    publisher: chunk.publisher.trim().slice(0, 120),
    url: chunk.usageScope === 'internal_noncommercial' ? null : (typeof chunk.url === 'string' && /^https:\/\//iu.test(chunk.url.trim()) ? chunk.url.trim() : null),
    excerpt: rawExcerpt.slice(0, 320),
    fetchedAt: typeof chunk.fetchedAt === 'string' && chunk.fetchedAt.trim() ? chunk.fetchedAt.trim() : null,
    sourceUpdatedAt: typeof chunk.sourceUpdatedAt === 'string' && chunk.sourceUpdatedAt.trim() ? chunk.sourceUpdatedAt.trim()
      : typeof chunk.sourcePublishedAt === 'string' && chunk.sourcePublishedAt.trim() ? chunk.sourcePublishedAt.trim() : null,
    ...(typeof chunk.sourceDateText === 'string' && chunk.sourceDateText.trim() ? { sourceDateText: chunk.sourceDateText.trim().slice(0, 120) } : {}),
    stage,
    ...(chunk.applicabilityStatus === 'conditional' || chunk.applicabilityStatus === 'requires_clarification'
      ? { applicabilityStatus: chunk.applicabilityStatus }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function formatProgressSourceDateText(
  source: Pick<AgentProgressSource, 'sourceDateText' | 'sourceUpdatedAt' | 'fetchedAt'>,
): string | null {
  return source.sourceDateText ?? source.sourceUpdatedAt ?? source.fetchedAt ?? null;
}

export function mergeAgentProgressSources(
  previous: readonly AgentProgressSource[],
  incoming: readonly AgentProgressSource[] | undefined,
): AgentProgressSource[] {
  if (!incoming?.length) return [...previous];
  const byChunk = new Map<string, AgentProgressSource>(previous.map(item => [item.chunkId, item]));
  for (const source of incoming) {
    const existing = byChunk.get(source.chunkId);
    if (!existing) {
      byChunk.set(source.chunkId, source);
      continue;
    }
    if (existing.stage === 'read' && source.stage === 'found') {
      byChunk.set(source.chunkId, {
        ...existing,
        url: existing.url ?? source.url,
        fetchedAt: existing.fetchedAt ?? source.fetchedAt,
        sourceUpdatedAt: existing.sourceUpdatedAt ?? source.sourceUpdatedAt,
        sourceDateText: existing.sourceDateText ?? source.sourceDateText,
        applicabilityStatus: existing.applicabilityStatus ?? source.applicabilityStatus,
      });
    } else {
      byChunk.set(source.chunkId, {
        ...existing,
        ...source,
        url: source.url ?? existing.url,
        fetchedAt: source.fetchedAt ?? existing.fetchedAt,
        sourceUpdatedAt: source.sourceUpdatedAt ?? existing.sourceUpdatedAt,
        sourceDateText: source.sourceDateText ?? existing.sourceDateText,
        stage: existing.stage === 'read' || source.stage === 'read' ? 'read' : 'found',
      });
    }
  }
  const merged = [...byChunk.values()];
  if (merged.length <= AGENT_PROGRESS_MAX_SOURCES) return merged;
  const readItems = merged.filter(item => item.stage === 'read');
  const foundItems = merged.filter(item => item.stage !== 'read');
  return [...readItems, ...foundItems].slice(0, AGENT_PROGRESS_MAX_SOURCES);
}

export function officialHelpFromTools(tools: readonly { name: string; status: string; reference?: string }[]): OfficialHelpId[] {
  return [...new Set(tools.filter(tool => tool.name === 'show_official_help' && tool.status === 'succeeded')
    .flatMap(tool => { const id = officialHelpIdSchema.safeParse(tool.reference); return id.success ? [id.data] : []; }))];
}
