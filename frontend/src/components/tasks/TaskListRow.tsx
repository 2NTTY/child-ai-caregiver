import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../AppIcon";
import { AppStatusBadge } from "../AppStatusBadge";
import { colors, chineseFont, radius, readingType, spacing } from "../../theme";
import { taskStateLabels, type TaskView } from "../../task-view-model";

export function TaskListRow({ task, time, assignee, warning, selected, disabled, onPress, rowRef }: {
  task: TaskView; time: string; assignee: string; warning?: string | null; selected: boolean; disabled: boolean;
  onPress(): void; rowRef?(node: View | null): void;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const hint = selected ? "再次點按關閉詳情" : "查看事項詳情";
  const review = task.occurrence.state === "needs_review";
  const status = task.occurrence.state === "scheduled" ? task.kind === "appointment" ? "預約" : "待回報" : taskStateLabels[task.occurrence.state];
  return <Pressable ref={rowRef} testID={`task-row-${task.id}`} accessibilityRole="button"
    accessibilityLabel={`${hint}：${task.title}；${time}；${assignee}；${status}${warning ? `；${warning}` : ""}`}
    accessibilityState={{ selected, disabled }} aria-current={selected ? "true" : undefined} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, review && styles.review, (selected || hovered || focused) && styles.highlight, focused && styles.focused, pressed && !disabled && (selected || hovered || focused ? styles.selectedPressed : styles.pressed)]}>
    <View accessible={false} aria-hidden style={styles.leading}><AppIcon name={task.kind === "appointment" ? "calendar-clock-outline" : task.occurrence.state === "completed" ? "checkbox-marked" : "checkbox-blank-outline"} size={21} color={review ? colors.warningInk : colors.muted} /></View>
    <View style={styles.copy}><Text style={styles.title}>{task.title}</Text><View style={styles.metadata}>
      <Text style={styles.time}>{time}</Text><Text style={styles.assignee}>{assignee}</Text>
      <AppStatusBadge label={status} tone={review ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} />
    </View>{warning ? <Text style={styles.warning}>{warning}</Text> : null}</View>
    <AppIcon name={selected ? "chevron-left" : "chevron-right"} size={18} color={colors.muted} />
    {(hovered || focused) && !disabled ? <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>{hint}</Text></View> : null}
  </Pressable>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent", paddingHorizontal: spacing.sm, paddingVertical: spacing.lg, minHeight: 80, minWidth: 0 },
  leading: { alignSelf: "flex-start", paddingTop: 2 }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  time: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, flexShrink: 1 },
  assignee: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta }, review: { borderLeftColor: colors.statusWarmLine },
  highlight: { backgroundColor: colors.paleTeal, borderRadius: radius.small }, focused: { borderLeftColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
  hint: { position: "absolute", bottom: 2, right: spacing.sm, backgroundColor: colors.paleTeal, paddingHorizontal: 4, borderRadius: 3 },
  hintText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, lineHeight: 16 },
});
