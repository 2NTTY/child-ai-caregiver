import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { taskActionLabels, type TasksActions, type TasksViewModel } from "../../task-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionDisclosure } from "../../motion";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { TaskSnapshot, TaskWorkerMetadata, taskAssigneeLabel } from "./TaskContent";

export function TaskDetail({ model, actions }: { model: TasksViewModel; actions: TasksActions }) {
  const task = model.selected!;
  const locked = model.reading || ["saving", "unknown", "conflict"].includes(model.operation.state);
  const writable = model.access === "editable" && !locked;
  return <SectionCard><SectionHeader density="compact" title={task.title} subtitle="家庭共享事項 · 合成資料" action={<AppButton label="關閉詳情" variant="quiet" onPress={actions.closePanel} disabled={locked} />} />
    <StatusAnnouncement key={task.id} eventKey={task.occurrence.state} message={task.occurrence.state === "needs_review" ? "完成與取消出現相反操作，終態仍待覆核，已停止催辦。" : task.occurrence.state === "completed" || task.occurrence.state === "cancelled" ? "這項事項已結束。" : "事項待處理。"} />
    <TaskSnapshot task={task} assignees={model.eligibleAssignees} showTitle={false} announceEligibility />
    {task.occurrence.state === "needs_review" ? <Text style={styles.warning}>完成與取消出現相反操作，終態仍待覆核，已停止催辦。請明確選擇完成或取消，並填寫原因。</Text> : null}
    {task.occurrence.state === "completed" || task.occurrence.state === "cancelled" ? <Text style={styles.body}>這項事項已結束，不能直接重開。如需另做，請明確新增另一項事項。</Text> : null}
    <TaskWorkerMetadata task={task} model={model} />
    {model.access === "editable" && task.occurrence.state === "scheduled" ? <View style={styles.actions}>
      <AppButton label="改期／轉派" variant="secondary" disabled={!writable} onPress={() => actions.startChange(task.id, "reschedule")} />
      <AppButton label="回報已完成" disabled={!writable} onPress={() => actions.startChange(task.id, "complete")} />
      <AppButton label="取消事項" variant="quiet" disabled={!writable} onPress={() => actions.startChange(task.id, "cancel")} />
    </View> : null}
    {model.access === "editable" && task.occurrence.state === "needs_review" ? <AppButton label="明確覆核終態" disabled={!writable} onPress={() => actions.startChange(task.id, "resolve")} /> : null}
    <AppButton label={model.historyOpen ? "版本歷史已展開" : "查看逐版歷史"} variant="secondary" disabled={locked || model.historyOpen} onPress={actions.showHistory} />
    <MotionDisclosure expanded={model.historyOpen} scopeKey={`${model.child.id}:${task.id}`}><View style={styles.history}><Text style={styles.label}>每版快照、操作人、基準及原因 · 合成示例</Text>
      {model.history.map(revision => <View key={revision.task.version} style={styles.revision}>
        <Text style={styles.label}>版本 {revision.task.version} · {taskActionLabels[revision.action]}</Text>
        <Text style={styles.meta}>操作人：{taskAssigneeLabel(revision.actorUserId, model.eligibleAssignees)}；原基準版本 {revision.basisVersion}</Text>
        <Text style={styles.meta}>記錄時間：{revision.at}</Text>
        <TaskSnapshot task={revision.task} assignees={model.eligibleAssignees} />
        <Text style={styles.reading}>原因／備註：{revision.note || "沒有備註"}</Text>
      </View>)}
      {model.hasMoreHistory ? <AppButton label="模擬載入較早歷史" variant="secondary" disabled={!model.online || locked} onPress={actions.loadOlderHistory} /> : <Text style={styles.meta}>已展示本次合成示例的全部版本。</Text>}
    </View></MotionDisclosure>
  </SectionCard>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, history: { gap: spacing.md },
  revision: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  reading: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
