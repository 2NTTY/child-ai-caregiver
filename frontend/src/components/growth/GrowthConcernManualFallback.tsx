import { useGrowthFormDraftGuard } from "./useGrowthFormDraftGuard";
import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { concernChangeSchema, concernValuesSchema } from "../../../../src/shared/concerns";
import type { GrowthActions, GrowthConcern, GrowthViewModel } from "../../growth-view-model";
import { AppCheckbox } from "../AppCheckbox";
import { AppDateTimeField } from "../DateTimeFields";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { ManualFormDialog } from "../FormDialog";
import { GrowthOperationRecovery } from "./GrowthOperationRecovery";
import { growthStyles as s } from "./growth-styles";

type Mode = "create" | "append" | "followup";
type Fields = { title: string; reason: string; observation: string; observedAt: string; followUpAt: string };
type Basis = { mode: Mode; authorityVersion: string; concern: GrowthConcern | null; key: string; resetCount: number };
const defaults: Fields = { title: "", reason: "", observation: "", observedAt: "", followUpAt: "" };
const links = { recordId: null, taskId: null, attentionId: null };
const labels: Record<keyof Fields, string> = { title: "關注名稱", reason: "關注原因", observation: "觀察內容", observedAt: "觀察時間", followUpAt: "站內跟進時間" };

export function GrowthConcernManualFallback({ model, actions, concern }: { model: GrowthViewModel; actions: GrowthActions; concern: GrowthConcern | null }) {
  if (!actions.createConcern || !actions.updateConcern || model.access !== "editable" || !model.page) return null;
  return <ManualFormDialog label={concern ? "更新關注" : "新增關注"} triggerVariant={concern ? "secondary" : "primary"} scopeKey={model.scopeKey} recovery={<GrowthOperationRecovery model={model} actions={actions} includeRefresh />}>
    <ManualForm model={model} actions={actions} concern={concern} />
  </ManualFormDialog>;
}

