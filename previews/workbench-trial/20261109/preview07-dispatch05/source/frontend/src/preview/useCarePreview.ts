import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import { useEffect, useRef, useState } from "react";
import {
  careKindOptions, emptyCareForm, careReviewUsesCareOwner, careCaptureReadiness, careImportantReviewReadiness, projectCareCaptures, type CareDraftView, type CareFilter, type CareFormValues, type CareKind,
  type CareCaptureReview, type CareListState, type CareRecordsActions, type CareRecordsViewModel, type CareRecordView,
} from "../care-view-model";
import { careFormSchema } from "../components/care/care-form";
import type { HomeChild } from "../view-model";
import { createCareFixtures, createCareCaptureFixtures } from "./care-fixture";

export type CarePreviewCondition = "normal" | "prior_consent" | "read_only" | "access_lost" | "search_error" | "stale_page" | "review_unavailable" | "review_error" | "review_empty" | "source_changed" | "create_only" | "proposal_stale";
export type CarePreviewOutcome = "success" | "failed" | "unknown" | "conflict";
export type CareLookupOutcome = "unknown" | "saved" | "not_applied";
type Attempt = { captureId?: string; captureVersion?: number; sourceVersion?: string; reference: string; mode: "create" | "revise" | "delete" | "review"; basis: CareRecordView | null; values: CareFormValues };
const pageSize = 10;
const noOperation: CareRecordsViewModel["operation"] = { state: "none", message: "", reference: null, latest: null };

