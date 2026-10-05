import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import { useEffect, useRef, useState } from "react";
import {
  careKindOptions, emptyCareForm, type CareDraftView, type CareFilter, type CareFormValues, type CareKind,
  type CareListState, type CareRecordsActions, type CareRecordsViewModel, type CareRecordView,
} from "../care-view-model";
import type { HomeChild } from "../view-model";
import { createCareFixtures, createCareCaptureFixtures } from "./care-fixture";

export type CarePreviewCondition = "normal" | "read_only" | "access_lost" | "search_error" | "stale_page";
export type CarePreviewOutcome = "success" | "failed" | "unknown" | "conflict";
export type CareLookupOutcome = "unknown" | "saved" | "not_applied";
type Attempt = { captureId?: string; reference: string; mode: "create" | "revise" | "delete"; basis: CareRecordView | null; values: CareFormValues };
const pageSize = 3;
const noOperation: CareRecordsViewModel["operation"] = { state: "none", message: "", reference: null, latest: null };

// Synthetic state only. This hook must never be used as the formal write transport.
export function useCarePreview(child: HomeChild, online: boolean, reading: boolean, initialKind?: CareKind, initialRecordId?: string) {
  const [condition, setCondition] = useState<CarePreviewCondition>("normal");
  const [outcome, setOutcome] = useState<CarePreviewOutcome>("success");
  const [lookupOutcome, setLookupOutcome] = useState<CareLookupOutcome>("unknown");
  const [captures, setCaptures] = useState(() => createCareCaptureFixtures(child.id));
  const [records, setRecords] = useState(() => createCareFixtures(child.id));
  const [scanned, setScanned] = useState(pageSize);
  const [activeQuery, setActiveQuery] = useState("");
  const [activeKind, setActiveKind] = useState<CareFilter>("all");
  const [listState, setListState] = useState<CareListState>("ready");
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialRecordId && createCareFixtures(child.id).some(item => item.id === initialRecordId) ? initialRecordId : null);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draft, setDraft] = useState<CareDraftView | null>(() => initialKind ? { key: "quick-create", mode: "create", basis: null, initialValues: { ...emptyCareForm(), kind: initialKind }, reviewedValues: null } : null);
  const [deletion, setDeletion] = useState<CareRecordsViewModel["deletion"]>(null);
  const [operation, setOperation] = useState(noOperation);
  const attempt = useRef<Attempt | null>(null);
  const serial = useRef(0);
  const generation = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const alive = useRef(true);

  function clearTimers() {
    generation.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }

  function later(callback: () => void) {
    const scope = generation.current;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (alive.current && scope === generation.current) callback();
    }, 380);
    timers.current.add(timer);
  }

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimers(); };
  }, []);

  const access = condition === "access_lost" ? "lost" : condition === "read_only" || child.accessRole === "viewer" ? "read_only" : "editable";
  const locked = ["saving", "unknown"].includes(operation.state);
  usePreviewLeaveGuard(!!draft?.reviewedValues || !!deletion, locked);
  const canWrite = access === "editable" && online && !reading && !locked && operation.state !== "conflict";
  const selected = records.find(item => item.id === selectedId) ?? null;

  function applyConfirmed(currentAttempt: Attempt) {
    const basis = currentAttempt.basis;
    if (currentAttempt.mode === "delete" && basis) {
      setRecords(previous => previous.filter(item => item.id !== basis.id));
      // Preserve the loaded prefix without pulling an unscanned record into it.
      const removedIndex = records.findIndex(item => item.id === basis.id);
      setScanned(previous => removedIndex >= 0 && removedIndex < previous ? previous - 1 : previous);
      setSelectedId(null); setHistoryLimit(0); setDeletion(null);
      setListState("ready"); setListMessage(null);
      setOperation({ kind: "delete", state: "saved", message: "模擬已刪除記錄及全部歷史；只更新本次預覽，沒有 Server 收據。", reference: currentAttempt.reference, latest: null });
      attempt.current = null;
      return;
    }
    const kindLabel = careKindOptions.find(item => item.value === currentAttempt.values.kind)?.label ?? "照顧";
    const record: CareRecordView = {
      id: basis?.id ?? `preview-care-new-${serial.current}`,
      childId: child.id,
      title: basis?.title ?? `${kindLabel}記錄`,
      createdAtLabel: basis?.createdAtLabel ?? "2026 年 9 月 29 日 上午 10:00（合成）",
      current: {
        version: (basis?.current.version ?? 0) + 1,
        values: { ...currentAttempt.values },
        eventTimePrecision: basis && basis.current.values.eventTimeRaw === currentAttempt.values.eventTimeRaw
          ? basis.current.eventTimePrecision : currentAttempt.values.eventTimeRaw.trim() ? "approximate" : "unknown",
        timeZoneLabel: basis?.current.timeZoneLabel ?? "Asia/Hong_Kong",
        confirmedByLabel: "媽媽（合成）", confirmedAtLabel: "2026 年 9 月 29 日 上午 10:00（合成）",
      },
      history: basis ? [basis.current, ...basis.history] : [],
    };
    if (currentAttempt.captureId) setCaptures(previous => previous.filter(item => item.id !== currentAttempt.captureId));
    setRecords(previous => basis ? previous.map(item => item.id === basis.id ? record : item) : [record, ...previous]);
    setSelectedId(record.id);
    setHistoryLimit(0);
    setDraft(null);
    // Correction keeps the prefix; creation prepends one record to that same prefix.
    if (!basis) setScanned(previous => Math.min(previous, records.length) + 1);
    setListState("ready");
    setListMessage(null);
    setOperation({ state: "saved", message: "模擬已保存；只更新本次照顧記錄預覽，沒有 Server 收據。", reference: currentAttempt.reference, latest: null });
    attempt.current = null;
  }

  function changeCondition(next: CarePreviewCondition) {
    if (locked && next !== "access_lost") return;
    clearTimers();
    attempt.current = null;
    setCondition(next);
    setRecords(createCareFixtures(child.id));
    setCaptures(next === "access_lost" ? [] : createCareCaptureFixtures(child.id));
    setScanned(pageSize);
    setListState("ready");
    setListMessage(null);
    setActiveQuery(""); setActiveKind("all");
    setSelectedId(null); setHistoryLimit(0); setHistoryLoading(false);
    setDraft(null); setDeletion(null); setOperation(noOperation);
  }

  function submitAttempt(currentAttempt: Attempt) {
    attempt.current = currentAttempt;
    setOperation({ state: "saving", message: "正在模擬提交；請等候結果，沒有向 Server 發出請求。", reference: currentAttempt.reference, latest: null });
    later(() => {
      if (outcome === "failed") {
        setOperation({ state: "failed", message: currentAttempt.mode === "delete" ? "模擬失敗：已知沒有刪除。請重新核對並確認刪除範圍。" : "模擬失敗：已知沒有保存。草稿保留，請核對後重新預覽。", reference: currentAttempt.reference, latest: null });
        setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
        setDeletion(previous => previous ? { ...previous, scopeConfirmed: false } : null);
        attempt.current = null;
      } else if (outcome === "unknown") {
        setOperation({ state: "unknown", message: "結果未知：先查核同一個原操作，不能再建立一次提交。操作保持鎖定。", reference: currentAttempt.reference, latest: null });
      } else if (outcome === "conflict" && currentAttempt.basis) {
        const basis = currentAttempt.basis;
        const latest: CareRecordView = { ...basis, current: { ...basis.current, version: basis.current.version + 1,
          values: { ...basis.current.values, text: `${basis.current.values.text}\n家人補充：這是另一個版本的合成觀察。`, reason: "另一位家人補充觀察（合成）" },
          confirmedByLabel: "爸爸（合成）", confirmedAtLabel: "2026 年 9 月 29 日 上午 9:55（合成）" }, history: [basis.current, ...basis.history] };
        setRecords(previous => previous.map(item => item.id === basis.id ? latest : item));
        setOperation({ state: "conflict", message: currentAttempt.mode === "delete" ? "版本已改變；這次刪除未執行。請比較原版本與最新版本，再重新確認範圍。" : "版本已改變；這次更正未保存。請比較原版本、新版本與你的草稿。", reference: currentAttempt.reference, latest });
        setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
        setDeletion(previous => previous ? { ...previous, scopeConfirmed: false } : null);
        attempt.current = null;
      } else applyConfirmed(currentAttempt);
    });
  }

  const actions: CareRecordsActions = {
    search(query, kind) {
      if (!online || reading || access === "lost" || draft || deletion || locked || listState === "loading" || listState === "loading_more") return;
      setListState("loading"); setListMessage(null); setSelectedId(null); setHistoryLimit(0);
      later(() => {
        if (condition === "search_error") {
          setListState("error"); setListMessage("搜尋未能完成，沒有取得新的結果。請保留條件並重試。");
          return;
        }
        setActiveQuery(query.trim()); setActiveKind(kind); setScanned(pageSize); setListState("ready");
      });
    },
    loadMore() {
      if (!online || reading || access === "lost" || listState !== "ready" || scanned >= records.length) return;
      setListState("loading_more");
      later(() => {
        if (condition === "stale_page") {
          setListState("stale"); setListMessage("搜尋頁面已失效。已載入內容只供核對，請重新搜尋後再繼續。");
          return;
        }
        setScanned(previous => previous + pageSize); setListState("ready");
      });
    },
    openRecord(id) {
      if (access === "lost" || reading || locked || draft || deletion) return;
      setSelectedId(id); setHistoryLimit(0); setHistoryLoading(false);
    },
    closePanel() {
      if (locked) return;
      setDraft(null); setDeletion(null); setSelectedId(null); setHistoryLimit(0); setOperation(noOperation); attempt.current = null;
    },
    startCreate() {
      if (access !== "editable" || locked || draft || deletion || reading) return;
      setSelectedId(null); setOperation(noOperation);
      setDraft({ key: `create-${++serial.current}`, mode: "create", basis: null, initialValues: emptyCareForm(), reviewedValues: null });
    },
    reviewCapture(id) {
      const capture = captures.find(item => item.id === id && item.childId === child.id);
      if (!capture || access !== "editable" || locked || reading || draft || deletion) return;
      setSelectedId(null); setOperation(noOperation);
      setDraft({key:`capture-${++serial.current}`,mode:"create",basis:null,initialValues:{...capture.proposedValues},reviewedValues:null,captureId:id});
    },
    startCorrection(id) {
      const basis = records.find(item => item.id === id);
      if (!basis || access !== "editable" || reading || locked || deletion) return;
      setOperation(noOperation);
      setDraft({ key: `revise-${++serial.current}`, mode: "revise", basis, initialValues: { ...basis.current.values, reason: "" }, reviewedValues: null });
    },
    startDeletion(id) {
      const basis = records.find(item => item.id === id);
      if (!basis || !canWrite || draft || deletion) return;
      setDeletion({ basis, scopeConfirmed: false });
      setOperation({ state: "needs_confirmation", message: "記錄仍然保留。請核對刪除範圍，然後再次確認。", reference: null, latest: null });
    },
    confirmDeletionScope(checked) {
      if (!deletion || !canWrite) return;
      setDeletion({ ...deletion, scopeConfirmed: checked });
      setOperation({ state: "needs_confirmation", message: "尚未刪除；只會刪除這筆記錄及全部歷史。", reference: null, latest: null });
    },
    submitDeletion() {
      if (!deletion?.scopeConfirmed || !canWrite || operation.state !== "needs_confirmation") return;
      submitAttempt({ reference: `preview-care-operation-${++serial.current}`, mode: "delete", basis: deletion.basis, values: deletion.basis.current.values });
    },
    showHistory() { if (selected && access !== "lost") setHistoryLimit(1); },
    loadOlderHistory() {
      if (!selected || !online || historyLoading || reading) return;
      setHistoryLoading(true);
      later(() => { setHistoryLimit(previous => previous + 2); setHistoryLoading(false); });
    },
    reviewDraft(values) {
      if (!draft || access !== "editable" || locked || operation.state === "conflict") return;
      setDraft({ ...draft, reviewedValues: { ...values } });
      setOperation({ state: "needs_confirmation", message: "以下內容尚未保存。請核對原文、來源、精度及家庭共享範圍。", reference: null, latest: null });
    },
    editDraft() {
      if (!draft || locked || operation.state === "conflict") return;
      setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
      setOperation(noOperation);
    },
    submitReviewed() {
      if (!draft?.reviewedValues || !canWrite || operation.state !== "needs_confirmation") return;
      const currentAttempt: Attempt = { reference: `preview-care-operation-${++serial.current}`, mode: draft.mode, captureId: draft.captureId, basis: draft.basis, values: { ...draft.reviewedValues } };
      submitAttempt(currentAttempt);
    },
    checkOriginalOperation() {
      const currentAttempt = attempt.current;
      if (operation.state !== "unknown" || !currentAttempt || !online || reading || access !== "editable") return;
      setOperation(previous => ({ ...previous, state: "saving", message: "正在模擬查核原操作；沒有重送記錄。" }));
      later(() => {
        if (lookupOutcome === "saved") applyConfirmed(currentAttempt);
        else if (lookupOutcome === "not_applied") {
          setOperation({ state: "unknown", message: "原操作尚無確認收據；不代表已知失敗。原內容、版本與參考保留，只可明確重試同一操作。", reference: currentAttempt.reference, latest: null, retryAvailable: true });
        } else setOperation(previous => ({ ...previous, state: "unknown", message: "模擬查核後仍是結果未知；原操作參考不變，沒有重新提交。" }));
      });
    },
    retryOriginalOperation() { if (operation.retryAvailable && attempt.current && online && !reading && access === "editable") submitAttempt(attempt.current); },
    useLatestVersion() {
      if (operation.state !== "conflict" || !operation.latest || !online || access !== "editable") return;
      if (deletion) {
        setDeletion({ basis: operation.latest, scopeConfirmed: false });
        setOperation({ ...noOperation, state: "needs_confirmation", message: "已選擇最新版本；請重新核對與勾選刪除範圍，未自動刪除。" });
        return;
      }
      if (!draft) return;
      setDraft({ ...draft, basis: operation.latest, reviewedValues: null });
      setOperation({ ...noOperation, message: "已明確選擇最新版本作基準；修改草稿保留，請重新預覽及確認。" });
    },
  };

  const query = activeQuery.toLocaleLowerCase("zh-HK");
  const visibleRecords = records.slice(0, scanned).filter(item =>
    (activeKind === "all" || item.current.values.kind === activeKind)
    && `${item.title} ${item.current.values.text} ${item.current.values.source}`.toLocaleLowerCase("zh-HK").includes(query));
  const hidden = access === "lost" || reading;
  const model: CareRecordsViewModel = {
    child: { id: child.id, name: child.displayName, summary: child.ageLabel }, access, online,
    review: {state: reading ? "loading" : "ready", items: hidden ? [] : captures, hasMore: false, label: "候選核對為隔離合成示例；正式 Agent 核對佇列 port 尚未接通。"},
    dataLabel: "合成示例 · 未接駁 Server · 重新載入或切換孩子後重置",
    list: { state: reading ? "loading" : listState, records: hidden ? [] : visibleRecords,
      activeQuery, activeKind, scanned: hidden ? 0 : Math.min(scanned, records.length),
      hasMore: !hidden && listState !== "stale" && scanned < records.length, message: listMessage },
    detail: selected && !hidden && !draft && !deletion ? { record: selected, historyOpen: historyLimit > 0,
      history: selected.history.slice(0, historyLimit), historyLoading,
      hasMoreHistory: selected.history.length > historyLimit } : null,
    draft: access === "lost" ? null : draft,
    deletion: hidden ? null : deletion,
    operation: access === "lost" ? noOperation : operation,
    submitLabel: "確認家庭共享並模擬提交", checkLabel: "模擬查核原操作",
  };

  return { model, actions, condition, changeCondition, outcome, setOutcome, lookupOutcome, setLookupOutcome };
}
