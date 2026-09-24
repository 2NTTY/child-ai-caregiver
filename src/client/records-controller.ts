import { validateCreateChild, validateCreateTextRecord } from "../shared/inputs.ts";
import type { Child, TextRecord } from "../shared/records.ts";
import { ClientApiError, type AuthMode, type Credentials, type RecordsApi, type SessionUser } from "./records-api.ts";

type Outcome = "draft" | "sending" | "unknown" | "checked";
export interface RecordDraft {
  text: string;
  outcome: Outcome;
  message: string | null;
  receipt: TextRecord | null;
}

export interface RecordsState {
  auth: "checking" | "signedOut" | "signedIn" | "unavailable";
  user: SessionUser | null;
  online: boolean;
  busy: "auth" | "logout" | "createChild" | "saveRecord" | "deleteChild" | null;
  notice: string | null;
  children: Child[];
  childrenLoading: boolean;
  childrenError: string | null;
  childrenLoadedAt: string | null;
  selectedChildId: string | null;
  childName: string;
  childOutcome: Outcome;
  childMessage: string | null;
  records: TextRecord[];
  recordsLoading: boolean;
  recordsError: string | null;
  recordsLoadedAt: string | null;
  recordLimit: number;
  drafts: Record<string, RecordDraft>;
  confirmation: { childId: string; text: string } | null;
  logoutConfirmation: boolean;
  deletion: { childId: string; phase: "confirm" | "unknown" | "checked"; message: string | null } | null;
  hasRetainedInput: boolean;
}

interface ChildDeletionEvents {
  begin(childId: string): boolean;
  release(childId: string): void;
  forget(childId: string): void;
  reconcile(childIds: string[], pendingDeletionId: string | null): void;
}

interface RetainedInput {
  userId: string;
  childName: string;
  childOutcome: Outcome;
  selectedChildId: string | null;
  drafts: Record<string, RecordDraft>;
}

interface RequestScope {
  epoch: number;
  userId: string;
  controller: AbortController;
}

const UNKNOWN_WRITE = "尚未確認保存，結果未知。請先重新讀取；系統會查核原操作，再讓你重試同一項提交。";
const SESSION_EXPIRED = "登入已失效或帳號已改變。未提交內容已隱藏，只留在本頁；登入同一帳號後才能恢復。";
const OFFLINE = "目前未能連線，畫面資料可能過期；輸入尚未保存，請連線後重新讀取。";

function emptyDraft(): RecordDraft {
  return { text: "", outcome: "draft", message: null, receipt: null };
}

function initialState(online: boolean): RecordsState {
  return {
    auth: "checking", user: null, online, busy: null, notice: null,
    children: [], childrenLoading: false, childrenError: null, childrenLoadedAt: null,
    selectedChildId: null, childName: "", childOutcome: "draft", childMessage: null,
    records: [], recordsLoading: false, recordsError: null, recordsLoadedAt: null, recordLimit: 100,
    drafts: {}, confirmation: null, logoutConfirmation: false, deletion: null, hasRetainedInput: false,
  };
}

function isUnknown(error: unknown): boolean {
  return !(error instanceof ClientApiError) || error.status === 0 || error.status >= 500
    || ["operation_pending", "operation_busy", "operation_mismatch", "storage_epoch_changed"].includes(error.onlineCode ?? "");
}

function isSessionInvalid(error: unknown): boolean {
  return error instanceof ClientApiError && (error.status === 401 || error.status === 409 && (!error.onlineCode || error.onlineCode === "session_changed"));
}

function hasInput(input: { childName: string; drafts: Record<string, RecordDraft> }): boolean {
  return input.childName.length > 0 || Object.values(input.drafts).some(draft => draft.text.length > 0);
}

/** Page-memory state only. Each account generation owns all requests and drafts. */
export class RecordsController {
  private state: RecordsState;
  private readonly api: RecordsApi;
  private listeners = new Set<() => void>();
  private requests = new Set<AbortController>();
  private epoch = 0;
  private recordRequest = 0;
  private recordAbort: AbortController | null = null;
  private retained: RetainedInput | null = null;
  private readonly childDeletion?: ChildDeletionEvents;

