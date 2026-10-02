import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { HomeChild } from "../view-model";
import { emptyPhotoDraft, photoLimits, samePhotoOriginal, type PhotoDraftFields, type PhotoItem, type PhotoOperation, type PhotoOriginal, type PhotoPhase, type PhotoReplacement, type PhotosActions, type PhotosViewModel } from "../photo-view-model";
import { photoDraftSchema, photoConfirmationProjection } from "../components/photos/photo-form";
import { photoFixture, photoPreviewCandidate } from "./photoFixture";
import { usePreviewLeaveGuard } from "./PreviewNavigationGuard";

export type PhotoPreviewCondition = "normal" | "empty" | "loading" | "read_error" | "read_only" | "capacity" | "access_lost";
export type PhotoPreviewOutcome = "success" | "failed" | "unknown" | "conflict" | "capacity" | "confirmed_unavailable";
export type PhotoPreviewLookup = "applied" | "unconfirmed" | "unknown" | "confirmed_unavailable";
type Attempt = { phase: PhotoPhase; reference: string; checked: boolean; apply: (continueFlow: boolean) => void };
const idle = (): PhotoOperation => ({ state: "none", phase: null, reference: null, message: "", checked: false });

export function usePhotosPreview(child: HomeChild, online: boolean, reading: boolean) {
  const [condition, setCondition] = useState<PhotoPreviewCondition>("normal");
  const [outcome, setOutcome] = useState<PhotoPreviewOutcome>("success");
  const [faultPhase, setFaultPhase] = useState<PhotoPhase>("upload");
  const [lookup, setLookup] = useState<PhotoPreviewLookup>("applied");
  const [items, setItems] = useState<PhotoItem[]>(() => photoFixture(child.id, child.accessRole === "viewer"));
  const [selected, setSelected] = useState<PhotoItem | null>(null);
  const [latest, setLatest] = useState<PhotoItem | null>(null);
  const [original, setOriginal] = useState<PhotoOriginal | null>(null);
  const [source, setSource] = useState("由我提供的原照片");
  const [sourceError, setSourceError] = useState("");
  const [draft, setDraft] = useState<PhotoDraftFields>(emptyPhotoDraft);
  const [formKey, setFormKey] = useState(0);
  const [reviewed, setReviewed] = useState<PhotoDraftFields | null>(null);
  const [modelConsent, setModelConsent] = useState(false);
  const [sharedConsent, setSharedConsent] = useState(false);
  const [operation, setOperation] = useState<PhotoOperation>(idle);
  const [notice, setNotice] = useState("");
  const [readError, setReadError] = useState(false);
  const [reservationUnidentified, setReservationUnidentified] = useState(false);
  const [replacement, setReplacement] = useState<PhotoReplacement | null>(null);
  const [deletion, setDeletion] = useState(false);
  const [deleteScope, setDeleteScope] = useState(false);
  const [deleteFinal, setDeleteFinal] = useState(false);
  const pending = useRef<Attempt | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serial = useRef(0), generation = useRef(0), alive = useRef(true), inFlight = useRef(false);
  const leases = useRef(new Set<PhotoOriginal>());
  const attachedOriginals = useRef(new Map<string, PhotoOriginal>());
  const replacementRef = useRef(replacement); replacementRef.current = replacement;
  const onlineRef = useRef(online); onlineRef.current = online;
  const access = condition === "access_lost" ? "lost" : condition === "read_only" || child.accessRole === "viewer" ? "read_only" : "editable";
  const load = reading || condition === "loading" ? "loading" : readError || condition === "read_error" ? "error" : "ready";
  const busy = operation.state === "saving" || inFlight.current;
  const fresh = online && load === "ready" && access !== "lost" && !busy && operation.state !== "conflict";
  const unresolved = ["unknown", "unconfirmed", "confirmed_unavailable"].includes(operation.state);
  usePreviewLeaveGuard(!!(original && selected?.state !== "ready" || draft.text || draft.rawValue || draft.unit || draft.timeRaw || reviewed), busy || unresolved);
  const extractionPending = unresolved && operation.phase === "extract";
  const hardLocked = busy || (unresolved && !extractionPending) || operation.state === "conflict";
  const manageable = selected?.canManage && selected.isUploader && selected.visibility === "private" && selected.recordId === null && access === "editable";
  const canCreate = access === "editable" && condition !== "capacity";
  const canPick = !hardLocked && !pending.current && !replacement && access === "editable" && (selected ? !!manageable && selected.state === "reserved" : canCreate) && load !== "loading";
  const canUpload = fresh && !reservationUnidentified && !!original && (!pending.current || pending.current.phase === "upload" && pending.current.checked)
    && (selected ? !!manageable && selected.state === "reserved" && samePhotoOriginal(selected, original) : canCreate);
  const canExtract = fresh && !!manageable && selected?.state === "ready" && !pending.current && ["not_requested", "failed"].includes(selected.extraction.state);
  const canConfirm = fresh && !!manageable && selected?.state === "ready" && !!reviewed && sharedConsent
    && (!pending.current || pending.current.phase === "extract" && pending.current.checked);
  const canDelete = fresh && !!selected?.canManage && access === "editable" && (!pending.current || pending.current.phase === "extract" && pending.current.checked);

  function releaseTransient(value: PhotoOriginal | null) {
    if (value && leases.current.has(value) && ![...attachedOriginals.current.values()].includes(value)) { value.dispose?.(); leases.current.delete(value); }
  }
  function resetConsents() { setModelConsent(false); setSharedConsent(false); setDeleteScope(false); setDeleteFinal(false); }
  function clearEditorNow() {
    releaseTransient(original); setOriginal(null); setSelected(null); setLatest(null); setDraft(emptyPhotoDraft()); setFormKey(value => value + 1);
    setReviewed(null); setSource("由我提供的原照片"); setSourceError(""); setDeletion(false); resetConsents(); setReservationUnidentified(false);
  }
  function putPhoto(photo: PhotoItem) { setItems(previous => [photo, ...previous.filter(item => item.id !== photo.id)]); setSelected(photo); resetConsents(); }
  function unavailable(entry: Attempt) {
    pending.current = null; resetConsents(); setReviewed(null);
    if (entry.phase === "reserve") setReservationUnidentified(true);
    else { if (selected) setItems(previous => previous.filter(item => item.id !== selected.id)); clearEditorNow(); }
    setOperation({ state: "confirmed_unavailable", phase: entry.phase, reference: entry.reference, checked: true,
      message: "原操作已確認，但結果已刪除或不可讀。不能再次提交；請重新讀取核對。" });
  }
  function applyAttempt(entry: Attempt, continueFlow = false) {
    pending.current = null; resetConsents(); setReadError(false);
    setOperation({ state: "saved", phase: entry.phase, reference: entry.reference, checked: true,
      message: entry.phase === "delete" ? "已模擬移除附件及連結記錄；實體清理仍在排程，未宣稱清理完成。" : "已收到合成確認；沒有寫入 Server。" });
    entry.apply(continueFlow);
  }
  function runAttempt(entry: Attempt, result: PhotoPreviewOutcome) {
    if (inFlight.current || !onlineRef.current || access === "lost") return;
    const started = generation.current; inFlight.current = true; pending.current = entry;
    entry.checked = false; resetConsents(); setOperation({ state: "saving", phase: entry.phase, reference: entry.reference, checked: false, message: "正在模擬處理，尚未確認結果。" });
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!alive.current || generation.current !== started) return;
      inFlight.current = false;
      const actual = onlineRef.current ? result : "unknown";
      if (actual === "success") { applyAttempt(entry, true); return; }
      if (actual === "confirmed_unavailable" && !["upload", "extract"].includes(entry.phase)) { unavailable(entry); return; }
      if (actual === "conflict" && ["confirm", "delete"].includes(entry.phase)) {
        pending.current = null; setReadError(true); setLatest(null); setReviewed(null);
        setOperation({ state: "conflict", phase: entry.phase, reference: entry.reference, checked: false, message: "版本已改變；原照片及手動草稿保留。先重新讀取，再由你明確選擇目前版本。" }); return;
      }
      if (actual === "failed" || actual === "capacity") {
        pending.current = null; setReadError(true);
        if (entry.phase === "extract" && selected) putPhoto({ ...selected, extraction: { state: "failed", candidate: null } });
        setOperation({ state: "failed", phase: entry.phase, reference: entry.reference, checked: true,
          message: actual === "capacity" ? "容量超出限制，這次提交未被接受。原照片及草稿保留；核對容量後再試。" : "已模擬失敗，原照片及草稿保留。先重新讀取；提取失敗仍可手動記錄。" }); return;
      }
      if (entry.phase === "extract" && selected) putPhoto({ ...selected, extraction: { state: "unknown", candidate: null } });
      setReadError(true); setOperation({ state: "unknown", phase: entry.phase, reference: entry.reference, checked: false,
        message: entry.phase === "extract" ? "提取結果未知。查核同一附件，這次提取不會重送；查核後仍可手動確認記錄。" : entry.phase === "upload" ? "上傳結果未知。先查核同一附件及同一完整性資料，不會自動重傳原檔。" : "提交結果未知。原內容及操作參考已保留，先查核原操作，不另建一次提交。" });
    }, 380);
  }
  function begin(phase: PhotoPhase, apply: Attempt["apply"]) {
    const result = faultPhase === phase ? outcome : "success";
    runAttempt({ phase, reference: `preview-photo-${phase}-${++serial.current}`, checked: false, apply }, result);
  }
  function sendUpload(photo: PhotoItem, file: PhotoOriginal) {
    if (!samePhotoOriginal(photo, file)) { setNotice("原檔與附件的類型、大小或 SHA-256 不符。請選回相同原檔，草稿保留。"); return; }
    begin("upload", () => { attachedOriginals.current.set(photo.id, file); putPhoto({ ...photo, state: "ready", version: photo.version + 1, imageSource: file.imageSource });
      setNotice("原照片已模擬私人保存。尚未與家庭共享，可手動記錄或另行同意提取。"); });
  }
  function replaceNow(next: PhotoReplacement) {
    clearEditorNow(); setOperation(idle()); setNotice("");
    if (next.kind === "original") { setOriginal(next.original); leases.current.add(next.original); }
    if (next.kind === "item") { setSelected(next.item); setSource(next.item.source); setOriginal(attachedOriginals.current.get(next.item.id) ?? null); }
  }
  function requestReplacement(next: PhotoReplacement) {
    if (hardLocked || pending.current || replacement || access === "lost") { if (next.kind === "original") next.original.dispose?.(); return; }
    if (original || selected || draft.text || draft.rawValue || draft.unit || draft.timeRaw) setReplacement(next);
    else replaceNow(next);
  }
  function checkOriginal() {
    const entry = pending.current;
    if (!entry || !online || busy) return;
    if (lookup === "applied") { applyAttempt(entry); return; }
    if (lookup === "confirmed_unavailable" && !["upload", "extract"].includes(entry.phase)) { unavailable(entry); return; }
    if (lookup === "unknown") { setOperation(previous => ({ ...previous, checked: false, message: "仍未查明原結果。原操作保持鎖定；沒有新提交。" })); return; }
    entry.checked = true; setReadError(false); resetConsents();
    setOperation(previous => ({ ...previous, state: entry.phase === "extract" ? "unknown" : "unconfirmed", checked: true,
      message: entry.phase === "extract" ? "已查核提取仍未確認，這次提取不會重送。你可直接手動核對並確認記錄。" : entry.phase === "upload" ? "已查核同一附件仍待上傳，可明確重試同一附件及原檔。" : "原操作尚無確認收據。只可明確重試同一內容及同一操作參考。" }));
  }
  const actions: PhotosActions = {
    pickOriginal(file) {
      if (!canPick) { file.dispose?.(); return; }
      if (!["image/jpeg", "image/png"].includes(file.mimeType) || file.bytes < 1 || file.bytes > photoLimits.bytes || !Number.isInteger(file.bytes)
        || !file.fileName || file.fileName.length > 200 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        file.dispose?.(); setNotice("原照片的類型、大小、檔名或完整性資料不完整，現有原檔及草稿保留。"); return;
      }
      if (selected?.state === "reserved") {
        if (!samePhotoOriginal(selected, file)) { file.dispose?.(); setNotice("原檔與附件的類型、大小或 SHA-256 不符。請選回相同原檔，草稿保留。"); return; }
        releaseTransient(original); setOriginal(file); leases.current.add(file); setNotice("已核對同一原檔；沿用附件識別、來源及草稿。");
      } else requestReplacement({ kind: "original", original: file });
    },
    reportFileError: setNotice,
    openPhoto: item => requestReplacement({ kind: "item", item }), clearEditor: () => requestReplacement({ kind: "clear" }),
    confirmReplacement() { if (!replacement || hardLocked) return; const next = replacement; setReplacement(null); replaceNow(next); },
    cancelReplacement() { if (replacement?.kind === "original") replacement.original.dispose?.(); setReplacement(null); },
    editSource(value) { if (hardLocked || selected) return; setSource(value); setSourceError(""); setSharedConsent(false); },
    upload() {
      if (!canUpload || !original) return;
      if (pending.current?.phase === "upload" && pending.current.checked) { runAttempt(pending.current, outcome); return; }
      if (selected) { sendUpload(selected, original); return; }
      if (!source.trim() || source.length > 200) { setSourceError("請填寫照片來源，最多 200 字；保留你的原文字。"); return; }
      const file = original, originalSource = source;
      const photo: PhotoItem = { fileName: file.fileName, mimeType: file.mimeType, bytes: file.bytes, sha256: file.sha256,
        id: `${child.id}-new-photo-${++serial.current}`, childId: child.id, source: originalSource, ownerLabel: "本人（合成）", isUploader: true,
        createdAtLabel: "本次預覽", version: 1, canManage: true, state: "reserved", visibility: "private", recordId: null, imageSource: null, extraction: { state: "not_requested", candidate: null } };
      begin("reserve", continueFlow => { putPhoto(photo); if (continueFlow) sendUpload(photo, file); else setNotice("已查回私人附件；原檔仍待上傳。請明確繼續上傳，不會另建附件。"); });
    },
    refresh() {
      if (!online || busy || access === "lost") return;
      if (pending.current) { checkOriginal(); return; }
      if (operation.state === "conflict" && selected) setLatest({ ...selected, version: selected.version + 1 });
      if (operation.state === "confirmed_unavailable" && !reservationUnidentified) setOperation(idle());
      setReadError(false); setReviewed(null); resetConsents(); if (condition === "read_error" || condition === "loading") setCondition("normal");
      setNotice("已模擬重新讀取；原照片及草稿保留。這不是 Server 查核。");
    },
    setModelConsent: value => { if (canExtract) setModelConsent(value); },
    extract() {
      if (!canExtract || !selected || !modelConsent) return; const basis = selected;
      begin("extract", () => { putPhoto({ ...basis, version: basis.version + 1, extraction: { state: "available", candidate: photoPreviewCandidate } }); setNotice("合成候選已備妥，尚未成為家庭記錄。採用會取代本頁手動草稿，請先核對。"); });
    },
    adoptCandidate() {
      if (hardLocked || !manageable || !selected?.extraction.candidate) return;
      // The explicit button names the replacement; extraction never overwrites the editor automatically.
      const { uncertainties: _uncertainties, ...fields } = selected.extraction.candidate;
      setDraft({ ...fields }); setFormKey(value => value + 1); setReviewed(null); setSharedConsent(false); setNotice("已按你的選擇採用候選，仍是未共享草稿。");
    },
    editDraft(value) { if (hardLocked || access !== "editable") return; setDraft(value); setReviewed(null); setSharedConsent(false); },
    reviewDraft(value) { if (!fresh || hardLocked || access !== "editable" || !photoDraftSchema.safeParse(value).success) return; setDraft(value); setReviewed({ ...value }); setSharedConsent(false); },
    setSharedConsent: value => { if (!hardLocked && reviewed) setSharedConsent(value); },
    confirmShared() {
      if (!canConfirm || !selected || !reviewed) return; const basis = selected, values = photoConfirmationProjection({ ...reviewed }, basis.source);
      begin("confirm", () => { putPhoto({ ...basis, version: basis.version + 1, visibility: "shared", recordId: `${basis.id}-record` });
        setDraft(emptyPhotoDraft()); setFormKey(value => value + 1); setReviewed(null); setDeletion(false);
        setNotice(`已模擬確認原照片及「${values.text}」為家庭共享記錄；不是私人聊天共享，沒有送出提醒。`); });
    },
    checkOriginal,
    retryOriginal() { const entry = pending.current; if (entry?.checked && entry.phase !== "extract" && online && !readError && access === "editable" && !busy) runAttempt(entry, outcome); },
    finishUnidentified() { if (!reservationUnidentified || busy) return; setOperation(idle()); setNotice("已明確結束待查，原檔及草稿保留。請逐項開啟附件清單核對；不會重新建立附件。"); },
    useLatest() { if (!latest || !online || busy || pending.current) return; setSelected(latest); setSource(latest.source); setLatest(null); setReviewed(null); resetConsents(); setOperation(idle()); setNotice("已明確改用目前版本，手動草稿保留。須重新預覽及確認共享範圍。"); },
    openDeletion() { if (canDelete) { setDeletion(true); setDeleteScope(false); setDeleteFinal(false); } },
    closeDeletion() { if (!busy) setDeletion(false); },
    setDeleteScope: value => { if (!hardLocked) setDeleteScope(value); }, setDeleteFinal: value => { if (!hardLocked) setDeleteFinal(value); },
    deletePhoto() {
      if (!canDelete || !selected || !deleteScope || !deleteFinal) return; const basis = selected;
      begin("delete", () => { setItems(previous => previous.filter(item => item.id !== basis.id)); const file = attachedOriginals.current.get(basis.id);
        attachedOriginals.current.delete(basis.id); if (file && file !== original) { file.dispose?.(); leases.current.delete(file); }
        clearEditorNow(); setNotice("附件及連結確認記錄已模擬移除。實體檔案清理仍在排程，不等於即時完成備份清理。"); });
    },
  };
  function changeCondition(value: PhotoPreviewCondition) {
    if ((busy || unresolved) && value !== "access_lost") return;
    generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; inFlight.current = false; pending.current = null;
    for (const file of leases.current) file.dispose?.(); leases.current.clear(); attachedOriginals.current.clear();
    if (replacement?.kind === "original") replacement.original.dispose?.(); setReplacement(null); clearEditorNow(); setOperation(idle()); setNotice(""); setReadError(false);
    setCondition(value); setItems(value === "empty" || value === "loading" || value === "access_lost" ? [] : photoFixture(child.id, value === "read_only" || child.accessRole === "viewer"));
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; if (timer.current) clearTimeout(timer.current);
    for (const file of leases.current) file.dispose?.(); leases.current.clear(); attachedOriginals.current.clear();
    if (replacementRef.current?.kind === "original") replacementRef.current.original.dispose?.(); }; }, []);
  useEffect(() => {
    if (online) return;
    generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; inFlight.current = false;
    setReadError(true); setReviewed(null); setDeletion(false); resetConsents();
    const entry = pending.current;
    if (entry) { entry.checked = false; setOperation({ state: "unknown", phase: entry.phase, reference: entry.reference, checked: false,
      message: "已離線；原內容及操作參考保留。回線後先查核原操作，舊查核與同意不能沿用。" }); }
    setNotice("照片及手動草稿保留。回線後須手動重新讀取，重新核對並勾選；沒有自動提交。");
  }, [online]);
  useEffect(() => {
    if (Platform.OS !== "web" || !(original && selected?.state !== "ready" || draft.text || draft.rawValue || draft.unit || draft.timeRaw || unresolved)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [original, selected?.state, draft.text, draft.rawValue, draft.unit, draft.timeRaw, unresolved]);
  const model: PhotosViewModel = { childName: child.displayName, online, access, load, canCreate, capacityReached: condition === "capacity",
    items, selected, latest, original, source, sourceError, draft, formKey, reviewed, modelConsent, sharedConsent, operation, notice, reservationUnidentified,
    replacement, deletion, deleteScope, deleteFinal, busy, fresh, formLocked: hardLocked || access !== "editable", canPick, canUpload, canExtract, canConfirm, canDelete };
  return { model, actions, condition, changeCondition, outcome, setOutcome, faultPhase, setFaultPhase, lookup, setLookup };
}
