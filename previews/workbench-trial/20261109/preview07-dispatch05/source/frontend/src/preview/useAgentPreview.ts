import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import { useEffect, useRef, useState } from "react";
import { mayCheckShared, mayDecide, mayRetryOriginal, type AgentDecisionKind, type AgentInboxActions, type AgentInboxModel,
  type AgentPendingDecision, type AgentRunActions, type AgentRunModel, type AgentRunView } from "../agent-view-model";
import { backgroundRunId, createAgentRun, type AgentRunScenario } from "./agent-fixture";

export type AgentDecisionOutcome = "success" | "unknown" | "conflict";
export type AgentReadOutcome = "latest" | "accepted" | "dismissed" | "version_changed" | "missing" | "failed" | "denied";
type RunRequest = { kind: "read" } | { kind: "write"; decision: AgentPendingDecision };
const cloneRun = (run: AgentRunView): AgentRunView => JSON.parse(JSON.stringify(run)) as AgentRunView;

// A synthetic display adapter. No HTTP, model, permission, storage or notification calls.
// The owner must key this hook's component by Server/user/child before private contents render.
export function useAgentPreview(childId: string, online: boolean) {
  const [scenario, setScenario] = useState<AgentRunScenario>("standard");
  const [decisionOutcome, setDecisionOutcome] = useState<AgentDecisionOutcome>("success");
  const [readOutcome, setReadOutcome] = useState<AgentReadOutcome>("latest");
  const [runState, setRunState] = useState<Omit<AgentRunModel, "online">>({
    run: null, readState: "idle", loadedAt: null, busy: null, sharedConfirmed: {}, pendingDecision: null, notice: null,
  });
  const [inboxState, setInboxState] = useState<Omit<AgentInboxModel, "online" | "locked">>({ state: "idle", loadedAt: null, entries: [], selectedRunId: null });
  const selectedRun = useRef<string | null>(null);
  usePreviewLeaveGuard(false, runState.busy === "write" || !!runState.pendingDecision);
  const fixtures = useRef(new Map<string, AgentRunView>());
  const fixtureTime = useRef(Date.now());
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<RunRequest | null>(null);
  const generation = useRef(0);
  const onlineRef = useRef(online); onlineRef.current = online;
  const model: AgentRunModel = { ...runState, online };
  const modelRef = useRef(model); modelRef.current = model;
  const inbox: AgentInboxModel = { ...inboxState, online, locked: !!model.busy || !!model.pendingDecision || model.readState === "denied" };

  function cancelTimers() {
    generation.current++;
    if (runTimer.current) clearTimeout(runTimer.current);
    if (inboxTimer.current) clearTimeout(inboxTimer.current);
    runTimer.current = null; inboxTimer.current = null; request.current = null;
  }
  useEffect(() => () => { cancelTimers(); }, []);
  useEffect(() => {
    if (online) return;
    const interrupted = request.current;
    cancelTimers();
    setRunState(previous => ({ ...previous, busy: null, sharedConfirmed: {},
      readState: interrupted?.kind === "read" ? "failed" : previous.readState,
      pendingDecision: interrupted?.kind === "write" ? { ...interrupted.decision, reviewed: false } : previous.pendingDecision,
      notice: interrupted?.kind === "write" ? { tone: "warning", text: "連線中斷；原候選決定結果未知。恢復連線後，先讀取同一運行查核。" } : previous.notice,
    }));
    setInboxState(previous => previous.state === "loading" ? { ...previous, state: "failed" } : previous);
  }, [online]);

  function fixture(runId: string): AgentRunView {
    const existing = fixtures.current.get(runId);
    if (existing) return cloneRun(existing);
    const value = createAgentRun(childId, runId, scenario, fixtureTime.current);
    fixtures.current.set(runId, value);
    return cloneRun(value);
  }
  function clearPrivate() {
    cancelTimers(); fixtures.current.clear(); selectedRun.current = null;
    setRunState({ run: null, readState: "denied", busy: null, loadedAt: null, sharedConfirmed: {}, pendingDecision: null,
      notice: { tone: "error", text: "權限或登入身份已失效；私人運行、候選、引用與原操作資料已清除。請重新確認登入及孩子存取權。" } });
    setInboxState({ state: "denied", loadedAt: null, entries: [], selectedRunId: null });
  }
  function load(runId: string) {
    if (!onlineRef.current || request.current || modelRef.current.readState === "denied") return;
    const pending = modelRef.current.pendingDecision;
    if (pending && pending.runId !== runId) return;
    selectedRun.current = runId;
    request.current = { kind: "read" };
    const token = generation.current;
    setRunState(previous => ({ ...previous, busy: "read", readState: "loading", sharedConfirmed: {},
      pendingDecision: previous.pendingDecision ? { ...previous.pendingDecision, reviewed: false } : null, notice: null }));
    runTimer.current = setTimeout(() => {
      if (token !== generation.current || !onlineRef.current) return;
      request.current = null; runTimer.current = null;
      if (readOutcome === "denied") { clearPrivate(); return; }
      if (readOutcome === "failed") {
        setRunState(previous => ({ ...previous, busy: null, readState: "failed",
          notice: { tone: "error", text: "未能讀取原運行；上一批結果暫不展示，確認及重試暫停。請手動重新讀取。" } }));
        return;
      }
      const value = fixture(runId);
      const targetId = pending?.proposalId ?? value.proposals[0]?.id;
      const target = value.proposals.find(item => item.id === targetId);
      if (target?.status === "pending" && ["accepted", "dismissed"].includes(readOutcome)) {
        target.version++;
        target.status = readOutcome === "accepted" ? "accepted" : "dismissed";
        target.result = target.status === "accepted" ? { kind: target.kind === "memory_fact" ? "memory_fact" : "task", version: 1, label: "合成保存收據" } : null;
      } else if (target?.status === "pending" && readOutcome === "version_changed") {
        target.version = Math.max(target.version, (pending?.input.expectedVersion ?? target.version) + 1);
        target.title = "已更新的候選內容（合成）"; target.content = "原候選內容已變更；請重新閱讀內容、對象及版本，再明確決定。";
      } else if (readOutcome === "missing") value.proposals = value.proposals.filter(item => item.id !== targetId);
      fixtures.current.set(runId, cloneRun(value));
      let nextPending = pending;
      let notice: AgentRunModel["notice"] = null;
      if (pending) {
        const latest = value.proposals.find(item => item.id === pending.proposalId);
        if (!latest) {
          nextPending = { ...pending, reviewed: false };
          notice = { tone: "warning", text: "原運行未包含這個候選，不能推斷已接受、已略過或未保存；原決定仍需查核，不能重試。" };
        }
        else if (latest.status !== "pending") {
          nextPending = null;
          notice = { tone: "saved", text: `合成原運行顯示候選${latest.status === "accepted" ? "已接受" : latest.status === "dismissed" ? "已略過" : "已過期"}；沒有自動重新提交。` };
        } else if (latest.version !== pending.input.expectedVersion || pending.reconfirm) {
          nextPending = null;
          notice = { tone: "warning", text: "原候選版本或確認基準已變更；舊決定已停用。重新核對最新內容並明確確認，不能重送舊決定。" };
        } else {
          nextPending = { ...pending, reviewed: true };
          notice = { tone: "warning", text: "原候選仍待確認；這不能證明原寫入未發生。若要重試，先重新核對共享內容，再明確沿用原候選、版本及決定。" };
        }
      }
      setRunState(previous => ({ ...previous, run: value, busy: null, readState: "ready", loadedAt: new Date().toISOString(),
        sharedConfirmed: {}, pendingDecision: nextPending, notice }));
    }, 430);
  }
  function submit(pending: AgentPendingDecision) {
    if (!onlineRef.current || request.current || modelRef.current.readState === "denied") return;
    // Preserve the exact original decision tuple for an explicit retry. No new opId is invented.
    const original: AgentPendingDecision = { ...pending, input: { ...pending.input }, reviewed: false };
    request.current = { kind: "write", decision: original };
    const token = generation.current;
    setRunState(previous => ({ ...previous, busy: "write", notice: { tone: "neutral", text: "正在模擬提交候選決定；尚未收到合成收據。" } }));
    runTimer.current = setTimeout(() => {
      if (token !== generation.current || !onlineRef.current) return;
      request.current = null; runTimer.current = null;
      if (decisionOutcome !== "success") {
        setRunState(previous => ({ ...previous, busy: null, sharedConfirmed: {},
          pendingDecision: { ...original, reconfirm: decisionOutcome === "conflict" },
          notice: { tone: "warning", text: decisionOutcome === "conflict"
            ? "確認基準出現衝突；先讀取原運行，重新核對最新候選。不能直接重送舊決定。"
            : "候選決定結果未知；先讀取同一原運行及候選，不能再次建立新決定。" } }));
        return;
      }
      const value = fixture(original.runId);
      const proposal = value.proposals.find(item => item.id === original.proposalId);
      if (!proposal || proposal.status !== "pending" || proposal.version !== original.input.expectedVersion) {
        setRunState(previous => ({ ...previous, busy: null, sharedConfirmed: {}, pendingDecision: { ...original, reconfirm: true },
          notice: { tone: "warning", text: "未能核對這份合成收據的候選及版本；先讀取原運行再確認。" } }));
        return;
      }
      proposal.version++; proposal.status = original.input.decision === "accept" ? "accepted" : "dismissed";
      proposal.result = proposal.status === "accepted" ? { kind: proposal.kind === "memory_fact" ? "memory_fact" : "task", version: 1, label: "合成保存收據" } : null;
      fixtures.current.set(value.id, cloneRun(value));
      setRunState(previous => ({ ...previous, run: value, busy: null, sharedConfirmed: {}, pendingDecision: null,
        notice: { tone: "saved", text: `合成候選${proposal.status === "accepted" ? "已接受" : "已略過"}；只更新此運行預覽，沒有寫入正式任務或記憶，也沒有外發。` } }));
    }, 430);
  }
  const actions: AgentRunActions = {
    refresh() { if (selectedRun.current) load(selectedRun.current); },
    setSharedConfirmation(id, checked) {
      const proposal = modelRef.current.run?.proposals.find(item => item.id === id);
      if (!proposal || !mayCheckShared(modelRef.current, proposal)) return;
      setRunState(previous => ({ ...previous, sharedConfirmed: { ...previous.sharedConfirmed, [id]: checked } }));
    },
    decide(id, decision: AgentDecisionKind) {
      const current = modelRef.current;
      const proposal = current.run?.proposals.find(item => item.id === id);
      if (!current.run || !proposal || !mayDecide(current, proposal, decision)) return;
      submit({ runId: current.run.id, proposalId: id,
        input: { expectedVersion: proposal.version, decision, confirmShared: decision === "accept" && proposal.scope === "family" && !!current.sharedConfirmed[id] },
        reviewed: false, reconfirm: false });
    },
    retryOriginal() { const current = modelRef.current; if (current.pendingDecision && mayRetryOriginal(current)) submit(current.pendingDecision); },
    openSource() { setRunState(previous => ({ ...previous, notice: { tone: "neutral", text: "這份樣本沒有真實引用連結。正式接線須由已核對 HTTPS 來源的 adapter 開啟。" } })); },
  };
  function selectRun(runId: string) {
    if (inbox.locked || request.current || !onlineRef.current) return;
    setInboxState(previous => ({ ...previous, selectedRunId: previous.entries.some(item => item.runId === runId) ? runId : null }));
    setRunState(previous => ({ ...previous, run: null, loadedAt: null }));
    load(runId);
  }
  const inboxActions: AgentInboxActions = {
    refresh() {
      if (!onlineRef.current || inbox.locked || inboxTimer.current || inboxState.state === "denied") return;
      const token = generation.current;
      setInboxState(previous => ({ ...previous, state: "loading" }));
      inboxTimer.current = setTimeout(() => {
        if (token !== generation.current || !onlineRef.current) return;
        inboxTimer.current = null;
        if (readOutcome === "denied") { clearPrivate(); return; }
        if (readOutcome === "failed") { setInboxState(previous => ({ ...previous, state: "failed" })); return; }
        setInboxState(previous => ({ ...previous, state: "ready", loadedAt: new Date().toISOString(),
          entries: scenario === "empty" ? [] : [{ runId: backgroundRunId(childId), createdAt: new Date(fixtureTime.current - 240_000).toISOString(), label: "最近一次運行（合成）" }] }));
      }, 430);
    },
    select(runId) { if (inboxState.state === "ready" && inboxState.entries.some(item => item.runId === runId)) selectRun(runId); },
    collapse() {
      if (inbox.locked) return;
      selectedRun.current = null;
      setInboxState(previous => ({ ...previous, selectedRunId: null }));
      setRunState(previous => ({ ...previous, run: null, readState: "idle", loadedAt: null, sharedConfirmed: {}, notice: null }));
    },
  };
  function changeScenario(next: AgentRunScenario) {
    if (model.busy || model.pendingDecision || model.readState === "denied" || inboxTimer.current) return;
    fixtures.current.clear(); fixtureTime.current = Date.now(); setScenario(next);
    setRunState(previous => ({ ...previous, run: null, readState: "idle", loadedAt: null, sharedConfirmed: {}, notice: null }));
    setInboxState(previous => ({ ...previous, state: "idle", loadedAt: null, entries: [], selectedRunId: null }));
    selectedRun.current = null;
  }
  return { model, actions, inbox, inboxActions, selectRun, scenario, changeScenario,
    decisionOutcome, setDecisionOutcome, readOutcome, setReadOutcome };
}
