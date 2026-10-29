import { serializeTaskRoute, type TaskRouteState } from "../../navigation/route-state";
import { WorkspaceSwitch } from "../workspace/WorkspaceSwitch";
import { Workspace } from "../workspace/Workspace";
import { BackgroundSurface, useCustomBackground } from "../appearance/BackgroundSurface";
import { useContainerWidth } from "../useContainerWidth";
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import { Platform, StyleSheet, View, type ScrollView as NativeScrollView } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { DateTime } from "luxon";
import { currentTaskMetadata, pendingTasks, recentCompletedTasks, taskCompletionLabel, taskScheduleSections, taskScheduleTime, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { WriteRecoveryActions } from "../../view-model";
import { chineseFont, colors, mobileLayout, readingType, spacing } from "../../theme";
import { MotionDetail, MotionDisclosure, MotionList } from "../../motion";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { taskSavedPresentation } from "./task-saved-presentation";
import { ReadStateNotice } from "../ReadStateNotice";
import { EmptyListCard } from "../EmptyListCard";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, SectionCard, AppTabPanel } from "../ui";
import { TaskListRow } from "./TaskListRow";
import { TaskDetail } from "./TaskDetail";
import { FormDialog } from "../FormDialog";
import { TaskForm } from "./TaskForm";
import { taskAssigneeLabel } from "./TaskContent";
import { TasksCalendar } from "./TasksCalendar";
import { projectTaskBacklog, toggleTaskCalendarDay, type TaskBacklogFilter } from "./task-calendar";

const backlogFilters: { key: TaskBacklogFilter; label: string }[] = [
  { key: "near", label: "近期 7 天" }, { key: "earlier", label: "較早未處理" },
  { key: "later", label: "之後" }, { key: "all", label: "全部" }, { key: "review", label: "待覆核" }, { key: "unconfirmed", label: "時間待核對" },
];
const backlogLabels: Record<TaskBacklogFilter, string> = { near: "近期 7 天", earlier: "較早未處理", later: "之後", review: "待覆核", unconfirmed: "時間待核對", all: "全部日期" };

