import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { currentTaskMetadata, taskStateLabels, taskWorkLabels, type TaskAssigneeView, type TaskDraftMode, type TaskFormValues, type TasksViewModel, type TaskView } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppStatusBadge } from "../AppStatusBadge";
import { SummaryDisclosure } from "../summary/SummaryDisclosure";
import { AppIcon, type AppIconName } from "../AppIcon";
import { MotionFeedback, MotionReveal } from "../../motion";

export function taskDisplayTime(value: string | null, timeZone: string) {
  const date = value ? DateTime.fromISO(value, { setZone: true }).setZone(timeZone) : null;
  return date?.isValid ? date.toFormat("yyyy年M月d日 HH:mm") : "時間待核對";
}
export function taskAssigneeLabel(userId: string, assignees: TaskAssigneeView[]) {
  return assignees.find(item => item.userId === userId)?.name ?? "原負責人待核對";
}
function TaskMetadata({ icon, label, value }: { icon: AppIconName; label: string; value: string }) {
  return <View accessible accessibilityLabel={`${label}：${value}`} style={styles.metadataItem}>
    <AppIcon name={icon} size={14} /><Text style={styles.meta}>{value}</Text>
  </View>;
}
export function TaskSnapshot({ task, assignees, showTitle = true, announceEligibility = false, compact = false, motion }: { task: TaskView; assignees: TaskAssigneeView[]; showTitle?: boolean; announceEligibility?: boolean; compact?: boolean; motion?: {scopeKey: string; triggerKey: string | number | null; eligible: boolean} }) {
  const eligible = assignees.some(item => item.userId === task.assigneeUserId);
  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(task.occurrence.timeZone);
  const dueLabel = due.isValid ? due.toFormat("yyyy年M月d日 HH:mm") : "時間待核對";
  const arrangement = {assignee: taskAssigneeLabel(task.assigneeUserId, assignees), dueAt: dueLabel};
  const status = <View style={styles.statusLine}><TaskMetadata icon={task.kind === "ordinary" ? "clipboard-check-outline" : "calendar-clock-outline"} label="種類" value={task.kind === "ordinary" ? "待辦事項" : "預約"} /><AppStatusBadge label={taskStateLabels[task.occurrence.state]} tone={task.occurrence.state === "needs_review" ? "warning" : task.occurrence.state === "completed" ? "success" : task.occurrence.state === "cancelled" ? "neutral" : "info"} /></View>;
  const eligibilityWarning = !eligible ? <Text style={styles.warning}>{task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : "這是歷史指派，不代表現時有權執行或可聯絡。"}</Text> : null;
  const arrangementContent = (shown: typeof arrangement) => <>
    <TaskMetadata icon="account-outline" label="負責人" value={shown.assignee} />
    <TaskMetadata icon="calendar-clock-outline" label={task.kind === "appointment" ? "預約時間" : "預定完成"} value={`${task.kind === "appointment" ? "預約" : "預定完成"} ${shown.dueAt}`} />
  </>;
  return <View style={styles.stack}>
    {announceEligibility ? <StatusAnnouncement key={task.id} eventKey={`${eligible}:${task.occurrence.state}`} message={!eligible && task.occurrence.state === "scheduled" ? "原負責人已不具執行資格，請重新指派；不能視為仍可聯絡。" : ""} urgent={!eligible && task.occurrence.state === "scheduled"} /> : null}
    {showTitle ? <Text style={styles.title}>{task.title}</Text> : null}
    {task.details ? <Text style={styles.reading}>{task.details}</Text> : null}
    <View style={styles.related}>
      {motion ? <MotionFeedback active={motion.eligible} triggerKey={task.occurrence.state} scopeKey={motion.scopeKey} testID="task-detail-state-feedback">{status}</MotionFeedback> : status}
      {motion ? <>{eligibilityWarning}<MotionReveal value={arrangement} contentKey={JSON.stringify([task.assigneeUserId, arrangement.assignee, arrangement.dueAt])} scopeKey={motion.scopeKey} regionKey="task-detail-arrangement" triggerKey={motion.triggerKey} eligible={motion.eligible} style={styles.arrangement}>{arrangementContent}</MotionReveal></> : <>{eligibilityWarning}<View style={styles.arrangement}>{arrangementContent(arrangement)}</View></>}
    </View>{!compact ? <TaskSnapshotMetadata task={task} /> : null}
  </View>;
}
export function TaskSnapshotMetadata({ task }: { task: TaskView }) {
  return <SummaryDisclosure label="查看記錄詳情" scopeKey={`${task.id}:${task.version}`}><View style={styles.metadata}>
    <Text style={styles.meta}>版本 {task.version}</Text>
    <TaskMetadata icon="clock-outline" label="加入時間" value={`加入 ${taskDisplayTime(task.createdAt, task.occurrence.timeZone)}`} />
    <TaskMetadata icon="history" label="最後更新" value={`更新 ${taskDisplayTime(task.updatedAt, task.occurrence.timeZone)}`} />
  </View></SummaryDisclosure>;
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
  arrangement: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  metadataItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 0, maxWidth: "100%", flexShrink: 1 },
  stack: { gap: spacing.md, minWidth: 0 }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  related: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
  metadata: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm, minWidth: 0 },
});
