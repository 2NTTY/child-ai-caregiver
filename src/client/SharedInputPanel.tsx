import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Checkbox, HelperText, PaperProvider, RadioButton, Text, TextInput } from "react-native-paper";
import { CARE_KINDS, emptyCareDetails, type CareKind, type CareValues } from "../shared/care.ts";
import { photoDraftSchema, type PhotoDraft } from "../shared/photos.ts";
import {
  sharedInputCreateSchema, type PublicInputSource, type SharedInput, type SharedInputConfirmation, type SharedInputCreate,
} from "../shared/shared-inputs.ts";
import { createSharedInputApi, SharedInputApiError, type SharedInputWriteResult } from "./shared-input-api.ts";
import { ONLINE_REFRESH_EVENT } from "./use-online-updates.ts";

interface Props { apiBaseUrl: string; userId: string; childId: string; online: boolean; onSessionChanged: () => void }
type PendingInput = { kind: "create"; input: SharedInputCreate }
  | { kind: "confirm"; basis: SharedInput; input: SharedInputConfirmation }
  | { kind: "delete"; basis: SharedInput };
type Pending = PendingInput & { confirmed: boolean; checked: boolean; result?: SharedInputWriteResult };
interface Direct { kind: "fetch" | "extract"; basis: SharedInput; excerpt: string; checked: boolean }
type Current = () => boolean;
const kindText: Record<CareKind, string> = {
  note: "備註", feeding: "餵食", sleep: "睡眠", diaper: "尿片", temperature: "體溫", measurement: "量度", appointment: "預約",
};
const extractionText: Record<SharedInput["extraction"]["state"], string> = {
  not_requested: "未要求提取", running: "正在提取", available: "候選已備妥", failed: "提取失敗", unknown: "提取結果未知",
};
const fetchText: Record<SharedInput["fetchState"], string> = {
  not_requested: "未要求取得", running: "正在取得", ready: "原文已保存", failed: "取得失敗", unknown: "取得結果未知",
};
const emptyDraft = (): PhotoDraft => ({
  text: "", kind: "note", rawValue: null, unit: null, approximate: false, timeRaw: "", uncertainties: [],
});
const initialExcerpt = (input: SharedInput) => input.text.length <= 10000 ? input.text : "";

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

export function SharedInputPanel(props: Props) {
  return <PaperProvider><SharedInputWorkspace key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} /></PaperProvider>;
}

