import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";
import { useEffect, useRef, useState } from "react";
import type { HomeChild } from "../view-model";
import { emptyPhotoDraft, type PhotoDraftFields } from "../photo-view-model";
import type { SourceCreate, SourceDirect, SourceInput, SourceSelectionIntent, SourceOperation, SourcePhase, SourceConfirmationKind, SourcesViewModel } from "../shared-input-view-model";
import { sourceConfirmationProjection, validSourceExcerpt } from "../components/shared-inputs/source-form";
import { previewPublicSources, sourceFixture } from "./sourceFixture";
import { createSourceIntake, confirmSourceIntake, validSourceIntakeText, proposeSourceIntake, sourceIntakeIsUnresolved, sourceIntakeReadResult, type SourceIntake, type SourceIntakeReadOutcome, type SourceIntakeConnectionOutcome, type SourceIntakeProposal } from "../source-intake";

export type SourceCondition = "normal" | "empty" | "loading" | "read_error" | "read_only" | "capacity" | "lost";
export type SourceOutcome = "success" | "failed" | "unknown" | "conflict" | "capacity" | "confirmed_unavailable";
export type SourceLookup = "applied" | "unknown" | "unconfirmed" | "confirmed_unavailable" | "failed" | "running" | "not_requested";
type Receipt = { phase: "create" | "confirm" | "delete"; reference: string; checked: boolean; confirmed: boolean; apply: () => void };
type Direct = { kind: "fetch" | "extract"; basis: SourceInput; excerpt: string; checked: boolean };
const idle = (): SourceOperation => ({ state: "none", phase: null, reference: null, message: "", checked: false });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// This hook simulates metadata transitions only. Production uses the existing SharedInputApi/controller.
export function useSourcesPreview(child: HomeChild, online: boolean, identity: { id: string; name: string }, server: string) {
  const scopeKey = JSON.stringify([server, identity.id, child.id]);
  const [condition, setCondition] = useState<SourceCondition>("normal");
  const [faultPhase, setFaultPhase] = useState<SourcePhase>("create");
  const [outcome, setOutcome] = useState<SourceOutcome>("success");
  const [lookup, setLookup] = useState<SourceLookup>("unknown");
  const [items, setItems] = useState(() => sourceFixture(child.id, identity.id, identity.name));
  const [selected, setSelected] = useState<SourceInput | null>(null), [latest, setLatest] = useState<SourceInput | null>(null);
  const [intakeIntention, setIntakeIntention] = useState("");
  const [intakes, setIntakes] = useState<Record<string, SourceIntake>>({});
  const [intakeReadOutcome, setIntakeReadOutcome] = useState<SourceIntakeReadOutcome>("ready");
  const [intakeConnectionOutcome, setIntakeConnectionOutcome] = useState<SourceIntakeConnectionOutcome>("not_connected");
  const [composerSeed, setComposerSeed] = useState<SourceInput | null>(null);
  const [draft, setDraft] = useState(emptyPhotoDraft), [reviewed, setReviewed] = useState<PhotoDraftFields | null>(null), [formKey, setFormKey] = useState(0);
  const [draftUncertainties, setDraftUncertainties] = useState<readonly string[]>([]);
  const [confirmationKind, setConfirmationKind] = useState<SourceConfirmationKind>("reference");
  const [excerpt, setExcerpt] = useState("");
  const [excerptDirty, setExcerptDirty] = useState(false);
  const [fetchConsent, setFetchConsent] = useState(false), [modelConsent, setModelConsent] = useState(false);
  const [sharedConsent, setSharedConsent] = useState(false), [childFactConsent, setChildFactConsent] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false), [deleteScope, setDeleteScope] = useState(false), [deleteFinal, setDeleteFinal] = useState(false);
  const [operation, setOperation] = useState(idle), [notice, setNotice] = useState(""), [readFailed, setReadFailed] = useState(false), [reading, setReading] = useState(false);
  const [direct, setDirect] = useState<Direct | null>(null);
  const pending = useRef<Receipt | null>(null), directRef = useRef<Direct | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), generation = useRef(0), alive = useRef(true), inFlight = useRef(false), serial = useRef(0);
  const onlineRef = useRef(online); onlineRef.current = online;
  const access = condition === "lost" ? "lost" : condition === "read_only" || child.accessRole === "viewer" ? "read_only" : "editable";
  const accessRef = useRef(access); accessRef.current = access;
  const busy = inFlight.current || operation.state === "saving" || reading;
  const load = reading || condition === "loading" ? "loading" : readFailed || condition === "read_error" ? "error" : "ready";
  const conflict = operation.state === "conflict";
  const selectedIntake = selected ? intakes[selected.id] ?? null : null;
  const intakeUnresolved = sourceIntakeIsUnresolved(selectedIntake);
  usePreviewLeaveGuard(!!reviewed || excerptDirty || !!deleteOpen || !!intakeIntention || !!selectedIntake && ["clarifying", "review"].includes(selectedIntake.stage), busy || !!pending.current || !!direct || intakeUnresolved);
  const fresh = online && load === "ready" && access !== "lost" && !busy && !pending.current && !conflict;
  const manageable = !!selected && selected.canManage && selected.ownerUserId === identity.id && access === "editable";
  const canChoose = !busy && !pending.current && !directRef.current && !intakeUnresolved && access !== "lost";
  const blockedDirect = !!selected && (selected.fetchState === "unknown" || selected.extraction.state === "unknown");
  const manualAllowed = !directRef.current || directRef.current.kind === "extract" && directRef.current.checked && selected?.extraction.state !== "running";
  const canConfirm = fresh && manageable && !selected?.recordId && !!selected?.text.trim() && manualAllowed && !intakeUnresolved;
  const canCreate = access === "editable" && condition !== "capacity";
  function consentReset() { setFetchConsent(false); setModelConsent(false); setSharedConsent(false); setChildFactConsent(false); setDeleteScope(false); setDeleteFinal(false); }
  function trackDirect(value: Direct | null) { directRef.current = value; setDirect(value); }
  function cancel() { generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; inFlight.current = false; }
  function later(action: () => void) {
    const started = generation.current; inFlight.current = true;
    timer.current = setTimeout(() => { timer.current = null; if (!alive.current || started !== generation.current || !onlineRef.current || accessRef.current === "lost") return; inFlight.current = false; action(); }, 420);
  }
  function put(input: SourceInput) { setItems(previous => [input, ...previous.filter(item => item.id !== input.id)]); setSelected(input); }
  function clearEditor() {
    setSelected(null); setLatest(null); setComposerSeed(null); setDraft(emptyPhotoDraft()); setReviewed(null); setFormKey(value => value + 1);
    setDraftUncertainties([]); setIntakeIntention("");
    setExcerpt(""); setExcerptDirty(false); setConfirmationKind("reference"); setDeleteOpen(false); consentReset();
  }
  function applied(entry: Receipt) {
    pending.current = null; trackDirect(null); consentReset(); setReadFailed(false); entry.apply();
    setOperation({ state: "saved", phase: entry.phase, reference: entry.reference, checked: true, message: entry.phase === "create" ? "來源已私人保存（合成預覽）。尚未家庭共享。" : entry.phase === "confirm" ? "核對記錄已家庭共享（合成預覽）；原文、網址及候選仍屬私人。" : "私人來源及連結記錄已模擬刪除。" });
  }
  function unavailable(entry: Receipt) {
    pending.current = null; trackDirect(null); clearEditor(); setReadFailed(false);
    if (entry.phase !== "create" && selected) {
      setItems(previous => previous.filter(item => item.id !== selected.id));
      setIntakes(previous => { const next = { ...previous }; delete next[selected.id]; return next; });
    }
    setOperation({ state: "confirmed_unavailable", phase: entry.phase, reference: entry.reference, checked: true, message: "原操作已由合成收據確認，但結果已刪除或不可讀。不會按原文或 hash 猜測結果，也不會重送。" });
  }
  function sendReceipt(entry: Receipt, result: SourceOutcome) {
    if (!onlineRef.current || inFlight.current || accessRef.current !== "editable") return;
    pending.current = entry; entry.checked = false; consentReset();
    setOperation({ state: "saving", phase: entry.phase, reference: entry.reference, checked: false, message: "正在模擬提交，尚未確認保存。" });
    later(() => {
      if (result === "success") { applied(entry); return; }
      if (result === "confirmed_unavailable") { entry.confirmed = true; setReadFailed(true); setOperation({ state: "confirmed_unavailable", phase: entry.phase, reference: entry.reference, checked: false,
        message: "原收據已確認操作，但結果尚未能核對。內容仍鎖定，先重新讀取清單；不會重送或按原文／hash 猜測結果。" }); return; }
      if (result === "unknown") { setReadFailed(true); setOperation({ state: "unknown", phase: entry.phase, reference: entry.reference, checked: false, message: "提交結果未知。原內容及原操作參考已鎖定，先查核原收據；不能另建一次提交。" }); return; }
      pending.current = null; setReadFailed(true);
      if (result === "conflict" && entry.phase !== "create") { setLatest(null); setOperation({ state: "conflict", phase: entry.phase, reference: entry.reference, checked: false, message: "版本已改變，原文及手動草稿保留。先重讀，再明確載入目前版本。" }); }
      else setOperation({ state: "failed", phase: entry.phase, reference: entry.reference, checked: true, message: result === "capacity" ? "這次輸入因容量限制未被接受，草稿保留。請重讀後核對。" : "這次操作未被接受，原文及草稿保留。請先重新讀取再核對。" });
    });
  }
  function receipt(phase: Receipt["phase"], apply: () => void) { sendReceipt({ phase, reference: `preview-input-${phase}-${++serial.current}`, checked: false, confirmed: false, apply }, faultPhase === phase ? outcome : "success"); }
  function directResult(entry: Direct, state: SourceLookup) {
    const basis = entry.basis;
    const ready = state === "applied", failed = state === "failed";
    const next: SourceInput = { ...basis, version: basis.version + (state === "not_requested" ? 0 : ready || failed ? 2 : 1),
      ...(entry.kind === "fetch" ? { fetchState: ready ? "ready" : failed ? "failed" : state === "running" ? "running" : state === "not_requested" ? "not_requested" : "unknown",
        ...(ready ? { text: "這是取得公開可讀 HTML 的合成正文。\n請核對保存內容；來源日期仍採用你提供的原文。", sha256: "c".repeat(64), retrievedAt: "2026-10-01T01:00:00Z" } : {}) } : {
        extraction: { state: ready ? "available" : failed ? "failed" : state === "running" ? "running" : state === "not_requested" ? "not_requested" : "unknown", runId: "preview-extraction-run", excerpt: entry.excerpt,
          draft: ready ? { text: entry.excerpt, kind: "note", rawValue: "", unit: "", approximate: true, timeRaw: "日期仍須由家長核對", uncertainties: ["合成候選；未核實時間與孩子關係。"] } : null,
          stopReason: failed ? "preview_failure" : null, processedAt: ready || failed ? "2026-10-01T01:00:00Z" : null, model: ready ? "合成候選，沒有模型呼叫" : null } }),
    };
    put(next); setLatest(null); setReadFailed(false); consentReset();
    if (ready || failed) trackDirect(null); else trackDirect({ ...entry, checked: true });
    if (entry.kind === "fetch" && ready) setExcerpt(next.text.length <= 10000 ? next.text : "");
    setOperation({ state: ready ? "saved" : failed ? "failed" : "unknown", phase: entry.kind, reference: null, checked: true,
      message: ready ? entry.kind === "fetch" ? "正文已私人保存（合成預覽），請核對來源及實際內容。" : "有待核對的合成候選，尚未保存成家庭記錄。"
        : failed ? "原次處理已查明失敗，原文及手動草稿保留；可以另行明確同意重試。" : "已查核同一輸入，原次處理仍未完成確認。不會自動重送；明確查回只使用原版本及原片段。" });
  }
  function sendDirect(entry: Direct, result: SourceOutcome) {
    if (inFlight.current || !onlineRef.current || accessRef.current !== "editable") return;
    trackDirect({ ...entry, checked: false }); consentReset();
    setOperation({ state: "saving", phase: entry.kind, reference: null, checked: false, message: entry.kind === "fetch" ? "正在模擬取得指定來源正文…" : "正在模擬提取已選原文片段…" });
    put({ ...entry.basis, version: entry.basis.version + 1, ...(entry.kind === "fetch" ? { fetchState: "running" } : { extraction: { ...entry.basis.extraction, state: "running" } }) });
    later(() => {
      if (result === "conflict") { trackDirect(null); setReadFailed(true); setLatest(null); setOperation({ state: "conflict", phase: entry.kind, reference: null, checked: false, message: "版本已改變，原文及手動草稿保留。先重新讀取目前版本。" }); return; }
      directResult(entry, result === "success" ? "applied" : result === "failed" || result === "capacity" ? "failed" : "unknown");
      if (result === "unknown") { trackDirect({ ...entry, checked: false }); setReadFailed(true); }
    });
  }
  function refresh() {
    if (!onlineRef.current || inFlight.current || accessRef.current === "lost") return;
    setReading(true);
    later(() => {
      setReading(false);
      if (condition === "read_error") { setReadFailed(true); setNotice("讀取失敗，最近內容及草稿保留。請稍後手動重讀。"); return; }
      setReadFailed(false);
      const entry = pending.current;
      if (entry) {
        if (entry.confirmed) { entry.checked = true; setOperation({ state: "confirmed_unavailable", phase: entry.phase, reference: entry.reference, checked: true,
          message: "已重讀清單；原收據已確認，但結果仍未能核對。原內容繼續鎖定，不會按文字／hash 猜測。可明確結束本次操作並清除本頁草稿。" }); }
        else if (lookup === "applied") applied(entry);
        else if (lookup === "confirmed_unavailable") unavailable(entry);
        else { entry.checked = lookup === "unconfirmed"; setOperation({ state: entry.checked ? "unconfirmed" : "unknown", phase: entry.phase, reference: entry.reference, checked: entry.checked, message: entry.checked ? "原操作尚無確認收據。明確重試會沿用原內容及原操作參考。" : "原操作仍然結果未知，原參考及內容保留，沒有重送。" }); }
      } else if (directRef.current) directResult(directRef.current, lookup);
      else if (conflict && selected) setLatest({ ...selected, version: selected.version + 1 });
      else setNotice("已重新讀取合成來源；本頁草稿保留。");
    });
  }
  function changeCondition(next: SourceCondition) {
    if ((inFlight.current || pending.current || directRef.current) && next !== "lost") return;
    cancel(); pending.current = null; trackDirect(null); clearEditor(); setReading(false); setReadFailed(false); setOperation(idle()); setCondition(next);
    setIntakes({});
    setItems(next === "lost" || next === "empty" ? [] : sourceFixture(child.id, identity.id, identity.name));
    setNotice(next === "lost" ? "已無權存取，私人原文、候選、草稿及舊操作已清除。" : "");
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); pending.current = null; directRef.current = null; }; }, []);
  useEffect(() => {
    if (online) return;
    cancel(); setReading(false); setReadFailed(true); consentReset();
    setIntakes(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, value.stage === "reading" ? { ...value, stage: "read_unknown" as const } : value])));
    if (pending.current) pending.current.checked = false;
    if (directRef.current) trackDirect({ ...directRef.current, checked: false });
    if (pending.current || directRef.current) setOperation(previous => ({ ...previous, state: pending.current?.confirmed ? "confirmed_unavailable" : "unknown", checked: false,
      message: pending.current?.confirmed ? "原收據已確認操作，離線時不能核對結果。原參考保留，絕不重送。" : "連線中斷，結果未知。原內容保留；恢復連線後先查核原操作或同一輸入。" }));
    // Offline keeps only this page's text draft and original in-memory attempt; no outbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  function updateIntake(id: string, change: (value: SourceIntake) => SourceIntake) {
    setIntakes(previous => previous[id] ? { ...previous, [id]: change(previous[id]) } : previous);
  }
  const canEditIntake = fresh && manageable && !direct && !pending.current;
  const model: SourcesViewModel = { scopeKey,
    intake: { mode: "synthetic", intention: access === "lost" ? "" : intakeIntention, selected: access === "lost" ? null : selectedIntake },
    intakeByInputId: access === "lost" ? {} : intakes, childName: child.displayName, accountName: identity.name, online, access, load, canCreate,
    items: access === "lost" ? [] : items.map(item => ({ ...item, canManage: item.canManage && access === "editable" })), sources: previewPublicSources,
    selected: access === "lost" ? null : selected, latest, operation, direct: direct ? { kind: direct.kind, basisVersion: direct.basis.version, excerpt: direct.excerpt, checked: direct.checked } as SourceDirect : null,
    notice, draft, draftUncertainties, formKey, reviewed, confirmationKind, composerSeed, excerpt, fetchConsent, modelConsent, sharedConsent, childFactConsent, deleteOpen, deleteScope, deleteFinal,
    busy, fresh, formLocked: busy || !!pending.current || access !== "editable", canChoose,
    canFetch: fresh && manageable && !intakeUnresolved && !selected?.recordId && !direct && !blockedDirect && !!selected?.sourceUrl && ["personal_source", "public_source"].includes(selected?.kind ?? "") && ["not_requested", "failed"].includes(selected?.fetchState ?? ""),
    canExtract: fresh && manageable && !intakeUnresolved && !selected?.recordId && !direct && !blockedDirect && !!selected?.text.trim() && ["not_requested", "failed"].includes(selected?.extraction.state ?? ""),
    canConfirm, canDelete: fresh && manageable && manualAllowed && !intakeUnresolved };
  return { model, condition, changeCondition, faultPhase, setFaultPhase, outcome, setOutcome, lookup, setLookup,
    intakeReadOutcome, setIntakeReadOutcome, intakeConnectionOutcome, setIntakeConnectionOutcome, actions: {
    intake: {
      setIntention(value: string) { if (canChoose && !selected && access === "editable") setIntakeIntention(value); },
      read() {
        if (!canEditIntake || inFlight.current || !selected || selectedIntake?.stage !== "awaiting_read") return;
        const id = selected.id;
        updateIntake(id, value => ({ ...value, stage: "reading" }));
        later(() => updateIntake(id, value => sourceIntakeReadResult(value, intakeReadOutcome)));
      },
      checkRead() {
        if (!canEditIntake || !selected || selectedIntake?.stage !== "read_unknown") return;
        updateIntake(selected.id, value => sourceIntakeReadResult(value, intakeReadOutcome));
      },
      setClarification(value: string) {
        if (!canEditIntake || !selected || selectedIntake?.stage !== "clarifying") return;
        updateIntake(selected.id, intake => ({ ...intake, clarification: value }));
      },
      propose() { if (canEditIntake && selected) updateIntake(selected.id, proposeSourceIntake); },
      editManually() {
        if (!canEditIntake || !selected || intakeUnresolved) return;
        setIntakes(previous => { const current = previous[selected.id] ?? createSourceIntake("");
          return { ...previous, [selected.id]: current.proposal ? { ...current, stage: "review", proposalOrigin: "manual" } : proposeSourceIntake({ ...current, stage: "clarifying", proposalOrigin: "manual" }) }; });
      },
      editProposal(proposal: SourceIntakeProposal) {
        if (!canEditIntake || !selected || selectedIntake?.stage !== "review") return;
        updateIntake(selected.id, value => ({ ...value, proposal: copy(proposal) }));
      },
      confirmProposal() {
        if (!canEditIntake || !selected) return;
        updateIntake(selected.id, value => confirmSourceIntake(value, intakeConnectionOutcome));
      },
      checkConnection() {
        if (!canEditIntake || !selected || selectedIntake?.stage !== "connection_unknown" || intakeConnectionOutcome === "unknown") return;
        updateIntake(selected.id, value => ({ ...value, stage: "confirmed_pending_connection" }));
      },
    },
    discardDraft(kind: "composer" | "record" | "management") {
      if (pending.current || directRef.current || inFlight.current) return;
      if (kind === "composer" && !selected) { setComposerSeed(null); setIntakeIntention(""); setFormKey(value => value + 1); }
      else if (kind === "record") { setDraft(emptyPhotoDraft()); setReviewed(null); setSharedConsent(false); setChildFactConsent(false); setFormKey(value => value + 1); }
    },
    refresh, checkOriginal: refresh,
    create(input: SourceCreate) {
      if (!fresh || !canCreate || selected || direct || pending.current || !validSourceIntakeText(intakeIntention)) return;
      const payload = copy(input), source = payload.kind === "public_source" ? previewPublicSources.find(item => item.id === payload.sourceId) : null;
      if (payload.kind === "public_source" && !source) return;
      const value: SourceInput = { id: `preview-source-created-${++serial.current}`, childId: child.id, ownerUserId: identity.id, version: 1, canManage: true, createdAt: "2026-10-01T01:00:00Z",
        kind: payload.kind, sourceId: payload.kind === "public_source" ? payload.sourceId : null, sourceLabel: source?.publisher ?? (payload.kind !== "public_source" ? payload.sourceLabel : ""),
        sourceUrl: source?.url ?? (payload.kind !== "public_source" ? payload.sourceUrl : null), sourceDateText: payload.kind !== "public_source" ? payload.sourceDateText : null,
        sourceNotes: payload.kind === "personal_source" ? payload.sourceNotes : "", text: payload.kind !== "public_source" ? payload.text : "", sha256: payload.kind !== "public_source" && payload.text.trim() ? "d".repeat(64) : null, retrievedAt: null,
        fetchState: payload.kind !== "public_source" && payload.text.trim() ? "ready" : "not_requested", extraction: { state: "not_requested", runId: null, excerpt: null, draft: null, stopReason: null, processedAt: null, model: null }, recordId: null, confirmationKind: null };
      const intake = createSourceIntake(intakeIntention);
      receipt("create", () => { clearEditor(); put(value); setIntakes(previous => ({ ...previous, [value.id]: intake })); setExcerpt(value.text.length <= 10000 ? value.text : ""); });
    },
    openInput(input: SourceInput, intent?: SourceSelectionIntent) { if (intent && !intent.isCurrent()) return; if (selected?.id === input.id) { intent?.onOpened(); return; } if (!canChoose || !online || load !== "ready") return; clearEditor(); put(input); setExcerpt(input.text.length <= 10000 ? input.text : ""); setOperation(idle()); setNotice(""); intent?.onOpened(); },
    newInput() { if (!canChoose || !canCreate) return; clearEditor(); setOperation(idle()); setNotice("本頁未保存草稿已清除；已保存來源仍在清單。"); },
    recreateWithText() { if (!fresh || !canCreate || !canChoose || !selected || selected.kind !== "personal_source" || direct) return; const seed = copy(selected), intention = selectedIntake?.intention ?? ""; clearEditor(); setComposerSeed(seed); setIntakeIntention(intention); setOperation(idle()); setNotice("原來源仍保留。請自行貼上正文；保存後會建立另一項私人來源，不會更新或訂閱原項。"); },
    setFetchConsent, setModelConsent, setSharedConsent,
    setChildFactConsent(value: boolean) { setChildFactConsent(value); setSharedConsent(false); },
    setExcerpt(value: string) { if (direct || pending.current || busy) return; setExcerpt(value); setExcerptDirty(true); setModelConsent(false); },
    fetchContent() { if (model.canFetch && fetchConsent && selected) sendDirect({ kind: "fetch", basis: copy(selected), excerpt: "", checked: false }, faultPhase === "fetch" ? outcome : "success"); },
    extract() { if (model.canExtract && modelConsent && selected && validSourceExcerpt(selected.text, excerpt)) sendDirect({ kind: "extract", basis: copy(selected), excerpt, checked: false }, faultPhase === "extract" ? outcome : "success"); },
    adoptCandidate() { if (model.formLocked || !selected?.extraction.draft || selected.recordId) return; const { uncertainties, ...fields } = selected.extraction.draft; setDraft(fields); setDraftUncertainties([...uncertainties]); setFormKey(value => value + 1); setReviewed(null); consentReset(); },
    editDraft(value: PhotoDraftFields) { if (model.formLocked) return; setDraft(copy(value)); setReviewed(null); setSharedConsent(false); setChildFactConsent(false); },
    reviewDraft(value: PhotoDraftFields) { if (!canConfirm) return; setDraft(copy(value)); setReviewed(copy(value)); setSharedConsent(false); setChildFactConsent(false); },
    setConfirmationKind(value: SourceConfirmationKind) { if (model.formLocked) return; setConfirmationKind(value); setReviewed(null); setSharedConsent(false); setChildFactConsent(false); },
    confirm() { if (!canConfirm || !reviewed || !sharedConsent || !selected || confirmationKind === "family_record" && !childFactConsent) return;
      const basis = copy(selected), confirmation = sourceConfirmationProjection(reviewed, basis, confirmationKind, childFactConsent);
      receipt("confirm", () => { put({ ...basis, version: basis.version + 1, recordId: `preview-confirmed-${basis.id}`, confirmationKind: confirmation.kind }); setReviewed(null); }); },
    retryOriginal() { const entry = pending.current; if (entry?.checked && !entry.confirmed && online && !busy && !readFailed && access === "editable") sendReceipt(entry, outcome); },
    finishUnavailable() { if (operation.state !== "confirmed_unavailable" || !operation.checked || !online || load !== "ready" || busy || access === "lost") return; pending.current = null; clearEditor(); setOperation(idle()); setNotice("已結束已確認操作並清除本頁草稿；原操作不重送。請逐項核對清單。"); },
    retryDirect() { const entry = directRef.current; if (entry?.checked && fresh && manageable && (entry.kind === "fetch" ? fetchConsent : modelConsent)) sendDirect(entry, faultPhase === entry.kind ? outcome : "success"); },
    endDirect() { const entry = directRef.current; if (!fresh || !entry?.checked || !selected || (entry.kind === "fetch" ? selected.fetchState : selected.extraction.state) !== "unknown") return;
      trackDirect(null); consentReset(); setNotice("已結束本次查核。未知結果不代表未處理；不能開始新的取得或提取，已保存輸入及手動草稿保留。"); },
    useLatest() { if (!latest || !online || load !== "ready" || access !== "editable" || busy || pending.current || direct) return; put(latest); setLatest(null); if (excerpt && !latest.text.includes(excerpt)) setExcerpt(""); setOperation(idle()); consentReset(); setReviewed(null); setNotice("已明確使用目前版本，手動草稿保留。請重新核對共享內容。"); },
    openDeletion() { if (!model.canDelete) return; setDeleteOpen(true); setDeleteScope(false); setDeleteFinal(false); }, closeDeletion() { if (!busy) setDeleteOpen(false); }, setDeleteScope, setDeleteFinal,
    remove() { if (!model.canDelete || !deleteScope || !deleteFinal || !selected) return; const id = selected.id;
      receipt("delete", () => { setItems(previous => previous.filter(item => item.id !== id)); setIntakes(previous => { const next = { ...previous }; delete next[id]; return next; }); clearEditor(); }); },
  } };
}
export type SourcesPreviewController = ReturnType<typeof useSourcesPreview>;
