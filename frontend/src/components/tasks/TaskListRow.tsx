import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useContainerWidth } from "../useContainerWidth";
import { AppIcon } from "../AppIcon";
import { AppStatusBadge } from "../AppStatusBadge";
import { colors, chineseFont, radius, readingType, spacing } from "../../theme";
import { taskStateLabels, type TaskView } from "../../task-view-model";

export function TaskListRow({ task, time, assignee, warning, selected, disabled, onPress, rowRef, history = false }: {
  task: TaskView; time: string; assignee: string; warning?: string | null; selected: boolean; disabled: boolean;
  history?: boolean; onPress(): void; rowRef?(node: View | null): void;
}) {
  const layout = useContainerWidth();
  const compact = layout.width < 420;
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const hint = selected ? "再次點按關閉詳情" : "查看事項詳情";
  const review = task.occurrence.state === "needs_review";
  const status = task.occurrence.state === "scheduled" ? task.kind === "appointment" ? "預約" : "待回報" : taskStateLabels[task.occurrence.state];
  return <Pressable ref={node => { layout.ref.current = node; rowRef?.(node); }} onLayout={layout.onLayout} testID={`task-row-${task.id}`} accessibilityRole="button"
    accessibilityLabel={`${hint}：${task.title}；${time}；${assignee}；${status}${warning ? `；${warning}` : ""}`}
    accessibilityState={{ selected, disabled }} aria-current={selected ? "true" : undefined} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, compact && styles.compactRow, history && styles.historyRow, review && styles.review, (selected || hovered || focused) && styles.highlight, focused && styles.focused, pressed && !disabled && (selected || hovered || focused ? styles.selectedPressed : styles.pressed)]}>
    <View style={[styles.timeBlock, compact && styles.compactTime]}><AppIcon name={task.kind === "appointment" ? "calendar-clock-outline" : task.occurrence.state === "completed" ? "checkbox-marked" : "clock-outline"} size={18} color={review ? colors.warningInk : colors.deepTeal} /><Text style={styles.time}>{time}</Text></View>
    <View style={styles.rowBody}><View style={styles.copy}><Text numberOfLines={history ? 2 : undefined} style={styles.title}>{task.title}</Text>{history && task.details ? <Text numberOfLines={3} style={styles.summary}>{task.details}</Text> : null}<View style={styles.metadata}>
      <Text style={styles.assignee}>負責人 · {assignee}</Text>
      <AppStatusBadge label={status} tone={review ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} />
    </View>{warning ? <Text style={styles.warning}>{warning}</Text> : null}</View>
    <AppIcon name={selected ? "chevron-left" : "chevron-right"} size={18} color={colors.muted} /></View>
  </Pressable>;
}
const styles = StyleSheet.create({
  compactRow: { flexDirection: "column", alignItems: "stretch" },
  compactTime: { width: "100%", flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md },
  timeBlock: { width: 96, flexShrink: 0, gap: spacing.sm, alignItems: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 0, backgroundColor: colors.white, borderLeftWidth: 3, borderLeftColor: "transparent", paddingHorizontal: spacing.md, paddingVertical: spacing.lg, minHeight: 80, minWidth: 0 },
  historyRow: { alignItems: "flex-start", paddingVertical: spacing.md, minHeight: 48 },
  summary: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  leading: { alignSelf: "flex-start", paddingTop: 2 }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  time: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  assignee: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool }, review: { borderLeftColor: colors.statusWarmLine },
  highlight: { backgroundColor: colors.paleTeal, borderRadius: radius.small }, focused: { borderLeftColor: colors.teal, outlineColor: colors.teal, outlineStyle: "solid", outlineWidth: 2 }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
});