function SharedInputWorkspace({ apiBaseUrl, userId, childId, online, onSessionChanged }: Props) {
  const api = useMemo(() => createSharedInputApi(apiBaseUrl), [apiBaseUrl]);
  const [inputs, setInputs] = useState<SharedInput[]>([]);
  const [sources, setSources] = useState<PublicInputSource[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [readFailed, setReadFailed] = useState(true);
  const [selected, setSelected] = useState<SharedInput | null>(null);
  const selectedRef = useRef<SharedInput | null>(null);
  const [latest, setLatest] = useState<SharedInput | null>(null);
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const [createKind, setCreateKind] = useState<"paste" | "public_source">("paste");
  const [pasteText, setPasteText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("使用者主動貼上");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDateText, setSourceDateText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [draft, setDraft] = useState<PhotoDraft>(emptyDraft);
  const [confirmationKind, setConfirmationKind] = useState<"reference" | "family_record">("reference");
  const [childFactConsent, setChildFactConsent] = useState(false);
  const [fetchConsent, setFetchConsent] = useState(false);
  const [modelConsent, setModelConsent] = useState(false);
  const [sharedConsent, setSharedConsent] = useState(false);
  const [deleteScope, setDeleteScope] = useState(false);
  const [deleteFinal, setDeleteFinal] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [direct, setDirect] = useState<Direct | null>(null);
  const directRef = useRef<Direct | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0), controllers = useRef(new Set<AbortController>()), inFlight = useRef(false);
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;
  const available = online && authorized && !!userId && !!childId && Platform.OS === "web";
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});

  const resetConsent = () => {
    setFetchConsent(false); setModelConsent(false); setSharedConsent(false); setChildFactConsent(false);
    setDeleteScope(false); setDeleteFinal(false);
  };
  const selectBasis = (input: SharedInput | null) => { selectedRef.current = input; setSelected(input); };
  const trackConflict = (value: boolean) => { conflictRef.current = value; setConflict(value); };
  const trackPending = (entry: Pending | null) => { pendingRef.current = entry; setPending(entry ? { ...entry } : null); };
  const trackDirect = (entry: Direct | null) => { directRef.current = entry; setDirect(entry ? { ...entry } : null); };
  const putInput = (input: SharedInput) => setInputs(items => [input, ...items.filter(item => item.id !== input.id)]);
  const resetComposer = () => {
    setCreateKind("paste"); setPasteText(""); setSourceLabel("使用者主動貼上"); setSourceUrl(""); setSourceDateText(""); setSourceId("");
  };
  const clearEditor = () => {
    selectBasis(null); setLatest(null); trackConflict(false); setExcerpt(""); setDraft(emptyDraft());
    setConfirmationKind("reference"); trackDirect(null); resetConsent();
  };
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearAuthority = () => {
    cancelRequests(); api.resetOnline(); trackPending(null); clearEditor(); resetComposer();
    setInputs([]); setSources([]); setCanCreate(false); setLoaded(false); setReadFailed(true); setAuthorized(false);
    setNotice("登入帳號或孩子權限已改變，私人原文、草稿及待核對操作已清除。請重新選擇孩子。");
    sessionChanged.current();
  };
  const applyRead = (input: SharedInput) => {
    putInput(input);
    const basis = selectedRef.current;
    if (basis?.id !== input.id) return;
    if (basis.version !== input.version || conflictRef.current) {
      selectBasis({ ...basis, canManage: input.canManage }); setLatest(input); trackConflict(true); resetConsent();
    } else {
      selectBasis(input);
      if (!input.canManage) resetConsent();
    }
  };
  const finishWrite = (entry: Pending, result: SharedInputWriteResult) => {
    trackPending(null); resetConsent(); setReadFailed(false);
    if (result === null || "deleted" in result) {
      if (entry.kind !== "create") setInputs(items => items.filter(item => item.id !== entry.basis.id));
      clearEditor(); resetComposer();
      setNotice(result === null ? "原操作已由原收據確認，但結果已刪除或不再可披露；不會重送。請重新讀取清單。"
        : "私人輸入及其已連結的家庭確認記錄已刪除。");
      return;
    }
    putInput(result.input); selectBasis(result.input); setLatest(null); trackConflict(false); trackDirect(null);
    if (entry.kind === "create") {
      resetComposer(); setDraft(emptyDraft()); setConfirmationKind("reference"); setExcerpt(initialExcerpt(result.input));
      setNotice(result.input.kind === "public_source" ? "已建立私人來源輸入。請明確同意取得所選公開來源原文。"
        : "原文及來源已私人保存；可手動輸入參考記錄，或另行同意 AI 提取。");
    } else setNotice("家庭確認記錄已建立；原始輸入仍只有上傳者可讀取。這項輸入不能再次確認。");
  };
  const finishDirect = (entry: Direct, input: SharedInput) => {
    putInput(input); selectBasis(input); setLatest(null); trackConflict(false); resetConsent(); setReadFailed(false);
    if (entry.kind === "fetch" && input.text && !entry.basis.text) setExcerpt(initialExcerpt(input));
    const state = entry.kind === "fetch" ? input.fetchState : input.extraction.state;
    if (!input.canManage || input.recordId !== null || state === "ready" || state === "available" || state === "failed") trackDirect(null);
    else { entry.checked = true; trackDirect(entry); }
    setNotice(!input.canManage ? "已讀取目前狀態，管理權限已變更。手動草稿保留，不能再提交管理操作。"
      : entry.kind === "fetch" ? state === "ready" ? "公開來源原文已私人保存。請核對來源、時間及原文。"
        : state === "failed" ? "取得來源失敗；未自動重試。你可另行明確同意重試此指定來源。"
          : "原次取得仍未確認。可查核狀態，或明確重播原版本的請求；不會另建輸入。"
        : state === "available" ? "候選已備妥。採用前請核對原文、數字、時間及不確定事項。"
          : state === "failed" ? "提取失敗，原文及手動草稿保留；仍可直接手動確認。"
            : "原次提取仍未確認。不會自動重送；可查核或明確重播原版本的請求，也可核對後手動記錄。");
  };
  const run = async (label: string, operation: (signal: AbortSignal, current: Current) => Promise<void>, mode: "read" | "write" | "direct" = "read") => {
    if (!availableRef.current || inFlight.current) return;
    inFlight.current = true;
    const started = generation.current, controller = new AbortController(); controllers.current.add(controller);
    const current = () => availableRef.current && !controller.signal.aborted && generation.current === started;
    setBusy(label); setNotice("");
    try { await operation(controller.signal, current); }
    catch (error) {
      const entry = pendingRef.current;
      if (entry && error instanceof SharedInputApiError && error.confirmed) { entry.confirmed = true; entry.checked = false; }
      if (!current()) return;
      const status = error instanceof SharedInputApiError ? error.status : 0;
      const code = error instanceof SharedInputApiError ? error.onlineCode : null;
      if ([401, 403, 404].includes(status) || code === "session_changed") { clearAuthority(); return; }
      resetConsent(); setReadFailed(true);
      if (code === "version_conflict") {
        if (!entry?.confirmed && !api.hasPendingOnline()) trackPending(null);
        trackDirect(null); trackConflict(true); setLatest(null);
        setNotice("版本已改變，原文及手動草稿保留。請重新讀取並明確載入目前版本，再核對後提交。");
      } else if (code === "inputs_capacity" || status === 413) {
        if (!api.hasPendingOnline() && !entry?.confirmed) trackPending(null);
        if (mode === "direct") trackDirect(null);
        setNotice("輸入或儲存容量超出限制，現有輸入及手動草稿保留。請核對容量後再試。");
      } else if (mode === "direct" && directRef.current) {
        if (status === 400 && code === "invalid_input") trackDirect(null);
        else { directRef.current.checked = false; trackDirect(directRef.current); }
        setNotice(code === "input_processing" ? "Server 正在處理此輸入。請先查核狀態，原文及草稿保留。"
          : "原次取得／提取結果未能確認，原版本與內容已保留。請先查核；不會自動重送。");
      } else if (entry && (entry.confirmed || api.hasPendingOnline())) {
        entry.checked = false; trackPending(entry);
        setNotice(entry.confirmed ? "原收據已確認操作，結果尚未能讀取；不會再次提交。請重新讀取。"
          : "提交結果未知，原內容及操作識別已鎖定。請先查原收據，再明確選擇是否重試原操作。");
      } else {
        if (mode !== "read") trackPending(null);
        setNotice(code === "input_processing" ? "輸入正在處理，未接受此操作。草稿保留，請重新讀取目前狀態。"
          : mode === "read" ? "讀取失敗，原文及草稿保留。請手動重新讀取。"
            : "提交未被確認，現有輸入及草稿保留。請重新讀取並核對內容。");
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
      if (!current()) return;
      if (receipt?.state === "confirmed") { entry.confirmed = true; entry.result = receipt.result; finishWrite(entry, receipt.result); }
      else if (receipt?.state === "unconfirmed") { entry.checked = true; trackPending(entry); }
      else if (!api.hasPendingOnline()) trackPending(null);
    } else if (entry?.confirmed && entry.result !== undefined) finishWrite(entry, entry.result);
    const attempt = directRef.current;
    if (attempt) {
      const next = await api.input(childId, attempt.basis.id, signal, userId);
      if (!current()) return;
      finishDirect(attempt, next);
    }
    const page = await api.inputs(childId, signal, userId);
    if (!current()) return;
    setInputs(page.inputs); setSources(page.sources); setCanCreate(page.canCreate); setLoaded(true); setReadFailed(false);
    const basis = selectedRef.current;
    if (basis) {
      const next = await api.input(childId, basis.id, signal, userId);
      if (!current()) return;
      applyRead(next);
    }
    if (pendingRef.current?.checked) setNotice("原操作尚無確認收據。明確重試會沿用原內容及原操作識別。");
    if (pendingRef.current?.confirmed && pendingRef.current.result === undefined) {
      setNotice("原收據已確認操作，但結果未能核對。不會按原文或 hash 猜測清單中的輸入，也不會重新建立同一輸入。");
    }
  }); };
  refreshRef.current = refresh;

  useEffect(() => () => {
    generation.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); pendingRef.current = null; directRef.current = null; api.resetOnline();
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

  const sendWrite = async (entry: Pending, signal: AbortSignal, current: Current) => {
    trackPending(entry);
    const result = entry.kind === "create" ? await api.create(childId, entry.input, signal, userId)
      : entry.kind === "confirm" ? await api.confirm(entry.basis, entry.input, signal, userId)
        : await api.delete(entry.basis, signal, userId);
    entry.confirmed = true; entry.result = result;
    if (current()) finishWrite(entry, result);
  };
  const create = () => {
    if (!available || !loaded || !canCreate || busy || readFailed || selected || pending || direct || conflict) return;
    const input = createKind === "paste" ? {
      kind: "paste", text: pasteText, sourceLabel, sourceUrl: sourceUrl.length ? sourceUrl : null,
      sourceDateText: sourceDateText.length ? sourceDateText : null,
    } : { kind: "public_source", sourceId };
    const parsed = sharedInputCreateSchema.safeParse(input);
    if (!parsed.success || (parsed.data.kind === "paste" && !parsed.data.sourceLabel.trim())
      || (parsed.data.kind === "public_source" && !sources.some(source => source.id === sourceId))) {
      setNotice("請核對輸入：原文 1–10,000 字、來源名稱 1–200 字、可選 HTTPS 網址最多 1,000 字、日期原文最多 200 字；公開來源必須由清單選擇。");
      return;
    }
    const entry: Pending = { kind: "create", input: parsed.data, checked: false, confirmed: false };
    void run("保存私人輸入", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const startDirect = (kind: Direct["kind"]) => {
    const basis = selectedRef.current;
    if (!basis || !basis.canManage || basis.recordId !== null || pending || direct || busy || conflict || readFailed || !loaded
      || basis.fetchState === "unknown" || basis.extraction.state === "unknown") return;
    if (kind === "fetch" && (basis.kind !== "public_source" || !fetchConsent || !["not_requested", "failed"].includes(basis.fetchState))) return;
    if (kind === "extract" && (!modelConsent || !excerpt.trim() || excerpt.length > 10000 || !basis.text.includes(excerpt)
      || !["not_requested", "failed"].includes(basis.extraction.state))) return;
    const entry: Direct = { kind, basis, excerpt: kind === "extract" ? excerpt : "", checked: false };
    trackDirect(entry);
    void run(kind === "fetch" ? "取得指定公開來源" : "提取所選節錄", async (signal, current) => {
      const next = kind === "fetch" ? await api.fetch(entry.basis, signal, userId) : await api.extract(entry.basis, entry.excerpt, signal, userId);
      if (current()) finishDirect(entry, next);
    }, "direct");
  };
  const retryDirect = () => {
    const entry = directRef.current;
    if (!entry?.checked || pending || busy || conflict || readFailed || !selected?.canManage || selected.recordId !== null
      || (entry.kind === "fetch" ? !fetchConsent : !modelConsent)) return;
    void run("查回原次請求", async (signal, current) => {
      entry.checked = false; trackDirect(entry);
      const next = entry.kind === "fetch" ? await api.fetch(entry.basis, signal, userId) : await api.extract(entry.basis, entry.excerpt, signal, userId);
      if (current()) finishDirect(entry, next);
    }, "direct");
  };
  const endDirect = () => {
    const entry = directRef.current, basis = selectedRef.current;
    if (!available || !loaded || !entry?.checked || !basis || basis.id !== entry.basis.id || busy || inFlight.current
      || pendingRef.current || conflictRef.current || readFailed
      || (entry.kind === "fetch" ? basis.fetchState : basis.extraction.state) !== "unknown") return;
    trackDirect(null); resetConsent();
    setNotice("已明確結束本次查核，已保存的輸入及手動草稿保留。未知結果不代表未處理，本次請求不會重發；不能開始新的取得或提取。你可刪除此已知輸入，或返回其他輸入。");
  };
  const draftValid = photoDraftSchema.safeParse(draft).success && !!draft.text.trim()
    && (confirmationKind === "reference" || ((draft.rawValue === null && draft.unit === null) || (!!draft.rawValue?.trim() && !!draft.unit?.trim())));
  const directAllowsManual = !direct || (direct.kind === "extract" && direct.checked && selected?.extraction.state !== "running");
  const confirm = () => {
    const basis = selectedRef.current;
    if (!basis?.canManage || basis.recordId !== null || !basis.text.trim() || !sharedConsent || !draftValid || pending
      || busy || conflict || readFailed || !directAllowsManual || (confirmationKind === "family_record" && !childFactConsent)) return;
    const values: CareValues = {
      text: draft.text, source: basis.sourceLabel,
      details: confirmationKind === "reference" ? emptyCareDetails("note") : {
        kind: draft.kind, quantity: draft.rawValue !== null && draft.unit !== null
          ? { rawValue: draft.rawValue, unit: draft.unit, precision: draft.approximate ? "approximate" : "exact" } : null,
        eventTime: { rawText: draft.timeRaw, at: null, timeZone: "Asia/Hong_Kong",
          precision: draft.approximate && draft.timeRaw.length > 0 ? "approximate" : "unknown" },
      },
    };
    const input: SharedInputConfirmation = {
      expectedVersion: basis.version, confirmShared: true, kind: confirmationKind,
      confirmChildFact: confirmationKind === "family_record" && childFactConsent, values,
    };
    const entry: Pending = { kind: "confirm", basis, input: JSON.parse(JSON.stringify(input)) as SharedInputConfirmation, checked: false, confirmed: false };
    void run("確認家庭記錄", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const remove = () => {
    const basis = selectedRef.current;
    if (!basis?.canManage || !deleteScope || !deleteFinal || pending || busy || conflict || readFailed || !directAllowsManual) return;
    const entry: Pending = { kind: "delete", basis, checked: false, confirmed: false };
    void run("刪除輸入及連結記錄", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const retry = () => {
    const entry = pendingRef.current;
    if (!entry?.checked || entry.confirmed || !api.hasPendingOnline() || busy || readFailed) return;
    void run("重試原操作", async (signal, current) => { await sendWrite(entry, signal, current); }, "write");
  };
  const openInput = (input: SharedInput) => {
    if (pending || direct || inFlight.current) return;
    void run("讀取私人原文", async (signal, current) => {
      const next = await api.input(childId, input.id, signal, userId);
      if (!current()) return;
      clearEditor(); resetComposer(); selectBasis(next); setExcerpt(initialExcerpt(next)); setReadFailed(false);
    });
  };

  if (Platform.OS !== "web") return <Text>主動分享輸入目前只在 Web 提供。</Text>;
  if (!authorized) return <Text accessibilityRole="alert">{notice}</Text>;
  const fresh = available && loaded && !readFailed && !busy && !pending && !conflict;
  const newDirectBlocked = !!selected && (selected.fetchState === "unknown" || selected.extraction.state === "unknown");
  const canEndDirect = fresh && !!direct && !!selected && direct.checked && selected.id === direct.basis.id
    && (direct.kind === "fetch" ? selected.fetchState : selected.extraction.state) === "unknown";
  const manageable = !!selected && selected.canManage && selected.ownerUserId === userId;
  const editable = manageable && !busy && !pending;
  const canConfirm = fresh && manageable && selected?.recordId === null && !!selected.text.trim() && directAllowsManual;
  const excerptValid = !!selected && !!excerpt.trim() && excerpt.length <= 10000 && selected.text.includes(excerpt);
  const editDraft = (value: PhotoDraft) => { setDraft(value); setSharedConsent(false); setChildFactConsent(false); };
  return <View style={styles.panel}>
    <Text variant="titleLarge" accessibilityRole="header">主動分享、貼上及公開來源</Text>
    <Text>原始輸入一直保持私人，只有上傳者可讀取。公開帖子屬參考內容；不會自動成為孩子的事實、執行授權或任務。</Text>
    <Text>照片上傳請使用現有「照片及確認記錄」區，先保存原檔及來源。</Text>
    {!online && <Text>目前未連線，原文及草稿只暫存在本頁；重連後先核對最新狀態，不會離線排程提交。</Text>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {!!busy && <Text>{busy}中…</Text>}
    <Button mode="outlined" onPress={refresh} disabled={!available || !!busy}>查原收據及重新讀取</Button>
    {pending && <View style={styles.box}>
      <Text>原操作{pending.confirmed ? "已由原收據確認，結果待核對" : "結果未知"}，提交內容已鎖定；不會按文字或 hash 猜測結果。</Text>
      <Button mode="outlined" onPress={retry} disabled={!available || !!busy || readFailed || !pending.checked || pending.confirmed || !api.hasPendingOnline()}>
        明確重試原內容及原操作識別
      </Button>
      {pending.confirmed && pending.result === undefined && !api.hasPendingOnline() && <Button mode="outlined"
        disabled={!available || !!busy || readFailed} onPress={() => {
          trackPending(null); clearEditor(); resetComposer();
          setNotice("已結束由原收據確認的操作，並清除本頁草稿。原操作不會重送；請逐項開啟清單核對。");
        }}>結束已確認操作並清除本頁草稿（不重送）</Button>}
    </View>}
    {conflict && <View style={styles.box}>
      <Text>草稿保留在原版本 {selected?.version ?? "未確定"}；{latest ? "目前版本 " + latest.version : "請先重新讀取目前版本"}。</Text>
      <Button mode="outlined" disabled={!available || !!busy || !latest || !!pending || !!direct} onPress={() => {
        if (!latest) return;
        selectBasis(latest); setLatest(null); trackConflict(false); resetConsent();
        if (excerpt && !latest.text.includes(excerpt)) setExcerpt("");
        setNotice("已明確載入目前版本，手動草稿保留。請重新核對原文及共享範圍。");
      }}>明確載入目前版本並保留手動草稿</Button>
    </View>}
    {canCreate && !selected && <View style={styles.box}>
      <Text variant="titleMedium">新增私人輸入</Text>
      <RadioButton.Group value={createKind} onValueChange={value => { setCreateKind(value as typeof createKind); resetConsent(); }}>
        <RadioButton.Item label="主動貼上原文" value="paste" disabled={!!busy || !!pending || !!direct} />
        <RadioButton.Item label="選擇已批准的公開來源" value="public_source" disabled={!!busy || !!pending || !!direct} />
      </RadioButton.Group>
      {createKind === "paste" ? <>
        <TextInput mode="outlined" label="貼上原文（最多 10,000 字）" multiline value={pasteText} maxLength={10000}
          editable={!busy && !pending && !direct} onChangeText={setPasteText} />
        <TextInput mode="outlined" label="來源名稱（最多 200 字）" value={sourceLabel} maxLength={200}
          editable={!busy && !pending && !direct} onChangeText={setSourceLabel} />
        <TextInput mode="outlined" label="來源 HTTPS 網址（可選，只保存來源）" value={sourceUrl} maxLength={1000}
          editable={!busy && !pending && !direct} onChangeText={setSourceUrl} />
        <TextInput mode="outlined" label="來源日期原文（可選，最多 200 字）" value={sourceDateText} maxLength={200}
          editable={!busy && !pending && !direct} onChangeText={setSourceDateText} />
      </> : <>
        <Text>只可選擇清單中的公開來源；建立輸入後仍須另行確認取得原文。</Text>
        {sources.length === 0 && <Text>目前沒有可選的公開來源。</Text>}
        <RadioButton.Group value={sourceId} onValueChange={setSourceId}>
          {sources.map(source => <RadioButton.Item key={source.id} label={source.publisher + "；" + source.url} value={source.id}
            disabled={!!busy || !!pending || !!direct} />)}
        </RadioButton.Group>
      </>}
      <Button mode="contained" onPress={create} disabled={!fresh || !!direct || (createKind === "public_source" && !sourceId)}>保存私人輸入及來源</Button>
    </View>}
    {selected && <View style={styles.box}>
      <Text variant="titleMedium">已保存的私人輸入</Text>
      <Text>私人，只有上傳者可讀取；版本 {selected.version}；輸入 {selected.id}</Text>
      <Text>來源：{selected.sourceLabel}；{selected.sourceUrl ?? "沒有來源網址"}</Text>
      <Text>來源日期原文：{selected.sourceDateText || "未提供"}；保存時間：{selected.createdAt}</Text>
      <Text>取得時間：{selected.retrievedAt ?? "未取得"}；SHA-256：{selected.sha256 ?? "尚未有原文 hash"}</Text>
      <Text>{fetchText[selected.fetchState]}；{extractionText[selected.extraction.state]}</Text>
      {selected.recordId && <Text>已連結家庭記錄：{selected.recordId}；{selected.confirmationKind === "reference" ? "參考備註" : "已由上傳者確認與孩子有關的記錄"}。原文仍保持私人。</Text>}
      <Text variant="titleSmall">保存的完整原文（{selected.text.length} 字）</Text>
      <Text selectable>{selected.text || "尚未取得原文"}</Text>
      {!manageable && <Text>目前沒有此輸入的管理權限。</Text>}
      {manageable && selected.recordId === null && selected.kind === "public_source" && <>
        <Confirmation label="我確認取得此清單來源的公開原文，並私人保存來源及取得時間" checked={fetchConsent}
          disabled={!fresh || (!direct && (newDirectBlocked || !["not_requested", "failed"].includes(selected.fetchState))) || direct?.kind === "extract"}
          onToggle={() => setFetchConsent(value => !value)} />
        {!direct && <Button mode="outlined" disabled={!fresh || newDirectBlocked || !fetchConsent || !["not_requested", "failed"].includes(selected.fetchState)}
          onPress={() => startDirect("fetch")}>{selected.fetchState === "failed" ? "明確重新取得此來源" : "明確取得此公開來源"}</Button>}
      </>}
      {manageable && selected.recordId === null && !!selected.text && <>
        <Text variant="titleSmall">可選的 AI 提取節錄</Text>
        <Text>{selected.text.length > 10000 ? "原文超過 10,000 字。請從以上原文複製一段連續節錄，最多 10,000 字；不會自動截短。"
          : "預設使用完整原文；你也可選取一段連續原文。"}</Text>
        <TextInput mode="outlined" label="原文的完整連續節錄（最多 10,000 字）" multiline value={excerpt} maxLength={10000}
          editable={editable && !direct} onChangeText={value => { setExcerpt(value); setModelConsent(false); }} />
        <HelperText type={excerptValid ? "info" : "error"}>{excerptValid ? "節錄與保存原文完全相符。"
          : "請選取非空白、與保存原文完全相符的連續節錄。"}</HelperText>
        <Confirmation label="我同意把以上原文節錄交由 Gemini 提取；候選仍須由我核對" checked={modelConsent}
          disabled={!fresh || !excerptValid || direct?.kind === "fetch" || (!direct && (newDirectBlocked || !["not_requested", "failed"].includes(selected.extraction.state)))}
          onToggle={() => setModelConsent(value => !value)} />
        {!direct && <Button mode="outlined" onPress={() => startDirect("extract")}
          disabled={!fresh || newDirectBlocked || !excerptValid || !modelConsent || !["not_requested", "failed"].includes(selected.extraction.state)}>同意並提取所選節錄</Button>}
      </>}
      {direct && <View style={styles.box}>
        <Text>原次{direct.kind === "fetch" ? "取得來源" : "提取節錄"}使用版本 {direct.basis.version}；只會明確重播同一請求，不會改用新版本開始另一次處理。</Text>
        {direct.kind === "extract" && <Text selectable>原次節錄：{direct.excerpt}</Text>}
        <Button mode="outlined" onPress={retryDirect} disabled={!fresh || !direct.checked || !manageable
          || (direct.kind === "fetch" ? !fetchConsent : !modelConsent)}>明確查回／重播原次請求（沿用原版本）</Button>
        <Button mode="outlined" onPress={endDirect} disabled={!canEndDirect}>結束本次查核並保留已保存輸入</Button>
      </View>}
      {manageable && selected.recordId === null && selected.extraction.draft && <View style={styles.box}>
        <Text variant="titleSmall">未確認候選</Text>
        <Text>{selected.extraction.draft.text || "未提取到文字"}</Text>
        <Text>種類：{kindText[selected.extraction.draft.kind]}；數值：{selected.extraction.draft.rawValue ?? "未有"}；單位：{selected.extraction.draft.unit ?? "未有"}</Text>
        <Text>時間原文：{selected.extraction.draft.timeRaw || "未有"}；{selected.extraction.draft.approximate ? "約數" : "未標記約數"}</Text>
        {selected.extraction.draft.uncertainties.map((item, index) => <Text key={index}>待核對：{item}</Text>)}
        <Button mode="outlined" disabled={!editable} onPress={() => {
          if (selected.extraction.draft) editDraft({ ...selected.extraction.draft, uncertainties: [...selected.extraction.draft.uncertainties] });
        }}>採用候選並取代下方手動草稿</Button>
      </View>}
    </View>}
    {manageable && selected?.recordId === null && <View style={styles.box}>
      <Text variant="titleMedium">核對、編輯或直接手動記錄</Text>
      <Text>提取屬可選功能。你可直接手動輸入；採用候選後仍可更正，不確定事項會保留供核對。</Text>
      <TextInput mode="outlined" label="手動／已採用草稿（最多 5,000 字）" multiline value={draft.text} maxLength={5000}
        editable={editable} onChangeText={value => editDraft({ ...draft, text: value })} />
      {draft.uncertainties.map((item, index) => <Text key={index}>仍須核對：{item}</Text>)}
      <RadioButton.Group value={confirmationKind} onValueChange={value => {
        setConfirmationKind(value as typeof confirmationKind); setSharedConsent(false); setChildFactConsent(false);
      }}>
        <RadioButton.Item label="參考備註（預設；不當作孩子事實）" value="reference" disabled={!editable} />
        <RadioButton.Item label="與我的孩子實際有關的家庭記錄" value="family_record" disabled={!editable} />
      </RadioButton.Group>
      {confirmationKind === "reference" ? <Text>參考記錄只保存為備註；數量留空、事件時間未知。來源由 Server 按原始輸入保存。</Text> : <>
        <RadioButton.Group value={draft.kind} onValueChange={value => editDraft({ ...draft, kind: value as CareKind })}>
          {CARE_KINDS.map(kind => <RadioButton.Item key={kind} label={kindText[kind]} value={kind} disabled={!editable} />)}
        </RadioButton.Group>
        <TextInput mode="outlined" label="數值原文（可選）" value={draft.rawValue ?? ""} maxLength={100} editable={editable}
          onChangeText={value => editDraft({ ...draft, rawValue: value.length ? value : null })} />
        <TextInput mode="outlined" label="單位（有數值時必填）" value={draft.unit ?? ""} maxLength={50} editable={editable}
          onChangeText={value => editDraft({ ...draft, unit: value.length ? value : null })} />
        <Confirmation label="數值／時間屬約數" checked={draft.approximate} disabled={!editable}
          onToggle={() => editDraft({ ...draft, approximate: !draft.approximate })} />
        <TextInput mode="outlined" label="事件時間原文（可選，不猜測精確時間）" value={draft.timeRaw} maxLength={300} editable={editable}
          onChangeText={value => editDraft({ ...draft, timeRaw: value })} />
        <Confirmation label="我已核對，這項內容實際涉及我所選的孩子；不是把公開帖子當作孩子事實" checked={childFactConsent}
          disabled={!canConfirm} onToggle={() => { setChildFactConsent(value => !value); setSharedConsent(false); }} />
      </>}
      <Confirmation label="我已核對草稿及不確定事項，確認下方記錄與家庭共享；原始輸入仍保持私人" checked={sharedConsent}
        disabled={!canConfirm || !draftValid || (confirmationKind === "family_record" && !childFactConsent)} onToggle={() => setSharedConsent(value => !value)} />
      <Button mode="contained" onPress={confirm} disabled={!canConfirm || !draftValid || !sharedConsent
        || (confirmationKind === "family_record" && !childFactConsent)}>確認並建立家庭記錄</Button>
    </View>}
    {manageable && selected && <View style={styles.box}>
      <Text variant="titleMedium">刪除私人輸入及連結記錄</Text>
      <Text>將刪除此私人原文；如已建立家庭確認記錄，亦會一併移除（{selected.recordId ?? "目前沒有連結記錄"}）。</Text>
      <Confirmation label="我明白會刪除此私人輸入及其已連結家庭記錄" checked={deleteScope} disabled={!fresh || !directAllowsManual}
        onToggle={() => { setDeleteScope(value => !value); setDeleteFinal(false); }} />
      <Confirmation label="我再次確認刪除以上輸入及連結記錄" checked={deleteFinal} disabled={!fresh || !deleteScope || !directAllowsManual}
        onToggle={() => setDeleteFinal(value => !value)} />
      <Button mode="outlined" onPress={remove} disabled={!fresh || !directAllowsManual || !deleteScope || !deleteFinal}>確認刪除輸入及連結記錄</Button>
    </View>}
    {(selected || pasteText || draft.text || sourceId) && <Button disabled={!!busy || !!pending || !!direct} onPress={() => {
      clearEditor(); resetComposer(); setNotice("本頁原文及草稿已明確清除；已保存的輸入仍可在清單開啟。");
    }}>明確清除本頁草稿／返回新增輸入</Button>}
    <Text variant="titleMedium">我的私人輸入</Text>
    {!loaded && <Text>尚未成功讀取輸入清單。</Text>}
    {loaded && !canCreate && <Text>目前沒有新增輸入權限；管理操作按每項輸入的 Server 權限顯示。</Text>}
    {loaded && inputs.length === 0 && <Text>目前沒有可讀取的私人輸入。</Text>}
    {inputs.map(input => <View key={input.id} style={styles.box}>
      <Text>{input.sourceLabel}；私人；{fetchText[input.fetchState]}；{extractionText[input.extraction.state]}</Text>
      <Text>保存時間：{input.createdAt}；{input.recordId ? "已連結家庭記錄 " + input.recordId : "尚未建立家庭記錄"}</Text>
      <Button mode="outlined" disabled={!available || !!busy || !!pending || !!direct} onPress={() => openInput(input)}>開啟私人原文（取代本頁草稿）</Button>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  box: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  confirmation: { flexDirection: "row", alignItems: "center", gap: 4 },
  confirmationLabel: { flex: 1 },
});
