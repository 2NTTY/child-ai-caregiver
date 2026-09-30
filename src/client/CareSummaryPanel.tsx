import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Checkbox, HelperText, PaperProvider, RadioButton, Text, TextInput } from "react-native-paper";
import { CARE_KINDS, type AgeBasis, type CareKind } from "../shared/care.ts";
import {
  preparationInput, summaryQuery, type CareSummary, type PreparationInput, type SummaryQuery,
} from "../shared/care-summary.ts";
import type { CareTask } from "../shared/tasks.ts";
import { CareSummaryApiError, createCareSummaryApi } from "./care-summary-api.ts";

interface Props { apiBaseUrl: string; userId: string; childId: string; online: boolean; onSessionChanged: () => void }
type Draft = Pick<PreparationInput, "appointmentTaskId" | "questions" | "checklist" | "reviewed">;
type DraftBasis = Pick<PreparationInput, "expectedVersion" | "basisVersion" | "period">;
interface Pending { input: PreparationInput; confirmed: boolean; checked: boolean }
type Current = () => boolean;

const kindText: Record<CareKind, string> = {
  note: "備註", feeding: "餵食", sleep: "睡眠", diaper: "尿片", temperature: "體溫", measurement: "量度", appointment: "預約",
};
const ageUnitText = { days: "日", weeks: "週", months: "個月", years: "歲" };
const emptyDraft = (): Draft => ({ appointmentTaskId: null, questions: [], checklist: [], reviewed: false });
const samePeriod = (left: SummaryQuery, right: SummaryQuery) => left.startDay === right.startDay
  && left.period === right.period && left.timeZone === right.timeZone;
const periodText = (value: SummaryQuery) => `${value.startDay} 起${value.period === "day" ? "一日" : "一週"}；${value.timeZone}`;
const dateText = (value: string, timeZone = "Asia/Hong_Kong") =>
  new Date(value).toLocaleString("zh-HK", { timeZone, hour12: false });
function hongKongDay(): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
function ageText(age: AgeBasis | undefined): string {
  if (!age || age.kind === "unknown") return "年齡未記錄";
  if (age.kind === "birth_date") return `出生日期：${age.date}（日期明確）`;
  return `約 ${age.rawValue} ${ageUnitText[age.unit]}；截至 ${age.asOf}（約數年齡）`;
}
const basisFrom = (value: CareSummary): DraftBasis => ({
  expectedVersion: value.preparation.version, basisVersion: value.basisVersion, period: { ...value.period },
});
const draftFrom = (value: CareSummary): Draft => ({
  appointmentTaskId: value.preparation.appointmentTaskId, questions: [...value.preparation.questions],
  checklist: value.preparation.checklist.map(item => ({ ...item })), reviewed: value.preparation.reviewed && value.reviewCurrent,
});
function freezeInput(input: PreparationInput): PreparationInput {
  const copied = JSON.parse(JSON.stringify(input)) as PreparationInput;
  for (const item of copied.checklist) Object.freeze(item);
  Object.freeze(copied.questions); Object.freeze(copied.checklist); Object.freeze(copied.period);
  return Object.freeze(copied);
}

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

function TaskSource({ task }: { task: CareTask }) {
  return <View style={styles.item}>
    <Text variant="titleSmall">{task.title}</Text>
    {!!task.details && <Text>{task.details}</Text>}
    <Text>{task.occurrence.state === "needs_review" ? "待核對，已停催" : "家庭已確認安排，待處理"}；{dateText(task.occurrence.dueAt, task.occurrence.timeZone)}；{task.occurrence.timeZone}</Text>
    <Text>來源任務 {task.id}；版本 {task.version}；事項 {task.occurrence.id}</Text>
    <Text>建立者：{task.createdBy}；負責人：{task.assigneeUserId}；更新：{dateText(task.updatedAt)}</Text>
  </View>;
}

export function CareSummaryPanel(props: Props) {
  return <PaperProvider><SummaryWorkspace key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} /></PaperProvider>;
}

