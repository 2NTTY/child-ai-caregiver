import { useContainerWidth } from "../useContainerWidth";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useId, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Controller, useForm, useWatch, useFormState, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text } from "react-native-paper";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppDateField } from "../DateTimeFields";
import { profileAgeOptions, profileAgeUnitOptions, type ProfileFormValues } from "../../profile-view-model";
import { chineseFont, colors, spacing, readingType } from "../../theme";
import { profileFormSchema } from "./profile-form";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";

type EditorBindings = {control: Control<ProfileFormValues>; editable: boolean; onEdit: () => void; formId: string};
type TextFieldName = Exclude<keyof ProfileFormValues, "ageKind" | "ageUnit">;
const dateFields = new Set<TextFieldName>(["birthDate", "ageAsOf", "dueDate", "validUntil"]);

// Fields receive the existing form owner; sections only compose its controls.
function ProfileField({editor, name, label, multiline = false, placeholder}: {
  editor: EditorBindings; name: TextFieldName; label: string; multiline?: boolean; placeholder?: string;
}) {
  const id = `${editor.formId}-${name}`;
  return <Controller control={editor.control} name={name} render={({field: input, fieldState}) => <View style={styles.field}>
    {dateFields.has(name) ? <AppDateField ref={input.ref} onBlur={input.onBlur} id={id} errorId={`${id}-message`} label={label} value={input.value} disabled={!editor.editable}
      onChange={value => {editor.onEdit(); input.onChange(value);}} error={fieldState.error?.message} /> : <AppTextField ref={input.ref} label={label} accessibilityLabel={label} value={input.value} onBlur={input.onBlur}
      onChangeText={value => {editor.onEdit(); input.onChange(value);}} editable={editor.editable} disabled={!editor.editable}
      nativeID={id} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${id}-message` : undefined} error={!!fieldState.error} multiline={multiline} placeholder={placeholder} />}
    {!dateFields.has(name) ? <FormFieldMessage id={`${id}-message`} error={fieldState.error?.message} /> : null}
  </View>} />;
}

function ProfileSection({number, title, description, children}: {number: string; title: string; description: string; children: ReactNode}) {
  return <View style={styles.section} testID={`profile-editor-section-${number}`}>
    <View style={styles.sectionHeading}><Text style={styles.sectionNumber}>{number}</Text><View style={styles.sectionCopy}>
      <Text accessibilityRole="header" aria-level={3} style={styles.sectionTitle}>{title}</Text><Text style={styles.body}>{description}</Text>
    </View></View>
    <View style={styles.sectionFields}>{children}</View>
  </View>;
}
function FieldPair({wide, children}: {wide: boolean; children: ReactNode}) {
  return <View style={[styles.pair, wide && styles.pairWide]}>{children}</View>;
}

export function ProfileForm({initialValues, editable, canReview, draftOnly, onEdit, onReview}: {
  initialValues: ProfileFormValues; editable: boolean; canReview: boolean; draftOnly: boolean;
  onEdit: () => void; onReview: (values: ProfileFormValues) => void;
}) {
  const formId = useId();
  const {control, handleSubmit, setFocus} = useForm<ProfileFormValues>({resolver: zodResolver(profileFormSchema), defaultValues: initialValues, shouldFocusError: false});
  const {isDirty, errors} = useFormState({control});
  usePreviewLeaveGuard(isDirty);
  const ageKind = useWatch({control, name: "ageKind"});
  const editor = {control, editable, onEdit, formId};
  const visibleFields: {field: keyof ProfileFormValues; label: string}[] = [{field: "ageKind", label: "年齡資料"},
    ...(ageKind === "birth_date" ? [{field: "birthDate" as const, label: "出生日期"}] : ageKind === "approximate" ? [{field: "ageRaw" as const, label: "約數年齡原值"}, {field: "ageUnit" as const, label: "約數年齡單位"}, {field: "ageAsOf" as const, label: "約數年齡截至日期"}] : []),
    {field: "dueDate", label: "預產期"}, {field: "gestationalWeeksRaw", label: "出生孕週原文"}, {field: "region", label: "地區"}, {field: "language", label: "語言"}, {field: "allergies", label: "過敏資料"}, {field: "specialNeeds", label: "特別需要"}, {field: "preferences", label: "照顧偏好"}, {field: "source", label: "資料來源"}, {field: "validUntil", label: "資料有效至"}, {field: "reason", label: "確認或更正原因"}];
  const errorEntries = visibleFields.flatMap(item => errors[item.field]?.message ? [{...item, message: String(errors[item.field]?.message)}] : []);
  const containerLayout = useContainerWidth();
  const paired = containerLayout.width >= 640;
  return <View style={styles.form} ref={containerLayout.ref} onLayout={containerLayout.onLayout} testID="profile-editor">
    <View style={styles.introduction}>
      <Text style={styles.eyebrow}>孩子檔案 · 資料核對</Text>
      <Text accessibilityRole="header" aria-level={2} style={styles.editorTitle}>讓照顧的人了解孩子</Text>
      <Text style={styles.body}>填寫你已知的資料，未確定的可以留空。預覽並確認後，才會更新共享檔案。</Text>
      <View style={styles.meaningRow}>
        <View style={styles.meaning}><Text style={styles.meaningTitle}>已知</Text><Text style={styles.body}>按來源填寫，保留原意與約數。</Text></View>
        <View style={styles.meaning}><Text style={styles.meaningTitle}>未知</Text><Text style={styles.body}>留空不代表「沒有」，亦不會代你推算。</Text></View>
      </View>
    </View>
    <FormErrorSummary entries={errorEntries} onFocus={name => setFocus(name as keyof ProfileFormValues)} />
    <ProfileSection number="01" title="年齡與出生資料" description="先選擇你掌握的資料種類，不需要為了填滿欄位而猜測。">
      <Controller control={control} name="ageKind" render={({field: input}) => <AppSelect ref={input.ref} onBlur={input.onBlur} id={`${formId}-ageKind`} label="年齡資料" value={input.value} options={profileAgeOptions}
        disabled={!editable} onChange={value => {onEdit(); input.onChange(value);}} />} />
      <View style={styles.ageBasis} testID="profile-age-interpretation">
        <Text style={styles.meaningTitle}>{ageKind === "birth_date" ? "按出生日期記錄" : ageKind === "approximate" ? "保留約數，不轉成精確年齡" : "年齡暫時未知"}</Text>
        <Text style={styles.body}>{ageKind === "birth_date" ? "只填已確認的日期；只有大概年齡時，請改選約數。" : ageKind === "approximate" ? "保留你輸入的原值，並註明這個年齡所對應的日期。" : "年齡未知，不會推算生日或精確年齡。"}</Text>
      </View>
      {ageKind === "birth_date" ? <ProfileField editor={editor} name="birthDate" label="出生日期（YYYY-MM-DD）" /> : null}
      {ageKind === "approximate" ? <>
        <FieldPair wide={paired}><View style={[styles.pairItem, paired && styles.pairItemWide]}><ProfileField editor={editor} name="ageRaw" label="約數年齡原值" placeholder="例如 3 個半…" /></View>
          <View style={[styles.pairItem, paired && styles.pairItemWide]}><Controller control={control} name="ageUnit" render={({field: input}) => <AppSelect ref={input.ref} onBlur={input.onBlur} id={`${formId}-ageUnit`} label="約數年齡單位" value={input.value} options={profileAgeUnitOptions}
            disabled={!editable} onChange={value => {onEdit(); input.onChange(value);}} />} /></View></FieldPair>
        <ProfileField editor={editor} name="ageAsOf" label="約數年齡截至日期（YYYY-MM-DD）" />
      </> : null}
      <FieldPair wide={paired}><View style={[styles.pairItem, paired && styles.pairItemWide]}><ProfileField editor={editor} name="dueDate" label="預產期（可空，YYYY-MM-DD）" /></View>
        <View style={[styles.pairItem, paired && styles.pairItemWide]}><ProfileField editor={editor} name="gestationalWeeksRaw" label="出生孕週原文（可空）" placeholder="例如約 35 週…" /></View></FieldPair>
      <Text style={styles.body}>早產資料只保留原文；不會自動計算矯正年齡。未知欄位請留空。</Text>
    </ProfileSection>
    <ProfileSection number="02" title="日常照顧" description="讓家人知道平日如何照顧；留空並不代表沒有過敏或特別需要。">
      <FieldPair wide={paired}><View style={[styles.pairItem, paired && styles.pairItemWide]}><ProfileField editor={editor} name="region" label="地區（可空）" /></View>
        <View style={[styles.pairItem, paired && styles.pairItemWide]}><ProfileField editor={editor} name="language" label="語言（可空）" /></View></FieldPair>
      <ProfileField editor={editor} name="allergies" label="過敏資料（可空）" multiline />
      <ProfileField editor={editor} name="specialNeeds" label="特別需要（可空）" multiline />
      <ProfileField editor={editor} name="preferences" label="照顧偏好（可空）" multiline />
    </ProfileSection>
    <ProfileSection number="03" title="資料從哪裏來" description="記下來源與這次核對的原因，方便日後了解每個版本的依據。">
      <ProfileField editor={editor} name="source" label="資料來源（由你描述）" multiline placeholder="例如家長提供…" />
      <Text style={styles.body}>私人聊天不會自動引用為檔案來源。</Text>
      <ProfileField editor={editor} name="validUntil" label="資料有效至（可空，YYYY-MM-DD）" />
      <ProfileField editor={editor} name="reason" label="確認或更正原因" multiline />
    </ProfileSection>
    <View style={styles.saveBoundary}>
      <View style={styles.saveCopy}><Text style={styles.meaningTitle}>{isDirty ? "有未保存的檔案草稿" : "下一步：核對共享內容"}</Text><Text style={styles.body}>先預覽，再確認。此步不會直接保存或家庭共享。</Text></View>
      <AppButton label={draftOnly ? "預覽本地檔案草稿" : "預覽家庭共享內容"} onPress={() => {void handleSubmit(onReview, invalid => {
        const first = visibleFields.find(item => invalid[item.field]?.message); if (first) setFocus(first.field);
      })();}} disabled={!canReview} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  form: {gap: spacing.xl, width: "100%", minWidth: 0},
  introduction: {gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.xl},
  eyebrow: {fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: "700"},
  editorTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: "700"},
  meaningRow: {flexDirection: "row", flexWrap: "wrap", gap: spacing.lg},
  meaning: {flexBasis: 220, flexGrow: 1, flexShrink: 1, maxWidth: "100%", minWidth: 0, gap: spacing.xs},
  meaningTitle: {fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700"},
  body: {fontFamily: chineseFont, color: colors.muted, ...readingType.body, flexShrink: 1},
  section: {gap: spacing.lg, minWidth: 0},
  sectionHeading: {flexDirection: "row", alignItems: "flex-start", gap: spacing.md, minWidth: 0},
  sectionNumber: {fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: "700", paddingTop: 3, minWidth: 24},
  sectionCopy: {gap: spacing.xs, flex: 1, minWidth: 0},
  sectionTitle: {fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700"},
  sectionFields: {gap: spacing.lg, paddingBottom: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.line},
  ageBasis: {gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.teal, paddingLeft: spacing.md, paddingVertical: spacing.sm},
  field: {minWidth: 0, width: "100%"},
  pair: {gap: spacing.lg, minWidth: 0}, pairWide: {flexDirection: "row", alignItems: "flex-start"}, pairItem: {minWidth: 0}, pairItemWide: {flex: 1, minWidth: 0},
  saveBoundary: {gap: spacing.lg, alignItems: "flex-start", paddingBottom: spacing.sm},
  saveCopy: {gap: spacing.xs, minWidth: 0},
});
