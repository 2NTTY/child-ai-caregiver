import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useId, useState } from "react";
import { Controller, useForm, type Control, type FieldErrors, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { z } from "zod";
import { factDraftFrom, factDraftSchema, factSourceLabel, factStatusLabels, sourceFromDraft, topicDraftFrom, topicDraftSchema, topicStatusLabels, visibilityLabels,
  type FactDraft, type MemoryEditor, type MemoryRole, type TopicDraft } from "../../memory-view-model";
import type { MemoryPreviewController } from "../../preview/useMemoryPreview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { PreviewWriteControls } from "../PreviewWritePanel";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { AppDateTimeField } from "../DateTimeFields";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { StatusAnnouncement } from "../StatusAnnouncement";

type VisibleField<T extends FieldValues> = { name: Path<T>; label: string };
function MemoryFormErrors<T extends FieldValues>({ form, fields }: { form: UseFormReturn<T>; fields: readonly VisibleField<T>[] }) {
  const entries = fields.flatMap(item => {
    const message = form.getFieldState(item.name, form.formState).error?.message;
    return message ? [{ field: item.name, label: item.label, message }] : [];
  });
  return <FormErrorSummary entries={entries} onFocus={name => {
    const target = fields.find(item => item.name === name);
    if (target) form.setFocus(target.name);
  }} />;
}
function focusFirstInvalid<T extends FieldValues>(form: UseFormReturn<T>, fields: readonly VisibleField<T>[], errors: FieldErrors<T>) {
  const first = fields.find(item => Object.prototype.hasOwnProperty.call(errors, item.name));
  if (first) form.setFocus(first.name);
}
function FormField<T extends FieldValues>({ control, name, label, disabled, multiline, placeholder, onEdit, formId, help }: {
  control: Control<T>; name: Path<T>; label: string; disabled: boolean; multiline?: boolean; placeholder?: string; onEdit: () => void; formId: string; help?: string;
}) {
  const id = `${formId}-${name}`;
  return <Controller control={control} name={name} render={({ field, fieldState }) => <View style={styles.field}>
    {name === "validUntil" || name === "resumeAfter" ? <AppDateTimeField ref={field.ref} id={id} errorId={`${id}-error`} describedBy={help ? `${id}-help` : undefined} onBlur={field.onBlur} label={label} value={String(field.value ?? "")} disabled={disabled} optional={name === "validUntil"}
      error={fieldState.error?.message} onChange={value => { onEdit(); field.onChange(value); }} /> : <AppTextField ref={field.ref} label={label} accessibilityLabel={label} value={String(field.value ?? "")} onChangeText={value => { onEdit(); field.onChange(value); }} onBlur={field.onBlur}
      nativeID={id} aria-invalid={!!fieldState.error} aria-describedby={[help ? `${id}-help` : "", fieldState.error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
      disabled={disabled} multiline={multiline} placeholder={placeholder} error={!!fieldState.error} />}
    {help ? <FormFieldMessage id={`${id}-help`} help={help} /> : null}
    {name !== "validUntil" && name !== "resumeAfter" ? <FormFieldMessage id={`${id}-error`} error={fieldState.error?.message} /> : null}
  </View>} />;
}
function Acknowledgement({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled: boolean }) {
  return <AppCheckbox label={label} checked={checked} onChange={onChange} disabled={disabled} />;
}

function ConflictComparison({ preview }: { preview: MemoryPreviewController }) {
  const conflict = preview.conflict;
  if (!conflict) return null;
  const describe = (item: typeof conflict.original) => <View style={styles.group}>
    <Text style={styles.body}>{"key" in item ? `${item.key}：${item.content}` : `${item.title}：${item.note || "沒有備註"}`}</Text>
    {"key" in item ? <><Text style={styles.meta}>{factSourceLabel(item.source)}</Text><Text style={styles.meta}>有效至：{item.validUntil ?? "未設定"} · {factStatusLabels[item.status]}</Text></>
      : <Text style={styles.meta}>{topicStatusLabels[item.status]} · 暫緩至：{item.resumeAfter ?? "沒有"}</Text>}
  </View>;
  return <View style={styles.review}>
    <Text style={styles.title}>版本衝突 · 草稿保留</Text>
    <Text style={styles.tool}>原版本 {conflict.original.version} · {visibilityLabels[conflict.original.visibility]}</Text>{describe(conflict.original)}
    <Text style={styles.tool}>最新版 {conflict.latest.version} · {visibilityLabels[conflict.latest.visibility]}</Text>{describe(conflict.latest)}
    <Text style={styles.meta}>本地草稿仍在下面的欄位；改用最新基準後，須重新預覽及確認。</Text>
    <AppButton label="已比較，改用最新基準" onPress={preview.useLatest} />
    <AppButton label="取消此次操作" variant="quiet" onPress={preview.cancel} />
  </View>;
}
function EditorShell({ preview, title, children }: { preview: MemoryPreviewController; title: string; children: React.ReactNode }) {
  return <SectionCard><SectionHeader density="compact" title={title} subtitle="切換孩子或權限失效會清除草稿。" />
    <StatusAnnouncement eventKey={`${preview.error ?? ""}:${preview.conflict?.latest.version ?? ""}`} message={preview.error ?? (preview.conflict ? "版本衝突；草稿保留，請比較最新版本。" : "")} urgent />
    <ConflictComparison preview={preview} />
    {preview.error ? <Text style={styles.error}>{preview.error}</Text> : null}
    {children}
    <PreviewWriteControls controller={preview.controller} conflict={!!preview.editor?.basis} />
    <AppButton label="取消並清除草稿" variant="quiet" onPress={preview.cancel} disabled={preview.controller.locked} />
  </SectionCard>;
}

function FactValuesEditor({ preview, editor, role, online }: { preview: MemoryPreviewController; editor: Extract<MemoryEditor, { kind: "fact" }>; role: MemoryRole; online: boolean }) {
  const { basis, mode } = editor;
  const formId = useId();
  const [reviewed, setReviewed] = useState<FactDraft | null>(null);
  const [sharedChecked, setSharedChecked] = useState(false);
  const form = useForm<FactDraft>({ defaultValues: factDraftFrom(basis, preview.sources), resolver: zodResolver(factDraftSchema(preview.sources, mode === "revise")), shouldFocusError: false });
  usePreviewLeaveGuard(form.formState.isDirty);
  const draft = form.watch();
  const disabled = !online || preview.blocked;
  const shared = !!basis && basis.visibility === "family";
  const visibleFields: VisibleField<FactDraft>[] = [{ name: "key", label: "事實欄目" }, { name: "content", label: "事實內容" }];
  if (!basis) visibleFields.push({ name: "intendedVisibility", label: "擬確認範圍" });
  visibleFields.push({ name: "sourceChoice", label: "資料來源" }, { name: "sourceDescription", label: "資料來源描述" }, { name: "validUntil", label: "有效至（選填）" });
  if (basis) visibleFields.push({ name: "reason", label: "更正原因" });
  const edit = () => { preview.controller.edit(); setReviewed(null); setSharedChecked(false); };
  const review = form.handleSubmit(values => { setReviewed(values); setSharedChecked(false); preview.controller.review(); }, errors => focusFirstInvalid(form, visibleFields, errors));
  const options = preview.sources.map(source => ({ value: source.id, label: `${source.label}${source.current ? "" : "（已更改）"}` }));
  if (draft.sourceChoice === "unavailable") options.push({ value: "unavailable", label: "原私人來源參照已隱藏" });
  return <EditorShell preview={preview} title={basis ? `更正事實 · 基準版本 ${basis.version}` : "新增私人候選"}>
    <MemoryFormErrors form={form} fields={visibleFields} />
    <FormField formId={formId} control={form.control} name="key" label="事實欄目" disabled={disabled} onEdit={edit} />
    <FormField formId={formId} control={form.control} name="content" label="事實內容" disabled={disabled} multiline onEdit={edit} />
    {!basis ? <Controller name="intendedVisibility" control={form.control} render={({ field, fieldState }) => <View style={styles.field}>
      <AppSelect ref={field.ref} id={`${formId}-intendedVisibility`} label="擬確認範圍" value={field.value} options={role === "viewer" ? [{ value: "private", label: "只供本人" }] : [{ value: "private", label: "只供本人" }, { value: "family", label: "家庭共享" }]}
        invalid={!!fieldState.error} describedBy={fieldState.error ? `${formId}-intendedVisibility-error` : undefined} onBlur={field.onBlur}
        disabled={disabled} onChange={value => { edit(); form.setValue("intendedVisibility", value); }} />
      <FormFieldMessage id={`${formId}-intendedVisibility-error`} error={fieldState.error?.message} />
    </View>} /> : <Text style={styles.meta}>更正保留既有範圍：{visibilityLabels[basis.visibility]}及狀態：{factStatusLabels[basis.status]}。{basis.status === "inactive" ? "更正後仍停用，須另行確認才恢復。" : ""}</Text>}
    <Controller name="sourceChoice" control={form.control} render={({ field, fieldState }) => <View style={styles.field}>
      <AppSelect ref={field.ref} id={`${formId}-sourceChoice`} label="資料來源" value={field.value} options={options} disabled={disabled} onBlur={field.onBlur}
        invalid={!!fieldState.error} describedBy={[`${formId}-sourceChoice-help`, fieldState.error ? `${formId}-sourceChoice-error` : ""].filter(Boolean).join(" ")}
        onChange={value => { edit(); form.setValue("sourceChoice", value, { shouldValidate: true }); }} />
      <FormFieldMessage id={`${formId}-sourceChoice-error`} error={fieldState.error?.message} />
      <FormFieldMessage id={`${formId}-sourceChoice-help`} help="照顧記錄採用所選版本；私人聊天只提供本人的合成訊息。共享時只公開已確認內容與來源描述，不公開私人訊息或候選歷史。" />
    </View>} />
    <FormField formId={formId} control={form.control} name="sourceDescription" label="資料來源描述" disabled={disabled} onEdit={edit} />
    <FormField formId={formId} control={form.control} name="validUntil" label="有效至（選填）" placeholder="2099-12-31T23:59:00+08:00" disabled={disabled} onEdit={edit}
      help="日期須包括時間及時區，例如 2099-12-31T23:59:00+08:00。" />
    {basis ? <FormField formId={formId} control={form.control} name="reason" label="更正原因" disabled={disabled} onEdit={edit} /> : null}
    <AppButton label={basis ? "預覽更正" : "預覽私人候選"} onPress={review} disabled={disabled} />
    {reviewed && preview.controller.operation.state === "needs_confirmation" ? <View style={styles.review}>
      <Text style={styles.title}>{basis ? `更正版本 ${basis.version}` : "將建立私人候選 · 尚未確認"}</Text>
      <Text style={styles.body}>{reviewed.key}：{reviewed.content}</Text>
      <Text style={styles.meta}>{factSourceLabel(sourceFromDraft(reviewed, preview.sources))}</Text>
      <Text style={styles.meta}>有效至：{reviewed.validUntil || "未設定"} · {basis ? `保留${visibilityLabels[basis.visibility]}` : `目前只供本人；擬確認為${visibilityLabels[reviewed.intendedVisibility]}`}</Text>
      {basis ? <Text style={styles.meta}>更正原因：{reviewed.reason}；舊版本保留。</Text> : <Text style={styles.meta}>即使擬家庭共享，也要另外核對及確認後才成為共享事實。</Text>}
      {shared ? <Acknowledgement label="我已核對家庭共享的內容及來源" checked={sharedChecked} onChange={() => setSharedChecked(value => !value)} disabled={disabled} /> : null}
      <AppButton label={basis ? "確認提交更正" : "確認建立私人候選"} disabled={disabled || shared && !sharedChecked} onPress={() => preview.submit(basis
        ? { kind: "revise_fact", basis, draft: reviewed, sharedConfirmed: sharedChecked } : { kind: "create_fact", draft: reviewed })} />
    </View> : null}
  </EditorShell>;
}

function TopicValuesEditor({ preview, editor, role, online }: { preview: MemoryPreviewController; editor: Extract<MemoryEditor, { kind: "topic" }>; role: MemoryRole; online: boolean }) {
  const { basis, mode } = editor;
  const formId = useId();
  const [reviewed, setReviewed] = useState<TopicDraft | null>(null);
  const [sharedChecked, setSharedChecked] = useState(false);
  const form = useForm<TopicDraft>({ defaultValues: topicDraftFrom(basis), resolver: zodResolver(topicDraftSchema(mode)), shouldFocusError: false });
  usePreviewLeaveGuard(form.formState.isDirty);
  const draft = form.watch();
  const disabled = !online || preview.blocked;
  const shared = !basis && draft.visibility === "family";
  const visibleFields: VisibleField<TopicDraft>[] = [];
  if (!basis) visibleFields.push({ name: "title", label: "話題標題" });
  if (mode !== "reopen") visibleFields.push({ name: "note", label: "話題備註" });
  if (!basis) visibleFields.push({ name: "visibility", label: "話題範圍" });
  if (mode === "change") {
    visibleFields.push({ name: "status", label: "新話題狀態" });
    if (draft.status === "snoozed") visibleFields.push({ name: "resumeAfter", label: "暫緩至" });
  }
  if (mode === "reopen") visibleFields.push({ name: "reason", label: "明確重開原因" });
  const edit = () => { preview.controller.edit(); setReviewed(null); setSharedChecked(false); };
  const review = form.handleSubmit(values => { setReviewed(values); setSharedChecked(false); preview.controller.review(); }, errors => focusFirstInvalid(form, visibleFields, errors));
  return <EditorShell preview={preview} title={mode === "reopen" ? "按原因重開話題" : basis ? `更新話題 · 基準版本 ${basis.version}` : "新增話題"}>
    <MemoryFormErrors form={form} fields={visibleFields} />
    {basis ? <Text style={styles.body}>{basis.title} · {topicStatusLabels[basis.status]} · {visibilityLabels[basis.visibility]}</Text>
      : <FormField formId={formId} control={form.control} name="title" label="話題標題" disabled={disabled} onEdit={edit} />}
    {mode !== "reopen" ? <FormField formId={formId} control={form.control} name="note" label="話題備註" disabled={disabled} multiline onEdit={edit} /> : <Text style={styles.meta}>將建立新的待處理話題，原話題的已回答／已解決終態保留。</Text>}
    {!basis ? <Controller name="visibility" control={form.control} render={({ field, fieldState }) => <View style={styles.field}>
      <AppSelect ref={field.ref} id={`${formId}-visibility`} label="話題範圍" value={field.value} options={role === "viewer" ? [{ value: "private", label: "只供本人" }] : [{ value: "private", label: "只供本人" }, { value: "family", label: "家庭共享" }]}
        invalid={!!fieldState.error} describedBy={fieldState.error ? `${formId}-visibility-error` : undefined} onBlur={field.onBlur}
        disabled={disabled} onChange={value => { edit(); form.setValue("visibility", value); }} />
      <FormFieldMessage id={`${formId}-visibility-error`} error={fieldState.error?.message} />
    </View>} /> : null}
    {mode === "change" ? <>
      <Controller name="status" control={form.control} render={({ field, fieldState }) => <View style={styles.field}>
        <AppSelect ref={field.ref} id={`${formId}-status`} label="新話題狀態" value={field.value} options={Object.entries(topicStatusLabels).map(([value, label]) => ({ value: value as TopicDraft["status"], label }))}
          invalid={!!fieldState.error} describedBy={fieldState.error ? `${formId}-status-error` : undefined} onBlur={field.onBlur}
          disabled={disabled} onChange={value => { edit(); form.setValue("status", value); }} />
        <FormFieldMessage id={`${formId}-status-error`} error={fieldState.error?.message} />
      </View>} />
      {draft.status === "snoozed" ? <FormField formId={formId} control={form.control} name="resumeAfter" label="暫緩至" placeholder="2099-12-31T09:00:00+08:00" disabled={disabled} onEdit={edit}
        help="請選擇明確的未來日期時間；暫緩期間不再提問。" /> : null}
    </> : null}
    {mode === "reopen" ? <FormField formId={formId} control={form.control} name="reason" label="明確重開原因" disabled={disabled} onEdit={edit} /> : null}
    <Text style={styles.meta}>話題更新或回答不代表任何任務完成，亦不表示通知已送達。</Text>
    <AppButton label={mode === "reopen" ? "預覽重開話題" : basis ? "預覽狀態更新" : "預覽新增話題"} onPress={review} disabled={disabled} />
    {reviewed && preview.controller.operation.state === "needs_confirmation" ? <View style={styles.review}>
      <Text style={styles.title}>{mode === "reopen" ? "將另建待處理話題" : basis ? `將改為${topicStatusLabels[reviewed.status]}` : `將新增${visibilityLabels[reviewed.visibility]}話題`}</Text>
      <Text style={styles.body}>{reviewed.title}</Text>
      <Text style={styles.meta}>{mode === "reopen" ? `重開原因：${reviewed.reason}；原版本 ${basis?.version} 及終態保留。` : `備註：${reviewed.note || "沒有"}`}</Text>
      {mode === "change" && reviewed.status === "snoozed" ? <Text style={styles.meta}>暫緩至：{reviewed.resumeAfter}</Text> : null}
      {shared ? <Acknowledgement label="我已核對家庭共享話題" checked={sharedChecked} onChange={() => setSharedChecked(value => !value)} disabled={disabled} /> : null}
      <AppButton label={mode === "reopen" ? "確認另建新話題" : "確認提交話題"} disabled={disabled || shared && !sharedChecked} onPress={() => {
        if (!basis) preview.submit({ kind: "create_topic", draft: reviewed, sharedConfirmed: sharedChecked });
        else if (mode === "reopen") preview.submit({ kind: "reopen_topic", basis, reason: reviewed.reason });
        else preview.submit({ kind: "change_topic", basis, draft: reviewed });
      }} />
    </View> : null}
  </EditorShell>;
}

function LifecycleEditor({ preview, editor, online }: { preview: MemoryPreviewController; editor: MemoryEditor; online: boolean }) {
  const formId = useId();
  const [reviewed, setReviewed] = useState<{ reason: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const deactivating = editor.kind === "fact" && editor.mode === "deactivate";
  const deleting = editor.mode === "delete";
  const form = useForm<{ reason: string }>({ defaultValues: { reason: "" }, resolver: zodResolver(z.object({ reason: z.string().max(500, "最多 500 字元").refine(value => !deactivating || !!value.trim(), "請填寫停用原因") })), shouldFocusError: false });
  const visibleFields: VisibleField<{ reason: string }>[] = deactivating ? [{ name: "reason", label: "停用原因" }] : [];
  usePreviewLeaveGuard(form.formState.isDirty);
  const basis = editor.basis;
  if (!basis) return null;
  const title = "key" in basis ? basis.key : basis.title;
  const shared = !deleting && !deactivating && "intendedVisibility" in basis && basis.intendedVisibility === "family";
  const disabled = !online || preview.blocked;
  return <EditorShell preview={preview} title={deleting ? "刪除記憶及版本" : deactivating ? "停用事實" : "核對並確認事實"}>
    <MemoryFormErrors form={form} fields={visibleFields} />
    <Text style={styles.title}>{title} · 基準版本 {basis.version}</Text>
    <Text style={styles.body}>{"key" in basis ? basis.content : basis.note}</Text>
    {"key" in basis ? <><Text style={styles.meta}>{factSourceLabel(basis.source)}</Text><Text style={styles.meta}>有效至：{basis.validUntil ?? "未設定"} · 來源：{basis.sourceState === "current" ? "目前版本" : "已更改"}</Text></> : null}
    {deleting ? <Text style={styles.warning}>將永久刪除這項記憶及全部修訂，不能從版本記錄還原。</Text> : deactivating ? <Text style={styles.meta}>停用後不再作為適用事實；內容與版本仍保留。</Text>
      : "intendedVisibility" in basis ? <Text style={styles.meta}>目前{visibilityLabels[basis.visibility]}；確認後{visibilityLabels[basis.intendedVisibility]}。請核對內容、來源及有效期。</Text> : null}
    {deactivating ? <FormField formId={formId} control={form.control} name="reason" label="停用原因" disabled={disabled} onEdit={() => { preview.controller.edit(); setReviewed(null); }} /> : null}
    <AppButton label={deleting ? "檢視刪除內容" : deactivating ? "預覽停用" : "預覽確認"} disabled={disabled} onPress={form.handleSubmit(values => { setReviewed(values); setAcknowledged(false); preview.controller.review(); }, errors => focusFirstInvalid(form, visibleFields, errors))} />
    {reviewed && preview.controller.operation.state === "needs_confirmation" ? <View style={styles.review}>
      <Text style={styles.title}>{deleting ? "第二次確認 · 永久刪除" : deactivating ? "明確確認停用" : "明確確認這項事實"}</Text>
      {deactivating ? <Text style={styles.body}>原因：{reviewed.reason}</Text> : null}
      {deleting || shared ? <Acknowledgement label={deleting ? "我明白會永久刪除這項記憶及全部版本" : "我已核對將公開的家庭共享內容及來源"} checked={acknowledged} onChange={() => setAcknowledged(value => !value)} disabled={disabled} /> : null}
      <AppButton label={deleting ? "確認永久刪除" : deactivating ? "確認停用事實" : "確認為已核對事實"} variant={deleting ? "danger" : "primary"} disabled={disabled || (deleting || shared) && !acknowledged} onPress={() => {
        if (editor.kind === "fact" && "key" in basis) {
          if (deleting) preview.submit({ kind: "delete_fact", basis });
          else if (deactivating) preview.submit({ kind: "deactivate_fact", basis, reason: reviewed.reason });
          else preview.submit({ kind: "confirm_fact", basis, sharedConfirmed: acknowledged });
        } else if ("title" in basis) preview.submit({ kind: "delete_topic", basis });
      }} />
    </View> : null}
  </EditorShell>;
}

export function MemoryEditorPanel({ preview, role, online }: { preview: MemoryPreviewController; role: MemoryRole; online: boolean }) {
  const editor = preview.editor;
  if (!editor) return <SectionCard><SectionHeader density="compact" title="核對及管理" /><Text style={styles.tool}>選擇一項記憶或話題，可核對來源、版本及範圍。新記憶會先建立私人候選；確認操作與共享需另行核對。</Text><Text style={styles.meta}>草稿只留在這個頁面。失敗會保留輸入；結果未知時先查核原操作。</Text></SectionCard>;
  const key = `${editor.kind}-${editor.mode}-${editor.basis?.id ?? "new"}`;
  if (editor.kind === "fact" && (editor.mode === "create" || editor.mode === "revise")) return <FactValuesEditor key={key} preview={preview} editor={editor} role={role} online={online} />;
  if (editor.kind === "topic" && editor.mode !== "delete") return <TopicValuesEditor key={key} preview={preview} editor={editor} role={role} online={online} />;
  return <LifecycleEditor key={key} preview={preview} editor={editor} online={online} />;
}

const styles = StyleSheet.create({
  field: { minWidth: 0, gap: spacing.xs },
  review: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg, gap: spacing.sm, minWidth: 0 },
  group: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, gap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  tool: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
});
