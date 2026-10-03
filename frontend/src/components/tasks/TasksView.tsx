import { brand } from "../../branding";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { taskStateLabels, type TaskState, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { PreviewOperationController } from "../../preview/usePreviewOperation";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { MotionFeedback, MotionList, MotionReveal } from "../../motion";
import { PageFrame } from "../PageFrame";
import { PreviewWriteNotice } from "../PreviewWritePanel";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";
import { taskAssigneeLabel } from "./TaskContent";

export function TasksView({ model, actions, controller, previewControls }: { model: TasksViewModel; actions: TasksActions; controller: PreviewOperationController; previewControls: ReactNode }) {
  const [width, setWidth] = useState(0);
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const wide = width >= 840;
  const scopeKey = `${model.child.id}:${model.access}`;
  const revealIntent = ["saving", "saved"].includes(model.operation.state) ? model.operation.reference : null;
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const visible = model.items.filter(item => stateFilter === "all" || item.occurrence.state === stateFilter);
  const readState = model.reading || model.loadingMoreTasks ? "loading" : !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = model.reading ? "正在模擬重新讀取，上一批事項及提醒暫不展示；草稿仍保留。" : model.loadingMoreTasks ? "正在載入更多事項；已載入的事項保留。" : !model.online ? "目前離線，現有內容只供參考。草稿保留，可整理內容；提交及原操作查核須等連線恢復。" : visible.length ? "" : model.hasMoreTasks ? "已載入事項中沒有這個狀態；其他頁可能有，請載入更多事項。" : "這個狀態沒有事項。";
  return <PageFrame title="任務與預約" density="compact" description="先核對孩子、負責人及時間，再確認家庭共享安排。回報照護完成與背景處理狀態分開記錄。" eyebrow={`${brand.name} · 家庭協調`}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.stack}>
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "viewer 唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      <SectionCard><SectionHeader density="compact" title={`${model.child.name}的家庭事項`} subtitle={model.dataLabel}
        action={model.access === "editable" ? <AppButton label="新增共享事項" disabled={locked || !!model.draft || model.reading} onPress={actions.startCreate} /> : undefined} />
        <Text style={styles.meta}>{model.workerEnabled === true ? "背景執行開關已啟用（合成）；這個開關不代表 worker 在線或健康。" : model.workerEnabled === false ? "背景執行未啟用或還原後暫停（合成）。可保存安排，但不能假設背景程序正在執行。" : "未提供背景執行開關狀態，不能宣稱 worker 已啟用或接通。"}</Text>
        <Text style={styles.meta}>站內提醒可見，不代表 Web Push／Telegram 送達、已讀或照護完成；本頁沒有發送通知。</Text>
        {model.access === "read_only" ? <Text style={styles.notice}>viewer 唯讀：可以查看共享事項及歷史，不能新增或更改。</Text> : null}
      </SectionCard>
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        <PreviewWriteNotice controller={controller} online={model.online && !model.reading} />
        <View style={[styles.workspace, wide && styles.workspaceWide]}>
          <View style={[styles.column, wide && styles.listColumn]}><SectionCard>
            <SectionHeader density="compact" title="共享事項清單" subtitle={`已載入 ${model.items.length} 項合成事項${model.hasMoreTasks ? "；仍有更多事項" : "；已載入全部"}。過期不會自動完成。`} />
            <AppSelect label="事項狀態" value={stateFilter} options={[{ value: "all", label: "全部" }, ...Object.entries(taskStateLabels).map(([value, label]) => ({ value: value as TaskState, label }))]} onChange={setStateFilter} disabled={locked || !!model.draft} />
            <ReadStateNotice state={readState} message={readMessage} />
            <MotionList items={visible} keyExtractor={task => task.id} scopeKey={`${scopeKey}:${stateFilter}`} regionKey="tasks" style={styles.list} eligible={model.operation.state === "saved" && !loading && !previousLoading.current} renderItem={(task, { exiting }) => <Pressable key={task.id} testID={`task-row-${task.id}`} accessibilityRole="button" accessibilityLabel={`查看事項：${task.title}`} accessibilityState={{ selected: model.selected?.id === task.id, disabled: locked || !!model.draft }}
              disabled={locked || !!model.draft || exiting} onPress={() => actions.selectTask(task.id)} style={({ pressed }) => [styles.task, model.selected?.id === task.id && styles.selectedTask, pressed && styles.pressed]}>
              <View style={styles.taskHeading}><Text style={styles.taskTitle}>{task.title}</Text>{model.selected?.id === task.id ? <Text style={styles.selectionMarker}>正在查看</Text> : null}</View><MotionFeedback active={model.operation.state === "saved" && !exiting} triggerKey={task.occurrence.state} scopeKey={`${scopeKey}:${task.id}`}><Text style={styles.meta}>{task.kind === "appointment" ? "預約" : "普通任務"} · {taskStateLabels[task.occurrence.state]} · 版本 {task.version}</Text></MotionFeedback>
              <MotionReveal value={{ dueAt: task.occurrence.dueAt, assignee: taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees) }} contentKey={JSON.stringify([task.occurrence.dueAt, task.assigneeUserId])} scopeKey={`${scopeKey}:${task.id}`} regionKey="task-arrangement" triggerKey={revealIntent} eligible={model.operation.state === "saved" && !exiting} preset="local">{value => <><Text style={styles.meta}>{value.dueAt}</Text><Text style={styles.meta}>負責人：{value.assignee}</Text></>}</MotionReveal>
            </Pressable>} />
            {model.hasMoreTasks ? <AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"}
              disabled={model.loadingMoreTasks || !model.online || model.reading || locked} onPress={actions.loadMoreTasks} /> : null}
          </SectionCard></View>
          <View style={[styles.column, wide && styles.detailColumn]}>
            {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : model.selected ? <TaskDetail model={model} actions={actions} /> : <SectionCard><SectionHeader density="compact" title="選擇一項事項" subtitle="查看安排、背景處理及逐版歷史；只有有權的照顧者可更改共享安排。" /></SectionCard>}
          </View>
        </View>
      </>}
      {previewControls}
    </View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md },
  stack: { gap: spacing.lg, minWidth: 0 }, workspace: { gap: spacing.lg }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1, width: undefined }, detailColumn: { flex: 1.5, width: undefined },
  task: { gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, minWidth: 0 },
  selectedTask: { backgroundColor: colors.paleTeal }, pressed: { opacity: 0.7 },
  taskHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm },
  taskTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  selectionMarker: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  notice: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
});
