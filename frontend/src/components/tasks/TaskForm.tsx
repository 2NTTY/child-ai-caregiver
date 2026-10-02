import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskActionLabels, taskChangeAllowed, type TaskFormValues, type TasksActions, type TasksViewModel } from "../../task-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { AppDateTimeField, AppTimeZoneSelect } from "../DateTimeFields";
import { TaskDraftSummary, TaskSnapshot } from "./TaskContent";
import { taskFormSchema } from "./task-form";

export function TaskForm({ model, actions }: { model: TasksViewModel; actions: TasksActions }) {
  const draft = model.draft!;
  const [confirmed, setConfirmed] = useState(false);
  const { control, handleSubmit, getValues, formState: { isDirty } } = useForm<TaskFormValues>({ defaultValues: draft.initialValues,
    resolver: zodResolver(taskFormSchema(draft.mode, model.eligibleAssignees)), mode: "onBlur" });
  const busy = ["saving", "unknown"].includes(model.operation.state);
  const timeZone = useWatch({ control, name: "timeZone" });
  const locked = busy || model.operation.state === "conflict" || model.reading || model.access !== "editable";
  useEffect(() => {
    if (Platform.OS !== "web" || (!isDirty && !busy)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, busy]);
  function edited() { setConfirmed(false); actions.editDraft(); }
  function field(name: "title" | "details" | "dueAt" | "timeZone" | "note", label: string, help?: string, multiline = false) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} multiline={multiline}
        disabled={locked} onBlur={input.onBlur} error={!!fieldState.error} onChangeText={value => { input.onChange(value); edited(); }} />
      {fieldState.error || help ? <HelperText type={fieldState.error ? "error" : "info"} visible>{fieldState.error?.message ?? help}</HelperText> : null}
    </View>} />;
  }
  const canRebase = !!model.latest && draft.mode !== "create" && taskChangeAllowed(model.latest, draft.mode);
  const confirmationLabel = "我已核對內容、負責人、時間及版本，確認這次家庭共享安排";
  return <SectionCard><SectionHeader title={taskActionLabels[draft.mode]} subtitle={draft.basis ? `以版本 ${draft.basis.version} 作基準；草稿尚未保存。` : "先填寫，再核對家庭共享範圍。"}
    action={<AppButton label="放棄草稿" variant="quiet" disabled={busy} onPress={actions.closePanel} />} />
    {draft.basis ? <TaskSnapshot task={draft.basis} assignees={model.eligibleAssignees} /> : null}
    {draft.mode === "create" ? <>
      {field("title", "事項標題")}{field("details", "詳細內容（可選）", undefined, true)}
      <Controller name="kind" control={control} render={({ field: input }) => <AppSelect label="事項種類" value={input.value}
        options={[{ value: "ordinary", label: "普通任務" }, { value: "appointment", label: "預約" }]} disabled={locked} onChange={value => { input.onChange(value); edited(); }} />} />
    </> : null}
    {draft.mode === "create" || draft.mode === "reschedule" ? <>
      <Controller name="assigneeUserId" control={control} render={({ field: input, fieldState }) => <View>
        <AppSelect label="負責人" value={model.eligibleAssignees.some(item => item.userId === input.value) ? input.value : ""}
          options={[{ value: "", label: "請選擇合資格家庭成員" }, ...model.eligibleAssignees.map(item => ({ value: item.userId, label: item.name }))]}
          disabled={locked} onChange={value => { input.onChange(value); edited(); }} />
        <HelperText type={fieldState.error ? "error" : "info"} visible>{fieldState.error?.message ?? "只可指派本家庭目前有權照顧孩子的成員；檢視者不在清單內。"}</HelperText>
      </View>} />
      <Controller name="timeZone" control={control} render={({ field: input, fieldState }) => <View>
        <AppTimeZoneSelect value={input.value} disabled={locked} onChange={value => { input.onChange(value); edited(); }} />
        {fieldState.error ? <HelperText type="error">{fieldState.error.message}</HelperText> : null}
      </View>} />
      <Controller name="dueAt" control={control} render={({ field: input, fieldState }) => <AppDateTimeField
        label={draft.mode === "reschedule" ? "新安排時間" : "安排時間"} value={input.value} timeZone={timeZone} disabled={locked}
        error={fieldState.error?.message} onChange={value => { input.onChange(value); edited(); }} />} />
    </> : null}
    {draft.mode === "resolve" ? <Controller name="outcome" control={control} render={({ field: input, fieldState }) => <View>
      <AppSelect label="明確終態" value={input.value} options={[{ value: "", label: "請選擇終態" }, { value: "completed", label: "覆核為已完成" }, { value: "cancelled", label: "覆核為已取消" }]}
        disabled={locked} onChange={value => { input.onChange(value); edited(); }} />
      {fieldState.error ? <HelperText type="error" visible>{fieldState.error.message}</HelperText> : null}
      <Text style={styles.meta}>覆核只選終態，不會重新排程或重新催辦。</Text>
    </View>} /> : null}
    {draft.mode !== "create" ? field("note", draft.mode === "complete" ? "完成備註（可選）" : "原因（必填）", undefined, true) : null}
    <Text style={styles.meta}>離線時可整理本次草稿；關閉、重新載入、切換孩子或撤權會清除。沒有跨關閉草稿保存。</Text>
    <AppButton label="預覽家庭共享內容" disabled={locked} onPress={handleSubmit(values => { setConfirmed(false); actions.reviewDraft(values); })} />
    {draft.reviewedValues ? <View style={styles.review}>
      <Text style={styles.label}>預覽內容 · 尚未保存</Text><TaskDraftSummary mode={draft.mode} values={draft.reviewedValues} assignees={model.eligibleAssignees} />
      <Text style={styles.meta}>只確認孩子所屬家庭的共享安排。建立事項不代表機構確認預約，也不代表已通知照顧者。</Text>
      <AppCheckbox label={confirmationLabel} checked={confirmed} onChange={setConfirmed} disabled={locked} />
      <AppButton label={`確認家庭共享並模擬${draft.mode === "create" ? "建立" : "保存"}`} onPress={() => { if (confirmed) actions.submitReviewed(); }}
        disabled={!confirmed || !model.online || locked || model.operation.state !== "needs_confirmation"} />
      <AppButton label="繼續修改草稿" variant="quiet" disabled={locked} onPress={edited} />
    </View> : null}
    {model.operation.state === "conflict" && model.latest && draft.basis ? <View style={styles.review}>
      <Text style={styles.label}>版本衝突 · 原操作沒有保存</Text><Text style={styles.label}>原基準 · 版本 {draft.basis.version}</Text><TaskSnapshot task={draft.basis} assignees={model.eligibleAssignees} />
      <Text style={styles.label}>最新 · 版本 {model.latest.version}</Text><TaskSnapshot task={model.latest} assignees={model.eligibleAssignees} />
      <Text style={styles.label}>你的未保存草稿</Text><TaskDraftSummary mode={draft.mode} values={getValues()} assignees={model.eligibleAssignees} />
      <AppButton label="保留草稿並使用最新版本" disabled={!model.online || model.reading || !canRebase} onPress={() => { setConfirmed(false); actions.useLatestVersion(); }} />
      <Text style={styles.meta}>{canRebase ? "只有明確選擇才換基準；草稿保留，之後仍須重新預覽及確認。" : "最新狀態已不接受這項操作。請放棄草稿，再按最新狀態選擇適用操作；不能重開已結束事項。"}</Text>
    </View> : null}
    {model.operation.state === "unknown" ? <Text style={styles.meta}>原操作內容已鎖定，先查核同一參考。查核不會再提交一次事項。</Text> : null}
  </SectionCard>;
}
const styles = StyleSheet.create({
  review: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, gap: spacing.md, minWidth: 0 },
  label: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "700", lineHeight: 23 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  confirmation: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  confirmationText: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 },
});
