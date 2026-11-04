import { HandoverApiError, originalComparisonItemKey, type HandoverApi, type ClassImportEnrolments, type HandoverSourceHistoryQuery, type HandoverSourceHistoryPage,
  type SelfAvatarComparison, type SelfAvatarComparisonQuery } from '../../../src/client/handover-api.ts';
import { handoverImportCommandSchema, handoverImportModuleOf, originalBackupModuleSchema, type HandoverImportModule, type HandoverImportResourceSection, type HandoverImportCommand, type HandoverImportView,
  type HandoverImportResult, type HandoverImportResultQuery } from '../../../src/shared/handover-imports.ts';
import type { HandoverImportSummary, OriginalBackupComparison, OriginalBackupComparisonQuery } from '../../../src/shared/handover-imports.ts';
import { handoverUploadCommandSchema, HANDOVER_UPLOAD_MAX_BYTES, type HandoverUploadCommand, type HandoverUploadView, type HandoverUploadListItem } from '../../../src/shared/handover-uploads.ts';
import { handoverErrorText } from './HandoverOwner.ts';
import { FamilyDocumentApiError, parseFamilyDocumentSnapshot } from '../../../src/client/family-documents-api.ts';
import type { DocumentContentPage, DocumentContentQuery, DocumentSnapshot } from '../../../src/shared/family-documents.ts';

export interface SelectedPackage { filename: string; bytes: number; sha256: string; body: BodyInit; release(): void }
export { originalComparisonItemKey };
export const legacyOriginalModules: OriginalBackupComparisonQuery['module'][] = ['care', 'profile', 'tasks', 'sources'];
export function originalRestoreResourceSection(module: HandoverImportModule,
  item?: Pick<OriginalBackupComparison['items'][number], 'resourceSection'>): HandoverImportResourceSection | null {
  if (module === 'documents') return item?.resourceSection === 'documents' || item?.resourceSection === 'visit_preparation' ? item.resourceSection : null;
  if (module === 'attachments') return item?.resourceSection === 'child_avatar' ? 'child_avatar' : null;
  if (module === 'sources') return 'private_sources';
  return module === 'care' || module === 'profile' || module === 'tasks' || module === 'concerns' ? module : null;
}
export const hasOriginalChildAvatar = (preview: HandoverUploadView['preview'], childId: string) =>
  !!preview?.coverage.some(row => row.childId === childId && row.section === 'child_avatar' && row.items > 0);
export function originalComparisonResolution(item: OriginalBackupComparison['items'][number]) {
  if (!item.targetId || item.localVersion === null) return null;
  return item.state === 'deleted' ? 'restore_deleted' as const
    : ['local_newer','different','backup_newer'].includes(item.state) ? 'replace_current' as const : null;
}
export function accountAvatarComparisonResolution(value: SelfAvatarComparison) {
  return value.state === 'deleted' ? 'restore_deleted' as const
    : value.state === 'missing' || value.state === 'different' ? 'replace_current' as const : null;
}
type Control = { opId: string; expectedVersion: number };
type UploadSummary = HandoverUploadListItem;
type Pending = ({ kind: 'reserve'; command: HandoverUploadCommand } | { kind: 'upload'; id: string }
  | { kind: 'create'; command: HandoverImportCommand }
  | { kind: 'cancel' | 'resume' | 'discard'; id: string; command: Control }) & { checked: boolean; rejected?: boolean };
export interface HandoverImportResultsState {
  batchId: string; sourceChildId: string; module: HandoverImportResultQuery['module']; revision: number;
  items: HandoverImportResult[]; nextCursor: string | null; loaded: boolean; error: string | null;
}
export function handoverResultResourceSection(row: HandoverImportResult): HandoverImportResourceSection | null {
  const section = row.resourceSection ?? (row.module === 'care' || row.module === 'profile' || row.module === 'tasks' || row.module === 'concerns' ? row.module : null);
  return section && handoverImportModuleOf(section) === row.module ? section : null;
}
export function canReadHandoverSourceHistory(row: HandoverImportResult) {
  const section = handoverResultResourceSection(row);
  return !!row.recordedResource && (section === 'memory_facts' || section === 'memory_topics' || section === 'summary_history' || section === 'private_sources'
    || section === 'documents' || section === 'visit_preparation' || section === 'concerns' || section === 'growth_attention' || section === 'growth_topics');
}
export function handoverSourceHistoryKey(item: HandoverSourceHistoryPage['items'][number]) {
  const source = item.evidence.source.current.source;
  return JSON.stringify([item.resource.id, item.evidence.module, source.serverId, source.accountId, source.childId, source.section, source.resourceId, source.resourceVersion,
    item.evidence.module === 'documents' ? item.evidence.value.snapshotId : null]);
}
export type HandoverDocumentContentPort = (userId: string, target: { childId: string; spaceId: string | null }, documentId: string,
  query: DocumentContentQuery, signal: AbortSignal) => Promise<DocumentContentPage>;