// Synthetic state only. This hook must never be used as the formal write transport.
export function useCarePreview(child: HomeChild, online: boolean, reading: boolean, initialKind?: CareKind, initialRecordId?: string, externalScopeKey?: string, entry = "care") {
  const scopeKey = externalScopeKey ?? `preview-care:${child.id}`;
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  const [loadedEntry, setLoadedEntry] = useState(entry);
  const entryReady = loadedEntry === entry;
  const scopeReady = loadedScope === scopeKey;
  const [condition, setCondition] = useState<CarePreviewCondition>("normal");
  const [outcome, setOutcome] = useState<CarePreviewOutcome>("success");
  const [lookupOutcome, setLookupOutcome] = useState<CareLookupOutcome>("unknown");
  const [reviewNotice, setReviewNotice] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
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
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const actionGeneration = generation.current;

  function clearTimers() {
    generation.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }

  function later(callback: () => void) {
    const scope = generation.current;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      if (alive.current && scope === generation.current && currentScope.current === scopeKey) callback();
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
  const canWrite = scopeReady && access === "editable" && online && !reading && !locked && operation.state !== "conflict";
  const selected = records.find(item => item.id === selectedId) ?? null;
  const capabilities = { create: true, update: condition !== "create_only", skip: true, confirmImportant: true };
  const projectedCaptures = projectCareCaptures(captures, records, child.id, scopeKey);

  function captureForAction(id: string, expectedVersion: number, expectedSourceVersion: string, basis?: CareRecordView | null) {
    if (!scopeReady || currentScope.current !== scopeKey || generation.current !== actionGeneration || access !== "editable" || reading || locked || ["review_unavailable", "review_error"].includes(condition)) return null;
    const capture = projectedCaptures.find(item => item.id === id);
    if (!capture) { setReviewNotice("這筆提案已失效或移除，請重新讀取待確認內容。"); return null; }
    const candidate = basis && capture.target.kind === "update" ? { ...capture, target: { ...capture.target, expectedVersion: basis.current.version } } : capture;
    const readiness = careCaptureReadiness(candidate, { childId: child.id, access, capabilities, expectedVersion, expectedSourceVersion });
    if (!readiness.allowed) { setReviewNotice(readiness.reason); return null; }
    return candidate;
  }

  function captureDraft(capture: CareCaptureReview, reviewed: boolean): CareDraftView {
    return { key: `capture-${++serial.current}`, mode: capture.target.kind === "update" ? "revise" : "create", basis: capture.basis ?? null,
      initialValues: { ...capture.proposedValues }, reviewedValues: reviewed ? { ...capture.proposedValues } : null,
      captureId: capture.id, captureSnapshot: { ...capture, proposedValues: { ...capture.proposedValues } } };
  }

  function currentDraftCapture() {
    const snapshot = draft?.captureSnapshot;
    return !snapshot || !!captureForAction(snapshot.id, snapshot.version, snapshot.sourceVersion, draft?.basis);
  }

  function applyConfirmed(currentAttempt: Attempt) {
    const basis = currentAttempt.basis;
    if (currentAttempt.mode === "review" && basis) {
      setCaptures(previous => previous.map(item => item.id === currentAttempt.captureId && item.version === currentAttempt.captureVersion ? { ...item,
        reviewState: "confirmed", confirmation: { scopeKey, proposalVersion: item.version, sourceVersion: currentAttempt.sourceVersion ?? "", recordId: basis.id, recordVersion: basis.current.version, label: "家長已明確確認這個版本（合成）" } } : item));
      setOperation({ kind: "review", state: "saved", message: "已取得合成核對確認結果；沒有再次寫入記錄，沒有通知、預約或醫療行動。", reference: currentAttempt.reference, latest: null });
      attempt.current = null; return;
    }
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
    if (currentAttempt.captureId) setCaptures(previous => previous.map(item => item.id === currentAttempt.captureId && item.version === currentAttempt.captureVersion
      ? { ...item, writeState: "saved", reviewState: "confirmed", resolution: { label: "已取得本次合成保存結果", recordId: record.id, recordVersion: record.current.version } } : item));
    setRecords(previous => basis ? previous.map(item => item.id === basis.id ? record : item) : [record, ...previous]);
    setSelectedId(record.id);
    setHistoryLimit(0);
    setDraft(null);
    // Correction keeps the prefix; creation prepends one record to that same prefix.
    if (!basis) { setPageIndex(0); setScanned(pageSize); }
    setListState("ready");
    setListMessage(null);
    setOperation({ state: "saved", message: "模擬已保存；只更新本次照顧記錄預覽，沒有 Server 收據。", reference: currentAttempt.reference, latest: null });
    attempt.current = null;
  }

  function changeCondition(next: CarePreviewCondition, resetScope = false) {
    if (locked && next !== "access_lost" && !resetScope) return;
    clearTimers();
    attempt.current = null;
    setCondition(next);
    const fixtureScenario = next === "prior_consent" || next !== "normal" && captures.some(capture => capture.reviewRequirement === "prewrite") ? "prior_consent" : "normal";
    setRecords(createCareFixtures(child.id, fixtureScenario));
    setCaptures(next === "access_lost" || next === "review_empty" ? [] : createCareCaptureFixtures(child.id, fixtureScenario).map(capture => ({ ...capture,
      sourceState: next === "source_changed" ? "changed" : capture.sourceState,
      target: next === "proposal_stale" && capture.target.kind === "update" ? { ...capture.target, expectedVersion: capture.target.expectedVersion + 1 } : capture.target,
    })));
    setReviewNotice(""); setPageIndex(0);
    setScanned(pageSize);
    setListState("ready");
    setListMessage(null);
    setActiveQuery(""); setActiveKind("all");
    setSelectedId(null); setHistoryLimit(0); setHistoryLoading(false);
    setDraft(null); setDeletion(null); setOperation(noOperation);
  }

  function submitAttempt(currentAttempt: Attempt) {
    if (currentScope.current !== scopeKey || generation.current !== actionGeneration) return;
    attempt.current = currentAttempt;
    setOperation({ kind: currentAttempt.mode === "review" ? "review" : undefined, state: "saving", message: "正在模擬提交；請等候結果，沒有向 Server 發出請求。", reference: currentAttempt.reference, latest: null });
    later(() => {
      if (outcome === "failed") {
        setOperation({ kind: currentAttempt.mode === "review" ? "review" : undefined, state: "failed", message: currentAttempt.mode === "review" ? "核對確認未成功，原記錄仍然保存，重要黃燈保留。" : currentAttempt.mode === "delete" ? "模擬失敗：已知沒有刪除。請重新核對並確認刪除範圍。" : "模擬失敗：已知沒有保存。草稿保留，請核對後重新預覽。", reference: currentAttempt.reference, latest: null });
        setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
        setDeletion(previous => previous ? { ...previous, scopeConfirmed: false } : null);
        attempt.current = null;
      } else if (outcome === "unknown") {
        setOperation({ kind: currentAttempt.mode === "review" ? "review" : undefined, state: "unknown", message: currentAttempt.mode === "review" ? "重要記錄的核對確認結果未知；原記錄保留，黃燈未清除。先查核同一原操作，不能重複確認。" : "結果未知：先查核同一個原操作，不能再建立一次提交。操作保持鎖定。", reference: currentAttempt.reference, latest: null });
      } else if (outcome === "conflict" && currentAttempt.basis) {
        const basis = currentAttempt.basis;
        const latest: CareRecordView = { ...basis, current: { ...basis.current, version: basis.current.version + 1,
          values: { ...basis.current.values, text: `${basis.current.values.text}\n家人補充：這是另一個版本的合成觀察。`, reason: "另一位家人補充觀察（合成）" },
          confirmedByLabel: "爸爸（合成）", confirmedAtLabel: "2026 年 9 月 29 日 上午 9:55（合成）" }, history: [basis.current, ...basis.history] };
        setRecords(previous => previous.map(item => item.id === basis.id ? latest : item));
        setOperation({ kind: currentAttempt.mode === "review" ? "review" : undefined, state: "conflict", message: currentAttempt.mode === "review" ? "重要記錄版本已改變，這次核對確認未被接受。請重新選取該筆並核對目前版本。" : currentAttempt.mode === "delete" ? "版本已改變；這次刪除未執行。請比較原版本與最新版本，再重新確認範圍。" : "版本已改變；這次更正未保存。請比較原版本、新版本與你的草稿。", reference: currentAttempt.reference, latest });
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
        setActiveQuery(query.trim()); setActiveKind(kind); setPageIndex(0); setScanned(pageSize); setListState("ready");
      });
    },
    loadMore() {
      if (!online || reading || access === "lost" || draft || deletion || locked || listState !== "ready" || (pageIndex + 1) * pageSize >= records.length) return;
      setListState("loading_more"); setSelectedId(null); setHistoryLimit(0);
      later(() => {
        if (condition === "stale_page") {
          setListState("stale"); setListMessage("搜尋頁面已失效。已載入內容只供核對，請重新搜尋後再繼續。");
          return;
        }
        setPageIndex(previous => previous + 1); setScanned(previous => Math.min(records.length, previous + pageSize)); setListState("ready");
      });
    },
    previousPage() {
      if (!online || reading || access === "lost" || draft || deletion || locked || listState !== "ready" || pageIndex === 0) return;
      setPageIndex(previous => previous - 1); setSelectedId(null); setHistoryLimit(0);
    },
    openRecord(id) {
      if (access === "lost" || reading || locked || draft || deletion) return;
      setSelectedId(id); setHistoryLimit(0); setHistoryLoading(false);
    },
    closePanel() {
      if (locked) return;
      setDraft(null); setDeletion(null); setSelectedId(null); setHistoryLimit(0); setOperation(noOperation); attempt.current = null;
    },
    startCreate(kind) {
      if (access !== "editable" || locked || draft || deletion || reading) return;
      setSelectedId(null); setOperation(noOperation);
      setDraft({ key: `create-${++serial.current}`, mode: "create", basis: null, initialValues: { ...emptyCareForm(), kind: kind ?? "note" }, reviewedValues: null });
    },
    reviewCapture(id, expectedVersion, expectedSourceVersion) {
      if (draft || deletion) return;
      const capture = captureForAction(id, expectedVersion, expectedSourceVersion);
      if (!capture) return;
      setSelectedId(null); setOperation(noOperation); setReviewNotice("");
      setDraft(captureDraft(capture, false));
    },
    confirmCapture(id, expectedVersion, expectedSourceVersion) {
      if (!canWrite || draft || deletion || attempt.current) return;
      const capture = captureForAction(id, expectedVersion, expectedSourceVersion);
      if (!capture) return;
      const nextDraft = captureDraft(capture, true);
      if (!careFormSchema(nextDraft.mode).safeParse(capture.proposedValues).success) {
        setReviewNotice("提案內容仍有欄位待核對，請先調整內容。"); return;
      }
      setSelectedId(null); setDraft(nextDraft); setReviewNotice("");
      submitAttempt({ reference: `preview-care-operation-${++serial.current}`, mode: nextDraft.mode, basis: nextDraft.basis,
        values: { ...capture.proposedValues }, captureId: capture.id, captureVersion: capture.version });
    },
    confirmImportantRecord(id, expectedVersion, expectedSourceVersion, recordId, recordVersion, expectedScopeKey) {
      if (!canWrite || draft || deletion || attempt.current || currentScope.current !== scopeKey || generation.current !== actionGeneration) return;
      const capture = projectedCaptures.find(item => item.id === id);
      if (!capture) return;
      const readiness = careImportantReviewReadiness(capture, { childId: child.id, scopeKey, access, capabilities, expectedVersion, expectedSourceVersion, recordId, recordVersion, expectedScopeKey });
      if (!readiness.allowed) { setReviewNotice(readiness.reason); return; }
      setReviewNotice("");
      submitAttempt({ reference: `preview-care-review-${++serial.current}`, mode: "review", captureId: capture.id, captureVersion: capture.version, sourceVersion: capture.sourceVersion,
        basis: capture.savedRecord!, values: { ...capture.savedRecord!.current.values } });
    },
    skipCapture(id, expectedVersion) {
      if (!scopeReady || currentScope.current !== scopeKey || generation.current !== actionGeneration || access !== "editable" || reading || locked || draft || deletion || attempt.current || !capabilities.skip) return;
      const capture = captures.find(item => item.id === id && item.version === expectedVersion && item.childId === child.id && item.reviewState === "pending" && item.writeState === "not_saved" && item.reviewRequirement !== "required");
      if (!capture || !careReviewUsesCareOwner(capture) || capture.operationValidity && capture.operationValidity.state !== "active") return;
      setCaptures(previous => previous.map(item => item.id === id && item.version === expectedVersion ? { ...item, reviewState: "skipped", resolution: { label: "家長選擇略過（合成）" } } : item));
      setReviewNotice("已略過這筆提案；沒有寫入或刪除已有記錄。這只影響本次合成預覽。");
      setOperation(noOperation);
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
      if (!draft || access !== "editable" || locked || operation.state === "conflict" || !currentDraftCapture()) return;
      setDraft({ ...draft, reviewedValues: { ...values } });
      setOperation({ state: "needs_confirmation", message: "以下內容尚未保存。請核對原文、來源、精度及家庭共享範圍。", reference: null, latest: null });
    },
    editDraft() {
      if (!draft || locked || operation.state === "conflict") return;
      setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
      setOperation(noOperation);
    },
    submitReviewed() {
      if (!draft?.reviewedValues || !canWrite || attempt.current || operation.state !== "needs_confirmation" || !currentDraftCapture()) return;
      const currentAttempt: Attempt = { reference: `preview-care-operation-${++serial.current}`, mode: draft.mode, captureId: draft.captureId, captureVersion: draft.captureSnapshot?.version, basis: draft.basis, values: { ...draft.reviewedValues } };
      submitAttempt(currentAttempt);
    },
    checkOriginalOperation() {
      const currentAttempt = attempt.current;
      if (operation.state !== "unknown" || !currentAttempt || !online || reading || access !== "editable") return;
      setOperation(previous => ({ ...previous, state: "saving", message: "正在模擬查核原操作；沒有重送記錄。" }));
      later(() => {
        if (lookupOutcome === "saved") applyConfirmed(currentAttempt);
        else if (lookupOutcome === "not_applied") {
          setOperation({ kind: currentAttempt.mode === "review" ? "review" : undefined, state: "unknown", message: "原操作尚無確認收據；不代表已知失敗。原內容、版本與參考保留，只可明確重試同一操作。", reference: currentAttempt.reference, latest: null, retryAvailable: true });
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

  useEffect(() => {
    if (loadedScope !== scopeKey) { changeCondition("normal", true); setLoadedScope(scopeKey); }
  }, [scopeKey]);
  useEffect(() => {
    if (loadedEntry !== entry) {
      if (!locked) actions.closePanel();
      setLoadedEntry(entry);
    }
  }, [entry]);

  const query = activeQuery.toLocaleLowerCase("zh-HK");
  const visibleRecords = records.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).filter(item =>
    (activeKind === "all" || item.current.values.kind === activeKind)
    && `${item.title} ${item.current.values.text} ${item.current.values.source}`.toLocaleLowerCase("zh-HK").includes(query));
  const hidden = access === "lost" || reading || !scopeReady;
  const model: CareRecordsViewModel = {
    child: { id: child.id, name: child.displayName, summary: child.ageLabel }, access, online,
    review: {state: reading ? "loading" : condition === "review_unavailable" || access === "lost" ? "unavailable" : condition === "review_error" ? "error" : "ready",
      scopeKey, items: hidden || condition === "review_unavailable" || condition === "review_error" ? [] : projectedCaptures, hasMore: false, capabilities, notice: reviewNotice,
      label: "以下為多次對話的合成示例。普通已保存與重要待確認用於試看流程；正式跨對話讀取、普通自動寫入與持久核對仍未接通。"},
    scopeKey,
    dataLabel: "合成示例 · 未接駁 Server · 重新載入或切換孩子後重置",
    list: { state: reading ? "loading" : listState, records: hidden ? [] : visibleRecords,
      activeQuery, activeKind, scanned: hidden ? 0 : Math.min(scanned, records.length),
      page: pageIndex + 1, hasPrevious: !hidden && pageIndex > 0, hasMore: !hidden && listState !== "stale" && (pageIndex + 1) * pageSize < records.length, message: listMessage },
    detail: selected && !hidden && !draft && !deletion ? { record: selected, historyOpen: historyLimit > 0,
      history: selected.history.slice(0, historyLimit), historyLoading,
      hasMoreHistory: selected.history.length > historyLimit } : null,
    draft: hidden ? null : draft,
    deletion: hidden ? null : deletion,
    operation: access === "lost" || !scopeReady ? noOperation : { ...operation, referenceLabel: operation.reference ? `合成操作參考：${operation.reference}；不是 Server opId。` : undefined },
    submitLabel: "確認家庭共享並模擬提交", checkLabel: "模擬查核原操作",
  };

  function invalidateCaptureSource() {
    if (locked) return;
    const id = draft?.captureId ?? projectedCaptures.find(item => item.reviewState === "pending")?.id;
    if (!id) return;
    clearTimers();
    setCaptures(previous => previous.map(item => item.id === id ? { ...item, sourceState: "changed", sourceVersion: `${item.sourceVersion}:changed` } : item));
    setReviewNotice("原始來源已變更；未保存草稿保留，但須重新核對提案後才可確認。");
    setDraft(previous => previous?.captureId === id ? { ...previous, reviewedValues: null } : previous);
  }
  return { model, actions, scopeReady, entryReady, invalidateCaptureSource, condition, changeCondition, outcome, setOutcome, lookupOutcome, setLookupOutcome };
}