  constructor(api: RecordsApi, online = true, childDeletion?: ChildDeletionEvents) {
    this.api = api;
    this.childDeletion = childDeletion;
    this.state = initialState(online);
  }

  getSnapshot = (): RecordsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hasUnsavedInput = (): boolean => hasInput(this.state) || Boolean(this.retained && hasInput(this.retained));
  usesOnlineReceipts = (): boolean => Boolean(this.api.reconcilePending);

  private async reconcileOnline(scope: RequestScope): Promise<void> {
    if (!this.api.reconcilePending || !this.api.hasPendingOnline?.()) return;
    const receipt = await this.api.reconcilePending(scope.controller.signal, scope.userId);
    if (!this.current(scope) || !await this.verifyIdentity(scope) || receipt?.state !== "confirmed") return;
    const path = receipt.path ?? "";
    if (path === "/api/children") {
      this.update({ childName: "", childOutcome: "draft", childMessage: "Server 已確認原來的建立操作；以下顯示目前仍可存取的孩子。" });
    } else {
      const match = /^\/api\/children\/([^/]+)\/(records|delete)$/u.exec(path);
      if (match?.[2] === "records") this.updateDraft(match[1], { text: "", outcome: "draft", receipt: null, message: "Server 已確認原提交；以下重新讀取目前記錄，毋須再提交。" });
      if (match?.[2] === "delete") this.forgetChild(match[1]);
    }
  }

