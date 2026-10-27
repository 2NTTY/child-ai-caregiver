import { createAvatarApi } from '../../../src/client/avatars-api.ts';
import { AvatarOwner } from './AvatarOwner';
import { createChatFileApi, type ChatFileApi } from '../../../src/client/chat-file-api.ts';
import { ChatFileUploadController } from './ChatFileUploadController';
import { createPhotoApi, type PhotoApi } from '../../../src/client/photo-api.ts';
import { ChatPhotoUploadController } from './ChatPhotoUploadController';
import { createVoiceApi, type VoiceApi } from '../../../src/client/voice-api.ts';
import { VoiceUploadController } from './VoiceUploadController';
import { photoSha256 } from '../platform/photo-bytes';
import { firebaseSocialFactory } from '../platform/firebase-social-auth';
import type { ReauthenticationInput, SocialAuthProvider } from '../../../src/shared/auth-providers.ts';
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
import { createSharingApi } from '../../../src/client/sharing-api.ts';
import { SharedChildController, sharedChildScopeKey, type SharedChildState } from '../../../src/client/shared-child-controller.ts';

export interface ProductionSnapshot {
  records: RecordsState; chat: ChatState; account: AccountServiceSnapshot;
  identityKey: string | null; scopeKey: string | null;
  sessionGeneration: number; homeIntroductionPending: boolean;
  sharedChild: SharedChildState;
  activeChild: { id:string; displayName:string; accessRole:'owner'|'caregiver'|'viewer' } | null;
}
export class ProductionOwner {
  readonly apiBaseUrl: string;
  readonly avatarOwner: AvatarOwner;
  readonly fetcher: typeof fetch;
  private readonly native: boolean;
  readonly adminOwner: AdminOwner;
  readonly reauthenticateAdmin: (proof: ReauthenticationInput, signal: AbortSignal) => Promise<void>;
  readonly socialProviders: readonly SocialAuthProvider[];
  readonly queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
  readonly draftOwner = createAssistantDraftOwner();
  readonly controller: RecordsController;
  readonly chatController: ChatController;
  readonly fileApi: ChatFileApi;
  readonly fileOwner: ChatFileUploadController;
  readonly chatPhotoApi: PhotoApi;
  readonly photoOwner: ChatPhotoUploadController;
  private unsubscribePhoto: (()=>void)|null=null;
  private unsubscribeFile: (()=>void)|null=null;
  readonly voiceApi: VoiceApi;
  readonly voiceOwner: VoiceUploadController;
  private unsubscribeVoice: (()=>void)|null=null;
  readonly agentOwner: ProductAgentOwner;
  readonly authorizationOwner: AgentAuthorizationOwner;
  readonly accountOwner: AccountServiceOwner;
  readonly sharedChild: SharedChildController;
  private unsubscribeShared: (()=>void)|null=null;
  private readonly domainPending = new Set<string>();
  setDomainPending = (key: string, pending: boolean) => {
    if (this.domainPending.has(key) === pending) return;
    if (pending) this.domainPending.add(key); else this.domainPending.delete(key);
    this.syncMutationLocks(); this.snapshot = this.project(); this.emit();
  };
  hasDomainPending = () => !!this.avatarOwner?.hasPending() || this.domainPending.size > 0 || Boolean(this.accountOwner?.hasPending()) || !!this.voiceOwner?.getSnapshot().busy || !!this.voiceOwner?.getSnapshot().unknown || !!this.fileOwner?.getSnapshot().busy || !!this.fileOwner?.getSnapshot().unknown || !!this.photoOwner?.getSnapshot().busy || !!this.photoOwner?.getSnapshot().unknown;
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
    this.sharedChild = new SharedChildController(createSharingApi(this.apiBaseUrl,this.fetcher));
    this.native = transport?.platform === "native";
    let firebaseIdentity: FirebaseClientAuthApi | undefined;
    if (!api) {
      const provider = process.env.EXPO_PUBLIC_AUTH_PROVIDER?.trim();
      const config = { apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "", appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
        ...(process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL ? { authEmulatorUrl: process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL } : {}) };
      if (this.native || provider || Object.values(config).some(Boolean)) {
        try {
          const publicOrigin = transport?.publicOrigin ?? (typeof window === "undefined" ? "" : window.location.origin);
          if (provider !== "firebase" || !publicOrigin) throw new Error("Authentication provider unavailable");
          firebaseIdentity = createFirebaseAuthApi({ baseUrl: this.apiBaseUrl, publicOrigin, config, fetcher: this.fetcher,
            nativeSession: transport?.nativeSession, socialFactory: firebaseSocialFactory });
        } catch { firebaseIdentity = createUnavailableFirebaseAuthApi(); }
      }
    }
    this.socialProviders = firebaseIdentity?.socialProviders ?? accountDependencies?.reauthentication?.socialProviders ?? [];
    this.adminOwner = new AdminOwner(this.apiBaseUrl, this.fetcher);
    this.reauthenticateAdmin = async (proof, signal) => {
      const userId = this.controller.getSnapshot().user?.id;
      if (!userId || !firebaseIdentity) throw new Error('Reauthentication unavailable');
      await firebaseIdentity.reauthenticate(userId, proof, signal);
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
    this.fileApi = createChatFileApi(this.fetcher,this.apiBaseUrl,photoSha256);
    this.fileOwner = new ChatFileUploadController(this.fileApi,photoSha256,this.handleDomainAccessError);
    this.chatPhotoApi = createPhotoApi(this.apiBaseUrl,this.fetcher,photoSha256);
    this.photoOwner = new ChatPhotoUploadController(this.chatPhotoApi,photoSha256,this.handleDomainAccessError);
    this.voiceApi = createVoiceApi(this.fetcher,this.apiBaseUrl,photoSha256);
    this.voiceOwner = new VoiceUploadController(this.voiceApi,photoSha256,this.handleDomainAccessError);
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
    this.avatarOwner = new AvatarOwner(createAvatarApi(this.apiBaseUrl, this.fetcher, photoSha256), error => {
      if (error.code === 'storage_epoch_changed' || error.code === 'identity_changed' || error.code === 'account_scope_changed') {
        this.avatarOwner.syncContext(null, null, this.controller.getSnapshot().online); void this.controller.restoreSession();
      } else if (error.status === 403 && error.target.kind === 'child') this.denySelectedChild();
      else if (error.status === 403) void this.controller.restoreSession();
      else this.handleDomainAccessError(error);
    }, this.canStartDomainWrite, () => {
      if (!this.syncingChat && this.snapshot) { this.syncMutationLocks(); this.snapshot = this.project(); this.emit(); }
    });
    this.snapshot = this.project();
    this.unsubscribeShared = this.sharedChild.subscribe(()=>{if(!this.syncingChat)this.sync();});
    this.unsubscribeAccount = this.accountOwner.subscribe(this.accountChanged);
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeVoice = this.voiceOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribeFile = this.fileOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribePhoto = this.photoOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.unsubscribeChat = this.chatController.subscribe(() => this.chatChanged());
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.adminOwner?.setUser(!this.native && this.snapshot.records.auth === "signedIn" ? this.snapshot.records.user?.id ?? null : null); this.listeners.forEach(listener => listener()); }
  private scopeKey() {
    if (!this.accountOwner?.isReady()) return null;
    if(this.sharedChild.getSnapshot().target)return sharedChildScopeKey(this.sharedChild.getSnapshot());
    const raw = this.controller.getSnapshot();
    return raw.selectedChildId && this.deniedChildren.has(raw.selectedChildId) ? null : productionScopeKey(this.apiBaseUrl, raw, this.generation);
  }
  /** Confirmation may edit while ordinary child reads/writes stay behind the deletion barrier. */
  childDeletionConfirmationKey = (): string | null => {
    if(this.sharedChild.getSnapshot().target)return null;
    const raw = this.controller.getSnapshot(), deletion = raw.deletion;
    const child = raw.children.find(item => item.id === deletion?.childId);
    if (!this.identity || this.identity !== productionIdentityKey(this.apiBaseUrl, raw, this.generation)
      || !deletion || !["confirm", "checked"].includes(deletion.phase) || !child || child.accessRole !== "owner"
      || child.id !== raw.selectedChildId || this.deniedChildren.has(child.id) || !raw.online || raw.busy || raw.childrenLoading
      || !this.canStartDomainWrite()) return null;
    // The deletion barrier clears chat selection, not the original target's unknown write.
    const draft = this.chatController.getSnapshot().drafts[child.id];
    if (draft?.phase === "saving" || draft?.phase === "replying" || draft?.phase === "save_unknown" || draft?.phase === "checked") return null;
    return JSON.stringify([this.identity, child.id, child.accessRole, child.displayName]);
  };
  private project(): ProductionSnapshot {
    const raw = this.controller.getSnapshot(), scopeKey = this.scopeKey(), userId = confirmedUserId(raw);
    const records = userId && this.accountOwner.isReady() ? raw : { ...raw, user: userId ? raw.user : null, children: [], selectedChildId: null,
      records: [], drafts: {}, childName: "", confirmation: null, deletion: null };
    const chat = this.chatController.getSnapshot();
    const sharedChild = this.sharedChild.getSnapshot();
    const selected = scopeKey ? sharedChild.target ? sharedChild.view ? {id:sharedChild.view.childId,displayName:sharedChild.view.childName,accessRole:sharedChild.view.role}:null
      : records.children.find(child=>child.id===records.selectedChildId)??null : null;
    const activeChild = selected ? {id:selected.id,displayName:selected.displayName,accessRole:selected.accessRole??'viewer' as const}:null;
    const chatVisible = !sharedChild.target && scopeKey && chat.userId === userId && chat.selectedChildId === raw.selectedChildId;
    return { records, account: this.accountOwner.getSnapshot(), chat: chatVisible ? chat : { ...chat, userId: null, selectedChildId: null, messages: [], drafts: {} },
      identityKey: this.identity, scopeKey, sessionGeneration: this.generation, sharedChild, activeChild,
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
  private operationsAvailable = () => {
    const agent = this.agentOwner.getSnapshot().model, authorization = this.authorizationOwner.getSnapshot();
    return this.accountOwner.isReady() && !this.hasDomainPending() && !agent.busy && !agent.pendingDecision && !authorization.busy && !authorization.pending;
  };
  chatWritesAllowed = () => !this.sharedChild.getSnapshot().target && this.operationsAvailable();
  canStartDomainWrite = () => {
    const chat = this.chatController.getSnapshot();
    const draft = chat.selectedChildId ? chat.drafts[chat.selectedChildId] : null;
    return this.operationsAvailable() && !chat.busy && draft?.phase !== "save_unknown" && draft?.phase !== "checked";
  };
  private chatChanged() {
    if (this.syncingChat) return;
    const chat = this.chatController.getSnapshot(), raw = this.controller.getSnapshot();
    if (!this.sharedChild.getSnapshot().target && this.identity && confirmedUserId(raw) && !chat.userId) { void this.controller.restoreSession(); return; }
    if (!this.sharedChild.getSnapshot().target && this.scopeKey() && raw.selectedChildId && chat.selectedChildId !== raw.selectedChildId) { this.denySelectedChild(); return; }
    this.syncMutationLocks(); this.snapshot = this.project(); this.emit();
  }
  private denySelectedChild() {
    if(this.sharedChild.getSnapshot().target){this.sharedChild.invalidate();return;}
    const childId = this.controller.getSnapshot().selectedChildId;
    if (!childId) return;
    this.deniedChildren.add(childId); this.agentOwner.forgetChild(childId); this.sync();
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
      this.sharedChild.syncContext(this.identity,userId,raw.online && this.accountOwner.isReady());
      const shared = this.sharedChild.getSnapshot();
      if (!this.accountOwner.isReady() && shared.target && (shared.view || shared.phase === 'loading')) this.sharedChild.invalidate();
      for (const [key, entry] of this.draftScopes) {
        const child = raw.children.find(item => item.id === entry.childId);
        if (!child || (child.accessRole ?? null) !== entry.role || entry.identity !== this.identity) {
          this.draftOwner.forget(key); this.draftScopes.delete(key); this.chatController.forgetChild(entry.childId);
        }
      }
      this.chatController.reconcileChildren(raw.children.map(item => item.id), raw.deletion?.childId ?? null);
      const nextScope = this.scopeKey();
      const privateScope = this.sharedChild.getSnapshot().target ? null : nextScope;
      if (privateScope && this.identity) {
        const child = raw.children.find(item => item.id === raw.selectedChildId)!;
        this.draftScopes.set(privateScope, { identity: this.identity, childId: child.id, role: child.accessRole ?? null });
      }
      if (nextScope !== this.snapshot.scopeKey && this.snapshot.scopeKey) {
        void this.queryClient.cancelQueries({ queryKey: ["production", this.snapshot.scopeKey] });
        this.queryClient.removeQueries({ queryKey: ["production", this.snapshot.scopeKey] });
      }
      this.avatarOwner?.syncContext(this.accountOwner.isReady() && this.identity && userId ? { key: this.identity, userId } : null,
        privateScope && raw.selectedChildId ? { key: privateScope, childId: raw.selectedChildId } : null, raw.online);
      this.voiceOwner.syncContext(privateScope && userId && raw.selectedChildId ? {key:privateScope,userId,childId:raw.selectedChildId}:null,raw.online);
      this.fileOwner.syncContext(privateScope && userId && raw.selectedChildId ? {key:privateScope,userId,childId:raw.selectedChildId}:null,raw.online);
      this.photoOwner.syncContext(privateScope && userId && raw.selectedChildId ? {key:privateScope,userId,childId:raw.selectedChildId}:null,raw.online);
      this.draftOwner.retainScope(privateScope);
      this.chatController.syncContext(userId, raw.online, privateScope ? raw.selectedChildId : null);
      const allowedAgentScopes = raw.childrenLoadedAt && !raw.childrenLoading && !raw.childrenError
        ? raw.children.filter(child => !this.deniedChildren.has(child.id)).map(child =>
          productionScopeKey(this.apiBaseUrl, { ...raw, selectedChildId: child.id }, this.generation)).filter((key): key is string => key !== null)
        : undefined;
      this.agentOwner.syncContext(privateScope && userId && raw.selectedChildId
        ? { key: privateScope, userId, childId: raw.selectedChildId } : null, raw.online,
        { identityKey: this.identity, allowedScopeKeys: allowedAgentScopes });
      this.authorizationOwner.syncContext(privateScope && userId && raw.selectedChildId ? { key: privateScope, userId, childId: raw.selectedChildId } : null, raw.online);
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
    this.avatarOwner?.invalidate();
    this.authorizationOwner?.invalidateReceipts();
    const authorization = this.authorizationOwner?.getSnapshot();
    // New chat proposals must be discoverable even before the list has ever been opened.
    if (scope && !this.sharedChild.getSnapshot().target && refreshPending) void this.agentOwner?.readPending(false, true);
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
    if(this.sharedChild.getSnapshot().target){await this.sharedChild.refresh();return;}
    await this.controller.reloadChildren();
    const latest = this.controller.getSnapshot();
    if (latest.childrenLoadedAt !== state.childrenLoadedAt && latest.selectedChildId && latest.children.some(item => item.id === latest.selectedChildId)) {
      this.deniedChildren.delete(latest.selectedChildId); this.sync();
    }
    await this.chatController.reloadMessages();
  }
  async selectSharedChild(spaceId:string,childId:string){
    const raw=this.controller.getSnapshot();
    if(!this.canStartDomainWrite()||raw.busy||raw.deletion||raw.childOutcome==='unknown'||raw.childOutcome==='checked')return;
    await this.sharedChild.select(spaceId,childId);
  }
  async selectPersonalChild(childId:string){
    const raw=this.controller.getSnapshot();
    if(!this.canStartDomainWrite()||raw.busy||raw.deletion||raw.childOutcome==='unknown'||raw.childOutcome==='checked')return;
    await this.controller.selectChild(childId);
    if(this.controller.getSnapshot().selectedChildId===childId)this.sharedChild.clear();
  }
  async authenticate(mode: AuthMode, input: Credentials) {
    const before = this.controller.getSnapshot();
    if (before.busy || before.auth === "checking" || before.auth === "signedIn" || !before.online) return;
    this.newLogin = true; await this.controller.authenticate(mode, input);
    if (this.controller.getSnapshot().auth === "signedOut") this.newLogin = false;
  }
  async authenticateProvider(provider: SocialAuthProvider) {
    const before = this.controller.getSnapshot();
    if (!this.socialProviders.includes(provider) || before.busy || before.auth === "checking" || before.auth === "signedIn" || !before.online) return;
    this.newLogin = true; await this.controller.authenticateProvider(provider);
    if (this.controller.getSnapshot().auth === "signedOut") this.newLogin = false;
  }
  markHomeIntroductionPresented = () => {
    if (!this.identity || !this.introductionPending) return;
    this.introductionPending = false; this.snapshot = this.project(); this.emit();
  };
  connect() {
    if (this.unsubscribe) return;
    this.unsubscribeShared=this.sharedChild.subscribe(()=>{if(!this.syncingChat)this.sync();});
    this.unsubscribeVoice = this.voiceOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribeFile = this.fileOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribePhoto = this.photoOwner.subscribe(() => { this.syncMutationLocks(); this.snapshot=this.project(); this.emit(); });
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.unsubscribeChat = this.chatController.subscribe(() => this.chatChanged());
    this.unsubscribeAccount = this.accountOwner.subscribe(this.accountChanged);
    this.unsubscribeAgent = this.agentOwner.subscribe(() => this.syncMutationLocks());
    this.unsubscribeAuthorization = this.authorizationOwner.subscribe(() => this.syncMutationLocks()); this.sync();
  }
  dispose() {
    this.unsubscribeShared?.();this.unsubscribeShared=null;this.sharedChild.dispose();
    this.unsubscribe?.(); this.unsubscribe = null; this.unsubscribeChat?.(); this.unsubscribeChat = null;
    this.unsubscribeAgent?.(); this.unsubscribeAgent = null; this.unsubscribeAuthorization?.(); this.unsubscribeAuthorization = null;
    this.unsubscribeAccount?.(); this.unsubscribeAccount = null;
    this.unsubscribeFile?.(); this.unsubscribeFile=null; this.fileOwner.dispose();
    this.unsubscribePhoto?.(); this.unsubscribePhoto=null; this.photoOwner.dispose();
    this.unsubscribeVoice?.(); this.unsubscribeVoice=null; this.voiceOwner.dispose();
    this.avatarOwner.dispose();
    this.adminOwner.dispose(); this.accountOwner.dispose(); this.controller.dispose(); this.chatController.dispose(); this.agentOwner.dispose(); this.authorizationOwner.dispose(); this.draftOwner.dispose();
    void this.queryClient.cancelQueries(); this.queryClient.clear(); this.listeners.clear();
  }
}
