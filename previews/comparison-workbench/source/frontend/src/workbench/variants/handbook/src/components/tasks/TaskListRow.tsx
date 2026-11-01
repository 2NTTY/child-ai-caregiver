import type { Href } from "expo-router";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../AppIcon";
import { AppStatusBadge } from "../AppStatusBadge";
import { colors, chineseFont, readingType, spacing } from "../../theme";
import { taskStateLabels, type TaskView } from "../../task-view-model";

export function TaskListRow({ task, time, assignee, warning, selected, disabled, onPress, rowRef, href, history = false }: {
  task: TaskView; time: string; assignee: string; warning?: string | null; selected: boolean; disabled: boolean;
  href?: Href; history?: boolean; onPress(): void; rowRef?(node: View | null): void;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [pressed, setPressed] = useState(false);
  const hint = selected && !href ? "再次點按關閉詳情" : "查看事項詳情";
  const review = task.occurrence.state === "needs_review";
  const status = task.occurrence.state === "scheduled" ? task.kind === "appointment" ? "預約" : "待回報" : taskStateLabels[task.occurrence.state];
  const row = <Pressable ref={rowRef} testID={`task-row-${task.id}`} accessibilityRole={href ? "link" : "button"}
    accessibilityLabel={`${hint}：${task.title}；${time}；${assignee}；${status}${warning ? `；${warning}` : ""}`}
    accessibilityState={{ selected, disabled }} aria-current={selected ? "true" : undefined} aria-disabled={disabled}
    disabled={href ? undefined : disabled} onPress={href ? undefined : onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPressed(false); }} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.row, history && styles.historyRow, review && styles.review, (selected || hovered || focused) && styles.highlight, focused && styles.focused, pressed && !disabled && (selected || hovered || focused ? styles.selectedPressed : styles.pressed)])}>
    <View style={styles.copy}><View style={styles.metadata}><Text style={styles.time}>{time}</Text>
      <AppStatusBadge label={status} tone={review ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} />
    </View><Text numberOfLines={history ? 2 : undefined} style={styles.title}>{task.title}</Text>{history && task.details ? <Text numberOfLines={3} style={styles.summary}>{task.details}</Text> : null}
    <View style={styles.metadata}><AppIcon name="account-outline" size={14} color={colors.muted} /><Text style={styles.assignee}>{assignee}</Text></View>
    {warning ? <Text style={styles.warning}>{warning}</Text> : null}</View>
    <AppIcon name={selected ? "chevron-left" : "chevron-right"} size={18} color={colors.muted} />
  </Pressable>;
  return href ? <PreviewLink href={href} disabled={disabled} onAccepted={onPress}>{row}</PreviewLink> : row;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent", paddingHorizontal: spacing.sm, paddingVertical: spacing.lg, minHeight: 104, minWidth: 0 },
  historyRow: { alignItems: "flex-start", paddingVertical: spacing.md, minHeight: 48 },
  summary: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  leading: { alignSelf: "flex-start", paddingTop: 2 }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 17, lineHeight: 27, fontWeight: "700" },
  time: { fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] },
  assignee: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta }, review: { borderLeftColor: colors.statusWarmLine },
  highlight: { backgroundColor: colors.paleTeal }, focused: { borderLeftColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
});
