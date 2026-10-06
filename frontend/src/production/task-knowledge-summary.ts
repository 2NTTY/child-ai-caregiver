import { useEffect, useMemo, useRef, useState } from "react";
import { createCareSummaryApi } from "../../../src/client/care-summary-api";
import { preparationInput, summaryQuery } from "../../../src/shared/care-summary";
import type { CareSummary } from "../../../src/shared/care-summary";
import { summaryBasisChanged, type SummaryActions, type SummaryPage, type SummaryPending, type SummaryViewModel } from "../summary-view-model";
import { summaryQueryDefaults } from "../components/summary/summary-form";
import type { PreparationDocumentView } from "../preparation-view-model";
import type { PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { domainFailure, useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

export interface TaskKnowledgeSummaryValue { model: SummaryViewModel; actions: SummaryActions; preparation: PreparationWorkspaceValue }
const projectSummary = (page: CareSummary): SummaryPage => {
  const age = page.profile.data?.age;
  return { ...page, profile: { version: page.profile.version, ageLabel: !age || age.kind === "unknown" ? "年齡未確認" : age.kind === "birth_date" ? `出生日期 ${age.date}` : `約 ${age.rawValue} ${age.unit}（截至 ${age.asOf}）`,
    source: page.profile.data?.source ?? "未提供", confirmedBy: page.profile.confirmedBy, confirmedAt: page.profile.confirmedAt, reason: page.profile.reason },
    records: page.records.map(record => ({ ...record, ...record.details })) };
};
export function useTaskKnowledgeSummary(env: TaskKnowledgeEnvironment): TaskKnowledgeSummaryValue {
  const api = useMemo(() => createCareSummaryApi(env.apiBaseUrl), [env.apiBaseUrl]);
  const runtime = useTaskKnowledgeRuntime(env, "summary");
  const [query, setQuery] = useState(summaryQueryDefaults), [page, setPage] = useState<SummaryPage | null>(null);
  const [busy, setBusy] = useState(false), [readFailed, setReadFailed] = useState(false), [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<SummaryPending | null>(null), [originalConsent, setOriginalConsent] = useState(false);
  const [operation, setOperation] = useState<SummaryViewModel["operation"]>("none"), [notice, setNotice] = useState("");
  const [formEpoch, setFormEpoch] = useState(0), [confirmationEpoch, setConfirmationEpoch] = useState(0), [selectedId, setSelectedId] = useState<string | null>(null);
  const inFlight = useRef(false), original = useRef<SummaryPending | null>(null);
  const canManage = env.role === "owner" || env.role === "caregiver";
  useDomainWriteGuard(!runtime.lost && dirty, !runtime.lost && (operation === "saving" || !!pending));
  useEffect(() => () => { inFlight.current = false; api.resetOnline(); }, [api]);
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    api.resetOnline(); original.current = null; setPending(null); setPage(null); setDirty(false); setSelectedId(null); return true;
  };
  const read = async (signal: AbortSignal, current: () => boolean, input = query, replaceDraft = false) => {
    const value = await runtime.read(["page", input.startDay, input.period, input.timeZone], next => api.summary(env.childId!, input, next, env.userId!), signal);
    if (!current()) return;
    setPage(projectSummary(value)); setReadFailed(false); setOriginalConsent(false); setConfirmationEpoch(value => value + 1);
    if (replaceDraft) { setDirty(false); setFormEpoch(value => value + 1); }
  };
  const refresh = () => {
    const entry = original.current, input = summaryQuery.safeParse(entry?.input.period ?? query);
    if (inFlight.current || !env.online || !runtime.live() || !input.success) return;
    inFlight.current = true; setBusy(true); setOriginalConsent(false);
    if (entry) { entry.checked = false; setPending({ ...entry }); }
    void runtime.request(async (signal, current) => {
      try {
        const receipt = entry && !entry.confirmed ? await api.reconcilePending(signal, env.userId!) : null;
        if (entry && receipt?.state === "confirmed") { entry.confirmed = true; entry.reference = receipt.operation.opId; }
        await read(signal, current, input.data, entry?.confirmed === true);
        if (!current()) return;
        if (entry && !entry.confirmed && api.hasPendingOnline()) {
          entry.checked = receipt?.state === "unconfirmed"; setPending({ ...entry }); setOperation("unknown");
          setNotice("已讀取目前摘要；原操作尚未確認。重試保留原識別、內容及依據版本。");
        } else {
          original.current = null; setPending(null); setOperation(entry?.confirmed ? "saved" : "none");
          setNotice(entry?.confirmed ? "原保存已確認，最新摘要及到診準備已讀回。" : entry ? "目前沒有待查操作識別；草稿保留，請核對摘要後重新確認。" : "摘要已重新讀取，未提交草稿保留。");
        }
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        setReadFailed(true); setNotice("摘要或原收據未能讀取；草稿及原保存內容保留。");
        if (entry) { entry.confirmed ||= domainFailure(error).confirmed; entry.checked = false; setPending({ ...entry }); setOperation(entry.confirmed ? "confirmed_unread" : "unknown"); }
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  useTaskKnowledgeRefresh(refresh, env.online && !!env.childId && !runtime.lost, busy);
  const write = (entry: SummaryPending, retry = false) => {
    if (inFlight.current || !env.online || !runtime.live() || !canManage || !page?.canManage || readFailed || !retry && !env.canStartWrite()) return;
    inFlight.current = true; original.current = entry; entry.checked = false; setPending({ ...entry }); setBusy(true); setOriginalConsent(false); setOperation("saving");
    void runtime.request(async (signal, current) => {
      try {
        await api.savePreparation(env.childId!, entry.input, signal, env.userId!); entry.confirmed = true;
        await read(signal, current, entry.input.period, true);
        if (!current()) return;
        original.current = null; setPending(null); setOperation("saved"); setNotice("家庭共享到診準備已保存，請查看目前來源核對狀態。"); env.invalidate();
      } catch (error) {
        if (!current() || clearAccess(error)) return;
        const failure = domainFailure(error); entry.confirmed ||= failure.confirmed; setReadFailed(true);
        if (entry.confirmed || api.hasPendingOnline()) {
          setPending({ ...entry }); setOperation(entry.confirmed ? "confirmed_unread" : "unknown");
          setNotice(entry.confirmed ? "原保存已確認，摘要待讀回；毋須再次提交。" : "保存結果未知；保留原操作，請先查收據。");
        } else {
          original.current = null; setPending(null); setOperation(failure.status === 409 ? "conflict" : "failed");
          setNotice("保存未獲接納；草稿與原依據保留，請重新讀取並核對差異。");
        }
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const visible = runtime.lost ? null : page;
  const model: SummaryViewModel = { childName: env.childName, scopeKey: env.scopeKey, dataLabel: "Server 已確認照顧記錄的完整期間摘要；現有 API 只保存一份家庭共享到診準備。",
    query, page: visible, online: env.online, access: runtime.lost ? "lost" : canManage ? "editable" : "read_only", readFailed, busy,
    operation: runtime.lost ? "none" : operation, notice, pending: runtime.lost ? null : pending, originalConsent, dirty: !runtime.lost && dirty, formEpoch, confirmationEpoch };
  const actions: SummaryActions = {
    updateQuery(value) { if (!inFlight.current && !original.current && runtime.live()) setQuery({ ...value }); }, refresh,
    markDirty() { if (!inFlight.current && !original.current && runtime.live() && canManage) { setDirty(true); setOriginalConsent(false); setOperation("none"); } },
    save(input, appointmentLabel) {
      const parsed = preparationInput.safeParse(input);
      if (!parsed.success || original.current || !visible || summaryBasisChanged(parsed.data, visible)
        || parsed.data.appointmentTaskId !== null && !visible.appointments.some(item => item.id === parsed.data.appointmentTaskId)) return;
      const frozen = structuredClone(parsed.data);
      write({ reference: "", input: frozen, body: JSON.stringify(frozen), appointmentLabel, confirmed: false, checked: false });
    },
    discard() { if (!inFlight.current && !original.current && runtime.live()) { setDirty(false); setFormEpoch(value => value + 1); setOperation("none"); } },
    setOriginalConsent(value) { if (!inFlight.current && original.current?.checked && !original.current.confirmed) setOriginalConsent(value); },
    retryOriginal() { if (originalConsent && original.current?.checked && !original.current.confirmed && api.hasPendingOnline()) write(original.current, true); },
  };
  const prep = visible?.preparation;
  const document: PreparationDocumentView | null = prep && prep.version > 0 ? {
    id: `visit-preparation:${env.childId}`, childId: env.childId!, purpose: "appointment", version: prep.version, status: "active", archivedAt: null,
    readState: !prep.updatedAt ? "unknown" : visible!.reviewCurrent ? "ready" : "stale",
    revision: !prep.updatedAt ? null : { id: `visit-preparation:${env.childId}:${prep.version}`, number: prep.version,
      title: "家庭共享到診準備", summary: "單一已保存到診準備；其他用途及文件歸檔尚未接通。",
      eventDate: visible!.appointments.find(item => item.id === prep.appointmentTaskId)?.occurrence.dueAt ?? null,
      updatedAt: prep.updatedAt, sourceAsOf: visible!.generatedAt,
      sections: [{ id: "questions", title: "到診問題", kind: "questions", items: prep.questions.map((text, index) => ({ id: `question:${index}`, text })) },
        { id: "checklist", title: "準備清單", kind: "checklist", items: prep.checklist.map((item, index) => ({ id: `check:${index}`, text: item.text, checked: item.done })) }],
      sourceRefs: visible!.records.map(item => ({ id: item.id, version: item.version })),
    },
    sources: visible!.records.map(item => ({ id: item.id, childId: env.childId!, label: `摘要依據：${item.text}`, version: item.version,
      updatedAt: item.confirmedAt, state: "available", visibility: "family" })),
  } : null;
  const condition = runtime.lost ? "lost" : !visible ? busy ? "loading" : readFailed ? "unavailable" : "empty"
    : pending ? "unknown" : !canManage ? "read_only" : visible.reviewCurrent ? "ready" : "source_changed";
  return { model, actions, preparation: { scopeKey: env.scopeKey, model: {
    child: { id: env.childId!, displayName: env.childName, accessRole: env.role ?? undefined, ageLabel: visible?.profile.ageLabel ?? "年齡未確認", regionLabel: "詳見孩子檔案", allergiesLabel: null, profileConfirmed: !!visible?.profile.confirmedAt },
    scope: { authorityKey: env.scopeKey, childId: env.childId!, role: env.role ?? undefined, online: env.online, condition },
    documents: document ? [document] : [], selected: document && document.id === selectedId ? document : null,
    condition, online: env.online, notice: notice || null, justArchivedId: null,
    dataLabel: "Server 單一家庭共享到診準備；尚未提供多用途文件、歸檔歷史、報告或 PDF。",
    archiveNotice: "到診準備 API 沒有文件歸檔／還原接口；目前不能在歷史頁查閱歸檔文件。",
    capabilities: { archive: false, checkItem: false },
  }, actions: {
    selectDocument(id) { if (document?.id === id && !runtime.lost) setSelectedId(id); }, closeDocument() { setSelectedId(null); },
    archiveDocument() {}, checkItem() {},
  }, recovery: { checkOriginalOperation: refresh, reloadCurrent: refresh } } };
}