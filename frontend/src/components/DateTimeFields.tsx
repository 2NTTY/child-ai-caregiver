import { useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { HelperText, Portal, Text, TextInput } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { DatePickerModal, TimePicker, TimePickerModal, registerTranslation, zhTW } from "react-native-paper-dates";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import { calendarDate, calendarValue, dateTimeParts, dateTimeValue, hongKongTimeZone, timeZoneLabel, timeZoneOptions } from "./date-time";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField } from "./ui";

registerTranslation("zh-HK", { ...zhTW, save: "選用日期" });

type FieldProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; error?: string };
function webEscape(dismiss: () => void) {
  return Platform.OS === "web" ? { onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
  } } : {};
}
function CompactTimeDialog({ label, value, onConfirm, onDismiss }: { label: string; value: string; onConfirm: (value: string) => void; onDismiss: () => void }) {
  const [hours, setHours] = useState(/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) : 9);
  const [minutes, setMinutes] = useState(/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(3)) : 0);
  const [focused, setFocused] = useState<"hours" | "minutes">("hours");
  const valid = Number.isInteger(hours) && hours >= 0 && hours < 24 && Number.isInteger(minutes) && minutes >= 0 && minutes < 60;
  // The library's analog modal has a 328px minimum; its public keyboard component fits a 320px viewport.
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog} {...webEscape(onDismiss)}><Dialog.Title>{label}</Dialog.Title><Dialog.Content>
    <TimePicker locale="zh-HK" hours={hours} minutes={minutes} focused={focused} onFocusInput={setFocused} inputType="keyboard" inputFontSize={typeScale.hero} use24HourClock
      onChange={value => { setHours(value.hours); setMinutes(value.minutes); }} />
    {!valid ? <HelperText type="error">請輸入有效的小時及分鐘。</HelperText> : null}
  </Dialog.Content><Dialog.Actions><AppButton label="取消" variant="quiet" onPress={onDismiss} /><AppButton label="選用時間" disabled={!valid}
    onPress={() => onConfirm(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`)} /></Dialog.Actions></Dialog></Portal>;
}
export function AppDateField({ label, value, onChange, disabled = false, error }: FieldProps) {
  const [open, setOpen] = useState(false);
  const field = useRef<React.ElementRef<typeof TextInput>>(null);
  function dismiss() { setOpen(false); if (Platform.OS === "web") field.current?.focus(); }
  return <View><AppTextField ref={field} label={label} accessibilityLabel={label} value={value} onChangeText={onChange} disabled={disabled} error={!!error}
    placeholder="YYYY-MM-DD" right={<TextInput.Icon icon="calendar-month-outline" accessibilityLabel={`選擇${label}`} disabled={disabled} onPress={() => setOpen(true)} />} />
    {error ? <HelperText type="error">{error}</HelperText> : null}
    {open && !disabled ? <DatePickerModal locale="zh-HK" mode="single" visible animationType="none" date={calendarDate(value)} onDismiss={dismiss}
      onConfirm={({ date }) => { if (date) onChange(calendarValue(date)); dismiss(); }} /> : null}
  </View>;
}
export function AppTimeField({ label, value, onChange, disabled = false, error }: FieldProps) {
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const field = useRef<React.ElementRef<typeof TextInput>>(null);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function dismiss() { setOpen(false); if (Platform.OS === "web") field.current?.focus(); }
  return <View><AppTextField ref={field} label={label} accessibilityLabel={label} value={value} onChangeText={onChange} disabled={disabled} error={!!error} placeholder="HH:mm"
    right={<TextInput.Icon icon="clock-outline" accessibilityLabel={`選擇${label}`} disabled={disabled} onPress={() => setOpen(true)} />} />
    {error ? <HelperText type="error">{error}</HelperText> : null}
    {open && !disabled && width < 360 ? <CompactTimeDialog label={label} value={value} onDismiss={dismiss} onConfirm={next => { onChange(next); dismiss(); }} /> : null}
    {open && !disabled && width >= 360 ? <TimePickerModal locale="zh-HK" visible animationType="none" label={label} cancelLabel="取消" confirmLabel="選用時間" use24HourClock
      hours={valid ? Number(value.slice(0, 2)) : 9} minutes={valid ? Number(value.slice(3)) : 0} defaultInputType="keyboard" onDismiss={dismiss}
      onConfirm={({ hours, minutes }) => { onChange(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`); dismiss(); }} /> : null}
  </View>;
}
export function AppTimeZoneSelect({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const options = timeZoneOptions.some(item => item.value === value) ? timeZoneOptions : [...timeZoneOptions, { value, label: `${value}（原設定）` }];
  return <AppSelect label="時區" value={value} options={options} onChange={onChange} disabled={disabled} />;
}
export function AppDateTimeField({ label, value, onChange, disabled = false, error, timeZone = hongKongTimeZone, optional = false }: FieldProps & { timeZone?: string; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const anchor = useRef<View>(null);
  const parts = dateTimeParts(value, timeZone);
  function dismiss() { setOpen(false); if (Platform.OS === "web") (anchor.current as unknown as HTMLElement | null)?.focus(); }
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text><Text style={styles.summary}>{parts ? `${parts.date} · ${parts.time} · ${timeZoneLabel(timeZone)}` : "尚未選擇日期與時間"}</Text>
    <AppSelectionTrigger ref={anchor} label={`選擇${label}`} disabled={disabled} expanded={open} calendar onPress={() => {
      setDate(parts?.date ?? ""); setTime(parts?.time ?? ""); setLocalError(null); setOpen(true);
    }} />
    {optional && value ? <AppButton label={`清除${label}`} variant="quiet" disabled={disabled} onPress={() => onChange("")} /> : null}
    {error ? <HelperText type="error">{error}</HelperText> : null}
    {open && !disabled ? <Portal><Dialog visible onDismiss={dismiss} style={styles.dialog} {...webEscape(dismiss)}><Dialog.Title>{label}</Dialog.Title>
      <Dialog.ScrollArea><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.fields}>
        <Text style={styles.summary}>以{timeZoneLabel(timeZone)}輸入。選用後仍須預覽及確認。</Text>
        <AppDateField label={`${label}日期`} value={date} onChange={setDate} /><AppTimeField label={`${label}時間`} value={time} onChange={setTime} />
        {localError ? <HelperText type="error" accessibilityRole="alert">{localError}</HelperText> : null}
      </ScrollView></Dialog.ScrollArea><Dialog.Actions><AppButton label="取消" variant="quiet" onPress={dismiss} />
        <AppButton label={`選用${label}`} onPress={() => { const result = dateTimeValue(date, time, timeZone); if (result.value === null) setLocalError(result.error); else { onChange(result.value); dismiss(); } }} />
      </Dialog.Actions></Dialog></Portal> : null}
  </View>;
}
const styles = StyleSheet.create({ field: { gap: spacing.sm }, label: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700", color: colors.ink },
  summary: { fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 22, color: colors.muted }, fields: { paddingVertical: spacing.md, gap: spacing.md },
  dialog: { width: "92%", maxWidth: 480, alignSelf: "center", marginHorizontal: 0 } });
