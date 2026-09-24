import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Child } from "../shared/records.ts";
import { CARE_KINDS, emptyCareDetails } from "../shared/care.ts";
import type { AgeBasis, CareCursor, CareKind, CareRecord, CareRevision, CareValues, ChildProfile, ChildProfileData } from "../shared/care.ts";
import { CareApiError, createCareApi } from "./care-api.ts";

interface Props { userId: string; child: Child; online: boolean; apiBaseUrl?: string; onChanged: () => void; onAccessLost: () => void }
type WriteKind = "care-create" | "care-revise" | "care-delete" | "profile-save" | "profile-delete";
type Conflict = { kind: "care"; original: CareRecord; latest: CareRecord | null; reviewed: boolean }
  | { kind: "profile"; original: ChildProfile; latest: ChildProfile | null; reviewed: boolean };
const kindName: Record<CareKind, string> = { note: "備註", feeding: "餵食", sleep: "睡眠", diaper: "尿片", temperature: "體溫", measurement: "量度", appointment: "預約" };
const ageUnitName = { days: "日", weeks: "週", months: "月", years: "年" };
const emptyProfile = (): ChildProfileData => ({ age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: "", validUntil: null });
const optional = (value: string) => value.trim() ? value : null;
const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const displayTime = (value: string) => new Date(value).toLocaleString("zh-HK", { hour12: false });
const ageText = (value: AgeBasis) => value.kind === "unknown" ? "未知" : value.kind === "birth_date" ? `出生日期：${value.date}` : `約 ${value.rawValue} ${ageUnitName[value.unit]}（截至 ${value.asOf}）`;
const profileText = (data: ChildProfileData) => [ageText(data.age), ...([
  ["預產期", data.dueDate], ["孕週原文", data.gestationalWeeksRaw], ["地區", data.region], ["語言", data.language],
  ["過敏資料", data.allergies], ["特殊需要", data.specialNeeds], ["照顧偏好", data.preferences],
  ["有效至", data.validUntil], ["來源", data.source],
] as const).filter(([, value]) => value).map(([label, value]) => `${label}：${value}`)].join("；");
const careText = (data: CareValues) => `${kindName[data.details.kind]}；原文：${data.text}；數量：${data.details.quantity ? `${data.details.quantity.rawValue} ${data.details.quantity.unit}（${data.details.quantity.precision === "exact" ? "準確" : "約數"}）` : "未提供"}；事件時間原文：${data.details.eventTime.rawText || "未知"}；來源：${data.source}`;

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Field({ label, value, onChangeText, editable = true, multiline = false, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; editable?: boolean; multiline?: boolean; placeholder?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={editable} multiline={multiline} placeholder={placeholder} style={[styles.input, multiline && styles.multiline]} /></View>;
}

export function CarePanel({ userId, child, online, apiBaseUrl = "", onChanged, onAccessLost }: Props) {
  const scope = `${userId}\n${child.id}\n${apiBaseUrl}`;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const api = useMemo(() => createCareApi(apiBaseUrl), [apiBaseUrl]);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const [visibleScope, setVisibleScope] = useState(scope);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState<WriteKind | null>(null);
  const [uncertainReviewed, setUncertainReviewed] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [profileBasis, setProfileBasis] = useState<ChildProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<ChildProfileData>(emptyProfile);
  const [profileReason, setProfileReason] = useState("");
  const [profilePreview, setProfilePreview] = useState(false);
  const [profileDeleteConfirm, setProfileDeleteConfirm] = useState(false);
  const [profileHistory, setProfileHistory] = useState<ChildProfile[]>([]);
  const [profileHistoryCursor, setProfileHistoryCursor] = useState<number | null>(null);
  const [profileHistoryOpen, setProfileHistoryOpen] = useState(false);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [cursor, setCursor] = useState<CareCursor | null>(null);
  const [searched, setSearched] = useState(false);
  const [query, setQuery] = useState("");
  const [filterKind, setFilterKind] = useState<CareKind | "all">("all");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeKind, setActiveKind] = useState<CareKind | "all">("all");
  const [editing, setEditing] = useState<CareRecord | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<CareKind>("note");
  const [quantityRaw, setQuantityRaw] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("");
  const [quantityPrecision, setQuantityPrecision] = useState<"exact" | "approximate">("approximate");
  const [eventRaw, setEventRaw] = useState("");
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [carePreview, setCarePreview] = useState(false);
  const [careDeleteConfirm, setCareDeleteConfirm] = useState(false);
  const [historyRecord, setHistoryRecord] = useState<CareRecord | null>(null);
  const [history, setHistory] = useState<CareRevision[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const canManage = child.accessRole === "owner" || child.accessRole === "caregiver";
  const draftLocked = !!busy || !!uncertain || !!conflict;
  const ready = online && !draftLocked;

  const clear = useCallback(() => {
    setProfile(null); setProfileBasis(null); setProfileDraft(emptyProfile()); setProfileReason(""); setProfilePreview(false); setProfileDeleteConfirm(false);
    setProfileHistory([]); setProfileHistoryCursor(null); setProfileHistoryOpen(false);
    setRecords([]); setCursor(null); setSearched(false); setQuery(""); setFilterKind("all"); setActiveQuery(""); setActiveKind("all");
    setEditing(null); setText(""); setKind("note"); setQuantityRaw(""); setQuantityUnit(""); setQuantityPrecision("approximate");
    setEventRaw(""); setSource(""); setReason(""); setCarePreview(false); setCareDeleteConfirm(false);
    setHistoryRecord(null); setHistory([]); setHistoryCursor(null);
  }, []);

  const verified = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> => {
    if (await api.getSession(signal) !== userId) throw new CareApiError(401);
    const result = await operation(signal);
    if (await api.getSession(signal) !== userId) throw new CareApiError(401);
    return result;
  }, [api, userId]);

  const run = useCallback(async (label: string, operation: (signal: AbortSignal, current: () => boolean) => Promise<void>, write: WriteKind | null = null) => {
    if (!online || inFlight.current || (write && (uncertain || conflict))) return;
    inFlight.current = true;
    const started = generation.current;
    const requestScope = scope;
    const controller = new AbortController();
    requests.current.add(controller);
    const current = () => !controller.signal.aborted && generation.current === started && latestScope.current === requestScope;
    setBusy(label); setNotice("");
    try {
      await operation(controller.signal, current);
    } catch (error) {
      if (!current()) return;
      const status = error instanceof CareApiError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        clear(); setUncertain(null); setUncertainReviewed(false); setConflict(null);
        setNotice("登入或孩子權限已改變，資料及表單已清除。請重新登入或選擇孩子。");
        onAccessLost();
      } else if (status === 409) {
        let sameSession: boolean | null = null;
        try { sameSession = await api.getSession(controller.signal) === userId; } catch { /* Keep the write blocked until identity can be checked. */ }
        if (!current()) return;
        if (sameSession === false || write === "care-create" || write === null) {
          clear(); onAccessLost();
          setNotice("登入帳號或權限已改變，資料及表單已清除。請重新登入或選擇孩子。");
        } else if (sameSession === null) {
          if (write) { setUncertain(write); setUncertainReviewed(false); }
          setNotice("暫未能核對登入帳號或寫入結果。請重新讀取及核對，系統不會自動重送。");
        } else {
          if (write === "care-revise" || write === "care-delete") {
            if (editing) setConflict({ kind: "care", original: editing, latest: null, reviewed: false });
          } else if (write === "profile-save" || write === "profile-delete") {
            if (profile) setConflict({ kind: "profile", original: profileBasis ?? profile, latest: null, reviewed: false });
          }
          setCarePreview(false); setProfilePreview(false); setCareDeleteConfirm(false); setProfileDeleteConfirm(false);
          setNotice("資料版本已改變。草稿仍在；請重新讀取並比較最新版本，再選擇是否重新套用。");
        }
      } else if (status === 400 || status === 415 || status === 428) {
        setNotice(status === 428 ? "登入帳號未確認，請重新確認後提交。" : "輸入未被接納，請核對內容後再提交。");
      } else if (status >= 400 && status < 500) {
        setNotice("請求未被接納，請核對後再試。");
      } else {
        if (write) { setUncertain(write); setUncertainReviewed(false); }
        setNotice(write ? "提交結果未能確認。請先重新讀取並核對，系統不會自動重送；草稿仍在。" : "讀取失敗，請稍後重新讀取。");
      }
    } finally {
      requests.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  }, [online, uncertain, conflict, scope, clear, onAccessLost, editing, profile, profileBasis, api, userId]);

  const load = useCallback(async (signal: AbortSignal, current: () => boolean, preserveDraft: boolean) => {
    const nextProfile = await verified(next => api.getProfile(child.id, next), signal);
    const nextPage = await verified(next => api.search(child.id, {}, next, userId), signal);
    if (!current()) return;
    setProfile(nextProfile);
    setRecords(nextPage.records); setCursor(nextPage.nextCursor); setSearched(true);
    setActiveQuery(""); setActiveKind("all");
    setProfileHistoryOpen(false); setProfileHistory([]); setHistoryRecord(null); setHistory([]);
    if (!preserveDraft) { setProfileBasis(nextProfile); setProfileDraft(nextProfile.data ?? emptyProfile()); setProfileReason(""); }
    setProfilePreview(false); setCarePreview(false);
    setProfileDeleteConfirm(false); setCareDeleteConfirm(false);
    return { nextProfile, nextPage };
  }, [api, child.id, userId, verified]);

  useEffect(() => {
    generation.current += 1;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false;
    clear(); setVisibleScope(scope); setBusy(""); setNotice(""); setUncertain(null); setUncertainReviewed(false); setConflict(null);
    return () => { generation.current += 1; for (const request of requests.current) request.abort(); requests.current.clear(); inFlight.current = false; };
  }, [scope, clear]);

  useEffect(() => {
    if (visibleScope !== scope || !online) return;
    void run("讀取", async (signal, current) => { await load(signal, current, false); });
    // Only a child/account change starts the initial load. Reconnecting retains unsaved fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, visibleScope]);

  const refresh = () => { void run("重新讀取", async (signal, current) => {
    const loaded = await load(signal, current, true);
    if (!current() || !loaded) return;
    if (uncertain) {
      setUncertainReviewed(true);
      setNotice("已重新讀取。請核對目前資料及搜尋結果，再明確選擇如何處理這次結果未知的操作。");
    }
    if (conflict?.kind === "profile") {
      setConflict({ ...conflict, latest: loaded.nextProfile, reviewed: true });
      setNotice("已讀取最新孩子資料。請比較舊版本、最新版本與保留的草稿，再選擇是否重新套用。");
    } else if (conflict?.kind === "care") {
      const page = await verified(next => api.history(child.id, conflict.original.id, null, next), signal);
      if (!current()) return;
      const revision = page.revisions[0];
      if (revision) {
        setConflict({ ...conflict, latest: { ...conflict.original, ...revision }, reviewed: true });
        setNotice("已讀取該記錄的最新版本，包括不在時間軸首頁的記錄。請比較後明確選擇是否重新套用草稿。");
      } else setNotice("未能核對該記錄的最新版本；暫不可重新套用草稿。");
    } else if (profileBasis && loaded.nextProfile.version !== profileBasis.version && canManage && !uncertain) {
      setConflict({ kind: "profile", original: profileBasis, latest: loaded.nextProfile, reviewed: true });
      setNotice("孩子資料在重新讀取時已有新版本。本地草稿仍在；請比較舊版、最新版後明確選擇。");
    }
  }); };
  const search = (nextCursor: CareCursor | null = null) => {
    const nextQuery = nextCursor ? activeQuery : query;
    const nextKind = nextCursor ? activeKind : filterKind;
    void run("搜尋", async (signal, current) => {
      const page = await verified(next => api.search(child.id, { ...(nextQuery ? { query: nextQuery } : {}), ...(nextKind !== "all" ? { kind: nextKind } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) }, next, userId), signal);
      if (!current()) return;
      setRecords(previous => nextCursor ? [...previous, ...page.records] : page.records);
      setCursor(page.nextCursor); setSearched(true); setActiveQuery(nextQuery); setActiveKind(nextKind);
    });
  };
  const values = (): CareValues => ({ text, source, details: {
    ...emptyCareDetails(kind),
    quantity: quantityRaw || quantityUnit ? { rawValue: quantityRaw, unit: quantityUnit, precision: quantityPrecision } : null,
    eventTime: editing && eventRaw === editing.details.eventTime.rawText ? editing.details.eventTime
      : { rawText: eventRaw, at: null, timeZone: "Asia/Hong_Kong", precision: eventRaw.trim() ? "approximate" : "unknown" },
  } });
  const resetCare = () => { setEditing(null); setText(""); setKind("note"); setQuantityRaw(""); setQuantityUnit(""); setQuantityPrecision("approximate"); setEventRaw(""); setSource(""); setReason(""); setCarePreview(false); setCareDeleteConfirm(false); };
  const resolveUnknown = (completed: boolean) => {
    if (!uncertain || !uncertainReviewed) return;
    if (completed) {
      if (uncertain.startsWith("care-")) resetCare();
      else { setProfileBasis(profile); setProfileDraft(profile?.data ?? emptyProfile()); setProfileReason(""); setProfilePreview(false); setProfileDeleteConfirm(false); }
    } else { setCarePreview(false); setProfilePreview(false); setCareDeleteConfirm(false); setProfileDeleteConfirm(false); }
    setUncertain(null); setUncertainReviewed(false);
    setNotice(completed ? "已按你的核對結果清除這次操作的草稿；其他未提交內容仍保留。" : "已按你的核對結果保留草稿。請重新預覽及確認，系統不會自動重送。");
  };
  const reloadAfterConfirmed = async (signal: AbortSignal, current: () => boolean, success: string) => {
    try {
      await load(signal, current, true);
      if (current()) setNotice(success);
    } catch (error) {
      const status = error instanceof CareApiError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404 || status === 409) throw error;
      if (current()) setNotice(`${success}列表重新讀取失敗，請手動重新讀取；毋須再次提交。`);
    }
  };
  const selectEdit = (item: CareRecord) => {
    setEditing(item); setText(item.text); setKind(item.details.kind); setQuantityRaw(item.details.quantity?.rawValue ?? "");
    setQuantityUnit(item.details.quantity?.unit ?? ""); setQuantityPrecision(item.details.quantity?.precision ?? "approximate");
    setEventRaw(item.details.eventTime.rawText); setSource(item.source); setReason(""); setCarePreview(false); setCareDeleteConfirm(false);
  };
  const saveCare = () => { const input = values(); const target = editing;
    void run(target ? "更正記錄" : "保存記錄", async (signal, current) => {
      if (target) await verified(next => api.revise(child.id, target.id, input, target.version, reason, next, userId), signal);
      else await verified(next => api.create(child.id, input, next, userId), signal);
      if (!current()) return;
      resetCare(); onChanged();
      await reloadAfterConfirmed(signal, current, target ? "更正已保存；舊版本保留在歷史。" : "共享記錄已保存。");
    }, target ? "care-revise" : "care-create");
  };
  const saveProfile = () => { const currentVersion = profileBasis?.version ?? 0; const draft = profileDraft;
    void run("保存孩子資料", async (signal, current) => {
      const result = await verified(next => api.saveProfile(child.id, draft, currentVersion, profileReason, next, userId), signal);
      if (!current()) return;
      setProfile(result); setProfileBasis(result); setProfileDraft(result.data ?? emptyProfile()); setProfileReason(""); setProfilePreview(false); onChanged();
      setNotice("孩子資料已保存；之前確認的版本可在歷史查看。");
    }, "profile-save");
  };
  const loadProfileHistory = (beforeVersion: number | null) => {
    void run("讀取孩子資料歷史", async (signal, current) => {
      const page = await verified(next => api.profileHistory(child.id, beforeVersion, next), signal);
      if (!current()) return;
      setProfileHistory(previous => beforeVersion === null ? page.revisions : [...previous, ...page.revisions]);
      setProfileHistoryCursor(page.nextBeforeVersion); setProfileHistoryOpen(true);
    });
  };
  const loadHistory = (item: CareRecord, beforeVersion: number | null) => {
    void run("讀取記錄歷史", async (signal, current) => {
      const page = await verified(next => api.history(child.id, item.id, beforeVersion, next), signal);
      if (!current()) return;
      setHistoryRecord(item); setHistory(previous => beforeVersion === null || historyRecord?.id !== item.id ? page.revisions : [...previous, ...page.revisions]);
      setHistoryCursor(page.nextBeforeVersion);
    });
  };
  const profileField = (field: Exclude<keyof ChildProfileData, "age" | "source">, label: string, placeholder?: string) => <Field label={label} value={profileDraft[field] ?? ""} onChangeText={value => { setProfileDraft(previous => ({ ...previous, [field]: optional(value) })); setProfilePreview(false); }} editable={!draftLocked} placeholder={placeholder} />;

  if (visibleScope !== scope) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>照顧記錄與孩子資料：{child.displayName}</Text>
    <Text style={styles.hint}>此處保存的是家庭共享資料。私人 AI 聊天不會自動讀取或分享；來源只記錄你自己描述的資料出處。</Text>
    <Text style={styles.hint}>未提交草稿只保留在此頁；切換孩子、換帳號、離開頁面或關閉瀏覽器可能令草稿消失。</Text>
    <Action label={busy === "重新讀取" ? "正在讀取…" : "重新讀取並核對"} onPress={refresh} disabled={!online || !!busy} />
    {!online && <Text style={styles.warning}>目前離線，表單會暫時保留；恢復連線後請重新讀取才提交。</Text>}
    {(uncertain || conflict) && <Text style={styles.warning}>請先重新讀取及核對目前版本或提交結果，再重新確認操作。</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {uncertain && <View style={styles.confirmation}>
      <Text style={styles.warning}>結果未知的操作：{({ "care-create": "新增照顧記錄", "care-revise": "更正照顧記錄", "care-delete": "刪除照顧記錄及歷史", "profile-save": "保存孩子資料", "profile-delete": "刪除孩子資料及歷史" } satisfies Record<WriteKind, string>)[uncertain]}。請先重新讀取，必要時用搜尋及歷史核對；系統不會自動重送。</Text>
      <Action label="已找到／操作已完成，清除這次操作草稿" onPress={() => resolveUnknown(true)} disabled={!online || !!busy || !uncertainReviewed} />
      <Action label="已核對未完成，保留草稿重新檢視" onPress={() => resolveUnknown(false)} disabled={!online || !!busy || !uncertainReviewed} />
    </View>}
    {conflict?.kind === "profile" && <View style={styles.confirmation}>
      <Text style={styles.warning}>孩子資料版本衝突：原版本 {conflict.original.version}（{conflict.original.data ? profileText(conflict.original.data) : "沒有資料"}）；{conflict.latest ? `最新版本 ${conflict.latest.version}（${conflict.latest.data ? profileText(conflict.latest.data) : "沒有資料"}）` : "最新版本尚未核對"}；本地草稿：{profileText(profileDraft)}。</Text>
      <Action label="已比較，將本地草稿重新套用至最新版本" onPress={() => { if (!conflict.latest) return; setProfileBasis(conflict.latest); setConflict(null); setProfilePreview(false); setNotice("已選擇最新版本作基準。請重新預覽及確認草稿。"); }} disabled={!online || !!busy || !conflict.reviewed || !conflict.latest} />
    </View>}
    {conflict?.kind === "care" && <View style={styles.confirmation}>
      <Text style={styles.warning}>照顧記錄版本衝突：原版本 {conflict.original.version}（{careText(conflict.original)}）；{conflict.latest ? `最新版本 ${conflict.latest.version}（${careText(conflict.latest)}）` : "最新版本尚未核對"}；本地草稿：{careText(values())}。</Text>
      <Action label="已比較，將本地草稿重新套用至最新版本" onPress={() => { if (!conflict.latest) return; setEditing(conflict.latest); setConflict(null); setCarePreview(false); setNotice("已選擇最新版本作基準。請重新預覽及確認草稿。"); }} disabled={!online || !!busy || !conflict.reviewed || !conflict.latest} />
    </View>}

    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>孩子資料</Text>
      {profile ? <Text style={styles.body}>目前版本 {profile.version}；{profile.data ? profileText(profile.data) : "目前沒有已確認資料"}</Text> : <Text style={styles.body}>資料正在讀取。</Text>}
      {profile?.data && <Text style={styles.body}>來源：{profile.data.source}；確認人：{profile.confirmedBy ?? "未知"}；確認時間：{profile.confirmedAt ? displayTime(profile.confirmedAt) : "未知"}</Text>}
      <Action label="查看確認／更正歷史" onPress={() => loadProfileHistory(null)} disabled={!online || !!busy || !profile} />
      {profileHistoryOpen && <View style={styles.history}>
        {profileHistory.map((item, index) => <Text key={`${item.version}-${index}`} style={styles.body}>版本 {item.version}；{item.data ? profileText(item.data) : "已永久刪除整個檔案歷史"}；原因：{item.reason ?? "首次確認"}；確認人：{item.confirmedBy ?? "未知"}；{item.confirmedAt ? displayTime(item.confirmedAt) : "未知"}</Text>)}
        {profileHistory.length === 0 && <Text style={styles.hint}>沒有較早版本。</Text>}
        {profileHistoryCursor !== null && <Action label="載入更早版本" onPress={() => loadProfileHistory(profileHistoryCursor)} disabled={!online || !!busy} />}
      </View>}
      {canManage && profile && <View style={styles.group}>
        <Text style={styles.hint}>只填已知資料；未知欄位可留空。更正會新增版本，不會刪去舊版本。</Text>
        <Text style={styles.label}>年齡資料</Text>
        <View style={styles.row}>{(["unknown", "birth_date", "approximate"] as const).map(value => <Action key={value} label={`${profileDraft.age.kind === value ? "已選：" : ""}${value === "unknown" ? "未知" : value === "birth_date" ? "出生日期" : "約數年齡"}`} onPress={() => { setProfileDraft(previous => ({ ...previous, age: value === "unknown" ? { kind: "unknown" } : value === "birth_date" ? { kind: "birth_date", date: "" } : { kind: "approximate", rawValue: "", unit: "months", asOf: "" } })); setProfilePreview(false); }} disabled={draftLocked} />)}</View>
        {profileDraft.age.kind === "birth_date" && <Field label="出生日期（YYYY-MM-DD）" value={profileDraft.age.date} onChangeText={value => { setProfileDraft(previous => ({ ...previous, age: { kind: "birth_date", date: value } })); setProfilePreview(false); }} editable={!draftLocked} />}
        {profileDraft.age.kind === "approximate" && <>
          <Field label="約數年齡原值" value={profileDraft.age.rawValue} onChangeText={value => { setProfileDraft(previous => ({ ...previous, age: { ...previous.age as Extract<AgeBasis, { kind: "approximate" }>, rawValue: value } })); setProfilePreview(false); }} editable={!draftLocked} />
          <View style={styles.row}>{(["days", "weeks", "months", "years"] as const).map(unit => <Action key={unit} label={`${profileDraft.age.kind === "approximate" && profileDraft.age.unit === unit ? "已選：" : ""}${ageUnitName[unit]}`} onPress={() => { setProfileDraft(previous => ({ ...previous, age: { ...previous.age as Extract<AgeBasis, { kind: "approximate" }>, unit } })); setProfilePreview(false); }} disabled={draftLocked} />)}</View>
          <Field label="約數年齡截至日期（YYYY-MM-DD）" value={profileDraft.age.asOf} onChangeText={value => { setProfileDraft(previous => ({ ...previous, age: { ...previous.age as Extract<AgeBasis, { kind: "approximate" }>, asOf: value } })); setProfilePreview(false); }} editable={!draftLocked} />
        </>}
        {profileField("dueDate", "預產期（YYYY-MM-DD，可空）")}
        {profileField("gestationalWeeksRaw", "孕週原文（可空）")}
        {profileField("region", "地區（可空）", "例如香港；未知請留空")}
        {profileField("language", "語言（可空）")}
        {profileField("allergies", "過敏資料（可空）")}
        {profileField("specialNeeds", "特殊需要（可空）")}
        {profileField("preferences", "照顧偏好（可空）")}
        {profileField("validUntil", "資料有效至（YYYY-MM-DD，可空）")}
        <Field label="資料來源（由你描述）" value={profileDraft.source} onChangeText={value => { setProfileDraft(previous => ({ ...previous, source: value })); setProfilePreview(false); }} editable={!draftLocked} />
        <Field label="確認或更正原因" value={profileReason} onChangeText={value => { setProfileReason(value); setProfilePreview(false); }} editable={!draftLocked} />
        <Action label="預覽孩子資料共享內容" onPress={() => setProfilePreview(true)} disabled={!ready || !profileReason.trim() || !profileDraft.source.trim() || (profileDraft.age.kind === "birth_date" && !dateValid(profileDraft.age.date)) || (profileDraft.age.kind === "approximate" && (!profileDraft.age.rawValue.trim() || !dateValid(profileDraft.age.asOf))) || (!!profileDraft.dueDate && !dateValid(profileDraft.dueDate)) || (!!profileDraft.validUntil && !dateValid(profileDraft.validUntil))} />
        {profilePreview && <View style={styles.confirmation}>
          <Text style={styles.warning}>將與家庭共享版本 {profile.version + 1}：{profileText(profileDraft)}；確認或更正原因：{profileReason}。</Text>
          <Action label="我已核對，確認共享孩子資料" onPress={saveProfile} disabled={!ready} />
          <Action label="取消預覽" onPress={() => setProfilePreview(false)} />
        </View>}
        {profile.data && <Action label="永久刪除孩子資料及所有歷史" onPress={() => setProfileDeleteConfirm(true)} disabled={!ready} />}
        {profileDeleteConfirm && <View style={styles.confirmation}>
          <Text style={styles.warning}>這會永久刪除整個孩子資料檔案及更正歷史，不能從歷史復原。孩子及照顧記錄不在此刪除範圍。</Text>
          <Action label="第二次確認：永久刪除孩子資料歷史" disabled={!ready} onPress={() => { void run("刪除孩子資料", async (signal, current) => {
            const result = await verified(next => api.deleteProfile(child.id, profile.version, next, userId), signal);
            if (!current()) return;
            setProfile(result); setProfileBasis(result); setProfileDraft(emptyProfile()); setProfileReason(""); setProfileHistory([]); setProfileHistoryOpen(false); setProfileDeleteConfirm(false); onChanged();
            setNotice("孩子資料檔案及歷史已刪除。");
          }, "profile-delete"); }} />
          <Action label="取消刪除" onPress={() => setProfileDeleteConfirm(false)} />
        </View>}
      </View>}
    </View>

    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>照顧時間軸與搜尋</Text>
      <Field label="關鍵字" value={query} onChangeText={setQuery} editable={!busy} />
      <View style={styles.row}>{(["all", ...CARE_KINDS] as const).map(value => <Action key={value} label={`${filterKind === value ? "已選：" : ""}${value === "all" ? "全部種類" : kindName[value]}`} onPress={() => setFilterKind(value)} disabled={!!busy} />)}</View>
      <Action label="搜尋／套用篩選" onPress={() => search()} disabled={!online || !!busy || query.length > 200} />
      {searched && records.length === 0 && <Text style={styles.hint}>{cursor ? "這一頁未找到符合條件的記錄；尚有資料可繼續搜尋。" : "在已掃描的資料中沒有符合條件的記錄。"}</Text>}
      {records.map(item => <View key={item.id} style={styles.record}>
        <Text style={styles.label}>{kindName[item.details.kind]} · 加入時間：{displayTime(item.createdAt)} · 版本 {item.version}</Text>
        <Text style={styles.body}>{item.text}</Text>
        <Text style={styles.hint}>事件時間原文：{item.details.eventTime.rawText || "未提供"}（{item.details.eventTime.precision === "unknown" ? "未知" : item.details.eventTime.precision === "approximate" ? "約數" : "準確"}）</Text>
        {item.details.quantity && <Text style={styles.hint}>數量原文：{item.details.quantity.rawValue} {item.details.quantity.unit}（{item.details.quantity.precision === "exact" ? "準確" : "約數"}）</Text>}
        <Text style={styles.hint}>來源：{item.source}；確認人：{item.confirmedBy}；確認時間：{displayTime(item.confirmedAt)}</Text>
        <View style={styles.row}>
          <Action label="查看更正歷史" onPress={() => loadHistory(item, null)} disabled={!online || !!busy} />
          {canManage && <Action label="更正" onPress={() => selectEdit(item)} disabled={!!busy || !!uncertain || !!conflict} />}
        </View>
      </View>)}
      {cursor && <Action label="繼續搜尋下一頁" onPress={() => search(cursor)} disabled={!online || !!busy} />}
      {historyRecord && <View style={styles.history}>
        <Text style={styles.label}>記錄更正歷史</Text>
        {history.map((item, index) => <Text key={`${item.version}-${index}`} style={styles.body}>版本 {item.version} · 確認人：{item.confirmedBy} · 確認時間：{displayTime(item.confirmedAt)} · {item.text} · 來源：{item.source} · 數量原文：{item.details.quantity ? `${item.details.quantity.rawValue} ${item.details.quantity.unit}（${item.details.quantity.precision === "exact" ? "準確" : "約數"}）` : "未提供"} · 事件時間原文：{item.details.eventTime.rawText || "未提供"} · 原因：{item.reason || "首次確認"}</Text>)}
        {historyCursor !== null && <Action label="載入更早更正" onPress={() => loadHistory(historyRecord, historyCursor)} disabled={!online || !!busy} />}
        <Action label="關閉歷史" onPress={() => { setHistoryRecord(null); setHistory([]); setHistoryCursor(null); }} />
      </View>}
    </View>

    {canManage && <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>{editing ? "更正共享記錄" : "新增共享記錄"}</Text>
      {editing && <Text style={styles.hint}>更正版本 {editing.version} 會留下舊版本及原因，不會刪去原文。</Text>}
      <View style={styles.row}>{CARE_KINDS.map(value => <Action key={value} label={`${kind === value ? "已選：" : ""}${kindName[value]}`} onPress={() => { setKind(value); setCarePreview(false); }} disabled={draftLocked} />)}</View>
      <Field label="記錄原文" value={text} onChangeText={value => { setText(value); setCarePreview(false); }} editable={!draftLocked} multiline />
      <Field label="數量原值（可空）" value={quantityRaw} onChangeText={value => { setQuantityRaw(value); setCarePreview(false); }} editable={!draftLocked} />
      <Field label="數量單位（可空）" value={quantityUnit} onChangeText={value => { setQuantityUnit(value); setCarePreview(false); }} editable={!draftLocked} />
      {(quantityRaw || quantityUnit) && <View style={styles.row}>{(["approximate", "exact"] as const).map(value => <Action key={value} label={`${quantityPrecision === value ? "已選：" : ""}${value === "exact" ? "準確數量" : "約數"}`} onPress={() => { setQuantityPrecision(value); setCarePreview(false); }} disabled={draftLocked} />)}</View>}
      <Field label="事件時間原文（可空）" value={eventRaw} onChangeText={value => { setEventRaw(value); setCarePreview(false); }} editable={!draftLocked} placeholder="例如昨晚約九點；只保存原文，不自動推算日期" />
      <Text style={styles.hint}>有時間原文時標記為約數；留空則為未知。記錄加入時間由 Server 提供。</Text>
      <Field label="資料來源（由你描述）" value={source} onChangeText={value => { setSource(value); setCarePreview(false); }} editable={!draftLocked} />
      {editing && <Field label="更正原因" value={reason} onChangeText={value => { setReason(value); setCarePreview(false); }} editable={!draftLocked} />}
      <Action label="預覽共享記錄" onPress={() => setCarePreview(true)} disabled={!ready || !text.trim() || text.length > 10000 || !source.trim() || source.length > 500 || (!!editing && !reason.trim()) || (!!quantityRaw !== !!quantityUnit) || quantityRaw.length > 100 || quantityUnit.length > 50 || eventRaw.length > 300} />
      {carePreview && <View style={styles.confirmation}>
        <Text style={styles.warning}>將與家庭共享：{kindName[kind]}；原文：{text}；{quantityRaw ? `數量：${quantityRaw} ${quantityUnit}（${quantityPrecision === "exact" ? "準確" : "約數"}）；` : ""}事件時間原文：{eventRaw || "未知"}；來源：{source}{editing ? `；更正原因：${reason}` : ""}。</Text>
        <Action label={editing ? "我已核對，確認共享更正" : "我已核對，確認共享保存"} onPress={saveCare} disabled={!ready} />
        <Action label="取消預覽" onPress={() => setCarePreview(false)} />
      </View>}
      {editing && <>
        <Action label="取消更正" onPress={resetCare} disabled={!!busy || !!uncertain || !!conflict} />
        <Action label="永久刪除這筆記錄及所有歷史" onPress={() => setCareDeleteConfirm(true)} disabled={!ready} />
        {careDeleteConfirm && <View style={styles.confirmation}>
          <Text style={styles.warning}>這會永久刪除整筆照顧記錄及全部更正歷史，不能從歷史復原。</Text>
          <Action label="第二次確認：永久刪除記錄歷史" disabled={!ready} onPress={() => { void run("刪除記錄", async (signal, current) => {
            await verified(next => api.delete(child.id, editing.id, editing.version, next, userId), signal);
            if (!current()) return;
            resetCare(); onChanged(); await reloadAfterConfirmed(signal, current, "記錄及歷史已刪除。");
          }, "care-delete"); }} />
          <Action label="取消刪除" onPress={() => setCareDeleteConfirm(false)} />
        </View>}
      </>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  record: { gap: 5, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  history: { gap: 8, padding: 10, backgroundColor: "#eef5f1", borderRadius: 8 },
  confirmation: { gap: 8, padding: 10, borderWidth: 1, borderColor: "#b88132", borderRadius: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { gap: 4 },
  heading: { fontSize: 20, fontWeight: "700", color: "#183f35" },
  label: { fontSize: 15, fontWeight: "600", color: "#203e35" },
  body: { fontSize: 15, color: "#24352e" },
  hint: { fontSize: 13, color: "#465c52" },
  warning: { fontSize: 14, color: "#80501b" },
  input: { borderWidth: 1, borderColor: "#a8b9b0", borderRadius: 6, padding: 9, backgroundColor: "#fff", color: "#183f35" },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  button: { backgroundColor: "#275e4e", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, alignSelf: "flex-start" },
  buttonText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
