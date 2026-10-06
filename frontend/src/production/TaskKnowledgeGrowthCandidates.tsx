import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { growthActionSchema, growthTopicActionSchema } from "../../../src/shared/growth";
import { growthActionable, growthKindLabels, growthSourceUrl, growthStateLabels, growthTime, type GrowthAttention, type GrowthTopic, type GrowthViewModel, type GrowthActions } from "../growth-view-model";
import type { TaskValues } from "../task-view-model";
import { AppCheckbox } from "../components/AppCheckbox";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { AppDateTimeField, AppTimeZoneSelect } from "../components/DateTimeFields";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../components/ui";
import { SummaryDisclosure } from "../components/summary/SummaryDisclosure";
import { GrowthOperationRecovery } from "../components/growth/GrowthOperationRecovery";
import { growthStyles as s } from "../components/growth/growth-styles";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

export function TaskKnowledgeGrowthCandidates({ model, actions, onTask }: { model: GrowthViewModel; actions: GrowthActions; onTask(id: string): void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null), navigate = usePreviewNavigation();
  const latest = useRef({ model, actions }); latest.current = { model, actions };
  useEffect(() => () => { const value = latest.current; if (value.model.dirty && !value.model.pending && !value.model.busy) value.actions.discardDrafts(); }, []);
  const page = model.access === "lost" ? null : model.page;
  if (!page) return null;
  const selected = page.items.find(item => item.id === selectedId);
  return <View style={s.stack}>
    <SectionCard><SectionHeader density="compact" title="目前可核對的成長候選" subtitle={model.dataLabel} />
      <Text style={s.meta}>以下是有限主題候選；接受只記錄知悉或明確建立共享事項，不代表已完成、已預約或醫療判斷。</Text>
      {page.items.length ? page.items.map(item => <View key={item.id} style={s.smallStack}>
        <Text style={s.title}>{item.title}</Text><Text style={s.meta}>{growthKindLabels[item.kind]} · {growthStateLabels[item.state]} · 版本 {item.version}</Text>
        <Text style={s.body}>{item.whyNow}</Text>
        <AppButton label="查看來源與核對候選" variant="secondary" density="compact" disabled={model.busy} onPress={() => setSelectedId(item.id)} />
      </View>) : <Text style={s.body}>目前已取得的有限主題沒有候選；這不代表沒有需要觀察的事情。</Text>}
      {page.historyHasMore ? <Text style={s.meta}>只取得 API 的目前候選視窗，不能當作完整成長歷史。</Text> : null}
    </SectionCard>
    <SummaryDisclosure label="有限主題及人工確認近況" scopeKey={model.scopeKey}>
      {page.topics.map(topic => <TopicForm key={`${model.scopeKey}:${topic.id}:${model.epoch}:${model.resetCounts[`topic:${topic.id}`] ?? 0}`} topic={topic} model={model} actions={actions} />)}
    </SummaryDisclosure>
    <AppDialog visible={!!selected} accessibilityLabel="核對成長候選" onDismiss={() => navigate(() => { if (model.dirty && !model.pending) actions.discardDrafts(); setSelectedId(null); })}>
      <AppDialog.Title>{selected?.title ?? "核對成長候選"}</AppDialog.Title>
      <AppDialog.ScrollArea><AppScrollView>{selected ? <AttentionForm key={`${model.scopeKey}:${selected.id}:${model.epoch}:${model.resetCounts[`item:${selected.id}`] ?? 0}`} item={selected} model={model} actions={actions} onTask={onTask} /> : null}
        <GrowthOperationRecovery model={model} actions={actions} includeRefresh />
      </AppScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions><AppButton label="返回候選列表" variant="quiet" onPress={() => navigate(() => { if (model.dirty && !model.pending) actions.discardDrafts(); setSelectedId(null); })} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}

