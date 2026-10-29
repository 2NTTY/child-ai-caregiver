import { historyPage } from "../history/history-page";
import { HistoryPager } from "../history/HistoryPager";
import { useRef, type RefObject } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton } from "../ui";
import { ReadStateNotice } from "../ReadStateNotice";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { taskSavedPresentation } from "./task-saved-presentation";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { TaskDetail } from "./TaskDetail";
import { TaskListRow } from "./TaskListRow";
import { taskAssigneeLabel } from "./TaskContent";
import { searchTaskHistory, taskCompletionLabel, taskHistoryTime, taskHistoryDateMatches, type TaskHistoryDateRange } from "../../task-view-model";
import { useTasksWorkspace, type TasksWorkspaceValue } from "../../workspaces/TasksWorkspace";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { colors, chineseFont, readingType, spacing } from "../../theme";

// The History adapter retains ownership of accepted reads, close publication and URL state.
export function TaskHistoryView({ searchText, dateRange, workspace, route, onPageChange, scrollRef, getScrollPosition }: {
  workspace?: TasksWorkspaceValue; route: HistoryRouteState; onPageChange(page: number): void;
  searchText: string; dateRange: TaskHistoryDateRange; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number;
}) {
  const source = useTasksWorkspace(), preview = workspace ?? source;
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const selected = preview?.model.selected;
  const showReader = preview?.model.access !== "lost" && !!selected && selected.id === route.selectedId && ["completed", "cancelled"].includes(selected.occurrence.state);
  const position = useReaderReturn({ scopeKey: JSON.stringify([preview?.scopeKey, preview?.model.access, "history-tasks", searchText, dateRange.from, dateRange.to, route.page]),
    selectedId: showReader ? selected!.id : null, enabled: !!preview && preview.model.access !== "lost" && (!route.selectedId || showReader), listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  if (!preview) return <ReadStateNotice state="unavailable" message="先選擇有權查看的孩子。" />;
  const { model, actions, recovery } = preview;
  const matches = searchTaskHistory(model.items.filter(task => task.childId === model.child.id), searchText, "all", model.eligibleAssignees);
  const visible = matches.filter(task => taskHistoryDateMatches(task, dateRange, model.scheduleContext.timeZone));
  const page = historyPage(visible, route.page), unknownDates = matches.filter(task => !taskHistoryTime(task)).length;
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  // This owner also projects invalid-ID/404 reads as failed operations without a
  // write reference. Keep real drafts, receipts and recovery-check states intact.
  const detailReadFailed = model.detailRead?.state === "error" && model.detailRead.id === route.selectedId
    && !model.selected && !model.draft && model.operation.state === "failed" && model.operation.reference === null
    && !model.operation.referenceLabel && !model.operation.resultUnavailable
    && (model.operation.recovery === undefined || model.operation.recovery === "reload");
  const operationBlocked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const locked = model.reading || readUnavailable || operationBlocked || !!model.draft;
  const closeReader = () => { if (operationBlocked) return; position.returning(); actions.closePanel(); };
  const filtered = !!searchText.trim() || !!dateRange.from || !!dateRange.to;
  const emptyMessage = filtered ? model.hasMoreTasks ? "已載入的事項中沒有符合篩選的事項" : "沒有符合篩選的事項"
    : model.hasMoreTasks ? "已載入的事項中暫無完成或取消的事項" : "暫無完成或取消的事項";
  return <View style={styles.workspace}>
    <StatusAnnouncement eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效；事項及歷史已清除。" : ""} />
    {model.access === "lost" ? <ReadStateNotice state="unavailable" message="孩子權限已失效，沒有顯示這個孩子的事項或歷史。" /> : <>
      {detailReadFailed ? <ReadStateNotice state="error" title="未能讀取這項事項" message={model.operation.message} />
        : <WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online && !model.reading} savedPresentation={taskSavedPresentation(model)} />}
      {model.access === "read_only" ? <Text style={styles.body}>目前為唯讀；可查看已載入事項及歷史。</Text> : null}
      <ReadStateNotice state={listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : (visible.length || route.selectedId) ? "ready" : "empty"} message={listReadState === "loading" ? "正在讀取事項歷史…" : listReadState === "error" ? "未能讀取事項歷史，請重試。" : !model.online ? "目前離線，已載入內容可能不是最新。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : !visible.length && !route.selectedId ? emptyMessage : ""}>
        {(listReadState === "error" || listReadState === "stale" || !model.online) && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" variant="secondary" density="compact" disabled={!model.online || model.reading || operationBlocked || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
      </ReadStateNotice>
      <View testID="task-history-index" aria-hidden={!!route.selectedId} style={[styles.workspace, !!route.selectedId && styles.hidden]}>
        <Text style={styles.body}>按完成／取消日期篩選。{model.hasMoreTasks ? "搜尋只包括已載入事項；仍有事項未載入。" : ""}</Text>
        {!readUnavailable && (dateRange.from || dateRange.to) && unknownDates > 0 ? <Text style={styles.body}>{unknownDates} 項完成／取消日期未提供，不包括在日期篩選內。</Text> : null}
        <View ref={listRef} tabIndex={-1} testID="task-history-list" accessibilityLabel="事項歷史清單" style={styles.workspace}>
          {!readUnavailable && visible.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "已載入的事項中有 " : ""}{visible.length} 項符合</Text> : null}
          {!readUnavailable && visible.length > 0 ? <View testID="task-history-rows">{page.items.map(task => {
            const cancelledAt = task.terminalAt ? DateTime.fromISO(task.terminalAt, { setZone: true }).setZone(model.scheduleContext.timeZone) : null;
            const time = task.occurrence.state === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : cancelledAt?.isValid ? `${cancelledAt.toFormat("M月d日 HH:mm")} 取消` : "取消時間未提供";
            return <TaskListRow history key={task.id} task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} selected={false} disabled={locked}
              href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "tasks", selectedId: task.id }) }}
              rowRef={node => position.rowRef(task.id, node)} onPress={() => { position.remember(task.id, getScrollPosition?.()); actions.selectTask(task.id); }} />;
          })}</View> : null}
          <HistoryPager page={page.page} total={page.total} disabled={locked} onChange={onPageChange} />
          {model.hasMoreTasks ? <AppButton label={model.loadingMoreTasks ? "正在載入…" : "載入更多事項"} variant="secondary" disabled={locked || model.loadingMoreTasks || !model.online} onPress={actions.loadMoreTasks} /> : null}
        </View>
      </View>
      {route.selectedId ? <View testID={showReader ? "task-history-reader" : "task-history-unavailable"} style={styles.reader}>
        <AppButton label="返回事項歷史清單" variant="quiet" disabled={operationBlocked} onPress={closeReader} />
        {showReader ? <View ref={readerRef} tabIndex={-1} testID="task-history-heading" accessibilityLabel={selected!.title}>
          <TaskDetail model={model} actions={actions} hideCloseAction headingLevel={3} />
        </View> : <ReadStateNotice state={model.reading ? "loading" : "unavailable"} message={model.reading ? "正在讀取這項事項…" : "這項事項目前不在可讀的完成／取消記錄，沒有代選其他事項。"} />}
      </View> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 }, hidden: { display: "none" }, reader: { gap: spacing.lg, width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
