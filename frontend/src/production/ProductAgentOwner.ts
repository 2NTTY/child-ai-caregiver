import { z } from "zod";
import { createProductAgentApi, ProductAgentApiError, requiresFreshAgentConfirmation, type ProductAgentApi } from "../../../src/client/product-agent-api.ts";
import type { AgentDecision, ProductAgentResult } from "../../../src/shared/product-agent.ts";
import { mayCheckShared, mayDecide, mayRetryOriginal, type AgentDecisionKind, type AgentInboxModel, type AgentRunModel, type AgentRunView, type AgentProposalView, type AgentReadState } from "../agent-view-model.ts";
import { projectAgentRun, projectAgentProposal } from "./agent-projection.ts";

interface PrivateScope { key: string; userId: string; childId: string }
export interface AgentPendingDiscovery { state: AgentReadState; entries: { runId: string; proposal: AgentProposalView }[]; nextCursor: string | null }
export interface ProductAgentSnapshot { pending: AgentPendingDiscovery; model: AgentRunModel; inbox: AgentInboxModel; runs: Readonly<Record<string, AgentRunView>> }
const runsSchema = z.object({ runs: z.array(z.object({ runId: z.uuid(), createdAt: z.iso.datetime({ offset: true }) })).max(20) });
const accessLost = (error: unknown) => error instanceof ProductAgentApiError
  && ([401, 403, 404].includes(error.status) || ["session_changed", "unauthorized", "not_found"].includes(error.code ?? ""));
function initial(online: boolean): ProductAgentSnapshot {
  return { pending: { state: "idle", entries: [], nextCursor: null }, model: { online, readState: "idle", busy: null, run: null, loadedAt: null, sharedConfirmed: {}, pendingDecision: null, notice: null },
    inbox: { online, locked: false, state: "idle", loadedAt: null, entries: [], selectedRunId: null }, runs: {} };
}

