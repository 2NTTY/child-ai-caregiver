import { z } from "zod";
import { AccountApiError, createAccountApi, type PreparedAccountDeletion } from "../../../src/client/account-api.ts";
import { createAccountAuthApi } from "../../../src/client/account-auth-api.ts";
import { ClientApiError } from "../../../src/client/records-api.ts";
import { SERVICE_POLICY_VERSION, type AccountServiceStatus, type AccountExportPage, type AccountEraseReceipt } from "../../../src/shared/account-service.ts";

export type AccountGateState = "checking" | "error" | "verification" | "consent" | "ready";
export interface AccountServiceSnapshot {
  userId: string | null; online: boolean; gate: AccountGateState; status: AccountServiceStatus | null;
  busy: "status" | "consent" | "mail" | "reset" | "sessions" | "download" | "prepare" | "delete" | "check" | null;
  notice: string | null;
  callback: null | { kind: "verified" | "reset" | "invalid"; phase: "form" | "done"; message: string };
  download: { phase: "idle" | "partial" | "complete" | "error"; parts: number; message: string | null };
  deletion: { phase: "idle" | "prepared" | "unknown" | "completed"; childCount: number | null; attachmentsPending: boolean; message: string | null };
}
export interface AccountServiceDependencies { api?: ReturnType<typeof createAccountApi>; authApi?: ReturnType<typeof createAccountAuthApi>; legacyTrial?: boolean;
  reauthentication?: { reauthenticate(userId: string, password: string, signal: AbortSignal): Promise<void> } }
export interface ParsedAccountCallback { kind: "verified" | "reset" | "invalid"; token: string | null; cleanUrl: string }
/** Only the callback marker and opaque token are consumed; remote error text is never displayed. */
export function parseAccountCallback(value: string): ParsedAccountCallback | null {
  const url = new URL(value);
  const kind = url.searchParams.get("account");
  if (!kind) return null;
  const token = url.searchParams.get("token"), failed = url.searchParams.has("error");
  url.searchParams.delete("account"); url.searchParams.delete("token"); url.searchParams.delete("error");
  return { kind: !failed && kind === "verified" ? "verified" : !failed && kind === "reset" && token && /^[A-Za-z0-9_-]{1,512}$/u.test(token) ? "reset" : "invalid",
    token: !failed && kind === "reset" && token && /^[A-Za-z0-9_-]{1,512}$/u.test(token) ? token : null, cleanUrl: url.pathname + url.search + url.hash };
}
const manifestSchema = z.object({ format: z.literal("yuban-personal-data:1"), sections: z.array(z.object({ section: z.string().min(1).max(80), childScoped: z.boolean(), required: z.literal(true) }).strict()).min(1).max(80) }).passthrough();
interface ExportPartPage extends AccountExportPage { childId: string | null }
interface DownloadContinuation {
  scopeVersion: string; global: string[]; childScoped: string[]; childIds: string[];
  globalIndex: number; childIndex: number; childSectionIndex: number; cursor?: string;
  pages: ExportPartPage[]; bytes: number; done: boolean;
}
const emptyDownload = (): AccountServiceSnapshot["download"] => ({ phase: "idle", parts: 0, message: null });
const emptyDeletion = (): AccountServiceSnapshot["deletion"] => ({ phase: "idle", childCount: null, attachmentsPending: false, message: null });
function initial(online: boolean): AccountServiceSnapshot { return { userId: null, online, gate: "checking", status: null, busy: null, notice: null, callback: null, download: emptyDownload(), deletion: emptyDeletion() }; }
function gateFor(status: AccountServiceStatus, userId: string | null): AccountGateState {
  if (!userId) return "checking";
  if (!status.enabled) return "ready";
  if (!status.user?.emailVerified) return "verification";
  return status.user.acknowledged && status.policyVersion === SERVICE_POLICY_VERSION && status.user.acknowledgementVersion === SERVICE_POLICY_VERSION ? "ready" : "consent";
}
function errorMessage(error: unknown): string {
  const code = error instanceof AccountApiError ? error.code : null;
  if (error instanceof ClientApiError && error.onlineCode === "firebase_reauthentication_required") return "請先登出並重新登入，再明確要求電郵驗證指引。重新載入頁面後，原登入資料不會保留。";
  if (error instanceof ClientApiError && error.onlineCode === "auth_provider_unavailable") return "身份服務設定未完整，暫時不能處理登入或電郵指引。";
  if (code === "shared_workspace_requires_resolution") return "這個帳戶仍與其他成員共享資料。請先處理共享家庭的責任及成員，再重新核對退出範圍。";
  if (code === "password_verification_failed") return "未能確認密碼。請重新輸入；尚未刪除帳戶。";
  if (code === "erasure_receipt_expired" || code === "account_scope_changed") return "退出範圍或確認期限已改變。請查核原操作，再重新核對範圍。";
  if (code === "export_scope_changed" || code === "access_denied") return "資料範圍已改變。這次下載未完整，請棄用這次分批檔案，重新開始。";
  if (error instanceof AccountApiError && error.status === 429 || error instanceof ClientApiError && error.status === 429) return "嘗試次數過多，請稍後再試。";
  return "暫時未能確認結果，請檢查連線後沿原操作繼續。";
}

