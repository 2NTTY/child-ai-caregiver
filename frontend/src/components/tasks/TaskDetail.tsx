import { DateTime } from "luxon";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { currentTaskMetadata, taskActionLabels, taskCompletionLabel, type TasksActions, type TasksViewModel } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionDisclosure } from "../../motion";
import { AppButton } from "../ui";
import { TaskSection } from "./TaskWorkspaceParts";
import { TaskSnapshot, TaskSnapshotMetadata, TaskWorkerMetadata, taskAssigneeLabel, taskDisplayTime } from "./TaskContent";

export function TaskDetail({ model, actions, hideCloseAction = false, headingLevel = 2 }: { headingLevel?: 2 | 3; model: TasksViewModel; actions: TasksActions; hideCloseAction?: boolean }) {
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
  return <View testID="task-planning-detail" style={styles.detail}><View style={styles.detailHeader}>
    <View style={styles.detailToolbar}><Text style={styles.eyebrow}>{task.kind === "appointment" ? "預約安排" : "待辦安排"}</Text>{close}</View>
    <Text accessibilityRole="header" aria-level={headingLevel} style={styles.title}>{task.title}</Text>
  </View>
    <StatusAnnouncement key={task.id} eventKey={task.occurrence.state} message={task.occurrence.state === "needs_review" ? "完成與取消出現相反操作，終態仍待覆核，已停止催辦。" : task.occurrence.state === "completed" || task.occurrence.state === "cancelled" ? "這項事項已結束。" : "事項待處理。"} />
    <TaskSnapshot task={task} assignees={model.eligibleAssignees} showTitle={false} compact announceEligibility motion={{scopeKey: `${model.child.id}:${model.access}:${task.id}`, triggerKey: ["saving", "saved"].includes(model.operation.state) ? model.operation.reference : null, eligible: model.operation.state === "saved" && !model.reading && !model.draft}} />
    <TaskSection headingLevel={headingLevel === 3 ? 4 : 3} title={ended ? "事項已結束" : "下一步"}>
    {task.occurrence.state === "needs_review" ? <Text style={styles.warning}>完成與取消出現相反操作，終態仍待覆核，已停止催辦。請明確選擇完成或取消，並填寫原因。</Text> : null}
    {model.access === "editable" && task.occurrence.state === "scheduled" ? <View style={styles.actions}>
      <AppButton label="改期／轉派" variant="secondary" disabled={!writable} onPress={() => actions.startChange(task.id, "reschedule")} />
      <AppButton label="回報已完成" disabled={!writable} onPress={() => actions.startChange(task.id, "complete")} />
      <AppButton label="取消事項" variant="quiet" disabled={!writable} onPress={() => actions.startChange(task.id, "cancel")} />
    </View> : null}
    {model.access === "editable" && task.occurrence.state === "needs_review" ? <AppButton label="核對完成或取消" disabled={!writable} onPress={() => actions.startChange(task.id, "resolve")} /> : null}
    {ended ? <Text style={styles.body}>這項事項已結束，不能直接重開。如需另做，請明確新增另一項事項。</Text> : model.access !== "editable" ? <Text style={styles.meta}>目前為唯讀，可查看安排及歷史。</Text> : null}
    </TaskSection>
    <TaskSection headingLevel={headingLevel === 3 ? 4 : 3} title="提醒與進度"><Text style={styles.body}>{reminderSummary}</Text>
    {task.occurrence.state === "completed" ? <Text style={styles.meta}>{taskCompletionLabel(task, model.scheduleContext.timeZone)}</Text> : null}
    {work?.status === "unknown" ? <Text style={styles.warning}>提醒處理結果未確定，請先核對；不能當作已通知或已完成。</Text> : work?.status === "failed" ? <Text style={styles.warning}>提醒處理未成功，請展開記錄核對。</Text> : null}
    </TaskSection>
    <TaskSection headingLevel={headingLevel === 3 ? 4 : 3} title="安排紀錄" description="核對每次改動的基準、操作人與原因。">
    <AppButton label={model.historyOpen ? "收起安排記錄" : "查看安排記錄"} expanded={model.historyOpen} density="compact" variant="secondary" style={styles.historyButton} disabled={locked} onPress={actions.showHistory} />
    <MotionDisclosure expanded={model.historyOpen} scopeKey={`${model.child.id}:${task.id}`}><View style={styles.history}>
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
        <Text style={styles.reading}>原因／備註：{revision.note || "沒有備註"}</Text>
      </View>)}
      {model.hasMoreHistory ? <AppButton label="載入較早記錄" variant="secondary" disabled={!model.online || locked} onPress={actions.loadOlderHistory} /> : <Text style={styles.meta}>已展示目前已載入的全部版本。</Text>}
    </View></MotionDisclosure>
    </TaskSection>
  </View>;
}
const styles = StyleSheet.create({
  detail: { minWidth: 0, gap: spacing.xl },
  detailHeader: { gap: spacing.lg }, detailToolbar: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  closeButton: { maxWidth: "100%" },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md }, historyButton: { alignSelf: "flex-start" },
  revision: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