// One decision buffer per private scope; collapsing presentation never destroys it.
export class ProductAgentOwner {
  private api: ProductAgentApi;
  private scope: PrivateScope | null = null;
  private snapshot: ProductAgentSnapshot;
  private epoch = 0;
  private request: AbortController | null = null;
  private pendingRead: "first" | "more" | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly rawRuns = new Map<string, ProductAgentResult>();
  private selectedRunId: string | null = null;
  constructor(private readonly baseUrl: string, online: boolean,
    private readonly onAccessLost: (error: ProductAgentApiError) => void, private readonly onSaved: () => void, private readonly createApi = () => createProductAgentApi(baseUrl)) {
    this.api = this.createApi(); this.snapshot = initial(online);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ProductAgentSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    this.snapshot = { ...next, inbox: { ...next.inbox, locked: !!next.model.busy || !!next.model.pendingDecision || !!next.model.writesBlocked || next.model.readState === "denied" } };
    this.listeners.forEach(listener => listener());
  }
  setWritesBlocked(blocked: boolean) {
    if (!!this.snapshot.model.writesBlocked === blocked) return;
    this.model({ writesBlocked: blocked });
    if (!blocked) this.resumePendingRead();
  }
  private resumePendingRead() {
    if (!this.pendingRead) return;
    const epoch = this.epoch;
    // Defer until mutation-lock subscribers have settled; failures never schedule a retry.
    queueMicrotask(() => {
      if (epoch === this.epoch && this.pendingRead) void this.readPending(this.pendingRead === "more");
    });
  }
  private model(patch: Partial<AgentRunModel>) { this.update({ model: { ...this.snapshot.model, ...patch } }); }
  syncContext(scope: PrivateScope | null, online: boolean) {
    if (scope?.key !== this.scope?.key) {
      this.epoch++; this.request?.abort(); this.request = null; this.pendingRead = null; this.scope = scope;
      this.api = this.createApi(); this.selectedRunId = null; this.rawRuns.clear();
      this.update(initial(online));
    } else if (online !== this.snapshot.model.online) {
      if (!online) this.request?.abort();
      this.update({ model: { ...this.snapshot.model, online }, inbox: { ...this.snapshot.inbox, online } });
      if (online) this.resumePendingRead();
    }
  }
  private begin(kind: "read" | "write") {
    if (!this.scope || !this.snapshot.model.online || this.request || this.snapshot.model.readState === "denied" || kind === "write" && this.snapshot.model.writesBlocked) return null;
    const controller = new AbortController(), epoch = this.epoch, scope = this.scope;
    this.request = controller; this.model({ busy: kind });
    return { controller, scope, current: () => epoch === this.epoch && this.scope?.key === scope.key,
      finish: () => {
        if (this.request === controller) this.request = null;
        if (epoch === this.epoch) { this.model({ busy: null }); this.resumePendingRead(); }
      } };
  }
  private deny(error: ProductAgentApiError) {
    this.rawRuns.clear(); this.selectedRunId = null; this.pendingRead = null;
    this.update({ ...initial(this.snapshot.model.online), model: { ...initial(this.snapshot.model.online).model,
      readState: "denied", notice: { tone: "warning", text: "登入、存取權或資料已改變；私人結果已清除。" } },
      pending: { state: "denied", entries: [], nextCursor: null },
      inbox: { ...initial(this.snapshot.model.online).inbox, state: "denied" } });
    this.onAccessLost(error);
  }
  private store(result: ProductAgentResult) {
    if (!this.scope) return null;
    this.rawRuns.set(result.runId, result);
    const terminal = new Set(result.proposals.filter(item => item.status === "accepted" || item.status === "dismissed").map(item => item.id));
    if (terminal.size) this.update({ pending: { ...this.snapshot.pending, entries: this.snapshot.pending.entries.filter(item => !terminal.has(item.proposal.id)) } });
    const createdAt = this.snapshot.inbox.entries.find(item => item.runId === result.runId)?.createdAt ?? null;
    const run = projectAgentRun(result, this.scope.childId, createdAt);
    this.update({ runs: { ...this.snapshot.runs, [result.runId]: run } });
    return run;
  }
  selectRun = (runId: string, background = false) => {
    const model = this.snapshot.model;
    if (!this.scope || !model.online || model.busy || model.pendingDecision || model.writesBlocked || model.readState === "denied") return;
    if (background && !this.snapshot.inbox.entries.some(item => item.runId === runId)) return;
    this.selectedRunId = runId;
    this.update({ inbox: { ...this.snapshot.inbox, selectedRunId: background ? runId : null },
      model: { ...model, run: this.snapshot.runs[runId] ?? null, readState: "idle", sharedConfirmed: {}, notice: null, loadedAt: null } });
    void this.refresh();
  };
  refresh = async () => {
    const runId = this.snapshot.model.pendingDecision?.runId ?? this.selectedRunId;
    if (!runId) return;
    const request = this.begin("read"); if (!request) return;
    this.model({ readState: "loading", sharedConfirmed: {}, notice: null,
      pendingDecision: this.snapshot.model.pendingDecision ? { ...this.snapshot.model.pendingDecision, reviewed: false } : null });
    try {
      const result = await this.api.getRun(request.scope.childId, runId, request.controller.signal, request.scope.userId);
      if (!request.current()) return;
      const run = this.store(result)!;
      let pending = this.snapshot.model.pendingDecision;
      let notice: AgentRunModel["notice"] = null;
      if (pending) {
        const proposal = result.proposals.find(item => item.id === pending!.proposalId);
        if (!proposal) notice = { tone: "warning", text: "原事項仍未能核對；所有新決定暫停，請再次讀取原運行。" };
        else if (proposal.status === "accepted" || proposal.status === "dismissed") {
          pending = null; notice = { tone: "saved", text: "Server 已確認原候選的終態，以下顯示實際保存結果。" }; this.onSaved();
        } else if (pending.reconfirm || proposal.version !== pending.input.expectedVersion || pending.input.decision === "accept" && proposal.status === "expired") {
          pending = null; notice = { tone: "warning", text: "事項或確認基準已變更；請核對新版本，再作新的明確確認。" };
        } else { pending = { ...pending, reviewed: true }; notice = { tone: "warning", text: "原事項仍待確認；只能明確重試原決定，沒有自動重新提交。" }; }
      }
      this.model({ run, readState: "ready", loadedAt: new Date().toISOString(), sharedConfirmed: {}, pendingDecision: pending, notice });
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) this.deny(error as ProductAgentApiError);
      else {
        const runs = { ...this.snapshot.runs }; delete runs[runId]; this.rawRuns.delete(runId); this.update({ runs });
        this.model({ readState: "failed", sharedConfirmed: {}, notice: { tone: "error", text: "未能讀取原運行；現時不能提交變更，原決定仍保留。" } });
      }
    } finally { request.finish(); }
  };
  setSharedConfirmation = (id: string, checked: boolean) => {
    const proposal = this.snapshot.model.run?.proposals.find(item => item.id === id);
    if (proposal && mayCheckShared(this.snapshot.model, proposal)) this.model({ sharedConfirmed: { ...this.snapshot.model.sharedConfirmed, [id]: checked } });
  };
  decide = (id: string, decision: AgentDecisionKind) => {
    const model = this.snapshot.model, proposal = model.run?.proposals.find(item => item.id === id);
    if (!proposal || !mayDecide(model, proposal, decision)) return;
    void this.submit(id, { expectedVersion: proposal.version, decision, confirmShared: decision === "accept" && proposal.scope === "family" && !!model.sharedConfirmed[id] });
  };
  retryOriginal = () => {
    const model = this.snapshot.model;
    if (!mayRetryOriginal(model) || !model.pendingDecision) return;
    void this.submit(model.pendingDecision.proposalId, model.pendingDecision.input);
  };
  private async submit(proposalId: string, input: AgentDecision) {
    const runId = this.snapshot.model.run?.id, original = runId ? this.rawRuns.get(runId) : null;
    if (!runId || !original) return;
    const request = this.begin("write"); if (!request) return;
    try {
      const saved = await this.api.decideProposal(request.scope.childId, runId, proposalId, input, request.controller.signal, request.scope.userId);
      if (!request.current()) return;
      const run = this.store({ ...original, proposals: original.proposals.map(item => item.id === saved.id ? saved : item) });
      this.model({ run, readState: "ready", sharedConfirmed: {}, pendingDecision: null,
        notice: { tone: "saved", text: saved.status === "accepted" ? "Server 已確認接受並保存此事項；任務及記憶的最新狀態請重新讀取核對。" : "Server 已確認略過此事項。" } });
      this.onSaved();
      this.update({ pending: { ...this.snapshot.pending, entries: this.snapshot.pending.entries.filter(item => item.proposal.id !== proposalId) } });
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) this.deny(error as ProductAgentApiError);
      else this.model({ sharedConfirmed: {}, pendingDecision: { runId, proposalId, input: { ...input }, reviewed: false,
        reconfirm: error instanceof ProductAgentApiError && requiresFreshAgentConfirmation(error) },
        notice: { tone: "warning", text: "原決定結果未知；請先重新讀取原運行，所有新決定暫停。" } });
    } finally { request.finish(); }
    if (request.current() && !this.snapshot.model.pendingDecision && this.snapshot.pending.state === "ready" && !this.pendingRead) void this.readPending();
  }
  readPending = async (more = false) => {
    if (!this.scope || this.snapshot.model.readState === "denied" || more && !this.snapshot.pending.nextCursor) return;
    // A fresh read supersedes queued pagination. Keep only one intent in this private scope.
    this.pendingRead = more && this.pendingRead !== "first" ? "more" : "first";
    if (this.snapshot.model.pendingDecision || this.snapshot.model.writesBlocked || this.request || !this.snapshot.model.online) return;
    more = this.pendingRead === "more"; this.pendingRead = null;
    const request = this.begin("read"); if (!request) return;
    const cursor = more ? this.snapshot.pending.nextCursor : null;
    this.update({ pending: { ...this.snapshot.pending, state: "loading", entries: more ? this.snapshot.pending.entries : [], nextCursor: null } });
    try {
      const page = await this.api.getPendingProposals(request.scope.childId, request.controller.signal, request.scope.userId, cursor);
      if (!request.current()) return;
      if (request.controller.signal.aborted) { this.update({ pending: { state: "idle", entries: [], nextCursor: null } }); return; }
      const ids = new Set(page.proposals.map(item => item.id));
      const prior = more ? this.snapshot.pending.entries.filter(item => !ids.has(item.proposal.id)) : [];
      this.update({ pending: { state: "ready", entries: [...prior, ...page.proposals.map(proposal => ({ runId: proposal.runId, proposal: projectAgentProposal(proposal) }))], nextCursor: page.nextCursor } });
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) this.deny(error as ProductAgentApiError);
      else this.update({ pending: { state: request.controller.signal.aborted ? "idle" : "failed", entries: [], nextCursor: null } });
    } finally { request.finish(); }
  };
  readInbox = async () => {
    if (this.snapshot.inbox.locked || this.snapshot.inbox.state === "denied") return;
    const request = this.begin("read"); if (!request) return;
    this.update({ inbox: { ...this.snapshot.inbox, state: "loading" } });
    const timeout = setTimeout(() => request.controller.abort(), 15_000);
    try {
      const apiUrl = this.baseUrl.endsWith("/api") ? this.baseUrl : `${this.baseUrl}/api`;
      const response = await fetch(`${apiUrl}/children/${encodeURIComponent(request.scope.childId)}/agent/runs`, {
        credentials: "include", cache: "no-store", headers: { Accept: "application/json", "x-expected-user-id": request.scope.userId }, signal: request.controller.signal });
      if (!request.current()) return;
      if (!response.ok) {
        let code: "session_changed" | null = null;
        try { const body = await response.json(); if (body?.error?.code === "session_changed") code = "session_changed"; } catch { /* Never display server error prose. */ }
        throw new ProductAgentApiError(response.status, code);
      }
      const parsed = runsSchema.safeParse(await response.json());
      if (!request.current()) return;
      if (!parsed.success || new Set(parsed.data.runs.map(item => item.runId)).size !== parsed.data.runs.length) throw new ProductAgentApiError();
      this.update({ inbox: { ...this.snapshot.inbox, state: "ready", loadedAt: new Date().toISOString(),
        entries: parsed.data.runs.map(item => ({ ...item, label: "已保存背景運行" })) } });
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) this.deny(error as ProductAgentApiError);
      else this.update({ inbox: { ...this.snapshot.inbox, state: "failed" } });
    } finally { clearTimeout(timeout); request.finish(); }
  };
  collapseInbox = () => {
    if (this.snapshot.inbox.locked) return;
    this.selectedRunId = null;
    this.update({ inbox: { ...this.snapshot.inbox, selectedRunId: null }, model: { ...this.snapshot.model, run: null, readState: "idle", sharedConfirmed: {}, notice: null } });
  };
  sourceUrl = (id: string, runId = this.snapshot.model.run?.id): string | null => {
    const source = runId ? this.snapshot.runs[runId]?.citations.find(item => item.id === id) : null;
    if (!source?.url) return null;
    try {
      if (/[\u0000-\u0020\u007f]/.test(source.url)) return null;
      const url = new URL(source.url);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  };
  dispose() { this.epoch++; this.request?.abort(); this.request = null; this.pendingRead = null; this.rawRuns.clear(); this.scope = null; this.selectedRunId = null; this.snapshot = initial(this.snapshot.model.online); this.listeners.clear(); }
}
