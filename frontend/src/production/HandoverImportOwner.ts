import { HandoverApiError, type HandoverApi } from '../../../src/client/handover-api.ts';
import { handoverImportCommandSchema, type HandoverImportCommand, type HandoverImportView,
  type HandoverImportResult, type HandoverImportResultQuery } from '../../../src/shared/handover-imports.ts';
import { handoverUploadCommandSchema, type HandoverUploadCommand, type HandoverUploadView } from '../../../src/shared/handover-uploads.ts';
import { handoverErrorText } from './HandoverOwner.ts';

export interface SelectedPackage { filename: string; bytes: number; sha256: string; body: BodyInit; release(): void }
type Control = { opId: string; expectedVersion: number };
type UploadSummary = Omit<HandoverUploadView, 'preview'>;
type Pending = ({ kind: 'reserve'; command: HandoverUploadCommand } | { kind: 'upload'; id: string }
  | { kind: 'create'; command: HandoverImportCommand }
  | { kind: 'cancel' | 'resume' | 'discard'; id: string; command: Control }) & { checked: boolean; rejected?: boolean };
export interface HandoverImportResultsState {
  batchId: string; sourceChildId: string; module: HandoverImportResultQuery['module']; revision: number;
  items: HandoverImportResult[]; nextCursor: string | null; loaded: boolean; error: string | null;
}
export interface HandoverImportState {
  userId: string | null; identityKey: string | null; online: boolean; loaded: boolean;
  upload: HandoverUploadView | null; items: HandoverImportView[]; nextCursor: string | null;
  uploads: UploadSummary[]; uploadsLoaded: boolean; uploadsCursor: string | null;
  results: HandoverImportResultsState | null;
  busy: 'pick' | 'read' | 'write' | 'check' | null; pending: Pending | null; notice: string | null;
}
const empty = (userId: string | null, identityKey: string | null, online: boolean): HandoverImportState => ({
  userId, identityKey, online, loaded: false, upload: null, items: [], nextCursor: null,
  uploads: [], uploadsLoaded: false, uploadsCursor: null, results: null, busy: null, pending: null, notice: null });