export interface HandoverDocumentContentState {
  key: string; documentId: string; snapshotId: string; snapshotVersion: number;
  authorityVersion: string | null; documentVersion: number | null; totalCharacters: number | null;
  text: string; nextOffset: number | null; complete: boolean; invalidated: boolean; loading: boolean; error: string | null; snapshot: DocumentSnapshot | null;
}
export interface HandoverSourceHistoryState {
  batchId: string; resultId: string; query: Omit<HandoverSourceHistoryQuery, 'cursor'>; revision: number;
  items: HandoverSourceHistoryPage['items']; page: number; nextCursor: string | null; complete: boolean;
  loaded: boolean; loading: boolean; error: string | null;
  documentContent: HandoverDocumentContentState | null;
}
export interface HandoverImportState {
  originalModules: OriginalBackupComparisonQuery['module'][];
  accountAvatarRestoreEnabled: boolean;
  accountAvatarComparison: { query: SelfAvatarComparisonQuery; manifestSha256: string; value: SelfAvatarComparison | null; error: string | null } | null;
  summary: { batchId: string; status: 'loading' | 'ready' | 'unauthorized' | 'unavailable'; value: HandoverImportSummary | null } | null;
  comparison: { query: Omit<OriginalBackupComparisonQuery, 'cursor'>; manifestSha256: string;
    items: OriginalBackupComparison['items']; selected: string[]; nextCursor: string | null; loaded: boolean; error: string | null } | null;
  panelRequested?: boolean;
  classEnrolmentEnabled: boolean;
  classConcernImportsEnabled: boolean;
  enrolmentResults: ClassImportEnrolments | null;
  userId: string | null; identityKey: string | null; online: boolean; loaded: boolean;
  upload: HandoverUploadView | null; items: HandoverImportView[]; nextCursor: string | null;
  uploads: UploadSummary[]; uploadsLoaded: boolean; uploadsCursor: string | null;
  cleanedUploads: { items: UploadSummary[]; loaded: boolean; loading: boolean; nextCursor: string | null;
    error: { status: number; code: string } | null } | null;
  results: HandoverImportResultsState | null;
  sourceHistory: HandoverSourceHistoryState | null;
  busy: 'pick' | 'read' | 'write' | 'check' | null; pending: Pending | null; notice: string | null;
}
const empty = (userId: string | null, identityKey: string | null, online: boolean): HandoverImportState => ({
  userId, identityKey, online, loaded: false, upload: null, items: [], nextCursor: null, classEnrolmentEnabled: false, classConcernImportsEnabled: false, enrolmentResults: null,
  accountAvatarRestoreEnabled: false, accountAvatarComparison: null,
  originalModules: [...legacyOriginalModules],
  uploads: [], uploadsLoaded: false, uploadsCursor: null, cleanedUploads: null, results: null, sourceHistory: null, summary: null, comparison: null, busy: null, pending: null, notice: null });
