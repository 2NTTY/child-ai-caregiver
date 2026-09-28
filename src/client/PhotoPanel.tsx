import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Checkbox, HelperText, PaperProvider, RadioButton, Text, TextInput } from "react-native-paper";
import { CARE_KINDS, type CareKind, type CareValues } from "../shared/care.ts";
import { PHOTO_LIMITS, photoDraftSchema, photoMetadataSchema, type PhotoAttachment, type PhotoConfirmation, type PhotoDraft, type PhotoMetadata } from "../shared/photos.ts";
import { createPhotoApi, PhotoApiError, type PhotoWriteResult } from "./photo-api.ts";
import { ONLINE_REFRESH_EVENT } from "./use-online-updates.ts";

interface Props { apiBaseUrl: string; userId: string; childId: string; online: boolean; onSessionChanged: () => void }
interface Prepared { file: File; metadata: Omit<PhotoMetadata, "source">; base64: string }
type PendingInput = { kind: "reserve"; metadata: PhotoMetadata }
  | { kind: "confirm"; photo: PhotoAttachment; input: PhotoConfirmation }
  | { kind: "delete"; photo: PhotoAttachment };
type Pending = PendingInput & { confirmed: boolean; checked: boolean; result?: PhotoWriteResult };
interface Direct { kind: "upload" | "extract"; photo: PhotoAttachment; prepared?: Prepared; checked: boolean }
type Current = () => boolean;
const kindText: Record<CareKind, string> = {
  note: "備註", feeding: "餵食", sleep: "睡眠", diaper: "尿片", temperature: "體溫", measurement: "量度", appointment: "預約",
};
const extractionText: Record<PhotoAttachment["extraction"]["state"], string> = {
  not_requested: "未要求提取", running: "正在提取", available: "候選已備妥", failed: "提取失敗", unknown: "提取結果未知",
};
const emptyDraft = (): PhotoDraft => ({
  text: "", kind: "note", rawValue: null, unit: null, approximate: false, timeRaw: "", uncertainties: [],
});
const sameOriginal = (left: PhotoMetadata, right: Omit<PhotoMetadata, "source">) =>
  left.sha256 === right.sha256 && left.bytes === right.bytes && left.mimeType === right.mimeType;
const privateManaged = (photo: PhotoAttachment | null, userId: string): photo is PhotoAttachment =>
  !!photo && photo.canManage && photo.visibility === "private" && photo.ownerUserId === userId && photo.recordId === null;

function Confirmation({ label, checked, disabled, onToggle }: {
  label: string; checked: boolean; disabled: boolean; onToggle: () => void;
}) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={styles.confirmation}
    {...(Platform.OS === "web" ? {
      "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      },
    } : {})}>
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants"><Checkbox status={checked ? "checked" : "unchecked"} disabled={disabled} /></View>
    <Text style={styles.confirmationLabel}>{label}</Text>
  </Pressable>;
}

function readBase64(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const clean = () => signal.removeEventListener("abort", abort);
    const abort = () => { reader.abort(); clean(); reject(new Error("File reading cancelled")); };
    reader.onerror = () => { clean(); reject(new Error("File reading failed")); };
    reader.onload = () => {
      clean();
      const value = reader.result;
      const comma = typeof value === "string" ? value.indexOf(",") : -1;
      if (signal.aborted || typeof value !== "string" || comma < 0) reject(new Error("File reading failed"));
      else resolve(value.slice(comma + 1));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    reader.readAsDataURL(file);
  });
}

export function PhotoPanel(props: Props) {
  return <PaperProvider><PhotoWorkspace key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} /></PaperProvider>;
}

