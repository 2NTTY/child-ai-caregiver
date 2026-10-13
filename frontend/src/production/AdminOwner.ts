import type { AdminCommand, AdminInvitation, AdminOverview, AdminPage, AdminReceipt, AdminUsage } from '../../../src/shared/admin.ts';
export class AdminApiError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super('Admin request failed'); this.status = status; this.code = code; }
}
export interface AdminState { userId: string | null; access: 'unread' | 'loading' | 'allowed' | 'denied' | 'error'; busy: boolean;
  overview: AdminOverview | null; invitations: AdminPage<AdminInvitation>; audit: AdminPage<AdminReceipt>;
  usage: { platform: AdminUsage; personal: AdminUsage } | null; lookup: AdminInvitation | null | undefined;
  pending: AdminCommand | null; notice: string | null; receipt: AdminReceipt | null }
const empty = (userId: string | null): AdminState => ({ userId, access: 'unread', busy: false, overview: null,
  invitations: { items: [], nextCursor: null }, audit: { items: [], nextCursor: null }, usage: null, lookup: undefined,
  pending: null, notice: null, receipt: null });
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
      const response = await this.fetcher(this.baseUrl.replace(/\/$/, '') + path, { method: body === undefined ? 'GET' : 'POST',
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
    try { const result = await this.request<{ administrator: boolean }>('/admin/session'); if (generation === this.generation) this.update({ access: result.administrator ? 'allowed' : 'denied' }); }
    catch (error) { if (generation === this.generation) this.update({ access: 'error', notice: adminError(error) }); }
  }
  private async read(action: () => Promise<Partial<AdminState>>) {
    if (this.state.access !== 'allowed' || this.state.busy) return;
    const generation = this.generation; this.update({ busy: true, notice: null });
    try { const next = await action(); if (generation === this.generation) this.update(next); }
    catch (error) { if (generation === this.generation) this.update({ notice: adminError(error), ...(error instanceof AdminApiError && [401,403,409].includes(error.status) ? { access: 'error' as const, overview: null, invitations: { items: [], nextCursor: null }, audit: { items: [], nextCursor: null }, usage: null, lookup: undefined } : {}) }); }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
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
    if (this.state.access !== 'allowed' || this.state.busy || this.state.pending) return;
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
