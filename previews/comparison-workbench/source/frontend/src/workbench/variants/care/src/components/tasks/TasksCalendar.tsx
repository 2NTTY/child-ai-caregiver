import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import type { TaskScheduleContext, TaskView } from "../../task-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { useContainerWidth } from "../useContainerWidth";
import { AppButton, AppSelect } from "../ui";
import { projectTaskCalendar, shiftTaskCalendarMonth, taskCalendarDayLabel, type TaskCalendarDay } from "./task-calendar";

function CalendarDay({ day, current, selected, disabled, onPress }: {
  day: TaskCalendarDay; current: boolean; selected: boolean; disabled: boolean; onPress(): void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable testID={`task-calendar-day-${day.date}`} accessibilityRole="button"
    accessibilityLabel={`${taskCalendarDayLabel(day)}${current ? "；資料基準日" : ""}${selected ? "；已選取，再按取消日期篩選" : ""}`}
    accessibilityState={{ selected, disabled }} aria-pressed={selected} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.day, selected && styles.selectedDay, focused && styles.focused, disabled && styles.disabled, pressed && !disabled && (selected ? styles.selectedPressed : styles.pressed)]}>
    <View style={[styles.dayNumber, current && styles.currentDay]}><Text style={[styles.dayText, selected && styles.selectedText]}>{day.day}</Text></View>
    <View accessible={false} aria-hidden style={styles.dots}>
      {day.scheduled > 0 ? <View style={[styles.dot, styles.scheduledDot]} /> : null}
      {day.review > 0 ? <View style={[styles.dot, styles.reviewDot]} /> : null}
    </View>
  </Pressable>;
}

function MonthNavigation({ direction, disabled, onPress }: { direction: "previous" | "next"; disabled: boolean; onPress(): void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={direction === "previous" ? "上一個月" : "下一個月"} disabled={disabled} aria-disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.monthButton, focused && styles.focused, disabled && styles.disabled, pressed && !disabled && styles.pressed]}><AppIcon name={direction === "previous" ? "chevron-left" : "chevron-right"} size={20} color={colors.ink} /></Pressable>;
}
function CompactMonthPicker({ days, selectedDay, disabled, onSelectDay }: { days: TaskCalendarDay[]; selectedDay: string | null; disabled: boolean; onSelectDay(day: string | null): void }) {
  // The same dates remain reachable without shrinking seven touch targets into a phone-width row.
  return <View testID="task-calendar-compact-picker" style={styles.compactPicker}><AppSelect label="選擇日期" value={selectedDay ?? ""}
    options={[{ value: "", label: "不限制日期" }, ...(selectedDay && !days.some(day => day.date === selectedDay) ? [{ value: selectedDay, label: `已選 ${selectedDay}（其他月份）` }] : []), ...days.map(day => ({ value: day.date, label: taskCalendarDayLabel(day) }))]}
    disabled={disabled} onChange={value => onSelectDay(value || null)} /><Text style={styles.note}>選取日期後，清單只顯示當日已載入的事項。</Text></View>;
}