  private update(patch: Partial<RecordsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateDraft(childId: string, patch: Partial<RecordDraft>): void {
    this.update({ drafts: { ...this.state.drafts, [childId]: { ...(this.state.drafts[childId] ?? emptyDraft()), ...patch } } });
  }

  private forgetChild(childId: string): void {
    const unresolvedDeletion = this.state.deletion?.childId === childId && this.state.deletion.phase === "unknown";
    this.childDeletion?.forget(childId);
    const selected = this.state.selectedChildId === childId;
    if (selected) {
      this.recordAbort?.abort();
      this.recordRequest += 1;
      this.recordAbort = null;
    }
    const drafts = { ...this.state.drafts };
    delete drafts[childId];
    if (this.retained) {
      const retainedDrafts = { ...this.retained.drafts };
      delete retainedDrafts[childId];
      this.retained = { ...this.retained, drafts: retainedDrafts,
        selectedChildId: this.retained.selectedChildId === childId ? null : this.retained.selectedChildId };
    }
    this.update({ drafts, selectedChildId: selected ? null : this.state.selectedChildId,
      records: selected ? [] : this.state.records,
      recordsLoading: selected ? false : this.state.recordsLoading,
      recordsError: selected ? null : this.state.recordsError,
      recordsLoadedAt: selected ? null : this.state.recordsLoadedAt,
      confirmation: this.state.confirmation?.childId === childId ? null : this.state.confirmation,
      deletion: this.state.deletion?.childId === childId ? null : this.state.deletion,
      notice: unresolvedDeletion
        ? "重新讀取後孩子已不在此帳號列表，本頁相關快取和草稿已清除；先前刪除請求的結果仍無法單獨確認。"
        : this.state.notice });
  }

  private abortRequests(): void {
    this.epoch += 1;
    this.recordRequest += 1;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.recordAbort = null;
  }

  private retainInput(): void {
    if (!this.state.user) return;
    const drafts = Object.fromEntries(Object.entries(this.state.drafts).map(([id, draft]) => [id, {
      ...draft,
      outcome: draft.outcome === "sending" || draft.outcome === "checked" ? "unknown" as const : draft.outcome,
      message: draft.outcome === "sending" ? UNKNOWN_WRITE : draft.message,
      receipt: null,
    }]));
    this.retained = {
      userId: this.state.user.id, childName: this.state.childName,
      childOutcome: this.state.childOutcome === "sending" || this.state.childOutcome === "checked" ? "unknown" : this.state.childOutcome,
      selectedChildId: this.state.selectedChildId, drafts,
    };
  }

  private gate(auth: RecordsState["auth"], notice: string | null): void {
    this.retainInput();
    this.abortRequests();
    this.update({ ...initialState(this.state.online), auth, notice, hasRetainedInput: Boolean(this.retained && hasInput(this.retained)) });
  }

  private scope(): RequestScope {
    const controller = new AbortController();
    this.requests.add(controller);
    return { epoch: this.epoch, userId: this.state.user?.id ?? "", controller };
  }

  private current(scope: RequestScope): boolean {
    return scope.epoch === this.epoch && scope.userId === this.state.user?.id && this.state.auth === "signedIn";
  }

  private release(scope: RequestScope): void {
    this.requests.delete(scope.controller);
  }

  private async verifyIdentity(scope: RequestScope): Promise<boolean> {
    try {
      const user = await this.api.getSession(scope.controller.signal);
      if (scope.controller.signal.aborted || !this.current(scope)) return false;
      if (!user || user.id !== scope.userId) {
        this.gate("signedOut", SESSION_EXPIRED);
        return false;
      }
      return true;
    } catch (error) {
      if (!scope.controller.signal.aborted && this.current(scope)) {
        this.gate(isSessionInvalid(error) ? "signedOut" : "unavailable", isSessionInvalid(error)
          ? SESSION_EXPIRED : "暫時未能確認登入狀態。未提交內容已隱藏，請連線後重新檢查；同一帳號可恢復本頁輸入。");
      }
      return false;
    }
  }

  private async activate(user: SessionUser): Promise<void> {
    const retained = this.retained?.userId === user.id ? this.retained : null;
    this.retained = null;
    this.update({
      ...initialState(this.state.online), auth: "signedIn", user,
      childName: retained?.childName ?? "", childOutcome: retained?.childOutcome ?? "draft",
      childMessage: retained && retained.childOutcome !== "draft" ? UNKNOWN_WRITE : null,
      drafts: retained?.drafts ?? {}, selectedChildId: retained?.selectedChildId ?? null,
    });
    await this.reloadChildren();
  }

  async restoreSession(): Promise<void> {
    this.gate("checking", null);
    if (!this.state.online) {
      this.update({ auth: "unavailable", notice: OFFLINE });
      return;
    }
    const epoch = this.epoch;
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const user = await this.api.getSession(controller.signal);
      if (epoch !== this.epoch) return;
      if (user) await this.activate(user);
      else this.update({ auth: "signedOut", notice: this.state.hasRetainedInput ? SESSION_EXPIRED : null });
    } catch (error) {
      if (epoch === this.epoch) this.update({ auth: isSessionInvalid(error) ? "signedOut" : "unavailable", notice: "未能確認登入狀態，請檢查連線後再試。" });
    } finally {
      this.requests.delete(controller);
    }
  }

  async authenticate(mode: AuthMode, input: Credentials): Promise<void> {
    if (this.state.busy || this.state.auth === "signedIn" || this.state.auth === "checking" || !this.state.online) return;
    if (!input.email.trim() || !input.password || (mode === "signUp" && (!input.name.trim() || input.password.length < 12))) {
      this.update({ notice: mode === "signUp" ? "請填寫稱呼、電郵及至少 12 個字元的密碼。" : "請填寫電郵及密碼。" });
      return;
    }
    this.gate("signedOut", null);
    this.update({ busy: "auth" });
    const epoch = this.epoch;
    const controller = new AbortController();
    this.requests.add(controller);
    let authenticated = false;
    try {
      await this.api.authenticate(mode, { ...input, name: input.name.trim(), email: input.email.trim() }, controller.signal);
      authenticated = true;
      const user = await this.api.getSession(controller.signal);
      if (epoch !== this.epoch) return;
      if (!user) {
        this.update({ busy: null, notice: "未能確認登入成功，請重新檢查登入狀態。" });
        return;
      }
      await this.activate(user);
    } catch (error) {
      const unconfirmed = isUnknown(error) || (authenticated && !isSessionInvalid(error));
      if (epoch === this.epoch) this.update({
        busy: null, auth: unconfirmed ? "unavailable" : "signedOut",
        notice: unconfirmed ? "登入或註冊結果未能確認，請先重新檢查登入狀態。"
          : error instanceof ClientApiError && error.status === 429 ? "嘗試次數過多，請稍後再試。"
          : mode === "signUp" ? "未能完成註冊，請核對資料；如已有帳號，請登入。" : "未能登入，請核對電郵及密碼後再試。",
      });
    } finally {
      this.requests.delete(controller);
    }
  }