/** Account admission and data exit have one owner; secrets and download pages stay only in memory. */
export class AccountServiceOwner {
  private readonly api; private readonly authApi; private readonly legacyTrial;
  private readonly onDeleted: () => void; private readonly onAccessLost: () => void;
  private snapshot: AccountServiceSnapshot; private context: string | null | undefined; private epoch = 0;
  private request: AbortController | null = null; private resetToken: string | null = null; private callbackUserId: string | null = null;
  private receipt: Pick<PreparedAccountDeletion, "operationId" | "receiptToken"> | null = null;
  private deletionUserId: string | null = null; private acknowledgementId: string | null = null;
  private continuation: DownloadContinuation | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(baseUrl: string, online: boolean, onDeleted: () => void, onAccessLost: () => void, dependencies: AccountServiceDependencies = {}) {
    this.onDeleted = onDeleted; this.onAccessLost = onAccessLost;
    this.api = dependencies.api ?? createAccountApi(baseUrl, fetch, dependencies.reauthentication); this.authApi = dependencies.authApi ?? createAccountAuthApi(baseUrl);
    this.legacyTrial = dependencies.legacyTrial === true; this.snapshot = initial(online);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AccountServiceSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  isReady = () => this.snapshot.gate === "ready" && !!this.snapshot.userId;
  hasPending = () => this.snapshot.deletion.phase === "prepared" || this.snapshot.deletion.phase === "unknown" || !!this.snapshot.busy && this.snapshot.busy !== "status";
  syncContext(userId: string | null, online: boolean, identityKey: string | null) {
    if (identityKey !== this.context) {
      const callbackChanged = !!userId && !!this.callbackUserId && userId !== this.callbackUserId;
      if (callbackChanged) { this.resetToken = null; this.callbackUserId = null; }
      else if (userId && this.snapshot.callback) this.callbackUserId = userId;
      const retainUnknown = !userId && this.snapshot.deletion.phase === "unknown" && !!this.receipt;
      this.request?.abort(); this.request = null; this.epoch++; this.context = identityKey;
      this.api.setIdentity(userId); this.acknowledgementId = null; this.continuation = null;
      if (!retainUnknown) { this.receipt = null; this.deletionUserId = null; }
      const recovery = userId ? this.api.deletionRecovery() : null;
      if (recovery?.receiptToken) { this.receipt = { operationId: recovery.operationId, receiptToken: recovery.receiptToken }; this.deletionUserId = userId; }
      this.update({ ...initial(online), userId, callback: callbackChanged ? null : this.snapshot.callback,
        notice: this.snapshot.deletion.phase === "completed" && !userId ? this.snapshot.deletion.message : null,
        deletion: retainUnknown ? this.snapshot.deletion : recovery?.receiptToken ? { ...emptyDeletion(), phase: "unknown", message: "請先查核這個帳戶原來的退出結果。" } : emptyDeletion() });
      if (online && !retainUnknown) void this.loadStatus();
    } else if (online !== this.snapshot.online) {
      if (!online) { this.request?.abort(); this.request = null; this.epoch++; }
      this.update({ online, ...(!online ? { busy: null } : {}) });
      if (online && !this.snapshot.status && this.snapshot.deletion.phase !== "unknown") void this.loadStatus();
    }
  }
  private begin(busy: AccountServiceSnapshot["busy"]) {
    if (!this.snapshot.online || this.snapshot.busy) return null;
    const ticket = { epoch: this.epoch, userId: this.snapshot.userId, controller: new AbortController() };
    this.request = ticket.controller; this.update({ busy, notice: null }); return ticket;
  }
  private current(ticket: { epoch: number; userId: string | null; controller: AbortController }) { return ticket.epoch === this.epoch && ticket.userId === this.snapshot.userId && !ticket.controller.signal.aborted; }
  private finish(ticket: { epoch: number; userId: string | null; controller: AbortController }) { if (this.request === ticket.controller) { this.request = null; this.update({ busy: null }); } }
  async loadStatus() {
    const ticket = this.begin("status"); if (!ticket) return;
    try {
      let status: AccountServiceStatus;
      try { status = await this.api.status(ticket.userId, ticket.controller.signal); }
      catch (error) {
        if (!this.legacyTrial || !(error instanceof AccountApiError) || error.status !== 404) throw error;
        status = { enabled: false, registration: "trial", mailConfigured: false, policyVersion: "legacy-trial", notice: "目前為舊版合成資料試用服務。", user: null };
      }
      if (this.current(ticket)) this.update({ status, gate: gateFor(status, ticket.userId) });
    } catch (error) {
      if (this.current(ticket)) { this.update({ status: null, gate: "error", notice: "未能確認帳戶服務；私人內容已隱藏。請重新檢查。" });
        if (error instanceof AccountApiError && (error.status === 401 || error.code === "session_changed")) this.onAccessLost(); }
    } finally { this.finish(ticket); }
  }
  async acknowledge() {
    if (!this.snapshot.userId || this.snapshot.gate !== "consent") return;
    const ticket = this.begin("consent"); if (!ticket?.userId) return;
    this.acknowledgementId ??= crypto.randomUUID();
    try { const status = await this.api.acknowledge(ticket.userId, this.acknowledgementId, ticket.controller.signal);
      if (this.current(ticket)) this.update({ status, gate: gateFor(status, ticket.userId) });
    } catch (error) { if (this.current(ticket)) this.update({ notice: errorMessage(error) }); }
    finally { this.finish(ticket); }
  }
  async requestEmail(kind: "verification" | "reset", email: string) {
    if (this.snapshot.status?.mailConfigured !== true || !/^\S+@\S+\.\S+$/u.test(email.trim())) { this.update({ notice: "請核對電郵地址及帳戶服務是否可用。" }); return; }
    const ticket = this.begin("mail"); if (!ticket) return;
    try { await (kind === "verification" ? this.authApi.requestVerification : this.authApi.requestPasswordReset)(email.trim(), ticket.controller.signal);
      if (this.current(ticket)) this.update({ notice: "請求已處理。如符合條件，你會收到下一步指引；這並不代表電郵已送達。" });
    } catch (error) { if (this.current(ticket)) this.update({ notice: errorMessage(error) }); }
    finally { this.finish(ticket); }
  }
  acceptCallback(callback: ParsedAccountCallback) {
    this.callbackUserId = this.snapshot.userId;
    this.resetToken = callback.kind === "reset" ? callback.token : null;
    this.update({ callback: { kind: callback.kind, phase: "form", message: callback.kind === "verified" ? "電郵驗證流程已返回。請正常登入，重新確認帳戶狀態。" : callback.kind === "reset" ? "請設定至少 12 個字元的新密碼。" : "這個連結無效或已過期。請重新要求驗證或重設密碼指引。" } });
  }
  closeCallback() { this.resetToken = null; this.callbackUserId = null; this.update({ callback: null }); }
  async resetPassword(password: string) {
    if (!this.resetToken || password.length < 12 || password.length > 128) return;
    const ticket = this.begin("reset"); if (!ticket) return;
    try { await this.authApi.resetPassword(this.resetToken, password, ticket.controller.signal);
      if (this.current(ticket)) { this.resetToken = null; this.update({ callback: { kind: "reset", phase: "done", message: "密碼已重設。請使用新密碼正常登入。" } }); } }
    catch { if (this.current(ticket)) this.update({ callback: { kind: "reset", phase: "form", message: "未能確認重設成功。連結可能已過期或已用；請重新要求重設指引。" } }); }
    finally { this.finish(ticket); }
  }
  async revokeOtherSessions() {
    if (!this.isReady() || this.hasPending()) return;
    const ticket = this.begin("sessions"); if (!ticket?.userId) return;
    try { await this.authApi.revokeOtherSessions(ticket.userId, ticket.controller.signal); if (this.current(ticket)) this.update({ notice: "Server 已確認撤銷其他登入會話；目前會話保留。" }); }
    catch (error) { if (this.current(ticket)) this.update({ notice: errorMessage(error) }); }
    finally { this.finish(ticket); }
  }
  async prepareDeletion() {
    if (!this.isReady() || this.snapshot.deletion.phase !== "idle") return;
    const ticket = this.begin("prepare"); if (!ticket?.userId) return;
    try { const receipt = await this.api.prepareDeletion(ticket.userId, ticket.controller.signal);
      if (this.current(ticket)) { this.receipt = receipt; this.deletionUserId = ticket.userId;
        this.update({ deletion: { phase: receipt.state === "completed" ? "completed" : "prepared", childCount: receipt.summary.childCount, attachmentsPending: receipt.attachmentsPending, message: null } });
        if (receipt.state === "completed") this.confirmCompleted(receipt); }
    } catch (error) { if (this.current(ticket)) this.update({ notice: errorMessage(error) }); }
    finally { this.finish(ticket); }
  }
  async cancelPreparedDeletion() {
    if (this.snapshot.deletion.phase !== "prepared" || !this.snapshot.userId) return;
    const ticket = this.begin("check"); if (!ticket?.userId) return;
    try { await this.api.discardPreparedDeletion(ticket.userId, ticket.controller.signal);
      if (this.current(ticket)) { this.receipt = null; this.deletionUserId = null; this.update({ deletion: emptyDeletion() }); } }
    catch (error) { if (this.current(ticket)) this.update({ deletion: { ...this.snapshot.deletion, phase: "unknown", message: errorMessage(error) } }); }
    finally { this.finish(ticket); }
  }
  async executeDeletion(password: string, confirmation: string) {
    if (!this.isReady() || this.snapshot.deletion.phase !== "prepared" || !this.receipt || this.deletionUserId !== this.snapshot.userId || confirmation !== "永久刪除我的帳戶" || !password || password.length > 128) return;
    const ticket = this.begin("delete"); if (!ticket?.userId) return;
    this.update({ deletion: { ...this.snapshot.deletion, phase: "unknown", message: "正在確認原退出操作；確認完成前請保留此頁。" } });
    try { const result = await this.api.executeDeletion(ticket.userId, { password, confirmation }, ticket.controller.signal);
      if (this.current(ticket)) result.state === "completed" ? this.confirmCompleted(result) : this.update({ deletion: { ...this.snapshot.deletion, phase: "unknown",
        message: result.state === 'processing' ? '帳戶存取已停止，Server 正在分批清理；請查核原結果，不要重新提交。' : "Server 尚未確認刪除完成，請查核原結果。" } }); }
    catch (error) { if (this.current(ticket)) { const definite = error instanceof AccountApiError && ["password_verification_failed", "erasure_receipt_expired", "account_scope_changed", "invalid_input"].includes(error.code ?? "") && error.status >= 400 && error.status < 500;
      this.update({ deletion: { ...this.snapshot.deletion, phase: definite ? "prepared" : "unknown", message: errorMessage(error) } }); } }
    finally { this.finish(ticket); }
  }
  private confirmCompleted(result: AccountEraseReceipt) {
    this.receipt = null; this.deletionUserId = null; this.continuation = null;
    this.update({ gate: "checking", status: null, deletion: { phase: "completed", childCount: null, attachmentsPending: result.attachmentsPending, message: result.attachmentsPending ? "帳戶已刪除；附件仍在 Server 清理隊列中。" : "Server 已確認帳戶及附屬資料刪除。" } });
    this.onDeleted();
  }
  async checkDeletion() {
    if (this.snapshot.deletion.phase !== "unknown" || !this.receipt) return;
    const ticket = this.begin("check"); if (!ticket) return;
    try {
      const result = await this.api.deletionStatus(this.receipt, ticket.controller.signal);
      if (!this.current(ticket)) return;
      if (result.state === "completed") this.confirmCompleted(result);
      else if (result.state === 'processing') this.update({ deletion: { ...this.snapshot.deletion, phase: 'unknown', attachmentsPending: true,
        message: '帳戶存取已停止，Server 正在分批清理；請查核原結果，不要重新提交。' } });
      else if (ticket.userId) {
        const prepared = await this.api.prepareDeletion(ticket.userId, ticket.controller.signal, this.receipt.operationId);
        if (!this.current(ticket)) return;
        if (prepared.state === "completed") this.confirmCompleted(prepared);
        else this.update({ deletion: { phase: "prepared", childCount: prepared.summary.childCount, attachmentsPending: prepared.attachmentsPending,
          message: "Server 已查核原操作尚未完成。請重新核對範圍，然後使用原操作確認或取消。" } });
      } else this.update({ deletion: { ...this.snapshot.deletion, phase: "unknown", attachmentsPending: result.attachmentsPending,
        message: "Server 已查核原操作尚未完成。請以原帳戶登入後再核對；原收據只保留在此頁記憶中。" } });
    }
    catch (error) { if (this.current(ticket)) this.update({ deletion: { ...this.snapshot.deletion, message: errorMessage(error) } }); }
    finally { this.finish(ticket); }
  }
  clearDownload() { if (this.snapshot.busy !== "download") { this.continuation = null; this.update({ download: emptyDownload() }); } }
  /** At most 40 Server pages / about 4 MiB per file; continuation contains only metadata and the current bounded part. */
  async downloadNextPart(save: (text: string, filename: string) => void | Promise<void>) {
    if (!this.isReady() || this.snapshot.deletion.phase !== "idle" || this.snapshot.download.phase === "complete") return;
    const ticket = this.begin("download"); if (!ticket?.userId) return;
    try {
      if (!this.continuation) {
        const manifest = await this.api.exportPage(ticket.userId, { section: "manifest" }, ticket.controller.signal);
        if (!this.current(ticket)) return;
        const definition = manifestSchema.parse(manifest.items[0]);
        if (!manifest.complete || !definition.sections.some(item => item.section === "children" && !item.childScoped)) throw new AccountApiError();
        this.continuation = { scopeVersion: manifest.scopeVersion, global: ["children", ...definition.sections.filter(item => !item.childScoped && item.section !== "children").map(item => item.section)],
          childScoped: definition.sections.filter(item => item.childScoped).map(item => item.section), childIds: [], globalIndex: 0, childIndex: 0, childSectionIndex: 0,
          pages: [{ ...manifest, childId: null }], bytes: JSON.stringify(manifest).length * 2, done: false };
      }
      const continuation = this.continuation;
      while (!continuation.done && continuation.pages.length < 40 && continuation.bytes < 4 * 1024 * 1024) {
        const global = continuation.globalIndex < continuation.global.length;
        if (!global && (continuation.childIndex >= continuation.childIds.length || !continuation.childScoped.length)) { continuation.done = true; break; }
        const section = global ? continuation.global[continuation.globalIndex] : continuation.childScoped[continuation.childSectionIndex];
        const childId = global ? undefined : continuation.childIds[continuation.childIndex];
        const page = await this.api.exportPage(ticket.userId, { section, ...(childId ? { childId } : {}), scopeVersion: continuation.scopeVersion, ...(continuation.cursor ? { cursor: continuation.cursor } : {}) }, ticket.controller.signal);
        if (!this.current(ticket)) return;
        if (page.nextCursor && page.nextCursor === continuation.cursor) throw new AccountApiError(0, "invalid_export_cursor");
        if (section === "children") for (const item of page.items) { const id = z.object({ id: z.uuid() }).passthrough().parse(item).id;
          if (!continuation.childIds.includes(id)) continuation.childIds.push(id);
          if (continuation.childIds.length > 10000) throw new AccountApiError(409, "export_scope_changed"); }
        continuation.pages.push({ ...page, childId: childId ?? null }); continuation.bytes += JSON.stringify(page).length * 2;
        continuation.cursor = page.nextCursor ?? undefined;
        if (!continuation.cursor) { if (global) continuation.globalIndex++; else if (++continuation.childSectionIndex >= continuation.childScoped.length) { continuation.childSectionIndex = 0; continuation.childIndex++; } }
      }
      // A file is handed out only under the original scope; the final check also gates complete.
      await this.api.exportPage(ticket.userId, { section: "manifest", scopeVersion: continuation.scopeVersion }, ticket.controller.signal);
      if (!this.current(ticket)) return;
      const part = this.snapshot.download.parts + 1;
      const text = JSON.stringify({ format: "yuban-personal-data:1", scopeVersion: continuation.scopeVersion, part, complete: continuation.done, pages: continuation.pages }, null, 2);
      await save(text, `yuban-personal-data-part-${String(part).padStart(3, "0")}.json`);
      if (!this.current(ticket)) return;
      continuation.pages = []; continuation.bytes = 0;
      this.update({ download: { phase: continuation.done ? "complete" : "partial", parts: part,
        message: continuation.done ? `已把全部 ${part} 份檔案交給瀏覽器下載。請保留同一次的所有分批檔案，並檢查下載是否完成。` : `第 ${part} 份檔案已交給瀏覽器下載；資料尚未完整，請繼續下載下一份。` } });
      if (continuation.done) this.continuation = null;
    } catch (error) {
      if (this.current(ticket)) { if (error instanceof AccountApiError && ["export_scope_changed", "access_denied", "session_changed"].includes(error.code ?? "")) this.continuation = null;
        this.update({ download: { ...this.snapshot.download, parts: this.continuation ? this.snapshot.download.parts : 0, phase: "error", message: errorMessage(error) } }); }
    } finally { this.finish(ticket); }
  }
  dispose() { this.request?.abort(); this.epoch++; this.resetToken = null; this.receipt = null; this.continuation = null; this.api.setIdentity(null); this.listeners.clear(); }
}
