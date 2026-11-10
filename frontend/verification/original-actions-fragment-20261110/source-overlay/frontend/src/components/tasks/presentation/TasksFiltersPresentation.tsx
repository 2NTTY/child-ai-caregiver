import { Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { DateTime } from "luxon";
import { AppIcon } from "../../AppIcon";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, UnderlineTabs } from "../../ui";
import { chineseFont, colors, readingType, spacing } from "../../../theme";
import type { TaskBacklogFilter } from "../task-calendar";
import { taskSearchAppearance, taskTabsAppearance, handbookFilterHeadingStyle } from "./taskFilterAppearance";
import { taskSelectionAppearance } from "./taskSelectionAppearance";
import { CareWorkspaceSwitch } from "./CareWorkspaceSwitch";
import { isTaskPresentationVariant, type TaskFiltersPresentationProps, type TaskPresentationTab } from "./contracts";

const filters: ReadonlyArray<{ key: TaskBacklogFilter; label: string }> = [
  { key: "near", label: "近期 7 天" }, { key: "earlier", label: "較早未處理" },
  { key: "later", label: "之後" }, { key: "all", label: "全部" },
  { key: "review", label: "待覆核" }, { key: "unconfirmed", label: "時間待核對" },
];
const labels: Record<TaskBacklogFilter, string> = {
  near: "近期 7 天", earlier: "較早未處理", later: "之後", all: "全部日期", review: "待覆核", unconfirmed: "時間待核對",
};

export type TasksFiltersSearchProps = Omit<TaskFiltersPresentationProps, "variant" | "region"> & {
  variant?: TaskFiltersPresentationProps["variant"];
};

/** Keep one search/select producer while admitted appearance data comes and goes. */
export function TasksFiltersSearch(p: TasksFiltersSearchProps) {
  if (p.variant !== undefined && !isTaskPresentationVariant(p.variant)) return null;
  const { variant, occupied, tab, filter, query, selectedDay, backlog } = p;
  const selectionAppearance = taskSelectionAppearance(variant);
  const searchAppearance = taskSearchAppearance(variant);
  if (tab !== "pending" || p.readUnavailable || p.noPendingTasks) return null;
  const activate = (callback: () => void) => { if (!occupied) callback(); };
  const changeFilter = (value: TaskBacklogFilter | "day") => { if (value !== "day") activate(() => p.onChangeFilter(value)); };
  return <View style={styles.backlogToolbar}>
    <View style={variant === "handbook" ? styles.handbookSearch : styles.searchField}>
      <AppTextField appearance={searchAppearance} dense label="搜尋已載入事項" accessibilityLabel="搜尋已載入事項"
        placeholder={variant === undefined || variant === "harbour" ? "例如：覆診、水樽或負責人…" : variant === "fourth" ? "標題、內容或負責人" : "標題、內容或負責人…"}
        value={query} disabled={occupied} right={query ? <TextInput.Icon theme={searchAppearance?.theme} icon="close" accessibilityLabel="清除搜尋" disabled={occupied} onPress={() => activate(p.onClearQuery)} /> : undefined}
        onChangeText={value => activate(() => p.onChangeQuery(value))} />
    </View>
    <AppSelect<TaskBacklogFilter | "day"> label="範圍" value={selectedDay ? "day" : filter} options={[
      ...(selectedDay ? [{ value: "day" as const, label: DateTime.fromISO(selectedDay).toFormat("M月d日") }] : []),
      ...filters.filter(item => item.key !== "unconfirmed" || backlog.counts.unconfirmed > 0 || filter === item.key)
        .map(item => ({ value: item.key, label: item.label, count: backlog.counts[item.key] })),
    ]} appearance={selectionAppearance} disabled={occupied} onChange={changeFilter} />
    {p.calendarTriggerVisible ? <AppSelectionTrigger label={selectedDay ? "日期 · 已選" : "日期"} calendar expanded={p.calendarOpen}
      appearance={selectionAppearance} disabled={occupied} onPress={() => activate(p.onToggleCalendar)} /> : null}
  </View>;
}

