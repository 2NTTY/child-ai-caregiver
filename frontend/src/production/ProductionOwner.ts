import { QueryClient } from "@tanstack/react-query";
import { resolveApiBaseUrl } from "../../../src/config/api-base-url.ts";
import { createRecordsApi, type AuthMode, type Credentials, type RecordsApi } from "../../../src/client/records-api.ts";
import { RecordsController, type RecordsState } from "../../../src/client/records-controller.ts";
import { createChatApi, type ChatApi } from "../../../src/client/chat-api.ts";
import { ChatController, type ChatState } from "../../../src/client/chat-controller.ts";
import { createAssistantDraftOwner } from "../assistant-draft.ts";
import { confirmedUserId, productionIdentityKey, productionScopeKey } from "./scope.ts";
import { withRecordsQueries } from "./records-query.ts";
import { AgentAuthorizationOwner } from "./AgentAuthorizationOwner.ts";
import { ProductAgentOwner } from "./ProductAgentOwner.ts";

export interface ProductionSnapshot {
  records: RecordsState; chat: ChatState;
  identityKey: string | null; scopeKey: string | null;
  sessionGeneration: number; homeIntroductionPending: boolean;
}
export class ProductionOwner {
  readonly apiBaseUrl: string;
  readonly queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
  readonly draftOwner = createAssistantDraftOwner();
  readonly controller: RecordsController;
  readonly chatController: ChatController;
  readonly agentOwner: ProductAgentOwner;
  readonly authorizationOwner: AgentAuthorizationOwner;
  private readonly domainPending = new Set<string>();
  setDomainPending = (key: string, pending: boolean) => {
    if (this.domainPending.has(key) === pending) return;
    if (pending) this.domainPending.add(key); else this.domainPending.delete(key);
    this.syncMutationLocks(); this.snapshot = this.project(); this.emit();
  };
  hasDomainPending = () => this.domainPending.size > 0;
  handleDomainAccessError = (error: { status?: number; code?: string | null }) => {
    if (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized") void this.controller.restoreSession();
    else if (error.status === 403 || error.code === "access_denied") this.denySelectedChild();
  };
  private unsubscribeAgent: (() => void) | null = null;
  private unsubscribeAuthorization: (() => void) | null = null;
  private generation = 0;
  private identity: string | null = null;
  private lastUserId: string | null = null;
  private newLogin = false;
  private introductionPending = false;
  private snapshot: ProductionSnapshot;
  private syncingChat = false;
  private readonly deniedChildren = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly draftScopes = new Map<string, { identity: string; childId: string; role: string | null }>();
  private unsubscribe: (() => void) | null;
  private unsubscribeChat: (() => void) | null;

  constructor(apiBaseUrl: string, online: boolean, api?: RecordsApi, chatApi?: ChatApi) {
    this.apiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
    const recordsApi = api ?? createRecordsApi(this.apiBaseUrl);
    this.chatController = new ChatController(chatApi ?? createChatApi(this.apiBaseUrl, async signal => {
      try { return await recordsApi.getSession(signal); }
      catch (error) { if (!signal.aborted) void this.controller.restoreSession(); throw error; }
    }), online);
    const queries = withRecordsQueries(recordsApi, this.queryClient, () => ({ identityKey: this.identity,
      scopeKey: this.scopeKey(), childId: this.controller.getSnapshot().selectedChildId }));
    const childEvent = (action: () => void) => { this.syncingChat = true; try { action(); } finally { this.syncingChat = false; } };
    this.controller = new RecordsController(queries, online, {
      begin: childId => { if (this.agentOwner?.getSnapshot().model.busy || this.agentOwner?.getSnapshot().model.pendingDecision || this.authorizationOwner?.getSnapshot().busy || this.authorizationOwner?.getSnapshot().pending) return false; let allowed = false; childEvent(() => { allowed = this.chatController.beginChildDeletion(childId); }); return allowed; },
      release: childId => childEvent(() => this.chatController.releaseChildDeletion(childId)),
      forget: childId => childEvent(() => this.chatController.forgetChild(childId)),
      reconcile: (ids, pending) => childEvent(() => this.chatController.reconcileChildren(ids, pending)),
    }, false); // CareProfileDomains owns record reads; this controller owns identity and children.
    this.agentOwner = new ProductAgentOwner(this.apiBaseUrl, online, error => {
      if (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized") void this.controller.restoreSession();
      else this.denySelectedChild();
    }, this.invalidatePrivateReads);
    this.authorizationOwner = new AgentAuthorizationOwner(this.apiBaseUrl, online, identity => { if (identity) void this.controller.restoreSession(); else this.denySelectedChild(); }, this.invalidatePrivateReads);
    this.snapshot = this.project();
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.unsubscribeChat = this.chatController.subscribe(() => this.chatChanged());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private scopeKey() {
    const raw = this.controller.getSnapshot();
    return raw.selectedChildId && this.deniedChildren.has(raw.selectedChildId) ? null : productionScopeKey(this.apiBaseUrl, raw, this.generation);
  }
  private project(): ProductionSnapshot {
    const raw = this.controller.getSnapshot(), scopeKey = this.scopeKey(), userId = confirmedUserId(raw);
    const records = userId ? raw : { ...raw, user: null, children: [], selectedChildId: null,
      records: [], drafts: {}, childName: "", confirmation: null, deletion: null };
    const chat = this.chatController.getSnapshot();
    const chatVisible = scopeKey && chat.userId === userId && chat.selectedChildId === raw.selectedChildId;
    return { records, chat: chatVisible ? chat : { ...chat, userId: null, selectedChildId: null, messages: [], drafts: {} },
      identityKey: this.identity, scopeKey, sessionGeneration: this.generation,
      homeIntroductionPending: Boolean(this.identity && this.introductionPending) };
  }
  private syncMutationLocks() {
    if (!this.authorizationOwner) return;
    const chat = this.chatController.getSnapshot(), agent = this.agentOwner.getSnapshot().model, authorization = this.authorizationOwner.getSnapshot();
    const chatDraft = chat.selectedChildId ? chat.drafts[chat.selectedChildId] : null;
    const chatLocked = !!chat.busy || chatDraft?.phase === "save_unknown" || chatDraft?.phase === "checked";
    this.agentOwner.setWritesBlocked(this.hasDomainPending() || chatLocked || !!authorization.busy || !!authorization.pending);
    this.authorizationOwner.setWritesBlocked(this.hasDomainPending() || chatLocked || !!agent.busy || !!agent.pendingDecision);
  }
  chatWritesAllowed = () => {
    const agent = this.agentOwner.getSnapshot().model, authorization = this.authorizationOwner.getSnapshot();
    return !this.hasDomainPending() && !agent.busy && !agent.pendingDecision && !authorization.busy && !authorization.pending;
  };
  canStartDomainWrite = () => {
    const chat = this.chatController.getSnapshot();
    const draft = chat.selectedChildId ? chat.drafts[chat.selectedChildId] : null;
    return this.chatWritesAllowed() && !chat.busy && draft?.phase !== "save_unknown" && draft?.phase !== "checked";
  };
  private chatChanged() {
    if (this.syncingChat) return;
    const chat = this.chatController.getSnapshot(), raw = this.controller.getSnapshot();
    if (this.identity && confirmedUserId(raw) && !chat.userId) { void this.controller.restoreSession(); return; }
    if (this.scopeKey() && raw.selectedChildId && chat.selectedChildId !== raw.selectedChildId) { this.denySelectedChild(); return; }
    this.syncMutationLocks(); this.snapshot = this.project(); this.emit();
  }
  private denySelectedChild() {
    const childId = this.controller.getSnapshot().selectedChildId;
    if (!childId) return;
    this.deniedChildren.add(childId); this.sync();
  }
  private sync() {
    const raw = this.controller.getSnapshot(), userId = confirmedUserId(raw);
    if (userId && (!this.identity || userId !== this.lastUserId)) {
      this.generation += 1;
      if (userId !== this.lastUserId || this.newLogin) this.introductionPending = true;
      this.lastUserId = userId; this.newLogin = false;
    }
    const nextIdentity = productionIdentityKey(this.apiBaseUrl, raw, this.generation);
    this.syncingChat = true;
    try {
      if (nextIdentity !== this.identity) {
        void this.queryClient.cancelQueries(); this.queryClient.removeQueries();
        for (const key of this.draftScopes.keys()) this.draftOwner.forget(key);
        this.draftScopes.clear(); this.deniedChildren.clear();
        this.chatController.syncContext(null, raw.online, null); this.identity = nextIdentity;
      }
      for (const [key, entry] of this.draftScopes) {
        const child = raw.children.find(item => item.id === entry.childId);
        if (!child || (child.accessRole ?? null) !== entry.role || entry.identity !== this.identity) {
          this.draftOwner.forget(key); this.draftScopes.delete(key); this.chatController.forgetChild(entry.childId);
        }
      }
      this.chatController.reconcileChildren(raw.children.map(item => item.id), raw.deletion?.childId ?? null);
      const nextScope = this.scopeKey();
      if (nextScope && this.identity) {
        const child = raw.children.find(item => item.id === raw.selectedChildId)!;
        this.draftScopes.set(nextScope, { identity: this.identity, childId: child.id, role: child.accessRole ?? null });
      }
      if (nextScope !== this.snapshot.scopeKey && this.snapshot.scopeKey) {
        void this.queryClient.cancelQueries({ queryKey: ["production", this.snapshot.scopeKey] });
        this.queryClient.removeQueries({ queryKey: ["production", this.snapshot.scopeKey] });
      }
      this.draftOwner.retainScope(nextScope);
      this.chatController.syncContext(userId, raw.online, nextScope ? raw.selectedChildId : null);
      this.agentOwner.syncContext(nextScope && userId && raw.selectedChildId
        ? { key: nextScope, userId, childId: raw.selectedChildId } : null, raw.online);
      this.authorizationOwner.syncContext(nextScope && userId && raw.selectedChildId ? { key: nextScope, userId, childId: raw.selectedChildId } : null, raw.online);
      this.syncMutationLocks();
    } finally { this.syncingChat = false; }
    this.snapshot = this.project(); this.emit();
  }
  invalidatePrivateReads = (emitEvent = true) => {
    const scope = this.scopeKey();
    if (this.identity) void this.queryClient.invalidateQueries({ queryKey: ["production", this.identity] });
    if (scope) {
      void this.queryClient.invalidateQueries({ queryKey: ["production", scope] });
    }
    this.authorizationOwner?.invalidateReceipts();
    const authorization = this.authorizationOwner?.getSnapshot(), agent = this.agentOwner?.getSnapshot();
    if (agent?.pending.state === "ready" && !agent.model.busy && !agent.model.pendingDecision && !agent.model.writesBlocked) void this.agentOwner.readPending();
    if (authorization?.notesState === "ready" && !authorization.busy && !authorization.pending) void this.authorizationOwner.readNotes(false, true);
    if (emitEvent && typeof window !== "undefined") window.dispatchEvent(new Event("yuban-online-refresh"));
  };
  async refresh() {
    const state = this.controller.getSnapshot();
    if (state.busy) return;
    if (state.auth !== "signedIn") { await this.controller.restoreSession(); return; }
    await this.controller.reloadChildren();
    const latest = this.controller.getSnapshot();
    if (latest.childrenLoadedAt !== state.childrenLoadedAt && latest.selectedChildId && latest.children.some(item => item.id === latest.selectedChildId)) {
      this.deniedChildren.delete(latest.selectedChildId); this.sync();
    }
    await this.chatController.reloadMessages();
  }
  async authenticate(mode: AuthMode, input: Credentials) {
    const before = this.controller.getSnapshot();
    if (before.busy || before.auth === "checking" || before.auth === "signedIn" || !before.online) return;
    this.newLogin = true; await this.controller.authenticate(mode, input);
    if (this.controller.getSnapshot().auth === "signedOut") this.newLogin = false;
  }
  markHomeIntroductionPresented = () => {
    if (!this.identity || !this.introductionPending) return;
    this.introductionPending = false; this.snapshot = this.project(); this.emit();
  };
  connect() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.unsubscribeChat = this.chatController.subscribe(() => this.chatChanged());
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks()); this.sync();
  }
  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null; this.unsubscribeChat?.(); this.unsubscribeChat = null;
    this.unsubscribeAgent?.(); this.unsubscribeAgent = null; this.unsubscribeAuthorization?.(); this.unsubscribeAuthorization = null;
    this.controller.dispose(); this.chatController.dispose(); this.agentOwner.dispose(); this.authorizationOwner.dispose(); this.draftOwner.dispose();
    void this.queryClient.cancelQueries(); this.queryClient.clear(); this.listeners.clear();
  }
}
