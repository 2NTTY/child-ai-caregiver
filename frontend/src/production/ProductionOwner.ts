import { publishOnlineRefresh } from "../../../src/client/online-refresh-events.ts";
import type { ProductionTransport } from "./production-transport";
import { createAccountApi } from "../../../src/client/account-api";
import { createProductAgentApi } from "../../../src/client/product-agent-api";
import { AdminOwner } from './AdminOwner.ts';
import type { ChildSelectionPreferences } from "../../../src/client/child-selection.ts";
import { createWebChildSelectionPreferences } from "./child-selection.ts";
import { QueryClient } from "@tanstack/react-query";
import { resolveApiBaseUrl } from "../../../src/config/api-base-url.ts";
import { createRecordsApi, type AuthMode, type Credentials, type RecordsApi } from "../../../src/client/records-api.ts";
import { createAccountAuthApi } from "../../../src/client/account-auth-api.ts";
import { createFirebaseAuthApi, createUnavailableFirebaseAuthApi, type FirebaseClientAuthApi } from "../../../src/client/firebase-auth-api.ts";
import { RecordsController, type RecordsState } from "../../../src/client/records-controller.ts";
import { createChatApi, type ChatApi } from "../../../src/client/chat-api.ts";
import { ChatController, type ChatState } from "../../../src/client/chat-controller.ts";
import { createAssistantDraftOwner } from "../assistant-draft.ts";
import { confirmedUserId, productionIdentityKey, productionScopeKey } from "./scope.ts";
import { withRecordsQueries } from "./records-query.ts";
import { AgentAuthorizationOwner } from "./AgentAuthorizationOwner.ts";
import { ProductAgentOwner } from "./ProductAgentOwner.ts";
import { AccountServiceOwner, type AccountServiceDependencies, type AccountServiceSnapshot } from "./AccountServiceOwner.ts";

