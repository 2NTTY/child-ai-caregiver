import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { growthActionSchema, growthTopicActionSchema, type GrowthAction, type GrowthAttention,
  type GrowthPage, type GrowthTopic, type GrowthTopicAction } from "../shared/growth.ts";
import type { TaskValues } from "../shared/tasks.ts";
import { createGrowthApi, GrowthApiError, requiresFreshGrowthConfirmation } from "./growth-api.ts";
import { ONLINE_REFRESH_EVENT } from "./use-online-updates.ts";

interface Props {
  apiBaseUrl: string; userId: string; childId: string; online: boolean; refreshVersion?: number; onOpenTask?: (taskId: string) => void;
}
type Attempt = { kind: "item"; id: string; body: string; label: string; assigneeLabel?: string } | { kind: "topic"; id: GrowthTopic["id"]; body: string; label: string; contextSummary?: string[] };
interface UnknownWrite { attempt: Attempt; reviewed: boolean; reconfirm: boolean; reason: string | null }
const stateText: Record<GrowthAttention["state"], string> = {
  proposed: "待確認", snoozed: "已延後", accepted: "已接受", dismissed: "已關閉", inapplicable: "目前不適用",
};
const kindText: Record<GrowthAttention["kind"], string> = { observe: "觀察", arrange: "安排", consult: "諮詢" };
const taskStateText = { scheduled: "待處理", completed: "已完成", cancelled: "已取消", needs_review: "待覆核，已停催" };
const actionable = (item: GrowthAttention) => item.sourceAvailable && (item.state === "proposed" || item.state === "snoozed");
const accessLost = (error: unknown) => error instanceof GrowthApiError
  && ([401, 403, 404].includes(error.status) || ["session_changed", "unauthorized", "not_found"].includes(error.code ?? ""));