export function TasksView({ model, actions, recovery, previewControls, onAgent, onHistory, route, onRouteChange, query, onQueryChange }: { route: TaskRouteState; onRouteChange(next: TaskRouteState, mode?: "push" | "replace"): void; query: string; onQueryChange(query: string): void; onAgent(): void; onHistory(): void; model: TasksViewModel; actions: TasksActions; recovery?: WriteRecoveryActions; previewControls?: ReactNode }) {
  const pageLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const containerLayout = useContainerWidth();
  const compact = pageLayout.width < mobileLayout.breakpoint;
  const { tab, filter, page, day: selectedDay, month: calendarMonth } = route;
  const setQuery = onQueryChange;
  const changeView = (patch: Partial<TaskRouteState>, mode: "push" | "replace" = "replace") => onRouteChange({ ...route, taskId: null, ...patch }, mode);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const tabsId = useId();
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const wide = containerLayout.width >= 1100;
  const scopeKey = `${model.child.id}:${model.access}`;
  // The owner reports invalid-ID/404 reads through the same operation slot.
  // Only a proven no-draft/no-receipt detail read gets read-specific wording.
  const detailReadFailed = model.detailRead?.state === "error" && model.detailRead.id === route.taskId
    && !model.selected && !model.draft && model.operation.state === "failed" && model.operation.reference === null
    && !model.operation.referenceLabel && !model.operation.resultUnavailable
    && (model.operation.recovery === undefined || model.operation.recovery === "reload");
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const occupied = locked || !!model.draft || model.reading || readUnavailable;
  const pending = pendingTasks(model.items);
  const completed = recentCompletedTasks(model.items);
  const backlog = projectTaskBacklog(model.items, model.scheduleContext, { filter, query, page, selectedDay }, model.eligibleAssignees);
  const visible = tab === "completed" ? completed : backlog.items;
  const sections = tab === "completed" ? [{ id: "completed", label: "最近完成", items: visible }]
    : selectedDay ? [{ id: selectedDay, label: DateTime.fromISO(selectedDay, { zone: model.scheduleContext.timeZone }).setLocale("zh-HK").toFormat("M月d日 cccc"), items: visible }]
      : taskScheduleSections(visible, model.scheduleContext);
  const openCount = pending.length;
  const noPendingTasks = listReadState === "ready" && model.online && openCount === 0 && !model.hasMoreTasks;
  const reviewCount = backlog.counts.review;
  const showPanel = !!model.selected;
  const showAside = showPanel;
  const listVisible = wide || !showPanel;
  const scrollRef = useRef<NativeScrollView>(null);
  const scrollPosition = useRef(0);
  const rowRefs = useRef(new Map<string, View>());
  const listRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  // A background read may disable action buttons immediately after close; return to stable page context.
  const pageHeading = useRef<View>(null);
  const anchor = useRef<{ id: string | null; position: number; scope: string } | null>(null);
  const previousPanel = useRef(false);
  const previousSelection = useRef<{ id: string | null; scope: string }>({ id: null, scope: scopeKey });
  const restoreFrame = useRef<number | null>(null);
  const returnState = useRef({ showPanel, wide, scopeKey });
  returnState.current = { showPanel, wide, scopeKey };
  useEffect(() => { anchor.current = null; }, [scopeKey]);
  useEffect(() => { setCalendarOpen(false); }, [scopeKey, model.scheduleContext.timeZone]);
  useEffect(() => { if (!model.reading && model.readState === "ready" && page !== backlog.page) changeView({ page: backlog.page }); }, [page, backlog.page]);
  useLayoutEffect(() => () => { if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current); }, []);
  useLayoutEffect(() => {
    const entering = showPanel && (previousSelection.current.id !== model.selected?.id || previousSelection.current.scope !== scopeKey);
    previousSelection.current = { id: model.selected?.id ?? null, scope: scopeKey };
    const returning = previousPanel.current && !showPanel;
    previousPanel.current = showPanel;
    if ((entering || model.access === "lost") && restoreFrame.current !== null) {
      cancelAnimationFrame(restoreFrame.current); restoreFrame.current = null;
    }
    if (model.access === "lost") return;
    if (entering) {
      if (!wide) scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") {
        const element = panelRef.current as unknown as HTMLElement | null;
        element?.focus({ preventScroll: true });
        if (wide) element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      } else panelRef.current?.focus();
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
  }, [showPanel, model.selected?.id, model.draft?.key, model.access, scopeKey, wide]);
  function rememberList(id: string | null) { anchor.current = { id, position: scrollPosition.current, scope: scopeKey }; }
  function changeFilter(next: TaskBacklogFilter) {
    if (occupied) return;
    anchor.current = null; changeView({ filter: next, day: null, page: 0 });
  }
  function selectCalendarDay(day: string | null) {
    if (occupied) return;
    anchor.current = null; changeView({ day: toggleTaskCalendarDay(selectedDay, day), page: 0 });
  }
  const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) changeView({ month }); }} />;
  const readState = listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = listReadState === "loading" ? "正在讀取事項…" : listReadState === "error" ? "未能讀取事項，請重試。" : !model.online ? "目前離線，已載入內容只供參考；恢復連線後才可提交。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : visible.length ? "" : tab === "pending" ? noPendingTasks ? "暫無待辦" : openCount === 0 && model.hasMoreTasks ? "已載入的事項中暫無待辦" : "沒有符合篩選的事項" : model.hasMoreTasks ? "已載入的事項中暫無已完成的事項" : "暫無已完成的事項";
  const pageActions = <>
    {model.access === "editable" ? <><AppButton label="請助手安排" density="compact" variant="secondary" disabled={occupied} onPress={() => { onAgent(); }} />
      <AppButton label="手動新增" accessibilityLabel="手動新增共享事項" variant={showPanel ? "quiet" : "primary"} density="compact" disabled={occupied} onPress={() => { rememberList(null); actions.startCreate(); }} /></> : null}
    <AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={() => { onHistory(); }} />
  </>;
  return <View ref={pageLayout.ref} onLayout={pageLayout.onLayout} style={styles.pageContainer}><ScrollView ref={scrollRef} testID="tasks-page-scroll" style={[styles.pageScroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => { if (listVisible) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <BackgroundSurface padded frosted testID="tasks-reading-panel" ref={node => { containerLayout.ref.current = node; pageHeading.current = node; }} role="region" accessibilityLabel="待辦" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})} onLayout={containerLayout.onLayout} style={styles.stack}>
      <Workspace.Root title="待辦與預約"><Workspace.Header><Workspace.Heading />{model.access !== "lost" ? <Workspace.Actions><View testID="tasks-page-actions" style={styles.headerActions}>{pageActions}</View></Workspace.Actions> : null}</Workspace.Header></Workspace.Root>
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "目前為唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      {model.access === "read_only" ? <BackgroundSurface padded><Text style={styles.notice}>目前為唯讀：可以查看共享事項及歷史，不能新增或更改。</Text></BackgroundSurface> : null}
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        {detailReadFailed ? <ReadStateNotice state="error" title="未能讀取這項事項" message={model.operation.message} />
          : <WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online && !model.reading} savedPresentation={taskSavedPresentation(model)} />}
        <View testID="tasks-workspace" style={[styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <BackgroundSurface padded ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>
              <View testID="tasks-tab-toolbar"><WorkspaceSwitch id={tabsId} label="事項分類" items={[{ key: "pending", label: "待處理", description: "近期安排、預約與待回報事項", count: readUnavailable ? undefined : `${openCount}${model.hasMoreTasks ? "+" : ""}` }, { key: "completed", label: "已完成", description: "回看最近完成的安排" }]} value={tab} onChange={next => { if (occupied) return; setQuery(""); changeView({ tab: next, filter: "near", page: 0, day: null }, "push"); anchor.current = null; }} /></View>
              {!readUnavailable && reviewCount > 0 ? <View testID="tasks-review-shortcut" style={styles.reviewShortcut}><Text style={styles.reviewTitle}>{reviewCount} 項待覆核{model.hasMoreTasks ? "（已載入）" : ""} · 已停催</Text>
                <AppButton label={filter === "review" && tab === "pending" ? "返回近期安排" : "查看待覆核"} accessibilityLabel={`查看已載入的 ${reviewCount} 項待覆核安排，已停止催辦`} variant="quiet" disabled={occupied} onPress={() => { if (occupied) return; setQuery(""); changeView({ tab: "pending", filter: tab === "pending" && filter === "review" ? "near" : "review", day: null, page: 0 }, tab === "pending" ? "replace" : "push"); }} />
              </View> : null}
              {tab === "completed" && !readUnavailable && completed.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null}
              <AppTabPanel tabsId={tabsId} tabKey={tab} active>
              {tab === "pending" && !readUnavailable && !noPendingTasks ? <View style={styles.backlogToolbar}>
                <View style={styles.searchField}><AppTextField dense label="搜尋已載入事項" accessibilityLabel="搜尋已載入事項" placeholder="標題、內容或負責人…" value={query} disabled={occupied} right={query ? <TextInput.Icon icon="close" accessibilityLabel="清除搜尋" disabled={occupied} onPress={() => { if (!occupied) { anchor.current = null; setQuery(""); changeView({ page: 0 }); } }} /> : undefined} onChangeText={value => { if (occupied) return; anchor.current = null; setQuery(value); changeView({ page: 0 }); }} /></View>
                <AppSelect<TaskBacklogFilter | "day"> label="範圍" value={selectedDay ? "day" : filter} options={[
                  ...(selectedDay ? [{ value: "day" as const, label: DateTime.fromISO(selectedDay).toFormat("M月d日") }] : []),
                  ...backlogFilters.filter(item => item.key !== "unconfirmed" || backlog.counts.unconfirmed > 0 || filter === item.key).map(item => ({ value: item.key, label: item.label, count: backlog.counts[item.key] })),
                ]} disabled={occupied} onChange={value => { if (value !== "day") changeFilter(value); }} />
                <AppSelectionTrigger label={selectedDay ? "日期 · 已選" : "日期"} calendar expanded={calendarOpen} disabled={occupied} onPress={() => { if (!occupied) setCalendarOpen(open => !open); }} />
              </View> : null}
              {tab === "pending" && !readUnavailable && !noPendingTasks ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null}
              <View style={styles.scheduleList}>
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
              </View>
              </AppTabPanel>
              {model.hasMoreTasks ? <View style={styles.loadMore}><Text style={styles.meta}>仍有事項未載入；月曆、搜尋及數目只包括已載入事項。</Text><AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /></View> : null}
            </BackgroundSurface>
          </MotionDetail>
          {showAside ? <MotionDetail activeKey={model.selected?.id ?? "detail"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, styles.readerColumn, wide && styles.detailColumn]}>
            <BackgroundSurface ref={panelRef} tabIndex={-1} role="region" accessibilityLabel={`事項詳情：${model.selected?.title ?? ""}`} testID="task-detail-panel" style={styles.stack}>
              {model.selected ? <TaskDetail model={model} actions={actions} /> : null}
            </BackgroundSurface>
          </MotionDetail> : null}
        </View>
      </>}
      <FormDialog formKey={model.draft?.key} visible={!!model.draft} scopeKey={scopeKey} title="安排事項" returnFocusRef={pageHeading} onClose={actions.closePanel}
        recovery={<WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online} />}>
        {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : null}
      </FormDialog>
      {previewControls}
    </BackgroundSurface>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  transparent: { backgroundColor: "transparent" },
  pageContainer: { flex: 1, minWidth: 0, minHeight: 0 }, pageScroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1, width: undefined }, detailColumn: { flex: 1.3, width: undefined },
  readerColumn: { maxWidth: 760, backgroundColor: colors.white, padding: 16 },
  listSurface: { gap: spacing.lg, minWidth: 0, backgroundColor: colors.white, padding: spacing.lg },
  emptyCard: { paddingVertical: spacing.lg },
  scheduleList: { minWidth: 0, gap: spacing.sm }, mobileCalendar: { marginBottom: spacing.md },
  backlogToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minWidth: 0 },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
  listContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs },
  pagination: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm }, loadMore: { gap: spacing.sm, alignItems: "flex-start" },
  reviewShortcut: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
  reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body, fontWeight: "600" },
  timeGroup: { minWidth: 0, paddingTop: spacing.lg }, groupHeading: { flexDirection: "row", gap: spacing.sm, alignItems: "baseline", paddingBottom: spacing.sm },
  groupTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  notice: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
});