export interface ProductionSnapshot {
  records: RecordsState; chat: ChatState; account: AccountServiceSnapshot;
  identityKey: string | null; scopeKey: string | null;
  sessionGeneration: number; homeIntroductionPending: boolean;
}
export class ProductionOwner {
  readonly apiBaseUrl: string;
  readonly fetcher: typeof fetch;
  private readonly native: boolean;
  readonly adminOwner: AdminOwner;
  readonly reauthenticateAdmin: (password: string, signal: AbortSignal) => Promise<void>;
  readonly queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
  readonly draftOwner = createAssistantDraftOwner();
  readonly controller: RecordsController;
  readonly chatController: ChatController;
  readonly agentOwner: ProductAgentOwner;
  readonly authorizationOwner: AgentAuthorizationOwner;
  readonly accountOwner: AccountServiceOwner;
  private readonly domainPending = new Set<string>();
  setDomainPending = (key: string, pending: boolean) => {
    if (this.domainPending.has(key) === pending) return;
    if (pending) this.domainPending.add(key); else this.domainPending.delete(key);
    this.syncMutationLocks(); this.snapshot = this.project(); this.emit();
  };
  hasDomainPending = () => this.domainPending.size > 0 || Boolean(this.accountOwner?.hasPending());
  handleDomainAccessError = (error: { status?: number; code?: string | null }) => {
    if (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized") void this.controller.restoreSession();
    else if (error.status === 403 || error.code === "access_denied") this.denySelectedChild();
  };
  private unsubscribeAccount: (() => void) | null = null;
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

  constructor(apiBaseUrl: string, online: boolean, api?: RecordsApi, chatApi?: ChatApi, selectionPreferences?: ChildSelectionPreferences, accountDependencies?: AccountServiceDependencies, transport?: ProductionTransport) {
    this.apiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
    this.fetcher = transport?.fetcher ?? ((...args) => fetch(...args));
    this.native = transport?.platform === "native";
    let firebaseIdentity: FirebaseClientAuthApi | undefined;
    if (!api) {
      const provider = process.env.EXPO_PUBLIC_AUTH_PROVIDER?.trim();
      const config = { apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "", appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() ?? "" };
      if (this.native || provider || Object.values(config).some(Boolean)) {
        try {
          const publicOrigin = transport?.publicOrigin ?? (typeof window === "undefined" ? "" : window.location.origin);
          if (provider !== "firebase" || !publicOrigin) throw new Error("Authentication provider unavailable");
          firebaseIdentity = createFirebaseAuthApi({ baseUrl: this.apiBaseUrl, publicOrigin, config, fetcher: this.fetcher, nativeSession: transport?.nativeSession });
        } catch { firebaseIdentity = createUnavailableFirebaseAuthApi(); }
      }
    }
    this.adminOwner = new AdminOwner(this.apiBaseUrl, this.fetcher);
    this.reauthenticateAdmin = async (password, signal) => {
      const userId = this.controller.getSnapshot().user?.id;
      if (!userId || !firebaseIdentity) throw new Error('Reauthentication unavailable');
      await firebaseIdentity.reauthenticate(userId, password, signal);
      if (this.controller.getSnapshot().user?.id !== userId) throw new Error('Identity changed');
    };
    const recordsApi = api ?? createRecordsApi(this.apiBaseUrl, this.fetcher, firebaseIdentity);
    const account = firebaseIdentity ? { ...accountDependencies, legacyTrial: false,
      reauthentication: firebaseIdentity,
      api: accountDependencies?.api ?? createAccountApi(this.apiBaseUrl, this.fetcher, firebaseIdentity),
      authApi: createAccountAuthApi(this.apiBaseUrl, this.fetcher, firebaseIdentity) } : accountDependencies;
    this.accountOwner = new AccountServiceOwner(this.apiBaseUrl, online, () => { void this.controller.restoreSession(); }, () => { void this.controller.restoreSession(); }, account);
    this.chatController = new ChatController(chatApi ?? createChatApi(this.apiBaseUrl, async signal => {
      try { return await recordsApi.getSession(signal); }
      catch (error) { if (!signal.aborted) void this.controller.restoreSession(); throw error; }
    }, this.fetcher), online);
    const queries = withRecordsQueries(recordsApi, this.queryClient, () => ({ identityKey: this.identity,
      scopeKey: this.scopeKey(), childId: this.controller.getSnapshot().selectedChildId }));
    const childEvent = (action: () => void) => { this.syncingChat = true; try { action(); } finally { this.syncingChat = false; } };
    this.controller = new RecordsController(queries, online, {
      begin: childId => { if (this.agentOwner?.getSnapshot().model.busy || this.agentOwner?.getSnapshot().model.pendingDecision || this.authorizationOwner?.getSnapshot().busy || this.authorizationOwner?.getSnapshot().pending) return false; let allowed = false; childEvent(() => { allowed = this.chatController.beginChildDeletion(childId); }); return allowed; },
      release: childId => childEvent(() => this.chatController.releaseChildDeletion(childId)),
      forget: childId => childEvent(() => this.chatController.forgetChild(childId)),
      reconcile: (ids, pending) => childEvent(() => this.chatController.reconcileChildren(ids, pending)),
    }, false, selectionPreferences ?? createWebChildSelectionPreferences(this.apiBaseUrl), this.accountOwner.isReady); // CareProfileDomains owns record reads; this controller owns identity and children.
    this.agentOwner = new ProductAgentOwner(this.apiBaseUrl, online, error => {
      if (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized") void this.controller.restoreSession();
      else this.denySelectedChild();
    }, this.invalidatePrivateReads, () => createProductAgentApi(this.apiBaseUrl, this.fetcher), this.fetcher);
    this.authorizationOwner = new AgentAuthorizationOwner(this.apiBaseUrl, online, identity => { if (identity) void this.controller.restoreSession(); else this.denySelectedChild(); }, this.invalidatePrivateReads, this.fetcher);
    this.snapshot = this.project();
    this.unsubscribeAccount = this.accountOwner.subscribe(this.accountChanged);
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.unsubscribeChat = this.chatController.subscribe(() => this.chatChanged());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.adminOwner?.setUser(!this.native && this.snapshot.records.auth === "signedIn" ? this.snapshot.records.user?.id ?? null : null); this.listeners.forEach(listener => listener()); }
  private scopeKey() {
    if (!this.accountOwner?.isReady()) return null;
    const raw = this.controller.getSnapshot();
    return raw.selectedChildId && this.deniedChildren.has(raw.selectedChildId) ? null : productionScopeKey(this.apiBaseUrl, raw, this.generation);
  }
  private project(): ProductionSnapshot {
    const raw = this.controller.getSnapshot(), scopeKey = this.scopeKey(), userId = confirmedUserId(raw);
    const records = userId && this.accountOwner.isReady() ? raw : { ...raw, user: userId ? raw.user : null, children: [], selectedChildId: null,
      records: [], drafts: {}, childName: "", confirmation: null, deletion: null };
    const chat = this.chatController.getSnapshot();
    const chatVisible = scopeKey && chat.userId === userId && chat.selectedChildId === raw.selectedChildId;
    return { records, account: this.accountOwner.getSnapshot(), chat: chatVisible ? chat : { ...chat, userId: null, selectedChildId: null, messages: [], drafts: {} },
      identityKey: this.identity, scopeKey, sessionGeneration: this.generation,
      homeIntroductionPending: Boolean(this.identity && this.introductionPending) };
  }
  private accountChanged = () => {
    if (this.syncingChat) return;
    const wasReady = this.snapshot.account.gate === "ready";
    this.sync();
    if (!wasReady && this.accountOwner.isReady()) void this.controller.reloadChildren();
  };
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
    return this.accountOwner.isReady() && !this.hasDomainPending() && !agent.busy && !agent.pendingDecision && !authorization.busy && !authorization.pending;
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
      this.accountOwner.syncContext(userId, raw.online, this.identity);
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
  invalidatePrivateReads = (emitEvent = true, refreshPending = true) => {
    const scope = this.scopeKey();
    if (this.identity) void this.queryClient.invalidateQueries({ queryKey: ["production", this.identity] });
    if (scope) {
      void this.queryClient.invalidateQueries({ queryKey: ["production", scope] });
    }
    this.authorizationOwner?.invalidateReceipts();
    const authorization = this.authorizationOwner?.getSnapshot();
    // New chat proposals must be discoverable even before the list has ever been opened.
    if (scope && refreshPending) void this.agentOwner?.readPending();
    if (authorization?.notesState === "ready" && !authorization.busy && !authorization.pending) void this.authorizationOwner.readNotes(false, true);
    if (emitEvent) publishOnlineRefresh();
  };
  async refresh() {
    const state = this.controller.getSnapshot();
    if (state.busy) return;
    if (state.auth !== "signedIn") { await this.controller.restoreSession(); return; }
    if (this.accountOwner.hasPending()) return;
    await this.accountOwner.loadStatus();
    if (!this.accountOwner.isReady()) return;
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
    this.unsubscribeAccount = this.accountOwner.subscribe(this.accountChanged);
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks()); this.sync();
  }
  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null; this.unsubscribeChat?.(); this.unsubscribeChat = null;
    this.unsubscribeAgent?.(); this.unsubscribeAgent = null; this.unsubscribeAuthorization?.(); this.unsubscribeAuthorization = null;
    this.unsubscribeAccount?.(); this.unsubscribeAccount = null;
    this.adminOwner.dispose(); this.accountOwner.dispose(); this.controller.dispose(); this.chatController.dispose(); this.agentOwner.dispose(); this.authorizationOwner.dispose(); this.draftOwner.dispose();
    void this.queryClient.cancelQueries(); this.queryClient.clear(); this.listeners.clear();
  }
}
