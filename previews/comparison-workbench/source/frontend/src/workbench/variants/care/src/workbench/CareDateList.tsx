// Exact Care source rendering; state/actions/recovery remain host-owned.
import type { CareSlotPorts } from './CareSlotPorts';
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { serializeTaskRoute } from "../navigation/route-state";
import { MotionList } from "../motion";
import { AppButton } from "../components/ui";
import { StatusAnnouncement } from "../components/StatusAnnouncement";
import { EmptyListCard } from "../components/EmptyListCard";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { TaskListRow } from "../components/tasks/TaskListRow";
import { taskAssigneeLabel } from "../components/tasks/TaskContent";
import { currentTaskMetadata, taskCompletionLabel, taskScheduleTime } from "../task-view-model";
import type { TaskBacklogFilter } from "../components/tasks/task-calendar";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../theme";
export function CareDateList({model,recovery,locked,tab,readUnavailable,noPendingTasks,selectedDay,backlog,filter,query,openCount,occupied,actions,anchor,setQuery,changeView,changeFilter,selectCalendarDay,readState,readMessage,sections,scopeKey,loading,previousLoading,listVisible,rowRefs,rememberList,route}: Pick<CareSlotPorts, 'model'|'recovery'|'locked'|'tab'|'readUnavailable'|'noPendingTasks'|'selectedDay'|'backlog'|'filter'|'query'|'openCount'|'occupied'|'actions'|'anchor'|'setQuery'|'changeView'|'changeFilter'|'selectCalendarDay'|'readState'|'readMessage'|'sections'|'scopeKey'|'loading'|'previousLoading'|'listVisible'|'rowRefs'|'rememberList'|'route'>) {
const backlogLabels: Record<TaskBacklogFilter, string> = { near: "近期 7 天", earlier: "較早未處理", later: "之後", review: "待覆核", unconfirmed: "時間待核對", all: "全部日期" };
return <View style={styles.scheduleList}>
              {tab === "pending" && !readUnavailable && !noPendingTasks ? <View style={styles.listContext}>
                <Text style={styles.meta} accessibilityLiveRegion="polite">{selectedDay ? `${DateTime.fromISO(selectedDay).toFormat("M月d日")}` : backlogLabels[filter]}{!selectedDay && filter === "near" && backlog.nearLabel ? ` · ${backlog.nearLabel}` : ""}{query.trim() ? " · 搜尋結果" : ""} · 已載入 {backlog.total} 項{backlog.total > 0 ? `，顯示 ${backlog.from}–${backlog.to}` : ""}</Text>
                {backlog.counts.earlier > 0 && filter !== "earlier" ? <AppButton label={`較早未處理 ${backlog.counts.earlier}`} accessibilityLabel={`查看已載入的 ${backlog.counts.earlier} 項較早未處理事項`} variant="quiet" disabled={occupied} onPress={() => changeFilter("earlier")} /> : null}
                {selectedDay ? <AppButton label="取消日期" accessibilityLabel="只取消日期篩選" variant="quiet" disabled={occupied} onPress={() => selectCalendarDay(null)} /> : null}
              </View> : null}
              {readState === "empty" ? <><StatusAnnouncement eventKey={`${tab}:${readMessage}`} message={readMessage} />
              <EmptyListCard testID="tasks-empty-card" title={readMessage} icon="clipboard-check-outline" style={styles.emptyCard}>
                {tab === "pending" && !noPendingTasks && openCount > 0 ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied} onPress={() => { if (occupied) return; anchor.current = null; setQuery(""); changeView({ day: null, filter: "all", page: 0 }); }} /> : null}
              </EmptyListCard></> : <ReadStateNotice state={readState} message={readMessage}>
                {(readState === "error" || readState === "stale") && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" variant="secondary" density="compact" disabled={!model.online || model.reading || locked || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
              </ReadStateNotice>}
              {!readUnavailable && sections.filter(section => section.items.length > 0).map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={styles.timeGroup}>
                <View style={styles.groupHeading}><Text accessibilityRole="header" aria-level={2} style={styles.groupTitle}>{section.label}</Text><Text style={styles.meta}>{section.items.length} 項</Text></View>
                <MotionList items={section.items} keyExtractor={task => task.id} scopeKey={`${scopeKey}:${tab}`} regionKey={`tasks:${section.id}`} eligible={model.operation.state === "saved" && !loading && !previousLoading.current && listVisible} renderItem={(task, { exiting }) => {
                  const work = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders).work;
                  const assigneeMissing = task.occurrence.state === "scheduled" && !model.eligibleAssignees.some(person => person.userId === task.assigneeUserId);
                  const warning = assigneeMissing ? "請重新核對負責人" : work?.status === "unknown" ? "提醒處理結果待核對" : work?.status === "failed" ? "提醒處理未成功，請查看詳情" : null;
                  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(model.scheduleContext.timeZone);
                  const date = section.id === "today" || (tab === "pending" && selectedDay) ? "" : due.isValid ? `${due.toFormat("M月d日")} ` : "";
                  const time = tab === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : `${date}${due.isValid ? due.toFormat("HH:mm") : taskScheduleTime(task)}${task.kind === "ordinary" ? " 前" : ""}`;
                  return <TaskListRow href={{ pathname: "/tasks", params: serializeTaskRoute({ ...route, taskId: task.id }) }} task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} warning={warning} selected={model.selected?.id === task.id} disabled={occupied || exiting}
                    rowRef={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} onPress={() => { rememberList(task.id); actions.selectTask(task.id); }} />;
                }} />
              </View>)}
              {tab === "pending" && backlog.pageCount > 1 ? <View style={styles.pagination}>
                <AppButton label="上一頁" accessibilityLabel="已載入事項上一頁" variant="quiet" density="compact" disabled={occupied || backlog.page === 0} onPress={() => { if (occupied) return; anchor.current = null; changeView({ page: backlog.page - 1 }); }} />
                <Text style={styles.meta}>第 {backlog.page + 1}／{backlog.pageCount} 頁</Text>
                <AppButton label="下一頁" accessibilityLabel="已載入事項下一頁" variant="quiet" density="compact" disabled={occupied || backlog.page >= backlog.pageCount - 1} onPress={() => { if (occupied) return; anchor.current = null; changeView({ page: backlog.page + 1 }); }} />
              </View> : null}
              </View>;
}

const styles = StyleSheet.create({
scheduleList: { minWidth: 0, gap: spacing.sm },
listContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs },
meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
emptyCard: { paddingVertical: spacing.lg },
timeGroup: { minWidth: 0, paddingTop: spacing.lg },
groupHeading: { flexDirection: "row", gap: spacing.sm, alignItems: "baseline", paddingBottom: spacing.sm },
groupTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
pagination: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm }
});
