import { useContainerWidth } from "../useContainerWidth";
import { brand } from "../../branding";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { taskNextStep, taskScheduleSections, taskScheduleTime, taskStateLabels, type TaskState, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { PreviewOperationController } from "../../preview/usePreviewOperation";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { MotionDetail, MotionDisclosure, MotionFeedback, MotionList, MotionReveal } from "../../motion";
import { AppIcon } from "../AppIcon";
import { PageFrame } from "../PageFrame";
import { PreviewWriteNotice } from "../PreviewWritePanel";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../ui";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";
import { taskAssigneeLabel } from "./TaskContent";

export function TasksView({ model, actions, controller, previewControls }: { model: TasksViewModel; actions: TasksActions; controller: PreviewOperationController; previewControls: ReactNode }) {
  const containerLayout = useContainerWidth();
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const wide = containerLayout.width >= 840;
  const scopeKey = `${model.child.id}:${model.access}`;
  const revealIntent = ["saving", "saved"].includes(model.operation.state) ? model.operation.reference : null;
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const occupied = locked || !!model.draft || model.reading;
  const visible = model.items.filter(item => stateFilter === "all" || item.occurrence.state === stateFilter);
  const sections = taskScheduleSections(visible);
  const showPanel = !!(model.selected || model.draft);
  const listVisible = wide || !showPanel;
  const scrollRef = useRef<NativeScrollView>(null);
  const scrollPosition = useRef(0);
  const rowRefs = useRef(new Map<string, View>());
  const listRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const anchor = useRef<{ id: string | null; position: number; scope: string } | null>(null);
  const previousPanel = useRef(showPanel);
  const previousDraft = useRef(model.draft?.key);
  const restoreFrame = useRef<number | null>(null);
  const returnState = useRef({ showPanel, wide, scopeKey });
  returnState.current = { showPanel, wide, scopeKey };
  useEffect(() => { anchor.current = null; }, [scopeKey]);
  useLayoutEffect(() => () => { if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current); }, []);
  useLayoutEffect(() => {
    const entering = !previousPanel.current && showPanel;
    const returning = previousPanel.current && !showPanel;
    const editing = !!model.draft && model.draft.key !== previousDraft.current;
    previousPanel.current = showPanel; previousDraft.current = model.draft?.key;
    if ((entering || editing || model.access === "lost") && restoreFrame.current !== null) {
      cancelAnimationFrame(restoreFrame.current); restoreFrame.current = null;
    }
    if (model.access === "lost") return;
    if (!wide && (entering || editing)) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") (panelRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    }
    const saved = anchor.current;
    if (returning && saved?.scope === scopeKey) {
      if (Platform.OS === "web") {
        const candidates = [saved.id ? rowRefs.current.get(saved.id) : null, listRef.current];
        for (const candidate of candidates) {
          const target = candidate as unknown as HTMLElement | null;
          if (!target?.isConnected || !target.getClientRects().length || target.getAttribute("aria-disabled") === "true") continue;
          target.focus({ preventScroll: true });
          if (document.activeElement === target) break;
        }
      }
      if (!wide) restoreFrame.current = requestAnimationFrame(() => {
        restoreFrame.current = null;
        const current = returnState.current;
        if (!current.showPanel && !current.wide && current.scopeKey === saved.scope) scrollRef.current?.scrollTo({ y: saved.position, animated: false });
      });
    }
  }, [showPanel, model.draft?.key, model.access, scopeKey, wide]);
  function rememberList(id: string | null) { anchor.current = { id, position: scrollPosition.current, scope: scopeKey }; }
  const readState = loading ? "loading" : !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = model.reading ? "正在模擬重新讀取，上一批事項及提醒暫不展示；草稿仍保留。" : model.loadingMoreTasks ? "正在載入更多事項；已載入的事項保留。" : !model.online ? "目前離線，現有內容只供參考。草稿保留，可整理內容；提交及原操作查核須等連線恢復。" : visible.length ? "" : model.hasMoreTasks ? "已載入事項中沒有這個狀態；其他頁可能有，請載入更多事項。" : "這個狀態沒有事項。";
  return <PageFrame title="待辦與預約" density="compact" description="按時間看安排，清楚知道誰負責、下一步做甚麼。" eyebrow={`${brand.name} · 家庭行動`} scrollRef={scrollRef} scrollTestID="tasks-page-scroll" onScroll={event => { if (listVisible) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.stack}>
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "viewer 唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      <View style={styles.context}><View style={styles.contextCopy}><Text style={styles.sectionTitle}>{model.child.name}的家庭事項</Text><Text style={styles.meta}>{model.dataLabel}</Text></View>
        {model.access === "editable" ? <AppButton label="新增共享事項" density="compact" disabled={occupied} onPress={() => { rememberList(null); actions.startCreate(); }} /> : null}
      </View>
      {model.access === "read_only" ? <Text style={styles.notice}>viewer 唯讀：可以查看共享事項及歷史，不能新增或更改。</Text> : null}
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        <PreviewWriteNotice controller={controller} online={model.online && !model.reading} />
        <View testID="tasks-workspace" style={[styles.workspace, wide && showPanel && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showPanel && styles.listColumn, !listVisible && styles.hidden]}>
            <View ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>
              <View style={styles.toolbar}><View style={styles.contextCopy}><Text style={styles.sectionTitle}>時間安排</Text><Text style={styles.meta}>已載入 {model.items.length} 項{model.hasMoreTasks ? "，仍有更多" : ""} · 日期依各事項時區</Text></View><AppSelect label="事項狀態" value={stateFilter} options={[{ value: "all", label: "全部" }, ...Object.entries(taskStateLabels).map(([value, label]) => ({ value: value as TaskState, label }))]} onChange={setStateFilter} disabled={occupied} /></View>
              <ReadStateNotice state={readState} message={readMessage} />
              {sections.map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={styles.timeGroup}>
                <View style={styles.groupHeading}><Text accessibilityRole="header" style={styles.groupTitle}>{section.label}</Text><Text style={styles.meta}>{section.items.length} 項</Text></View>
                <MotionList items={section.items} keyExtractor={task => task.id} scopeKey={`${scopeKey}:${stateFilter}`} regionKey={`tasks:${section.id}`} eligible={model.operation.state === "saved" && !loading && !previousLoading.current && listVisible} renderItem={(task, { exiting }) => <Pressable key={task.id} ref={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} testID={`task-row-${task.id}`} accessibilityRole="button" accessibilityLabel={`查看事項：${task.title}`} accessibilityState={{ selected: model.selected?.id === task.id, disabled: occupied }} aria-current={model.selected?.id === task.id ? "true" : undefined} aria-disabled={occupied || exiting}
                  disabled={occupied || exiting} onPress={() => { rememberList(task.id); actions.selectTask(task.id); }} style={({ pressed }) => [styles.task, model.selected?.id === task.id && styles.selectedTask, pressed && styles.pressed]}>
                  <View style={styles.timeRail}><Text style={styles.time}>{taskScheduleTime(task)}</Text><Text style={styles.meta}>{task.kind === "appointment" ? "預約" : "任務"}</Text></View>
                  <View style={styles.taskCopy}><View style={styles.taskHeading}><Text style={styles.taskTitle}>{task.title}</Text>{model.selected?.id === task.id ? <Text style={styles.selectionMarker}>正在查看</Text> : null}</View>
                    <MotionReveal value={{ dueAt: task.occurrence.dueAt, assignee: taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees) }} contentKey={JSON.stringify([task.occurrence.dueAt, task.assigneeUserId])} scopeKey={`${scopeKey}:${task.id}`} regionKey="task-arrangement" triggerKey={revealIntent} eligible={model.operation.state === "saved" && !exiting} preset="local">{value => <Text style={styles.meta}>負責人：{value.assignee}</Text>}</MotionReveal>
                    <View style={styles.rowStatus}><MotionFeedback active={model.operation.state === "saved" && !exiting} triggerKey={task.occurrence.state} scopeKey={`${scopeKey}:${task.id}`}><Text style={[styles.state, task.occurrence.state === "needs_review" && styles.notice]}>{taskStateLabels[task.occurrence.state]}</Text></MotionFeedback><Text style={styles.meta}>{taskNextStep(task, model.eligibleAssignees)}</Text></View>
                    <Text style={styles.metadata}>{task.occurrence.timeZone} · 版本 {task.version}</Text>
                  </View><AppIcon name="chevron-right" size={18} color={colors.muted} />
                </Pressable>} />
              </View>)}
              {model.hasMoreTasks ? <AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /> : null}
              <Text style={styles.meta}>過期不會自動完成；回報完成與通知送達分開核對。</Text>
            </View>
          </MotionDetail>
          {showPanel ? <MotionDetail activeKey={model.draft ? `edit:${model.draft.key}` : model.selected?.id ?? "detail"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, wide && styles.detailColumn]}><View ref={panelRef} tabIndex={-1} testID="task-detail-panel" style={styles.stack}>
            {!wide ? <Text style={styles.breadcrumb}>待辦清單 / {model.draft ? "編輯安排" : "事項詳情"}</Text> : null}
            {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : null}
            {model.selected ? <View key="task-detail" style={model.draft ? styles.hidden : undefined} pointerEvents={model.draft ? "none" : "auto"} aria-hidden={!!model.draft} accessibilityElementsHidden={!!model.draft} importantForAccessibility={model.draft ? "no-hide-descendants" : "auto"}><TaskDetail model={model} actions={actions} /></View> : null}
          </View></MotionDetail> : null}
        </View>
        <View style={styles.background}><AppButton label={backgroundOpen ? "收起背景與提醒說明" : "背景與提醒狀態"} density="compact" variant="quiet" onPress={() => setBackgroundOpen(value => !value)} />
          <MotionDisclosure expanded={backgroundOpen} scopeKey={scopeKey}><View style={styles.stack}>
            <Text style={styles.meta}>{model.workerEnabled === true ? "背景執行開關已啟用（合成）；這個開關不代表 worker 在線或健康。" : model.workerEnabled === false ? "背景執行未啟用或還原後暫停（合成）。可保存安排，但不能假設背景程序正在執行。" : "未提供背景執行開關狀態，不能宣稱 worker 已啟用或接通。"}</Text>
            <Text style={styles.meta}>站內提醒可見，不代表 Web Push／Telegram 送達、已讀或照護完成；本頁沒有發送通知。</Text>
          </View></MotionDisclosure>
        </View>
      </>}
      {previewControls}
    </View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  context: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, contextCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1.05, width: undefined }, detailColumn: { flex: 1, width: undefined },
  listSurface: { gap: spacing.lg, minWidth: 0 }, toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  timeGroup: { minWidth: 0 }, groupHeading: { flexDirection: "row", gap: spacing.sm, alignItems: "baseline", paddingBottom: spacing.sm },
  groupTitle: { fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: "700" },
  task: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, minWidth: 0 },
  timeRail: { width: 52, alignSelf: "flex-start", gap: spacing.xs }, time: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  taskCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, selectedTask: { backgroundColor: colors.paleTeal, borderRadius: radius.small }, pressed: { opacity: 0.7 },
  taskHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm },
  taskTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  selectionMarker: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  rowStatus: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm }, state: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, metadata: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  notice: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool }, breadcrumb: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  background: { alignItems: "flex-start", borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.sm },
});
