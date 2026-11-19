import { z } from 'zod';
import type { RegisteredSourceCard, RegisteredSourceCommand } from '../src/shared/registered-source-card.ts';
import { sourceCardDefaultFrequencyMinutes } from '../src/shared/registered-source-card.ts';
import type { AgentTool, AgentToolResult } from './agent-runtime.ts';
import type { ChatDeliveryVerifiedOperation } from './chat-delivery-review.ts';
import { FirestoreDomainError, firestoreDomainUuid } from './firestore-domain-data.ts';
import { FamilyError } from './family-access.ts';
import { platformLibraryJoin, type PersonalLibraryItem } from '../src/shared/personal-library.ts';
import type { LibraryJoin } from '../src/shared/source-series.ts';
import type { createFirestorePersonalLibrary } from './firestore-personal-library.ts';

export type AgentPlatformLibrary = Pick<ReturnType<typeof createFirestorePersonalLibrary>, 'page' | 'save'>;

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
          if (!(error instanceof FirestoreDomainError || error instanceof FamilyError) || error.status >= 500) throw error;
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
  async function publishedItems() {
    const items: PersonalLibraryItem[] = [];
    if (platform) {
      let cursor: string | null = null;
      do {
        const page = await platform.library.page(owner, platform.childId, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
    }
    return items;
  }
  if (platform) {
    const listed = new Map<string, { name: string; join: LibraryJoin }>();
    add('read_platform_source_cards', '查閱來源庫目前已發布、可免費加入的卡片和本人的選擇。按名稱、機構或網址辨認系列。', z.strictObject({}), true, async () => {
      listed.clear();
      const groups = new Map<string, PersonalLibraryItem[]>();
      for (const item of await publishedItems()) {
        if (!item.series) continue;
        const group = groups.get(item.series.id) ?? [];
        group.push(item); groups.set(item.series.id, group);
      }
      const cards = [];
      for (const items of groups.values()) {
        const join = platformLibraryJoin(items);
        if (!join) continue;
        const first = items[0]!, name = first.series!.name;
        listed.set(join.seriesId, { name, join });
        cards.push({ seriesId: join.seriesId, name, publisher: first.publisher, mode: first.preference!.mode, enabled: first.preference!.enabled,
          documents: items.map(({ title, url }) => ({ title, url })) });
      }
      return { status: 'succeeded', data: { cards } };
    });
    add('join_platform_source_card', '家長要求加入或跟隨已列出的平台卡時使用。選擇有歧義時先問清楚。首次跟隨同範圍更新，重複加入保留原有設定，平台負擔維護費。', z.strictObject({
      seriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u),
    }), false, async ({ seriesId }) => {
      const card = listed.get(String(seriesId));
      if (!card) return rejected('read_platform_card_first');
      const { revision } = await platform.library.save(owner, platform.childId, card.join);
      const id = identity('join-platform', card.join.seriesId);
      operations.set(id, { kind: 'action_receipt', id, state: 'committed', tool: 'join_platform_source_card',
        summary: '「' + card.name + '」已加入你的平台來源卡。可在來源庫查看個人設定。' });
      return { status: 'succeeded', reference: card.join.seriesId, data: { seriesId: card.join.seriesId, revision } };
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
    const documentUrl = (value: string) => new URL(value).href.split('#')[0];
    if ((await publishedItems()).some(item => documentUrl(item.url) === documentUrl(url))) return rejected('use_published_platform_card');
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
