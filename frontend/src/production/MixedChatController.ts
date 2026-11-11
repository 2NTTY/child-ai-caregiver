import { MixedChatApiError, type MixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import type { MixedChatRoom, MixedChatMessage } from '../../../src/shared/mixed-chat.ts';
import type { ProductAgentResult } from '../../../src/shared/product-agent.ts';

type CreateInput = Parameters<MixedChatApi['create']>[0];
type AppendInput = Parameters<MixedChatApi['append']>[1];
type Scope = Extract<CreateInput['scope'], { kind: 'class' }>;
type Pending = { contextKey: string | null; checked: boolean } & (
  { kind: 'create'; input: CreateInput } | { kind: 'append'; roomId: string; input: AppendInput }
  | { kind: 'reply'; roomId: string; messageId: string; method: 'POST' | 'DELETE' });
export interface MixedChatState {
  userId: string | null; identityKey: string | null; contextKey: string | null; online: boolean;
  rooms: MixedChatRoom[]; roomsLoaded: boolean; nextRoomCursor: string | null;
  room: MixedChatRoom | null; messages: MixedChatMessage[]; nextMessageCursor: string | null;
  results: Record<string, ProductAgentResult | null>; resultErrors: string[];
  draft: string; busy: 'read' | 'write' | 'reply' | null; pending: Pending | null; notice: string | null;
}
const initial = (): MixedChatState => ({ userId: null, identityKey: null, contextKey: null, online: false,
  rooms: [], roomsLoaded: false, nextRoomCursor: null, room: null, messages: [], nextMessageCursor: null,
  results: {}, resultErrors: [], draft: '', busy: null, pending: null, notice: null });
type Ticket = { sequence: number; userId: string; controller: AbortController };

/** One account's private conversations. Server authorization and saved run results remain authoritative. */
export class MixedChatController {
  private state = initial();
  private scope: Scope | null = null;
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private sequence = 0;
  private api: MixedChatApi;
  private scopeChanged: () => void;
  constructor(api: MixedChatApi, scopeChanged: () => void = () => {}) { this.api = api; this.scopeChanged = scopeChanged; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<MixedChatState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  syncContext(userId: string | null, identityKey: string | null, online: boolean, scope: Scope | null, selectionKey: string) {
    const contextKey = scope ? JSON.stringify([scope, selectionKey]) : null;
    const identityChanged = userId !== this.state.userId || identityKey !== this.state.identityKey;
    if (identityChanged || contextKey !== this.state.contextKey) {
      this.active?.abort(); this.active = null; this.sequence++;
      const pending = identityChanged ? null : this.state.pending;
      this.scope = scope;
      this.state = { ...initial(), userId, identityKey, online, contextKey, pending };
      this.update({});
    } else if (online !== this.state.online) {
      if (!online) { this.active?.abort(); this.active = null; this.sequence++; }
      this.update({ online, ...(!online ? { busy: null } : {}) });
    }
  }
  private begin(busy: MixedChatState['busy'], interruptReply = false): Ticket | null {
    if (!this.state.userId || !this.state.identityKey || !this.scope || !this.state.online || this.state.busy && !(interruptReply && this.state.busy === 'reply')) return null;
    if (interruptReply) this.active?.abort();
    const controller = new AbortController(); this.active = controller;
    const ticket = { sequence: ++this.sequence, userId: this.state.userId, controller };
    this.update({ busy, notice: null }); return ticket;
  }
  private current(ticket: Ticket) { return ticket.sequence === this.sequence && this.state.userId === ticket.userId && !ticket.controller.signal.aborted; }
  private finish(ticket: Ticket) { if (this.current(ticket)) { this.active = null; this.update({ busy: null }); } }
  private inScope(room: MixedChatRoom) { return this.scope && room.scope.kind === 'class' && room.scope.spaceId === this.scope.spaceId; }
  private failure(error: unknown, write = false) {
    if (error instanceof MixedChatApiError && [401, 403, 404, 409].includes(error.status)) {
      this.update({ room: null, messages: [], results: {}, resultErrors: [], rooms: [], roomsLoaded: false, pending: null, draft: '',
        notice: '對話、班級或權限已改變，請重新讀取名冊及本人對話。' });
      this.scopeChanged();
    } else if (write) {
      const rejected = error instanceof MixedChatApiError && error.status >= 400 && error.status < 500;
      this.update({ ...(rejected ? { pending: null } : {}), notice: rejected ? '這次輸入未獲接納，請核對後再試。'
        : '原操作結果未確認；請查回原操作，勿重新送出另一筆。' });
    } else this.update({ notice: '未能讀取本人對話或原回覆，請重新讀取。' });
  }
  setDraft = (draft: string) => { if (!this.state.busy && !this.state.pending) this.update({ draft }); };
  async loadRooms(more = false) {
    if (this.state.pending || more && !this.state.nextRoomCursor) return;
    const ticket = this.begin('read'); if (!ticket) return;
    try {
      const page = await this.api.list(ticket.userId, ticket.controller.signal, more ? this.state.nextRoomCursor! : undefined);
      if (this.current(ticket)) {
        const rooms = new Map((more ? this.state.rooms : []).map(room => [room.id, room]));
        for (const room of page.rooms) if (this.inScope(room)) rooms.set(room.id, room);
        this.update({ rooms: [...rooms.values()], roomsLoaded: true, nextRoomCursor: page.nextCursor });
      }
    } catch (error) { if (this.current(ticket)) this.failure(error); } finally { this.finish(ticket); }
  }
  async openRoom(roomId: string, more = false) {
    if (this.state.pending || more && (this.state.room?.id !== roomId || !this.state.nextMessageCursor)) return;
    const ticket = this.begin('read'); if (!ticket) return;
    if (!more) this.update({ room: null, messages: [], results: {}, resultErrors: [], draft: '', nextMessageCursor: null });
    try {
      const page = await this.api.detail(roomId, ticket.userId, ticket.controller.signal, more ? this.state.nextMessageCursor! : undefined);
      if (!this.current(ticket)) return;
      if (!this.inScope(page.room)) throw new MixedChatApiError(409, 'scope_changed');
      const messages = new Map([...page.messages, ...(more ? this.state.messages : [])].map(message => [message.id, message]));
      this.update({ room: page.room, messages: [...messages.values()].sort((a, b) => a.version - b.version), nextMessageCursor: page.nextCursor });
      await Promise.all(page.messages.map(async message => {
        try {
          const result = await this.api.reply(roomId, message.id, 'GET', ticket.userId, ticket.controller.signal);
          if (this.current(ticket) && this.state.room?.id === roomId) this.update({ results: { ...this.state.results, [message.id]: result },
            resultErrors: this.state.resultErrors.filter(id => id !== message.id) });
        } catch (error) {
          if (!this.current(ticket)) return;
          if (error instanceof MixedChatApiError && [401, 403, 404, 409].includes(error.status)) this.failure(error);
          else this.update({ resultErrors: [...this.state.resultErrors, message.id] });
        }
      }));
    } catch (error) { if (this.current(ticket)) this.failure(error); } finally { this.finish(ticket); }
  }
  async create(childIds: string[]) {
    if (!this.scope || this.state.pending || !childIds.length || childIds.length > 100) return;
    const pending: Pending = { kind: 'create', contextKey: this.state.contextKey, checked: false,
      input: { operationId: crypto.randomUUID(), scope: { ...this.scope }, childIds: [...childIds] } };
    const roomId = await this.write(pending);
    if (roomId && this.state.room?.id === roomId) await this.openRoom(roomId);
  }
  async send() {
    const room = this.state.room;
    if (!room || this.state.pending || !this.state.draft.trim() || Object.values(this.state.results).some(result => result?.status === 'running')) return;
    const pending: Pending = { kind: 'append', contextKey: this.state.contextKey, checked: false, roomId: room.id,
      input: { operationId: crypto.randomUUID(), expectedVersion: room.version, text: this.state.draft } };
    const messageId = await this.write(pending);
    if (messageId && this.state.room?.id === room.id) await this.startReply(messageId);
  }
  private async write(pending: Pending, interruptReply = false): Promise<string | undefined> {
    const ticket = this.begin(pending.kind === 'reply' && pending.method === 'POST' ? 'reply' : 'write', interruptReply);
    if (!ticket) return;
    this.update({ pending });
    try {
      if (pending.kind === 'create') {
        const room = await this.api.create(pending.input, ticket.userId, ticket.controller.signal);
        if (this.current(ticket)) this.update({ pending: null, ...(pending.contextKey === this.state.contextKey ? { room, messages: [], results: {}, resultErrors: [], draft: '', nextMessageCursor: null,
          rooms: [room, ...this.state.rooms.filter(value => value.id !== room.id)] } : {}) });
        if (this.current(ticket)) return room.id;
      } else if (pending.kind === 'append') {
        const message = await this.api.append(pending.roomId, pending.input, ticket.userId, ticket.controller.signal);
        if (this.current(ticket)) {
          this.update({ pending: null });
          if (pending.contextKey === this.state.contextKey && this.state.room?.id === pending.roomId) {
            this.update({ messages: [...this.state.messages.filter(value => value.id !== message.id), message], draft: '',
              room: { ...this.state.room, version: message.version, updatedAt: message.createdAt } });
            return message.id;
          }
        }
      } else {
        const result = await this.api.reply(pending.roomId, pending.messageId, pending.method, ticket.userId, ticket.controller.signal);
        if (this.current(ticket)) {
          const settled = result !== null && (pending.method === 'POST' || result.status !== 'running');
          this.update({ pending: settled ? null : pending });
          if (pending.contextKey === this.state.contextKey && this.state.room?.id === pending.roomId)
            this.update({ results: { ...this.state.results, [pending.messageId]: result }, resultErrors: this.state.resultErrors.filter(id => id !== pending.messageId),
              notice: settled ? null : '原回覆或停止結果尚未確認，請先查核原回覆。' });
        }
      }
    } catch (error) { if (this.current(ticket)) this.failure(error, true); } finally { this.finish(ticket); }
  }
  async startReply(messageId: string) {
    if (this.state.pending || !this.state.room || !this.state.messages.some(message => message.id === messageId)
      || Object.entries(this.state.results).some(([id, result]) => id !== messageId && result?.status === 'running')) return;
    await this.write({ kind: 'reply', contextKey: this.state.contextKey, checked: false, roomId: this.state.room.id, messageId, method: 'POST' });
  }
  async stopReply(messageId: string) {
    const pending = this.state.pending, room = this.state.room;
    if (!room || !this.state.messages.some(message => message.id === messageId)
      || pending && !(pending.kind === 'reply' && pending.roomId === room.id && pending.messageId === messageId)) return;
    await this.write({ kind: 'reply', contextKey: this.state.contextKey, checked: false, roomId: room.id, messageId, method: 'DELETE' }, true);
  }
  async readReply(messageId: string) {
    const pending = this.state.pending, room = this.state.room;
    if (pending && !(pending.kind === 'reply' && pending.messageId === messageId)) return;
    const roomId = pending?.kind === 'reply' ? pending.roomId : room?.id;
    if (!roomId) return;
    const ticket = this.begin('read'); if (!ticket) return;
    try {
      const result = await this.api.reply(roomId, messageId, 'GET', ticket.userId, ticket.controller.signal);
      const settled = result !== null && !(pending?.kind === 'reply' && pending.method === 'DELETE' && result.status === 'running');
      if (this.current(ticket)) this.update({ ...(this.state.room?.id === roomId ? {
        results: { ...this.state.results, [messageId]: result }, resultErrors: this.state.resultErrors.filter(id => id !== messageId) } : {}),
        pending: settled ? null : pending ? { ...pending, checked: true } : null,
        notice: result ? !settled ? '原運行仍在處理，尚未確認停止；可繼續停止同一原運行。'
          : this.state.room?.id === roomId ? null : '原運行已查回，可從本人對話重新開啟。'
          : '尚未找到原助手運行；如要接續，只會使用這則原留言。' });
    } catch (error) { if (this.current(ticket)) this.failure(error); } finally { this.finish(ticket); }
  }
  async checkOriginal() {
    const pending = this.state.pending; if (!pending) return;
    if (pending.kind === 'reply') {
      await this.readReply(pending.messageId);
    } else {
      const id = await this.write(pending);
      if (pending.kind === 'create' && id && this.state.room?.id === id) await this.openRoom(id);
    }
  }
  async retryOriginal() { const pending = this.state.pending; if (pending?.kind === 'reply' && pending.checked) await this.write(pending); }
  dispose() { this.active?.abort(); this.sequence++; this.listeners.clear(); }
}
