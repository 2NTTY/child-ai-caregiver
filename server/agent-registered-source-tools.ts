import { z } from 'zod';
import type { RegisteredSourceCard, RegisteredSourceCommand } from '../src/shared/registered-source-card.ts';
import { sourceCardDefaultFrequencyMinutes } from '../src/shared/registered-source-card.ts';
import type { AgentTool, AgentToolResult } from './agent-runtime.ts';
import type { ChatDeliveryVerifiedOperation } from './chat-delivery-review.ts';
import { FirestoreDomainError, firestoreDomainUuid } from './firestore-domain-data.ts';
import { FamilyError } from './family-access.ts';
import type { ListedPlatformCard } from './knowledge-library-selection.ts';
import { personalLibraryItemSchema } from '../src/shared/personal-library.ts';
import { FirestoreKnowledgeError } from './firestore-knowledge.ts';
import type { createFirestorePersonalLibrary } from './firestore-personal-library.ts';

export type AgentPlatformLibrary = Pick<ReturnType<typeof createFirestorePersonalLibrary>, 'platformCards' | 'joinListedCard'>;

/** The account service passed to chat deliberately has no credential reader or writer. */
export interface AgentSourceCards {
  get(owner: string, cardId: string): Promise<RegisteredSourceCard | null>;
  list(owner: string, cursor?: string): Promise<{ items: RegisteredSourceCard[]; nextCursor: string | null }>;
  command(owner: string, input: RegisteredSourceCommand): Promise<{ card: RegisteredSourceCard | null }>;
}

const frequency = z.int().min(1).max(2147483647);
const registration = z.strictObject({
  name: z.string().trim().min(1).max(160), url: z.string().max(4096),
  kind: z.enum(['document', 'directory', 'bulletin']), frequencyMinutes: frequency.optional(),
});
const management = z.strictObject({
  cardId: z.uuid(), expectedRevision: z.int().min(1),
  action: z.enum(['pause', 'resume', 'check_now', 'change_frequency', 'rename']),
  frequencyMinutes: frequency.optional(), name: z.string().trim().min(1).max(160).optional(),
});
const rejected = (reason: string): AgentToolResult => ({ status: 'rejected', data: { reason } });
function view(card: RegisteredSourceCard) {
  const { credentialRef, ...settings } = card;
  return { ...settings, hasLogin: !!credentialRef };
}
function interval(minutes: number) {
  if (minutes === 1440) return '每天';
  if (minutes === 10080) return '每星期';
  for (const [unit, label] of [[10080, '星期'], [1440, '天'], [60, '小時']] as const)
    if (minutes % unit === 0) return '每 ' + minutes / unit + ' ' + label;
  return '每 ' + minutes + ' 分鐘';
}