  setOnline(online: boolean): void {
    if (online !== this.state.online) this.update({ online });
  }

  setChildName(childName: string): void {
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childOutcome !== "draft") return;
    this.update({ childName, childMessage: null });
  }

  setRecordText(text: string): void {
    const id = this.state.selectedChildId;
    if (this.state.auth !== "signedIn" || this.state.busy || !id || (this.state.drafts[id]?.outcome ?? "draft") !== "draft") return;
    this.updateDraft(id, { text, message: null, receipt: null });
    this.update({ confirmation: null });
  }

  async selectChild(childId: string): Promise<void> {
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childrenLoading || this.state.deletion
      || !this.state.children.some(child => child.id === childId)) return;
    this.recordAbort?.abort();
    this.recordRequest += 1;
    this.update({ selectedChildId: childId, records: [], recordsError: null, recordsLoadedAt: null, recordsLoading: false, confirmation: null });
    await this.reloadRecords();
  }

  async reloadChildren(): Promise<void> {
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childrenLoading) return;
    if (!this.state.online) {
      this.update({ childrenError: OFFLINE });
      return;
    }
    const scope = this.scope();
    this.update({ childrenLoading: true, childrenError: null, childOutcome: this.state.childOutcome === "checked" ? "unknown" : this.state.childOutcome });
    try {
      await this.reconcileOnline(scope);
      if (!this.current(scope)) return;
      const children = await this.api.listChildren(scope.controller.signal);
      if (!await this.verifyIdentity(scope)) return;
      this.childDeletion?.reconcile(children.map(child => child.id), this.state.deletion?.childId ?? null);
      const present = new Set(children.map(child => child.id));
      const known = new Set([...this.state.children.map(child => child.id), ...Object.keys(this.state.drafts),
        ...(this.state.selectedChildId ? [this.state.selectedChildId] : []),
        ...(this.state.deletion ? [this.state.deletion.childId] : [])]);
      for (const childId of known) {
        if (!present.has(childId)) this.forgetChild(childId);
      }
      this.update({
        children, childrenLoadedAt: new Date().toISOString(), childrenLoading: false,
        childOutcome: this.state.childOutcome === "unknown" ? "checked" : this.state.childOutcome,
        deletion: this.state.deletion?.phase === "unknown"
          ? { ...this.state.deletion, phase: "checked", message: "重新讀取後孩子仍在列表；請核對後才決定是否再次刪除。" }
          : this.state.deletion,
      });
      const id = children.some(child => child.id === this.state.selectedChildId) ? this.state.selectedChildId : children[0]?.id;
      if (id && !this.state.deletion) await this.selectChild(id);
      else if (!id) this.update({ selectedChildId: null, records: [], recordsLoadedAt: null, recordsError: null });
    } catch (error) {
      if (this.current(scope)) {
        if (isSessionInvalid(error)) this.gate("signedOut", SESSION_EXPIRED);
        else this.update({ childrenError: "未能讀取孩子列表；原有畫面可能過期，請重新讀取。" });
      }
    } finally {
      if (this.current(scope)) this.update({ childrenLoading: false });
      this.release(scope);
    }
  }

  reviewDeleteChild(): void {
    const childId = this.state.selectedChildId;
    const role = this.state.children.find(child => child.id === childId)?.accessRole;
    if (role && role !== "owner") return;
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childrenLoading || !this.state.online
      || this.state.deletion?.phase === "unknown" || !childId || !this.state.children.some(child => child.id === childId)) return;
    if (this.childDeletion && !this.childDeletion.begin(childId)) {
      this.update({ notice: "聊天尚未就緒，或正在提交／等候 AI 回覆；請稍後再試。" });
      return;
    }
    this.update({ deletion: { childId, phase: "confirm", message: null }, confirmation: null, notice: null });
  }

  cancelDeleteChild(): void {
    const deletion = this.state.deletion;
    if (!deletion || this.state.busy || deletion.phase === "unknown") return;
    this.childDeletion?.release(deletion.childId);
    this.update({ deletion: null });
  }

  async confirmDeleteChild(): Promise<void> {
    const deletion = this.state.deletion;
    const role = this.state.children.find(child => child.id === deletion?.childId)?.accessRole;
    if (role && role !== "owner") { this.cancelDeleteChild(); return; }
    if (!deletion || deletion.phase !== "confirm" || this.state.auth !== "signedIn" || this.state.busy
      || this.state.childrenLoading || !this.state.online || this.state.selectedChildId !== deletion.childId
      || !this.state.children.some(child => child.id === deletion.childId)) return;
    if (this.childDeletion && !this.childDeletion.begin(deletion.childId)) {
      this.update({ deletion: { ...deletion, message: "聊天尚未就緒，或正在提交／等候 AI 回覆；請稍後再試。" } });
      return;
    }
    const scope = this.scope();
    this.update({ busy: "deleteChild", deletion: { ...deletion, message: null } });
    try {
      if (!await this.verifyIdentity(scope)) return;
      await this.api.deleteChild(deletion.childId, scope.controller.signal, scope.userId);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      this.forgetChild(deletion.childId);
      const children = this.state.children.filter(child => child.id !== deletion.childId);
      this.update({ children, busy: null, notice: "Server 已確認永久刪除孩子及其全部已保存照顧記錄與私人聊天；本頁相關草稿已清除。" });
      if (children[0]) await this.selectChild(children[0].id);
    } catch (error) {
      if (this.current(scope)) {
        if (isSessionInvalid(error)) this.gate("signedOut", SESSION_EXPIRED);
        else if (isUnknown(error) || (error instanceof ClientApiError && error.status === 404)) {
          this.update({ deletion: { childId: deletion.childId, phase: "unknown",
            message: "刪除結果未能確認。請重新讀取孩子列表核對；孩子可能已在 Server 消失。" } });
        } else {
          this.childDeletion?.release(deletion.childId);
          this.update({ deletion: { ...deletion, message: "Server 未接納刪除；請核對後再試。" } });
        }
      }
    } finally {
      if (this.current(scope)) this.update({ busy: null });
      this.release(scope);
    }
  }

  async reloadRecords(): Promise<void> {
    const childId = this.state.selectedChildId;
    if (this.state.auth !== "signedIn" || this.state.busy || !childId) return;
    if (!this.state.online) {
      this.update({ recordsError: OFFLINE });
      return;
    }
    this.recordAbort?.abort();
    const sequence = ++this.recordRequest;
    const scope = this.scope();
    this.recordAbort = scope.controller;
    this.update({ recordsLoading: true, recordsError: null, confirmation: null });
    if (this.state.drafts[childId]?.outcome === "checked") this.updateDraft(childId, { outcome: "unknown" });
    try {
      await this.reconcileOnline(scope);
      if (!this.current(scope)) return;
      const list = await this.api.listRecords(childId, scope.controller.signal);
      if (!this.current(scope) || sequence !== this.recordRequest || this.state.selectedChildId !== childId) return;
      if (!await this.verifyIdentity(scope) || sequence !== this.recordRequest || this.state.selectedChildId !== childId) return;
      this.update({ records: list.records, recordLimit: list.limit, recordsLoadedAt: new Date().toISOString() });
      if (this.state.drafts[childId]?.outcome === "unknown") this.updateDraft(childId, { outcome: "checked" });
    } catch (error) {
      if (this.current(scope) && sequence === this.recordRequest) {
        if (isSessionInvalid(error)) this.gate("signedOut", SESSION_EXPIRED);
        else if (error instanceof ClientApiError && (error.status === 403 || error.status === 404)) {
          this.forgetChild(childId);
          this.update({ children: this.state.children.filter(child => child.id !== childId), notice: "孩子的存取權已失效或資料已刪除，本頁相關內容已清除。" });
        }
        else this.update({ recordsError: "未能讀取記錄；畫面資料可能過期，請重新讀取。" });
      }
    } finally {
      if (this.current(scope) && sequence === this.recordRequest) this.update({ recordsLoading: false });
      this.release(scope);
    }
  }

  async createChild(): Promise<void> {
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.deletion || this.state.childrenLoading || !this.state.online || this.state.childOutcome !== "draft") return;
    const validation = validateCreateChild({ displayName: this.state.childName });
    if (!validation.ok) {
      this.update({ childMessage: validation.issues[0].message });
      return;
    }
    const scope = this.scope();
    this.update({ busy: "createChild", childMessage: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      this.update({ childOutcome: "sending" });
      const child = await this.api.createChild(validation.value.displayName, scope.controller.signal, scope.userId);
      if (!this.current(scope)) return;
      // A later session-read outage cannot turn a confirmed create back into a new draft.
      this.update({ childName: "", childOutcome: "draft" });
      if (!await this.verifyIdentity(scope)) return;
      this.update({
        children: [...this.state.children, child], childName: "", childOutcome: "draft",
        childMessage: `Server 已確認建立孩子，時間：${child.createdAt}`, busy: null,
      });
      await this.selectChild(child.id);
    } catch (error) {
      if (this.current(scope)) {
        if (isSessionInvalid(error)) {
          this.update({ childOutcome: "draft" });
          this.gate("signedOut", SESSION_EXPIRED);
        } else this.update({ childOutcome: isUnknown(error) ? "unknown" : "draft", childMessage: isUnknown(error) ? UNKNOWN_WRITE : "未能建立孩子，請核對稱呼後再試。" });
      }
    } finally {
      if (this.current(scope)) this.update({ busy: null });
      this.release(scope);
    }
  }

  reviewRecord(): void {
    const childId = this.state.selectedChildId;
    if (this.state.children.find(child => child.id === childId)?.accessRole === "viewer") return;
    const draft = childId ? this.state.drafts[childId] ?? emptyDraft() : emptyDraft();
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.deletion || this.state.recordsLoading || !this.state.online || draft.outcome !== "draft") return;
    const validation = validateCreateTextRecord({ childId, text: draft.text });
    if (!validation.ok) {
      if (childId) this.updateDraft(childId, { message: validation.issues[0].message });
      return;
    }
    this.update({ confirmation: validation.value });
  }

  cancelReview(): void {
    if (!this.state.busy) this.update({ confirmation: null });
  }

  async confirmRecord(): Promise<void> {
    const confirmation = this.state.confirmation;
    if (this.state.children.find(child => child.id === confirmation?.childId)?.accessRole === "viewer") {
      this.update({ confirmation: null }); return;
    }
    if (!confirmation || this.state.auth !== "signedIn" || this.state.busy || this.state.deletion || this.state.recordsLoading || !this.state.online) return;
    const draft = this.state.drafts[confirmation.childId];
    if (!draft || draft.outcome !== "draft" || draft.text !== confirmation.text || this.state.selectedChildId !== confirmation.childId) return;
    const scope = this.scope();
    this.update({ busy: "saveRecord" });
    try {
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(confirmation.childId, { outcome: "sending", message: null });
      const record = await this.api.createRecord(confirmation.childId, confirmation.text, scope.controller.signal, scope.userId);
      if (!this.current(scope)) return;
      if (record.authorUserId !== scope.userId) {
        this.gate("signedOut", SESSION_EXPIRED);
        return;
      }
      this.updateDraft(confirmation.childId, { text: "", outcome: "draft", message: null, receipt: null });
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(confirmation.childId, { text: "", outcome: "draft", message: null, receipt: record });
      this.update({ records: [record, ...this.state.records.filter(item => item.id !== record.id)].slice(0, this.state.recordLimit), confirmation: null });
    } catch (error) {
      if (this.current(scope)) {
        this.update({ confirmation: null });
        if (isSessionInvalid(error)) {
          this.updateDraft(confirmation.childId, { outcome: "draft" });
          this.gate("signedOut", SESSION_EXPIRED);
        } else if (error instanceof ClientApiError && (error.status === 403 || error.status === 404)) {
          this.forgetChild(confirmation.childId);
          this.update({ children: this.state.children.filter(child => child.id !== confirmation.childId), notice: "存取權已改變，請重新讀取孩子列表。" });
        } else this.updateDraft(confirmation.childId, { outcome: isUnknown(error) ? "unknown" : "draft", message: isUnknown(error) ? UNKNOWN_WRITE : "提交未獲接納，尚未保存。請核對輸入或重新讀取後再試。" });
      }
    } finally {
      if (this.current(scope)) this.update({ busy: null });
      this.release(scope);
    }
  }

  resolveUnknownRecord(found: boolean): void {
    const id = this.state.selectedChildId;
    const draft = id ? this.state.drafts[id] : null;
    if (this.state.busy || !id || !draft || draft.outcome !== "checked") return;
    if (found && this.api.reconcilePending) return;
    this.updateDraft(id, { text: found ? "" : draft.text, outcome: "draft", message: found ? "已按你的核對清除本頁草稿。" : "可重試原操作；尚未確認的提交會沿用原識別，不會另建重複記錄。" });
  }

  resolveUnknownChild(found: boolean): void {
    if (this.state.busy || this.state.childOutcome !== "checked") return;
    if (found && this.api.reconcilePending) return;
    this.update({ childName: found ? "" : this.state.childName, childOutcome: "draft", childMessage: found ? "已按你的核對清除本頁稱呼。" : "可重試原操作；請保持原輸入，系統會核對原確認記錄。" });
  }

  cancelLogout(): void {
    if (!this.state.busy) this.update({ logoutConfirmation: false });
  }

  async signOut(discardConfirmed = false): Promise<void> {
    if (this.state.auth !== "signedIn" || this.state.busy || !this.state.online) return;
    if (this.hasUnsavedInput() && !discardConfirmed) {
      this.update({ logoutConfirmation: true, confirmation: null });
      return;
    }
    const scope = this.scope();
    this.update({ busy: "logout", notice: null, logoutConfirmation: false });
    try {
      if (!await this.verifyIdentity(scope)) return;
      await this.api.signOut(scope.controller.signal);
      if (!this.current(scope)) return;
      this.abortRequests();
      this.retained = null;
      this.update({ ...initialState(this.state.online), auth: "signedOut", notice: "已登出，這個頁面的未提交內容已清除。" });
    } catch (error) {
      if (this.current(scope)) {
        if (isSessionInvalid(error)) this.gate("signedOut", SESSION_EXPIRED);
        else if (isUnknown(error)) this.gate("unavailable", "登出結果未知，尚未確認登出。請重新檢查登入狀態；未提交內容只留在本頁並已隱藏。");
        else this.update({ busy: null, notice: "未能完成登出，請稍後重試或重新檢查登入狀態。" });
      }
    } finally {
      if (this.current(scope)) this.update({ busy: null });
      this.release(scope);
    }
  }

  dispose(): void {
    this.abortRequests();
    this.api.resetOnline?.();
  }
}
