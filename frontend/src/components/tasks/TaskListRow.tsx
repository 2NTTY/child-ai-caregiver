import { Link, type Href } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppStatusBadge } from "../AppStatusBadge";
import { colors, chineseFont, readingType, spacing } from "../../theme";
import { taskStateLabels, type TaskView } from "../../task-view-model";

export function TaskListRow({ task, time, assignee, warning, selected, disabled, onPress, rowRef, history = false, href }: {
  task: TaskView; time: string; assignee: string; warning?: string | null; selected: boolean; disabled: boolean;
  history?: boolean; href?: Href; onPress(): void; rowRef?(node: View | null): void;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [pressed, setPressed] = useState(false);
  const hint = "查看事項詳情";
  const review = task.occurrence.state === "needs_review";
  const status = review ? "待覆核 · 已停催" : task.occurrence.state === "scheduled" ? task.kind === "appointment" ? "預約" : "待回報" : taskStateLabels[task.occurrence.state];
  const row = <Pressable ref={rowRef} testID={`task-row-${task.id}`} accessibilityRole={href ? "link" : "button"}
    accessibilityLabel={`${hint}：${task.title}；${time}；${assignee}；${status}${warning ? `；${warning}` : ""}`}
    accessibilityState={{ selected, disabled }} aria-current={selected ? "true" : undefined} aria-disabled={disabled}
    disabled={disabled} onPress={href ? undefined : onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.row, selected && styles.selected, (hovered || pressed) && !disabled && styles.highlight, focused && styles.focused])}>
    <View style={styles.heading}><Text style={styles.title}>{task.title}</Text><AppStatusBadge label={status} tone={review ? "warning" : task.occurrence.state === "completed" ? "success" : "neutral"} /></View>
    <Text style={styles.metadata}>{time} · 負責人 {assignee}</Text>
    {history && task.details ? <Text numberOfLines={3} style={styles.summary}>{task.details}</Text> : null}
    {warning ? <Text style={styles.warning}>{warning}</Text> : null}
  </Pressable>;
  if (!href || disabled) return row;
  // The existing adapter owns guard/close publication and navigation. The href is
  // for native link semantics and modified clicks, never a second ordinary push.
  return <Link href={href} asChild onPress={event => {
    if (Platform.OS === "web") {
      const click = event as unknown as React.MouseEvent<HTMLElement>, input = click.nativeEvent ?? click;
      if (click.defaultPrevented || input.defaultPrevented || input.metaKey || input.ctrlKey || input.shiftKey || input.altKey || input.button !== undefined && input.button !== 0) return;
    }
    event.preventDefault(); onPress();
  }}>{row}</Link>;
}
const styles = StyleSheet.create({
  row: { minWidth: 0, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: "transparent", backgroundColor: colors.white },
  heading: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  title: { flexGrow: 1, flexBasis: 160, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600" },
  metadata: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  summary: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  selected: { backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.teal },
  highlight: { backgroundColor: colors.paleTeal },
  focused: { outlineColor: colors.ink, outlineStyle: "solid", outlineWidth: 2, outlineOffset: -2 },
});
