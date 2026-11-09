import { CareTaskRowContent, careTaskRowStyle } from "../../preview/tasks-care-presentation/CareTaskRowContent";
import { getSourceRegionAppearance, type ModuleSourceVariant } from "../../preview/tasks-module-presentation02/source-region-appearance";
import { HandbookTaskRowContent, handbookTaskRowStyle } from "../../preview/tasks-handbook-presentation/HandbookTaskRowContent";
import type { HandbookRowDisplay } from "../../preview/tasks-handbook-presentation/presentation";
import { useState } from "react";
import { Pressable, StyleSheet, View, Platform } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../AppIcon";
import { AppStatusBadge } from "../AppStatusBadge";
import { colors, chineseFont, radius, readingType, spacing } from "../../theme";
import { taskStateLabels, type TaskView } from "../../task-view-model";

export type TaskRowAppearance = "harbour" | "fourth" | "handbook";

export function TaskListRow({ task, time, assignee, warning, selected, disabled, onPress, rowRef, history = false, taskRowAppearance, sourceAppearance }: {
  task: TaskView; time: string; assignee: string; warning?: string | null; selected: boolean; disabled: boolean;
  history?: boolean; onPress(): void; rowRef?(node: View | null): void; taskRowAppearance?: TaskRowAppearance; sourceAppearance?: ModuleSourceVariant;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const isCareAppearance = history === false && sourceAppearance === "care";
  const source = history === false && sourceAppearance ? getSourceRegionAppearance(sourceAppearance, false, Platform.OS === 'web' ? 'web' : 'native') : undefined;
  const fullRow = source?.row;
  const isHandbookAppearance = history === false && (sourceAppearance === "handbook" || taskRowAppearance === "handbook");
  const isFourthAppearance = history === false && taskRowAppearance === "fourth";
  const hint = selected ? "再次點按關閉詳情" : "查看事項詳情";
  const review = task.occurrence.state === "needs_review";
  const status = task.occurrence.state === "scheduled" ? task.kind === "appointment" ? "預約" : "待回報" : taskStateLabels[task.occurrence.state];
  const handbookRow: HandbookRowDisplay = { id: task.id, title: task.title, time, assignee, warning,
    statusLabel: status, statusTone: review ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info",
    review, selected, disabled, role: "button", toggleOnRepeat: true };
  return <Pressable ref={rowRef} testID={`task-row-${task.id}`} accessibilityRole="button"
    accessibilityLabel={`${hint}：${task.title}；${time}；${assignee}；${status}${warning ? `；${warning}` : ""}`}
    accessibilityState={{ selected, disabled }} aria-current={selected ? "true" : undefined} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => isCareAppearance ? careTaskRowStyle({selected,hovered,focused,pressed,disabled}) : fullRow
      ? [fullRow.row,review&&fullRow.review,selected&&fullRow.selected,(selected||hovered||focused)&&fullRow.highlight,focused&&fullRow.focused,pressed&&!disabled&&(selected||hovered||focused?fullRow.selectedPressed:fullRow.pressed)] : isHandbookAppearance ? handbookTaskRowStyle({ review, selected, hovered, focused, pressed, disabled }) : [styles.row, isFourthAppearance && styles.fourthRow, history && styles.historyRow, review && styles.review, isFourthAppearance && selected && styles.fourthSelected, (selected || hovered || focused) && styles.highlight, focused && styles.focused, pressed && !disabled && (selected || hovered || focused ? styles.selectedPressed : styles.pressed)]}>
    {isCareAppearance ? <CareTaskRowContent row={handbookRow} /> : isHandbookAppearance ? <HandbookTaskRowContent row={handbookRow} /> : <>
    <View accessible={false} aria-hidden style={fullRow?.leading ?? (isFourthAppearance ? styles.fourthLeading : styles.leading)}><AppIcon name={task.kind === "appointment" ? "calendar-clock-outline" : task.occurrence.state === "completed" ? "checkbox-marked" : "checkbox-blank-outline"} size={21} color={review ? source?.warningIconColor ?? colors.warningInk : source?.iconColor ?? colors.muted} /></View>
    <View style={fullRow?.copy ?? styles.copy}><Text numberOfLines={history ? 2 : undefined} style={fullRow?.title ?? styles.title}>{task.title}</Text>{history && task.details ? <Text numberOfLines={3} style={styles.summary}>{task.details}</Text> : null}<View style={fullRow?.metadata ?? styles.metadata}>
      <Text style={fullRow?.time ?? [styles.time, isFourthAppearance && styles.fourthTime]}>{time}</Text><Text style={fullRow?.assignee ?? styles.assignee}>{assignee}</Text>
      <AppStatusBadge appearance={source?.badge} label={status} tone={review ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} />
    </View>{warning ? <Text style={fullRow?.warning ?? styles.warning}>{warning}</Text> : null}</View>
    <AppIcon name={selected ? "chevron-left" : "chevron-right"} size={18} color={source?.iconColor ?? colors.muted} />
    </>}
  </Pressable>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent", paddingHorizontal: spacing.sm, paddingVertical: spacing.lg, minHeight: 80, minWidth: 0 },
  historyRow: { alignItems: "flex-start", paddingVertical: spacing.md, minHeight: 48 },
  summary: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  leading: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.small, backgroundColor: colors.quietSurface }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  time: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, flexShrink: 1 },
  assignee: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta }, review: { borderLeftColor: colors.statusWarmLine },
  highlight: { backgroundColor: colors.paleTeal, borderRadius: radius.small }, focused: { borderLeftColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
  fourthRow: { gap: spacing.sm },
  fourthLeading: { alignSelf: "flex-start", paddingTop: 2 },
  fourthTime: { fontVariant: ["tabular-nums"] },
  fourthSelected: { borderLeftColor: colors.teal },
});
