import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { HelperText, Text } from "react-native-paper";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppDateField } from "../DateTimeFields";
import { profileAgeOptions, profileAgeUnitOptions, type ProfileFormValues } from "../../profile-view-model";
import { chineseFont, colors, spacing, typeScale } from "../../theme";
import { profileFormSchema } from "./profile-form";

export function ProfileForm({ initialValues, editable, canReview, draftOnly, onEdit, onReview }: {
  initialValues: ProfileFormValues; editable: boolean; canReview: boolean; draftOnly: boolean;
  onEdit: () => void; onReview: (values: ProfileFormValues) => void;
}) {
  const { control, handleSubmit } = useForm<ProfileFormValues>({ resolver: zodResolver(profileFormSchema), defaultValues: initialValues });
  const ageKind = useWatch({ control, name: "ageKind" });
  const [width, setWidth] = useState(0);
  const paired = width >= 560;
  const field = (name: Exclude<keyof ProfileFormValues, "ageKind" | "ageUnit">, label: string, multiline = false, placeholder?: string) =>
    <Controller key={name} control={control} name={name} render={({ field: input, fieldState }) => <View style={styles.field}>
      {["birthDate", "ageAsOf", "dueDate", "validUntil"].includes(name) ? <AppDateField label={label} value={input.value} disabled={!editable}
        onChange={value => { onEdit(); input.onChange(value); }} error={fieldState.error?.message} /> : <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} onBlur={input.onBlur}
        onChangeText={value => { onEdit(); input.onChange(value); }} editable={editable} disabled={!editable}
        error={!!fieldState.error} multiline={multiline} placeholder={placeholder} />}
      {fieldState.error && !["birthDate", "ageAsOf", "dueDate", "validUntil"].includes(name) ? <HelperText type="error" accessibilityRole="alert">{fieldState.error.message}</HelperText> : null}
    </View>} />;
  const pair = (first: ReactNode, second: ReactNode) => <View style={[styles.pair, paired && styles.pairWide]}>
    <View style={styles.pairItem}>{first}</View><View style={styles.pairItem}>{second}</View>
  </View>;
  return <View style={styles.form} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Controller control={control} name="ageKind" render={({ field: input }) => <AppSelect label="年齡資料" value={input.value} options={profileAgeOptions}
      disabled={!editable} onChange={value => { onEdit(); input.onChange(value); }} />} />
    {ageKind === "birth_date" ? field("birthDate", "出生日期（YYYY-MM-DD）", false, "例如 2023-02-14") : null}
    {ageKind === "approximate" ? <>
      {field("ageRaw", "約數年齡原值", false, "例如 3 個半；不轉成精確數值")}
      <Controller control={control} name="ageUnit" render={({ field: input }) => <AppSelect label="約數年齡單位" value={input.value} options={profileAgeUnitOptions}
        disabled={!editable} onChange={value => { onEdit(); input.onChange(value); }} />} />
      {field("ageAsOf", "約數年齡截至日期（YYYY-MM-DD）")}
    </> : null}
    {ageKind === "unknown" ? <Text style={styles.hint}>年齡未知，不會推算生日或精確年齡。</Text> : null}
    {pair(field("dueDate", "預產期（可空，YYYY-MM-DD）"), field("gestationalWeeksRaw", "出生孕週原文（可空）", false, "例如約 35 週"))}
    <Text style={styles.hint}>早產資料只保留原文；不會自動計算矯正年齡。未知欄位請留空。</Text>
    {pair(field("region", "地區（可空）"), field("language", "語言（可空）"))}
    {field("allergies", "過敏資料（可空）", true)}
    {field("specialNeeds", "特別需要（可空）", true)}
    {field("preferences", "照顧偏好（可空）", true)}
    {field("source", "資料來源（由你描述）", true, "例如家長提供；不自動引用私人聊天")}
    {field("validUntil", "資料有效至（可空，YYYY-MM-DD）")}
    {field("reason", "確認或更正原因", true)}
    <AppButton label={draftOnly ? "預覽本地檔案草稿" : "預覽家庭共享內容"} onPress={() => { void handleSubmit(onReview)(); }} disabled={!canReview} />
  </View>;
}
const styles = StyleSheet.create({
  form: { gap: spacing.md, width: "100%", minWidth: 0 }, field: { minWidth: 0, width: "100%" },
  pair: { gap: spacing.md }, pairWide: { flexDirection: "row", alignItems: "flex-start" }, pairItem: { flex: 1, minWidth: 0 },
  hint: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
