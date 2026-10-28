import { HandoverApiError, type HandoverApi } from '../../../src/client/handover-api.ts';
import { handoverExportCommandSchema, type HandoverExportCommand, type HandoverExportView } from '../../../src/shared/handover-jobs.ts';

type Pending = { kind: 'create'; command: HandoverExportCommand; checked: boolean }
  | { kind: 'cancel'; id: string; command: { opId: string; expectedVersion: number }; checked: boolean };
export interface HandoverState {
  userId: string | null; identityKey: string | null; online: boolean; loaded: boolean;
  items: HandoverExportView[]; nextCursor: string | null; pending: Pending | null;
  busy: 'read' | 'write' | 'check' | 'download' | null; notice: string | null;
}
const empty = (userId: string | null, identityKey: string | null, online: boolean): HandoverState => ({
  userId, identityKey, online, loaded: false, items: [], nextCursor: null, pending: null, busy: null, notice: null,
});
export function handoverErrorText(error: unknown) {
  const code = error instanceof HandoverApiError ? error.code : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    export_scope_changed: '資料已變更，請重新選擇範圍建立資料包。', package_scope_unavailable: '所選資料目前不可使用。',
    package_service_unavailable: '資料包服務暫時未能使用，請稍後再試。', package_size_exceeded: '資料超出此批處理容量，請減少所選範圍。',
    package_object_unknown: '檔案保存結果尚未確認，請查回原檔案。', package_download_incomplete: '下載未完整，請重新下載同一份資料包。',
    package_download_invalid: '下載資料不完整或已變更，請重新讀取狀態。', package_restored: '這份暫存資料包已失效，請重新建立。',
    version_conflict: '狀態已改變，請重新讀取後再操作。', session_changed: '登入狀態已改變，請重新登入。',
    identity_changed: '登入狀態已改變，請重新登入。', unauthorized: '請重新登入。', access_denied: '目前沒有權限讀取這份資料。',
    forbidden: '所選資料目前不可匯出，請重新選擇。',
  };
  return messages[code ?? ''] ?? '暫時未能完成，請核對連線後查回原結果。';
}
type Ticket = { epoch: number; userId: string; controller: AbortController };
/** Identity-scoped coordination only; Server owns authorization, export contents and job states. */
export class HandoverOwner {
  private state = empty(null, null, false); private epoch = 0; private active: AbortController | null = null;
  private listeners = new Set<() => void>();
  private readonly api: HandoverApi; private readonly accessError: (error: HandoverApiError) => void;
  constructor(api: HandoverApi, accessError: (error: HandoverApiError) => void = () => {}) { this.api = api; this.accessError = accessError; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<HandoverState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  syncContext(userId: string | null, identityKey: string | null, online: boolean) {
    if (userId !== this.state.userId || identityKey !== this.state.identityKey) {
      this.epoch++; this.active?.abort(); this.active = null; this.api.setIdentity(null); this.api.setIdentity(userId);
      this.state = empty(userId, identityKey, online); this.update({});
    } else if (online !== this.state.online) this.update({ online });
  }
  private begin(busy: NonNullable<HandoverState['busy']>): Ticket | null {
    if (!this.state.userId || !this.state.identityKey || !this.state.online || this.state.busy) return null;
    const controller = new AbortController(); this.active = controller; this.update({ busy, notice: null });
    return { epoch: this.epoch, userId: this.state.userId, controller };
  }
  private current(t: Ticket) { return t.epoch === this.epoch && t.userId === this.state.userId && !t.controller.signal.aborted; }
  private finish(t: Ticket) { if (this.active === t.controller) { this.active = null; this.update({ busy: null }); } }
  private error(t: Ticket, error: unknown) {
    if (!this.current(t)) return;
    if (error instanceof HandoverApiError && (error.status === 401 || ['identity_changed', 'session_changed'].includes(error.code))) {
      this.syncContext(null, null, this.state.online); this.accessError(error); return;
    }
    this.update({ notice: handoverErrorText(error) });
    if (error instanceof HandoverApiError && [401, 403].includes(error.status)) {
      this.update({ items: [], loaded: false }); this.accessError(error);
    }
  }
  private put(row: HandoverExportView) { this.update({ items: this.state.items.some(x => x.id === row.id)
    ? this.state.items.map(x => x.id === row.id ? row : x) : [row, ...this.state.items] }); }
  load = async (more = false) => {
    const cursor = more ? this.state.nextCursor : null; if (more && !cursor) return;
    const t = this.begin('read'); if (!t) return;
    try {
      const next = await this.api.list(t.userId, t.controller.signal, cursor ?? undefined);
      if (this.current(t)) this.update({ items: more ? [...this.state.items, ...next.items.filter(x => !this.state.items.some(y => x.id === y.id))] : next.items,
        nextCursor: next.nextCursor, loaded: true });
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  refresh = async (id: string, reconcile = false) => {
    const t = this.begin('read'); if (!t) return;
    try { const row = await this.api[reconcile ? 'reconcile' : 'get'](t.userId, id, t.controller.signal); if (this.current(t)) this.put(row); }
    catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  create = async (selection: HandoverExportCommand['selection'], purpose: HandoverExportCommand['purpose']) => {
    if (this.state.pending || this.state.busy || !this.state.online || !this.state.userId) return;
    const parsed = handoverExportCommandSchema.safeParse({ opId: crypto.randomUUID(), purpose, selection });
    if (!parsed.success) { this.update({ notice: '請選擇孩子及要加入的資料。' }); return; }
    this.update({ pending: { kind: 'create', command: parsed.data, checked: true } }); await this.retryOriginal();
  };
  cancel = async (id: string) => {
    const row = this.state.items.find(x => x.id === id);
    if (!row || this.state.pending || this.state.busy || !this.state.online || ['cancelled', 'expired'].includes(row.state)) return;
    this.update({ pending: { kind: 'cancel', id, command: { opId: crypto.randomUUID(), expectedVersion: row.version }, checked: true } }); await this.retryOriginal();
  };
  retryOriginal = async () => {
    const pending = this.state.pending; if (!pending?.checked) return;
    const t = this.begin('write'); if (!t) return;
    this.update({ pending: { ...pending, checked: false } });
    try {
      const row = pending.kind === 'create' ? await this.api.create(t.userId, pending.command, t.controller.signal)
        : await this.api.cancel(t.userId, pending.id, pending.command, t.controller.signal);
      if (this.current(t)) { this.put(row); this.update({ pending: null }); }
    } catch (e) {
      if (this.current(t) && e instanceof HandoverApiError && (['invalid_input', 'version_conflict', 'package_period_not_connected', 'package_scope_unavailable'].includes(e.code)
        || pending.kind === 'create' && e.status === 403 && e.code === 'forbidden')) this.update({ pending: null });
      this.error(t, e);
    } finally { this.finish(t); }
  };
  checkOriginal = async () => {
    const pending = this.state.pending; if (!pending) return;
    const t = this.begin('check'); if (!t) return;
    try {
      const row = await this.api.get(t.userId, pending.kind === 'create' ? pending.command.opId : pending.id, t.controller.signal);
      if (this.current(t)) { this.put(row); this.update({ pending: pending.kind === 'create' || ['cancelled', 'expired'].includes(row.state) ? null : { ...pending, checked: true } }); }
    } catch (e) {
      if (this.current(t) && pending.kind === 'create' && e instanceof HandoverApiError && e.status === 404) this.update({ pending: { ...pending, checked: true }, notice: '目前未找到原請求，可用同一編號再提交。' });
      else this.error(t, e);
    } finally { this.finish(t); }
  };
  download = async (id: string, save: (response: Response, filename: string, bytes: number, current: () => boolean) => Promise<string>) => {
    const t = this.begin('download'); if (!t) return;
    try {
      const row = await this.api.get(t.userId, id, t.controller.signal); if (!this.current(t)) return; this.put(row);
      if (row.state !== 'ready' || row.bytes === null) { this.update({ notice: row.error ? handoverErrorText(new HandoverApiError(409, row.error)) : '資料包尚未可下載，請查看目前狀態。' }); return; }
      const notice = await this.api.download(t.userId, id, row.bytes, t.controller.signal,
        (response, current) => save(response, `育有方資料包-${id}.zip`, row.bytes!, () => this.current(t) && current()));
      if (this.current(t)) this.update({ notice });
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  dispose() { this.syncContext(null, null, false); this.listeners.clear(); }
}
