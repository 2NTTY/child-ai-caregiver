import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { AppButton, SectionCard } from "../ui";
import { ReadStateNotice } from "../ReadStateNotice";
import { TaskOperationNotice } from "./TaskOperationNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { FormDialog } from "../FormDialog";
import { TaskDetail } from "./TaskDetail";
import { TaskListRow } from "./TaskListRow";
import { taskAssigneeLabel } from "./TaskContent";
import { searchTaskHistory, taskCompletionLabel, taskHistoryTime, taskHistoryDateMatches, type TaskHistoryDateRange } from "../../task-view-model";
import { useTasksWorkspace } from "../../workspaces/TasksWorkspace";
import { colors, chineseFont, readingType, spacing } from "../../theme";

// The History screen owns its single category/search/time toolbar and outer scroll.
export function TaskHistoryView({ searchText, dateRange, requestedTaskId, onTaskChange }: {
  requestedTaskId?: string | null; onTaskChange?: (id: string | null) => void;
  searchText: string; dateRange: TaskHistoryDateRange; scrollRef?: RefObject<ScrollView | null>; scrollPosition?: number; getScrollPosition?(): number;
}) {
  const preview = useTasksWorkspace();
  const listRef = useRef<View>(null), returnFocus = useRef<View>(null), rowRefs = useRef(new Map<string, View>());
  const requested = useRef("");
  const retained = !!preview && (!!preview.model.draft || ["saving", "unknown", "conflict"].includes(preview.model.operation.state));
  const selected = requestedTaskId === undefined || retained || preview?.model.selected?.id === requestedTaskId ? preview?.model.selected : null;
  useEffect(() => {
    if (!preview || requestedTaskId === undefined || retained || preview.model.access === "lost") return;
    const key = `${preview.scopeKey}:${requestedTaskId ?? "list"}`;
    if (requested.current === key) return;
    requested.current = key;
    if (requestedTaskId) preview.actions.selectTask(requestedTaskId, "open");
    else if (preview.model.selected) preview.actions.closePanel();
  }, [preview, requestedTaskId, retained]);
  const showPanel = preview?.model.access !== "lost" && !!selected && ["completed", "cancelled"].includes(selected.occurrence.state);
  const scope = `${preview?.scopeKey ?? "none"}:${preview?.model.access ?? "lost"}`;
  const previousScope = useRef(scope);
  const readerKey = useRef<string | null>(null);
  // A new record gets a fresh modal scroll viewport; closing keeps its identity
  // until FormDialog has observed the owner acknowledgement and restored focus.
  if (showPanel && selected) readerKey.current = `${scope}:${selected.id}`;
  const searchKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const previousSearch = useRef(searchKey);
  useLayoutEffect(() => {
    if (previousScope.current !== scope) { returnFocus.current = null; previousScope.current = scope; }
    if (previousSearch.current !== searchKey) { previousSearch.current = searchKey; returnFocus.current = null; preview?.actions.closePanel(); }
  }, [scope, searchKey]);
  if (!preview) return <Text style={styles.meta}>先選擇有權查看的孩子。</Text>;
  const { model, actions, recovery } = preview;
  const matches = searchTaskHistory(model.items.filter(task => task.childId === model.child.id), searchText, "all", model.eligibleAssignees);
  const visible = matches.filter(task => taskHistoryDateMatches(task, dateRange, model.scheduleContext.timeZone));
  const unknownDates = matches.filter(task => !taskHistoryTime(task)).length;
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const locked = model.reading || readUnavailable || ["saving", "unknown", "conflict"].includes(model.operation.state) || !!model.draft;
  const closeReader = () => {
    // Reading is disposable; only this owner's retained write/draft can block
    // its closePanel action. Unrelated navigation guards do not own the reader.
    if (["saving", "unknown", "conflict"].includes(model.operation.state) || model.draft) return;
    if (onTaskChange) onTaskChange(null); else actions.closePanel();
  };
  const filtered = !!searchText.trim() || !!dateRange.from || !!dateRange.to;
  const emptyMessage = filtered ? model.hasMoreTasks ? "已載入的事項中沒有符合篩選的事項" : "沒有符合篩選的事項"
    : model.hasMoreTasks ? "已載入的事項中暫無完成或取消的事項" : "暫無完成或取消的事項";
  return <View style={styles.workspace}>
    <StatusAnnouncement eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效；事項及歷史已清除。" : ""} />
    {model.access === "lost" ? <SectionCard><Text style={styles.warning}>孩子權限已失效，沒有顯示這個孩子的事項或歷史。</Text></SectionCard> : <>
      {requestedTaskId && !selected && !model.reading ? <Text style={styles.warning}>指定事項尚未載入或已不能存取；可返回清單選擇其他事項。</Text> : null}
      <TaskOperationNotice model={model} recovery={recovery} online={model.online && !model.reading} />
      {model.access === "read_only" ? <Text style={styles.meta}>目前為唯讀；可查看已載入事項及歷史。</Text> : null}
      <Text style={styles.meta}>按完成／取消日期篩選。{model.hasMoreTasks ? "搜尋只包括已載入事項；仍有事項未載入。" : ""}</Text>
      {!readUnavailable && (dateRange.from || dateRange.to) && unknownDates > 0 ? <Text style={styles.meta}>{unknownDates} 項完成／取消日期未提供，不包括在日期篩選內。</Text> : null}
      <View style={styles.workspace}>
        <View ref={listRef} tabIndex={-1} testID="task-history-list" accessibilityLabel="事項歷史清單" style={styles.column}>
          <ReadStateNotice state={listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty"} message={listReadState === "loading" ? "正在讀取事項歷史…" : listReadState === "error" ? "未能讀取事項歷史，請重試。" : !model.online ? "目前離線，已載入內容可能不是最新。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : !visible.length ? emptyMessage : ""}>
            {(listReadState === "error" || listReadState === "stale" || !model.online) && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" variant="secondary" density="compact" disabled={!model.online || model.reading || ["saving", "unknown", "conflict"].includes(model.operation.state) || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
          </ReadStateNotice>
          {!readUnavailable && visible.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "已載入的事項中有 " : ""}{visible.length} 項符合</Text> : null}
          {!readUnavailable && visible.length > 0 ? <View testID="task-history-rows" style={styles.records}>{visible.map(task => {
            const cancelledAt = task.terminalAt ? DateTime.fromISO(task.terminalAt, { setZone: true }).setZone(model.scheduleContext.timeZone) : null;
            const time = task.occurrence.state === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : cancelledAt?.isValid ? `${cancelledAt.toFormat("M月d日 HH:mm")} 取消` : "取消時間未提供";
            return <TaskListRow history key={task.id} task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} selected={selected?.id === task.id} disabled={locked}
              rowRef={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} onPress={() => { returnFocus.current = rowRefs.current.get(task.id) ?? null; if (onTaskChange) onTaskChange(task.id); else actions.selectTask(task.id, "toggle"); }} />;
          })}</View> : null}
          {model.hasMoreTasks ? <AppButton label={model.loadingMoreTasks ? "正在載入…" : "載入更多事項"} variant="secondary" disabled={locked || model.loadingMoreTasks || !model.online} onPress={actions.loadMoreTasks} /> : null}
        </View>
        <FormDialog key={readerKey.current} visible={showPanel} scopeKey={scope} formKey={readerKey.current ?? undefined} title="事項詳情" dismissMode="local"
          returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={closeReader}
          recovery={<TaskOperationNotice model={model} recovery={recovery} online={model.online && !model.reading} />}
          closeOutcome={{ revision: model, ready: !model.selected && !model.draft && model.operation.state === "none" }}>
          {showPanel ? <TaskDetail model={{ ...model, selected: selected ?? null }} actions={actions} hideCloseAction /> : null}
        </FormDialog>
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 },
  records: { minWidth: 0, flexDirection: "column", alignItems: "stretch" },
  column: { minWidth: 0, gap: spacing.md },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
});
