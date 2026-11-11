import { HandoverApiError, type HandoverApi } from '../../../src/client/handover-api.ts';
import { handoverExportCommandSchema, type HandoverExportCommand, type HandoverExportView,
  handoverClassExportCommandSchema, type HandoverClassExportCommand,
  type HandoverPreviewItem, type HandoverPreviewQuery } from '../../../src/shared/handover-jobs.ts';

type ExportSelection = HandoverExportCommand['selection'];
type DocumentReview = NonNullable<HandoverExportCommand['documentReview']>;
type ClassSource = HandoverClassExportCommand['source'];
type ReviewSection = HandoverPreviewQuery['section'];
export type NotificationPreferencesExportBasis = { identityKey: string; scopeKey: string; version: number };
const samePreferencesBasis = (first: NotificationPreferencesExportBasis | null, second?: NotificationPreferencesExportBasis | null) =>
  first?.identityKey === second?.identityKey && first?.scopeKey === second?.scopeKey && first?.version === second?.version;
export type ExportReviewGroup = { childId: string; section: ReviewSection; items: HandoverPreviewItem[];
  loaded: boolean; nextCursor: string | null; avatarVersion?: number };
type ExportReview = { selection: ExportSelection; key: string; basis: string; scopeVersion: string | null;
  groups: ExportReviewGroup[]; choices: DocumentReview['choices']; error: string | null; source?: ClassSource; opId?: string };
const sameSource = (first?: ClassSource, second?: ClassSource) => first?.kind === second?.kind && first?.spaceId === second?.spaceId;
const classScopeErrors = new Set(['forbidden', 'module_not_shared', 'space_access_denied', 'space_inactive', 'scope_changed', 'sharing_scope_changed', 'export_scope_changed']);
export const handoverReviewSections = (selection: ExportSelection): ReviewSection[] => [
  ...(selection.modules.includes('documents') ? ['documents', 'visit_preparation'] as const : []),
  ...(selection.modules.includes('attachments') ? ['files', 'photos', 'voices', 'child_avatar'] as const : []),
];
export const handoverReviewSelectionKey = (selection: ExportSelection) => JSON.stringify({ childIds: [...selection.childIds].sort(),
  modules: [...selection.modules].sort(), period: selection.period, ...(selection.accountAvatar ? { accountAvatar: selection.accountAvatar } : {}),
  ...(selection.notificationPreferences ? { notificationPreferences: selection.notificationPreferences } : {}),
  ...(selection.mixedRooms ? { mixedRooms: selection.mixedRooms.map(pin => ({ ...pin, childIds: [...pin.childIds].sort() })).sort((a, b) => a.id.localeCompare(b.id)) } : {}) });
export const handoverReviewItemKey = (item: Pick<HandoverPreviewItem, 'section' | 'childId' | 'id'>) => JSON.stringify([item.section, item.childId, item.id]);

type Pending = { kind: 'create'; command: HandoverExportCommand | HandoverClassExportCommand; checked: boolean }
  | { kind: 'cancel'; id: string; command: { opId: string; expectedVersion: number }; checked: boolean };
