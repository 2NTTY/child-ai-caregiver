import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { careKindOptions, type CareFormValues, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, radius, readingType, spacing, typeScale } from "../../theme";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { careReadingStyles } from "./care-styles";
import { careFormSchema } from "./care-form";
import { CareRevisionContent, CareValueSummary } from "./CareRecordDetail";

const formFields = [
  { name: "kind", label: "記錄種類" },
  { name: "text", label: "記錄原文" },
  { name: "source", label: "資料來源" },
  { name: "eventTimeRaw", label: "事件時間原文" },
  { name: "quantityRaw", label: "數量原文" },
  { name: "quantityUnit", label: "單位" },
  { name: "quantityPrecision", label: "數量精度" },
  { name: "reason", label: "更正原因" },
] as const;

function CareEditorSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <View style={careReadingStyles.section}><View style={careReadingStyles.sectionHeading}><Text accessibilityRole="header" aria-level={3} style={careReadingStyles.sectionTitle}>{title}</Text><Text style={careReadingStyles.body}>{description}</Text></View>{children}</View>;
}
function CareReviewPanel({ children, ref }: { children: ReactNode; ref?: Ref<View> }) { return <View ref={ref} tabIndex={-1} accessibilityLabel="核對家庭共享記錄" testID="care-record-review" style={careReadingStyles.review}>{children}</View>; }

