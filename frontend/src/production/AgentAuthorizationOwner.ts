import { AgentActionsApiError, createAgentActionsApi, type AgentNoteDelete } from "../../../src/client/agent-actions-api.ts";
import { ContactApiError, createContactApi } from "../../../src/client/contact-api.ts";
import type { AgentActionReceipt, AgentOperationPolicy, AgentPolicyUpdate, AgentPrivateNote, ordinaryRecordKinds } from "../../../src/shared/agent-actions.ts";
import type { ContactPage } from "../../../src/shared/contact.ts";
import type { AgentReadState } from "../agent-view-model.ts";

type RecordKind = (typeof ordinaryRecordKinds)[number];
interface Scope { key: string; userId: string; childId: string }
interface PolicyDraft { recordKinds: RecordKind[]; allowPrivateNotes: boolean; allowSelfTasks: boolean; reminders: boolean }
type PendingOperation = { kind: "policy"; input: AgentPolicyUpdate; reviewed: boolean; reconfirm?: boolean }
  | { kind: "delete"; note: AgentPrivateNote; input: AgentNoteDelete; reviewed: boolean; reconfirm?: boolean };
export interface AgentAuthorizationSnapshot {
  online: boolean; busy: "read" | "write" | null; writesBlocked: boolean;
  policyState: AgentReadState; policy: AgentOperationPolicy | null; draft: PolicyDraft; sharedConfirmed: boolean;
  contactState: AgentReadState; contact: Pick<ContactPage, "consent" | "availableBindings" | "workerEnabled"> | null;
  notesState: AgentReadState; notes: AgentPrivateNote[]; queryDraft: string; query: string; nextAfterId: string | null;
  pending: PendingOperation | null; notice: string | null;
  receipts: Readonly<Record<string, { state: AgentReadState; items: AgentActionReceipt[] }>>;
}
const emptyDraft = (): PolicyDraft => ({ recordKinds: [], allowPrivateNotes: false, allowSelfTasks: false, reminders: false });
function initial(online: boolean): AgentAuthorizationSnapshot {
  return { online, busy: null, writesBlocked: false, policyState: "idle", policy: null, draft: emptyDraft(), sharedConfirmed: false,
    contactState: "idle", contact: null, notesState: "idle", notes: [], queryDraft: "", query: "", nextAfterId: null, pending: null, notice: null, receipts: {} };
}
export function reminderEligible(state: AgentAuthorizationSnapshot): boolean {
  const contact = state.contact;
  return state.contactState === "ready" && !!contact?.consent.enabled && contact.consent.version > 0
    && contact.consent.bindings.length > 0 && contact.consent.bindings.every(binding => contact.availableBindings.some(active =>
      active.channel === binding.channel && active.bindingId === binding.bindingId && active.bindingVersion === binding.bindingVersion));
}
export function maySavePolicy(state: AgentAuthorizationSnapshot): boolean {
  return state.online && state.policyState === "ready" && !!state.policy && !state.busy && !state.writesBlocked && !state.pending
    && (!state.draft.recordKinds.length && !state.draft.allowSelfTasks || state.sharedConfirmed)
    && (!state.draft.reminders || state.draft.allowSelfTasks && reminderEligible(state));
}
export function mayRetryAuthorization(state: AgentAuthorizationSnapshot): boolean {
  const pending = state.pending;
  return !!pending?.reviewed && !pending.reconfirm && state.online && !state.busy && !state.writesBlocked
    && (pending.kind === "delete" || (!pending.input.recordKinds.length && !pending.input.allowSelfTasks || state.sharedConfirmed));
}
// Private read and original-operation buffers live above disclosures and are cleared with the confirmed scope.
export class AgentAuthorizationOwner {
  private readonly api;
  private readonly contactApi;
  private scope: Scope | null = null;
  private epoch = 0;
  private request: AbortController | null = null;
  private readonly receiptRequests = new Map<string, AbortController>();
  private snapshot: AgentAuthorizationSnapshot;
  private readonly listeners = new Set<() => void>();
  constructor(baseUrl: string, online: boolean, private readonly onAccessLost: (identity: boolean) => void,
    private readonly onSaved: () => void) {
    this.api = createAgentActionsApi(baseUrl); this.contactApi = createContactApi(baseUrl); this.snapshot = initial(online);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AgentAuthorizationSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  setWritesBlocked(blocked: boolean) { if (this.snapshot.writesBlocked !== blocked) this.update({ writesBlocked: blocked }); }
  syncContext(scope: Scope | null, online: boolean) {
    if (scope?.key !== this.scope?.key) {
      this.epoch++; this.request?.abort(); this.request = null; this.receiptRequests.forEach(request => request.abort()); this.receiptRequests.clear();
      this.scope = scope; this.contactApi.resetOnline(); this.snapshot = initial(online); this.listeners.forEach(listener => listener());
    } else if (this.snapshot.online !== online) {
      if (!online) { this.request?.abort(); this.receiptRequests.forEach(request => request.abort()); }
      this.update({ online });
    }
  }
  private begin(kind: "read" | "write") {
    if (!this.scope || !this.snapshot.online || this.request || this.snapshot.policyState === "denied") return null;
    if (kind === "write" && this.snapshot.writesBlocked) return null;
    const controller = new AbortController(), scope = this.scope, epoch = this.epoch;
    this.request = controller; this.update({ busy: kind });
    return { scope, controller, current: () => epoch === this.epoch && scope.key === this.scope?.key,
      finish: () => { if (this.request === controller) this.request = null; if (epoch === this.epoch) this.update({ busy: null }); } };
  }
  private lost(error: unknown): boolean {
    const actionError = error instanceof AgentActionsApiError, contactError = error instanceof ContactApiError;
    const identity = actionError && (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized")
      || contactError && (error.status === 401 || error.status === 409);
    if (!identity && (!(actionError || contactError) || ![403, 404].includes((error as AgentActionsApiError).status))) return false;
    this.epoch++; this.request?.abort(); this.request = null; this.receiptRequests.forEach(request => request.abort()); this.receiptRequests.clear();
    this.snapshot = { ...initial(this.snapshot.online), policyState: "denied", notesState: "denied", contactState: "denied", notice: "存取權已改變，私人授權及記錄已清除。" };
    this.listeners.forEach(listener => listener()); this.onAccessLost(!!identity); return true;
  }
  setDraft = (patch: Partial<PolicyDraft>) => {
    if (this.snapshot.busy || this.snapshot.pending || this.snapshot.writesBlocked || this.snapshot.policyState !== "ready") return;
    const draft = { ...this.snapshot.draft, ...patch };
    if (!draft.allowSelfTasks) draft.reminders = false;
    if (draft.reminders && !reminderEligible(this.snapshot)) draft.reminders = false;
    this.update({ draft, sharedConfirmed: false, notice: null });
  };
  setSharedConfirmation = (checked: boolean) => { if (!this.snapshot.busy && !this.snapshot.writesBlocked && this.snapshot.policyState === "ready") this.update({ sharedConfirmed: checked }); };
  setQuery = (queryDraft: string) => { if (!this.snapshot.busy && !this.snapshot.pending) this.update({ queryDraft: queryDraft.slice(0, 200) }); };
  readPolicy = async () => {
    const request = this.begin("read"); if (!request) return;
    this.update({ policyState: "loading", policy: null, sharedConfirmed: false, notice: null,
      pending: this.snapshot.pending ? { ...this.snapshot.pending, reviewed: false } : null });
    try {
      const policy = await this.api.getPolicy(request.scope.childId, request.controller.signal, request.scope.userId);
      if (!request.current()) return;
      const original = this.snapshot.pending;
      const pending = original?.kind === "policy" && original.reconfirm ? null : original;
      this.update({ policy, policyState: "ready", draft: pending?.kind === "policy" ? { recordKinds: [...pending.input.recordKinds], allowPrivateNotes: pending.input.allowPrivateNotes, allowSelfTasks: pending.input.allowSelfTasks, reminders: pending.input.reminderBindings.length > 0 } : pending ? this.snapshot.draft : {
        recordKinds: [...policy.recordKinds], allowPrivateNotes: policy.allowPrivateNotes, allowSelfTasks: policy.allowSelfTasks, reminders: policy.reminderBindings.length > 0 },
        pending: pending?.kind === "policy" ? { ...pending, reviewed: true } : pending,
        notice: pending?.kind === "policy" ? "已讀取目前授權；核對版本及原內容後，只可明確重試原操作。" : original?.kind === "policy" && original.reconfirm ? "原操作已被拒絕；請按目前版本重新核對並明確保存。" : null });
    } catch (error) {
      if (request.current() && !this.lost(error)) this.update({ policyState: "failed", policy: null, draft: emptyDraft(), sharedConfirmed: false, notice: "未能讀取授權；暫時不能保存新的設定。" });
    } finally { request.finish(); }
  };
  readContact = async () => {
    const request = this.begin("read"); if (!request) return;
    this.update({ contactState: "loading", contact: null, sharedConfirmed: false });
    try {
      const page = await this.contactApi.page(request.scope.childId, request.controller.signal, request.scope.userId);
      if (!request.current()) return;
      this.update({ contactState: "ready", contact: { consent: page.consent, availableBindings: page.availableBindings, workerEnabled: page.workerEnabled } });
    } catch (error) {
      if (request.current() && !this.lost(error)) this.update({ contactState: "failed", contact: null, draft: { ...this.snapshot.draft, reminders: false }, notice: "未能核對本人通知渠道；不能新增到期提示授權。" });
    } finally { request.finish(); }
  };
  readNotes = async (more = false, keepQuery = false) => {
    if (this.snapshot.pending?.kind === "policy" || more && (!this.snapshot.nextAfterId || this.snapshot.pending)) return;
    const request = this.begin("read"); if (!request) return;
    const query = this.snapshot.pending?.kind === "delete" ? "" : more || keepQuery ? this.snapshot.query : this.snapshot.queryDraft.trim();
    const after = more ? this.snapshot.nextAfterId : null;
    this.update({ notesState: "loading", notes: more ? this.snapshot.notes : [], nextAfterId: null,
      pending: this.snapshot.pending ? { ...this.snapshot.pending, reviewed: false } : null });
    try {
      const page = await this.api.listNotes(request.scope.childId, request.controller.signal, request.scope.userId, query, after);
      if (!request.current()) return;
      const prior = more ? this.snapshot.notes : [], ids = new Set(page.items.map(item => item.id));
      this.update({ notesState: "ready", notes: [...prior.filter(item => !ids.has(item.id)), ...page.items], query, nextAfterId: page.nextAfterId,
        pending: this.snapshot.pending?.kind === "delete" ? this.snapshot.pending.reconfirm ? null : { ...this.snapshot.pending, reviewed: true } : this.snapshot.pending,
        notice: this.snapshot.pending?.kind === "delete" ? "已重新讀取私人記錄；清單中未出現原記錄不代表刪除已確認，請核對後重試原操作。" : null });
    } catch (error) {
      if (request.current() && !this.lost(error)) this.update({ notesState: "failed", notes: [], nextAfterId: null, notice: "未能讀取私人記錄；暫時不能刪除。" });
    } finally { request.finish(); }
  };
  savePolicy = () => {
    const state = this.snapshot; if (!maySavePolicy(state) || !state.policy) return;
    const bindings = state.draft.reminders ? state.contact!.consent.bindings.map(item => ({ ...item })) : [];
    const input: AgentPolicyUpdate = { operationId: crypto.randomUUID(), expectedVersion: state.policy.version,
      recordKinds: [...state.draft.recordKinds], allowPrivateNotes: state.draft.allowPrivateNotes, allowSelfTasks: state.draft.allowSelfTasks,
      reminderBindings: bindings, reminderConsentVersion: bindings.length ? state.contact!.consent.version : null, confirm: true, confirmShared: state.sharedConfirmed };
    void this.submit({ kind: "policy", input, reviewed: false });
  };
  mayDelete = (id: string) => this.snapshot.online && this.snapshot.notesState === "ready" && !this.snapshot.busy && !this.snapshot.pending
    && !this.snapshot.writesBlocked && this.snapshot.notes.some(item => item.id === id);
  deleteNote = (id: string) => {
    if (!this.mayDelete(id)) return;
    const note = this.snapshot.notes.find(item => item.id === id)!;
    void this.submit({ kind: "delete", note: { ...note }, input: { expectedVersion: note.version, operationId: crypto.randomUUID(), confirmDelete: true }, reviewed: false });
  };
  retryOriginal = () => { if (mayRetryAuthorization(this.snapshot) && this.snapshot.pending) void this.submit(this.snapshot.pending); };
  private async submit(operation: PendingOperation) {
    const request = this.begin("write"); if (!request) return;
    this.update({ notice: null });
    try {
      if (operation.kind === "policy") {
        await this.api.savePolicy(request.scope.childId, operation.input, request.controller.signal, request.scope.userId);
        if (!request.current()) return;
        // An exact replay confirms the original write; its receipt is not the current policy.
        this.update({ pending: null, policyState: "loading", policy: null, draft: emptyDraft(), sharedConfirmed: false,
          notice: "原保存已確認，正在重新讀取目前授權。" });
        try {
          const policy = await this.api.getPolicy(request.scope.childId, request.controller.signal, request.scope.userId);
          if (!request.current()) return;
          this.update({ policyState: "ready", policy, draft: { recordKinds: [...policy.recordKinds], allowPrivateNotes: policy.allowPrivateNotes,
            allowSelfTasks: policy.allowSelfTasks, reminders: policy.reminderBindings.length > 0 }, notice: "原保存已確認；以下是重新讀取的目前授權。" });
        } catch (error) {
          if (!request.current()) return;
          if (this.lost(error)) return;
          this.update({ policyState: "failed", policy: null, draft: emptyDraft(), sharedConfirmed: false,
            notice: "原保存已確認，目前授權待重新讀取。" });
        }
      } else {
        const deleted = await this.api.deleteNote(request.scope.childId, operation.note.id, operation.input, request.controller.signal, request.scope.userId);
        if (!request.current()) return;
        if (!deleted) { this.update({ notes: this.snapshot.notes.filter(item => item.id !== operation.note.id), pending: { ...operation, reviewed: false }, notice: "未能確認原刪除；請重新讀取後查核原操作。" }); return; }
        this.update({ notes: this.snapshot.notes.filter(item => item.id !== operation.note.id), pending: null, notice: "私人記錄的刪除已獲確認。" });
      }
      this.onSaved();
    } catch (error) {
      if (!request.current()) return;
      // A missing note on recovery is not proof that this original operation completed.
      if (operation.kind === "delete" && error instanceof AgentActionsApiError && error.status === 404 && error.code === "not_found")
        this.update({ notes: this.snapshot.notes.filter(item => item.id !== operation.note.id), pending: { ...operation, reviewed: false }, notice: "原記錄目前不可讀取；刪除結果仍未確認，請先查核原操作。" });
      else if (!this.lost(error)) {
        const reconfirm = error instanceof AgentActionsApiError && [400, 409].includes(error.status)
          && ["invalid_input", "version_conflict", "policy_changed", "contact_consent_changed", "sharing_confirmation_required", "confirmation_scope_changed"].includes(error.code ?? "");
        this.update({ pending: { ...operation, reviewed: false, reconfirm }, sharedConfirmed: false,
          notice: reconfirm ? "原操作已被拒絕；請先重新讀取目前資料，再按新版本明確確認。" : "原操作尚未獲確認；新的寫入已暫停。先重新讀取，再明確重試相同原操作。" });
      }
    } finally { request.finish(); }
  }
  readReceipts = async (runId: string, force = false) => {
    if (!this.scope || !this.snapshot.online || this.receiptRequests.has(runId) || !force && this.snapshot.receipts[runId]?.state === "ready") return;
    const scope = this.scope, epoch = this.epoch, controller = new AbortController(); this.receiptRequests.set(runId, controller);
    this.update({ receipts: { ...this.snapshot.receipts, [runId]: { state: "loading", items: [] } } });
    try {
      const items = await this.api.receipts(scope.childId, runId, controller.signal, scope.userId);
      if (epoch === this.epoch && this.scope?.key === scope.key && this.receiptRequests.get(runId) === controller) this.update({ receipts: { ...this.snapshot.receipts, [runId]: { state: "ready", items } } });
    } catch (error) {
      if (epoch === this.epoch && this.receiptRequests.get(runId) === controller && !this.lost(error)) this.update({ receipts: { ...this.snapshot.receipts, [runId]: { state: "failed", items: [] } } });
    } finally { if (this.receiptRequests.get(runId) === controller) this.receiptRequests.delete(runId); }
  };
  invalidateReceipts() { this.receiptRequests.forEach(request => request.abort()); this.receiptRequests.clear(); this.update({ receipts: {} }); }
  dispose() { this.syncContext(null, this.snapshot.online); this.listeners.clear(); }
}
