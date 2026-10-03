import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { currentTaskMetadata, taskStateLabels, taskWorkLabels, type TaskAssigneeView, type TaskDraftMode, type TaskFormValues, type TasksViewModel, type TaskView } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";

export function taskAssigneeLabel(userId: string, assignees: TaskAssigneeView[]) {
  return assignees.find(item => item.userId === userId)?.name ?? "現時不在合資格清單的成員";
}
export function TaskSnapshot({ task, assignees, showTitle = true, announceEligibility = false }: { task: TaskView; assignees: TaskAssigneeView[]; showTitle?: boolean; announceEligibility?: boolean }) {
  const eligible = assignees.some(item => item.userId === task.assigneeUserId);
  return <View style={styles.stack}>
    {announceEligibility ? <StatusAnnouncement key={task.id} eventKey={`${eligible}:${task.occurrence.state}`} message={!eligible && task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : ""} urgent={!eligible && task.occurrence.state === "scheduled"} /> : null}
    {showTitle ? <Text style={styles.title}>{task.title}</Text> : null}
    <Text style={styles.reading}>{task.details || "沒有詳細內容"}</Text>
    <View style={styles.related}>
      <Text style={styles.body}>{task.kind === "ordinary" ? "普通任務" : "預約"} · {taskStateLabels[task.occurrence.state]} · 版本 {task.version}</Text>
      <Text style={styles.body}>負責人：{taskAssigneeLabel(task.assigneeUserId, assignees)}</Text>
      {!eligible ? <Text style={styles.warning}>{task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : "這是歷史指派，不代表現時有權執行或可聯絡。"}</Text> : null}
      <Text style={styles.body}>安排時間：{task.occurrence.dueAt}</Text>
    </View><View style={styles.metadata}>
      <Text style={styles.meta}>IANA 時區：{task.occurrence.timeZone}；保留原時間的明確時差。</Text>
      <Text style={styles.meta}>加入時間：{task.createdAt}；最後更新：{task.updatedAt}</Text>
    </View>
  </View>;
}
export function TaskWorkerMetadata({ task, model }: { task: TaskView; model: TasksViewModel }) {
  const metadata = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders);
  return <View style={styles.metadata}>
    <StatusAnnouncement key={task.id} eventKey={metadata.work?.status ?? "none"} message={metadata.work ? `背景處理：${taskWorkLabels[metadata.work.status]}。` : ""} urgent={metadata.work?.status === "failed"} />
    <Text style={styles.label}>站內背景處理 · 合成台帳</Text>
    {metadata.work ? <>
      <Text style={styles.body}>{taskWorkLabels[metadata.work.status]}（{metadata.work.status}）· 版本 {metadata.work.taskVersion}</Text>
      <Text style={styles.meta}>排定檢查：{metadata.work.nextAt}；失敗次數：{metadata.work.failures}</Text>
      {metadata.work.status === "unknown" ? <Text style={styles.warning}>處理結果未知，不能自動重做。任務仍須另行回報完成。</Text> : null}
      {metadata.work.status === "processed" ? <Text style={styles.meta}>已處理不代表外部通知送達、已讀或照護完成。</Text> : null}
    </> : <Text style={styles.meta}>未提供這個版本的背景處理紀錄。</Text>}
    {metadata.reminders.map(item => <Text key={item.id} style={styles.meta}>本人站內提醒 · {item.phase === "initial" ? "初次（initial）" : "一次跟進（follow_up）"}：{item.createdAt}</Text>)}
    {metadata.reminders.length === 0 ? <Text style={styles.meta}>這個版本沒有可見的本人站內提醒。</Text> : null}
  </View>;
}
export function TaskDraftSummary({ mode, values, assignees }: { mode: TaskDraftMode; values: TaskFormValues; assignees: TaskAssigneeView[] }) {
  return <View style={styles.stack}>
    {mode === "create" ? <><Text style={styles.title}>{values.title}</Text><Text style={styles.reading}>{values.details || "沒有詳細內容"}</Text><Text style={styles.body}>{values.kind === "ordinary" ? "普通任務" : "預約"}</Text></> : null}
    {mode === "create" || mode === "reschedule" ? <>
      <Text style={styles.body}>負責人：{taskAssigneeLabel(values.assigneeUserId, assignees)}</Text>
      <Text style={styles.body}>安排時間：{values.dueAt}</Text><Text style={styles.meta}>IANA 時區：{values.timeZone}</Text>
    </> : null}
    {mode === "resolve" ? <Text style={styles.body}>明確覆核為：{values.outcome === "completed" ? "已完成" : values.outcome === "cancelled" ? "已取消" : "尚未選擇"}</Text> : null}
    {mode !== "create" ? <Text style={styles.reading}>原因／備註：{values.note || "沒有備註"}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md, minWidth: 0 }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  related: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
  metadata: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
});