type CandidateFields = { action: "accept" | "snooze" | "dismiss"; mode: "none" | "create"; values: TaskValues; until: string; note: string };
function AttentionForm({ item, model, actions, onTask }: { item: GrowthAttention; model: GrowthViewModel; actions: GrowthActions; onTask(id: string): void }) {
  const navigate = usePreviewNavigation();
  const page = model.page!, [basis, setBasis] = useState<{ item: GrowthAttention; authorityVersion: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [shared, setShared] = useState(false), [error, setError] = useState("");
  const { control, watch, handleSubmit, reset } = useForm<CandidateFields>({ defaultValues: { action: "accept", mode: "none", until: "", note: "",
    values: { title: item.title, details: item.advice, kind: "ordinary", assigneeUserId: "", dueAt: "", timeZone: "Asia/Hong_Kong" } } });
  const fields = watch(), original = basis ?? { item, authorityVersion: page.authorityVersion };
  const stale = !!basis && (basis.item.version !== item.version || basis.authorityVersion !== page.authorityVersion);
  const disabled = model.locked || stale || !growthActionable(item) || page.topics.find(topic => topic.id === item.topicId)?.disabled !== false;
  useEffect(() => { if (!basis) reset({ action: "accept", mode: "none", until: "", note: "", values: { title: item.title, details: item.advice, kind: "ordinary", assigneeUserId: "", dueAt: "", timeZone: "Asia/Hong_Kong" } }); }, [item.version, page.authorityVersion, basis, reset]);
  function markDraft() { if (!basis) setBasis({ item: structuredClone(item), authorityVersion: page.authorityVersion }); actions.markDirty(`item:${item.id}`); }
  function edited() { markDraft(); setConfirmed(false); setShared(false); setError(""); }
  const url = growthSourceUrl(item.source.url);
  const submit = handleSubmit(value => {
    if (disabled || !confirmed) return;
    const base = { authorityVersion: original.authorityVersion, expectedVersion: original.item.version, confirm: true as const };
    const input = value.action === "accept" ? { ...base, action: value.action, task: value.mode === "none" ? { kind: "none" as const } : { kind: "create" as const, values: value.values } }
      : value.action === "snooze" ? { ...base, action: value.action, until: value.until } : { ...base, action: value.action, note: value.note };
    const parsed = growthActionSchema.safeParse(input);
    if (!parsed.success || value.action === "snooze" && Date.parse(value.until) <= Date.now()) { setError("請核對所有欄位、將來的延後時間及任務時區；內容不會截短。"); return; }
    if (value.action === "accept" && value.mode === "create" && (!shared || !page.eligibleAssignees.some(person => person.userId === value.values.assigneeUserId))) { setError("請明確選擇合資格負責人並確認家庭共享安排。"); return; }
    actions.decide(original.item, parsed.data);
  });
  return <View style={s.stack}>
    <Text style={s.meta}>{growthStateLabels[item.state]} · 版本 {item.version} · 更新於 {growthTime(item.updatedAt)}</Text>
    <Text selectable style={s.body}>{item.sourceAvailable ? item.advice : "原來源或依據已改變／不可用，現時不能按舊候選執行。"}</Text>
    <Text selectable style={s.meta}>適用限制：{item.limits}</Text>
    <SummaryDisclosure label="原來源、依據與版本" scopeKey={`${model.scopeKey}:${item.id}`}>
      <Text selectable style={s.body}>{item.source.title} · {item.source.section}</Text><Text selectable style={s.body}>{item.source.excerpt}</Text>
      <Text style={s.meta}>來源版本 {item.source.versionId} · 核對於 {growthTime(item.source.checkedAt)} · 孩子檔案版本 {item.evidence.profileVersion}</Text>
      {url ? <AppButton label="開啟 HTTPS 來源" variant="quiet" onPress={() => { void Linking.openURL(url).catch(() => setError("來源連結未能開啟。")); }} /> : <Text style={s.meta}>來源連結未通過 HTTPS 核對。</Text>}
    </SummaryDisclosure>
    {item.taskId ? <><Text style={s.meta}>已有連結事項；讀取時狀態：{item.taskState ?? "未能核對"}，不代表已完成。</Text><AppButton label="核對連結事項" variant="secondary" onPress={() => onTask(item.taskId!)} /></> : null}
    {stale ? <Text style={s.warning}>原草稿及版本保留；最新依據已改變。放棄草稿後再明確核對，不能默換版本。</Text> : null}
    {model.access === "editable" ? <>
      <Controller name="action" control={control} render={({ field }) => <AppSelect label="這次決定" value={field.value} options={[{ value: "accept", label: "接受並記錄知悉" }, { value: "snooze", label: "延後核對" }, { value: "dismiss", label: "關閉候選" }]} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
      {fields.action === "accept" ? <>
        <Controller name="mode" control={control} render={({ field }) => <AppSelect label="接受後如何安排" value={field.value} options={[{ value: "none", label: "只記錄已知悉" }, { value: "create", label: "明確建立待處理事項" }]} disabled={disabled || !!item.taskId} onChange={value => { edited(); field.onChange(value); }} />} />
        {fields.mode === "create" ? <>
          <Controller name="values.title" control={control} render={({ field }) => <AppTextField label="事項標題" value={field.value} disabled={disabled} onChangeText={value => { edited(); field.onChange(value); }} />} />
          <Controller name="values.details" control={control} render={({ field }) => <AppTextField label="事項內容" value={field.value} multiline disabled={disabled} onChangeText={value => { edited(); field.onChange(value); }} />} />
          <Controller name="values.kind" control={control} render={({ field }) => <AppSelect label="事項種類" value={field.value} options={[{ value: "ordinary", label: "普通事項" }, { value: "appointment", label: "預約安排" }]} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
          <Controller name="values.assigneeUserId" control={control} render={({ field }) => <AppSelect label="負責人" value={page.eligibleAssignees.some(person => person.userId === field.value) ? field.value : ""} options={[{ value: "", label: "請明確選擇合資格成員" }, ...page.eligibleAssignees.map(person => ({ value: person.userId, label: person.name }))]} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
          <Controller name="values.timeZone" control={control} render={({ field }) => <AppTimeZoneSelect value={field.value} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
          <Controller name="values.dueAt" control={control} render={({ field }) => <AppDateTimeField label="安排時間" value={field.value} timeZone={fields.values.timeZone} disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
          <Text style={s.meta}>只建立家庭共享待處理事項；預約安排不代表機構已確認。</Text>
          <AppCheckbox label="我已核對負責人及時間，明確同意建立家庭共享事項" checked={shared} disabled={disabled} onChange={value => { markDraft(); setShared(value); setConfirmed(false); }} />
        </> : null}
      </> : fields.action === "snooze" ? <Controller name="until" control={control} render={({ field }) => <AppDateTimeField label="延後至（香港時間）" value={field.value} timeZone="Asia/Hong_Kong" disabled={disabled} onChange={value => { edited(); field.onChange(value); }} />} />
        : <Controller name="note" control={control} render={({ field }) => <AppTextField label="關閉原因／備註（可留空，最多 1,000 字）" value={field.value} multiline disabled={disabled} onChangeText={value => { edited(); field.onChange(value); }} />} />}
      <AppCheckbox label="我已核對候選、來源、版本及這次決定，明確確認" checked={confirmed} disabled={disabled} onChange={value => { markDraft(); setConfirmed(value); }} />
      <AppButton label="確認提交這次成長決定" disabled={disabled || !confirmed || fields.action === "accept" && fields.mode === "create" && !shared} onPress={submit} />
    </> : <Text style={s.meta}>目前只有閱讀權限，不能接受或修改候選。</Text>}
    {error ? <Text accessibilityRole="alert" style={s.warning}>{error}</Text> : null}
    {model.notice ? <Text style={s.meta}>{model.notice}</Text> : null}
    {model.dirty && !model.pending ? <AppButton label="放棄草稿並重新核對" variant="quiet" disabled={model.busy} onPress={() => navigate(() => actions.discardDrafts())} /> : null}
  </View>;
}

type ContextFields = { values: Record<string, string> };
function TopicForm({ topic, model, actions }: { topic: GrowthTopic; model: GrowthViewModel; actions: GrowthActions }) {
  const page = model.page!, [basis, setBasis] = useState<{ topic: GrowthTopic; authorityVersion: string } | null>(null);
  const [shared, setShared] = useState(false), [enabledConsent, setEnabledConsent] = useState(false), [error, setError] = useState("");
  const { control, watch, handleSubmit } = useForm<ContextFields>({ defaultValues: { values: {} } });
  const values = watch("values"), original = basis ?? { topic, authorityVersion: page.authorityVersion };
  const stale = !!basis && (basis.topic.version !== topic.version || basis.authorityVersion !== page.authorityVersion || JSON.stringify(basis.topic.inputs.map(input => input.factRefs)) !== JSON.stringify(topic.inputs.map(input => input.factRefs)));
  const conflict = topic.inputs.some(input => input.conflict), disabled = model.locked || stale || model.missingTargets.includes(`topic:${topic.id}`);
  function markDraft() { if (!basis) setBasis({ topic: structuredClone(topic), authorityVersion: page.authorityVersion }); actions.markDirty(`topic:${topic.id}`); }
  const selected = original.topic.inputs.filter(input => !input.conflict && values[input.key] && input.choices.some(choice => choice.value === values[input.key]));
  const submit = handleSubmit(value => {
    if (disabled || !shared || conflict || !selected.length) return;
    const references = new Map<string, { id: string; version: number }>();
    for (const input of original.topic.inputs) for (const ref of input.factRefs) {
      if (references.has(ref.id) && references.get(ref.id)!.version !== ref.version) { setError("原已確認資料版本不一致；請先重新讀取。"); return; }
      references.set(ref.id, { ...ref });
    }
    const parsed = growthTopicActionSchema.safeParse({ authorityVersion: original.authorityVersion, expectedVersion: original.topic.version, confirm: true,
      action: "confirm_context", values: Object.fromEntries(selected.map(input => [input.key, value.values[input.key]])),
      expectedFacts: [...references.values()].sort((a, b) => a.id.localeCompare(b.id)), confirmShared: true });
    if (!parsed.success) { setError("請明確選擇至少一項近況並核對原版本。"); return; }
    actions.updateTopic(original.topic, parsed.data);
  });
  return <SectionCard><SectionHeader density="compact" title={topic.title} subtitle={`版本 ${topic.version} · ${topic.disabled ? "已停用" : "已啟用"}`} />
    <Text style={s.meta}>只保存這次明確選擇的近況；不知道或未選欄位保持原狀。近況會成為獲授權家庭成員可見的已確認資料。</Text>
    {stale || model.missingTargets.includes(`topic:${topic.id}`) ? <Text style={s.warning}>主題、依據或已確認資料有變／未在目前視窗；原草稿保留，不能默換版本。</Text> : null}
    {topic.inputs.map(input => <View key={input.key} style={s.smallStack}><Text style={s.meta}>{input.label} · 目前：{input.conflict ? "資料有衝突，須在記憶管理覆核" : input.choices.find(choice => choice.value === input.value)?.label ?? "尚未確認"}</Text>
      {model.access === "editable" ? <Controller name={`values.${input.key}`} control={control} render={({ field }) => <AppSelect label={`這次確認：${input.label}`} value={field.value ?? ""} options={[{ value: "", label: "這次不確認此項" }, ...input.choices]} disabled={disabled || input.conflict} onChange={value => { markDraft(); field.onChange(value); setShared(false); setError(""); }} />} /> : null}
    </View>)}
    {model.access === "editable" ? <>
      <AppCheckbox label="我已核對所選近況，明確同意保存為家庭共享已確認資料" checked={shared} disabled={disabled || conflict || !selected.length} onChange={value => { markDraft(); setShared(value); }} />
      <AppButton label="確認保存所選近況" disabled={disabled || conflict || !shared || !selected.length} onPress={submit} />
      <AppCheckbox label={topic.disabled ? "我明確同意重新啟用這個主題" : "我明確同意永久停用這個主題"} checked={enabledConsent} disabled={disabled} onChange={value => { markDraft(); setEnabledConsent(value); }} />
      <AppButton label={topic.disabled ? "確認重新啟用主題" : "確認永久停用主題"} variant="secondary" disabled={disabled || !enabledConsent} onPress={() => actions.updateTopic(original.topic, { action: "set_enabled", enabled: topic.disabled, authorityVersion: original.authorityVersion, expectedVersion: original.topic.version, confirm: true })} />
    </> : null}
    {error ? <Text accessibilityRole="alert" style={s.warning}>{error}</Text> : null}
  </SectionCard>;
}