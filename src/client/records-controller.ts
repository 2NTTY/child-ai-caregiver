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
  busy: "auth" | "logout" | "createChild" | "saveRecord" | null;
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
  hasRetainedInput: boolean;
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

const UNKNOWN_WRITE = "尚未確認保存，結果未知。請先重新讀取並核對；這次請求仍可能已在 Server 完成，直接重試可能重複建立。";
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
    drafts: {}, confirmation: null, logoutConfirmation: false, hasRetainedInput: false,
  };
}

function isUnknown(error: unknown): boolean {
  return !(error instanceof ClientApiError) || error.status === 0 || error.status >= 500;
}

function isSessionInvalid(error: unknown): boolean {
  return error instanceof ClientApiError && (error.status === 401 || error.status === 409);
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

  constructor(api: RecordsApi, online = true) {
    this.api = api;
    this.state = initialState(online);
  }

  getSnapshot = (): RecordsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hasUnsavedInput = (): boolean => hasInput(this.state) || Boolean(this.retained && hasInput(this.retained));

  private update(patch: Partial<RecordsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateDraft(childId: string, patch: Partial<RecordDraft>): void {
    this.update({ drafts: { ...this.state.drafts, [childId]: { ...(this.state.drafts[childId] ?? emptyDraft()), ...patch } } });
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
    try {
      await this.api.authenticate(mode, { ...input, name: input.name.trim(), email: input.email.trim() }, controller.signal);
      const user = await this.api.getSession(controller.signal);
      if (epoch !== this.epoch) return;
      if (!user) {
        this.update({ busy: null, notice: "未能確認登入成功，請重新檢查登入狀態。" });
        return;
      }
      await this.activate(user);
    } catch (error) {
      if (epoch === this.epoch) this.update({
        busy: null, auth: isUnknown(error) ? "unavailable" : "signedOut",
        notice: isUnknown(error) ? "登入或註冊結果未能確認，請先重新檢查登入狀態。"
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
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childrenLoading || !this.state.children.some(child => child.id === childId)) return;
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
      const children = await this.api.listChildren(scope.controller.signal);
      if (!await this.verifyIdentity(scope)) return;
      this.update({
        children, childrenLoadedAt: new Date().toISOString(), childrenLoading: false,
        childOutcome: this.state.childOutcome === "unknown" ? "checked" : this.state.childOutcome,
      });
      const id = children.some(child => child.id === this.state.selectedChildId) ? this.state.selectedChildId : children[0]?.id;
      if (id) await this.selectChild(id);
      else this.update({ selectedChildId: null, records: [], recordsLoadedAt: null, recordsError: null });
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
      const list = await this.api.listRecords(childId, scope.controller.signal);
      if (!this.current(scope) || sequence !== this.recordRequest || this.state.selectedChildId !== childId) return;
      if (list.records.some(record => record.authorUserId !== scope.userId)) {
        this.gate("signedOut", SESSION_EXPIRED);
        return;
      }
      if (!await this.verifyIdentity(scope) || sequence !== this.recordRequest || this.state.selectedChildId !== childId) return;
      this.update({ records: list.records, recordLimit: list.limit, recordsLoadedAt: new Date().toISOString() });
      if (this.state.drafts[childId]?.outcome === "unknown") this.updateDraft(childId, { outcome: "checked" });
    } catch (error) {
      if (this.current(scope) && sequence === this.recordRequest) {
        if (isSessionInvalid(error)) this.gate("signedOut", SESSION_EXPIRED);
        else this.update({ recordsError: "未能讀取記錄；畫面資料可能過期，請重新讀取。" });
      }
    } finally {
      if (this.current(scope) && sequence === this.recordRequest) this.update({ recordsLoading: false });
      this.release(scope);
    }
  }

  async createChild(): Promise<void> {
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.childrenLoading || !this.state.online || this.state.childOutcome !== "draft") return;
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
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
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
    const draft = childId ? this.state.drafts[childId] ?? emptyDraft() : emptyDraft();
    if (this.state.auth !== "signedIn" || this.state.busy || this.state.recordsLoading || !this.state.online || draft.outcome !== "draft") return;
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
    if (!confirmation || this.state.auth !== "signedIn" || this.state.busy || this.state.recordsLoading || !this.state.online) return;
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
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(confirmation.childId, { text: "", outcome: "draft", message: null, receipt: record });
      this.update({ records: [record, ...this.state.records.filter(item => item.id !== record.id)].slice(0, this.state.recordLimit), confirmation: null });
    } catch (error) {
      if (this.current(scope)) {
        this.update({ confirmation: null });
        if (isSessionInvalid(error)) {
          this.updateDraft(confirmation.childId, { outcome: "draft" });
          this.gate("signedOut", SESSION_EXPIRED);
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
    this.updateDraft(id, { text: found ? "" : draft.text, outcome: "draft", message: found ? "已按你的核對清除本頁草稿。" : "已完成核對。再次保存會建立一則新記錄，請確認沒有重複。" });
  }

  resolveUnknownChild(found: boolean): void {
    if (this.state.busy || this.state.childOutcome !== "checked") return;
    this.update({ childName: found ? "" : this.state.childName, childOutcome: "draft", childMessage: found ? "已按你的核對清除本頁稱呼。" : "已完成核對。再次建立會新增一位孩子，請確認沒有重複。" });
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
  }
}