export function createRegisteredSourceTools(store: AgentSourceCards, owner: string, messageId: string,
  userMessage: string, authorize: () => Promise<boolean>, previousOwnerMessages: readonly string[] = [],
  platform?: { childId: string; library: AgentPlatformLibrary }) {
  const operations = new Map<string, ChatDeliveryVerifiedOperation>();
  const identity = (...parts: unknown[]) => firestoreDomainUuid(['chat-source-card/v1', owner, messageId, ...parts]);
  const tools: AgentTool[] = [];
  function add(name: string, description: string, parameters: AgentTool['parameters'], read: boolean,
    execute: (args: Record<string, unknown>) => Promise<AgentToolResult>) {
    tools.push({ name, description, parameters, ...(read ? { effect: 'read' as const } : {}),
      authorize: (_, scope) => scope.userId === owner ? authorize() : Promise.resolve(false),
      async execute(args, context) {
        if (context.scope.userId !== owner || !await authorize()) return rejected('access_revoked');
        try {
          const result = await execute(args);
          return await authorize() ? result : rejected('access_revoked');
        } catch (error) {
          if (!(error instanceof FirestoreDomainError || error instanceof FamilyError || error instanceof FirestoreKnowledgeError) || error.status >= 500) throw error;
          return { status: error.status === 409 ? 'conflict' : 'rejected', data: { reason: error.code } };
        }
      } });
  }
  async function commit(command: RegisteredSourceCommand, tool: string, describe: (card: RegisteredSourceCard) => string): Promise<AgentToolResult> {
    const { card } = await store.command(owner, command);
    if (!card) return rejected('source_card_not_found');
    operations.set(command.operationId, { kind: 'action_receipt', id: command.operationId, state: 'committed',
      tool, summary: describe(card) });
    return { status: 'succeeded', reference: card.cardId, data: { card: view(card), operationId: command.operationId } };
  }
  add('read_source_cards', '查看本人在「記憶與參考」設定的來源卡、版本、檢查頻率、最近結果及下次檢查時間。', z.strictObject({
    cardId: z.uuid().optional(), cursor: z.string().max(512).optional(),
  }), true, async ({ cardId, cursor }) => {
    if (typeof cardId === 'string') {
      const card = await store.get(owner, cardId);
      return card ? { status: 'succeeded', reference: card.cardId, data: { card: view(card) } } : rejected('source_card_not_found');
    }
    const page = await store.list(owner, typeof cursor === 'string' ? cursor : undefined);
    return { status: 'succeeded', data: { cards: page.items.map(view), nextCursor: page.nextCursor } };
  });
  if (platform) {
    const listed = new Map<string, ListedPlatformCard>();
    const cursors = new Map<string, { after: string; url?: string; seen: Set<string> }>();
    add('read_platform_source_cards', '分頁查閱已發布的平台系列；有網址可直接查找。要繼續時只傳 nextCursor，即使本頁沒有結果亦可續查。', z.strictObject({
      url: z.string().url().max(4096).optional(), cursor: z.string().max(80).optional(),
    }), true, async args => {
      const cursor = typeof args.cursor === 'string' ? cursors.get(args.cursor) : undefined;
      if (args.cursor !== undefined && (!cursor || args.url !== undefined)) return rejected('invalid_catalog_cursor');
      const url = cursor?.url ?? (typeof args.url === 'string' ? args.url : undefined);
      const page = await platform.library.platformCards(owner, platform.childId, cursor?.after, url);
      const seen = new Set(cursor?.seen);
      const cards = page.cards.flatMap(card => {
        if (seen.has(card.seriesId)) return [];
        seen.add(card.seriesId);
        listed.set(card.seriesId, card);
        const { seriesId, name, publisher, mode, enabled } = card;
        return [{ seriesId, name, publisher, mode, enabled }];
      });
      const nextCursor = page.next ? identity('platform-page', page.next, url ?? '') : null;
      if (nextCursor && page.next) cursors.set(nextCursor, { after: page.next, url, seen });
      return { status: 'succeeded', data: { cards, nextCursor } };
    });
    add('join_platform_source_card', '家長要求加入或跟隨已列出的平台卡時使用。選擇有歧義時先問清楚。首次跟隨同範圍更新，重複加入保留原有設定，平台負擔維護費。', z.strictObject({
      seriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u),
    }), false, async ({ seriesId }) => {
      const card = listed.get(String(seriesId));
      if (!card) return rejected('read_platform_card_first');
      const { revision } = await platform.library.joinListedCard(owner, platform.childId, card);
      const id = identity('join-platform', card.seriesId);
      operations.set(id, { kind: 'action_receipt', id, state: 'committed', tool: 'join_platform_source_card',
        summary: '「' + card.name + '」已加入你的平台來源卡。可在來源庫查看個人設定。' });
      return { status: 'succeeded', reference: card.seriesId, data: { seriesId: card.seriesId, revision } };
    });
  }
  add('register_source_card', '家長交代定期追蹤自備網址時，將它存為本人來源卡。平台已發布的卡用 read_platform_source_cards 及 join_platform_source_card 免費加入。只讀一次的問題無須訂閱。頻率以分鐘表示。', registration, false, async args => {
    const settings = registration.parse(args);
    const supplied = [userMessage, ...previousOwnerMessages].flatMap(message =>
      message.match(/https:\/\/[^\s<>"“”「」『』（）。，、！？]+/giu) ?? []);
    let url: string;
    try { url = new URL(settings.url).href; } catch { return rejected('invalid_source_url'); }
    if (!supplied.some(value => {
      try { return new URL(value).href === url || new URL(value.replace(/[.,;!?)]+$/u, '')).href === url; } catch { return false; }
    })) return rejected('source_url_required_from_user');
    if (platform && personalLibraryItemSchema.shape.url.safeParse(url).success) {
      const match = await platform.library.platformCards(owner, platform.childId, undefined, url);
      if (match.cards.length) return rejected('use_published_platform_card');
      if (match.next) return rejected('platform_url_lookup_incomplete');
    }
    const cardId = identity('card', url);
    return commit({ action: 'create', cardId, expectedRevision: 0, operationId: identity('create', cardId),
      settings: { ...settings, url, frequencyMinutes: settings.frequencyMinutes ?? sourceCardDefaultFrequencyMinutes(settings.kind) } },
      'register_source_card', card => '已新增來源卡，' + interval(card.frequencyMinutes) + '檢查一次。');
  });
  add('manage_source_card', '按家長交代修改本人來源卡的名稱、檢查間隔、暫停、恢復，或排入一次立即檢查。請沿用卡片目前版本；排入不代表已下載或入庫。', management, false, async args => {
    const { action, cardId, expectedRevision, name, frequencyMinutes } = management.parse(args);
    const base = { cardId, expectedRevision, operationId: identity(action, cardId, expectedRevision) };
    let command: RegisteredSourceCommand;
    if (action === 'change_frequency' || action === 'rename') {
      if (action === 'change_frequency' ? !frequencyMinutes : !name) return rejected('missing_changed_setting');
      const current = await store.get(owner, cardId);
      if (!current) return rejected('source_card_not_found');
      command = { ...base, action: 'update', settings: { name: action === 'rename' ? name! : current.name,
        frequencyMinutes: action === 'change_frequency' ? frequencyMinutes! : current.frequencyMinutes,
        url: current.url, kind: current.kind, ...(current.allowedPath ? { allowedPath: current.allowedPath } : {}) } };
    } else command = action === 'check_now' ? { ...base, action } : { ...base, action: 'set_enabled', enabled: action === 'resume' };
    return commit(command, 'manage_source_card', card => {
      const label = { pause: '已暫停檢查', resume: '已恢復檢查', check_now: '已安排檢查', rename: '已更名',
        change_frequency: '已改為' + interval(card.frequencyMinutes) + '檢查一次' }[action];
      return '來源卡' + label + '。';
    });
  });
  add('open_source_card_login', '來源需要本人登入時，在這段聊天顯示連往該卡的授權按鈕。請家長只在卡內填登入資料。', z.strictObject({ cardId: z.uuid() }), true,
    async ({ cardId }) => {
      const card = await store.get(owner, String(cardId));
      return card ? { status: 'succeeded', reference: card.cardId, data: { name: card.name, loginOnCard: true } } : rejected('source_card_not_found');
    });
  return { tools, operations: () => [...operations.values()] };
}
