import { SettingsSection as SectionCard } from "./settings/SettingsSection";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Switch } from "./AppSwitch";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useId, useState } from "react";
import { usePreviewOperation } from "../preview/usePreviewOperation";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton, SectionHeader } from "./ui";
import { FormErrorSummary, FormFieldMessage } from "./FormErrorSummary";
import { StatusAnnouncement } from "./StatusAnnouncement";
import { PreviewWriteControls, PreviewWriteNotice } from "./PreviewWritePanel";
import { AppTimeField, AppTimeZoneSelect } from "./DateTimeFields";

const schema = z.object({
  timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "請填有效的 IANA 時區。"),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "請填 HH:mm，例如 22:00。"),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "請填 HH:mm，例如 08:00。"),
  allowAppointmentDuringQuiet: z.boolean(),
}).refine(values => values.quietStart !== values.quietEnd, { path: ["quietEnd"], message: "開始及結束時間須不同。" });
type Values = z.infer<typeof schema>;
const initial: Values = { timeZone: "Asia/Hong_Kong", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false };
const fields = [{ name: "timeZone", label: "通知時區" }, { name: "quietStart", label: "安靜時段開始" }, { name: "quietEnd", label: "安靜時段結束" }] as const;

export function PreferencesPreview({ online }: { online: boolean }) {
  const op = usePreviewOperation("account");
  const [saved, setSaved] = useState({ ...initial, version: 1 });
  const [basis, setBasis] = useState(1);
  const [review, setReview] = useState<Values | null>(null);
  const formId = useId();
  const form = useForm<Values>({ defaultValues: initial, resolver: zodResolver(schema), mode: "onSubmit", shouldFocusError: false });
  const fieldId = (name: keyof Values) => `${formId}-${name}`;
  const errorEntries = fields.flatMap(item => {
    const message = form.formState.errors[item.name]?.message;
    return message ? [{ field: item.name, label: item.label, message }] : [];
  });
  usePreviewLeaveGuard(form.formState.isDirty, false, "account");
  const locked = op.locked || op.operation.state === "conflict";
  function edited() { setReview(null); op.edit(); }
  function input(name: "timeZone" | "quietStart" | "quietEnd", label: string) {
    return <Controller name={name} control={form.control} render={({ field, fieldState }) => <View>
      {name === "timeZone" ? <AppTimeZoneSelect ref={field.ref} id={fieldId(name)} value={field.value} disabled={locked} onBlur={field.onBlur}
        invalid={!!fieldState.error} describedBy={fieldState.error ? `${fieldId(name)}-message` : undefined} onChange={value => { field.onChange(value); edited(); }} />
        : <AppTimeField ref={field.ref} id={fieldId(name)} errorId={`${fieldId(name)}-message`} label={label} value={field.value} disabled={locked} error={fieldState.error?.message} onBlur={field.onBlur} onChange={value => { field.onChange(value); edited(); }} />}
      {name === "timeZone" ? <FormFieldMessage id={`${fieldId(name)}-message`} error={fieldState.error?.message} /> : null}
    </View>} />;
  }
  return <SectionCard><SectionHeader density="compact" title="通知偏好" subtitle="只管理本人的安靜時段；設定不代表渠道已綁定或外發已獲授權。" />
    <StatusAnnouncement eventKey={String(online)} message={online ? "已恢復連線，可重新核對本人的通知偏好。" : "目前離線；可整理本次草稿，恢復連線後再確認。"} />
    <Text style={styles.meta}>合成示例 · 未接駁 Server · 已讀版本 {basis}</Text>
    {!online ? <Text style={styles.warning}>目前離線；可整理本次草稿，恢復連線後再確認。</Text> : null}
    <PreviewWriteNotice controller={op} online={online} />
    <FormErrorSummary entries={errorEntries} onFocus={name => {
      const target = fields.find(item => item.name === name);
      if (target) form.setFocus(target.name);
    }} />
    {input("timeZone", "通知時區")}
    <View style={styles.timeRow}><View style={styles.timeField}>{input("quietStart", "安靜時段開始預覽")}</View><View style={styles.timeField}>{input("quietEnd", "安靜時段結束預覽")}</View></View>
    <Controller name="allowAppointmentDuringQuiet" control={form.control} render={({ field }) => <View style={styles.switchRow}>
      <View style={styles.copy}><Text style={styles.title}>預約提醒例外</Text><Text style={styles.meta}>只在本人明確開啟後容許例外；預設關閉。</Text></View>
      <Switch accessibilityLabel="預約提醒例外預覽" value={field.value} disabled={locked} onValueChange={value => { field.onChange(value); edited(); }} />
    </View>} />
    <AppButton label="預覽通知偏好" disabled={locked} onPress={form.handleSubmit(values => { setReview(values); op.review(); }, errors => {
      const first = fields.find(item => errors[item.name]?.message);
      if (first) form.setFocus(first.name);
    })} />
    {review && op.operation.state === "needs_confirmation" ? <View style={styles.review}><Text style={styles.title}>待確認 · 尚未保存</Text><Text style={styles.body}>{review.timeZone}；安靜時段 {review.quietStart}–{review.quietEnd}；預約例外{review.allowAppointmentDuringQuiet ? "開啟" : "關閉"}。</Text>
      <AppButton label="模擬保存本人偏好" disabled={!online} onPress={() => op.submit(() => { const version = basis + 1; setSaved({ ...review, version }); setBasis(version); setReview(null); form.reset(review); }, () => { setSaved({ ...saved, quietStart: "21:30", version: basis + 1 }); setReview(null); })} />
    </View> : null}
    {op.operation.state === "conflict" ? <View style={styles.review}><Text style={styles.title}>最新版本 {saved.version}</Text><Text style={styles.body}>{saved.timeZone} · {saved.quietStart}–{saved.quietEnd}；預約例外{saved.allowAppointmentDuringQuiet ? "開啟" : "關閉"}。</Text><Text style={styles.meta}>上方是你的未保存草稿；不會自動覆蓋。</Text><AppButton label="保留草稿並使用最新版本" disabled={!online} onPress={() => { setBasis(saved.version); op.useLatest(); }} /></View> : null}
    <Text style={styles.meta}>設定頁籤之間會保留草稿；離頁須確認捨棄，待查操作須先處理。重新載入不能恢復本次草稿。實際接線使用既有 notification-preferences API。</Text>
    <PreviewWriteControls controller={op} />
  </SectionCard>;
}
const styles = StyleSheet.create({ timeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, timeField: { flexBasis: 180, flexGrow: 1, minWidth: 0 }, switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md }, copy: { flex: 1, minWidth: 0 }, title: { color: colors.ink, fontFamily: chineseFont, ...readingType.tool, fontWeight: "700" }, meta: { color: colors.muted, fontFamily: chineseFont, ...readingType.meta }, body: { color: colors.ink, fontFamily: chineseFont, ...readingType.tool }, warning: { color: colors.warningInk, fontFamily: chineseFont, ...readingType.tool }, review: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.md } });
