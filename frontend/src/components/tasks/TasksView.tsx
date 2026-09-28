import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { taskStateLabels, type TaskState, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { PreviewOperationController } from "../../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { PageFrame } from "../PageFrame";
import { PreviewWriteNotice } from "../PreviewWritePanel";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";
import { taskAssigneeLabel } from "./TaskContent";

export function TasksView({ model, actions, controller, previewControls }: { model: TasksViewModel; actions: TasksActions; controller: PreviewOperationController; previewControls: ReactNode }) {
  const [width, setWidth] = useState(0);
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");
  const wide = width >= 840;
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const visible = model.items.filter(item => stateFilter === "all" || item.occurrence.state === stateFilter);
  return <PageFrame title="任務與預約" description="先核對孩子、負責人及時間，再確認家庭共享安排。回報照護完成與背景處理狀態分開記錄。" eyebrow="育伴港 · 家庭協調">
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.stack}>
      <SectionCard><SectionHeader title={`${model.child.name}的家庭事項`} subtitle={model.dataLabel}
        action={model.access === "editable" ? <AppButton label="新增共享事項" disabled={locked || !!model.draft || model.reading} onPress={actions.startCreate} /> : undefined} />
        <Text style={styles.meta}>{model.workerEnabled === true ? "背景執行開關已啟用（合成）；這個開關不代表 worker 在線或健康。" : model.workerEnabled === false ? "背景執行未啟用或還原後暫停（合成）。可保存安排，但不能假設背景程序正在執行。" : "未提供背景執行開關狀態，不能宣稱 worker 已啟用或接通。"}</Text>
        <Text style={styles.meta}>站內提醒可見，不代表 Web Push／Telegram 送達、已讀或照護完成；本頁沒有發送通知。</Text>
        {model.access === "read_only" ? <Text accessibilityRole="alert" style={styles.notice}>viewer 唯讀：可以查看共享事項及歷史，不能新增或更改。</Text> : null}
        {!model.online ? <Text accessibilityRole="alert" style={styles.notice}>目前離線，現有內容只供參考。草稿保留，可整理內容；提交及原操作查核須等連線恢復。</Text> : null}
      </SectionCard>
      {model.access === "lost" ? <SectionCard><Text accessibilityRole="alert" style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        <PreviewWriteNotice controller={controller} online={model.online && !model.reading} />
        <View style={[styles.workspace, wide && styles.workspaceWide]}>
          <View style={[styles.column, wide && styles.listColumn]}><SectionCard>
            <SectionHeader title="共享事項清單" subtitle={`${model.items.length} 項合成事項；過期不會自動完成。`} />
            <AppSelect label="事項狀態" value={stateFilter} options={[{ value: "all", label: "全部" }, ...Object.entries(taskStateLabels).map(([value, label]) => ({ value: value as TaskState, label }))]} onChange={setStateFilter} disabled={locked || !!model.draft} />
            {model.reading ? <Text accessibilityRole="alert" style={styles.meta}>正在模擬重新讀取，上一批事項及提醒暫不展示；草稿仍保留。</Text> : null}
            {!model.reading && visible.length === 0 ? <Text style={styles.meta}>這個狀態沒有事項。</Text> : null}
            {visible.map(task => <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={`查看事項：${task.title}`} accessibilityState={{ selected: model.selected?.id === task.id, disabled: locked || !!model.draft }}
              disabled={locked || !!model.draft} onPress={() => actions.selectTask(task.id)} style={({ pressed }) => [styles.task, model.selected?.id === task.id && styles.selectedTask, pressed && styles.pressed]}>
              <Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.meta}>{task.kind === "appointment" ? "預約" : "普通任務"} · {taskStateLabels[task.occurrence.state]} · 版本 {task.version}</Text>
              <Text style={styles.meta}>{task.occurrence.dueAt}</Text><Text style={styles.meta}>負責人：{taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)}</Text>
            </Pressable>)}
          </SectionCard></View>
          <View style={[styles.column, wide && styles.detailColumn]}>
            {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : model.selected ? <TaskDetail model={model} actions={actions} /> : <SectionCard><SectionHeader title="選擇一項事項" subtitle="查看安排、背景處理及逐版歷史；只有有權的照顧者可更改共享安排。" /></SectionCard>}
          </View>
        </View>
      </>}
      {previewControls}
    </View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.lg, minWidth: 0 }, workspace: { gap: spacing.lg }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1, width: undefined }, detailColumn: { flex: 1.5, width: undefined },
  task: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, minWidth: 0 },
  selectedTask: { backgroundColor: colors.paleTeal, borderColor: colors.teal }, pressed: { opacity: 0.7 },
  taskTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 23 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  notice: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 23 },
});
