import { useContainerWidth } from "../useContainerWidth";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useId, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Controller, useForm, useWatch, useFormState } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text } from "react-native-paper";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppDateField } from "../DateTimeFields";
import { profileAgeOptions, profileAgeUnitOptions, type ProfileFormValues } from "../../profile-view-model";
import { chineseFont, colors, spacing, typeScale } from "../../theme";
import { profileFormSchema } from "./profile-form";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";

export function ProfileForm({ initialValues, editable, canReview, draftOnly, onEdit, onReview }: {
  initialValues: ProfileFormValues; editable: boolean; canReview: boolean; draftOnly: boolean;
  onEdit: () => void; onReview: (values: ProfileFormValues) => void;
}) {
  const formId = useId();
  const { control, handleSubmit, setFocus } = useForm<ProfileFormValues>({ resolver: zodResolver(profileFormSchema), defaultValues: initialValues, shouldFocusError: false });
  const { isDirty, errors } = useFormState({ control });
  usePreviewLeaveGuard(isDirty);
  const ageKind = useWatch({ control, name: "ageKind" });
  const fieldId = (name: keyof ProfileFormValues) => `${formId}-${name}`;
  const visibleFields: { field: keyof ProfileFormValues; label: string }[] = [{ field: "ageKind", label: "年齡資料" },
    ...(ageKind === "birth_date" ? [{ field: "birthDate" as const, label: "出生日期" }] : ageKind === "approximate" ? [{ field: "ageRaw" as const, label: "約數年齡原值" }, { field: "ageUnit" as const, label: "約數年齡單位" }, { field: "ageAsOf" as const, label: "約數年齡截至日期" }] : []),
    { field: "dueDate", label: "預產期" }, { field: "gestationalWeeksRaw", label: "出生孕週原文" }, { field: "region", label: "地區" }, { field: "language", label: "語言" }, { field: "allergies", label: "過敏資料" }, { field: "specialNeeds", label: "特別需要" }, { field: "preferences", label: "照顧偏好" }, { field: "source", label: "資料來源" }, { field: "validUntil", label: "資料有效至" }, { field: "reason", label: "確認或更正原因" }];
  const errorEntries = visibleFields.flatMap(item => errors[item.field]?.message ? [{ ...item, message: String(errors[item.field]?.message) }] : []);
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const paired = width >= 560;
  const field = (name: Exclude<keyof ProfileFormValues, "ageKind" | "ageUnit">, label: string, multiline = false, placeholder?: string) =>
    <Controller key={name} control={control} name={name} render={({ field: input, fieldState }) => <View style={styles.field}>
      {["birthDate", "ageAsOf", "dueDate", "validUntil"].includes(name) ? <AppDateField ref={input.ref} onBlur={input.onBlur} id={fieldId(name)} errorId={`${fieldId(name)}-message`} label={label} value={input.value} disabled={!editable}
        onChange={value => { onEdit(); input.onChange(value); }} error={fieldState.error?.message} /> : <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} onBlur={input.onBlur}
        onChangeText={value => { onEdit(); input.onChange(value); }} editable={editable} disabled={!editable}
        nativeID={fieldId(name)} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${fieldId(name)}-message` : undefined} error={!!fieldState.error} multiline={multiline} placeholder={placeholder} />}
      {!["birthDate", "ageAsOf", "dueDate", "validUntil"].includes(name) ? <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} /> : null}
    </View>} />;
  const pair = (first: ReactNode, second: ReactNode) => <View style={[styles.pair, paired && styles.pairWide]}>
    <View style={styles.pairItem}>{first}</View><View style={styles.pairItem}>{second}</View>
  </View>;
  return <View style={styles.form} ref={containerLayout.ref} onLayout={containerLayout.onLayout}>
    <FormErrorSummary entries={errorEntries} onFocus={name => setFocus(name as keyof ProfileFormValues)} />
    <View style={styles.group}><Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>年齡與出生資料</Text>
    <Controller control={control} name="ageKind" render={({ field: input }) => <AppSelect ref={input.ref} onBlur={input.onBlur} id={fieldId("ageKind")} label="年齡資料" value={input.value} options={profileAgeOptions}
      disabled={!editable} onChange={value => { onEdit(); input.onChange(value); }} />} />
    {ageKind === "birth_date" ? field("birthDate", "出生日期（YYYY-MM-DD）", false, "例如 2023-02-14") : null}
    {ageKind === "approximate" ? <>
      {field("ageRaw", "約數年齡原值", false, "例如 3 個半；不轉成精確數值")}
      <Controller control={control} name="ageUnit" render={({ field: input }) => <AppSelect ref={input.ref} onBlur={input.onBlur} id={fieldId("ageUnit")} label="約數年齡單位" value={input.value} options={profileAgeUnitOptions}
        disabled={!editable} onChange={value => { onEdit(); input.onChange(value); }} />} />
      {field("ageAsOf", "約數年齡截至日期（YYYY-MM-DD）")}
    </> : null}
    {ageKind === "unknown" ? <Text style={styles.hint}>年齡未知，不會推算生日或精確年齡。</Text> : null}
    {pair(field("dueDate", "預產期（可空，YYYY-MM-DD）"), field("gestationalWeeksRaw", "出生孕週原文（可空）", false, "例如約 35 週"))}
    <Text style={styles.hint}>早產資料只保留原文；不會自動計算矯正年齡。未知欄位請留空。</Text>
    </View>
    <View style={styles.group}><Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>日常照顧</Text><Text style={styles.hint}>只填已知資料；留空代表未知，並不代表沒有過敏或特別需要。</Text>
    {pair(field("region", "地區（可空）"), field("language", "語言（可空）"))}
    {field("allergies", "過敏資料（可空）", true)}
    {field("specialNeeds", "特別需要（可空）", true)}
    {field("preferences", "照顧偏好（可空）", true)}
    </View>
    <View style={styles.group}><Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>來源與這次更正</Text>
    {field("source", "資料來源（由你描述）", true, "例如家長提供；不自動引用私人聊天")}
    {field("validUntil", "資料有效至（可空，YYYY-MM-DD）")}
    {field("reason", "確認或更正原因", true)}
    </View>
    <View style={styles.saveBoundary}><Text style={styles.saveStatus}>{isDirty ? "有未保存的檔案草稿" : "先核對資料，再預覽共享內容"}</Text><Text style={styles.hint}>下一步先顯示核對內容；不會直接保存或家庭共享。</Text>
    <AppButton label={draftOnly ? "預覽本地檔案草稿" : "預覽家庭共享內容"} onPress={() => { void handleSubmit(onReview, invalid => {
      const first = visibleFields.find(item => invalid[item.field]?.message); if (first) setFocus(first.field);
    })(); }} disabled={!canReview} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  group: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  groupTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 24, fontWeight: "700" },
  saveBoundary: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  saveStatus: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 22, fontWeight: "700" },
  form: { gap: spacing.xl, width: "100%", minWidth: 0 }, field: { minWidth: 0, width: "100%" },
  pair: { gap: spacing.md }, pairWide: { flexDirection: "row", alignItems: "flex-start" }, pairItem: { flex: 1, minWidth: 0 },
  hint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
