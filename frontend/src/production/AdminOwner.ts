import { adminKnowledgeStatusSchema, type AdminKnowledgeStatus, type AdminCommand, type AdminInvitation, type AdminOverview, type AdminPage, type AdminReceipt, type AdminUsage } from '../../../src/shared/admin.ts';
import { emptyIndex, indexTargetLimit, adminIndexVersionPageSchema, adminIndexBatchPageSchema, adminIndexBatchReplySchema,
  type AdminIndexState, type AdminIndexBatch, type AdminIndexPending } from './admin-knowledge-index.ts';
export class AdminApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super('Admin request failed'); this.status = status; this.code = code; }
}
export interface AdminKnowledgeState { open: boolean; status: 'unread' | 'loading' | 'ready' | 'error'; page: AdminKnowledgeStatus | null; notice: string | null }
const emptyKnowledge = (): AdminKnowledgeState => ({ open: false, status: 'unread', page: null, notice: null });
export interface AdminState { userId: string | null; access: 'unread' | 'loading' | 'allowed' | 'denied' | 'error'; busy: boolean;
  overview: AdminOverview | null; invitations: AdminPage<AdminInvitation>; audit: AdminPage<AdminReceipt>;
  usage: { platform: AdminUsage; personal: AdminUsage } | null; lookup: AdminInvitation | null | undefined;
  pending: AdminCommand | null; notice: string | null; receipt: AdminReceipt | null; knowledge: AdminKnowledgeState; index: AdminIndexState }
const empty = (userId: string | null): AdminState => ({ userId, access: 'unread', busy: false, overview: null,
  invitations: { items: [], nextCursor: null }, audit: { items: [], nextCursor: null }, usage: null, lookup: undefined,
  pending: null, notice: null, receipt: null, knowledge: emptyKnowledge(), index: emptyIndex() });
