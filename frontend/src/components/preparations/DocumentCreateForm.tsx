import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { documentRequestSchema, type DocumentRequest } from "../../../../src/shared/family-documents";
import type { WriteOperationView } from "../../view-model";
import { preparationPurposes } from "../../preparation-view-model";
import { AppDateField } from "../DateTimeFields";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { chineseFont, colors, readingType, spacing } from "../../theme";

type Fields = { title: string; purpose: DocumentRequest["purpose"]; from: string; to: string; eventDate: string; reportMode: "fixed" | "living" };
export type DocumentFormOwner = {
  authorityVersion: string; locked: boolean; dirty: boolean; epoch: number; operation?: WriteOperationView;
  createDocument(request: DocumentRequest): void; markDraft(): void; discardDraft(): void;
};
export function DocumentCreateForm({ owner, kind, purpose = "appointment", allowFamily = true }: { owner: DocumentFormOwner; kind: DocumentRequest["kind"]; purpose?: DocumentRequest["purpose"]; allowFamily?: boolean }) {
  const id = useId(), [basis, setBasis] = useState<string | null>(null), [shared, setShared] = useState(false);
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const { control, handleSubmit, reset, setError, setFocus, watch, formState: { errors } } = useForm<Fields>({
    defaultValues: { title: "", purpose, from: "", to: "", eventDate: "", reportMode: "fixed" },
  });
  const stale = basis !== null && basis !== owner.authorityVersion, disabled = owner.locked || stale;
  const labels: Record<keyof Fields, string> = { title: "文件名稱", purpose: "用途", from: "來源期間開始日", to: "來源期間結束日", eventDate: "使用日期（可不填）", reportMode: "更新方式" };
  const living = kind === "growth_report" && watch("reportMode") === "living";
  useEffect(() => { reset({ title: "", purpose, from: "", to: "", eventDate: "", reportMode: "fixed" }); setBasis(null); setShared(false); }, [owner.epoch, reset]);
  useEffect(() => () => { const latest = latestOwner.current; if (latest.dirty) latest.discardDraft(); }, []);
  useEffect(() => { if (stale || owner.operation?.state === "conflict" || owner.operation?.state === "failed") setShared(false); }, [stale, owner.operation?.state]);
  const edited = () => { if (!basis) setBasis(owner.authorityVersion); owner.markDraft(); setShared(false); };
  const options = kind === "preparation" ? preparationPurposes.map(item => ({ value: item.key, label: item.label }))
    : [...(allowFamily ? [{ value: "family" as const, label: "家庭成長" }] : []), { value: "appointment" as const, label: "就診溝通" }, { value: "handoff" as const, label: "照顧交接" }, { value: "school" as const, label: "入園認識" }];
  const submit = handleSubmit(fields => {
    if (disabled || !shared || !basis) return;
    const parsed = documentRequestSchema.safeParse({ kind, title: fields.title, purpose: fields.purpose, eventDate: fields.eventDate || null,
      period: { from: fields.from, to: living ? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) : fields.to },
      ...(kind === "growth_report" ? { reportMode: fields.reportMode } : {}) });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "period" ? issue.path[1] === "from" ? "from" : "to" : issue.path[0] === "title" ? "title" : issue.path[0] === "eventDate" ? "eventDate" : "purpose";
        setError(key, { type: "validate", message: "請核對這項內容及來源期間。" });
      }
      return;
    }
    owner.createDocument(parsed.data);
  });
  return <View style={s.stack} testID={`document-create-${kind}`}>
    <Text style={s.meta}>需要時可直接按已共享的孩子資料整理文件。這裏不會使用私人對話正文，亦不會把整理結果當成新事實。</Text>
    {stale ? <Text style={s.warning}>授權基準已改變，原草稿保留；請放棄這份未提交草稿後重新核對。</Text> : null}
    <FormErrorSummary entries={(Object.keys(errors) as (keyof Fields)[]).map(field => ({ field, label: labels[field], message: errors[field]?.message ?? "請核對此項。" }))} onFocus={field => setFocus(field as keyof Fields)} />
    <Controller name="title" control={control} rules={{ required: "請填寫文件名稱。", maxLength: { value: 160, message: "最多 160 字。" } }}
      render={({ field }) => <View><AppTextField ref={field.ref} nativeID={`${id}-title`} label={labels.title} value={field.value} disabled={disabled}
        error={!!errors.title} onBlur={field.onBlur} onChangeText={value => { edited(); field.onChange(value); }} />
        <FormFieldMessage id={`${id}-title-error`} error={errors.title?.message} /></View>} />
    <Controller name="purpose" control={control} render={({ field }) => <AppSelect label={labels.purpose} value={field.value} options={options} disabled={disabled}
      onChange={value => { edited(); field.onChange(value); }} />} />
    {kind === "growth_report" ? <Controller name="reportMode" control={control} render={({ field }) => <AppSelect label={labels.reportMode}
      value={field.value} options={[{ value: "fixed", label: "指定期間（可選完整年度／季度）" }, { value: "living", label: "日常檔案（延展至當日，持續更新）" }]} disabled={disabled}
      onChange={value => { edited(); field.onChange(value); }} />} /> : null}
    {living ? <Text style={s.meta}>結束日由 Server 按香港當日延展，來源變更後沿同一份檔案整理。</Text> : null}
    {(["from", "to", "eventDate"] as const).filter(name => !living || name !== "to").map(name => <Controller key={name} name={name} control={control}
      rules={name === "eventDate" ? {} : { required: "請選擇來源期間。" }} render={({ field }) => <AppDateField ref={field.ref} id={`${id}-${name}`} label={labels[name]}
        value={field.value} disabled={disabled} error={errors[name]?.message} onBlur={field.onBlur} onChange={value => { edited(); field.onChange(value); }} />} />)}
    <AppCheckbox label="我已核對用途及期間，同意建立家庭共享文件" checked={shared} disabled={disabled}
      onChange={value => { if (!basis) setBasis(owner.authorityVersion); owner.markDraft(); setShared(value); }} />
    <View style={s.actions}><AppButton label={kind === "preparation" ? "整理這份準備單" : "整理這份成長報告"} disabled={disabled || !shared} onPress={submit} />
      {owner.dirty ? <AppButton label="放棄未提交草稿" variant="quiet" disabled={owner.operation?.state === "saving" || !!owner.operation?.recovery} onPress={owner.discardDraft} /> : null}</View>
  </View>;
}
const s = StyleSheet.create({ stack: { gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted }, warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk } });
