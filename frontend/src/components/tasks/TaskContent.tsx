import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { currentTaskMetadata, taskStateLabels, taskWorkLabels, type TaskAssigneeView, type TaskDraftMode, type TaskFormValues, type TasksViewModel, type TaskView } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppStatusBadge } from "../AppStatusBadge";
import { MotionFeedback, MotionReveal } from "../../motion";

export function taskDisplayTime(value: string | null, timeZone: string) {
  const date = value ? DateTime.fromISO(value, { setZone: true }).setZone(timeZone) : null;
  return date?.isValid ? date.toFormat("yyyy年M月d日 HH:mm") : "時間待核對";
}
export function taskAssigneeLabel(userId: string, assignees: TaskAssigneeView[]) {
  return assignees.find(item => item.userId === userId)?.name ?? "原負責人待核對";
}
export function TaskSnapshot({ task, assignees, showTitle = true, announceEligibility = false, compact = false, motion }: { task: TaskView; assignees: TaskAssigneeView[]; showTitle?: boolean; announceEligibility?: boolean; compact?: boolean; motion?: {scopeKey: string; triggerKey: string | number | null; eligible: boolean} }) {
  const eligible = assignees.some(item => item.userId === task.assigneeUserId);
  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(task.occurrence.timeZone);
  const dueLabel = due.isValid ? due.toFormat("yyyy年M月d日 HH:mm") : "時間待核對";
  const arrangement = {assignee: taskAssigneeLabel(task.assigneeUserId, assignees), dueAt: dueLabel};
  const status = <View style={styles.statusLine}><Text style={styles.body}>{task.kind === "ordinary" ? "待辦事項" : "預約"}{!compact ? ` · 版本 ${task.version}` : ""}</Text><AppStatusBadge label={taskStateLabels[task.occurrence.state]} tone={task.occurrence.state === "needs_review" ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} /></View>;
  const eligibilityWarning = !eligible ? <Text style={styles.warning}>{task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : "這是歷史指派，不代表現時有權執行或可聯絡。"}</Text> : null;
  const arrangementContent = (shown: typeof arrangement) => <><Text style={styles.body}>負責人：{shown.assignee}</Text><Text style={styles.body}>{task.kind === "appointment" ? "預約時間" : "預定完成"}：{shown.dueAt}</Text></>;
  return <View style={styles.stack}>
    {announceEligibility ? <StatusAnnouncement key={task.id} eventKey={`${eligible}:${task.occurrence.state}`} message={!eligible && task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : ""} urgent={!eligible && task.occurrence.state === "scheduled"} /> : null}
    {showTitle ? <Text style={styles.title}>{task.title}</Text> : null}
    <Text style={styles.reading}>{task.details || "沒有詳細內容"}</Text>
    <View style={styles.related}>
      {motion ? <MotionFeedback active={motion.eligible} triggerKey={task.occurrence.state} scopeKey={motion.scopeKey} testID="task-detail-state-feedback">{status}</MotionFeedback> : status}
      {motion ? <>{eligibilityWarning}<MotionReveal value={arrangement} contentKey={JSON.stringify([task.assigneeUserId, arrangement.assignee, arrangement.dueAt])} scopeKey={motion.scopeKey} regionKey="task-detail-arrangement" triggerKey={motion.triggerKey} eligible={motion.eligible} style={styles.arrangement}>{arrangementContent}</MotionReveal></> : <><Text style={styles.body}>負責人：{arrangement.assignee}</Text>{eligibilityWarning}<Text style={styles.body}>{task.kind === "appointment" ? "預約時間" : "預定完成"}：{arrangement.dueAt}</Text></>}
    </View>{!compact ? <TaskSnapshotMetadata task={task} /> : null}
  </View>;
}
export function TaskSnapshotMetadata({ task }: { task: TaskView }) {
  return <View style={styles.metadata}>
    <Text style={styles.meta}>加入時間：{taskDisplayTime(task.createdAt, task.occurrence.timeZone)}；最後更新：{taskDisplayTime(task.updatedAt, task.occurrence.timeZone)}</Text>
  </View>;
}
export function TaskWorkerMetadata({ task, model, announce = true }: { task: TaskView; model: TasksViewModel; announce?: boolean }) {
  const metadata = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders);
  return <View style={styles.metadata}>
    {announce ? <StatusAnnouncement key={task.id} eventKey={metadata.work?.status ?? "none"} message={metadata.work ? `背景處理：${taskWorkLabels[metadata.work.status]}。` : ""} urgent={metadata.work?.status === "failed"} /> : null}
    <Text style={styles.label}>站內背景處理</Text>
    {metadata.work ? <>
      <Text style={styles.body}>{taskWorkLabels[metadata.work.status]}（{metadata.work.status}）· 版本 {metadata.work.taskVersion}</Text>
      <Text style={styles.meta}>排定檢查：{taskDisplayTime(metadata.work.nextAt, task.occurrence.timeZone)}；失敗次數：{metadata.work.failures}</Text>
      {metadata.work.status === "unknown" ? <Text style={styles.warning}>處理結果未知，不能自動重做。任務仍須另行回報完成。</Text> : null}
      {metadata.work.status === "processed" ? <Text style={styles.meta}>已處理不代表外部通知送達、已讀或照護完成。</Text> : null}
    </> : <Text style={styles.meta}>未提供這個版本的背景處理紀錄。</Text>}
    {metadata.reminders.map(item => <Text key={item.id} style={styles.meta}>本人站內提醒 · {item.phase === "initial" ? "初次（initial）" : "一次跟進（follow_up）"}：{taskDisplayTime(item.createdAt, task.occurrence.timeZone)}</Text>)}
    {metadata.reminders.length === 0 ? <Text style={styles.meta}>這個版本沒有可見的本人站內提醒。</Text> : null}
  </View>;
}
export function TaskDraftSummary({ mode, values, assignees }: { mode: TaskDraftMode; values: TaskFormValues; assignees: TaskAssigneeView[] }) {
  return <View style={styles.stack}>
    {mode === "create" ? <><Text style={styles.title}>{values.title}</Text><Text style={styles.reading}>{values.details || "沒有詳細內容"}</Text><Text style={styles.body}>{values.kind === "ordinary" ? "普通任務" : "預約"}</Text></> : null}
    {mode === "create" || mode === "reschedule" ? <>
      <Text style={styles.body}>負責人：{taskAssigneeLabel(values.assigneeUserId, assignees)}</Text>
      <Text style={styles.body}>安排時間：{taskDisplayTime(values.dueAt, values.timeZone)}</Text>
    </> : null}
    {mode === "resolve" ? <Text style={styles.body}>明確覆核為：{values.outcome === "completed" ? "已完成" : values.outcome === "cancelled" ? "已取消" : "尚未選擇"}</Text> : null}
    {mode !== "create" ? <Text style={styles.reading}>原因／備註：{values.note || "沒有備註"}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  statusLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  arrangement: { gap: spacing.sm },
  stack: { gap: spacing.md, minWidth: 0 }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  related: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
  metadata: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
});
