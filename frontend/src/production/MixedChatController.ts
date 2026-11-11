import { MixedChatApiError, type MixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import type { MixedChatRoom, MixedChatMessage } from '../../../src/shared/mixed-chat.ts';
import type { ProductAgentResult } from '../../../src/shared/product-agent.ts';
import type { MixedTaskBatch } from '../../../src/shared/mixed-task-batch.ts';
import type { MixedTranscriptRow } from '../../../src/shared/mixed-chat-transfer.ts';
import { selectedCareRecordCitations, type SelectedCareCitation } from '../../../src/shared/assistant-care-citation.ts';

export function mixedCareRecordCitations(result: ProductAgentResult | null | undefined) {
  return result?.status === 'completed' && result.deliveryReview?.decision === 'pass'
    ? selectedCareRecordCitations(result.deliveryReview.sourceVersions) : [];
}

type CreateInput = Parameters<MixedChatApi['create']>[0];
type AppendInput = Parameters<MixedChatApi['append']>[1];
type Scope = CreateInput['scope'];
type Pending = { contextKey: string | null; checked: boolean } & (
  { kind: 'create'; input: CreateInput } | { kind: 'append'; roomId: string; input: AppendInput }
  | { kind: 'reply'; roomId: string; messageId: string; method: 'POST' | 'DELETE' }
  | { kind: 'batch'; roomId: string; messageId: string; digest: string; action: 'confirm' | 'cancel' | 'advance'; position?: number });
type BatchPending = Extract<Pending, { kind: 'batch' }>;
export interface MixedChatState {
  userId: string | null; identityKey: string | null; contextKey: string | null; online: boolean;
  rooms: MixedChatRoom[]; roomsLoaded: boolean; nextRoomCursor: string | null;
  room: MixedChatRoom | null; messages: MixedChatMessage[]; nextMessageCursor: string | null;
  results: Record<string, ProductAgentResult | null>; resultErrors: string[];
  archivedReplies: Record<string, MixedTranscriptRow['reply']>;
  careCitation: { messageId: string; ordinal: number; loading: boolean; citation: SelectedCareCitation | null; error: string | null } | null;
  batches: Record<string, MixedTaskBatch | null>; batchErrors: string[];
  draft: string; busy: 'read' | 'write' | 'reply' | null; pending: Pending | null; notice: string | null;
}
const initial = (): MixedChatState => ({ userId: null, identityKey: null, contextKey: null, online: false,
  rooms: [], roomsLoaded: false, nextRoomCursor: null, room: null, messages: [], nextMessageCursor: null,
  results: {}, resultErrors: [], archivedReplies: {}, careCitation: null, batches: {}, batchErrors: [], draft: '', busy: null, pending: null, notice: null });
type Ticket = { sequence: number; userId: string; controller: AbortController };

/** One account's private conversations. Server authorization and saved run results remain authoritative. */
export class MixedChatController {
  private state = initial();
  private scope: Scope | null = null;
  private listeners = new Set<() => void>();
  private active: AbortController | null = null;
  private sequence = 0;
  private careSequence = 0;
  private careController: AbortController | null = null;
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
      this.closeCareCitation();
      this.active?.abort(); this.active = null; this.sequence++;
      const pending = identityChanged ? null : this.state.pending;
      this.scope = scope;
      this.state = { ...initial(), userId, identityKey, online, contextKey, pending };
      this.update({});
    } else if (online !== this.state.online) {
      if (!online) { this.closeCareCitation(); this.active?.abort(); this.active = null; this.sequence++; }
      this.update({ online, ...(!online ? { busy: null } : {}) });
    }
  }
  private begin(busy: MixedChatState['busy'], interruptReply = false): Ticket | null {
    if (!this.state.userId || !this.state.identityKey || !this.scope || !this.state.online || this.state.busy && !(interruptReply
      && (this.state.busy === 'reply' || this.state.busy === 'write' && this.state.pending?.kind === 'batch'))) return null;
    this.closeCareCitation();
    if (interruptReply) this.active?.abort();
    const controller = new AbortController(); this.active = controller;
    const ticket = { sequence: ++this.sequence, userId: this.state.userId, controller };
    this.update({ busy, notice: null }); return ticket;
  }
  private current(ticket: Ticket) { return ticket.sequence === this.sequence && this.state.userId === ticket.userId && !ticket.controller.signal.aborted; }
  private finish(ticket: Ticket) { if (this.current(ticket)) { this.active = null; this.update({ busy: null }); } }
  private inScope(room: MixedChatRoom) {
    return this.scope?.kind === 'personal' ? room.scope.kind === 'personal'
      : this.scope?.kind === 'class' && room.scope.kind === 'class' && room.scope.spaceId === this.scope.spaceId;
  }
  private failure(error: unknown, write = false) {
    if (error instanceof MixedChatApiError && [401, 403, 404, 409].includes(error.status)) {
      this.closeCareCitation();
      this.update({ room: null, messages: [], results: {}, resultErrors: [], archivedReplies: {}, batches: {}, batchErrors: [], rooms: [], roomsLoaded: false, pending: null, draft: '',
        notice: this.scope?.kind === 'personal' ? '對話、孩子或權限已改變，請重新讀取本人的孩子及對話。'
          : '對話、班級或權限已改變，請重新讀取名冊及本人對話。' });
      this.scopeChanged();
    } else if (write) {
      const rejected = error instanceof MixedChatApiError && error.status >= 400 && error.status < 500;
      this.update({ ...(rejected ? { pending: null } : {}), notice: rejected ? '這次輸入未獲接納，請核對後再試。'
        : '原操作結果未確認；請查回原操作，勿重新送出另一筆。' });
    } else this.update({ notice: '未能讀取本人對話或原回覆，請重新讀取。' });
  }
  closeCareCitation = () => {
    this.careController?.abort(); this.careController = null; this.careSequence++;
    if (this.state.careCitation) this.update({ careCitation: null });
  };
  async readCareCitation(messageId: string, ordinal: number) {
    const { room, userId, identityKey, contextKey, online } = this.state;
    const result = this.state.results[messageId];
    if (!room || !userId || !identityKey || !online || this.state.busy || this.state.pending || Object.hasOwn(this.state.archivedReplies, messageId)
      || !this.state.messages.some(message => message.id === messageId) || !Number.isSafeInteger(ordinal) || ordinal < 1) return;
    const reference = mixedCareRecordCitations(result)[ordinal - 1];
    const childId = reference && room.childIds[reference.childIndex];
    if (!reference || !childId) return;
    this.closeCareCitation();
    const controller = new AbortController(), sequence = ++this.careSequence, runId = result!.runId;
    this.careController = controller;
    const current = () => sequence === this.careSequence && !controller.signal.aborted && this.state.userId === userId
      && this.state.identityKey === identityKey && this.state.contextKey === contextKey && this.state.room?.id === room.id
      && this.state.results[messageId]?.runId === runId;
    this.update({ careCitation: { messageId, ordinal, loading: true, citation: null, error: null } });
    try {
      const citation = await this.api.careCitation(room.id, messageId, ordinal, userId, controller.signal);
      if (!current()) return;
      const liveReference = mixedCareRecordCitations(this.state.results[messageId])[ordinal - 1];
      if (citation.citationId !== reference.citationId || citation.recordId !== reference.recordId || citation.version !== reference.version
        || citation.childId !== childId || this.state.room?.childIds[reference.childIndex] !== childId
        || liveReference?.citationId !== reference.citationId || liveReference.version !== reference.version)
        throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
      this.update({ careCitation: { messageId, ordinal, loading: false, citation, error: null } });
    } catch (error) {
      if (!current()) return;
      if (error instanceof MixedChatApiError && error.status === 401) { this.failure(error); return; }
      const message = error instanceof MixedChatApiError && error.status === 409 ? '來源已更改，未能顯示這筆原文；請重新查閱。'
        : error instanceof MixedChatApiError && [403, 404].includes(error.status) ? '目前已無法查看這筆照護記錄。'
          : '未能讀取照護原文，請重試。';
      this.update({ careCitation: { messageId, ordinal, loading: false, citation: null, error: message } });
    } finally { if (this.careController === controller) this.careController = null; }
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
    if (!more) this.update({ room: null, messages: [], results: {}, resultErrors: [], archivedReplies: {}, batches: {}, batchErrors: [], draft: '', nextMessageCursor: null });
    try {
      const page = await this.api.detail(roomId, ticket.userId, ticket.controller.signal, more ? this.state.nextMessageCursor! : undefined);
      if (!this.current(ticket)) return;
      if (!this.inScope(page.room)) throw new MixedChatApiError(409, 'scope_changed');
      const messages = new Map([...page.messages, ...(more ? this.state.messages : [])].map(message => [message.id, message]));
      const archivedReplies = { ...(more ? this.state.archivedReplies : {}), ...Object.fromEntries((page.archivedReplies ?? []).map(row => [row.messageId, row.reply])) };
      this.update({ room: page.room, messages: [...messages.values()].sort((a, b) => a.version - b.version), nextMessageCursor: page.nextCursor, archivedReplies });
      await Promise.all(page.messages.map(async message => {
        if (Object.hasOwn(archivedReplies, message.id)) return;
        try {
          const result = await this.api.reply(roomId, message.id, 'GET', ticket.userId, ticket.controller.signal);
          if (this.current(ticket) && this.state.room?.id === roomId) this.update({ results: { ...this.state.results, [message.id]: result },
            resultErrors: this.state.resultErrors.filter(id => id !== message.id) });
          if (this.current(ticket) && this.batchHint(message.id)) await this.readBatchIn(ticket, roomId, message.id);
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
        if (this.current(ticket)) this.update({ pending: null, ...(pending.contextKey === this.state.contextKey ? { room, messages: [], results: {}, resultErrors: [], archivedReplies: {}, batches: {}, batchErrors: [], draft: '', nextMessageCursor: null,
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
      } else if (pending.kind === 'reply') {
        const result = await this.api.reply(pending.roomId, pending.messageId, pending.method, ticket.userId, ticket.controller.signal);
        if (this.current(ticket)) {
          const settled = result !== null && (pending.method === 'POST' || result.status !== 'running');
          this.update({ pending: settled ? null : pending });
          if (pending.contextKey === this.state.contextKey && this.state.room?.id === pending.roomId)
            this.update({ results: { ...this.state.results, [pending.messageId]: result }, resultErrors: this.state.resultErrors.filter(id => id !== pending.messageId),
              notice: settled ? null : '原回覆或停止結果尚未確認，請先查核原回覆。' });
          if (this.batchHint(pending.messageId)) await this.readBatchIn(ticket, pending.roomId, pending.messageId);
        }
      }
    } catch (error) { if (this.current(ticket)) this.failure(error, true); } finally { this.finish(ticket); }
  }
  async startReply(messageId: string) {
    if (Object.hasOwn(this.state.archivedReplies, messageId) || this.state.pending || !this.state.room || !this.state.messages.some(message => message.id === messageId)
      || Object.entries(this.state.results).some(([id, result]) => id !== messageId && result?.status === 'running')) return;
    await this.write({ kind: 'reply', contextKey: this.state.contextKey, checked: false, roomId: this.state.room.id, messageId, method: 'POST' });
  }
  async stopReply(messageId: string) {
    if (Object.hasOwn(this.state.archivedReplies, messageId)) return;
    const pending = this.state.pending, room = this.state.room;
    if (!room || !this.state.messages.some(message => message.id === messageId)
      || pending && !(pending.kind === 'reply' && pending.roomId === room.id && pending.messageId === messageId)) return;
    await this.write({ kind: 'reply', contextKey: this.state.contextKey, checked: false, roomId: room.id, messageId, method: 'DELETE' }, true);
  }
  async readReply(messageId: string) {
    if (Object.hasOwn(this.state.archivedReplies, messageId)) return;
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
      if (this.current(ticket) && this.batchHint(messageId)) await this.readBatchIn(ticket, roomId, messageId);
    } catch (error) { if (this.current(ticket)) this.failure(error); } finally { this.finish(ticket); }
  }
  async checkOriginal() {
    const pending = this.state.pending; if (!pending) return;
    if (pending.kind === 'batch') await this.readBatch(pending.messageId);
    else if (pending.kind === 'reply') {
      await this.readReply(pending.messageId);
    } else {
      const id = await this.write(pending);
      if (pending.kind === 'create' && id && this.state.room?.id === id) await this.openRoom(id);
    }
  }
  async retryOriginal() {
    const pending = this.state.pending;
    if (pending?.kind === 'reply' && pending.checked) await this.write(pending);
    else if (pending?.kind === 'batch' && pending.checked) await this.writeBatch(pending);
  }
  private batchHint(messageId: string) {
    if (Object.hasOwn(this.state.archivedReplies, messageId)) return false;
    return this.state.results[messageId]?.tools.some(tool => tool.name === 'prepare_selected_tasks')
      || Object.hasOwn(this.state.batches, messageId)
      || this.state.pending?.kind === 'batch' && this.state.pending.messageId === messageId;
  }
  private acceptBatch(roomId: string, messageId: string, batch: MixedTaskBatch | null) {
    if (this.state.room?.id !== roomId) return;
    const run = this.state.results[messageId];
    if (batch && (run && batch.runId !== run.runId || batch.items.some(item => !this.state.room!.childIds.includes(item.childId))
      || new Set(batch.items.map(item => item.operationId)).size !== batch.items.length)) throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
    this.update({ batches: { ...this.state.batches, [messageId]: batch }, batchErrors: this.state.batchErrors.filter(id => id !== messageId) });
  }
  private async readBatchIn(ticket: Ticket, roomId: string, messageId: string) {
    try {
      const batch = await this.api.batch(roomId, messageId, ticket.userId, ticket.controller.signal);
      if (this.current(ticket)) this.acceptBatch(roomId, messageId, batch);
      return batch;
    } catch (error) {
      if (this.current(ticket)) {
        if (error instanceof MixedChatApiError && [401, 403, 404, 409].includes(error.status)) this.failure(error);
        else this.update({ batchErrors: [...new Set([...this.state.batchErrors, messageId])], notice: '未能查回原待辦批次，請重新讀取；未重新送出操作。' });
      }
      return undefined;
    }
  }
  async readBatch(messageId: string) {
    if (!this.batchHint(messageId)) return;
    const pending = this.state.pending;
    if (pending && !(pending.kind === 'batch' && pending.messageId === messageId)) return;
    const roomId = pending?.kind === 'batch' ? pending.roomId : this.state.room?.id; if (!roomId) return;
    const ticket = this.begin('read'); if (!ticket) return;
    try {
      const batch = await this.readBatchIn(ticket, roomId, messageId);
      if (!this.current(ticket) || batch === undefined) return;
      if (pending?.kind === 'batch') {
        const needsOriginal = !batch || batch.digest === pending.digest && (pending.action === 'cancel' && ['running', 'awaiting_confirmation'].includes(batch.state)
          || pending.action === 'confirm' && batch.state === 'awaiting_confirmation');
        this.update({ pending: needsOriginal ? { ...pending, checked: true } : null });
      }
    } catch { /* The original request and the last verified batch stay available for recovery. */ }
    finally { this.finish(ticket); }
  }
  async confirmBatch(messageId: string, digest: string) {
    const batch = this.state.batches[messageId];
    if (this.state.pending || !this.state.room || !batch || batch.digest !== digest || batch.state !== 'awaiting_confirmation'
      || this.state.results[messageId]?.status !== 'completed') return;
    await this.writeBatch({ kind: 'batch', roomId: this.state.room.id, messageId, digest, action: 'confirm', contextKey: this.state.contextKey, checked: false });
  }
  async continueBatch(messageId: string, digest: string) {
    const batch = this.state.batches[messageId];
    if (this.state.pending || !this.state.room || !batch || batch.digest !== digest || batch.state !== 'running') return;
    await this.writeBatch({ kind: 'batch', roomId: this.state.room.id, messageId, digest, action: 'advance',
      position: batch.items.findIndex(item => item.status === 'pending'), contextKey: this.state.contextKey, checked: false });
  }
  async cancelBatch(messageId: string, digest: string) {
    const batch = this.state.batches[messageId], pending = this.state.pending;
    if (!this.state.room || !batch || batch.digest !== digest || !['running', 'awaiting_confirmation'].includes(batch.state)
      || pending && !(pending.kind === 'batch' && pending.roomId === this.state.room.id && pending.messageId === messageId)) return;
    await this.writeBatch({ kind: 'batch', roomId: this.state.room.id, messageId, digest, action: 'cancel', contextKey: this.state.contextKey, checked: false }, true);
  }
  private async writeBatch(original: BatchPending, interrupt = false) {
    const ticket = this.begin('write', interrupt); if (!ticket) return;
    let pending = original;
    this.update({ pending });
    try {
      let batch = pending.action === 'advance'
        ? await this.api.advanceBatch(pending.roomId, pending.messageId, { digest: pending.digest, position: pending.position! }, ticket.userId, ticket.controller.signal)
        : await this.api.controlBatch(pending.roomId, pending.messageId, { digest: pending.digest, action: pending.action }, ticket.userId, ticket.controller.signal);
      while (this.current(ticket)) {
        this.acceptBatch(pending.roomId, pending.messageId, batch);
        if (pending.action === 'cancel' || batch.state !== 'running') {
          const stopping = pending.action === 'cancel' && ['running', 'awaiting_confirmation'].includes(batch.state);
          this.update({ pending: stopping ? pending : null, ...(stopping ? { notice: '原批次仍未確認停止，請查回原批次。' } : {}) }); return;
        }
        const position = batch.items.findIndex(item => item.status === 'pending');
        if (position < 0 || pending.action === 'advance' && position <= pending.position!) throw new MixedChatApiError(0, 'mixed_chat_response_invalid');
        pending = { ...pending, action: 'advance', position, checked: false };
        this.update({ pending });
        batch = await this.api.advanceBatch(pending.roomId, pending.messageId, { digest: pending.digest, position }, ticket.userId, ticket.controller.signal);
      }
    } catch (error) {
      if (this.current(ticket)) {
        if (error instanceof MixedChatApiError && error.status === 409)
          this.update({ notice: '原批次資料已改變，請查回原批次，再核對逐項結果。' });
        else this.failure(error, true);
      }
    } finally { this.finish(ticket); }
  }
  dispose() { this.closeCareCitation(); this.active?.abort(); this.sequence++; this.listeners.clear(); }
}
