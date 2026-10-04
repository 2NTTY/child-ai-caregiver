import { useId, useMemo, useRef, useState, type Ref } from "react";
import { Keyboard, Modal, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { HelperText, Portal, Text, TextInput, useTheme } from "react-native-paper";
import { AppDialog as Dialog } from "./AppDialog";
import { DatePickerModalContent, TimePicker, registerTranslation, zhTW } from "react-native-paper-dates";
import { MotionBackdrop, MotionEntrance } from "../motion";
import { MotionPaperScope } from "../motion/MotionPaperScope";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import { calendarDate, calendarValue, dateTimeParts, dateTimeValue, hongKongTimeZone, timeZoneLabel, timeZoneOptions } from "./date-time";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField } from "./ui";

registerTranslation("zh-HK", { ...zhTW, save: "選用日期" });

type FieldProps = { label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; disabled?: boolean; error?: string; id?: string; errorId?: string; describedBy?: string };
type TextFieldProps = FieldProps & { ref?: Ref<React.ElementRef<typeof TextInput>> };
function webEscape(dismiss: () => void) {
  return Platform.OS === "web" ? { onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
  } } : {};
}
function DatePickerDialog({ label, value, visible, onConfirm, onDismiss, onClosed }: { label: string; value: string; visible: boolean; onConfirm: (value: string) => void; onDismiss: () => void; onClosed: () => void }) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const date = useMemo(() => calendarDate(value), [value]);
  return <Modal visible={visible} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onDismiss} onDismiss={onClosed}
    supportedOrientations={["portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"]} statusBarTranslucent>
    <MotionPaperScope><View style={styles.dateRoot}>
      <MotionBackdrop open={visible} onPress={onDismiss} />
      <MotionEntrance preset="dialog" triggerKey="date-picker" scopeKey={label} animateOnMount role="dialog" aria-modal accessibilityViewIsModal accessibilityLabel={label} testID="app-date-picker"
        style={[styles.dateSurface, width > 650 && styles.dateSurfaceBig, { backgroundColor: theme.colors.elevation.level3 }]}>
        <DatePickerModalContent locale="zh-HK" mode="single" date={date} onDismiss={onDismiss} onConfirm={({ date: selected }) => { if (selected) onConfirm(calendarValue(selected)); else onDismiss(); }} />
      </MotionEntrance>
    </View></MotionPaperScope>
  </Modal>;
}
function TimePickerDialog({ label, value, onConfirm, onDismiss }: { label: string; value: string; onConfirm: (value: string) => void; onDismiss: () => void }) {
  const { width, height } = useWindowDimensions();
  const [hours, setHours] = useState(/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) : 9);
  const [minutes, setMinutes] = useState(/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(3)) : 0);
  const [focused, setFocused] = useState<"hours" | "minutes">("hours");
  const [inputType, setInputType] = useState<"keyboard" | "picker">("keyboard");
  const canUseClock = width >= 360 && (width <= height || width >= 580);
  const actualInputType = canUseClock ? inputType : "keyboard";
  const landscapeClock = actualInputType === "picker" && width > height;
  const valid = Number.isInteger(hours) && hours >= 0 && hours < 24 && Number.isInteger(minutes) && minutes >= 0 && minutes < 60;
  // The official landscape clock needs 536px internally; keep keyboard mode
  // in narrower layouts without resetting the user's local time values.
  return <Portal><Dialog visible testID="app-time-picker" onDismiss={onDismiss} style={[styles.timeDialog, landscapeClock && { width: Math.min(width - 16, 600), maxWidth: 600 }]} {...webEscape(onDismiss)}><Dialog.Title>{label}</Dialog.Title>
    <Dialog.ScrollArea style={{ paddingHorizontal: landscapeClock ? 12 : 24 }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.timeContent}>
    <TimePicker locale="zh-HK" hours={hours} minutes={minutes} focused={focused} onFocusInput={setFocused} inputType={actualInputType} inputFontSize={typeScale.hero} use24HourClock
      onChange={next => { setHours(next.hours); setMinutes(next.minutes); if (next.focused) setFocused(next.focused); }} />
    {!valid ? <HelperText type="error">請輸入有效的小時及分鐘。</HelperText> : null}
    </ScrollView></Dialog.ScrollArea><Dialog.Actions>
    {canUseClock ? <AppButton label={actualInputType === "keyboard" ? "使用時鐘選擇" : "使用鍵盤輸入"} variant="quiet" onPress={() => { Keyboard.dismiss(); setInputType(current => current === "keyboard" ? "picker" : "keyboard"); }} /> : null}
    <AppButton label="取消" variant="quiet" onPress={onDismiss} /><AppButton label="選用時間" disabled={!valid}
    onPress={() => onConfirm(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`)} /></Dialog.Actions></Dialog></Portal>;
}
export function AppDateField({ label, value, onChange, onBlur, disabled = false, error, ref, id, errorId, describedBy }: TextFieldProps) {
  const generatedId = useId();
  const messageId = errorId ?? `${generatedId}-error`;
  const [open, setOpen] = useState(false);
  const field = useRef<React.ElementRef<typeof TextInput>>(null);
  const restoreFocus = useRef(false);
  function dismiss() { restoreFocus.current = true; setOpen(false); }
  function closed() {
    if (restoreFocus.current && !open && !disabled && Platform.OS === "web") field.current?.focus();
    restoreFocus.current = false;
  }
  return <View><AppTextField nativeID={id} aria-invalid={!!error} aria-describedby={[describedBy, error ? messageId : undefined].filter(Boolean).join(" ") || undefined} ref={instance => { field.current = instance; if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} label={label} accessibilityLabel={label} value={value} onChangeText={onChange} onBlur={onBlur} disabled={disabled} error={!!error}
    placeholder="YYYY-MM-DD" right={<TextInput.Icon icon="calendar-month-outline" accessibilityLabel={`選擇${label}`} disabled={disabled} onPress={() => { restoreFocus.current = false; setOpen(true); }} />} />
    {error ? <HelperText nativeID={messageId} type="error">{error}</HelperText> : null}
    <DatePickerDialog label={label} value={value} visible={open && !disabled} onDismiss={dismiss} onClosed={closed} onConfirm={next => { onChange(next); dismiss(); }} />
  </View>;
}
export function AppTimeField({ label, value, onChange, onBlur, disabled = false, error, ref, id, errorId, describedBy }: TextFieldProps) {
  const generatedId = useId();
  const messageId = errorId ?? `${generatedId}-error`;
  const [open, setOpen] = useState(false);
  const field = useRef<React.ElementRef<typeof TextInput>>(null);
  function dismiss() { setOpen(false); if (Platform.OS === "web") field.current?.focus(); }
  return <View><AppTextField nativeID={id} aria-invalid={!!error} aria-describedby={[describedBy, error ? messageId : undefined].filter(Boolean).join(" ") || undefined} ref={instance => { field.current = instance; if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} label={label} accessibilityLabel={label} value={value} onChangeText={onChange} onBlur={onBlur} disabled={disabled} error={!!error} placeholder="HH:mm"
    right={<TextInput.Icon icon="clock-outline" accessibilityLabel={`選擇${label}`} disabled={disabled} onPress={() => setOpen(true)} />} />
    {error ? <HelperText nativeID={messageId} type="error">{error}</HelperText> : null}
    {open && !disabled ? <TimePickerDialog label={label} value={value} onDismiss={dismiss} onConfirm={next => { onChange(next); dismiss(); }} /> : null}
  </View>;
}
export function AppTimeZoneSelect({ value, onChange, onBlur, disabled = false, ref, id, invalid, describedBy }: { value: string; onChange: (value: string) => void; onBlur?: () => void; disabled?: boolean; ref?: Ref<View>; id?: string; invalid?: boolean; describedBy?: string }) {
  const options = timeZoneOptions.some(item => item.value === value) ? timeZoneOptions : [...timeZoneOptions, { value, label: `${value}（原設定）` }];
  return <AppSelect ref={ref} id={id} invalid={invalid} describedBy={describedBy} label="時區" value={value} options={options} onChange={onChange} onBlur={onBlur} disabled={disabled} />;
}
export function AppDateTimeField({ label, value, onChange, onBlur, disabled = false, error, timeZone = hongKongTimeZone, optional = false, ref, id, errorId, describedBy }: FieldProps & { timeZone?: string; optional?: boolean; ref?: Ref<View> }) {
  const generatedId = useId();
  const messageId = errorId ?? `${generatedId}-error`;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const anchor = useRef<View>(null);
  const parts = dateTimeParts(value, timeZone);
  function dismiss() { setOpen(false); if (Platform.OS === "web") (anchor.current as unknown as HTMLElement | null)?.focus(); }
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text><Text style={styles.summary}>{parts ? `${parts.date} · ${parts.time} · ${timeZoneLabel(timeZone)}` : "尚未選擇日期與時間"}</Text>
    <AppSelectionTrigger id={id} invalid={!!error} describedBy={[describedBy, error ? messageId : undefined].filter(Boolean).join(" ") || undefined} ref={instance => { anchor.current = instance; if (typeof ref === "function") ref(instance); else if (ref) ref.current = instance; }} label={`選擇${label}`} disabled={disabled} expanded={open} onBlur={onBlur} calendar onPress={() => {
      setDate(parts?.date ?? ""); setTime(parts?.time ?? ""); setLocalError(null); setOpen(true);
    }} />
    {optional && value ? <AppButton label={`清除${label}`} variant="quiet" disabled={disabled} onPress={() => onChange("")} /> : null}
    {error ? <HelperText nativeID={messageId} type="error">{error}</HelperText> : null}
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
  dialog: { width: "92%", maxWidth: 480, alignSelf: "center", marginHorizontal: 0 },
  dateRoot: { flex: 1, alignItems: "center", justifyContent: "center" },
  dateSurface: { flex: 1, width: "100%" }, dateSurfaceBig: { maxWidth: 400, maxHeight: 600, borderRadius: 28, overflow: "hidden" },
  timeDialog: { width: "92%", maxWidth: 400, alignSelf: "center", marginHorizontal: 0 }, timeContent: { alignItems: "center", paddingVertical: spacing.sm, gap: spacing.sm } });