function PhotoWorkspace({ apiBaseUrl, userId, childId, online, onSessionChanged }: Props) {
  const api = useMemo(() => createPhotoApi(apiBaseUrl), [apiBaseUrl]);
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [readFailed, setReadFailed] = useState(true);
  const [selected, setSelected] = useState<PhotoAttachment | null>(null);
  const selectedRef = useRef<PhotoAttachment | null>(null);
  const [latest, setLatest] = useState<PhotoAttachment | null>(null);
  const [conflict, setConflict] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [source, setSource] = useState("使用者上傳照片");
  const [draft, setDraft] = useState<PhotoDraft>(emptyDraft);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [modelConsent, setModelConsent] = useState(false);
  const [sharedConsent, setSharedConsent] = useState(false);
  const [deleteScope, setDeleteScope] = useState(false);
  const [deleteFinal, setDeleteFinal] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [reservationUnidentified, setReservationUnidentified] = useState(false);
  const [direct, setDirect] = useState<Direct | null>(null);
  const directRef = useRef<Direct | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;
  const available = online && authorized && !!userId && !!childId && Platform.OS === "web";
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});

  const resetConsent = () => { setModelConsent(false); setSharedConsent(false); setDeleteScope(false); setDeleteFinal(false); };
  const selectBasis = (photo: PhotoAttachment | null) => { selectedRef.current = photo; setSelected(photo); };
  const trackPending = (entry: Pending | null) => { pendingRef.current = entry; setPending(entry ? { ...entry } : null); };
  const trackDirect = (entry: Direct | null) => { directRef.current = entry; setDirect(entry ? { ...entry } : null); };
  const replacePreview = (blob: Blob | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = blob ? URL.createObjectURL(blob) : null;
    previewRef.current = url; setPreview(url);
  };
  const putPhoto = (photo: PhotoAttachment) => setPhotos(items => [photo, ...items.filter(item => item.id !== photo.id)]);
  const clearEditor = () => {
    selectBasis(null); setLatest(null); setConflict(false); setFile(null); setPrepared(null); setReservationUnidentified(false);
    setFileInputKey(value => value + 1); setDraft(emptyDraft()); setSource("使用者上傳照片");
    trackDirect(null); replacePreview(null); resetConsent();
  };
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearAuthority = () => {
    cancelRequests(); api.resetOnline(); trackPending(null); clearEditor(); setPhotos([]); setCanCreate(false);
    setLoaded(false); setReadFailed(true); setAuthorized(false);
    setNotice("登入帳號或孩子權限已改變，相片、原檔、草稿及待核對操作已清除。請重新選擇孩子。");
    sessionChanged.current();
  };
  const applyRead = (photo: PhotoAttachment) => {
    putPhoto(photo);
    const basis = selectedRef.current;
    if (basis?.id !== photo.id) return;
    if (basis.version !== photo.version) {
      setLatest(photo); setConflict(true); resetConsent();
    } else selectBasis(photo);
  };
  const finishWrite = (entry: Pending, result: PhotoWriteResult) => {
    trackPending(null); resetConsent(); setReadFailed(false);
    if (result === null) {
      if (entry.kind !== "reserve") setPhotos(items => items.filter(item => item.id !== entry.photo.id));
      clearEditor();
      setNotice("原操作已確認，但附件結果已刪除或不再可披露；不會重送原操作。請重新讀取清單。");
      return;
    }
    if ("deleted" in result) {
      if (entry.kind !== "reserve") setPhotos(items => items.filter(item => item.id !== entry.photo.id));
      clearEditor();
      setNotice("附件及其已連結確認記錄已移除。原檔實體清理已排程，尚未宣稱清理完成。");
      return;
    }
    putPhoto(result.photo); selectBasis(result.photo); setLatest(null); setConflict(false); setSource(result.photo.source);
    if (entry.kind === "confirm") {
      trackDirect(null);
      setNotice("原照片及確認記錄已與家庭共享；這張照片不能再次確認。");
    } else setNotice("私人附件已建立。請繼續上傳同一原檔。");
  };

  const lookupDirect = async (signal: AbortSignal, current: Current) => {
    const entry = directRef.current;
    if (!entry) return;
    const next = await api.photo(childId, entry.photo.id, signal, userId);
    if (!sameOriginal(next, entry.photo)) throw new PhotoApiError();
    if (!current()) return;
    putPhoto(next); selectBasis(next); setLatest(null); setConflict(false); resetConsent(); setReadFailed(false);
    if (entry.kind === "upload") {
      if (next.state === "ready") {
        trackDirect(null); setNotice("同一原檔已在 Server 保存；毋須再次上傳。");
      } else {
        entry.photo = next; entry.checked = true; trackDirect(entry);
        setNotice("已查核附件仍待上傳。原檔及草稿保留，可明確重試同一附件及同一原檔。");
      }
    } else if (next.visibility === "shared" || next.extraction.state === "available" || next.extraction.state === "failed") {
      trackDirect(null); setNotice(next.visibility === "shared" ? "照片已確認共享，不會再次提取。"
        : next.extraction.state === "available" ? "已查回提取候選。採用前請核對下方候選及不確定事項。" : "已查回提取失敗狀態，可直接手動記錄。");
    } else {
      entry.photo = next; entry.checked = true; trackDirect(entry);
      setNotice("提取結果仍未確認，不會自動或手動重送這次提取；你仍可核對並手動確認記錄。");
    }
  };

  const run = async (label: string, operation: (signal: AbortSignal, current: Current) => Promise<void>, mode: "read" | "write" | "upload" | "extract" = "read") => {
    if (!availableRef.current || inFlight.current) return;
    inFlight.current = true;
    const started = generation.current, controller = new AbortController(); controllers.current.add(controller);
    const current = () => availableRef.current && !controller.signal.aborted && generation.current === started;
    setBusy(label); setNotice("");
    try { await operation(controller.signal, current); }
    catch (error) {
      const entry = pendingRef.current;
      if (entry && error instanceof PhotoApiError && error.confirmed) { entry.confirmed = true; entry.checked = false; }
      if (!current()) return;
      const status = error instanceof PhotoApiError ? error.status : 0;
      const code = error instanceof PhotoApiError ? error.onlineCode : null;
      if ([401, 403, 404].includes(status) || code === "session_changed") { clearAuthority(); return; }
      resetConsent(); setReadFailed(true);
      if (status === 409 && code === "version_conflict") {
        if (!entry?.confirmed && !api.hasPendingOnline()) trackPending(null);
        trackDirect(null); setConflict(true); setLatest(null);
        setNotice("版本已改變，原檔及草稿保留。請重新讀取，再明確載入目前版本；不會自動改用新版本提交。");
      } else if (code === "photo_capacity" || status === 413) {
        if (mode !== "read") trackPending(null);
        trackDirect(null);
        setNotice("照片或儲存容量超出限制，未接受這次提交。原檔及草稿保留；請清理附件或核對容量後再試。");
      } else if ((mode === "upload" || mode === "extract") && directRef.current) {
        try { await lookupDirect(controller.signal, current); }
        catch (lookupError) {
          if (!current()) return;
          if (lookupError instanceof PhotoApiError && ([401, 403, 404].includes(lookupError.status) || lookupError.onlineCode === "session_changed")) {
            clearAuthority(); return;
          }
          const attempt = directRef.current;
          if (attempt) { attempt.checked = false; trackDirect(attempt); }
          setNotice("提交結果未能確認，也未能查回附件。原檔及草稿保留；請先查核，不會自動重送。");
        }
      } else if (entry && (entry.confirmed || api.hasPendingOnline())) {
        entry.checked = false; trackPending(entry);
        setNotice(entry.confirmed ? "原操作已確認，結果尚待讀取；不會再次提交。請查收據及重新讀取。"
          : "提交結果未知，原內容及操作識別已保留。請先查收據，再明確選擇是否重試原操作。");
      } else {
        if (mode !== "read") trackPending(null);
        setNotice(mode === "read" ? "讀取失敗，原檔及草稿保留。請手動重新讀取。"
          : status === 413 ? "照片或容量超出限制，原檔及草稿保留。"
            : "提交未被確認，原檔及草稿保留。請重新讀取並核對內容。");
      }
    } finally {
      controllers.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  };

  const refresh = () => { void run("查核及重新讀取", async (signal, current) => {
    const entry = pendingRef.current;
    if (entry && !entry.confirmed) {
      entry.checked = false; trackPending(entry);
      const receipt = await api.reconcilePending(signal, userId);
      if (receipt?.state === "confirmed") { entry.confirmed = true; entry.result = receipt.result; }
      else if (receipt?.state === "unconfirmed") entry.checked = true;
      if (!current()) return;
      if (entry.confirmed && entry.result !== undefined) finishWrite(entry, entry.result);
      else if (!api.hasPendingOnline() && !entry.confirmed) trackPending(null);
      else trackPending(entry);
    } else if (entry?.confirmed && entry.result !== undefined) {
      if (!current()) return;
      finishWrite(entry, entry.result);
    }
    if (directRef.current) await lookupDirect(signal, current);
    const page = await api.photos(childId, signal, userId);
    if (!current()) return;
    setPhotos(page.photos); setCanCreate(page.canCreate); setLoaded(true); setReadFailed(false);
    const unresolved = pendingRef.current;
    if (unresolved?.confirmed && unresolved.result === undefined && unresolved.kind === "reserve") {
      setReservationUnidentified(true);
      setNotice("Server 已確認原操作，但未能識別其附件結果。原檔及草稿保留，不會再次提交；可明確結束待查，再逐項開啟清單核對。");
    }
    const basis = selectedRef.current;
    if (basis) {
      const next = await api.photo(childId, basis.id, signal, userId);
      if (!current()) return;
      if (unresolved?.confirmed && unresolved.kind === "confirm" && next.visibility === "shared" && next.recordId) {
        finishWrite(unresolved, { photo: next, recordId: next.recordId });
      } else applyRead(next);
    }
    if (pendingRef.current?.checked) setNotice("原操作尚無確認收據。重試會使用原內容及原操作識別；不會自動重送。");
  }); };
  refreshRef.current = refresh;

  useEffect(() => () => {
    generation.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); pendingRef.current = null; directRef.current = null; api.resetOnline();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }, [api]);
  useEffect(() => {
    cancelRequests(); setReadFailed(true); resetConsent();
    if (pendingRef.current) { pendingRef.current.checked = false; trackPending(pendingRef.current); }
    if (directRef.current) { directRef.current.checked = false; trackDirect(directRef.current); }
    if (available) refreshRef.current();
  }, [available, cancelRequests]);
  useEffect(() => {
    if (typeof window === "undefined" || !available) return;
    const update = () => refreshRef.current();
    window.addEventListener(ONLINE_REFRESH_EVENT, update);
    return () => window.removeEventListener(ONLINE_REFRESH_EVENT, update);
  }, [available]);

  const prepareFile = async (next: File) => {
    const basis = selectedRef.current;
    const reserved = basis?.state === "reserved" ? basis : null;
    if (!authorized || (!canCreate && !privateManaged(reserved, userId)) || inFlight.current || pendingRef.current
      || directRef.current || conflict || reservationUnidentified) return;
    if (reserved && !privateManaged(reserved, userId)) return;
    if (!["image/jpeg", "image/png"].includes(next.type) || next.size < 1 || next.size > PHOTO_LIMITS.bytes || next.name.length > 200) {
      setNotice("只接受 JPEG／PNG 原照片，每張最多 4 MiB；檔名最多 200 字。現有輸入保留。"); return;
    }
    inFlight.current = true;
    const started = generation.current, controller = new AbortController(); controllers.current.add(controller);
    const current = () => generation.current === started && !controller.signal.aborted;
    if (!reserved) {
      if (next !== file) clearEditor();
      setPrepared(null); setFile(next); replacePreview(next);
    }
    setBusy("讀取原檔"); setNotice("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", await next.arrayBuffer());
      if (!current()) return;
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const metadata = { fileName: next.name, mimeType: next.type as PhotoMetadata["mimeType"], bytes: next.size, sha256 };
      if (reserved && !sameOriginal(reserved, metadata)) {
        setFileInputKey(value => value + 1);
        setNotice("所選原檔與此待上傳附件的類型、大小或 SHA-256 不符，附件識別、來源及草稿保留。請選回同一原檔；要使用另一張照片，請先明確清除本頁或另選附件。");
        return;
      }
      const base64 = await readBase64(next, controller.signal);
      if (!current()) return;
      if (reserved) { setFile(next); replacePreview(next); }
      setPrepared({ file: next, base64, metadata });
      if (reserved) setNotice("已核對相同原檔，沿用已選附件及原來源，可明確繼續上傳。");
    } catch {
      if (current()) setNotice("未能讀取原檔或計算完整性資料。現有原檔及草稿保留，可明確重新選擇原檔。");
    } finally {
      controllers.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  };

  const sendWrite = async (entry: Pending, signal: AbortSignal, current: Current) => {
    entry.checked = false; trackPending(entry);
    const result = entry.kind === "reserve" ? await api.reserve(childId, entry.metadata, signal, userId)
      : entry.kind === "confirm" ? await api.confirm(entry.photo, entry.input, signal, userId)
        : await api.delete(entry.photo, signal, userId);
    entry.confirmed = true; entry.result = result;
    if (current()) finishWrite(entry, result);
    return result;
  };
  const sendContent = async (photo: PhotoAttachment, original: Prepared, signal: AbortSignal, current: Current) => {
    if (!sameOriginal(photo, original.metadata)) throw new PhotoApiError(400, "invalid_input");
    const attempt: Direct = { kind: "upload", photo, prepared: original, checked: false }; trackDirect(attempt);
    const next = await api.upload(photo, original.base64, signal, userId);
    if (!current()) return;
    putPhoto(next); selectBasis(next); trackDirect(null); resetConsent(); setReadFailed(false);
    setNotice("原照片已私人保存。可直接手動記錄，或另行同意 Gemini 提取；尚未與家庭共享。");
  };
  const upload = () => {
    if (!prepared || (!selected && !canCreate) || readFailed || pending || conflict || reservationUnidentified || !source.trim()) return;
    if (selected) {
      if (!privateManaged(selected, userId) || selected.state !== "reserved" || !sameOriginal(selected, prepared.metadata)
        || (direct && (!direct.checked || direct.kind !== "upload"))) return;
      void run("上傳原檔", async (signal, current) => {
        const next = await api.photo(childId, selected.id, signal, userId);
        if (!sameOriginal(next, prepared.metadata)) throw new PhotoApiError();
        if (!current()) return;
        if (next.state === "ready") {
          putPhoto(next); selectBasis(next); trackDirect(null); setNotice("同一原檔已保存，毋須再次上傳。"); return;
        }
        await sendContent(next, prepared, signal, current);
      }, "upload");
      return;
    }
    const input = photoMetadataSchema.safeParse({ ...prepared.metadata, source });
    if (!input.success) { setNotice("請核對照片來源及檔名，來源最多 200 字。"); return; }
    const entry: Pending = { kind: "reserve", metadata: Object.freeze({ ...input.data }), confirmed: false, checked: false };
    void run("上傳原檔", async (signal, current) => {
      const result = await sendWrite(entry, signal, current);
      if (!current() || result === null || !("photo" in result)) return;
      await sendContent(result.photo, prepared, signal, current);
    }, "upload");
  };
  const extract = () => {
    if (!selected || !privateManaged(selected, userId) || selected.state !== "ready" || !modelConsent || pending || direct
      || conflict || readFailed || !["not_requested", "failed"].includes(selected.extraction.state)) return;
    const attempt: Direct = { kind: "extract", photo: selected, checked: false };
    trackDirect(attempt);
    void run("提取", async (signal, current) => {
      const next = await api.extract(attempt.photo, signal, userId);
      if (!current()) return;
      putPhoto(next); selectBasis(next); trackDirect(null); resetConsent(); setReadFailed(false);
      setNotice(next.extraction.state === "available" ? "提取候選已備妥。請核對原文、數字、單位、時間及不確定事項，再決定是否採用。"
        : "請查閱提取狀態；候選尚未成為家庭記錄。你仍可手動記錄。");
    }, "extract");
  };
  const draftValid = photoDraftSchema.safeParse(draft).success && !!draft.text.trim()
    && ((draft.rawValue === null && draft.unit === null) || (!!draft.rawValue?.trim() && !!draft.unit?.trim()));
  const confirm = () => {
    if (!selected || !privateManaged(selected, userId) || selected.state !== "ready" || !sharedConsent || !draftValid
      || pending || conflict || readFailed || direct?.kind === "upload") return;
    const values: CareValues = {
      text: draft.text, source: selected.source,
      details: { kind: draft.kind, quantity: draft.rawValue !== null && draft.unit !== null
        ? { rawValue: draft.rawValue, unit: draft.unit, precision: draft.approximate ? "approximate" : "exact" } : null,
        eventTime: { rawText: draft.timeRaw, at: null, timeZone: "Asia/Hong_Kong",
          precision: draft.approximate && draft.timeRaw.length > 0 ? "approximate" : "unknown" } },
    };
    const entry: Pending = { kind: "confirm", photo: selected,
      input: JSON.parse(JSON.stringify({ expectedVersion: selected.version, confirmShared: true, values })) as PhotoConfirmation,
      confirmed: false, checked: false };
    void run("確認共享", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const remove = () => {
    if (!selected?.canManage || !deleteScope || !deleteFinal || pending || direct?.kind === "upload" || conflict || readFailed) return;
    const entry: Pending = { kind: "delete", photo: selected, confirmed: false, checked: false };
    void run("刪除", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const retry = () => {
    const entry = pendingRef.current;
    if (!entry?.checked || entry.confirmed || !api.hasPendingOnline() || readFailed || conflict) return;
    void run("重試原操作", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const openPhoto = (item: PhotoAttachment) => {
    if (pending || direct || inFlight.current) return;
    void run("讀取照片", async (signal, current) => {
      const next = await api.photo(childId, item.id, signal, userId);
      const blob = next.state === "ready" ? await api.content(next, signal, userId) : null;
      if (!current()) return;
      const keepLocal = prepared && sameOriginal(next, prepared.metadata);
      if (!keepLocal) clearEditor();
      setReservationUnidentified(false);
      selectBasis(next); setLatest(null); setConflict(false); setSource(next.source); resetConsent(); setReadFailed(false);
      if (blob) replacePreview(blob);
      else if (!keepLocal) replacePreview(null);
      setNotice(next.state === "reserved" ? "原檔尚未保存。只可使用相同完整性資料的原檔繼續上傳。" : "");
    });
  };

  if (Platform.OS !== "web") return <Text>照片輸入目前只在 Web 提供。</Text>;
  if (!authorized) return <Text accessibilityRole="alert">{notice}</Text>;
  const fresh = available && loaded && !readFailed && !busy && !pending && !conflict;
  const localEditable = !busy && !pending && (selected ? privateManaged(selected, userId) : canCreate);
  const editDraft = (next: PhotoDraft) => { setDraft(next); setSharedConsent(false); };
  const canUpload = fresh && !reservationUnidentified && !!prepared && ((!selected && canCreate) || (privateManaged(selected, userId) && selected.state === "reserved"
    && sameOriginal(selected, prepared.metadata))) && (!direct || (direct.kind === "upload" && direct.checked));
  const manageable = privateManaged(selected, userId);
  return <View style={styles.panel}>
    <Text variant="titleLarge" accessibilityRole="header">照片及確認記錄</Text>
    <Text>只接受 JPEG／PNG 原檔，每張最多 4 MiB、每個孩子最多 100 張及 100 MiB。先私人保存，另行確認後才與家庭共享。</Text>
    {!online && <Text>目前未連線，已選原檔及草稿保留；重連後先核對最新狀態。</Text>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {!!busy && <Text>{busy}中…</Text>}
    <Button mode="outlined" onPress={refresh} disabled={!available || !!busy}>查收據及重新讀取</Button>
    {pending && <View style={styles.box}>
      <Text>原操作{pending.confirmed ? "已確認，結果待讀取" : "結果未知"}，提交內容已鎖定。</Text>
      <Button mode="outlined" onPress={retry} disabled={!available || !!busy || readFailed || !pending.checked || pending.confirmed || !api.hasPendingOnline()}>
        明確重試原內容及原操作識別
      </Button>
      {pending.kind === "reserve" && pending.confirmed && pending.result === undefined && <Button mode="outlined"
        disabled={!available || !!busy || readFailed || api.hasPendingOnline()} onPress={() => {
          trackPending(null); setReservationUnidentified(true); resetConsent();
          setNotice("已明確結束待查。原檔及草稿保留，原操作不再提交；請逐項開啟附件清單核對，或明確清除本頁後另行選擇照片。");
        }}>明確結束待查，保留輸入並逐項選擇清單</Button>}
    </View>}
    {reservationUnidentified && !pending && <Text>已確認的原操作結果未能識別。請逐項開啟清單核對；目前保留的原檔不會重新建立附件。</Text>}
    {direct && <Text>{direct.kind === "upload" ? "原檔上傳待核對；只可明確重試同一附件及同一原檔。" : "提取待核對，這次提取不會重送；可直接手動確認記錄。"}</Text>}
    {conflict && <View style={styles.box}>
      <Text>本頁草稿使用版本 {selected?.version ?? "未確定"}；{latest ? "目前版本 " + latest.version : "請先讀取目前版本"}。</Text>
      {latest && <Text>目前狀態：{latest.visibility === "shared" ? "家庭共享" : "私人"}；{extractionText[latest.extraction.state]}。</Text>}
      <Button mode="outlined" disabled={!available || !!busy || !latest || !!pending} onPress={() => {
        if (!latest) return;
        selectBasis(latest); setSource(latest.source); setLatest(null); setConflict(false); resetConsent();
        setNotice("已明確載入目前版本，手動草稿保留。請重新核對內容及共享範圍。");
      }}>明確載入目前版本並保留草稿</Button>
    </View>}
    {(canCreate || (manageable && selected?.state === "reserved")) && <View style={styles.box}>
      <Text variant="titleMedium">選擇原照片</Text>
      <Text>{selected?.state === "reserved" ? "請重選同一原檔接續此附件，原附件識別、來源及草稿會保留。" : "更換照片會清除本頁草稿。照片提取失敗時可直接在下方手動輸入。"}</Text>
      {createElement("input", {
        key: fileInputKey, type: "file", accept: "image/jpeg,image/png", "aria-label": "選擇 JPEG 或 PNG 原照片",
        disabled: !!busy || !!pending || !!direct || conflict || reservationUnidentified || !available,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const next = event.currentTarget.files?.[0]; if (next) void prepareFile(next);
        },
      })}
      {file && <Text>已選：{file.name}；{file.size} bytes</Text>}
      {file && !prepared && <Button disabled={!!busy || !!pending || !!direct || conflict} onPress={() => { void prepareFile(file); }}>明確重新讀取已選原檔</Button>}
      {!selected && <TextInput mode="outlined" label="照片來源（保存原文字）" value={source} maxLength={200} editable={localEditable}
        onChangeText={value => { setSource(value); setSharedConsent(false); }} />}
      <Button mode="contained" onPress={upload} disabled={!canUpload || !source.trim()}>
        {selected ? "明確繼續／重試上傳同一原檔" : "上傳私人原照片"}
      </Button>
    </View>}
    {preview && <View style={styles.box}>
      <Text>{selected?.state === "ready" ? "原照片預覽" : "本機原檔預覽（尚未保存）"}</Text>
      <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" accessibilityLabel="所選原照片" />
    </View>}
    {selected && <View style={styles.box}>
      <Text variant="titleMedium">{selected.fileName}</Text>
      <Text>{selected.visibility === "shared" ? "家庭共享" : "私人，只有上傳者可讀取"}；版本 {selected.version}；{selected.state === "ready" ? "原檔已保存" : "原檔待上傳"}</Text>
      <Text>來源：{selected.source}；上傳者：{selected.ownerUserId}</Text>
      <Text>附件：{selected.id}；SHA-256：{selected.sha256}</Text>
      {selected.recordId && <Text>已連結確認記錄：{selected.recordId}；不能再次提取或確認。</Text>}
      <Text>提取：{extractionText[selected.extraction.state]}</Text>
      {manageable && selected.state === "ready" && <>
        <Confirmation label="我同意把這張原照片交由 Gemini 提取內容；提取候選仍需由我核對" checked={modelConsent}
          disabled={!fresh || !!direct || !["not_requested", "failed"].includes(selected.extraction.state)}
          onToggle={() => setModelConsent(value => !value)} />
        <Button mode="outlined" onPress={extract} disabled={!fresh || !modelConsent || !!direct || !["not_requested", "failed"].includes(selected.extraction.state)}>
          {selected.extraction.state === "failed" ? "同意並重新提取照片內容" : "同意並提取照片內容"}
        </Button>
      </>}
      {manageable && selected.extraction.draft && <View style={styles.box}>
        <Text variant="titleSmall">未確認的提取候選</Text>
        <Text>{selected.extraction.draft.text || "未提取到文字"}</Text>
        <Text>種類：{kindText[selected.extraction.draft.kind]}；數值：{selected.extraction.draft.rawValue ?? "未有"}；單位：{selected.extraction.draft.unit ?? "未有"}</Text>
        <Text>時間原文：{selected.extraction.draft.timeRaw || "未有"}；{selected.extraction.draft.approximate ? "約數" : "未標記約數"}</Text>
        {selected.extraction.draft.uncertainties.map((item, index) => <Text key={index}>待核對：{item}</Text>)}
        <Button mode="outlined" disabled={!localEditable} onPress={() => {
          if (selected.extraction.draft) editDraft({ ...selected.extraction.draft, uncertainties: [...selected.extraction.draft.uncertainties] });
        }}>採用此候選並取代本頁草稿</Button>
      </View>}
    </View>}
    {(file || manageable) && <View style={styles.box}>
      <Text variant="titleMedium">手動核對及確認</Text>
      <Text>可不使用模型，直接輸入文字。數字、單位及時間保留原文字，不會猜測確實時間。</Text>
      <TextInput mode="outlined" label="確認文字" value={draft.text} multiline maxLength={5000} editable={localEditable}
        onChangeText={value => editDraft({ ...draft, text: value })} />
      <RadioButton.Group value={draft.kind} onValueChange={value => {
        if (CARE_KINDS.includes(value as CareKind)) editDraft({ ...draft, kind: value as CareKind });
      }}>
        {CARE_KINDS.map(kind => <RadioButton.Item key={kind} label={kindText[kind]} value={kind} disabled={!localEditable} />)}
      </RadioButton.Group>
      <TextInput mode="outlined" label="數值原文（可留空）" value={draft.rawValue ?? ""} maxLength={100} editable={localEditable}
        onChangeText={value => editDraft({ ...draft, rawValue: value === "" ? null : value })} />
      <TextInput mode="outlined" label="單位原文（有數值時必填）" value={draft.unit ?? ""} maxLength={50} editable={localEditable}
        onChangeText={value => editDraft({ ...draft, unit: value === "" ? null : value })} />
      <TextInput mode="outlined" label="時間原文（可留空）" value={draft.timeRaw} maxLength={300} editable={localEditable}
        onChangeText={value => editDraft({ ...draft, timeRaw: value })} />
      <Confirmation label="以上數值／時間屬約數" checked={draft.approximate} disabled={!localEditable}
        onToggle={() => editDraft({ ...draft, approximate: !draft.approximate })} />
      {draft.uncertainties.map((item, index) => <Text key={index}>提取待核對事項：{item}</Text>)}
      {!draftValid && <HelperText type="info">請填寫確認文字；數值與單位必須一併填寫，或一併留空。</HelperText>}
      <Confirmation label="我已核對以上內容，確認把原照片及這筆確認記錄一同與家庭共享" checked={sharedConsent}
        disabled={!fresh || !manageable || selected?.state !== "ready" || !draftValid || direct?.kind === "upload"}
        onToggle={() => setSharedConsent(value => !value)} />
      <Button mode="contained" onPress={confirm} disabled={!fresh || !manageable || selected?.state !== "ready" || !draftValid || !sharedConsent || direct?.kind === "upload"}>
        確認照片及記錄與家庭共享
      </Button>
    </View>}
    {selected?.canManage && <View style={styles.box}>
      <Text variant="titleMedium">刪除附件及連結記錄</Text>
      <Text>刪除 {selected.fileName}，並移除其已連結確認記錄。原檔實體清理由 Server 排程處理。</Text>
      <Confirmation label="我明白會刪除此附件及其已連結確認記錄，家庭成員將無法再讀取" checked={deleteScope}
        disabled={!fresh || direct?.kind === "upload"} onToggle={() => { setDeleteScope(value => !value); setDeleteFinal(false); }} />
      <Confirmation label="我再次確認刪除以上附件及其已連結記錄" checked={deleteFinal}
        disabled={!fresh || !deleteScope || direct?.kind === "upload"} onToggle={() => setDeleteFinal(value => !value)} />
      <Button mode="outlined" onPress={remove} disabled={!fresh || !deleteScope || !deleteFinal || direct?.kind === "upload"}>確認刪除附件及連結記錄</Button>
    </View>}
    {(file || selected) && <Button disabled={!!busy || !!pending || !!direct} onPress={() => { clearEditor(); setNotice(""); }}>明確清除本頁原檔及草稿</Button>}
    <Text variant="titleMedium">可讀取的附件</Text>
    {!loaded && <Text>尚未成功讀取附件清單。</Text>}
    {loaded && photos.length === 0 && <Text>目前沒有可讀取附件。</Text>}
    {loaded && !canCreate && <Text>目前沒有新增附件權限；管理動作按每張附件的 Server 權限顯示。</Text>}
    {photos.map(photo => <View key={photo.id} style={styles.box}>
      <Text>{photo.fileName}；{photo.visibility === "shared" ? "家庭共享" : "私人"}；{photo.state === "ready" ? "原檔已保存" : "原檔待上傳"}</Text>
      <Text>來源：{photo.source}；保存時間：{photo.createdAt}；{extractionText[photo.extraction.state]}</Text>
      <Button mode="outlined" disabled={!available || !!busy || !!pending || !!direct} onPress={() => openPhoto(photo)}>開啟原檔及附件（取代本頁草稿）</Button>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  box: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  preview: { width: "100%", height: 260 },
  confirmation: { flexDirection: "row", alignItems: "center", gap: 4 },
  confirmationLabel: { flex: 1 },
});