type Ticket = { epoch: number; userId: string; controller: AbortController };
/** Device drafts only; uploaded packages, import authority and progress remain on the Server. */
export class HandoverImportOwner {
  private state = empty(null, null, false); private epoch = 0; private active: AbortController | null = null;
  private file: SelectedPackage | null = null; private listeners = new Set<() => void>();
  private resultsTicket: Ticket | null = null; private resultsRevision = 0;
  private historyTicket: Ticket | null = null; private historyRevision = 0;
  private documentTicket: Ticket | null = null;
  private capabilityTicket: Ticket | null = null;
  private comparisonTicket: Ticket | null = null;
  private accountAvatarComparisonTicket: Ticket | null = null;
  private documentPort?: HandoverDocumentContentPort;
  private api: HandoverApi; private accessError: (error: HandoverApiError) => void;
  constructor(api: HandoverApi, accessError: (error: HandoverApiError) => void = () => {}, documentPort?: HandoverDocumentContentPort) { this.api = api; this.accessError = accessError; this.documentPort = documentPort; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  requestPanel = () => { this.update({ panelRequested: true }); };
  panelOpened = () => { this.update({ panelRequested: false }); };
  private update(patch: Partial<HandoverImportState>) {
    if ('upload' in patch && (patch.upload?.id !== this.state.upload?.id || patch.upload?.version !== this.state.upload?.version
      || patch.upload?.preview?.manifestSha256 !== this.state.upload?.preview?.manifestSha256)) this.clearComparison();
    this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn());
  }
  private release() { const file = this.file; this.file = null; try { file?.release(); } catch { /* Local cache expiry also cleans crash leftovers. */ } }
  syncContext(userId: string | null, identityKey: string | null, online: boolean) {
    if (userId !== this.state.userId || identityKey !== this.state.identityKey) {
      this.capabilityTicket?.controller.abort(); this.capabilityTicket = null;
      this.epoch++; this.active?.abort(); this.active = null; this.release(); this.api.setIdentity(null); this.api.setIdentity(userId);
      this.resultsTicket = null; this.resultsRevision++;
      this.historyTicket = null; this.historyRevision++;
      this.documentTicket = null;
      this.comparisonTicket = null;
      this.accountAvatarComparisonTicket = null;
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
    if (error instanceof HandoverApiError && error.status === 403) { this.release(); this.clearComparison(); this.update({ upload: null, items: [], loaded: false, uploads: [], uploadsLoaded: false, uploadsCursor: null, cleanedUploads: null, results: null, sourceHistory: null, enrolmentResults: null, summary: null, pending: null, classConcernImportsEnabled: false }); this.accessError(error); }
  }
  private put(row: HandoverImportView) {
    const previous = this.state.items.find(item => item.id === row.id);
    const changed = this.state.enrolmentResults?.batchId === row.id && previous?.version !== row.version;
    this.update({ items: previous ? this.state.items.map(x => x.id === row.id ? row : x) : [row, ...this.state.items],
      ...(this.state.summary?.batchId === row.id && previous?.version !== row.version ? { summary: null } : {}),
      ...(changed ? { enrolmentResults: null } : {}) });
  }
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
    if (this.state.cleanedUploads?.items.some(row => row.id === id)) {
      this.update({ notice: '這份上載已清理，只保留歷史紀錄，不能再次匯入。' }); return;
    }
    this.clearComparison();
    const t = this.begin('read'); if (!t) return;
    if (this.state.upload?.id !== id) this.update({ upload: null });
    try { const row = await this.api.getUpload(t.userId, id, t.controller.signal);
      if (this.current(t)) { this.putUpload(row); this.update({ upload: row }); }
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  leaveUpload = () => {
    this.clearComparison();
    if (!this.state.pending && !this.state.busy && !this.file) this.update({ upload: null });
  };
  loadCleanedUploads = async (more = false) => {
    if (this.state.pending) return;
    const previous = this.state.cleanedUploads, cursor = more ? previous?.nextCursor : null;
    if (more && !cursor) return;
    const t = this.begin('read'); if (!t) return;
    const history = previous ?? { items: [], loaded: false, loading: false, nextCursor: null, error: null };
    this.update({ cleanedUploads: { ...history, loading: true, error: null } });
    try {
      const page = await this.api.listUploads(t.userId, t.controller.signal, cursor ?? undefined, 'cleaned');
      if (!this.current(t)) return;
      const items = more ? [...history.items, ...page.items.filter(row => !history.items.some(item => item.id === row.id))] : page.items;
      const cleanedIds = new Set(items.map(row => row.id));
      this.update({ cleanedUploads: { items, loaded: true, loading: false, nextCursor: page.nextCursor, error: null },
        uploads: this.state.uploads.filter(row => !cleanedIds.has(row.id)),
        ...(this.state.upload && cleanedIds.has(this.state.upload.id) ? { upload: null } : {}) });
    } catch (error) {
      this.error(t, error);
      if (this.current(t)) this.update({ cleanedUploads: {
        ...(error instanceof HandoverApiError && error.status === 403 ? { items: [], loaded: false, nextCursor: null } : history), loading: false,
        error: { status: error instanceof HandoverApiError ? error.status : 0, code: error instanceof HandoverApiError ? error.code : 'handover_unavailable' } } });
    } finally { if (this.current(t) && this.state.cleanedUploads?.loading)
      this.update({ cleanedUploads: { ...this.state.cleanedUploads, loading: false } }); this.finish(t); }
  };
  load = async (more = false) => {
    const cursor = more ? this.state.nextCursor : null; if (more && !cursor) return;
    const t = this.begin('read'); if (!t) return;
    try { const page = await this.api.listImports(t.userId, t.controller.signal, cursor ?? undefined);
      if (this.current(t)) {
        const before = this.state.items, summary = this.state.summary;
        const items = more ? [...before.map(row => page.items.find(item => item.id === row.id) ?? row),
          ...page.items.filter(row => !before.some(item => item.id === row.id))] : page.items;
        const summaryChanged = summary && (!items.some(row => row.id === summary.batchId)
          || items.find(row => row.id === summary.batchId)?.version !== before.find(row => row.id === summary.batchId)?.version);
        this.update({ loaded: true, nextCursor: page.nextCursor, items,
          ...(!more ? { enrolmentResults: null } : {}), ...(summaryChanged ? { summary: null } : {}) });
      }
    } catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  refresh = async (id: string) => {
    const t = this.begin('read'); if (!t) return;
    try { const row = await this.api.getImport(t.userId, id, t.controller.signal); if (this.current(t)) this.put(row); }
    catch (e) { this.error(t, e); } finally { this.finish(t); }
  };
  readImportCapabilities = async () => {
    if (!this.state.userId || !this.state.identityKey || !this.state.online || this.capabilityTicket) return;
    const t = { userId: this.state.userId, epoch: this.epoch, controller: new AbortController() };
    this.capabilityTicket = t;
    try {
      const value = await this.api.importCapabilities(t.userId, t.controller.signal);
      if (this.current(t)) {
        if (value.accountAvatarRestore !== true) this.clearAccountAvatarComparison();
        const originalModules = value.originalModules ?? [...legacyOriginalModules];
        if (this.state.comparison && !originalModules.includes(this.state.comparison.query.module)) this.clearComparison();
        this.update({ classEnrolmentEnabled: value.classEnrolment, classConcernImportsEnabled: value.classConcernImports === true, accountAvatarRestoreEnabled: value.accountAvatarRestore === true, originalModules });
      }
    } catch (error) {
      if (this.current(t)) {
        this.clearAccountAvatarComparison();
        const originalModules = this.state.originalModules.filter(module => legacyOriginalModules.includes(module));
        if (this.state.comparison && !originalModules.includes(this.state.comparison.query.module)) this.clearComparison();
        this.update({ classEnrolmentEnabled: false, classConcernImportsEnabled: false, accountAvatarRestoreEnabled: false, originalModules });
        if (error instanceof HandoverApiError && ([401, 403].includes(error.status) || ['session_changed', 'identity_changed'].includes(error.code)))
          this.error(t, error);
      }
    } finally { if (this.capabilityTicket === t) this.capabilityTicket = null; }
  };
  readSummary = async (id: string) => {
    const batch = this.state.items.find(row => row.id === id);
    if (!batch || this.state.pending) return;
    const t = this.begin('read'); if (!t) return;
    this.update({ summary: { batchId: id, status: 'loading', value: null } });
    try {
      const value = await this.api.importSummary(t.userId, id, t.controller.signal);
      if (this.current(t) && this.state.items.find(row => row.id === id)?.version === batch.version)
        this.update({ summary: { batchId: id, status: 'ready', value } });
    } catch (error) {
      if (!this.current(t)) return;
      if (error instanceof HandoverApiError && (error.status === 401 || ['session_changed','identity_changed'].includes(error.code))) this.error(t,error);
      else this.update({ summary: { batchId: id, status: error instanceof HandoverApiError && error.status === 403 ? 'unauthorized' : 'unavailable', value: null } });
    } finally { this.finish(t); }
  };
  clearComparison = () => {
    this.clearAccountAvatarComparison();
    const ticket = this.comparisonTicket; this.comparisonTicket = null;
    if (ticket) { ticket.controller.abort(); if (this.active === ticket.controller) { this.active = null; this.update({busy:null}); } }
    if (this.state.comparison) this.update({comparison:null});
  };
  clearAccountAvatarComparison = () => {
    const ticket = this.accountAvatarComparisonTicket; this.accountAvatarComparisonTicket = null;
    if (ticket) { ticket.controller.abort(); if (this.active === ticket.controller) { this.active = null; this.update({ busy: null }); } }
    if (this.state.accountAvatarComparison) this.update({ accountAvatarComparison: null });
  };
  canCompareAccountAvatar = () => {
    const upload = this.state.upload, preview = upload?.preview;
    return !!(this.state.accountAvatarRestoreEnabled && this.state.identityKey && this.state.userId && upload?.state === 'ready'
      && preview && preview.integrity !== 'untrusted_signer' && preview.header.purpose === 'backup' && preview.header.version === 2
      && preview.header.source.accountId === this.state.userId && preview.header.selection.accountAvatar);
  };
  compareAccountAvatar = async () => {
    if (this.state.pending || this.state.busy || !this.canCompareAccountAvatar()) return;
    const upload = this.state.upload!, preview = upload.preview!;
    this.clearComparison();
    const t = this.begin('read'); if (!t) return;
    const query = { uploadId: upload.id, expectedUploadVersion: upload.version };
    const comparison = { query, manifestSha256: preview.manifestSha256, value: null, error: null };
    this.accountAvatarComparisonTicket = t; this.update({ accountAvatarComparison: comparison });
    try {
      const value = await this.api.compareAccountAvatar(t.userId, query, t.controller.signal);
      if (!this.current(t) || this.accountAvatarComparisonTicket !== t || this.state.upload?.id !== upload.id || this.state.upload.version !== upload.version) return;
      if (value.uploadId !== upload.id || value.manifestSha256 !== preview.manifestSha256
        || value.backupVersion !== preview.header.selection.accountAvatar!.version) throw new HandoverApiError(0, 'handover_response_invalid');
      this.update({ accountAvatarComparison: { ...comparison, value } });
    } catch (error) {
      if (!this.current(t) || this.accountAvatarComparisonTicket !== t) return;
      if (error instanceof HandoverApiError && (error.status === 401 || ['session_changed', 'identity_changed'].includes(error.code))) this.error(t, error);
      else this.update({ accountAvatarComparison: { ...comparison, error: importErrorText(error) } });
    } finally { if (this.accountAvatarComparisonTicket === t) this.accountAvatarComparisonTicket = null; this.finish(t); }
  };
  restoreAccountAvatar = async (observed = this.state.accountAvatarComparison) => {
    const comparison = this.state.accountAvatarComparison, upload = this.state.upload, value = comparison?.value;
    if (comparison !== observed || this.state.pending || this.state.busy || !this.canCompareAccountAvatar() || !comparison || !value || comparison.error
      || upload!.id !== comparison.query.uploadId || upload!.version !== comparison.query.expectedUploadVersion
      || upload!.preview!.manifestSha256 !== comparison.manifestSha256 || value.backupVersion !== upload!.preview!.header.selection.accountAvatar!.version) return;
    const mode = accountAvatarComparisonResolution(value); if (!mode) return;
    const parsed = handoverImportCommandSchema.safeParse({ opId: crypto.randomUUID(), uploadId: upload!.id, expectedUploadVersion: upload!.version,
      acceptedManifestSha256: comparison.manifestSha256, resolutionOnly: true, restoreOriginal: true, targets: [], resolutions: [],
      accountAvatar: { expectedVersion: value.localVersion, mode } });
    if (!parsed.success) { this.update({ notice: '本人頭像還原資料已不可用，請重新比較。' }); return; }
    this.clearComparison();
    this.update({ pending: { kind: 'create', command: parsed.data, checked: true }, notice: null });
    await this.retryOriginal();
  };
  compareOriginal = async (childId: string, module: OriginalBackupComparisonQuery['module'], more = false) => {
    const upload = this.state.upload, preview = upload?.preview, previous = this.state.comparison;
    if (this.state.pending || upload?.state !== 'ready' || !preview || preview.header.purpose !== 'backup'
      || preview.header.source.accountId !== this.state.userId || !preview.header.selection.childIds.includes(childId)
      || !preview.header.selection.modules.includes(module) || !originalBackupModuleSchema.safeParse(module).success || !this.state.originalModules.includes(module)
      || module === 'attachments' && !hasOriginalChildAvatar(preview, childId)
      || more && (!previous?.nextCursor || previous.query.childId !== childId || previous.query.module !== module)) return;
    const t = this.begin('read'); if (!t) return;
    const query = {uploadId:upload.id,expectedUploadVersion:upload.version,childId,module,includeRestoreTarget:true as const};
    const comparison = {query,manifestSha256:preview.manifestSha256,items:more ? previous!.items : [],selected:more ? previous!.selected : [],nextCursor:null,loaded:false,error:null};
    this.comparisonTicket = t; this.update({comparison});
    try {
      const page = await this.api.compareOriginal(t.userId,{...query,...(more ? {cursor:previous!.nextCursor!} : {})},t.controller.signal);
      if (!this.current(t) || this.comparisonTicket !== t || this.state.upload?.id !== upload.id || this.state.upload.version !== upload.version) return;
      if (page.childId !== childId || page.module !== module || page.uploadId !== upload.id || page.manifestSha256 !== preview.manifestSha256
        || module === 'attachments' && page.items.some(item => item.resourceSection !== 'child_avatar' || item.id !== childId || item.targetId !== childId))
        throw new HandoverApiError(0,'handover_response_invalid');
      this.update({comparison:{...comparison,loaded:true,nextCursor:page.nextCursor,items:more
        ? [...comparison.items,...page.items.filter(row => !comparison.items.some(item => originalComparisonItemKey(item) === originalComparisonItemKey(row)))] : page.items}});
    } catch (error) {
      if (!this.current(t) || this.comparisonTicket !== t) return;
      if (error instanceof HandoverApiError && (error.status === 401 || ['session_changed','identity_changed'].includes(error.code))) this.error(t,error);
      else this.update({comparison:{...comparison,items:[],selected:[],error:importErrorText(error)}});
    } finally { if (this.comparisonTicket === t) this.comparisonTicket = null; this.finish(t); }
  };
  selectComparison = (identity: string | Pick<OriginalBackupComparison['items'][number], 'id' | 'resourceSection'>,
    checked: boolean, observed = this.state.comparison) => {
    const comparison = this.state.comparison;
    if (comparison !== observed || this.state.busy || this.state.pending || !comparison?.loaded || comparison.error) return;
    const id = typeof identity === 'string' ? identity : originalComparisonItemKey(identity);
    const item = comparison.items.find(row => originalComparisonItemKey(row) === id);
    if (!item || !originalComparisonResolution(item)) return;
    this.update({comparison:{...comparison,selected:checked ? [...comparison.selected.filter(value => value !== id),id] : comparison.selected.filter(value => value !== id)}});
  };
  selectReadComparison = (mode: 'replace_current' | 'restore_deleted', checked: boolean, observed = this.state.comparison) => {
    const comparison = this.state.comparison;
    if (comparison !== observed || this.state.busy || this.state.pending || !comparison?.loaded || comparison.error) return;
    const ids = comparison.items.filter(row => originalComparisonResolution(row) === mode).map(originalComparisonItemKey);
    this.update({comparison:{...comparison,selected:checked ? [...new Set([...comparison.selected,...ids])] : comparison.selected.filter(id => !ids.includes(id))}});
  };
  restoreComparison = async (observed = this.state.comparison) => {
    const comparison = this.state.comparison, upload = this.state.upload;
    if (comparison !== observed || this.state.busy || this.state.pending || !comparison?.loaded || comparison.error || !comparison.selected.length || !upload?.preview
      || upload.state !== 'ready' || upload.id !== comparison.query.uploadId || upload.version !== comparison.query.expectedUploadVersion
      || upload.preview.manifestSha256 !== comparison.manifestSha256 || upload.preview.header.purpose !== 'backup'
      || upload.preview.header.source.accountId !== this.state.userId || comparison.query.includeRestoreTarget !== true
      || !this.state.originalModules.includes(comparison.query.module)) return;
    const rows = comparison.selected.map(id => comparison.items.find(item => originalComparisonItemKey(item) === id));
    const {childId,module} = comparison.query;
    if (rows.some(item => !item || !originalComparisonResolution(item) || !originalRestoreResourceSection(module, item))) return;
    const input = handoverImportCommandSchema.safeParse({opId:crypto.randomUUID(),uploadId:upload.id,expectedUploadVersion:upload.version,
      acceptedManifestSha256:comparison.manifestSha256,restoreOriginal:true,resolutionOnly:true,
      targets:[{sourceChildId:childId,target:{childId,spaceId:null},sections:[module]}],
      resolutions:rows.map(item => ({sourceChildId:childId,section:originalRestoreResourceSection(module,item)!,resourceId:item!.id,
        resolution:{mode:originalComparisonResolution(item!)!,targetId:item!.targetId!,expectedVersion:item!.localVersion!}}))});
    if (!input.success) {this.update({notice:'所選還原項目或版本已不可用，請重新比較。'});return;}
    this.clearComparison();
    this.update({pending:{kind:'create',command:input.data,checked:true},notice:null});
    await this.retryOriginal();
  };
  readEnrolments = async (id: string) => {
    const batch = this.state.items.find(item => item.id === id);
    if (!this.state.classEnrolmentEnabled || !batch || this.state.pending) return;
    const t = this.begin('read'); if (!t) return;
    try {
      const page = await this.api.importEnrolments(t.userId, id, t.controller.signal);
      if (!this.current(t)) return;
      if (page.items.some(row => !batch.targets.some(target => target.sourceChildId === row.sourceChildId
        && target.target.childId === row.target.childId && target.target.spaceId === row.target.spaceId)))
        throw new HandoverApiError(0, 'handover_response_invalid');
      this.update({ enrolmentResults: page });
    } catch (error) { if (this.current(t)) this.update({ enrolmentResults: null }); this.error(t, error); }
    finally { this.finish(t); }
  };
  private stopResultsRead() {
    const ticket = this.resultsTicket; this.resultsTicket = null;
    if (ticket) {
      ticket.controller.abort();
      if (this.active === ticket.controller) { this.active = null; this.update({ busy: null }); }
    }
  }
  selectResults = (batchId: string, sourceChildId: string, module: HandoverImportResultQuery['module']) => {
    if (this.state.pending || this.state.busy && !this.resultsTicket && !this.historyTicket && !this.documentTicket) return;
    const batch = this.state.items.find(row => row.id === batchId);
    if (!batch?.targets.some(target => target.sourceChildId === sourceChildId && target.sections.includes(module))) return;
    this.stopResultsRead(); this.stopHistoryRead();
    this.update({ sourceHistory: null, results: { batchId, sourceChildId, module, revision: ++this.resultsRevision,
      items: [], nextCursor: null, loaded: false, error: null } });
  };
  closeResults = () => {
    if (this.state.busy && !this.resultsTicket && !this.historyTicket && !this.documentTicket) return;
    this.stopResultsRead(); this.stopHistoryRead(); this.update({ results: null, sourceHistory: null });
  };
  readResults = async (more = false) => {
    const previous = this.state.results; if (!previous || more && !previous.nextCursor) return;
    if (this.historyTicket || this.documentTicket) this.stopHistoryRead();
    const t = this.begin('read'); if (!t) return;
    const results = more ? { ...previous, error: null } : { ...previous, revision: ++this.resultsRevision,
      items: [], nextCursor: null, loaded: false, error: null };
    this.resultsTicket = t; this.update({ results, ...(!more ? { sourceHistory: null } : {}) });
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
        this.update({ sourceHistory: null, results: { ...results, error: importErrorText(error), nextCursor: null,
          items: [], loaded: false, revision: ++this.resultsRevision } });
        this.error(t, error);
      }
    } finally { if (this.resultsTicket === t) this.resultsTicket = null; this.finish(t); }
  };
  private stopHistoryRead() {
    this.closeDocumentContent();
    const ticket = this.historyTicket; this.historyTicket = null;
    if (ticket) {
      ticket.controller.abort();
      if (this.state.sourceHistory?.loading) this.update({ sourceHistory: { ...this.state.sourceHistory, loading: false } });
      if (this.active === ticket.controller) { this.active = null; this.update({ busy: null }); }
    }
  }
  openSourceHistory = async (resultId: string) => {
    if (this.state.pending || this.state.busy && !this.historyTicket && !this.documentTicket) return;
    const results = this.state.results, row = results?.items.find(item => item.id === resultId);
    const section = row ? handoverResultResourceSection(row) : null;
    const batch = this.state.items.find(item => item.id === results?.batchId);
    const target = batch?.targets.find(item => item.sourceChildId === results?.sourceChildId)?.target;
    if (!results?.loaded || results.error || !row || !target || !canReadHandoverSourceHistory(row)
      || (section === 'private_sources' || section === 'growth_attention' || section === 'growth_topics') && target.spaceId !== null
      || row.batchId !== results.batchId || row.sourceChildId !== results.sourceChildId || row.module !== results.module) return;
    this.stopHistoryRead();
    this.update({ sourceHistory: { batchId: results.batchId, resultId, revision: ++this.historyRevision,
      query: { ...target, module: section!, resourceId: row.recordedResource!.id },
      items: [], page: 0, nextCursor: null, complete: false, loaded: false, loading: false, error: null, documentContent: null } });
    await this.readSourceHistory();
  };
  closeSourceHistory = () => { this.stopHistoryRead(); this.update({ sourceHistory: null }); };
  readSourceHistory = async (more = false) => {
    const previous = this.state.sourceHistory; if (!previous || more && !previous.nextCursor) return;
    this.closeDocumentContent();
    const t = this.begin('read'); if (!t) return;
    const history = more ? { ...previous, documentContent: null, loading: true, error: null } : { ...previous, documentContent: null, revision: ++this.historyRevision,
      items: [], page: 0, nextCursor: null, complete: false, loaded: false, loading: true, error: null };
    this.historyTicket = t; this.update({ sourceHistory: history });
    try {
      const page = await this.api.sourceHistory(t.userId, { ...history.query, ...(more ? { cursor: previous.nextCursor! } : {}) }, t.controller.signal);
      if (!this.current(t) || this.state.sourceHistory?.revision !== history.revision) return;
      const known = new Set(history.items.map(handoverSourceHistoryKey));
      this.update({ sourceHistory: { ...history, loaded: true, loading: false, page: history.page + 1, nextCursor: page.nextCursor, complete: page.complete,
        items: [...history.items, ...page.items.filter(item => { const key = handoverSourceHistoryKey(item); if (known.has(key)) return false; known.add(key); return true; })] } });
    } catch (error) {
      if (this.current(t) && this.state.sourceHistory?.revision === history.revision) {
        this.update({ sourceHistory: { ...history, loading: false, loaded: false, items: [], page: 0, nextCursor: null, complete: false, error: importErrorText(error) } });
        this.error(t, error);
      }
    } finally { if (this.historyTicket === t) this.historyTicket = null; this.finish(t); }
  };
  closeDocumentContent = () => {
    const ticket = this.documentTicket; this.documentTicket = null;
    ticket?.controller.abort();
    if (ticket && this.active === ticket.controller) { this.active = null; this.update({ busy: null }); }
    if (this.state.sourceHistory?.documentContent) this.update({ sourceHistory: { ...this.state.sourceHistory, documentContent: null } });
  };
  openDocumentContent = async (key: string) => {
    if (this.state.pending || this.state.busy && !this.documentTicket || !this.documentPort) return;
    const history = this.state.sourceHistory, item = history?.items.find(value => handoverSourceHistoryKey(value) === key), value = item?.evidence.value;
    if (!history?.loaded || history.error || item?.evidence.module !== 'documents' || !value || value.invalidated !== false
      || value.documentId !== history.query.resourceId || typeof value.snapshotId !== 'string' || typeof value.snapshotVersion !== 'number'
      || !Number.isSafeInteger(value.snapshotVersion) || value.snapshotVersion <= 0) return;
    this.closeDocumentContent();
    this.update({ sourceHistory: { ...history, documentContent: { key, documentId: history.query.resourceId, snapshotId: value.snapshotId,
      snapshotVersion: value.snapshotVersion, authorityVersion: null, documentVersion: null, totalCharacters: null, text: '', nextOffset: 0,
      complete: false, invalidated: false, loading: false, error: null, snapshot: null } } });
    await this.readDocumentContent();
  };
  readDocumentContent = async () => {
    const history = this.state.sourceHistory, previous = history?.documentContent;
    if (!history || !previous || previous.nextOffset === null || previous.invalidated || !this.documentPort) return;
    const t = this.begin('read'); if (!t) return;
    this.documentTicket = t;
    const valid = () => this.current(t) && this.state.sourceHistory?.revision === history.revision
      && this.state.sourceHistory.documentContent?.key === previous.key;
    const update = (documentContent: HandoverDocumentContentState) => this.update({ sourceHistory: { ...this.state.sourceHistory!, documentContent } });
    update({ ...previous, loading: true, error: null });
    try {
      const page = await this.documentPort(t.userId, { childId: history.query.childId, spaceId: history.query.spaceId }, previous.documentId,
        { snapshotId: previous.snapshotId, snapshotVersion: previous.snapshotVersion, offset: previous.nextOffset }, t.controller.signal);
      if (!valid()) return;
      if (page.invalidated) { update({ ...previous, text: '', snapshot: null, loading: false, invalidated: true, complete: false, nextOffset: null }); return; }
      if (!page.authorityVersion || previous.authorityVersion !== null && (page.authorityVersion !== previous.authorityVersion || page.documentVersion !== previous.documentVersion)
        || previous.totalCharacters !== null && page.totalCharacters !== previous.totalCharacters) throw new FamilyDocumentApiError(409, 'document_changed');
      const text = previous.text + page.text;
      const snapshot = page.complete ? parseFamilyDocumentSnapshot(JSON.parse(text), previous.snapshotId, previous.snapshotVersion) : null;
      update({ ...previous, loading: false, authorityVersion: page.authorityVersion, documentVersion: page.documentVersion, totalCharacters: page.totalCharacters,
        text: snapshot ? '' : text, nextOffset: page.nextOffset, complete: page.complete, snapshot });
    } catch (error) {
      if (valid()) {
        const failure = new HandoverApiError(error instanceof FamilyDocumentApiError ? error.status : 0,
          error instanceof FamilyDocumentApiError ? error.code ?? 'document_content_invalid' : 'document_content_invalid');
        update({ ...previous, text: '', snapshot: null, loading: false, complete: false, authorityVersion: null, documentVersion: null,
          totalCharacters: null, nextOffset: 0, error: importErrorText(failure) }); this.error(t, failure);
      }
    } finally { if (this.documentTicket === t) this.documentTicket = null; this.finish(t); }
  };
  resolveResults = async (mode: 'replace_current' | 'restore_deleted', ids: string[]) => {
    const results = this.state.results, original = this.state.items.find(row => row.id === results?.batchId);
    if (this.state.pending || this.state.busy || !results?.loaded || results.error || !original
      || !['completed', 'cancelled', 'failed'].includes(original.state) || !ids.length || new Set(ids).size !== ids.length) return;
    const rows = ids.map(id => results.items.find(row => row.id === id));
    if (rows.some(row => !row || row.sourceSection !== null || row.outcome !== 'conflict' || row.availableResolution !== mode || !row.currentResource
      || !handoverResultResourceSection(row)
      || row.batchId !== results.batchId || row.sourceChildId !== results.sourceChildId || row.module !== results.module)) return;
    const resolutions: HandoverImportCommand['resolutions'] = rows.map(row => ({ sourceChildId: row!.sourceChildId, section: handoverResultResourceSection(row!)!,
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
      this.update({ pending: { kind: 'create', command, checked: true }, results: null, sourceHistory: null }); submit = true;
    } catch (error) { this.error(t, error); } finally { this.finish(t); }
    if (submit && this.current(t)) await this.retryOriginal();
  };
  choose = async (pick: (signal: AbortSignal) => Promise<SelectedPackage | null>, signal?: AbortSignal) => {
    if (this.state.pending || this.state.upload || signal?.aborted) return;
    const t = this.begin('pick'); if (!t) return;
    let selectedId: string | null = null;
    const cancel = () => {
      const pending = this.state.pending;
      const sameRequest = selectedId && (pending?.kind === 'reserve' ? pending.command.opId === selectedId : pending?.kind === 'upload' && pending.id === selectedId);
      if (t.epoch === this.epoch && (this.active === t.controller || sameRequest)) this.active?.abort();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      try {
        const file = await pick(t.controller.signal); if (!file) return;
        if (!this.current(t)) { file.release(); return; }
        this.file = file;
        const command = handoverUploadCommandSchema.safeParse({ opId: crypto.randomUUID(), filename: file.filename, bytes: file.bytes, sha256: file.sha256 });
        if (!command.success) { this.release(); throw new HandoverApiError(400, 'invalid_package_file'); }
        selectedId = command.data.opId;
        this.update({ pending: { kind: 'reserve', command: command.data, checked: true } });
      } catch (e) { this.error(t, e); } finally { this.finish(t); }
      if (this.current(t)) await this.retryOriginal();
    } finally { signal?.removeEventListener('abort', cancel); }
  };
  create = async (targets: HandoverImportCommand['targets'], acceptUntrusted: boolean) => {
    const upload = this.state.upload; if (this.state.pending || this.state.busy || !upload?.preview || upload.state !== 'ready') return;
    if (!this.state.classConcernImportsEnabled && targets.some(row => row.sections.includes('concerns')
      && ('createInClassId' in row.target || row.target.spaceId !== null))) {
      this.update({ notice: '此服務目前未開放向班級匯入持續關注，請重新讀取能力及接收對象。' }); return;
    }
    if (targets.some(row => 'createInClassId' in row.target) && !this.state.classEnrolmentEnabled) {
      this.update({ notice: '此服務目前未開放匯入時新增班員。' }); return;
    }
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
      if (this.current(t) && p.kind === 'create' && p.rejected && 'accountAvatar' in p.command && e instanceof HandoverApiError && e.status === 404)
        this.update({ pending: null, notice: '本人頭像版本已改變，請重新比較後再選擇還原。' });
      else if (this.current(t) && ['reserve', 'create'].includes(p.kind) && e instanceof HandoverApiError && e.status === 404)
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
  const nativeMaxBytes = error instanceof Error && 'maxBytes' in error && typeof error.maxBytes === 'number'
    && Number.isSafeInteger(error.maxBytes) && error.maxBytes > 0 && error.maxBytes <= HANDOVER_UPLOAD_MAX_BYTES
    ? error.maxBytes : 20 * 1024 * 1024;
  const messages: Record<string, string> = {
    package_original_unverified: '未能核實這是此帳戶及原孩子的本人備份，不能比較原有資料；仍可另選匯入副本。',
    invalid_package_file: '請選擇不超過 256 MiB 的 ZIP 資料包。', package_local_file_missing: '本機檔案已不在，請取消此上載後重新選取。',
    package_native_size_exceeded: nativeMaxBytes <= 20 * 1024 * 1024 ? '手機目前可上載最多 20 MiB；較大的資料包請用 Web 匯入。'
      : `手機目前可上載最多 ${nativeMaxBytes / 1024 / 1024} MiB，請選擇較小的資料包。`,
    package_local_cache_full: '本機暫存檔案已滿，請稍後再試。',
    package_section_not_connected: '所選資料含尚未接通的類型，沒有繼續匯入；請查看批次結果。',
    import_class_student_conflict: '原有班員已變更，請重新核對接收班員。',
    read_only: '你目前只有檢視權限，無法寫入所選對象。', space_access_denied: '你目前沒有此空間的存取權限。',
    package_signature_invalid: '資料包簽章不符，請向來源重新取得。', package_hash_mismatch: '資料包內容校驗不符，請重新取得。',
    package_integrity_failed: '資料包完整性驗證失敗，請向來源重新取得；不能略過此錯誤匯入。',
    package_upload_capacity: '暫存資料包已滿，請取消不再使用的上載或稍後再試。',
    package_upload_not_ready: '資料包仍在處理，請查回原上載結果。', package_upload_stopped: '這份上載已停止，請重新選取資料包。',
    package_expired: '上載的資料包已到期，請重新選取。', package_upload_limit: '暫存資料包已滿，請取消不再使用的上載或稍後再試。',
    invalid_cursor: '列表已變更，請重新讀取第一頁。', invalid_package_cursor: '匯入續讀位置無效，請查看原批次。',
    invalid_import_cursor: '逐項結果已變更，請重新讀取第一頁。', import_results_changed: '逐項結果或接收範圍已變更，請重新讀取。',
    import_resolution_not_available: '原批次仍在執行或不能處理衝突，請先查看其最新狀態。',
    import_source_changed: '原資料包與批次不一致，不能用來處理這些衝突。',
    source_history_scope_changed: '來源歷史或目前權限已變更，請重新讀取。', invalid_history_cursor: '來源歷史續讀位置無效，請重新讀取第一頁。',
    document_changed: '文件或來源權限基準已變更，請重新讀取。', document_content_invalid: '未能完整讀取原文件，請重新讀取。',
  };
  return messages[code] ?? handoverErrorText(error);
}