const growthErrorText: Partial<Record<NonNullable<GrowthApiError["code"]>, string>> = {
  growth_changed: "關注、來源或適用依據已改變，請讀取最新資料及核對。",
  growth_fact_requires_review: "這項近況已有需要覆核的記憶，請到記憶區核對及更正，再重新讀取。",
  growth_history_requires_review: "同一依據已有需要覆核的歷史，請先核對舊關注；不會重新啟動已關閉紀錄。",
  growth_existing_task_requires_review: "這項關注已連結待處理或待覆核任務，請先到任務區核對；不能直接另建任務。",
};
function dateTime(value: string): string { return new Date(value).toLocaleString("zh-HK", { hour12: false }); }
function safeHttps(value: string): string | null {
  try {
    if (/[\u0000-\u0020\u007f]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Confirmation({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={[styles.row, disabled && styles.disabled]}
    {...(Platform.OS === "web" ? { "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      } } : {})}>
    <Text style={styles.body}>{checked ? "☑" : "☐"} {label}</Text>
  </Pressable>;
}
function Choice({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
    disabled={disabled} onPress={onPress} style={[styles.choice, selected && styles.selected, disabled && styles.disabled]}>
    <Text style={styles.body}>{selected ? "●" : "○"} {label}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, disabled, placeholder, multiline = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean; placeholder?: string; multiline?: boolean; maxLength?: number;
}) {
  return <View style={styles.stack}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} placeholder={placeholder}
      multiline={multiline} maxLength={maxLength} style={[styles.input, multiline && styles.multiline, disabled && styles.disabled]} />
  </View>;
}
function OriginalDetails({ attempt }: { attempt: Attempt }) {
  if (attempt.kind === "item") {
    const input = JSON.parse(attempt.body) as GrowthAction;
    return <View style={styles.stack}>
      <Text style={styles.label}>{attempt.label}；原版本 {input.expectedVersion}</Text>
      {input.action === "snooze" && <Text style={styles.body}>原延後時間：{input.until}</Text>}
      {input.action === "dismiss" && <Text selectable style={styles.body}>原備註：{input.note || "沒有備註"}</Text>}
      {input.action === "accept" && (input.task.kind === "none" ? <Text style={styles.body}>原決定：只記錄已知悉，不建立任務。</Text>
        : input.task.kind === "existing" ? <Text selectable style={styles.body}>原連結任務：{input.task.id}；版本 {input.task.expectedVersion}</Text>
          : <View style={styles.stack}>
            <Text style={styles.body}>原建立任務：{input.task.values.title}</Text>
            <Text selectable style={styles.body}>{input.task.values.details || "沒有詳細內容"}</Text>
            <Text style={styles.body}>原時間：{input.task.values.dueAt}；時區：{input.task.values.timeZone}</Text>
            <Text selectable style={styles.hint}>原負責人：{attempt.assigneeLabel ?? input.task.values.assigneeUserId}</Text>
          </View>)}
    </View>;
  }
  const input = JSON.parse(attempt.body) as GrowthTopicAction;
  return <View style={styles.stack}>
    <Text style={styles.label}>{attempt.label}；原版本 {input.expectedVersion}</Text>
    {input.action === "set_enabled" ? <Text style={styles.body}>原決定：{input.enabled ? "重新啟用主題" : "永久停用主題"}</Text>
      : (attempt.contextSummary ?? Object.entries(input.values).map(([key, value]) => key + " = " + value)).map((value, index) => <Text key={index} selectable style={styles.body}>原確認近況：{value}</Text>)}
  </View>;
}
function AttentionCard({ item, page, locked, onDirty, onSubmit, onOpenSource, onOpenTask }: {
  item: GrowthAttention; page: GrowthPage; locked: boolean; onDirty: (key: string) => void;
  onSubmit: (item: GrowthAttention, input: GrowthAction) => void; onOpenSource: (url: string) => void; onOpenTask?: (taskId: string) => void;
}) {
  const [taskMode, setTaskMode] = useState<"none" | "create">("none");
  const [values, setValues] = useState<TaskValues>({ title: item.title, details: item.advice, kind: "ordinary",
    assigneeUserId: "", dueAt: "", timeZone: "Asia/Hong_Kong" });
  const [taskShared, setTaskShared] = useState(false);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftBasis, setDraftBasis] = useState<{ item: GrowthAttention; authorityVersion: string } | null>(null);
  const basis = draftBasis ?? { item, authorityVersion: page.authorityVersion };
  const basisChanged = !!draftBasis && (draftBasis.item.version !== item.version || draftBasis.authorityVersion !== page.authorityVersion);
  useEffect(() => {
    if (!draftBasis) setValues({ title: item.title, details: item.advice, kind: "ordinary",
      assigneeUserId: "", dueAt: "", timeZone: "Asia/Hong_Kong" });
  }, [item.version, page.authorityVersion]);
  const disabled = locked || basisChanged || !actionable(item) || !!page.topics.find(topic => topic.id === item.topicId)?.disabled;
  const url = safeHttps(item.source.url);
  function markDraft() {
    if (!draftBasis) setDraftBasis({ item, authorityVersion: page.authorityVersion });
    onDirty("item:" + item.id);
  }
  function editValues(change: Partial<TaskValues>) {
    markDraft(); setValues(previous => ({ ...previous, ...change })); setTaskShared(false); setError(null);
  }
  function submit(input: GrowthAction) {
    if (disabled) return;
    const parsed = growthActionSchema.safeParse(input);
    if (!parsed.success) { setError("請核對所有欄位、ISO 日期時間及時區；任務標題不能留空。"); return; }
    if (input.action === "accept" && input.task.kind === "create") {
      const taskValues = input.task.values;
      if (!taskShared || !page.eligibleAssignees.some(assignee => assignee.userId === taskValues.assigneeUserId)) {
        setError("請選擇目前合資格的家庭負責人，並明確確認建立共享任務。"); return;
      }
    }
    if (input.action === "snooze" && Date.parse(input.until) <= Date.now()) { setError("請填寫將來的明確延後時間。"); return; }
    setError(null); onSubmit(basis.item, parsed.data);
  }
  return <View style={styles.box}>
    <Text accessibilityRole="header" style={styles.label}>{item.title} · {kindText[item.kind]}</Text>
    <Text style={styles.label}>狀態：{stateText[item.state]}；版本 {item.version}</Text>
    <Text selectable style={styles.body}>產生當時原因：{item.whyNow}</Text>
    {item.sourceAvailable ? <View style={styles.stack}>
      <Text selectable style={styles.body}>建議：{item.advice}</Text>
      <Text selectable style={styles.warning}>適用限制：{item.limits}</Text>
    </View> : <View style={styles.stack}>
      <Text style={styles.warning}>原來源或適用依據已改變／暫不可用。這項關注只保留作歷史紀錄，現時不能按舊建議處理；以下來源片段供追溯。</Text>
      <Text selectable style={styles.hint}>產生當時的適用限制：{item.limits}</Text>
    </View>}
    {!!item.newReason && <Text selectable style={styles.hint}>新關注原因：{item.newReason}</Text>}
    {item.previousId && <Text selectable style={styles.hint}>之前關注的識別：{item.previousId}；舊紀錄的終態不會因此重新啟動。</Text>}
    {item.snoozeUntil && <Text style={styles.hint}>延後至：{dateTime(item.snoozeUntil)}</Text>}
    {!!item.note && <Text selectable style={styles.body}>處理備註：{item.note}</Text>}
    <Text style={styles.hint}>建立：{dateTime(item.createdAt)}；最後更新：{dateTime(item.updatedAt)}</Text>
    <View style={styles.source}>
      <Text style={styles.label}>來源：{item.source.title} · {item.source.section}</Text>
      <Text selectable style={styles.body}>{item.source.excerpt}</Text>
      <Text style={styles.hint}>核對時間：{dateTime(item.source.checkedAt)}</Text>
      <Text selectable style={styles.hint}>來源版本：{item.source.versionId}</Text>
      {url ? <Action label="開啟 HTTPS 來源" onPress={() => onOpenSource(url)} />
        : <Text style={styles.warning}>來源連結未能通過 HTTPS 核對，不能開啟。</Text>}
    </View>
    {item.taskId && <View style={styles.stack}>
      <Text selectable style={styles.body}>已連結任務：{item.taskId}</Text>
      <Text style={styles.body}>讀取當時的任務狀態：{item.taskState === null ? "未能確認；請到任務區重新核對" : taskStateText[item.taskState]}</Text>
      {onOpenTask ? <Action label="查看連結任務" onPress={() => onOpenTask(item.taskId!)} />
        : <Text style={styles.hint}>請到任務區按此識別核對最新任務及負責人。</Text>}
      <Text style={styles.hint}>來源狀態改變不代表任務已取消；接受關注也不代表已預約或完成。</Text>
    </View>}
    {item.state === "accepted" && !item.taskId && <Text style={styles.hint}>已接受並記錄知悉，沒有連結任務；不代表已預約或完成任何工作。</Text>}
    {basisChanged && <Text style={styles.warning}>關注或授權版本已改變，已保留原版本的草稿並停止提交。請核對最新內容，再使用上方「放棄草稿並重新核對」明確重置。</Text>}
    {page.canManage && (actionable(item) || !!draftBasis) && <View style={styles.stack}>
      <Text style={styles.label}>接受後如何處理</Text>
      <View style={styles.row}>
        <Choice label="只記錄已知悉" selected={taskMode === "none"} disabled={disabled} onPress={() => { markDraft(); setTaskMode("none"); setTaskShared(false); }} />
        <Choice label="建立待處理任務" selected={taskMode === "create"} disabled={disabled} onPress={() => { markDraft(); setTaskMode("create"); setTaskShared(false); }} />
      </View>
      {taskMode === "create" && <View style={styles.stack}>
        <Field label="任務標題" value={values.title} onChange={title => editValues({ title })} disabled={disabled} maxLength={160} />
        <Field label="任務內容" value={values.details} onChange={details => editValues({ details })} disabled={disabled} multiline maxLength={2000} />
        <View style={styles.row}>
          <Choice label="普通任務" selected={values.kind === "ordinary"} disabled={disabled} onPress={() => editValues({ kind: "ordinary" })} />
          <Choice label="預約任務" selected={values.kind === "appointment"} disabled={disabled} onPress={() => editValues({ kind: "appointment" })} />
        </View>
        <Text style={styles.label}>任務負責人</Text>
        {page.eligibleAssignees.map(assignee => <Choice key={assignee.userId} label={assignee.name} selected={values.assigneeUserId === assignee.userId}
          disabled={disabled} onPress={() => editValues({ assigneeUserId: assignee.userId })} />)}
        {page.eligibleAssignees.length === 0 && <Text style={styles.warning}>目前沒有合資格的負責人，不能建立任務。</Text>}
        <Field label="到期日期時間（ISO，含時差）" value={values.dueAt} onChange={dueAt => editValues({ dueAt })} disabled={disabled}
          placeholder="2026-10-01T09:00:00+08:00" />
        <Field label="任務時區" value={values.timeZone} onChange={timeZone => editValues({ timeZone })} disabled={disabled} placeholder="Asia/Hong_Kong" />
        <Text style={styles.hint}>只會建立家庭共享的待處理任務；預約任務不代表已向機構預約。</Text>
        <Confirmation label="我已核對時間及負責人，明確同意建立家庭共享任務" checked={taskShared} disabled={disabled} onToggle={() => { markDraft(); setTaskShared(value => !value); }} />
      </View>}
      <Action label={taskMode === "none" ? "明確接受關注並記錄知悉" : "明確接受關注並建立共享任務"}
        disabled={disabled || (taskMode === "create" && (!taskShared || !page.eligibleAssignees.length))}
        onPress={() => submit({ action: "accept", authorityVersion: basis.authorityVersion, expectedVersion: basis.item.version, confirm: true,
          task: taskMode === "none" ? { kind: "none" } : { kind: "create", values } })} />
      <Field label="延後至（ISO 日期時間，含時差）" value={until} onChange={value => { markDraft(); setUntil(value); setError(null); }} disabled={disabled}
        placeholder="2026-10-08T09:00:00+08:00" />
      <Action label="明確延後這項關注" disabled={disabled || !until}
        onPress={() => submit({ action: "snooze", authorityVersion: basis.authorityVersion, expectedVersion: basis.item.version, confirm: true, until })} />
      <Field label="關閉備註（可留空）" value={note} onChange={value => { markDraft(); setNote(value); setError(null); }} disabled={disabled} multiline maxLength={1000} />
      <Text style={styles.hint}>關閉後，同一階段及同一依據不再催辦；如有新的關注，會另列原因。永久停用請使用下方主題設定。</Text>
      <Action label="明確關閉這項關注" disabled={disabled}
        onPress={() => submit({ action: "dismiss", authorityVersion: basis.authorityVersion, expectedVersion: basis.item.version, confirm: true, note })} />
      {error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
    </View>}
  </View>;
}
function TopicCard({ topic, authorityVersion, locked, canManage, onDirty, onSubmit }: {
  topic: GrowthTopic; authorityVersion: string; locked: boolean; canManage: boolean; onDirty: (key: string) => void;
  onSubmit: (topic: GrowthTopic, input: GrowthTopicAction) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sharedConfirmed, setSharedConfirmed] = useState(false);
  const [enabledConfirmed, setEnabledConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBasis, setDraftBasis] = useState<{ topic: GrowthTopic; authorityVersion: string } | null>(null);
  const basis = draftBasis ?? { topic, authorityVersion };
  const factBasis = (value: GrowthTopic) => JSON.stringify(value.inputs.map(input => [input.key, input.factRefs]));
  const basisChanged = !!draftBasis && (draftBasis.topic.version !== topic.version || draftBasis.authorityVersion !== authorityVersion
    || factBasis(draftBasis.topic) !== factBasis(topic));
  const disabled = locked || basisChanged;
  const hasConflict = topic.inputs.some(input => input.conflict);
  const selected = basis.topic.inputs.filter(input => !input.conflict && !!values[input.key]
    && input.choices.some(choice => choice.value === values[input.key]));
  function markDraft() {
    if (!draftBasis) setDraftBasis({ topic, authorityVersion });
    onDirty("topic:" + topic.id);
  }
  function choose(key: string, value: string) {
    markDraft(); setValues(previous => ({ ...previous, [key]: value })); setSharedConfirmed(false); setError(null);
  }
  function confirmContext() {
    if (disabled || !canManage || hasConflict || !sharedConfirmed || !selected.length) return;
    const references = new Map<string, { id: string; version: number }>();
    for (const input of basis.topic.inputs) for (const reference of input.factRefs) {
      if (references.has(reference.id) && references.get(reference.id)!.version !== reference.version) {
        setError("已確認資料的版本不一致，請先重新讀取。"); return;
      }
      references.set(reference.id, { ...reference });
    }
    const parsed = growthTopicActionSchema.safeParse({ action: "confirm_context", authorityVersion: basis.authorityVersion,
      expectedVersion: basis.topic.version, confirm: true,
      values: Object.fromEntries(selected.map(input => [input.key, values[input.key]])),
      expectedFacts: Array.from(references.values()).sort((first, second) => first.id.localeCompare(second.id)), confirmShared: true });
    if (!parsed.success) { setError("未能核對這份共享近況，請重新讀取並至少選擇一項要確認的資料。"); return; }
    setError(null); onSubmit(basis.topic, parsed.data);
  }
  return <View style={styles.box}>
    <Text accessibilityRole="header" style={styles.label}>{topic.title}</Text>
    <Text style={styles.body}>主題：{topic.disabled ? "已永久停用" : "已啟用"}；版本 {topic.version}</Text>
    <Text style={styles.hint}>只保存這次明確選擇的近況，未選欄位保持原狀。資料會供所有獲授權家庭成員查看，保存前需要明確同意共享。</Text>
    {basisChanged && <Text style={styles.warning}>主題、已確認資料或授權版本已改變，原選擇及版本仍保留。請核對最新內容，再使用上方「放棄草稿並重新核對」明確重置。</Text>}
    {hasConflict && <Text style={styles.warning}>已有近況出現衝突，請到記憶區核對及覆核，之後重新讀取。此處選擇不會解決既有記憶衝突。</Text>}
    {topic.inputs.map(input => <View key={input.key} style={styles.stack}>
      <Text style={styles.label}>{input.label}</Text>
      <Text style={styles.hint}>目前已確認：{input.conflict ? "資料有衝突，請到記憶區覆核"
        : input.choices.find(choice => choice.value === input.value)?.label ?? "尚未確認"}</Text>
      {canManage && <>
        <Choice label="這次不確認此項" selected={!values[input.key]} disabled={disabled || input.conflict}
          onPress={() => choose(input.key, "")} />
        {input.choices.map(choice => <Choice key={choice.value} label={choice.label} selected={values[input.key] === choice.value}
          disabled={disabled || input.conflict} onPress={() => choose(input.key, choice.value)} />)}
      </>}
    </View>)}
    {canManage && <>
      {!!topic.inputs.length && <View style={styles.stack}>
        {!selected.length && <Text style={styles.hint}>至少明確選擇一項要確認的近況；不知道的欄位可以留空。</Text>}
        <Confirmation label="我已核對這次選擇的近況，明確同意保存為所有獲授權家庭成員可見的已確認資料"
          checked={sharedConfirmed} disabled={disabled || hasConflict || !selected.length}
          onToggle={() => { markDraft(); setSharedConfirmed(value => !value); }} />
        <Action label="明確保存所選家庭共享近況" disabled={disabled || hasConflict || !selected.length || !sharedConfirmed} onPress={confirmContext} />
        {error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
      </View>}
      <View style={styles.stack}>
        <Confirmation label={topic.disabled ? "我明確同意重新啟用這個主題" : "我明確同意永久停用這個主題，之後不再產生此主題的關注"}
          checked={enabledConfirmed} disabled={disabled} onToggle={() => { markDraft(); setEnabledConfirmed(value => !value); }} />
        <Action label={topic.disabled ? "明確重新啟用主題" : "明確永久停用主題"} disabled={disabled || !enabledConfirmed}
          onPress={() => onSubmit(basis.topic, { action: "set_enabled", authorityVersion: basis.authorityVersion,
            enabled: basis.topic.disabled, expectedVersion: basis.topic.version, confirm: true })} />
        <Text style={styles.hint}>重新啟用會重新核對適用性；已關閉的舊紀錄保持原終態。</Text>
      </View>
    </>}
  </View>;
}
export function GrowthPanel(props: Props) {
  return <GrowthContents key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} />;
}
function GrowthContents({ apiBaseUrl, userId, childId, online, refreshVersion = 0, onOpenTask }: Props) {
  const api = useMemo(() => createGrowthApi(apiBaseUrl), [apiBaseUrl]);
  const [page, setPage] = useState<GrowthPage | null>(null);
  const [busy, setBusy] = useState<"read" | "write" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<UnknownWrite | null>(null);
  const [originalConfirmed, setOriginalConfirmed] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [resetCounts, setResetCounts] = useState<Record<string, number>>({});
  const [hasDrafts, setHasDrafts] = useState(false);
  const [discardAsked, setDiscardAsked] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [missingDraftTargets, setMissingDraftTargets] = useState(new Set<string>());
  const dirtyForms = useRef(new Set<string>());
  const pageRef = useRef(page);
  const unknownRef = useRef(unknown);
  const mounted = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const currentOnline = useRef(online);
  const revokedRef = useRef(false);
  const refreshQueued = useRef(false);
  const reloadRef = useRef<(mode?: "manual" | "ambient") => Promise<void>>(async () => {});
  currentOnline.current = online;
  function savePage(value: GrowthPage | null) {
    if (!value) { pageRef.current = null; setPage(null); setMissingDraftTargets(new Set()); return; }
    const retainedItems = pageRef.current?.items.filter(item => dirtyForms.current.has("item:" + item.id)
      && !value.items.some(latest => latest.id === item.id)) ?? [];
    const retainedTopics = pageRef.current?.topics.filter(topic => dirtyForms.current.has("topic:" + topic.id)
      && !value.topics.some(latest => latest.id === topic.id)) ?? [];
    const missing = new Set([...retainedItems.map(item => "item:" + item.id), ...retainedTopics.map(topic => "topic:" + topic.id)]);
    const displayed = missing.size ? { ...value,
      items: [...value.items, ...retainedItems.map(item => ({ ...item, sourceAvailable: false }))],
      topics: [...value.topics, ...retainedTopics],
      notices: [...value.notices, "本次頁面未包含部分有草稿的項目；已保留上次資料及草稿供核對，相關新操作暫停。"],
    } : value;
    pageRef.current = displayed; setPage(displayed); setMissingDraftTargets(missing);
  }
  function saveUnknown(value: UnknownWrite | null) { unknownRef.current = value; setUnknown(value); setOriginalConfirmed(false); }
  function markDirty(key: string) {
    dirtyForms.current.add(key); setHasDrafts(true); setDiscardAsked(false);
  }
  function resetForm(attempt: Attempt) {
    const key = attempt.kind + ":" + attempt.id;
    dirtyForms.current.delete(key); setHasDrafts(dirtyForms.current.size > 0);
    setResetCounts(previous => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }));
    setDiscardAsked(false);
  }
  function begin(kind: "read" | "write") {
    if (!mounted.current || !currentOnline.current || inFlight.current || revokedRef.current) return null;
    const controller = new AbortController();
    inFlight.current = controller;
    const token = ++generation.current;
    setBusy(kind);
    return { controller, current: () => mounted.current && token === generation.current,
      finish: () => {
        if (inFlight.current === controller) inFlight.current = null;
        if (mounted.current && token === generation.current) {
          setBusy(null);
          if (refreshQueued.current && currentOnline.current && !revokedRef.current
            && (!dirtyForms.current.size || !!unknownRef.current)) void reloadRef.current("ambient");
        }
      } };
  }
  function clearData() {
    savePage(null); saveUnknown(null); revokedRef.current = true; setRevoked(true); setReadFailed(true);
    dirtyForms.current.clear(); setHasDrafts(false); setDiscardAsked(false); setRefreshPending(false); refreshQueued.current = false;
    setNotice("登入、孩子資料或存取權已改變；已清除這個孩子的關注資料。請重新確認登入及孩子存取權。");
  }
  async function reload(mode: "manual" | "ambient" = "manual") {
    if (!mounted.current || !currentOnline.current || revokedRef.current) return;
    if (inFlight.current || (mode === "ambient" && dirtyForms.current.size > 0 && !unknownRef.current)) {
      refreshQueued.current = true; setRefreshPending(true); return;
    }
    const request = begin("read");
    if (!request) return;
    refreshQueued.current = false; setRefreshPending(false);
    try {
      const latest = await api.getPage(childId, request.controller.signal, userId);
      if (!request.current()) return;
      // Inputs keep their captured basis and stable keys across reads.
      savePage(latest); setReadFailed(false);
      const original = unknownRef.current;
      if (!original) {
        setNotice(dirtyForms.current.size ? "最新資料已讀取，未提交的草稿及確認仍然保留。若版本已改變，相關表單會停止提交，需先明確放棄草稿及重新核對。" : null);
        return;
      }
      if (original.reconfirm) {
        saveUnknown(null);
        setNotice((original.reason ? original.reason + " " : "") + "這次提交未獲接受，最新保存狀態已讀取。先前未確認的提交不能由這次拒絕判定成功或失敗；保留的草稿需要重新核對，沒有自動換用新版本。");
        return;
      }
      const found = original.attempt.kind === "item" ? latest.items.some(item => item.id === original.attempt.id)
        : latest.topics.some(topic => topic.id === original.attempt.id);
      saveUnknown({ ...original, reviewed: found });
      setNotice(!found ? "這一頁未能找到原操作對象，暫時不能核對或重試；所有新的變更保持停止。"
        : "已讀取最新保存狀態，原操作結果仍未確認。即使來源或目前狀態已改變，也可明確重試同一份原請求，以查核 Server 保存結果；不會建立新的操作。");
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) clearData();
      else { setReadFailed(true); setOriginalConfirmed(false); setNotice("未能讀取最新關注資料；草稿已保留，現時停止所有變更。請連線後重新讀取。"); }
    } finally { request.finish(); }
  }
  reloadRef.current = reload;
  function discardDrafts() {
    if (!discardAsked || inFlight.current || revokedRef.current || !currentOnline.current) return;
    dirtyForms.current.clear(); setHasDrafts(false); setDiscardAsked(false); setDraftEpoch(value => value + 1);
    setOriginalConfirmed(false);
    // Any unknown request stays frozen independently of discarded form fields.
    void reloadRef.current("manual");
  }
  async function submit(attempt: Attempt, retry = false) {
    if (readFailed || !pageRef.current?.canManage || (!retry && unknownRef.current) || (retry && !unknownRef.current?.reviewed)) return;
    const request = begin("write");
    if (!request) return;
    try {
      if (attempt.kind === "item") {
        const saved = await api.decideAttention(childId, attempt.id, JSON.parse(attempt.body) as GrowthAction, request.controller.signal, userId);
        if (!request.current()) return;
        if (pageRef.current) {
          const displayed = { ...pageRef.current, items: pageRef.current.items.map(item => item.id === saved.id ? saved : item) };
          pageRef.current = displayed; setPage(displayed);
        }
        setNotice("Server 已確認關注狀態：" + stateText[saved.state] + "。接受不代表已預約或完成；連結任務的最新狀態請到任務區核對。");
      } else {
        const saved = await api.updateTopic(childId, attempt.id, JSON.parse(attempt.body) as GrowthTopicAction, request.controller.signal, userId);
        if (!request.current()) return;
        savePage(saved); setNotice("Server 已確認並保存這份原主題操作；下方顯示目前資料，可能包括之後在記憶區作出的更正。");
      }
      saveUnknown(null); resetForm(attempt);
    } catch (error) {
      if (!request.current()) return;
      if (accessLost(error)) clearData();
      else {
        const reason = error instanceof GrowthApiError && error.code ? growthErrorText[error.code] ?? null : null;
        saveUnknown({ attempt, reviewed: false, reconfirm: error instanceof GrowthApiError && requiresFreshGrowthConfirmation(error), reason });
        setReadFailed(true);
        setNotice((reason ? reason + " " : "") + (error instanceof GrowthApiError && requiresFreshGrowthConfirmation(error)
          ? "這次提交未獲接受。請先讀取最新資料及版本，再重新核對；草稿仍保留，沒有自動換用新版本提交。"
          : "操作結果未能確認；原內容及版本已保留，新的變更已停止。請先重新讀取核對，再決定是否明確重試原操作。"));
      }
    } finally { request.finish(); }
  }
  function decide(item: GrowthAttention, input: GrowthAction) {
    const latest = pageRef.current?.items.find(value => value.id === item.id);
    if (!latest || latest.version !== item.version || !actionable(latest)
      || pageRef.current?.topics.find(topic => topic.id === item.topicId)?.disabled) return;
    const parsed = growthActionSchema.safeParse(input);
    if (!parsed.success || parsed.data.expectedVersion !== latest.version || parsed.data.authorityVersion !== pageRef.current?.authorityVersion) return;
    const label = (input.action === "accept" ? "接受：" : input.action === "snooze" ? "延後：" : "關閉：") + item.title;
    const taskValues = parsed.data.action === "accept" && parsed.data.task.kind === "create" ? parsed.data.task.values : null;
    const assigneeLabel = taskValues ? pageRef.current?.eligibleAssignees.find(assignee => assignee.userId === taskValues.assigneeUserId)?.name : undefined;
    void submit({ kind: "item", id: item.id, body: JSON.stringify(parsed.data), label, ...(assigneeLabel ? { assigneeLabel } : {}) });
  }
  function changeTopic(topic: GrowthTopic, input: GrowthTopicAction) {
    const latest = pageRef.current?.topics.find(value => value.id === topic.id);
    const parsed = growthTopicActionSchema.safeParse(input);
    if (!latest || latest.version !== topic.version || !parsed.success || parsed.data.expectedVersion !== latest.version || parsed.data.authorityVersion !== pageRef.current?.authorityVersion) return;
    const contextValues = parsed.data.action === "confirm_context" ? parsed.data.values : null;
    const contextSummary = contextValues ? topic.inputs.filter(input => contextValues[input.key] !== undefined).map(input => input.label + "：" +
      (input.choices.find(choice => choice.value === contextValues[input.key])?.label ?? contextValues[input.key])) : null;
    void submit({ kind: "topic", id: topic.id, body: JSON.stringify(parsed.data), label: "主題設定：" + topic.title,
      ...(contextSummary ? { contextSummary } : {}) });
  }
  function retryOriginal() {
    if (!originalConfirmed || !unknownRef.current?.reviewed) return;
    void submit(unknownRef.current.attempt, true);
  }
  function openSource(url: string) {
    const token = generation.current;
    void Linking.openURL(url).catch(() => { if (mounted.current && token === generation.current) setNotice("未能開啟來源連結。"); });
  }
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void reloadRef.current("ambient"); };
    if (typeof window !== "undefined") window.addEventListener(ONLINE_REFRESH_EVENT, refresh);
    return () => {
      mounted.current = false; generation.current++; inFlight.current?.abort(); inFlight.current = null;
      if (typeof window !== "undefined") window.removeEventListener(ONLINE_REFRESH_EVENT, refresh);
    };
  }, [api]);
  useEffect(() => {
    if (!online) { setOriginalConfirmed(false); inFlight.current?.abort(); return; }
    void reloadRef.current("ambient");
  }, [online, refreshVersion]);
  const locked = !!busy || revoked || !online || readFailed || !!unknown || !page?.canManage;
  const retryDisabled = !!busy || revoked || !online || readFailed || !page?.canManage || !unknown?.reviewed || !originalConfirmed;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>成長階段關注</Text>
    <Text style={styles.hint}>按已確認的孩子情況及來源提供站內關注，供觀察、安排及諮詢準備；不作診斷或醫療分流。所有近況及關注紀錄均由家庭成員按權限查看。</Text>
    {!online && <Text style={styles.warning}>目前離線；不能接受、延後、關閉或更改主題。顯示的資料未代表最新狀態。</Text>}
    <Action label={busy === "read" ? "正在讀取成長關注…" : unknown ? "讀取最新資料並核對原操作" : "重新讀取成長關注並保留草稿"}
      onPress={() => { void reload("manual"); }} disabled={!!busy || revoked || !online} />
    {refreshPending && <Text style={styles.hint}>有更新等候核對；目前保留未提交的草稿，沒有自動重新載入表單。</Text>}
    {hasDrafts && <View style={styles.box}>
      <Text style={styles.hint}>未提交的輸入及確認會保留原版本。重新讀取不會清除草稿；放棄後才可以按最新版本重新填寫。</Text>
      <Action label="放棄草稿並重新核對" disabled={!!busy || revoked || !online} onPress={() => setDiscardAsked(true)} />
      {discardAsked && <>
        <Text accessibilityRole="alert" style={styles.warning}>這會清除所有未提交的表單輸入及確認，再讀取最新資料。已保存的紀錄不會刪除；結果未知的原請求仍然保留。</Text>
        <View style={styles.row}>
          <Action label="明確放棄表單草稿並重新讀取" disabled={!!busy || revoked || !online} onPress={discardDrafts} />
          <Action label="保留草稿" onPress={() => setDiscardAsked(false)} />
        </View>
      </>}
    </View>}
    {notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {unknown && <View style={styles.box}>
      <Text style={styles.label}>原操作待核對</Text>
      <OriginalDetails attempt={unknown.attempt} />
      <Text style={styles.hint}>重試保留原對象、原版本及完整內容。即使最新狀態有改變，也不會自動建立另一份請求。</Text>
      <Confirmation label="我已核對原操作，明確同意重試同一份內容及版本" checked={originalConfirmed}
        disabled={!!busy || revoked || !online || readFailed || !page?.canManage || !unknown.reviewed || unknown.reconfirm}
        onToggle={() => setOriginalConfirmed(value => !value)} />
      <Action label="明確重試原操作" onPress={retryOriginal} disabled={retryDisabled || unknown.reconfirm} />
    </View>}
    {page && <>
      {!page.canManage && <Text style={styles.hint}>你目前只有閱讀權限；只有家庭擁有人及照顧者可以處理關注及確認近況。</Text>}
      {page.notices.map((message, index) => <Text key={index} style={styles.warning}>{message}</Text>)}
      {page.items.length === 0 && <Text style={styles.hint}>目前沒有已保存的成長關注；請核對下方家庭共享近況。沒有候選不代表已接受專業評估。</Text>}
      {page.items.map(item => <AttentionCard key={item.id + ":" + draftEpoch + ":" + (resetCounts["item:" + item.id] ?? 0)}
        item={item} page={page} locked={locked} onDirty={markDirty} onSubmit={decide} onOpenSource={openSource} onOpenTask={onOpenTask} />)}
      {page.historyHasMore && <Text style={styles.hint}>此頁只顯示 Server 返回的有限歷史，還有較早紀錄未列出；不能把這一頁當作完整歷史。</Text>}
      <Text accessibilityRole="header" style={styles.heading}>家庭共享近況及主題設定</Text>
      {page.topics.map(topic => <TopicCard key={topic.id + ":" + draftEpoch + ":" + (resetCounts["topic:" + topic.id] ?? 0)}
        topic={topic} locked={locked || missingDraftTargets.has("topic:" + topic.id)} canManage={page.canManage} authorityVersion={page.authorityVersion} onDirty={markDirty} onSubmit={changeTopic} />)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 14, gap: 12 },
  box: { borderWidth: 1, borderColor: "#d4dbd6", borderRadius: 4, padding: 12, gap: 10 },
  source: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 10, gap: 8 },
  stack: { gap: 8 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  heading: { fontSize: 20, fontWeight: "600", color: "#17291f" }, label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#233429" },
  body: { fontSize: 16, lineHeight: 25, color: "#233429" }, hint: { fontSize: 14, lineHeight: 22, color: "#4f5e54" },
  warning: { fontSize: 15, lineHeight: 24, color: "#744300" },
  input: { borderWidth: 1, borderColor: "#788a7d", borderRadius: 4, minHeight: 44, padding: 10, fontSize: 16, color: "#233429" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  choice: { borderWidth: 1, borderColor: "#788a7d", borderRadius: 4, padding: 10, minHeight: 44 },
  selected: { backgroundColor: "#e9f2ec", borderColor: "#244e38" },
  button: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#244e38", borderRadius: 5 },
  buttonText: { color: "#ffffff", fontSize: 15, lineHeight: 22 }, disabled: { opacity: 0.5 },
});
