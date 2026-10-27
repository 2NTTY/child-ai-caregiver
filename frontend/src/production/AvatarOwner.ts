import { fromByteArray } from 'base64-js';
import { AvatarApiError, type AvatarApi } from '../../../src/client/avatars-api.ts';
import { readBlobBytes } from '../../../src/client/blob-bytes.ts';
import type { AvatarCrop, AvatarPolicy, AvatarState, AvatarTarget, AvatarUpload, AvatarReserveInput } from '../../../src/shared/avatars.ts';
import { boundedAvatarCrop, defaultAvatarCrop, type AvatarImage } from '../avatar-image';
import { photoPreview, photoSha256 } from '../platform/photo-bytes';

type Context = { key: string; userId: string; target: AvatarTarget };
type Command = { kind: 'reserve'; input: AvatarReserveInput } | { kind: 'commit'; input: { uploadId: string; expectedVersion: number } }
  | { kind: 'remove'; input: { expectedVersion: number; confirmRemove: true } };
export interface AvatarSnapshot {
  key: string | null; avatar: AvatarState | null; policy: AvatarPolicy | null; uri: string | null;
  selected: { uri: string; width: number; height: number } | null; crop: AvatarCrop;
  loading: boolean; busy: boolean; unknown: boolean; retryAvailable: boolean; conflict: boolean;
  notice: string | null; available: boolean; online: boolean;
}
const initial = (): AvatarSnapshot => ({ key: null, avatar: null, policy: null, uri: null, selected: null, crop: { ...defaultAvatarCrop },
  loading: false, busy: false, unknown: false, retryAvailable: false, conflict: false, notice: null, available: false, online: false });