export function TasksCalendar({ items, context, selectedDay, month, disabled, onSelectDay, onChangeMonth }: {
  items: readonly TaskView[]; context: TaskScheduleContext; selectedDay: string | null;
  month: string | null; disabled: boolean; onSelectDay(day: string | null): void; onChangeMonth(month: string | null): void;
}) {
  const layout = useContainerWidth();
  const compact = layout.width < 388;
  const calendar = projectTaskCalendar(items, context, month);
  const currentLabel = calendar.currentDay ? DateTime.fromISO(calendar.currentDay, { zone: context.timeZone }).toFormat("M月d日") : null;
  function moveMonth(amount: number) {
    if (disabled || !calendar.month) return;
    onChangeMonth(shiftTaskCalendarMonth(calendar.month, amount));
  }
  return <View ref={layout.ref} onLayout={layout.onLayout} testID="tasks-calendar" style={styles.calendar}>
    <Text style={styles.eyebrow}>按日查看</Text>
    <View style={styles.header}>
      <Text accessibilityRole="header" aria-level={2} accessibilityLiveRegion="polite" style={styles.month}>{calendar.label}</Text>
      <View style={styles.monthActions}>
        <MonthNavigation direction="previous" disabled={disabled || !calendar.month} onPress={() => moveMonth(-1)} />
        <MonthNavigation direction="next" disabled={disabled || !calendar.month} onPress={() => moveMonth(1)} />
      </View>
    </View>
    {calendar.weeks.length ? compact ? <CompactMonthPicker days={calendar.weeks.flatMap(week => week.filter((day): day is TaskCalendarDay => day !== null))} selectedDay={selectedDay} disabled={disabled} onSelectDay={onSelectDay} /> : <View style={styles.grid}>
      <View accessible={false} aria-hidden style={styles.week}>{["一", "二", "三", "四", "五", "六", "日"].map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
      {calendar.weeks.map((week, index) => <View key={index} style={styles.week}>{week.map((day, column) => day
        ? <CalendarDay key={day.date} day={day} current={calendar.currentDay === day.date} selected={selectedDay === day.date} disabled={disabled} onPress={() => onSelectDay(day.date)} />
        : <View key={`empty-${column}`} style={styles.emptyDay} />)}</View>)}
    </View> : <Text style={styles.note}>未有有效的資料日期或時區，請先查看清單。</Text>}
    {!compact ? <View style={styles.legend}>
      <View style={styles.legendItem}><View accessible={false} style={[styles.dot, styles.scheduledDot]} /><Text style={styles.note}>待辦／預約</Text></View>
      <View style={styles.legendItem}><View accessible={false} style={[styles.dot, styles.reviewDot]} /><Text style={styles.note}>待覆核</Text></View>
    </View> : null}
    <View style={styles.actions}>
      {selectedDay ? <AppButton label="取消日期篩選" accessibilityLabel="只取消日期篩選，保留搜尋及原有範圍" variant="quiet" density="compact" disabled={disabled} onPress={() => onSelectDay(null)} /> : null}
      {calendar.currentDay ? <AppButton label={`回到 ${currentLabel}`} accessibilityLabel={`回到資料基準日所在月份 ${calendar.currentDay}`} variant="quiet" density="compact" disabled={disabled} onPress={() => onChangeMonth(null)} /> : null}
    </View>
    <Text style={styles.note}>以 {context.timeZone} 顯示 · 只計已載入事項</Text>
    {calendar.unconfirmedCount > 0 ? <Text style={styles.warning}>{calendar.unconfirmedCount} 項日期待核對，可從清單範圍選擇查看。</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  calendar: { width: "100%", minWidth: 0, alignSelf: "flex-start", padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.neutralSurface, borderRadius: radius.small },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  compactPicker: { gap: spacing.md, minWidth: 0 },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  month: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: "700", flexShrink: 1 },
  monthActions: { flexDirection: "row", gap: spacing.sm }, monthButton: { width: 44, minHeight: 44, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center", borderRadius: radius.small },
  grid: { gap: spacing.sm }, week: { flexDirection: "row", minWidth: 0, gap: spacing.sm },
  weekday: { flex: 1, minWidth: 0, textAlign: "center", fontFamily: chineseFont, color: colors.muted, ...readingType.tool, paddingVertical: spacing.xs },
  day: { flex: 1, minWidth: 44, minHeight: 48, alignItems: "center", justifyContent: "center", paddingVertical: 3, borderWidth: 1, borderColor: "transparent", borderRadius: radius.small },
  emptyDay: { flex: 1, minWidth: 0 }, dayNumber: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent", borderRadius: radius.pill },
  dayText: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24 }, selectedText: { fontWeight: "700" },
  currentDay: { borderColor: colors.controlOutline }, selectedDay: { backgroundColor: colors.paleTeal, borderColor: colors.ink },
  focused: { outlineColor: colors.teal, outlineStyle: "solid", outlineWidth: 2 }, disabled: { opacity: 0.5 }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 8 }, dot: { width: 6, height: 6, borderRadius: radius.pill },
  scheduledDot: { backgroundColor: colors.ink }, reviewDot: { backgroundColor: colors.statusWarmLine },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs }, legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
});