function ManualForm({ model, actions, concern }: { model: GrowthViewModel; actions: GrowthActions; concern: GrowthConcern | null }) {
  const [mode, setMode] = useState<Mode>(concern ? "append" : "create"), [basis, setBasis] = useState<Basis | null>(null), [shared, setShared] = useState(false);
  const draftGuard = useGrowthFormDraftGuard(model, actions, basis?.key ?? (mode === "create" ? "concern_create:new" : `concern_update:${concern?.id ?? ""}`), !!basis && model.dirty);
  const id = useId(), previousEpoch = useRef(model.epoch);
  const { control, handleSubmit, watch, reset, setError, setFocus, formState: { errors } } = useForm<Fields>({ defaultValues: defaults });
  const followUpAt = watch("followUpAt");
  const target = basis?.concern ?? concern;
  const stale = !!basis && (basis.authorityVersion !== model.page?.authorityVersion
    || basis.mode !== "create" && (basis.concern?.id !== concern?.id || basis.concern?.version !== concern?.version));
  const disabled = model.locked || stale || model.page?.concerns?.state !== "ready" || mode !== "create" && !target;
  const fieldKeys: (keyof Fields)[] = mode === "create" ? ["title", "reason", "observation", "observedAt", "followUpAt"]
    : mode === "append" ? ["observation", "observedAt"] : ["followUpAt"];
  const entries = fieldKeys.filter(key => errors[key]?.message).map(key => ({ field: key, label: labels[key], message: errors[key]!.message! }));
  useEffect(() => {
    if (previousEpoch.current !== model.epoch || basis && (model.resetCounts[basis.key] ?? 0) !== basis.resetCount) {
      previousEpoch.current = model.epoch; reset(defaults); setBasis(null); setShared(false);
    }
  }, [model.epoch, model.resetCounts, basis, reset]);
  useEffect(() => { if (stale) setShared(false); }, [stale]);
  function markDraft() {
    if (disabled) return;
    const key = mode === "create" ? "concern_create:new" : `concern_update:${concern!.id}`;
    if (!basis) setBasis({ mode, authorityVersion: model.page!.authorityVersion,
      concern: mode === "create" ? null : structuredClone(concern), key, resetCount: model.resetCounts[key] ?? 0 });
    draftGuard.edited(); actions.markDirty(key);
  }
  function edited() { markDraft(); setShared(false); }
  function invalid(path: string | number | undefined, message: string) {
    const field = path === "text" ? "observation" : fieldKeys.find(key => key === path) ?? fieldKeys[0];
    setError(field, { type: "validate", message });
  }
  const submit = handleSubmit(value => {
    if (disabled || !shared || !basis) return;
    if (mode === "create") {
      const parsed = concernValuesSchema.safeParse({ title: value.title, reason: value.reason, observation: value.observation,
        observedAt: value.observedAt, followUpAt: value.followUpAt || null, links });
      if (!parsed.success) { for (const issue of parsed.error.issues) invalid(issue.path[0] as string | number | undefined, "請核對這項內容及時間。" ); return; }
      draftGuard.submitted(parsed.data, basis.authorityVersion);
      actions.createConcern?.(parsed.data, basis.authorityVersion, true);
      return;
    }
    if (!basis.concern) return;
    const common = { authorityVersion: basis.authorityVersion, expectedVersion: basis.concern.version };
    const parsed = concernChangeSchema.safeParse(mode === "append" ? { ...common, action: "append", text: value.observation, observedAt: value.observedAt, links }
      : { ...common, action: "schedule_followup", followUpAt: value.followUpAt || null });
    if (!parsed.success) { for (const issue of parsed.error.issues) invalid(issue.path[0] as string | number | undefined, "請核對這項內容及時間。" ); return; }
    if (parsed.data.action === "append" || parsed.data.action === "schedule_followup") {
      draftGuard.submitted(parsed.data, basis.authorityVersion);
      actions.updateConcern?.(basis.concern.id, parsed.data, true);
    }
  });
  function textField(name: "title" | "reason" | "observation", maxLength: number) {
    return <Controller name={name} control={control} rules={{ required: "請填寫這項內容。", validate: value => !!value.trim() || "請填寫這項內容。", maxLength: { value: maxLength, message: `最多 ${maxLength} 字。` } }}
      render={({ field }) => <View><AppTextField ref={field.ref} nativeID={`${id}-${name}`} label={labels[name]} accessibilityLabel={labels[name]} value={field.value} multiline={name !== "title"}
        disabled={disabled} error={!!errors[name]} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        onBlur={field.onBlur} onChangeText={value => { edited(); field.onChange(value); }} />
        <FormFieldMessage id={`${id}-${name}-error`} error={errors[name]?.message} /></View>} />;
  }
  function timeField(name: "observedAt" | "followUpAt") {
    return <Controller name={name} control={control} rules={name === "observedAt" ? { required: "請明確選擇觀察時間。" } : {}}
      render={({ field }) => <AppDateTimeField ref={field.ref} id={`${id}-${name}`} errorId={`${id}-${name}-error`} label={name === "followUpAt" && mode === "create" ? "站內跟進時間（可不填）" : labels[name]}
        value={field.value} disabled={disabled} error={errors[name]?.message} optional={name === "followUpAt"} timeZone="Asia/Hong_Kong"
        onBlur={field.onBlur} onChange={value => { edited(); field.onChange(value); }} />} />;
  }
  const options: { value: Mode; label: string }[] = [{ value: "create", label: "建立關注" },
    ...(concern ? [{ value: "append" as const, label: "追加目前關注的觀察" }, { value: "followup" as const, label: "更改／撤回站內跟進" }] : [])];
  return <View style={s.stack} testID="growth-concern-manual-fallback">
    <Text style={s.body}>可在這裏手動建立關注或補充觀察；提交前請核對內容及家庭共享安排。</Text>
    <AppSelect label="這次手動操作" value={mode} options={options} disabled={disabled || !!basis} onChange={value => { setMode(value); reset(defaults); setShared(false); }} />
    {mode !== "create" ? <Text style={s.body}>對象：{target?.title ?? "尚未選擇關注"}</Text> : null}
    {stale ? <Text style={s.warning}>原草稿及版本保留；關注或授權基準已變。請回到原關注，或明確放棄草稿後重新核對。</Text> : null}
    <FormErrorSummary entries={entries} onFocus={field => setFocus(field as keyof Fields)} />
    {mode === "create" ? <>{textField("title", 160)}{textField("reason", 2000)}</> : null}
    {mode !== "followup" ? <>{textField("observation", 2000)}{timeField("observedAt")}</> : null}
    {mode !== "append" ? timeField("followUpAt") : null}
    {mode === "followup" ? <Text style={s.body}>選擇時間會保存一次站內跟進；留空會撤回這次安排。只更改站內跟進，不更改觀察或連結任務。</Text> : null}
    <AppCheckbox label={mode === "followup" ? "我已核對對象及這次站內跟進／撤回，明確同意保存為家庭共享安排" : "我已核對對象、內容及觀察時間，明確同意保存為家庭共享關注"}
      checked={shared} disabled={disabled} onChange={value => { markDraft(); setShared(value); }} />
    <AppButton label={mode === "create" ? "確認建立共享關注" : mode === "append" ? "確認追加共享觀察" : followUpAt ? "確認保存站內跟進" : "確認撤回站內跟進"}
      disabled={disabled || !shared || mode === "followup" && !followUpAt && !target?.followUp} onPress={submit} />
  </View>;
}
