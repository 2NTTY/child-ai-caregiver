import { DateTime } from "luxon";
import { Platform, StyleSheet, View, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { currentTaskMetadata, taskActionLabels, taskCompletionLabel, type TasksActions, type TasksViewModel } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionDisclosure } from "../../motion";
import { AppButton } from "../ui";
import { TaskSnapshot, TaskSnapshotMetadata, TaskWorkerMetadata, taskAssigneeLabel, taskDisplayTime } from "./TaskContent";
import { JournalSection } from "../journal/JournalLayout";

export function TaskDetail({ model, actions, hideCloseAction = false }: { model: TasksViewModel; actions: TasksActions; hideCloseAction?: boolean }) {
  const task = model.selected!;
  const locked = model.reading || ["saving", "unknown", "conflict"].includes(model.operation.state);
  const writable = model.access === "editable" && !locked;
  const metadata = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders);
  const work = metadata.work;
  const nextCheck = work ? DateTime.fromISO(work.nextAt, { setZone: true }).setZone(model.scheduleContext.timeZone) : null;
  const ended = task.occurrence.state === "completed" || task.occurrence.state === "cancelled";
  const reminderSummary = task.occurrence.state === "needs_review" ? "安排有待核對，已暫停提醒。" : task.occurrence.state === "completed" ? "已完成，提醒已停止" : task.occurrence.state === "cancelled" ? "已取消，提醒已停止"
    : model.workerEnabled === false ? "提醒處理目前暫停。" : metadata.reminders.length ? `有 ${metadata.reminders.length} 次本人站內提醒記錄；外部通知送達仍須另行核對。`
      : work?.status === "pending" && nextCheck?.isValid ? `下次檢查提醒安排：${nextCheck.toFormat("M月d日 HH:mm")}。這不是送達確認。`
        : "尚無可核對的提醒安排。";
  const close = hideCloseAction ? null : <AppButton label="關閉詳情" variant="quiet" style={styles.closeButton} onPress={actions.closePanel} disabled={locked} />;
  return <View style={styles.detail}><View style={styles.detailHeader}>
    {close}<Text accessibilityRole="header" aria-level={2} style={styles.title}>{task.title}</Text>
  </View>
    <StatusAnnouncement key={task.id} eventKey={task.occurrence.state} message={task.occurrence.state === "needs_review" ? "完成與取消出現相反操作，終態仍待覆核，已停止催辦。" : task.occurrence.state === "completed" || task.occurrence.state === "cancelled" ? "這項事項已結束。" : "事項待處理。"} />
    <TaskSnapshot task={task} assignees={model.eligibleAssignees} showTitle={false} compact announceEligibility motion={{scopeKey: `${model.child.id}:${model.access}:${task.id}`, triggerKey: ["saving", "saved"].includes(model.operation.state) ? model.operation.reference : null, eligible: model.operation.state === "saved" && !model.reading && !model.draft}} />
    {task.occurrence.state === "needs_review" ? <Text style={styles.warning}>完成與取消出現相反操作，終態仍待覆核，已停止催辦。請明確選擇完成或取消，並填寫原因。</Text> : null}
    {model.access === "editable" && task.occurrence.state === "scheduled" ? <View style={styles.actions}>
      <AppButton label="改期／轉派" variant="secondary" disabled={!writable} onPress={() => actions.startChange(task.id, "reschedule")} />
      <AppButton label="回報已完成" disabled={!writable} onPress={() => actions.startChange(task.id, "complete")} />
      <AppButton label="取消事項" variant="quiet" disabled={!writable} onPress={() => actions.startChange(task.id, "cancel")} />
    </View> : null}
    {model.access === "editable" && task.occurrence.state === "needs_review" ? <AppButton label="核對完成或取消" disabled={!writable} onPress={() => actions.startChange(task.id, "resolve")} /> : null}
    <JournalSection title={ended ? "處理結果" : "提醒安排"} level={3} testID="task-reminder-context" style={styles.reminder}><Text style={styles.body}>{reminderSummary}</Text>
    {task.occurrence.state === "completed" ? <Text style={styles.meta}>{taskCompletionLabel(task, model.scheduleContext.timeZone)}</Text> : null}
    {work?.status === "unknown" ? <Text style={styles.warning}>提醒處理結果未確定，請先核對；不能當作已通知或已完成。</Text> : work?.status === "failed" ? <Text style={styles.warning}>提醒處理未成功，請展開記錄核對。</Text> : null}</JournalSection>
    <AppButton label={model.historyOpen ? "收起安排記錄" : "查看安排記錄"} expanded={model.historyOpen} density="compact" variant="secondary" style={styles.historyButton} disabled={locked} onPress={actions.showHistory} />
    <MotionDisclosure expanded={model.historyOpen} scopeKey={`${model.child.id}:${task.id}`}><View style={styles.history}>
      {ended ? <Text style={styles.body}>這項事項已結束，不能直接重開。如需另做，請明確新增另一項事項。</Text> : null}
      <Text style={styles.label}>目前安排記錄 · 版本 {task.version}</Text>
      <Text style={styles.meta}>原始安排時間：{taskDisplayTime(task.occurrence.dueAt, task.occurrence.timeZone)}</Text>
      <TaskSnapshotMetadata task={task} />
      <TaskWorkerMetadata task={task} model={model} announce={false} />
      <Text style={styles.label}>每版快照、操作人、基準及原因</Text>
      {model.history.map(revision => <View key={revision.task.version} style={styles.revision}>
        <Text style={styles.label}>版本 {revision.task.version} · {taskActionLabels[revision.action]}</Text>
        <Text style={styles.meta}>操作人：{taskAssigneeLabel(revision.actorUserId, model.eligibleAssignees)}；原基準版本 {revision.basisVersion}</Text>
        <Text style={styles.meta}>記錄時間：{taskDisplayTime(revision.at, revision.task.occurrence.timeZone)}</Text>
        <TaskSnapshot task={revision.task} assignees={model.eligibleAssignees} />
        <Text selectable style={styles.reading}>原因／備註：{revision.note || "沒有備註"}</Text>
      </View>)}
      {model.hasMoreHistory ? <AppButton label="載入較早記錄" variant="secondary" disabled={!model.online || locked} onPress={actions.loadOlderHistory} /> : <Text style={styles.meta}>已展示目前已載入的全部版本。</Text>}
    </View></MotionDisclosure>
  </View>;
}
const styles = StyleSheet.create({
  detail: { minWidth: 0, gap: spacing.lg }, detailHeader: { gap: spacing.md }, closeButton: { alignSelf: "flex-start", flexShrink: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  reminder: { gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md }, historyButton: { alignSelf: "flex-start" },
  revision: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, maxWidth: 720, ...Platform.select({ web: { maxWidth: "72ch" } as unknown as TextStyle }) },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