type Ticket = { epoch: number; userId: string; controller: AbortController };
/** Device drafts only; uploaded packages, import authority and progress remain on the Server. */
export class HandoverImportOwner {
  private state = empty(null, null, false); private epoch = 0; private active: AbortController | null = null;
  private file: SelectedPackage | null = null; private listeners = new Set<() => void>();
  private resultsTicket: Ticket | null = null; private resultsRevision = 0;
  private api: HandoverApi; private accessError: (error: HandoverApiError) => void;
  constructor(api: HandoverApi, accessError: (error: HandoverApiError) => void = () => {}) { this.api = api; this.accessError = accessError; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<HandoverImportState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private release() { const file = this.file; this.file = null; try { file?.release(); } catch { /* Local cache expiry also cleans crash leftovers. */ } }
  syncContext(userId: string | null, identityKey: string | null, online: boolean) {
    if (userId !== this.state.userId || identityKey !== this.state.identityKey) {
      this.epoch++; this.active?.abort(); this.active = null; this.release(); this.api.setIdentity(null); this.api.setIdentity(userId);
      this.resultsTicket = null; this.resultsRevision++;
      this.state = empty(userId, identityKey, online); this.update({});
    } else this.update({ online });
  }
  private begin(busy: NonNullable<HandoverImportState['busy']>): Ticket | null {
    if (!this.state.userId || !this.state.identityKey || !this.state.online || this.state.busy) return null;
    const controller = new AbortController(); this.active = controller; this.update({ busy, notice: null });
    return { epoch: this.epoch, userId: this.state.userId, controller };
  }
  private current(t: Ticket) { return t.epoch === this.epoch && t.userId === this.state.userId && !t.controller.signal.aborted; }
  private finish(t: Ticket) { if (this.active === t.controller) { this.active = null; this.update({ busy: null }); } }
  private error(t: Ticket, error: unknown) {
    if (!this.current(t)) return;
    if (error instanceof HandoverApiError && (error.status === 401 || ['session_changed', 'identity_changed'].includes(error.code))) {
      this.syncContext(null, null, this.state.online); this.accessError(error); return;
    }
    this.update({ notice: importErrorText(error) });
    if (error instanceof HandoverApiError && error.status === 403) { this.release(); this.update({ upload: null, items: [], loaded: false, uploads: [], uploadsLoaded: false, uploadsCursor: null, results: null, pending: null }); this.accessError(error); }
  }
  private put(row: HandoverImportView) { this.update({ items: this.state.items.some(x => x.id === row.id)
    ? this.state.items.map(x => x.id === row.id ? row : x) : [row, ...this.state.items] }); }
  private putUpload(row: HandoverUploadView) {
    const { preview: _preview, ...summary } = row;
    this.update({ uploads: this.state.uploads.some(x => x.id === row.id)
      ? this.state.uploads.map(x => x.id === row.id ? summary : x) : [summary, ...this.state.uploads] });
  }
  loadUploads = async (more = false) => {
    const cursor = more ? this.state.uploadsCursor : null; if (more && !cursor) return;
    const t = this.begin('read'); if (!t) return;
    try { const page = await this.api.listUploads(t.userId, t.controller.signal, cursor ?? undefined);
      if (this.current(t)) this.update({ uploadsLoaded: true, uploadsCursor: page.nextCursor,
        uploads: more ? [...this.state.uploads, ...page.items.filter(x => !this.state.uploads.some(y => x.id === y.id))] : page.items });
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  openUpload = async (id: string) => {
    if (this.state.pending || this.file) return;
    const t = this.begin('read'); if (!t) return;
    if (this.state.upload?.id !== id) this.update({ upload: null });
    try { const row = await this.api.getUpload(t.userId, id, t.controller.signal);
      if (this.current(t)) { this.putUpload(row); this.update({ upload: row }); }
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  leaveUpload = () => {
    if (!this.state.pending && !this.state.busy && !this.file) this.update({ upload: null });
  };
  load = async (more = false) => {
    const cursor = more ? this.state.nextCursor : null; if (more && !cursor) return;
    const t = this.begin('read'); if (!t) return;
    try { const page = await this.api.listImports(t.userId, t.controller.signal, cursor ?? undefined);
      if (this.current(t)) this.update({ loaded: true, nextCursor: page.nextCursor,
        items: more ? [...this.state.items, ...page.items.filter(x => !this.state.items.some(y => x.id === y.id))] : page.items });
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  refresh = async (id: string) => {
    const t = this.begin('read'); if (!t) return;
    try { const row = await this.api.getImport(t.userId, id, t.controller.signal); if (this.current(t)) this.put(row); }
    catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  private stopResultsRead() {
    const ticket = this.resultsTicket; this.resultsTicket = null;
    if (ticket) {
      ticket.controller.abort();
      if (this.active === ticket.controller) { this.active = null; this.update({ busy: null }); }
    }
  }
  selectResults = (batchId: string, sourceChildId: string, module: HandoverImportResultQuery['module']) => {
    if (this.state.pending || this.state.busy && !this.resultsTicket) return;
    const batch = this.state.items.find(row => row.id === batchId);
    if (!batch?.targets.some(target => target.sourceChildId === sourceChildId && target.sections.includes(module))) return;
    this.stopResultsRead();
    this.update({ results: { batchId, sourceChildId, module, revision: ++this.resultsRevision,
      items: [], nextCursor: null, loaded: false, error: null } });
  };
  closeResults = () => {
    if (this.state.busy && !this.resultsTicket) return;
    this.stopResultsRead(); this.update({ results: null });
  };
  readResults = async (more = false) => {
    const previous = this.state.results; if (!previous || more && !previous.nextCursor) return;
    const t = this.begin('read'); if (!t) return;
    const results = more ? { ...previous, error: null } : { ...previous, revision: ++this.resultsRevision,
      items: [], nextCursor: null, loaded: false, error: null };
    this.resultsTicket = t; this.update({ results });
    try {
      const page = await this.api.importResults(t.userId, results.batchId, { sourceChildId: results.sourceChildId, module: results.module,
        ...(more ? { cursor: previous.nextCursor! } : {}) }, t.controller.signal);
      if (!this.current(t) || this.state.results?.revision !== results.revision) return;
      if (page.batchId !== results.batchId || page.sourceChildId !== results.sourceChildId || page.module !== results.module)
        throw new HandoverApiError(409, 'import_results_changed');
      this.update({ results: { ...results, loaded: true, nextCursor: page.nextCursor,
        items: more ? [...results.items, ...page.items.filter(row => !results.items.some(item => item.id === row.id))] : page.items } });
    } catch (error) {
      if (this.current(t) && this.state.results?.revision === results.revision) {
        this.update({ results: { ...results, error: importErrorText(error), nextCursor: null,
          items: [], loaded: false, revision: ++this.resultsRevision } });
        this.error(t, error);
      }
    } finally { if (this.resultsTicket === t) this.resultsTicket = null; this.finish(t); }
  };
  resolveResults = async (mode: 'replace_current' | 'restore_deleted', ids: string[]) => {
    const results = this.state.results, original = this.state.items.find(row => row.id === results?.batchId);
    if (this.state.pending || this.state.busy || !results?.loaded || results.error || !original
      || !['completed', 'cancelled', 'failed'].includes(original.state) || !ids.length || new Set(ids).size !== ids.length) return;
    const rows = ids.map(id => results.items.find(row => row.id === id));
    if (rows.some(row => !row || row.sourceSection !== null || row.outcome !== 'conflict' || row.availableResolution !== mode || !row.currentResource
      || row.batchId !== results.batchId || row.sourceChildId !== results.sourceChildId || row.module !== results.module)) return;
    const resolutions: HandoverImportCommand['resolutions'] = rows.map(row => ({ sourceChildId: row!.sourceChildId, section: row!.module,
      resourceId: row!.sourceResourceId, resolution: { mode, targetId: row!.currentResource!.id, expectedVersion: row!.currentResource!.version } }));
    const t = this.begin('read'); if (!t) return; let submit = false;
    try {
      const batch = await this.api.getImport(t.userId, original.id, t.controller.signal);
      if (!this.current(t)) return; this.put(batch);
      if (!['completed', 'cancelled', 'failed'].includes(batch.state)) throw new HandoverApiError(409, 'import_resolution_not_available');
      if (batch.manifestSha256 !== original.manifestSha256 || batch.uploadId !== original.uploadId
        || JSON.stringify(batch.targets) !== JSON.stringify(original.targets)) throw new HandoverApiError(409, 'import_results_changed');
      const upload = await this.api.getUpload(t.userId, batch.uploadId, t.controller.signal);
      if (!this.current(t)) return;
      if (upload.state !== 'ready' || !upload.preview) throw new HandoverApiError(409, upload.state === 'expired' ? 'package_expired' : 'package_upload_not_ready');
      if (upload.preview.manifestSha256 !== batch.manifestSha256 || upload.preview.header.packageId !== batch.packageId
        || upload.preview.header.packageVersion !== batch.packageVersion) throw new HandoverApiError(409, 'import_source_changed');
      const command = handoverImportCommandSchema.parse({ opId: crypto.randomUUID(), uploadId: batch.uploadId, expectedUploadVersion: upload.version,
        acceptedManifestSha256: batch.integrity === 'trusted' ? null : batch.manifestSha256, targets: batch.targets, resolutions, resolutionOnly: true });
      this.update({ pending: { kind: 'create', command, checked: true }, results: null }); submit = true;
    } catch (error) { this.error(t, error); } finally { this.finish(t); }
    if (submit && this.current(t)) await this.retryOriginal();
  };
  choose = async (pick: (signal: AbortSignal) => Promise<SelectedPackage | null>) => {
    if (this.state.pending || this.state.upload) return;
    const t = this.begin('pick'); if (!t) return;
    try {
      const file = await pick(t.controller.signal); if (!file) return;
      if (!this.current(t)) { file.release(); return; }
      this.file = file;
      const command = handoverUploadCommandSchema.safeParse({ opId: crypto.randomUUID(), filename: file.filename, bytes: file.bytes, sha256: file.sha256 });
      if (!command.success) { this.release(); throw new HandoverApiError(400, 'invalid_package_file'); }
      this.update({ pending: { kind: 'reserve', command: command.data, checked: true } });
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
    if (this.current(t)) await this.retryOriginal();
  };
  create = async (targets: HandoverImportCommand['targets'], acceptUntrusted: boolean) => {
    const upload = this.state.upload; if (this.state.pending || this.state.busy || !upload?.preview || upload.state !== 'ready') return;
    if (upload.preview.integrity !== 'trusted' && !acceptUntrusted) { this.update({ notice: '資料包沒有可信簽章；如要繼續，請勾選知悉此狀態。' }); return; }
    const parsed = handoverImportCommandSchema.safeParse({ opId: crypto.randomUUID(), uploadId: upload.id, expectedUploadVersion: upload.version,
      acceptedManifestSha256: upload.preview.integrity === 'trusted' ? null : upload.preview.manifestSha256, targets, resolutions: [] });
    if (!parsed.success) { this.update({ notice: '請選擇來源孩子、接收對象及要匯入的模組。' }); return; }
    this.update({ pending: { kind: 'create', command: parsed.data, checked: true } }); await this.retryOriginal();
  };
  control = async (id: string, kind: 'cancel' | 'resume') => {
    const row = this.state.items.find(x => x.id === id); if (!row || this.state.pending || this.state.busy) return;
    this.update({ pending: { kind, id, command: { opId: crypto.randomUUID(), expectedVersion: row.version }, checked: true } }); await this.retryOriginal();
  };
  discard = async () => {
    const row = this.state.upload; if (!row || this.state.pending || this.state.busy) return;
    this.update({ pending: { kind: 'discard', id: row.id, command: { opId: crypto.randomUUID(), expectedVersion: row.version }, checked: true } }); await this.retryOriginal();
  };
  retryOriginal = async () => {
    const p = this.state.pending; if (!p?.checked) return;
    const t = this.begin('write'); if (!t) return; this.update({ pending: { ...p, checked: false } });
    let continueUpload = false;
    try {
      if (p.kind === 'reserve') {
        const row = await this.api.reserveUpload(t.userId, p.command, t.controller.signal);
        if (this.current(t)) { this.putUpload(row); this.update({ upload: row, pending: row.state === 'reserved' ? { kind: 'upload', id: row.id, checked: true } : null }); continueUpload = row.state === 'reserved'; }
      } else if (p.kind === 'upload') {
        if (!this.file) throw new HandoverApiError(400, 'package_local_file_missing');
        const row = await this.api.uploadContent(t.userId, p.id, this.file.body, t.controller.signal);
        if (this.current(t)) { this.release(); this.putUpload(row); this.update({ upload: row, pending: null }); }
      } else if (p.kind === 'discard') {
        const row = await this.api.cancelUpload(t.userId, p.id, p.command, t.controller.signal);
        if (this.current(t)) { this.release(); this.putUpload(row); this.update({ upload: null, pending: null }); }
      } else {
        const row = p.kind === 'create' ? await this.api.createImport(t.userId, p.command, t.controller.signal)
          : await this.api[p.kind === 'cancel' ? 'cancelImport' : 'resumeImport'](t.userId, p.id, p.command, t.controller.signal);
        if (this.current(t)) { this.put(row); this.update({ pending: null, ...(p.kind === 'create' ? { upload: null } : {}) }); }
      }
    } catch (e) {
      if (this.current(t) && e instanceof HandoverApiError) {
        if (e.code === 'version_conflict') this.update({ pending: { ...p, checked: false, rejected: true } });
        else if (p.kind !== 'upload' && [400, 403, 404].includes(e.status)) {
          this.update({ pending: null }); if (p.kind === 'reserve') this.release();
        }
      }
      this.error(t, e);
    } finally { this.finish(t); }
    if (continueUpload && this.current(t)) await this.retryOriginal();
  };
  checkOriginal = async () => {
    const p = this.state.pending; if (!p) return;
    const t = this.begin('check'); if (!t) return;
    try {
      if (p.kind === 'reserve' || p.kind === 'upload' || p.kind === 'discard') {
        const row = await this.api.getUpload(t.userId, p.kind === 'reserve' ? p.command.opId : p.id, t.controller.signal);
        if (!this.current(t)) return;
        this.putUpload(row);
        if (p.rejected) { this.update({ upload: row, pending: null }); if (row.state !== 'reserved') this.release(); }
        else if (['ready', 'failed', 'cancelled', 'expired'].includes(row.state)) {
          this.release(); this.update({ upload: p.kind === 'discard' && ['cancelled', 'expired'].includes(row.state) ? null : row,
            pending: p.kind === 'discard' && !['cancelled', 'expired'].includes(row.state) ? { ...p, checked: true } : null });
        } else this.update({ upload: row, pending: p.kind === 'discard' ? { ...p, checked: true }
          : { kind: 'upload', id: row.id, checked: row.state === 'reserved' } });
      } else {
        const row = await this.api.getImport(t.userId, p.kind === 'create' ? p.command.opId : p.id, t.controller.signal);
        if (this.current(t)) { this.put(row); this.update({ pending: p.kind === 'create' || p.rejected ? null : { ...p, checked: true }, ...(p.kind === 'create' ? { upload: null } : {}) }); }
      }
    } catch (e) {
      if (this.current(t) && ['reserve', 'create'].includes(p.kind) && e instanceof HandoverApiError && e.status === 404)
        this.update({ pending: { ...p, checked: true }, notice: '未找到原請求，可繼續同一編號；不會另建批次。' });
      else if (this.current(t) && ['upload', 'discard'].includes(p.kind) && e instanceof HandoverApiError && e.status === 404) {
        this.release(); this.update({ pending: null, upload: null, notice: '原上載已不可使用，可以重新選取資料包。' });
      }
      else this.error(t, e);
    } finally { this.finish(t); }
  };
  dispose() { this.syncContext(null, null, false); this.listeners.clear(); }
}
export function importErrorText(error: unknown) {
  const code = error instanceof HandoverApiError ? error.code : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    invalid_package_file: '請選擇不超過 256 MiB 的 ZIP 資料包。', package_local_file_missing: '本機檔案已不在，請取消此上載後重新選取。',
    package_native_size_exceeded: '手機目前可上載最多 20 MiB；較大的資料包請用 Web 匯入。', package_local_cache_full: '本機暫存檔案已滿，請稍後再試。',
    package_section_not_connected: '所選資料含尚未接通的類型，沒有繼續匯入；請查看批次結果。',
    package_signature_invalid: '資料包簽章不符，請向來源重新取得。', package_hash_mismatch: '資料包內容校驗不符，請重新取得。',
    package_integrity_failed: '資料包完整性驗證失敗，請向來源重新取得；不能略過此錯誤匯入。',
    package_upload_capacity: '暫存資料包已滿，請取消不再使用的上載或稍後再試。',
    package_upload_not_ready: '資料包仍在處理，請查回原上載結果。', package_upload_stopped: '這份上載已停止，請重新選取資料包。',
    package_expired: '上載的資料包已到期，請重新選取。', package_upload_limit: '暫存資料包已滿，請取消不再使用的上載或稍後再試。',
    invalid_cursor: '列表已變更，請重新讀取第一頁。', invalid_package_cursor: '匯入續讀位置無效，請查看原批次。',
    invalid_import_cursor: '逐項結果已變更，請重新讀取第一頁。', import_results_changed: '逐項結果或接收範圍已變更，請重新讀取。',
    import_resolution_not_available: '原批次仍在執行或不能處理衝突，請先查看其最新狀態。',
    import_source_changed: '原資料包與批次不一致，不能用來處理這些衝突。',
  };
  return messages[code] ?? handoverErrorText(error);
}