export function CareRecordForm({ model, actions }: { model: CareRecordsViewModel; actions: CareRecordsActions }) {
  const draft = model.draft!;
  const formId = useId();
  const { control, handleSubmit, getValues, setFocus, formState: { isDirty, errors } } = useForm<CareFormValues>({ defaultValues: draft.initialValues, resolver: zodResolver(careFormSchema(draft.mode)), mode: "onSubmit", shouldFocusError: false });
  const visibleFields = formFields.filter(item => item.name !== "reason" || draft.mode === "revise");
  const errorEntries = visibleFields.flatMap(item => {
    const message = errors[item.name]?.message;
    return message ? [{ field: item.name, label: item.label, message }] : [];
  });
  const fieldId = (name: keyof CareFormValues) => `${formId}-${name}`;
  usePreviewLeaveGuard(isDirty);
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const busy = ["saving", "unknown"].includes(model.operation.state);
  useEffect(() => {
    if (Platform.OS !== "web" || (!isDirty && !busy)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, busy]);
  function field(name: "text" | "source" | "quantityRaw" | "quantityUnit" | "eventTimeRaw" | "reason", label: string, accessibilityLabel: string, help?: string, multiline = false) {
    return <Controller name={name} control={control} render={({ field: input, fieldState }) => <View>
      <AppTextField ref={input.ref} nativeID={fieldId(name)} label={label} accessibilityLabel={accessibilityLabel} multiline={multiline} value={input.value} onBlur={input.onBlur} disabled={locked}
        error={!!fieldState.error?.message} aria-invalid={!!fieldState.error?.message} aria-describedby={fieldState.error?.message || help ? `${fieldId(name)}-message` : undefined}
        onChangeText={value => { input.onChange(value); actions.editDraft(); }} />
      <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} help={help} />
    </View>} />;
  }
  const stage = draft.reviewedValues && model.operation.state !== "conflict" ? "review" : "edit";
  const reviewRef = useRef<View>(null);
  const editorRef = useRef<View>(null);
  const previousStage = useRef(stage);
  useEffect(() => {
    const changed = previousStage.current !== stage;
    previousStage.current = stage;
    if (!changed || Platform.OS !== "web") return;
    if (stage === "review") (reviewRef.current as unknown as HTMLElement | null)?.focus();
    else if (!locked) (editorRef.current as unknown as HTMLElement | null)?.focus();
  }, [stage, locked]);
  return <SectionCard surface="plain"><SectionHeader density="compact" title={stage === "review" ? "確認這筆記錄" : draft.captureSnapshot ? "調整待確認提案" : draft.mode === "create" ? "新增共享記錄" : "更正記錄"}
    subtitle={draft.basis ? `以版本 ${draft.basis.current.version} 作基準；草稿尚未保存。` : "填寫後先核對內容及家庭共享範圍。"} />
    <View ref={editorRef} tabIndex={-1} accessibilityLabel="編輯照顧記錄" testID="care-editor-fields" style={[styles.editorFields, stage === "review" && styles.hidden]} aria-hidden={stage === "review"} accessibilityElementsHidden={stage === "review"} importantForAccessibility={stage === "review" ? "no-hide-descendants" : "auto"}>
    {draft.captureSnapshot ? <View style={styles.review}><Text style={styles.label}>原始輸入（保留不改寫）</Text>
      {model.review?.items.find(item => item.id === draft.captureId)?.sourceState === "ready" ? <Text selectable style={styles.instruction}>{draft.captureSnapshot.originalText}</Text> : <Text style={styles.noticeTitle}>原始來源已變更或不可用，舊原文暫不顯示；請重新核對提案。</Text>}
      <Text style={styles.instruction}>只調整下方將要寫入的內容；私人原文不會自動共享。</Text></View> : null}
    <FormErrorSummary entries={errorEntries} onFocus={name => {
      const target = visibleFields.find(item => item.name === name);
      if (target) setFocus(target.name);
    }} />
    <CareEditorSection title="記下發生的事" description="保留觀察原意，不需要補成精確數字或時間。">
    <Controller name="kind" control={control} render={({ field: input, fieldState }) => <View>
      <AppSelect ref={input.ref} id={fieldId("kind")} label="記錄種類" value={input.value} options={careKindOptions} disabled={locked} onBlur={input.onBlur}
        invalid={!!fieldState.error?.message} describedBy={fieldState.error?.message ? `${fieldId("kind")}-message` : undefined}
        onChange={value => { input.onChange(value); actions.editDraft(); }} />
      <FormFieldMessage id={`${fieldId("kind")}-message`} error={fieldState.error?.message} />
    </View>} />
    {field("text", "記錄原文", "記錄原文草稿", undefined, true)}
    </CareEditorSection>
    <CareEditorSection title="來源與事件時間" description="讓家人知道這筆內容從哪裏來、何時發生。">
    {field("source", "資料來源", "資料來源草稿", "例如由我觀察；共享記錄不會公開私人聊天。")}
    {field("eventTimeRaw", "事件時間原文（可留空）", "事件時間草稿", "保留原時間說法。更改文字不會自動推算精準時間；留空表示未知。")}
    <Text style={styles.instruction}>目前這個表單只保存時間原文。未確認實際事件日期／時間的記錄，不會納入按期間計算的照顧摘要；加入日期不能代替事件時間。</Text>
    </CareEditorSection>
    <CareEditorSection title="數量補充" description="沒有記下數量可留空；有數量時請一併填寫單位。">
    <View style={styles.quantity}><View style={styles.quantityField}>{field("quantityRaw", "數量原文（可留空）", "數量原文草稿")}</View>
      <View style={styles.quantityField}>{field("quantityUnit", "單位（與數量一起填寫）", "數量單位草稿")}</View></View>
    <Controller name="quantityPrecision" control={control} render={({ field: input, fieldState }) => <View>
      <AppSelect ref={input.ref} id={fieldId("quantityPrecision")} label="數量精度" value={input.value} options={[{ value: "approximate", label: "約數" }, { value: "exact", label: "精確" }]} disabled={locked} onBlur={input.onBlur}
        invalid={!!fieldState.error?.message} describedBy={fieldState.error?.message ? `${fieldId("quantityPrecision")}-message` : undefined}
        onChange={value => { input.onChange(value); actions.editDraft(); }} />
      <FormFieldMessage id={`${fieldId("quantityPrecision")}-message`} error={fieldState.error?.message} />
    </View>} />
    </CareEditorSection>
    {draft.mode === "revise" ? <CareEditorSection title="這次為何更正" description="原因會保留在更正歷史，方便家人核對。">{field("reason", "更正原因", "更正原因草稿")}</CareEditorSection> : null}
    <View style={styles.previewActions}><Text style={styles.instruction}>離線時可整理本次表單；關閉、重新載入或切換孩子會清除草稿。</Text>
    <AppButton label="預覽共享內容" disabled={locked} onPress={handleSubmit(actions.reviewDraft, invalidFields => {
      const first = visibleFields.find(item => invalidFields[item.name]?.message);
      if (first) setFocus(first.name);
    })} /></View>
    </View>
    {draft.reviewedValues ? <CareReviewPanel ref={reviewRef}><Text style={styles.noticeTitle}>待確認 · 尚未保存</Text>
      <CareValueSummary values={draft.reviewedValues} /><Text style={styles.instruction}>與孩子所屬家庭共享。這次確認不代表已通知照顧者，也不代表預約機構已確認。</Text>
      <AppButton label={model.submitLabel} onPress={actions.submitReviewed} disabled={!model.online || model.list.state === "loading" || model.operation.state !== "needs_confirmation"} loading={model.operation.state === "saving"} />
      <AppButton label="繼續修改" variant="quiet" disabled={busy} onPress={actions.editDraft} />
    </CareReviewPanel> : null}
    {model.operation.state === "conflict" && model.operation.latest && draft.basis ? <View style={styles.review}>
      <Text style={styles.noticeTitle}>比較版本，再決定更正</Text><Text style={styles.label}>原基準 · 版本 {draft.basis.current.version}</Text><CareRevisionContent revision={draft.basis.current} />
      <Text style={styles.label}>最新 · 版本 {model.operation.latest.current.version}</Text><CareRevisionContent revision={model.operation.latest.current} />
      <Text style={styles.label}>你的未保存草稿</Text><CareValueSummary values={getValues()} />
      <AppButton label="保留草稿並使用最新版本" disabled={!model.online} onPress={actions.useLatestVersion} />
      <Text style={styles.instruction}>只有你明確選擇才會換基準；之後仍須重新預覽及確認。</Text>
    </View> : null}
    {model.operation.state === "unknown" ? <Text style={styles.instruction}>表單已鎖定。查核原操作後才可知道是否已保存；請勿另建一次提交。</Text> : null}
  </SectionCard>;
}

const styles = StyleSheet.create({
  instruction: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  hidden: { display: "none" },
  editorFields: { minWidth: 0, gap: spacing.xl },
  previewActions: { minWidth: 0, gap: spacing.lg, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  quantity: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, quantityField: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  review: { gap: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md },
  noticeTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 18, fontWeight: "700", lineHeight: 27 },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
});