export function adminError(error: unknown) {
  const code = error instanceof AdminApiError ? error.code : '';
  return ({ recent_reauthentication_required: '請先在下方重新驗證登入，再提交原操作。',
    version_conflict: '設定已被更新；請重新讀取並核對後再保存。', invitation_consumed: '這個邀請已被使用，不能從邀請入口停用帳號。',
    invitation_closed: '這個資格已關閉，不能重新發出。', invitation_expiry_invalid: '有效期須在未來九十天內。',
    forbidden: '此帳號沒有網站管理權限。', unauthorized: '請先重新登入。', identity_changed: '登入帳戶已改變，請重新讀取。',
    invalid_input: '請核對欄位格式及允許範圍。' } as Record<string, string>)[code] ?? '暫時未能完成，請核對連線後再讀取。';
}
/** One identity-scoped owner shared by entry and page. No family data or durable browser business store. */
export class AdminOwner {
  private state = empty(null); private generation = 0; private listeners = new Set<() => void>();
  private controllers = new Set<AbortController>();
  private baseUrl: string; private fetcher: typeof fetch;
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) { const base = baseUrl.replace(/\/$/, ''); this.baseUrl = base.endsWith('/api') ? base : base + '/api'; this.fetcher = fetcher; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<AdminState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(fn => fn()); }
  private clearReadAccess(error: unknown, access: 'error' | 'denied' = 'error') {
    this.generation++; this.controllers.forEach(controller => controller.abort()); this.controllers.clear();
    this.update({ access, busy: false, overview: null, invitations: { items: [], nextCursor: null }, audit: { items: [], nextCursor: null },
      usage: null, lookup: undefined, receipt: null, knowledge: emptyKnowledge(), index: { ...emptyIndex(), pending: this.state.index.pending }, notice: adminError(error) });
  }
  setUser(userId: string | null) {
    if (this.state.userId === userId) return;
    this.generation++; this.controllers.forEach(c => c.abort()); this.controllers.clear(); this.state = empty(userId); this.update({});
  }
  dispose() { this.generation++; this.controllers.forEach(c => c.abort()); this.controllers.clear(); this.listeners.clear(); }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const userId = this.state.userId, generation = this.generation, controller = new AbortController();
    if (!userId) throw new AdminApiError(401, 'unauthorized');
    this.controllers.add(controller);
    try {
      // Native browser fetch must not receive AdminOwner as its Window receiver.
      const fetcher = this.fetcher;
      const response = await fetcher(this.baseUrl.replace(/\/$/, '') + path, { method: body === undefined ? 'GET' : 'POST',
        credentials: 'include', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        headers: { 'x-expected-user-id': userId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json();
      if (generation !== this.generation || userId !== this.state.userId) throw new AdminApiError(409, 'identity_changed');
      if (!response.ok) throw new AdminApiError(response.status, value?.error?.code ?? 'unavailable'); return value as T;
    } finally { this.controllers.delete(controller); }
  }
  async checkAccess() {
    if (!this.state.userId || this.state.access === 'loading') return;
    const generation = this.generation; this.update({ access: 'loading' });
    try { const result = await this.request<{ administrator: boolean }>('/admin/session'); if (generation === this.generation) {
      if (result.administrator) this.update({ access: 'allowed' }); else this.clearReadAccess(new AdminApiError(403, 'forbidden'), 'denied');
    } }
    catch (error) { if (generation === this.generation) {
      if (error instanceof AdminApiError && ([401, 403].includes(error.status) || error.status === 409 && error.code === 'identity_changed')) this.clearReadAccess(error);
      else this.update({ access: 'error', notice: adminError(error), knowledge: emptyKnowledge(), index: { ...emptyIndex(), pending: this.state.index.pending } });
    } }
  }
  private async read(action: () => Promise<Partial<AdminState>>) {
    if (this.state.access !== 'allowed' || this.state.busy) return;
    const generation = this.generation; this.update({ busy: true, notice: null });
    try { const next = await action(); if (generation === this.generation) this.update(next); }
    catch (error) { if (generation === this.generation) {
      if (error instanceof AdminApiError && [401, 403, 409].includes(error.status)) this.clearReadAccess(error);
      else this.update({ notice: adminError(error) });
    } }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
  async setKnowledgeOpen(open: boolean) {
    if (this.state.access !== 'allowed') return;
    this.update({ knowledge: { ...this.state.knowledge, open } });
    if (open && this.state.knowledge.status === 'unread') await this.loadKnowledge();
  }
  async loadKnowledge(more = false) {
    if (this.state.access !== 'allowed' || !this.state.knowledge.open || this.state.knowledge.status === 'loading') return;
    const cursor = more ? this.state.knowledge.page?.nextCursor : null;
    if (more && !cursor) return;
    const generation = this.generation;
    this.update({ knowledge: { ...this.state.knowledge, status: 'loading', notice: null } });
    try {
      const page = adminKnowledgeStatusSchema.parse(await this.request<unknown>('/admin/knowledge-status' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')));
      if (generation !== this.generation || !['allowed', 'loading'].includes(this.state.access)) return;
      const previous = more ? this.state.knowledge.page : null;
      const merged: AdminKnowledgeStatus = previous ? { watches: page.watches,
        checks: [...new Map([...previous.checks, ...page.checks].map(item => [item.jobId, item])).values()], nextCursor: page.nextCursor } : page;
      this.update({ knowledge: { ...this.state.knowledge, page: merged, status: 'ready', notice: null } });
    } catch (error) {
      if (generation !== this.generation || !['allowed', 'loading'].includes(this.state.access)) return;
      const denied = error instanceof AdminApiError && ([401, 403].includes(error.status) || error.status === 409 && error.code === 'identity_changed');
      if (denied) this.clearReadAccess(error);
      else this.update({ knowledge: { ...this.state.knowledge, status: 'error', notice: adminError(error) } });
    }
  }
  private updateIndex(change: Partial<AdminIndexState>) { this.update({ index: { ...this.state.index, ...change } }); }
  private indexCurrent(generation: number) { return generation === this.generation && ['allowed', 'loading'].includes(this.state.access); }
  private indexAccessError(error: unknown) {
    const denied = error instanceof AdminApiError && ([401, 403].includes(error.status) || error.status === 409 && error.code === 'identity_changed');
    if (denied) this.clearReadAccess(error);
    return denied;
  }
  async setIndexOpen(open: boolean) {
    if (this.state.access !== 'allowed') return;
    this.updateIndex({ open });
    if (open) await Promise.all([
      this.state.index.versions.status === 'unread' ? this.loadIndexVersions() : undefined,
      this.state.index.batches.status === 'unread' ? this.loadIndexBatches() : undefined,
    ]);
  }
  async loadIndexVersions(more = false) {
    const current = this.state.index, cursor = more ? current.versions.nextVersionId : null;
    if (this.state.access !== 'allowed' || !current.open || current.busy || current.versions.status === 'loading' || more && !cursor) return;
    const generation = this.generation;
    this.updateIndex({ versions: { ...current.versions, status: 'loading', notice: null } });
    try {
      const page = adminIndexVersionPageSchema.parse(await this.request<unknown>('/admin/knowledge-versions' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')));
      if (!this.indexCurrent(generation)) return;
      const items = more ? [...new Map([...this.state.index.versions.items, ...page.items].map(item => [item.id, item])).values()] : page.items;
      this.updateIndex({ versions: { ...page, items, status: 'ready', notice: null }, selected: this.state.index.selected.filter(target =>
        items.some(item => item.id === target.versionId && item.hash === target.versionHash && item.state === 'reviewed')) });
    } catch (error) {
      if (this.indexCurrent(generation) && !this.indexAccessError(error)) this.updateIndex({ versions: { ...this.state.index.versions, status: 'error', notice: adminError(error) } });
    }
  }
  async loadIndexBatches(more = false) {
    const current = this.state.index, cursor = more ? current.batches.nextCursor : null;
    if (this.state.access !== 'allowed' || !current.open || current.busy || current.batches.status === 'loading' || more && !cursor) return;
    const generation = this.generation;
    this.updateIndex({ batches: { ...current.batches, status: 'loading', notice: null } });
    try {
      const page = adminIndexBatchPageSchema.parse(await this.request<unknown>('/admin/knowledge-index-batches' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')));
      if (!this.indexCurrent(generation)) return;
      const items = more ? [...new Map([...this.state.index.batches.items, ...page.items].map(item => [item.id, item])).values()] : page.items;
      this.updateIndex({ batches: { ...page, items, status: 'ready', notice: null } });
    } catch (error) {
      if (this.indexCurrent(generation) && !this.indexAccessError(error)) this.updateIndex({ batches: { ...this.state.index.batches, status: 'error', notice: adminError(error) } });
    }
  }
  selectIndexVersion(id: string, selected: boolean) {
    const index = this.state.index, item = index.versions.items.find(value => value.id === id);
    if (this.state.access !== 'allowed' || index.busy || index.pending || !item || item.state !== 'reviewed') return;
    const targets = index.selected.filter(value => value.versionId !== id);
    if (selected && targets.length >= indexTargetLimit) { this.updateIndex({ notice: `每批最多選擇 ${indexTargetLimit} 個已審核版本。` }); return; }
    this.updateIndex({ selected: selected ? [...targets, { versionId: id, versionHash: item.hash }] : targets, notice: null });
  }
  private canSendIndex(retry = false) {
    const index = this.state.index;
    return this.state.access === 'allowed' && index.open && !index.busy && !this.state.busy && !this.state.pending
      && (retry || !index.pending) && index.versions.status !== 'loading' && index.batches.status !== 'loading';
  }
  async createIndexBatch() {
    if (!this.canSendIndex()) return;
    const targets = this.state.index.selected;
    if (!targets.length || targets.length > indexTargetLimit || !targets.every(target => this.state.index.versions.items.some(item =>
      item.id === target.versionId && item.hash === target.versionHash && item.state === 'reviewed'))) return;
    const opId = crypto.randomUUID();
    await this.sendIndex({ kind: 'create', batchId: opId, payload: { opId, targets: structuredClone(targets) } });
  }
  async controlIndexBatch(id: string, kind: 'stop' | 'resume') {
    if (!this.canSendIndex()) return;
    const batch = this.state.index.batches.items.find(item => item.id === id);
    if (!batch || kind === 'stop' && batch.state !== 'running' || kind === 'resume' && !['paused', 'interrupted'].includes(batch.state)) return;
    await this.sendIndex({ kind, batchId: id, payload: { opId: crypto.randomUUID(), expectedControlVersion: batch.controlVersion } });
  }
  private withIndexBatch(batch: AdminIndexBatch) {
    return { ...this.state.index.batches, items: [batch, ...this.state.index.batches.items.filter(item => item.id !== batch.id)] };
  }
  private async sendIndex(command: AdminIndexPending) {
    const generation = this.generation;
    this.updateIndex({ busy: true, pending: command, notice: null });
    try {
      const path = '/admin/knowledge-index-batches' + (command.kind === 'create' ? '' : '/' + encodeURIComponent(command.batchId) + '/' + command.kind);
      const { batch } = adminIndexBatchReplySchema.parse(await this.request<unknown>(path, command.payload));
      if (!this.indexCurrent(generation)) return;
      if (!batch || batch.id !== command.batchId) throw new Error('Invalid index batch reply');
      if (command.kind === 'create' && (batch.targets.length !== command.payload.targets.length || !command.payload.targets.every(target =>
        batch.targets.some(value => value.versionId === target.versionId && value.versionHash === target.versionHash)))
        || command.kind !== 'create' && batch.controlVersion <= command.payload.expectedControlVersion) throw new Error('Invalid index batch binding');
      this.updateIndex({ batches: this.withIndexBatch(batch), pending: null, notice: '操作已確認。批次狀態及逐項結果如下；索引處理不等於知識發布。',
        ...(command.kind === 'create' ? { selected: [] } : {}) });
    } catch (error) {
      if (!this.indexCurrent(generation) || this.indexAccessError(error)) return;
      const rejected = error instanceof AdminApiError && [400, 404, 409, 413, 415, 422, 428, 429].includes(error.status);
      this.updateIndex({ pending: rejected ? null : command, notice: rejected ? adminError(error)
        : '索引操作結果未知；先查回批次，再明確重送同一操作。原操作 ID、版本 hash 及控制版本已保留。' });
    } finally { if (generation === this.generation) this.updateIndex({ busy: false }); }
  }
  async refreshIndexBatch(id: string) {
    const index = this.state.index;
    if (this.state.access !== 'allowed' || !index.open || index.busy || index.batches.status === 'loading'
      || !index.batches.items.some(batch => batch.id === id) && index.pending?.batchId !== id) return;
    const generation = this.generation;
    this.updateIndex({ busy: true, notice: null });
    try {
      const { batch } = adminIndexBatchReplySchema.parse(await this.request<unknown>('/admin/knowledge-index-batches/' + encodeURIComponent(id)));
      if (!this.indexCurrent(generation)) return;
      if (batch && batch.id !== id) throw new Error('Invalid index batch reply');
      this.updateIndex({ batches: batch ? this.withIndexBatch(batch) : { ...this.state.index.batches, items: this.state.index.batches.items.filter(item => item.id !== id) },
        notice: this.state.index.pending?.batchId === id ? (batch ? '已讀回批次狀態；原操作結果仍待確認，請以原 ID 及原內容重送。'
          : '暫未查到這個批次；原操作仍保留，可查回或明確重送同一操作。') : batch ? '已讀回最新批次狀態。' : '未查到這個批次。' });
    } catch (error) { if (this.indexCurrent(generation) && !this.indexAccessError(error)) this.updateIndex({ notice: adminError(error) }); }
    finally { if (generation === this.generation) this.updateIndex({ busy: false }); }
  }
  recoverIndexOperation = async () => { const pending = this.state.index.pending; if (pending) await this.refreshIndexBatch(pending.batchId); };
  retryIndexOperation = async () => { const pending = this.state.index.pending; if (pending && this.canSendIndex(true)) await this.sendIndex(pending); };
  load = (day: string) => this.read(async () => {
    const [overview, invitations, usage, audit] = await Promise.all([
      this.request<AdminOverview>('/admin/policy'), this.request<AdminPage<AdminInvitation>>('/admin/invitations'),
      this.request<AdminState['usage']>('/admin/usage?day=' + encodeURIComponent(day)), this.request<AdminPage<AdminReceipt>>('/admin/audit')]);
    return { overview, invitations, usage, audit };
  });
  lookup = (email: string) => this.read(async () => ({ lookup: (await this.request<{ invitation: AdminInvitation | null }>('/admin/invitation?email=' + encodeURIComponent(email))).invitation }));
  more = (kind: 'invitations' | 'audit') => this.read(async () => {
    const cursor = this.state[kind].nextCursor; if (!cursor) return {};
    const page = await this.request<AdminPage<any>>('/admin/' + kind + '?cursor=' + encodeURIComponent(cursor));
    const merged = [...this.state[kind].items, ...page.items]; return { [kind]: { items: merged, nextCursor: page.nextCursor } };
  });
  async submit(command: AdminCommand) {
    if (this.state.access !== 'allowed' || this.state.busy || this.state.pending || this.state.index.busy || this.state.index.pending) return;
    const generation = this.generation; this.update({ busy: true, pending: command, notice: null, receipt: null });
    try { const receipt = await this.request<AdminReceipt>('/admin/operations', command);
      if (generation === this.generation) this.update({ pending: null, receipt, notice: '已保存。請重新讀取核對目前狀態。' });
    } catch (error) {
      if (generation === this.generation) {
        const rejected = error instanceof AdminApiError && [400,401,403,404,409,413,415,422,428,429].includes(error.status);
        this.update({ pending: rejected ? null : command, notice: rejected ? adminError(error) : '提交結果未知；請先查回原操作，不要另建操作。' });
      }
    } finally { if (generation === this.generation) this.update({ busy: false }); }
  }
  recover = () => this.read(async () => {
    const command = this.state.pending; if (!command) return {};
    const result = await this.request<{ receipt: AdminReceipt | null }>('/admin/operations/' + command.opId);
    if (result.receipt) return { pending: null, receipt: result.receipt, notice: '原操作已保存，沒有重做。' };
    return { notice: '暫未查到收據。可再次查回，或明確重送同一操作；不會建立新操作 ID。' };
  });
  async retryOriginal() {
    const command = this.state.pending; if (!command || this.state.busy) return;
    this.update({ pending: null }); await this.submit(command);
  }
}