const securityCodes = new Set(['session_changed','identity_changed','storage_epoch_changed','account_scope_changed','access_denied','forbidden','unauthorized']);
/** One in-memory target lane. The API alone owns online opIds and reconciliation. */
export class AvatarLane {
  private state = initial(); private context: Context | null = null; private generation = 0; private attempt = 0;
  private selection: AbortController | null = null; private request: AbortController | null = null; private input: AvatarImage | null = null; private basis: number | null = null;
  private needsRead = false; private upload: AvatarUpload | null = null; private command: Command | null = null;
  private displayed: { uri: string; dispose(): void } | null = null; private listeners = new Set<() => void>();
  constructor(private api: AvatarApi, private accessLost: (error: { status: number; code: string | null; target: AvatarTarget }) => void,
    private canStart: () => boolean, private changed: () => void) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AvatarSnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); this.changed(); }
  hasPending = () => this.state.busy || this.state.unknown;
  private clearInput() { this.attempt++; this.selection?.abort(); this.selection = null; this.input?.dispose(); this.input = null; this.basis = null; }
  private clearDisplay() { this.displayed?.dispose(); this.displayed = null; }
  syncContext(context: Context | null, online: boolean) {
    if (context?.key !== this.context?.key) {
      this.generation++; this.request?.abort(); this.request = null;
      if (this.context) this.api.resetOnline(this.context.target);
      this.clearInput(); this.clearDisplay(); this.upload = null; this.command = null; this.needsRead = false; this.context = context;
      this.update({ ...initial(), key: context?.key ?? null, online });
    } else if (online !== this.state.online) { this.update({ online }); if (!online) this.request?.abort(); }
  }
  private begin(write: boolean) {
    if (!this.context || !this.state.online) return null;
    if (this.request) {
      if (!write || this.hasPending()) return null;
      // An explicit write may replace a read refresh, never an unresolved write.
      this.request.abort();
    }
    const context = this.context, generation = this.generation, controller = new AbortController(); this.request = controller;
    this.update(write ? { busy: true, loading: false, notice: null, retryAvailable: false } : { loading: true });
    const same = () => this.generation === generation && this.request === controller;
    return { context, signal: controller.signal, current: () => same() && !controller.signal.aborted,
      same, finish: () => { if (!same()) return; this.request = null; this.update({ loading: false, busy: false }); } };
  }
  private failure(error: unknown, write: boolean) {
    const known = error instanceof AvatarApiError ? error : null;
    if (known && (known.status === 401 || known.status === 403 || securityCodes.has(known.onlineCode ?? ''))) {
      const report = { status: known.status, code: known.onlineCode, target: this.context?.target ?? { kind: 'self' as const } };
      this.syncContext(null, this.state.online); this.update({ notice: '登入或存取範圍已改變，頭像已隱藏。' }); this.accessLost(report); return;
    }
    const pending = !!this.context && this.api.hasPendingOnline(this.context.target);
    if (known?.onlineCode === 'avatar_version_conflict' || known?.onlineCode === 'avatar_policy_changed') {
      this.upload = null; this.command = null;
      if (!this.input) this.clearDisplay();
      this.update({ unknown: pending, conflict: !!this.input, ...(!this.input ? { uri: null, available: false } : {}), notice: this.input
        ? '頭像或圖片規格已改變。請先讀取現況，再確認是否使用這次選圖。' : '頭像現況已改變，請重新讀取。' }); return;
    }
    // A confirmed receipt or a terminal rejected command is never retried under a new opId as an 'original' operation.
    if (write && known?.confirmed) { this.needsRead = true; this.command = null; this.upload = null; }
    else if (write && this.command && !pending && known && known.status >= 400 && known.status < 500) {
      this.command = null; this.upload = null;
    }
    const uncertain = write && (pending || !!this.upload || this.needsRead || !!known?.confirmed);
    if (known?.status === 404) { this.clearInput(); this.clearDisplay(); }
    this.update({ unknown: uncertain, ...(known?.status === 404 ? { uri: null, avatar: null, selected: null, crop: { ...defaultAvatarCrop }, conflict: false, retryAvailable: false } : {}), available: !write || known?.onlineCode === 'avatar_unavailable' || known?.status === 404 ? false : this.state.available,
      notice: uncertain ? '原頭像操作尚待核對，請查核原操作；不會另開一個保存。'
        : known?.onlineCode === 'avatar_unavailable' || known?.status === 404 ? '頭像服務暫未可用；沒有更改或保存頭像。'
        : known?.onlineCode === 'avatar_busy' ? '圖片服務繁忙，請稍後再試；原有頭像保留。'
        : '未能讀取或保存頭像；原有頭像及本頁選圖保留。' });
  }
  private async readCurrent(r: NonNullable<ReturnType<AvatarLane['begin']>>) {
    const result = await this.api.read(r.context.target, r.signal, r.context.userId);
    if (!r.current()) return;
    const changedAsset = this.state.avatar?.asset?.id !== result.avatar.asset?.id || this.state.avatar?.version !== result.avatar.version;
    if (changedAsset) this.clearDisplay();
    this.update({ avatar: result.avatar, policy: result.policy, available: true, uri: this.displayed?.uri ?? null });
    if (!result.avatar.canManage) { this.clearInput(); this.update({ selected: null, crop: { ...defaultAvatarCrop } }); }
    if (!result.avatar.asset || this.displayed) return;
    // Never assign the protected content URL to Image: content() supplies expected identity and checks bytes/hash.
    const blob = await this.api.content(result.avatar, r.signal, r.context.userId);
    if (!r.current()) return;
    const bytes = await readBlobBytes(blob); if (!r.current()) return;
    const displayed = photoPreview(bytes, blob.type);
    if (!r.current()) { displayed.dispose(); return; }
    this.clearDisplay(); this.displayed = displayed; this.update({ uri: displayed.uri });
  }
  async load(): Promise<boolean> {
    if (this.hasPending()) return false;
    const r = this.begin(false); if (!r) return false;
    try { await this.readCurrent(r); if (!r.current()) return false;
      if (!this.state.conflict) this.update({ notice: null }); return true; }
    catch (error) { if (r.same()) this.failure(error, false); return false; } finally { r.finish(); }
  }
  invalidate() { if (this.listeners.size && !this.hasPending()) void this.load(); }
  beginSelection() { if (!this.context || !this.state.available || !this.state.policy || !this.state.avatar?.canManage || this.hasPending()) return null; this.selection?.abort(); this.selection = new AbortController(); return ++this.attempt; }
  selectionSignal(attempt: number) { return attempt === this.attempt ? this.selection?.signal ?? null : null; }
  cancelPicker(attempt: number) { if (attempt === this.attempt && this.selection) { this.attempt++; this.selection.abort(); this.selection = null; } }
  select(attempt: number, image: AvatarImage) {
    if (attempt !== this.attempt || !this.context || !this.state.available || !this.state.avatar?.canManage || this.hasPending()) { image.dispose(); return; }
    this.selection = null; this.input?.dispose(); this.input = image; this.basis = this.state.avatar.version; this.upload = null; this.command = null;
    this.update({ selected: { uri: image.uri, width: image.width, height: image.height }, crop: { ...defaultAvatarCrop }, conflict: false, notice: null });
  }
  selectionFailed(attempt: number) { if (attempt === this.attempt) { this.selection = null; this.update({ notice: '未能讀取這張圖片。請使用規格範圍內的 JPG 或 PNG，原有頭像仍然保留。' }); } }
  cancelSelection() {
    if (this.hasPending()) return false;
    this.clearInput(); this.upload = null; this.command = null;
    this.update({ selected: null, crop: { ...defaultAvatarCrop }, conflict: false, retryAvailable: false }); return true;
  }
  setCrop(crop: AvatarCrop) { if (!this.hasPending() && this.state.policy) this.update({ crop: boundedAvatarCrop(crop, this.state.policy.maxCropZoom) }); }
  async acceptCurrentBasis() {
    const loaded = await this.load();
    if (loaded && this.state.available && !this.state.loading && this.input && this.state.avatar?.canManage) {
      this.basis = this.state.avatar.version; this.update({ conflict: false, notice: '已採用目前版本作核對基準；請再按保存。' });
    }
  }
  private async execute(r: NonNullable<ReturnType<AvatarLane['begin']>>) {
    const { target, userId } = r.context;
    const command = this.command;
    if (command?.kind === 'remove') {
      const result = await this.api.remove(target, command.input, r.signal, userId); if (!r.current()) return;
      this.command = null; this.upload = null; this.clearInput(); this.needsRead = true;
      await this.readCurrent(r); if (!r.current()) return; this.needsRead = false;
      this.update({ selected: null, unknown: false, notice: result?.cleanupPending ? '頭像已移除，舊圖片仍在安全清理中。' : result ? '頭像已移除。' : '原移除操作已確認，已重新讀取目前頭像。' }); return;
    }
    if (command?.kind === 'reserve') {
      const result = await this.api.reserve(target, command.input, r.signal, userId); if (!r.current()) return;
      this.command = null;
      if (!result) { await this.readCurrent(r); if (!r.current()) return; this.clearInput(); this.update({ unknown: false, selected: null, notice: '原預留操作已確認，但結果不可讀取；沒有確認保存。請重新選圖。' }); return; }
      this.upload = result.upload;
    }
    if (!this.upload) return;
    if (this.upload.state === 'reserved') {
      if (!this.input) { this.update({ unknown: true, retryAvailable: false, notice: '本機選圖已清除；請查核原上傳，不會重新傳送圖片。' }); return; }
      const uploaded = await this.api.uploadContent(this.upload, fromByteArray(this.input.bytes), r.signal, userId); if (!r.current()) return; this.upload = uploaded;
    }
    if (this.upload.state === 'committed') { await this.complete(r, null); return; }
    if (this.upload.state !== 'ready') { this.update({ unknown: true, notice: '原圖片仍在處理，請稍後查核同一上傳。' }); return; }
    this.command = { kind: 'commit', input: { uploadId: this.upload.id, expectedVersion: this.upload.expectedVersion } };
    const result = await this.api.commit(target, this.command.input, r.signal, userId); if (!r.current()) return;
    await this.complete(r, result?.cleanupPending ?? null);
  }
  private async complete(r: NonNullable<ReturnType<AvatarLane['begin']>>, cleanupPending: boolean | null, kind: 'commit' | 'remove' = 'commit') {
    this.command = null; this.upload = null; this.clearInput(); this.needsRead = true; this.update({ selected: null, unknown: true, retryAvailable: false });
    await this.readCurrent(r); if (!r.current()) return; this.needsRead = false; this.update({ unknown: false });
    this.update({ notice: kind === 'remove'
      ? cleanupPending === null ? '原移除操作已確認，已重新讀取目前頭像。' : cleanupPending ? '頭像已移除，舊圖片仍在安全清理中。' : '頭像已移除。'
      : cleanupPending === null ? '原操作已確認，已重新讀取目前頭像。' : cleanupPending ? '頭像已保存，舊圖片仍在安全清理中。' : '頭像已保存。' });
  }
  async save() {
    if (!this.canStart() || !this.state.available || this.hasPending() || this.state.conflict || !this.state.avatar?.canManage || !this.input || !this.state.policy || this.basis === null) return;
    const r = this.begin(true); if (!r) return;
    try {
      const sha256 = await photoSha256(this.input.bytes); if (!r.current() || !this.input) return;
      this.command = { kind: 'reserve', input: { expectedVersion: this.basis, policyId: this.state.policy!.policyId,
        mimeType: this.input.mimeType, bytes: this.input.bytes.length, sha256, crop: { ...this.state.crop } } };
      await this.execute(r);
    } catch (error) { if (r.same()) this.failure(error, true); } finally { r.finish(); }
  }
  async remove(expectedVersion = this.state.avatar?.version) {
    if (!this.canStart() || !this.state.available || this.hasPending() || !this.state.avatar?.canManage || !this.state.avatar.asset || this.state.avatar.version !== expectedVersion) return;
    const r = this.begin(true); if (!r) return;
    this.command = { kind: 'remove', input: { expectedVersion, confirmRemove: true } };
    try { await this.execute(r); } catch (error) { if (r.same()) this.failure(error, true); } finally { r.finish(); }
  }
  async check() {
    if (!this.state.unknown) return;
    const r = this.begin(true); if (!r) return;
    try {
      if (this.api.hasPendingOnline(r.context.target)) {
        const receipt = await this.api.reconcilePending(r.context.target, r.signal, r.context.userId); if (!r.current()) return;
        if (receipt?.state !== 'confirmed') {
          if (!this.state.available || !this.state.avatar?.canManage) await this.readCurrent(r); if (!r.current()) return;
          const canRetry = receipt?.state === 'unconfirmed' && !!this.state.avatar?.canManage && (this.command?.kind !== 'reserve' || !!this.input);
          this.update({ unknown: true, retryAvailable: canRetry, notice: canRetry ? '原操作仍未確認；只可明確重試同一操作，不會換操作編號。' : '原操作仍待確認；本機選圖或修改權限已清除，只查核原操作，不會重新傳送圖片。' }); return;
        }
        this.command = null;
        if (receipt.kind !== 'reserve') { await this.complete(r, receipt.result?.cleanupPending ?? null, receipt.kind); return; }
        if (!receipt.result) { await this.readCurrent(r); if (!r.current()) return; this.clearInput(); this.update({ unknown: false, selected: null, notice: '原預留已確認但結果不可讀取，沒有確認保存；請重新選圖。' }); return; }
        this.upload = receipt.result.upload;
      }
      if (this.upload) {
        const upload = await this.api.uploadStatus(r.context.target, this.upload.id, r.signal, r.context.userId); if (!r.current()) return; this.upload = upload;
        if (this.upload.state === 'committed') { await this.complete(r, null); return; }
        if (this.upload.state === 'expired' || this.upload.state === 'rejected') {
          this.upload = null; this.command = null; this.update({ unknown: false, notice: '原圖片未被採用；原有頭像保留，可重新保存或取消選圖。' }); return;
        }
        if (this.upload.state === 'reserved' && !this.input) {
          // The original reservation is confirmed and has no published content; dropping local staging is not a remote cancellation.
          this.upload = null; this.command = null; this.update({ unknown: false, retryAvailable: false });
          await this.readCurrent(r); if (r.current()) this.update({ notice: '原預留已核對，本機選圖已清除；沒有保存新頭像，可重新選圖。' }); return;
        }
        if (!this.state.available || !this.state.avatar?.canManage) await this.readCurrent(r); if (!r.current() || !this.upload) return;
        const canRetry = !!this.state.avatar?.canManage && ['reserved','ready'].includes(this.upload.state);
        this.update({ unknown: true, retryAvailable: canRetry, notice: this.upload.state === 'processing'
          ? '原圖片仍在處理，請稍後查核。' : canRetry ? '已核對原上傳，可繼續同一操作。' : '原上傳已核對，但目前沒有修改權限；只可查核，不會另行傳送圖片。' }); return;
      }
      await this.readCurrent(r); if (r.current()) { this.needsRead = false; this.update({ unknown: false, notice: '已重新讀取目前頭像。' }); }
    } catch (error) { if (r.same()) this.failure(error, true); } finally { r.finish(); }
  }
  async retry() {
    if (!this.state.unknown || !this.state.retryAvailable) return;
    const r = this.begin(true); if (!r) return;
    try { await this.execute(r); } catch (error) { if (r.same()) this.failure(error, true); } finally { r.finish(); }
  }
  dispose() { this.syncContext(null, false); this.listeners.clear(); }
}
export class AvatarOwner {
  readonly self: AvatarLane; readonly child: AvatarLane;
  constructor(api: AvatarApi, accessLost: (error: { status: number; code: string | null; target: AvatarTarget }) => void, canStart: () => boolean, changed: () => void) {
    this.self = new AvatarLane(api, accessLost, canStart, changed); this.child = new AvatarLane(api, accessLost, canStart, changed);
  }
  hasPending = () => this.self.hasPending() || this.child.hasPending();
  syncContext(identity: { key: string; userId: string } | null, child: { key: string; childId: string } | null, online: boolean) {
    this.self.syncContext(identity ? { ...identity, target: { kind: 'self' } } : null, online);
    this.child.syncContext(identity && child ? { key: child.key, userId: identity.userId, target: { kind: 'child', childId: child.childId } } : null, online);
  }
  invalidate() { this.self.invalidate(); this.child.invalidate(); }
  dispose() { this.self.dispose(); this.child.dispose(); }
}
