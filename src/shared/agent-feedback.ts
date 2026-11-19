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
  sequence: z.number().int().positive().optional(),
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
export const ALL_OFFICIAL_HELP_IDS: readonly OfficialHelpId[] = ['emergency-hk-v1', 'medical-consult-hk-v1'];
export const OFFICIAL_HELP_ENTRY_COPY = {
  buttonLabel: '官方求助入口',
  highlightedButtonLabel: '緊急／醫療官方求助入口',
  accessibilityLabel: '查看香港緊急求助、急症室、母嬰健康院及安全用藥官方入口（毋須等待 AI 回覆）',
  urgentNotice: '偵測到可能涉及緊急症狀；毋須等待 AI 搜尋或審核，請優先參考以下香港官方緊急求助入口。',
  medicalConsultNotice: '偵測到可能涉及用藥或醫療諮詢；可先參考以下安全用藥及醫療諮詢官方入口，對話仍可繼續。',
} as const;

const URGENT_EMERGENCY_HELP_PATTERN = /(?:(?<!\d)(?<!\+\d{1,4}[\s-]+)(?<!\d{3,4}[\s-]+)999(?!\d|[\s-]+\d{4,}|-\d{3,})|急症|急救|抽搐|痙攣|呼吸困難|抖唔到氣|透唔到氣|氣促|嘴唇發紫|面色發紫|面青|(?:失去|喪失|全無|毫無|無晒|冇晒)(?:意識|知覺|反應|神志)|(?:意識|知覺|反應|神志)(?:喪失|全無|毫無|不清|模糊|改變|消失)|失意識|失知覺|昏迷|昏厥|昏倒|暈倒|暈過去|叫唔醒|嗜睡|(?:無|冇|毫無|無晒|冇晒)反應|不省人事|人事不省|軟弱無力|嚴重脫水|高燒不退|大出血|誤服|中毒|窒息|哽塞|休克|convulsions?|seizures?|difficulty\s+breathing|unconscious(?:ness)?|unresponsive|choking|emergency)/iu;
const NON_URGENT_EMERGENCY_MODIFIER_PATTERN = /(?:\bnon[\s\-–—]*emergenc(?:y|ies)\b|\b(?:not|isn['’]?t|wasn['’]?t|aren['’]?t|no|without)\s+(?:an?\s+|any\s+)?(?:medical\s+|urgent\s+|true\s+|real\s+)?emergenc(?:y|ies)\b|(?:非|並非|不是|唔係|無需|毋須)急症)/giu;
const NON_URGENT_CRAMP_EXERCISE_PATTERN = /(?:預防|舒緩|放鬆|伸展|改善|減少|防止|肌肉)抽筋(?:嘅|的)?運動|對你好抽筋運動/iu;
const LAUGHING_IDIOM_CRAMP_PATTERN = /(?:好好?笑|搞笑|笑死|笑)到(?:我|個人|肚|腹)?(?:抽筋|暈(?:低|倒)?)/iu;
const COMPANION_DISTRESS_OR_SYMPTOM_PATTERN = /發燒|發熱|高燒|體溫|雙眼|反白|翻白|僵硬|硬直|抽搐|痙攣|(?:失去|喪失|全無|毫無|無晒|冇晒)(?:意識|知覺|反應|神志)|(?:意識|知覺|反應|神志)(?:喪失|全無|毫無|不清|模糊|改變|消失)|失意識|知覺|暈倒|昏倒|叫唔醒|昏迷|昏厥|(?:無|冇|毫無|無晒|冇晒)反應|不省人事|人事不省|無神|唔郁|不動|軟晒|無力|發軟|呼吸|面青|發紫|發白|血色|嘴唇|咬舌|口吐|白沫|嘔|發抖|全身|手腳|點算|點好|點處理|睇醫生|急症|好痛|劇痛|唔停|不停|一直|突然|急救|怎麼辦|如何處理/iu;

function hasUrgentConvulsionCue(normalized: string): boolean {
  if (!/抽筋|暈低/u.test(normalized)) return false;
  // Never suppress convulsion or collapse wording when physical distress, unconsciousness, child symptoms, or help-seeking context is present.
  if (COMPANION_DISTRESS_OR_SYMPTOM_PATTERN.test(normalized)) return true;
  const remaining = normalized
    .replace(LAUGHING_IDIOM_CRAMP_PATTERN, '')
    .replace(NON_URGENT_CRAMP_EXERCISE_PATTERN, '');
  return /抽筋|暈低/u.test(remaining);
}
// Millilitres measure feeds as well as medicine; match the medication or dosing cue, not the volume.
const MEDICAL_CONSULT_HELP_PATTERN = /(?:退燒藥|藥水|藥物|食藥|餵藥|服藥|用藥|藥量|劑量|毫克|抗生素|撲熱息痛|布洛芬|阿士匹靈|處方|開藥|改動醫囑|母嬰健康院|睇醫生|求醫|診斷|\b(?:doses?|dosing|dosage|medications?|medicines?|paracetamol|ibuprofen|aspirin|antibiotics?|administer|drops?|tablets?|pills?|capsules?|teaspoons?|tablespoons?|syrup|mg|mcg)\b)/iu;

/**
 * Deterministic client/server matcher for surfacing candidate official help cards
 * without waiting on the main Agent (REQ-001 §4.3).
 */
export function matchOfficialHelpForText(text: string | null | undefined): OfficialHelpId[] {
  const normalized = (text ?? '').normalize('NFKC').trim();
  if (!normalized) return [];
  const matched: OfficialHelpId[] = [];
  const urgentScopeText = normalized.replace(NON_URGENT_EMERGENCY_MODIFIER_PATTERN, ' ');
  if (URGENT_EMERGENCY_HELP_PATTERN.test(urgentScopeText) || hasUrgentConvulsionCue(normalized)) matched.push('emergency-hk-v1');
  if (MEDICAL_CONSULT_HELP_PATTERN.test(normalized)) matched.push('medical-consult-hk-v1');
  return matched;
}
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

export type ReconciledAgentProgress = AgentProgress & { cards: OfficialHelpId[]; sources: AgentProgressSource[] };

const AGENT_PROGRESS_PHASE_RANK: Record<AgentProgress['phase'], number> = {
  started: 0,
  model: 1,
  help: 1,
  working: 2,
  searching: 2,
  reading: 2,
  tool_finished: 3,
  reviewing: 4,
};

/**
 * Converges duplicate or out-of-order SSE progress events for a single message run.
 * Orders causally by sequence when present (so round-2 model/tool phases advance past tool_finished),
 * keeps active phase while accumulating help cards, blocks mismatched runIds, and preserves
 * monotonic phase-rank fallback for unsequenced events.
 */
export function reconcileAgentProgress(
  previous: ReconciledAgentProgress | null | undefined,
  incoming: AgentProgress,
): ReconciledAgentProgress {
  if (!previous || previous.messageId !== incoming.messageId) {
    return {
      ...incoming,
      cards: incoming.card ? [incoming.card] : [],
      sources: mergeAgentProgressSources([], incoming.sources),
    };
  }
  if (previous.runId !== incoming.runId) {
    return previous;
  }
  const cards = [...new Set([...previous.cards, ...(incoming.card ? [incoming.card] : [])])];
  const sameCards = cards.length === previous.cards.length
    && cards.every((card, index) => card === previous.cards[index]);
  const stale = incoming.sequence !== undefined && previous.sequence !== undefined && incoming.sequence < previous.sequence;
  // A later global phase does not mean every source's read event has arrived.
  // Late frames may add unseen sources or upgrade a matching found source to read,
  // but never replace known metadata (including intentionally suppressed URLs).
  const incomingSources = stale ? incoming.sources?.flatMap(source => {
    const known = previous.sources.find(item => item.chunkId === source.chunkId);
    if (!known) return [source];
    if (known.sourceId !== source.sourceId || known.stage === 'read' || source.stage !== 'read') return [];
    return [{ ...known, stage: 'read' as const }];
  }) : incoming.sources;
  const sources = mergeAgentProgressSources(previous.sources, incomingSources);
  const sameSources = JSON.stringify(sources) === JSON.stringify(previous.sources);
  let phase: AgentProgress['phase'];
  let sequence: number | undefined;
  if (incoming.sequence !== undefined && previous.sequence !== undefined) {
    if (incoming.sequence < previous.sequence) {
      if (sameCards && sameSources) return previous;
      phase = previous.phase;
      sequence = previous.sequence;
    } else if (incoming.sequence === previous.sequence) {
      sequence = previous.sequence;
      if (incoming.phase === 'help' && previous.phase !== 'started') {
        phase = previous.phase;
      } else {
        phase = AGENT_PROGRESS_PHASE_RANK[incoming.phase] < AGENT_PROGRESS_PHASE_RANK[previous.phase]
          ? previous.phase
          : incoming.phase;
      }
    } else {
      sequence = incoming.sequence;
      phase = incoming.phase === 'help' && previous.phase !== 'started'
        ? previous.phase
        : incoming.phase;
    }
  } else {
    sequence = incoming.sequence ?? previous.sequence;
    if (incoming.phase === 'help' && previous.phase !== 'started') {
      phase = previous.phase;
    } else {
      phase = AGENT_PROGRESS_PHASE_RANK[incoming.phase] < AGENT_PROGRESS_PHASE_RANK[previous.phase]
        ? previous.phase
        : incoming.phase;
    }
  }
  const resolvedCard = phase === 'help' ? (incoming.card ?? previous.card) : undefined;
  if (
    phase === previous.phase
    && sequence === previous.sequence
    && resolvedCard === previous.card
    && sameCards
    && sameSources
  ) {
    return previous;
  }
  return {
    runId: incoming.runId,
    messageId: incoming.messageId,
    phase,
    ...(sequence !== undefined ? { sequence } : {}),
    ...(resolvedCard ? { card: resolvedCard } : {}),
    cards,
    sources,
  };
}
export function officialHelpFromTools(tools: readonly { name: string; status: string; reference?: string }[]): OfficialHelpId[] {
  return [...new Set(tools.filter(tool => tool.name === 'show_official_help' && tool.status === 'succeeded')
    .flatMap(tool => { const id = officialHelpIdSchema.safeParse(tool.reference); return id.success ? [id.data] : []; }))];
}

export const INCOMPLETE_MODEL_REPLY_TEXT_PATTERN = /^(?:這次回覆未完成(?:：|$)|這次 Agent 運行中斷|Agent 暫未能完成回覆|Agent 未完成文字回覆)/u;
export function isIncompleteModelReplyText(text: string | null | undefined): boolean {
  return Boolean(text && INCOMPLETE_MODEL_REPLY_TEXT_PATTERN.test(text));
}