function SummaryWorkspace({ apiBaseUrl, userId, childId, online, onSessionChanged }: Props) {
  const api = useMemo(() => createCareSummaryApi(apiBaseUrl), [apiBaseUrl]);
  const [query, setQuery] = useState<SummaryQuery>(() => ({ startDay: hongKongDay(), period: "day", timeZone: "Asia/Hong_Kong" }));
  const [page, setPage] = useState<CareSummary | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftBasis, setDraftBasis] = useState<DraftBasis | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [sharedConfirmed, setSharedConfirmed] = useState(false);
  const [basisConfirmed, setBasisConfirmed] = useState(false);
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [authorized, setAuthorized] = useState(true);
  const [readFailed, setReadFailed] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const available = online && authorized && !!userId && !!childId;
  const availableRef = useRef(available); availableRef.current = available;
  const refreshRef = useRef<() => void>(() => {});
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;

  const setDraftDirty = (value: boolean) => { dirtyRef.current = value; setDirty(value); };
  const cancelRequests = useCallback(() => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; setBusy("");
  }, []);
  const clearIdentity = () => {
    cancelRequests(); api.resetOnline(); pendingRef.current = null; setPending(null);
    setPage(null); setDraft(emptyDraft()); setDraftBasis(null); setDraftDirty(false);
    setSharedConfirmed(false); setBasisConfirmed(false); setRetryConfirmed(false); setReadFailed(true); setAuthorized(false);
    setNotice("登入帳號或孩子權限已改變，摘要、草稿及待核對操作已清除。請重新選擇孩子。");
    sessionChanged.current();
  };
  const applySummary = (next: CareSummary, replaceDraft = false) => {
    setPage(next); setReadFailed(false); setSharedConfirmed(false); setBasisConfirmed(false); setRetryConfirmed(false);
    if (replaceDraft || !dirtyRef.current) {
      setDraft(draftFrom(next)); setDraftBasis(basisFrom(next)); setDraftDirty(false);
    }
  };
  const updateDraft = (next: Draft, changingReview = false) => {
    setDraft({ ...next, reviewed: changingReview ? next.reviewed : false }); setDraftDirty(true);
    setSharedConfirmed(false); setBasisConfirmed(false);
  };

  const run = async (label: string, operation: (signal: AbortSignal, current: Current) => Promise<void>, entry?: Pending) => {
    if (!availableRef.current || inFlight.current) return;
    inFlight.current = true;
    const started = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    const current = () => availableRef.current && generation.current === started && !controller.signal.aborted;
    setBusy(label); setNotice("");
    try {
      await operation(controller.signal, current);
    } catch (error) {
      const affected = entry ?? pendingRef.current;
      if (affected && pendingRef.current === affected && error instanceof CareSummaryApiError && error.confirmed) affected.confirmed = true;
      if (!current()) return;
      const status = error instanceof CareSummaryApiError ? error.status : 0;
      const code = error instanceof CareSummaryApiError ? error.onlineCode : null;
      if (status === 401 || status === 403 || status === 404 || code === "session_changed") { clearIdentity(); return; }
      setReadFailed(true); setSharedConfirmed(false); setBasisConfirmed(false); setRetryConfirmed(false);
      if (affected && (affected.confirmed || api.hasPendingOnline())) {
        affected.checked = false; setPending({ ...affected });
        setNotice(affected.confirmed ? "原保存操作已確認，最新摘要未能讀取。請查核及重新讀取，毋須再次提交。"
          : "提交結果未能確認。原操作識別、內容及來源版本保留；請先查收據，再明確選擇是否重試。");
      } else {
        pendingRef.current = null; setPending(null);
        setNotice(code === "summary_range_too_large" ? "期間記錄太多，請改用單日摘要；沒有產生部分總計。"
          : code === "summary_scope_too_large" ? "孩子記錄超出此摘要入口上限，沒有產生部分總計；請使用記錄查閱入口。"
          : status === 409 ? "保存出現版本衝突，草稿及原來源版本保留。請更新摘要並核對差異，再明確選擇草稿依據。"
          : entry ? "保存未能確認，草稿保留；目前沒有待查的操作識別。請重新讀取後再確認。"
          : "摘要讀取失敗，現有草稿保留。請手動重新讀取。");
      }
    } finally {
      requests.current.delete(controller);
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  };

  const refresh = () => {
    const entry = pendingRef.current;
    const input = summaryQuery.safeParse(entry?.input.period ?? query);
    if (!input.success) { setNotice("請輸入有效的 YYYY-MM-DD 開始日及 IANA 時區。"); return; }
    void run("讀取", async (signal, current) => {
      if (entry) { entry.checked = false; setPending({ ...entry }); setRetryConfirmed(false); }
      const receipt = await api.reconcilePending(signal, userId);
      if (entry && receipt?.state === "confirmed") entry.confirmed = true;
      const next = await api.summary(childId, input.data, signal, userId);
      if (!current()) return;
      applySummary(next, entry?.confirmed === true);
      if (entry && !entry.confirmed && api.hasPendingOnline()) {
        entry.checked = receipt?.state === "unconfirmed"; setPending({ ...entry });
        setNotice("原操作尚無確認收據，已讀取目前摘要。重試會沿用原內容、原操作識別及原來源版本。");
      } else {
        pendingRef.current = null; setPending(null);
        if (entry) setNotice(entry.confirmed ? "原保存操作已確認，最新摘要及到診準備已讀取。"
          : "目前沒有已建立的待查操作識別。草稿保留，請核對摘要後再明確確認保存。");
      }
    });
  };
  refreshRef.current = refresh;

  useEffect(() => () => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; pendingRef.current = null; api.resetOnline();
  }, [api]);
  useEffect(() => {
    cancelRequests(); setReadFailed(true); setSharedConfirmed(false); setBasisConfirmed(false); setRetryConfirmed(false);
    const entry = pendingRef.current;
    if (entry) { entry.checked = false; setPending({ ...entry }); }
    if (available) refreshRef.current();
  }, [available, cancelRequests]);

  const ready = available && !!page && !busy && !pending && !readFailed && !api.hasPendingOnline();
  const editable = ready && page?.canManage === true;
  const staleBasis = !!page && !!draftBasis && (draftBasis.expectedVersion !== page.preparation.version
    || draftBasis.basisVersion !== page.basisVersion || !samePeriod(draftBasis.period, page.period));
  const appointmentValid = draft.appointmentTaskId === null || !!page?.appointments.some(task => task.id === draft.appointmentTaskId);
  const parsedDraft = draftBasis ? preparationInput.safeParse({ ...draft, ...draftBasis, confirmShared: true }) : null;
  const canRetry = available && !busy && !readFailed && !!page?.canManage && !!pending?.checked
    && !pending.confirmed && api.hasPendingOnline();
  const queryValid = summaryQuery.safeParse(query).success;

  const save = (retry = false) => {
    if (!available || !page?.canManage || inFlight.current || readFailed) return;
    let entry: Pending;
    if (retry) {
      const original = pendingRef.current;
      if (!original || original.confirmed || !original.checked || !retryConfirmed || !api.hasPendingOnline()) return;
      entry = original;
    } else {
      if (!editable || !sharedConfirmed || staleBasis || !appointmentValid || !parsedDraft?.success) return;
      entry = { input: freezeInput(parsedDraft.data), confirmed: false, checked: false };
    }
    entry.checked = false; pendingRef.current = entry; setPending({ ...entry }); setRetryConfirmed(false); setDraftDirty(true);
    void run("保存", async (signal, current) => {
      await api.savePreparation(childId, entry.input, signal, userId);
      entry.confirmed = true;
      if (!current()) return;
      const next = await api.summary(childId, entry.input.period, signal, userId);
      if (!current()) return;
      applySummary(next, true); pendingRef.current = null; setPending(null);
      setNotice("家庭共享到診準備已保存，摘要已重新讀取。核對是否仍與來源吻合，請看 Server 核對狀態。");
    }, entry);
  };

  return <View style={styles.section}>
    <Text variant="titleLarge" accessibilityRole="header">家庭照護摘要及到診準備</Text>
    <Text>摘要只整理已確認的家庭記錄，數字由 Server 計算。未有記錄不等於事情沒有發生。</Text>
    <View style={styles.group}>
      <TextInput mode="outlined" label="開始日（YYYY-MM-DD）" value={query.startDay} maxLength={10}
        editable={!busy && !pending} onChangeText={value => setQuery({ ...query, startDay: value })} />
      <RadioButton.Group value={query.period} onValueChange={value => setQuery({ ...query, period: value as SummaryQuery["period"] })}>
        <RadioButton.Item label="一日摘要" value="day" disabled={!!busy || !!pending} />
        <RadioButton.Item label="一週摘要" value="week" disabled={!!busy || !!pending} />
      </RadioButton.Group>
      <TextInput mode="outlined" label="IANA 時區" value={query.timeZone} maxLength={80} placeholder="Asia/Hong_Kong"
        editable={!busy && !pending} onChangeText={value => setQuery({ ...query, timeZone: value })} />
      {!queryValid && <HelperText type="error">開始日須為有效日期，時區須為有效 IANA 名稱。</HelperText>}
      <Button mode="outlined" disabled={!available || !!busy || !pending && !queryValid} onPress={refresh}>
        {busy === "讀取" ? "正在讀取…" : pending ? "先查原收據及更新摘要" : "產生／更新摘要（保留草稿）"}
      </Button>
      {page && !samePeriod(query, page.period) && <Text>目前顯示的是已產生的期間：{periodText(page.period)}。以上選項尚未套用。</Text>}
    </View>
    {!online && <Text>目前離線，摘要可能已過時；本頁草稿及原操作保留。關閉頁面會失去未保存草稿。</Text>}
    {!authorized && <Text>請重新登入或選擇有權讀取的孩子。</Text>}
    {page && readFailed && online && <Text>目前摘要尚未重新核對，暫停保存。請手動更新摘要。</Text>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {authorized && pending && <View style={styles.group}>
      <Text variant="titleMedium">待核對原保存操作</Text>
      <Text>原共享準備版本 {pending.input.expectedVersion}；原摘要依據 {pending.input.basisVersion}；{periodText(pending.input.period)}</Text>
      <Text>原預約：{pending.input.appointmentTaskId ?? "沒有指定"}；核對標記：{pending.input.reviewed ? "已核對" : "未核對"}</Text>
      {pending.input.questions.map((question, index) => <Text key={index}>原問題 {index + 1}：{question}</Text>)}
      {pending.input.checklist.map((item, index) => <Text key={index}>原清單 {index + 1}：{item.done ? "已完成" : "未完成"}；{item.text}</Text>)}
      {pending.confirmed && <Text>Server 已確認原操作；更新摘要後才可開始其他保存。</Text>}
      {canRetry && <>
        <Text>已先查原收據。明確重試會保留原 opId、內容及版本；來源有變時 Server 會拒絕舊依據。</Text>
        <Confirmation label="我已核對目前摘要，確認以原操作識別及原內容重試" checked={retryConfirmed} disabled={!!busy}
          onToggle={() => setRetryConfirmed(value => !value)} />
        <Button mode="contained" disabled={!retryConfirmed || !!busy} onPress={() => save(true)}>以原操作明確重試</Button>
      </>}
    </View>}
    {authorized && page && <>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">{page.childName}</Text>
        <Text>孩子 {page.childId}；{ageText(page.profile.data?.age)}</Text>
        <Text>孩子檔案版本 {page.profile.version}；來源：{page.profile.data?.source || "未記錄"}</Text>
        {page.profile.confirmedAt && <Text>檔案確認：{page.profile.confirmedBy}；{dateText(page.profile.confirmedAt)}；原因：{page.profile.reason || "未記錄"}</Text>}
        <Text>期間：{page.period.startDay} 至 {page.endDayExclusive}（不包括結束日）；{page.period.timeZone}</Text>
        <Text>生成：{dateText(page.generatedAt, page.period.timeZone)}；依據版本 {page.basisVersion}</Text>
        <Text>更正記錄後，請更新摘要以讀取新來源版本。</Text>
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">記錄數量及數值</Text>
        {CARE_KINDS.map(kind => <Text key={kind}>{kindText[kind]}：{page.counts[kind]} 筆</Text>)}
        {page.metrics.length === 0 && <Text>此期間沒有可列出的數值統計。</Text>}
        {page.metrics.map((metric, index) => <View key={index} style={styles.item}>
          <Text>{kindText[metric.kind]}；單位 {metric.unit}；樣本 {metric.samples}；其中約數 {metric.approximate}</Text>
          <Text>合計：{metric.total ?? "未提供"}；最小：{metric.min}；最大：{metric.max}</Text>
          <Text>來源記錄：{metric.recordIds.join("、")}</Text>
        </View>)}
        <Text>整個孩子已掃描記錄中，事件時間未知：{page.missing.unknownEventTime} 筆。此數量不是本日／本週的缺漏數。</Text>
        <Text>未能納入數值統計的數量：{page.missing.invalidQuantities}。</Text>
        <Text>本期間沒有記錄的種類：{page.missing.emptyKinds.map(kind => kindText[kind]).join("、") || "沒有"}。未記錄不等於未發生。</Text>
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">原始記錄及更正來源</Text>
        {page.records.length === 0 && <Text>本期間沒有已列出的記錄。</Text>}
        {page.records.map(record => <View key={record.id} style={styles.item}>
          <Text variant="titleSmall">{kindText[record.details.kind]}；記錄 {record.id}；版本 {record.version}</Text>
          <Text>{record.text}</Text>
          <Text>事件時間原文：{record.details.eventTime.rawText || "未記錄"}；精度：{record.details.eventTime.precision === "exact" ? "明確" : record.details.eventTime.precision === "approximate" ? "約數" : "未知"}</Text>
          <Text>事件時間：{record.details.eventTime.at ?? "未知"}；時區：{record.details.eventTime.timeZone}</Text>
          {record.details.quantity && <Text>數值原文：{record.details.quantity.rawValue} {record.details.quantity.unit}（{record.details.quantity.precision === "approximate" ? "約數" : "明確"}）</Text>}
          <Text>來源：{record.source}；確認／更正原因：{record.reason}</Text>
          <Text>確認者：{record.confirmedBy}；確認：{dateText(record.confirmedAt)}；建立：{dateText(record.createdAt)}</Text>
        </View>)}
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">家庭已確認預約安排</Text>
        <Text>這些是家庭台帳中確認的安排，不代表醫療機構已確認預約。</Text>
        {page.appointments.length === 0 && <Text>目前沒有列出的待處理預約。</Text>}
        {page.appointments.map(task => <TaskSource key={task.id} task={task} />)}
        <Text variant="titleMedium" accessibilityRole="header">待核對任務</Text>
        {page.conflicts.length === 0 && <Text>目前沒有列出的待核對任務。</Text>}
        {page.conflicts.map(task => <TaskSource key={task.id} task={task} />)}
      </View>
      <View style={styles.group}>
        <Text variant="titleMedium" accessibilityRole="header">家庭共享到診準備</Text>
        <Text>問題及清單會與有權讀取這個孩子的家庭成員共享。owner／caregiver 可保存，viewer 只可檢視。</Text>
        {!page.canManage && <Text>你目前只有檢視權限。</Text>}
        <Text>已保存版本 {page.preparation.version}；標記：{page.preparation.reviewed ? "曾標記已核對" : "未核對"}。</Text>
        <Text>已保存預約：{page.preparation.appointmentTaskId
          ? page.appointments.find(task => task.id === page.preparation.appointmentTaskId)?.title ?? page.preparation.appointmentTaskId
          : "沒有指定"}</Text>
        <Text>Server 核對狀態：{page.reviewCurrent ? "仍與全部來源吻合" : "未核對或來源已變，須重新核對"}。</Text>
        <Text>已保存核對依據：{page.preparation.reviewedBasis ?? "沒有"}；已保存期間：{page.preparation.period ? periodText(page.preparation.period) : "沒有"}</Text>
        {page.preparation.updatedAt && <Text>最後保存：{page.preparation.updatedBy}；{dateText(page.preparation.updatedAt)}</Text>}
        {draftBasis && <Text>本頁草稿依據：共享準備版本 {draftBasis.expectedVersion}；摘要 {draftBasis.basisVersion}；{periodText(draftBasis.period)}</Text>}
        {dirty && <Text>本頁有未保存草稿；更新摘要會保留內容及原依據。</Text>}
        {dirty && <View style={styles.item}>
          <Text variant="titleSmall">目前已保存內容，供核對家庭成員的最新修改</Text>
          {page.preparation.questions.length === 0 && <Text>已保存內容沒有到診問題。</Text>}
          {page.preparation.questions.map((question, index) => <Text key={index}>已保存問題 {index + 1}：{question}</Text>)}
          {page.preparation.checklist.length === 0 && <Text>已保存內容沒有準備項目。</Text>}
          {page.preparation.checklist.map((item, index) => <Text key={index}>已保存項目 {index + 1}：{item.done ? "已完成" : "未完成"}；{item.text}</Text>)}
        </View>}
        {staleBasis && <>
          <Text>草稿與目前摘要／共享準備版本不同，不能直接保存。請核對上述來源及家庭成員的最新修改。</Text>
          <Confirmation label="我已核對最新來源及共享準備，保留本頁草稿並改用目前摘要依據"
            checked={basisConfirmed} disabled={!editable} onToggle={() => setBasisConfirmed(value => !value)} />
          <Button mode="outlined" disabled={!editable || !basisConfirmed} onPress={() => {
            setDraftBasis(basisFrom(page)); setDraft({ ...draft, reviewed: false }); setDraftDirty(true);
            setSharedConfirmed(false); setBasisConfirmed(false);
          }}>確認改用目前摘要依據</Button>
        </>}
        <RadioButton.Group value={draft.appointmentTaskId ?? ""} onValueChange={value => updateDraft({ ...draft, appointmentTaskId: value || null })}>
          <RadioButton.Item label="沒有指定預約" value="" disabled={!editable} />
          {page.appointments.map(task => <RadioButton.Item key={task.id}
            label={`${task.title}；${dateText(task.occurrence.dueAt, task.occurrence.timeZone)}`} value={task.id} disabled={!editable} />)}
        </RadioButton.Group>
        {!appointmentValid && <HelperText type="error">草稿保留的預約 {draft.appointmentTaskId} 已不在目前待處理預約清單。請明確另選預約或選「沒有指定」。</HelperText>}
        <Text variant="titleSmall">到診問題（最多 12 條）</Text>
        {draft.questions.length === 0 && <Text>尚未記錄問題。</Text>}
        {draft.questions.map((question, index) => <View key={index} style={styles.item}>
          <TextInput mode="outlined" label={`問題 ${index + 1}`} value={question} multiline maxLength={500} editable={editable}
            onChangeText={value => updateDraft({ ...draft, questions: draft.questions.map((item, position) => position === index ? value : item) })} />
          <Button mode="text" disabled={!editable} onPress={() => updateDraft({ ...draft, questions: draft.questions.filter((_, position) => position !== index) })}>移除問題 {index + 1}</Button>
        </View>)}
        <Button mode="outlined" disabled={!editable || draft.questions.length >= 12} onPress={() => updateDraft({ ...draft, questions: [...draft.questions, ""] })}>新增問題</Button>
        <Text variant="titleSmall">準備清單（最多 16 項）</Text>
        {draft.checklist.length === 0 && <Text>尚未記錄準備項目。</Text>}
        {draft.checklist.map((item, index) => <View key={index} style={styles.item}>
          <TextInput mode="outlined" label={`準備項目 ${index + 1}`} value={item.text} multiline maxLength={300} editable={editable}
            onChangeText={value => updateDraft({ ...draft, checklist: draft.checklist.map((entry, position) => position === index ? { ...entry, text: value } : entry) })} />
          <Confirmation label={`準備項目 ${index + 1} 已完成`} checked={item.done} disabled={!editable}
            onToggle={() => updateDraft({ ...draft, checklist: draft.checklist.map((entry, position) => position === index ? { ...entry, done: !entry.done } : entry) })} />
          <Button mode="text" disabled={!editable} onPress={() => updateDraft({ ...draft, checklist: draft.checklist.filter((_, position) => position !== index) })}>移除準備項目 {index + 1}</Button>
        </View>)}
        <Button mode="outlined" disabled={!editable || draft.checklist.length >= 16} onPress={() => updateDraft({ ...draft, checklist: [...draft.checklist, { text: "", done: false }] })}>新增準備項目</Button>
        {parsedDraft && !parsedDraft.success && <HelperText type="error">問題及準備項目不能留空；問題最多 500 字，清單項目最多 300 字。</HelperText>}
        <Confirmation label="我已逐項核對以上問題、準備清單及目前摘要來源，標記為已核對"
          checked={draft.reviewed} disabled={!editable || staleBasis} onToggle={() => updateDraft({ ...draft, reviewed: !draft.reviewed }, true)} />
        <Confirmation label="我確認把以上到診問題、清單、預約及核對標記與家庭共享"
          checked={sharedConfirmed} disabled={!editable || staleBasis} onToggle={() => setSharedConfirmed(value => !value)} />
        <Button mode="contained" disabled={!editable || !sharedConfirmed || staleBasis || !appointmentValid || !parsedDraft?.success}
          onPress={() => save()}>{busy === "保存" ? "正在保存…" : "確認保存家庭共享到診準備"}</Button>
        {dirty && <Button mode="text" disabled={!ready} onPress={() => {
          setDraft(draftFrom(page)); setDraftBasis(basisFrom(page)); setDraftDirty(false);
          setSharedConfirmed(false); setBasisConfirmed(false);
        }}>放棄本頁草稿並載入已保存準備</Button>}
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, padding: 16, borderWidth: 1, borderColor: "#d6dfdc", borderRadius: 10, marginTop: 20 },
  group: { gap: 8, padding: 12, backgroundColor: "#f7faf8", borderRadius: 8 },
  item: { gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1e8e4" },
  confirmation: { flexDirection: "row", alignItems: "center", gap: 4 },
  confirmationLabel: { flex: 1 },
});
