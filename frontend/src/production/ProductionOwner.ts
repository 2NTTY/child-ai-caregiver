import { QueryClient } from "@tanstack/react-query";
import { resolveApiBaseUrl } from "../../../src/config/api-base-url.ts";
import { createRecordsApi, type AuthMode, type Credentials, type RecordsApi } from "../../../src/client/records-api.ts";
import { RecordsController, type RecordsState } from "../../../src/client/records-controller.ts";
import { createAssistantDraftOwner } from "../assistant-draft.ts";
import { confirmedUserId, productionIdentityKey, productionScopeKey } from "./scope.ts";
import { withRecordsQueries } from "./records-query.ts";

export interface ProductionSnapshot {
  records: RecordsState;
  identityKey: string | null;
  scopeKey: string | null;
  sessionGeneration: number;
  homeIntroductionPending: boolean;
}

export class ProductionOwner {
  readonly apiBaseUrl: string;
  readonly queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
  readonly draftOwner = createAssistantDraftOwner();
  readonly controller: RecordsController;
  private generation = 0;
  private identity: string | null = null;
  private lastUserId: string | null = null;
  private newLogin = false;
  private introductionPending = false;
  private snapshot: ProductionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly draftScopes = new Map<string, { identity: string; childId: string; role: string | null }>();
  private unsubscribe: (() => void) | null;

  constructor(apiBaseUrl: string, online: boolean, api?: RecordsApi) {
    this.apiBaseUrl = resolveApiBaseUrl(apiBaseUrl);
    const queries = withRecordsQueries(api ?? createRecordsApi(this.apiBaseUrl), this.queryClient, () => ({
      identityKey: this.identity,
      scopeKey: productionScopeKey(this.apiBaseUrl, this.controller.getSnapshot(), this.generation),
      childId: this.controller.getSnapshot().selectedChildId,
    }));
    this.controller = new RecordsController(queries, online);
    this.snapshot = this.project();
    this.unsubscribe = this.controller.subscribe(() => this.sync());
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private emit() { this.listeners.forEach(listener => listener()); }

  private project(): ProductionSnapshot {
    const raw = this.controller.getSnapshot();
    const records = confirmedUserId(raw) ? raw : { ...raw, user: null, children: [], selectedChildId: null,
      records: [], drafts: {}, childName: "", confirmation: null, deletion: null };
    return { records, identityKey: this.identity,
      scopeKey: productionScopeKey(this.apiBaseUrl, raw, this.generation), sessionGeneration: this.generation,
      homeIntroductionPending: Boolean(this.identity && this.introductionPending) };
  }

  private sync() {
    const raw = this.controller.getSnapshot();
    const userId = confirmedUserId(raw);
    if (userId && (!this.identity || userId !== this.lastUserId)) {
      this.generation += 1;
      if (userId !== this.lastUserId || this.newLogin) this.introductionPending = true;
      this.lastUserId = userId; this.newLogin = false;
    }
    const nextIdentity = productionIdentityKey(this.apiBaseUrl, raw, this.generation);
    if (nextIdentity !== this.identity) {
      void this.queryClient.cancelQueries();
      this.queryClient.removeQueries();
      for (const key of this.draftScopes.keys()) this.draftOwner.forget(key);
      this.draftScopes.clear();
      this.identity = nextIdentity;
    }
    for (const [key, entry] of this.draftScopes) {
      const child = raw.children.find(item => item.id === entry.childId);
      if (!child || (child.accessRole ?? null) !== entry.role || entry.identity !== this.identity) {
        this.draftOwner.forget(key); this.draftScopes.delete(key);
      }
    }
    const nextScope = productionScopeKey(this.apiBaseUrl, raw, this.generation);
    if (nextScope && this.identity) {
      const child = raw.children.find(item => item.id === raw.selectedChildId)!;
      this.draftScopes.set(nextScope, { identity: this.identity, childId: child.id, role: child.accessRole ?? null });
    }
    if (nextScope !== this.snapshot.scopeKey) {
      const oldScope = this.snapshot.scopeKey;
      if (oldScope) { void this.queryClient.cancelQueries({ queryKey: ["production", oldScope] }); this.queryClient.removeQueries({ queryKey: ["production", oldScope] }); }
    }
    this.draftOwner.retainScope(nextScope);
    this.snapshot = this.project(); this.emit();
  }

  async authenticate(mode: AuthMode, input: Credentials) {
    const before = this.controller.getSnapshot();
    if (before.busy || before.auth === "checking" || before.auth === "signedIn" || !before.online) return;
    this.newLogin = true;
    await this.controller.authenticate(mode, input);
    if (this.controller.getSnapshot().auth === "signedOut") this.newLogin = false;
  }

  markHomeIntroductionPresented = () => {
    if (!this.identity || !this.introductionPending) return;
    this.introductionPending = false; this.snapshot = this.project(); this.emit();
  };

  connect() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.sync();
  }

  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null;
    this.controller.dispose(); this.draftOwner.dispose();
    void this.queryClient.cancelQueries(); this.queryClient.clear(); this.listeners.clear();
  }
}