/** Presentation regions preserve existing header, panel, list and empty-state placement. */
export function TasksFiltersPresentation(p: TaskFiltersPresentationProps) {
  if (!isTaskPresentationVariant(p.variant)) return null;
  const { variant, region, occupied, tab, filter, query, selectedDay, backlog } = p;
  const care = variant === "care";
  const pendingControls = tab === "pending" && !p.readUnavailable && !p.noPendingTasks;
  const activate = (callback: () => void) => { if (!occupied) callback(); };
  const changeFilter = (value: TaskBacklogFilter | "day") => { if (value !== "day") activate(() => p.onChangeFilter(value)); };
  if (region === "tabs") {
    const items: ReadonlyArray<{ key: TaskPresentationTab; label: string; count?: string }> = [
      { key: "pending", label: "待處理", count: p.readUnavailable ? undefined : `${p.openCount}${p.hasMoreTasks ? "+" : ""}` },
      { key: "completed", label: "已完成" },
    ];
    const onChange = (next: TaskPresentationTab) => activate(() => p.onChangeTab(next));
    if (care) return <CareWorkspaceSwitch id={p.tabsId} label="事項分類" items={items} value={tab} onChange={onChange} />;
    const tabs = <UnderlineTabs appearance={taskTabsAppearance(variant)} id={p.tabsId} label="事項分類" items={items} value={tab} onChange={onChange} />;
    return variant === "handbook" ? <View style={[styles.listHeading, handbookFilterHeadingStyle]}>{tabs}</View> : tabs;
  }
  if (region === "review") {
    if (p.readUnavailable || backlog.counts.review <= 0) return null;
    const count = backlog.counts.review;
    const active = tab === "pending" && filter === "review";
    const label = `查看已載入的 ${count} 項待覆核安排，已停止催辦`;
    if (care) return <View testID="tasks-review-shortcut" style={[styles.reviewShortcut, styles.careReview]}>
      <Text style={styles.careReviewTitle}>{count} 項待覆核{p.hasMoreTasks ? "（已載入）" : ""} · 已停催</Text>
      <AppButton label={active ? "返回近期安排" : "查看待覆核"} accessibilityLabel={label} variant="quiet" disabled={occupied} onPress={() => activate(p.onReview)} />
    </View>;
    return <Pressable testID="tasks-review-shortcut" accessibilityRole="button" accessibilityLabel={label}
      disabled={occupied} accessibilityState={{ disabled: occupied }} aria-disabled={occupied} onPress={() => activate(p.onReview)}
      style={({ pressed }) => [styles.reviewShortcut, pressed && !occupied && styles.reviewPressed]}>
      <View style={styles.reviewCopy}><Text style={styles.reviewTitle}>{count} 項待覆核{p.hasMoreTasks ? "（已載入）" : ""}</Text>
        <Text style={styles.reviewNote}>{active ? "返回近期安排" : "完成或取消仍未確定 · 已停催"}</Text></View>
      <AppIcon name={active ? "chevron-left" : "chevron-right"} size={18} color={colors.warningInk} />
    </Pressable>;
  }
  if (region === "completed-note") return tab === "completed" && !p.readUnavailable && p.completedCount > 0
    ? <Text style={care ? styles.careMeta : styles.meta}>{p.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null;
  if (region === "clear") return tab === "pending" && !p.noPendingTasks && p.openCount > 0
    ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied} onPress={() => activate(p.onClearFilters)} /> : null;
  if (!pendingControls) return null;
  if (region === "search") return <TasksFiltersSearch {...p} />;
  if (region === "context") {
    const earlier = backlog.counts.earlier > 0 && filter !== "earlier";
    const earlierLabel = `查看已載入的 ${backlog.counts.earlier} 項較早未處理事項`;
    return <View style={styles.listContext}>
      <Text style={care ? styles.careMeta : styles.meta} accessibilityLiveRegion="polite">{selectedDay ? DateTime.fromISO(selectedDay).toFormat("M月d日") : labels[filter]}{!selectedDay && filter === "near" && backlog.nearLabel ? ` · ${backlog.nearLabel}` : ""}{query.trim() ? " · 搜尋結果" : ""} · 已載入 {backlog.total} 項{backlog.total > 0 ? `，顯示 ${backlog.from}–${backlog.to}` : ""}</Text>
      {earlier ? care ? <AppButton label={`較早未處理 ${backlog.counts.earlier}`} accessibilityLabel={earlierLabel} variant="quiet" disabled={occupied} onPress={() => changeFilter("earlier")} />
        : <Pressable accessibilityRole="button" accessibilityLabel={earlierLabel} disabled={occupied} aria-disabled={occupied} onPress={() => changeFilter("earlier")} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>較早未處理 {backlog.counts.earlier}</Text></Pressable> : null}
      {selectedDay ? care ? <AppButton label="取消日期" accessibilityLabel="只取消日期篩選" variant="quiet" disabled={occupied} onPress={() => activate(p.onClearDay)} />
        : <Pressable accessibilityRole="button" accessibilityLabel="只取消日期篩選" disabled={occupied} aria-disabled={occupied} onPress={() => activate(p.onClearDay)} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>取消日期</Text></Pressable> : null}
    </View>;
  }
  return null;
}
const styles = StyleSheet.create({
  backlogToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minWidth: 0 },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
  handbookSearch: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0, maxWidth: "100%" },
  listHeading: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingTop: spacing.sm },
  listContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs },
  contextLink: { paddingVertical: spacing.xs }, contextLinkText: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, textDecorationLine: "underline" },
  reviewShortcut: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
  careReview: { flexWrap: "wrap" },
  reviewCopy: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.md, rowGap: spacing.xs },
  reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, fontWeight: "700" },
  careReviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body, fontWeight: "600" },
  reviewNote: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  careMeta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  pressed: { backgroundColor: colors.pressedOverlay }, reviewPressed: { backgroundColor: colors.warningPressed },
});