export interface HandoverState {
  userId: string | null; identityKey: string | null; online: boolean; loaded: boolean;
  items: HandoverExportView[]; nextCursor: string | null; pending: Pending | null;
  busy: 'read' | 'write' | 'check' | 'download' | null; notice: string | null;
  review: ExportReview | null; reviewBusy: boolean;
  classModules: HandoverClassExportCommand['selection']['modules'] | null;
  accountAvatarBackup: boolean;
  notificationPreferencesBackup: boolean;
  mixedConversations: boolean;
}
const empty = (userId: string | null, identityKey: string | null, online: boolean): HandoverState => ({
  userId, identityKey, online, loaded: false, items: [], nextCursor: null, pending: null, busy: null, notice: null, review: null, reviewBusy: false, classModules: null, accountAvatarBackup: false, notificationPreferencesBackup: false, mixedConversations: false,
});
export function handoverErrorText(error: unknown) {
  const code = error instanceof HandoverApiError ? error.code : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    export_scope_changed: '資料已變更，請重新選擇範圍建立資料包。', package_scope_unavailable: '所選資料目前不可使用。',
    request_body_too_large: '這次選取的項目太多，請分開建立資料包。',
    package_service_unavailable: '資料包服務暫時未能使用，請稍後再試。', package_size_exceeded: '資料超出此批處理容量，請減少所選範圍。',
    package_object_unknown: '檔案保存結果尚未確認，請查回原檔案。', package_download_incomplete: '下載未完整，請重新下載同一份資料包。',
    package_download_invalid: '下載資料不完整或已變更，請重新讀取狀態。', package_restored: '這份暫存資料包已失效，請重新建立。',
    version_conflict: '狀態已改變，請重新讀取後再操作。', session_changed: '登入狀態已改變，請重新登入。',
    identity_changed: '登入狀態已改變，請重新登入。', unauthorized: '請重新登入。', access_denied: '目前沒有權限讀取這份資料。',
    forbidden: '所選資料目前不可匯出，請重新選擇。',
    module_not_shared: '所選學生目前未分享這些資料，請重新核對班級名冊及模組。',
    space_access_denied: '你已不能讀取這個班級，請重新選擇班級。', space_inactive: '這個班級已停止使用，請重新選擇班級。',
    scope_changed: '班級權限或資料範圍已改變，請重新核對後建立資料包。',
    package_review_changed: '資料清單已改變，請重新讀取並選擇。',
  };
  return messages[code ?? ''] ?? '暫時未能完成，請核對連線後查回原結果。';
}
type Ticket = { epoch: number; userId: string; controller: AbortController };
/** Identity-scoped coordination only; Server owns authorization, export contents and job states. */
export class HandoverOwner {
  private state = empty(null, null, false); private epoch = 0; private active: AbortController | null = null;
  private listeners = new Set<() => void>();
  private reviewEpoch = 0; private reviewRead: AbortController | null = null;
  private capabilityRead: AbortController | null = null;
  private notificationPreferencesBasis: NotificationPreferencesExportBasis | null = null;
  private readonly api: HandoverApi; private readonly accessError: (error: HandoverApiError) => void;
  constructor(api: HandoverApi, accessError: (error: HandoverApiError) => void = () => {}) { this.api = api; this.accessError = accessError; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<HandoverState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  syncContext(userId: string | null, identityKey: string | null, online: boolean) {
    if (userId !== this.state.userId || identityKey !== this.state.identityKey) {
      this.epoch++; this.active?.abort(); this.active = null; this.api.setIdentity(null); this.api.setIdentity(userId);
      this.reviewEpoch++; this.reviewRead?.abort(); this.reviewRead = null;
      this.capabilityRead?.abort(); this.capabilityRead = null;
      this.notificationPreferencesBasis = null;
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
      this.setReviewSelection(null); this.update({ items: [], loaded: false }); this.accessError(error);
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
  setReviewSelection = (selection: ExportSelection | null, basis = '', source?: ClassSource) => {
    const relevant = selection && handoverReviewSections(selection).length ? selection : null;
    const key = relevant ? handoverReviewSelectionKey(relevant) : null;
    if (key === (this.state.review?.key ?? null) && (!relevant || this.state.review?.basis === basis && sameSource(this.state.review?.source, source))) return;
    this.reviewEpoch++; this.reviewRead?.abort(); this.reviewRead = null;
    this.update({ reviewBusy: false, review: relevant ? { selection: { childIds: [...relevant.childIds], modules: [...relevant.modules],
      period: relevant.period && { ...relevant.period }, ...(relevant.accountAvatar ? { accountAvatar: { ...relevant.accountAvatar } } : {}),
      ...(relevant.notificationPreferences ? { notificationPreferences: { ...relevant.notificationPreferences } } : {}),
      ...(relevant.mixedRooms ? { mixedRooms: relevant.mixedRooms.map(pin => ({ ...pin, childIds: [...pin.childIds] })) } : {}) }, key: key!, basis, scopeVersion: null,
      ...(source ? { source: { ...source }, opId: crypto.randomUUID() } : {}),
      groups: relevant.childIds.flatMap(childId => handoverReviewSections(relevant).map(section => ({ childId, section, items: [], loaded: false, nextCursor: null }))),
      choices: [], error: null } : null });
  };
  syncNotificationPreferencesBasis = (basis: NotificationPreferencesExportBasis | null) => {
    const current = basis?.identityKey === this.state.identityKey ? basis : null;
    if (samePreferencesBasis(this.notificationPreferencesBasis, current)) return;
    this.notificationPreferencesBasis = current ? { ...current } : null;
    if (this.state.review?.selection.notificationPreferences) this.setReviewSelection(null);
  };
  reviewReady = (selection: ExportSelection) => !handoverReviewSections(selection).length || !!(this.state.review
    && this.state.review.key === handoverReviewSelectionKey(selection) && this.state.review.scopeVersion && !this.state.reviewBusy
    && !this.state.review.error && this.state.review.groups.every(group => group.loaded && (group.section !== 'child_avatar' || group.avatarVersion !== undefined)));
  reviewMatches = (selection: ExportSelection, basis: string, source?: ClassSource) => this.state.review?.key === handoverReviewSelectionKey(selection)
    && this.state.review.basis === basis && sameSource(this.state.review.source, source);
  documentReview = (selection: ExportSelection): DocumentReview | undefined => {
    const review = this.state.review;
    if (!handoverReviewSections(selection).length || !review || !this.reviewReady(selection)) return undefined;
    return { scopeVersion: review.scopeVersion!, choices: review.choices.map(choice => ({ ...choice })),
      ...(selection.modules.includes('attachments') ? { avatarVersions: review.groups.filter(group => group.section === 'child_avatar')
        .map(group => ({ childId: group.childId, version: group.avatarVersion! })) } : {}) };
  };
  chooseReviewItem = (item: HandoverPreviewItem, include: boolean) => {
    const review = this.state.review;
    if (!review || this.state.reviewBusy || review.error || !item.canInclude && !item.defaultIncluded) return;
    const saved = review.groups.flatMap(group => group.items).find(row => handoverReviewItemKey(row) === handoverReviewItemKey(item));
    if (!saved || JSON.stringify(saved) !== JSON.stringify(item)) return;
    const choices = review.choices.filter(row => handoverReviewItemKey(row) !== handoverReviewItemKey(item));
    if (include !== item.defaultIncluded) choices.push({ section: item.section, childId: item.childId, id: item.id, version: item.version,
      snapshotId: item.snapshotId, snapshotVersion: item.snapshotVersion, include });
    this.update({ review: { ...review, choices } });
  };
  loadReview = async (childId?: string, section?: ReviewSection) => {
    const review = this.state.review;
    if (!review || !this.state.userId || !this.state.identityKey || !this.state.online || this.state.reviewBusy) return;
    const epoch = this.reviewEpoch, identity = this.epoch, userId = this.state.userId, controller = new AbortController();
    this.reviewRead = controller;
    const current = () => epoch === this.reviewEpoch && identity === this.epoch && !controller.signal.aborted;
    this.update({ reviewBusy: true, review: { ...review, error: null } });
    try {
      const groups = childId && section ? review.groups.filter(group => group.childId === childId && group.section === section && group.nextCursor)
        : review.groups.filter(group => !group.loaded);
      for (const group of groups) {
        if (!current()) return;
        const active = this.state.review!;
        const next = await this.api.preview(userId, { childId: group.childId, section: group.section, period: active.selection.period,
          ...(active.source ? { source: active.source, opId: active.opId! } : {}),
          ...(active.scopeVersion ? { scopeVersion: active.scopeVersion } : {}), ...(group.nextCursor ? { cursor: group.nextCursor } : {}) }, controller.signal);
        if (!current()) return;
        if (active.scopeVersion && active.scopeVersion !== next.scopeVersion || next.nextCursor && next.nextCursor === group.nextCursor
          || next.items.some(item => item.childId !== group.childId || item.section !== group.section)
          || group.section === 'child_avatar' && next.avatarVersion === undefined) throw new HandoverApiError(409, 'package_review_changed');
        const items = [...group.items, ...next.items];
        if (new Set(items.map(handoverReviewItemKey)).size !== items.length) throw new HandoverApiError(409, 'package_review_changed');
        this.update({ review: { ...this.state.review!, scopeVersion: next.scopeVersion, groups: this.state.review!.groups.map(row => row === group
          ? { ...group, loaded: true, items, nextCursor: next.nextCursor, ...(next.avatarVersion === undefined ? {} : { avatarVersion: next.avatarVersion }) } : row) } });
      }
    } catch (error) {
      if (!current()) return;
      const stale = error instanceof HandoverApiError && (['export_scope_changed', 'package_review_changed', 'handover_response_invalid', 'forbidden', 'package_scope_unavailable'].includes(error.code)
        || !!review.source && classScopeErrors.has(error.code));
      const active = this.state.review!;
      this.update({ review: { ...active, error: handoverErrorText(error), ...(stale ? { scopeVersion: null, choices: [],
        groups: active.groups.map(group => ({ ...group, items: [], loaded: false, nextCursor: null, avatarVersion: undefined })) } : {}) } });
      if (error instanceof HandoverApiError && !(review.source && error.status === 403 && classScopeErrors.has(error.code))
        && (error.status === 401 || error.status === 403 || ['session_changed', 'identity_changed'].includes(error.code)))
        this.error({ epoch: identity, userId, controller }, error);
    } finally { if (this.reviewRead === controller) { this.reviewRead = null; this.update({ reviewBusy: false }); } }
  };
  readExportCapabilities = async () => {
    if (!this.state.userId || !this.state.identityKey || !this.state.online || this.capabilityRead) return;
    const controller = new AbortController(), t = { epoch: this.epoch, userId: this.state.userId, controller };
    this.capabilityRead = controller;
    try {
      const capability = await this.api.exportCapabilities(t.userId, controller.signal);
      if (this.current(t)) {
        if (capability.notificationPreferencesBackup !== true && this.state.review?.selection.notificationPreferences
          || capability.mixedConversations !== true && this.state.review?.selection.mixedRooms) this.setReviewSelection(null);
        this.update({ classModules: capability.classModules, accountAvatarBackup: capability.accountAvatarBackup === true,
          notificationPreferencesBackup: capability.notificationPreferencesBackup === true, mixedConversations: capability.mixedConversations === true });
      }
    } catch (error) {
      if (this.current(t)) {
        if (this.state.review?.selection.notificationPreferences || this.state.review?.selection.mixedRooms) this.setReviewSelection(null);
        this.update({ classModules: [], accountAvatarBackup: false, notificationPreferencesBackup: false, mixedConversations: false });
        if (error instanceof HandoverApiError && (error.status === 401 || ['identity_changed', 'session_changed'].includes(error.code))) this.error(t, error);
      }
    } finally { if (this.capabilityRead === controller) this.capabilityRead = null; }
  };
  createClass = async (selection: HandoverClassExportCommand['selection'], spaceId: string, basis?: string) => {
    if ('accountAvatar' in selection || 'notificationPreferences' in selection || this.state.pending || this.state.busy || !this.state.online || !this.state.userId
      || selection.mixedRooms && !this.state.mixedConversations
      || !selection.modules.every(module => this.state.classModules?.includes(module))) return;
    const source: ClassSource = { kind: 'class', spaceId }, review = this.state.review;
    const needsReview = handoverReviewSections(selection).length > 0;
    if (needsReview && (!review || !sameSource(review.source, source) || !review.opId || !this.reviewReady(selection)
      || basis !== undefined && review.basis !== basis)) return;
    const documentReview = needsReview ? this.documentReview(selection) : undefined;
    const parsed = handoverClassExportCommandSchema.safeParse({ opId: needsReview ? review!.opId : crypto.randomUUID(), purpose: 'handover', source, selection,
      ...(documentReview ? { documentReview } : {}) });
    if (!parsed.success) { this.update({ notice: '請核對班級、學生及可讀取的資料。' }); return; }
    this.update({ pending: { kind: 'create', command: parsed.data, checked: true } }); await this.retryOriginal();
  };
  create = async (selection: ExportSelection, purpose: HandoverExportCommand['purpose'], documentReview?: DocumentReview,
    accountAvatarBasis?: { identityKey: string; version: number }, notificationPreferencesBasis?: NotificationPreferencesExportBasis,
    reviewBasis?: string) => {
    if (this.state.pending || this.state.busy || !this.state.online || !this.state.userId || !this.reviewReady(selection)) return;
    if (selection.mixedRooms && !this.state.mixedConversations) return;
    if (selection.accountAvatar && (purpose !== 'backup' || !this.state.accountAvatarBackup
      || accountAvatarBasis?.identityKey !== this.state.identityKey || accountAvatarBasis.version !== selection.accountAvatar.version)) return;
    if (selection.notificationPreferences && (purpose !== 'backup' || !this.state.notificationPreferencesBackup
      || !notificationPreferencesBasis || !this.notificationPreferencesBasis
      || !samePreferencesBasis(this.notificationPreferencesBasis, notificationPreferencesBasis)
      || notificationPreferencesBasis.version !== selection.notificationPreferences.version)) return;
    if (handoverReviewSections(selection).length && this.state.review?.source) return;
    if (selection.notificationPreferences && handoverReviewSections(selection).length && this.state.review?.basis !== reviewBasis) return;
    const expectedReview = this.documentReview(selection);
    if (expectedReview && JSON.stringify(documentReview) !== JSON.stringify(expectedReview)) return;
    const parsed = handoverExportCommandSchema.safeParse({ opId: crypto.randomUUID(), purpose, selection, ...(documentReview ? { documentReview } : {}) });
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
    if (pending.kind === 'create' && pending.command.selection.mixedRooms && !this.state.mixedConversations) {
      this.update({ notice: '請先重新確認服務支援混合對話資料包，再接續原請求。' }); return;
    }
    const t = this.begin('write'); if (!t) return;
    this.update({ pending: { ...pending, checked: false } });
    try {
      const row = pending.kind === 'create' ? await ('source' in pending.command ? this.api.createClass(t.userId, pending.command, t.controller.signal)
        : this.api.create(t.userId, pending.command, t.controller.signal))
        : await this.api.cancel(t.userId, pending.id, pending.command, t.controller.signal);
      if (this.current(t)) { this.put(row); this.update({ pending: null }); }
    } catch (e) {
      if (this.current(t) && pending.kind === 'create' && 'source' in pending.command && e instanceof HandoverApiError
        && e.status >= 400 && e.status < 500
        && classScopeErrors.has(e.code)) {
        this.setReviewSelection(null);
        this.update({ pending: null, notice: handoverErrorText(e) }); return;
      }
      if (this.current(t) && e instanceof HandoverApiError && (e.status === 413 || ['invalid_input', 'version_conflict', 'package_period_not_connected', 'package_scope_unavailable', 'export_scope_changed'].includes(e.code)
        || pending.kind === 'create' && e.status === 403 && e.code === 'forbidden')) {
        this.update({ pending: null });
        if (e.code === 'export_scope_changed') this.setReviewSelection(null);
      }
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
