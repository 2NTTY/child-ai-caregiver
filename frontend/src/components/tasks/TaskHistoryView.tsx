import { useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton, SectionCard } from "../ui";
import { ReadStateNotice } from "../ReadStateNotice";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { useContainerWidth } from "../useContainerWidth";
import { TaskDetail } from "./TaskDetail";
import { TaskListRow } from "./TaskListRow";
import { taskAssigneeLabel } from "./TaskContent";
import { searchTaskHistory, taskCompletionLabel, taskHistoryTime, taskHistoryDateMatches, type TaskHistoryDateRange } from "../../task-view-model";
import { useTasksWorkspace } from "../../workspaces/TasksWorkspace";
import { colors, chineseFont, readingType, spacing } from "../../theme";

// The History screen owns its single category/search/time toolbar and outer scroll.
export function TaskHistoryView({ searchText, dateRange, scrollRef, scrollPosition = 0, getScrollPosition }: {
  searchText: string; dateRange: TaskHistoryDateRange; scrollRef?: RefObject<ScrollView | null>; scrollPosition?: number; getScrollPosition?(): number;
}) {
  const preview = useTasksWorkspace(), layout = useContainerWidth();
  const listRef = useRef<View>(null), panelRef = useRef<View>(null), rowRefs = useRef(new Map<string, View>());
  const anchor = useRef<{ id: string; y: number; scope: string } | null>(null);
  const selected = preview?.model.selected;
  const showPanel = !!selected && ["completed", "cancelled"].includes(selected.occurrence.state);
  const wasPanel = useRef(showPanel), wide = layout.width >= 840;
  const scope = `${preview?.scopeKey ?? "none"}:${preview?.model.access ?? "lost"}`;
  const previousScope = useRef(scope);
  const searchKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const previousSearch = useRef(searchKey);
  useLayoutEffect(() => {
    if (previousScope.current !== scope) { anchor.current = null; previousScope.current = scope; }
    if (previousSearch.current !== searchKey) { previousSearch.current = searchKey; anchor.current = null; preview?.actions.closePanel(); }
  }, [scope, searchKey]);
  useLayoutEffect(() => {
    const entering = !wasPanel.current && showPanel, returning = wasPanel.current && !showPanel;
    wasPanel.current = showPanel;
    if (entering && !wide) {
      scrollRef?.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") (panelRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    }
    const saved = anchor.current;
    if (returning && saved?.scope === scope) {
      if (!wide) scrollRef?.current?.scrollTo({ y: saved.y, animated: false });
      if (Platform.OS === "web") for (const node of [rowRefs.current.get(saved.id), listRef.current]) {
        const target = node as unknown as HTMLElement | undefined;
        if (!target?.isConnected || !target.getClientRects().length) continue;
        target.focus({ preventScroll: true }); if (document.activeElement === target) break;
      }
    }
  }, [showPanel, wide, scope]);
  if (!preview) return <Text style={styles.meta}>先選擇有權查看的孩子。</Text>;
  const { model, actions, recovery } = preview;
  const matches = searchTaskHistory(model.items.filter(task => task.childId === model.child.id), searchText, "all", model.eligibleAssignees);
  const visible = matches.filter(task => taskHistoryDateMatches(task, dateRange, model.scheduleContext.timeZone));
  const unknownDates = matches.filter(task => !taskHistoryTime(task)).length;
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const locked = model.reading || readUnavailable || ["saving", "unknown", "conflict"].includes(model.operation.state) || !!model.draft;
  const listVisible = wide || !showPanel;
  return <View style={styles.workspace}>
    <StatusAnnouncement eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效；事項及歷史已清除。" : ""} />
    {model.access === "lost" ? <SectionCard><Text style={styles.warning}>孩子權限已失效，沒有顯示這個孩子的事項或歷史。</Text></SectionCard> : <>
      <WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online && !model.reading} />
      {model.access === "read_only" ? <Text style={styles.meta}>目前為唯讀；可查看已載入事項及歷史。</Text> : null}
      <Text style={styles.meta}>按完成／取消日期篩選（{model.scheduleContext.timeZone === "Asia/Hong_Kong" ? "香港時間" : model.scheduleContext.timeZone}）。{model.hasMoreTasks ? "搜尋只包括已載入事項；仍有事項未載入。" : ""}</Text>
      {!readUnavailable && unknownDates > 0 ? <Text style={styles.meta}>{unknownDates} 項完成／取消日期未提供，不包括在日期篩選內。</Text> : null}
      <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.workspace, wide && showPanel && styles.split]}>
        <View ref={listRef} tabIndex={-1} testID="task-history-list" style={[styles.column, !listVisible && styles.hidden]} aria-hidden={!listVisible} pointerEvents={listVisible ? "auto" : "none"} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>
          <ReadStateNotice state={model.reading || model.loadingMoreTasks || listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty"} message={model.reading || listReadState === "loading" ? "正在讀取事項歷史…" : model.loadingMoreTasks ? "正在載入更多事項…" : listReadState === "error" ? "未能讀取事項歷史，請重試。" : !model.online ? "目前離線，已載入內容可能不是最新。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : !visible.length ? "沒有符合篩選的事項。" : ""}>
            {(listReadState === "error" || listReadState === "stale" || !model.online) && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" variant="secondary" density="compact" disabled={!model.online || model.reading || ["saving", "unknown", "conflict"].includes(model.operation.state) || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
          </ReadStateNotice>
          {!readUnavailable ? <Text style={styles.meta}>{visible.length} 項符合</Text> : null}
          {!readUnavailable && visible.map(task => {
            const cancelledAt = task.terminalAt ? DateTime.fromISO(task.terminalAt, { setZone: true }).setZone(model.scheduleContext.timeZone) : null;
            const time = task.occurrence.state === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : cancelledAt?.isValid ? `${cancelledAt.toFormat("M月d日 HH:mm")} 取消` : "取消時間未提供";
            return <TaskListRow key={task.id} task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} selected={selected?.id === task.id} disabled={locked}
              rowRef={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} onPress={() => { anchor.current = { id: task.id, y: getScrollPosition?.() ?? scrollPosition, scope }; actions.selectTask(task.id); }} />;
          })}
          {model.hasMoreTasks ? <AppButton label={model.loadingMoreTasks ? "正在載入…" : "載入更多事項"} variant="secondary" disabled={locked || model.loadingMoreTasks || !model.online} onPress={actions.loadMoreTasks} /> : null}
        </View>
        {showPanel ? <View ref={panelRef} tabIndex={-1} style={styles.column}><TaskDetail model={model} actions={actions} /></View> : null}
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 }, split: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, minWidth: 0, gap: spacing.md }, hidden: { display: "none" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
});
