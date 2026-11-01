import { OriginalHeaderActions, useTasksComposition } from "../../workbench/TasksComposition.mjs";
import { OriginalFilters } from "../../workbench/TasksComposition.mjs";
import { OriginalDateList } from "../../workbench/TasksComposition.mjs";
import { OriginalCalendarLayout } from "../../workbench/TasksComposition.mjs";
import { BackgroundSurface, useCustomBackground } from "../appearance/BackgroundSurface";
import { useContainerWidth } from "../useContainerWidth";
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView as NativeScrollView } from "react-native";
import { Text, TextInput } from "react-native-paper";
import { DateTime } from "luxon";
import { currentTaskMetadata, pendingTasks, recentCompletedTasks, taskCompletionLabel, taskScheduleSections, taskScheduleTime, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { WriteRecoveryActions } from "../../view-model";
import { chineseFont, colors, mobileLayout, mobileType, readingType, spacing, workspaceType } from "../../theme";
import { MotionDetail, MotionDisclosure, MotionList } from "../../motion";
import { AppIcon } from "../AppIcon";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";
import { ReadStateNotice } from "../ReadStateNotice";
import { EmptyListCard } from "../EmptyListCard";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, SectionCard, UnderlineTabs, AppTabPanel, TabToolbar } from "../ui";
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

export function TasksView({ model, actions, recovery, previewControls, onAgent, onHistory }: { onAgent(): void; onHistory(): void; model: TasksViewModel; actions: TasksActions; recovery?: WriteRecoveryActions; previewControls?: ReactNode }) {
  const pageLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const containerLayout = useContainerWidth();
  const compact = pageLayout.width < mobileLayout.breakpoint;
  const composition = useTasksComposition();
  const { route, query } = composition.presentation;
  const { tab, filter, page, day: selectedDay, month: calendarMonth } = route;
  const { setTab, setFilter, setQuery, setPage, setSelectedDay, setCalendarMonth } = composition.ports;
  /* Atomic presentation binding: filter */
  /* Atomic presentation binding: query */
  /* Atomic presentation binding: page */
  /* Atomic presentation binding: selectedDay */
  /* Atomic presentation binding: calendarMonth */
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState({ scope: "", open: false });
  const tabsId = useId();
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const wide = containerLayout.width >= (composition.slots["calendar-layout"] === "care" ? 1100 : 840);
  const scopeKey = `${model.child.id}:${model.access}`;
  const actionMenuOpen = compact && actionMenu.scope === scopeKey && actionMenu.open;
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
  const showAside = composition.layoutAside({ wide, showPanel, tab, readUnavailable, noPendingTasks });
  const listVisible = wide || !showPanel;
  const scrollRef = useRef<NativeScrollView>(null);
  const scrollPosition = useRef(0);
  const rowRefs = useRef(new Map<string, View>());
  const listRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  // A background read may disable action buttons immediately after close; return to stable page context.
  const pageHeading = useRef<View>(null);
  const anchor = useRef<{ id: string | null; position: number; scope: string } | null>(null);
  const previousPanel = useRef(showPanel);
  const restoreFrame = useRef<number | null>(null);
  const returnState = useRef({ showPanel, wide, scopeKey });
  returnState.current = { showPanel, wide, scopeKey };
  useEffect(() => { anchor.current = null; setTab("pending"); setActionMenu({ scope: scopeKey, open: false }); }, [scopeKey]);
  useEffect(() => { setSelectedDay(null); setCalendarMonth(null); setCalendarOpen(false); setFilter("near"); setQuery(""); setPage(0); }, [scopeKey, model.scheduleContext.timeZone]);
  useEffect(() => { if (page !== backlog.page) setPage(backlog.page, false); }, [page, backlog.page]);
  useLayoutEffect(() => () => { if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current); }, []);
  useLayoutEffect(() => {
    const entering = !previousPanel.current && showPanel;
    const returning = previousPanel.current && !showPanel;
    previousPanel.current = showPanel;
    if ((entering || model.access === "lost") && restoreFrame.current !== null) {
      cancelAnimationFrame(restoreFrame.current); restoreFrame.current = null;
    }
    if (model.access === "lost") return;
    if (!wide && entering) {
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
  function changeFilter(next: TaskBacklogFilter) {
    if (occupied) return;
    anchor.current = null; actions.closePanel(); setFilter(next); setSelectedDay(null); setPage(0);
  }
  function selectCalendarDay(day: string | null) {
    if (occupied) return;
    anchor.current = null; actions.closePanel(); setSelectedDay(current => toggleTaskCalendarDay(current, day)); setPage(0);
  }
  /* Calendar and host layout are owned by the calendar-layout render adapter. */
  const readState = listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = listReadState === "loading" ? "正在讀取事項…" : listReadState === "error" ? "未能讀取事項，請重試。" : !model.online ? "目前離線，已載入內容只供參考；恢復連線後才可提交。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : visible.length ? "" : tab === "pending" ? noPendingTasks ? "暫無待辦" : openCount === 0 && model.hasMoreTasks ? "已載入的事項中暫無待辦" : "沒有符合篩選的事項" : model.hasMoreTasks ? "已載入的事項中暫無已完成的事項" : "暫無已完成的事項";
  const pageActions = <OriginalHeaderActions compact={compact} showPanel={showPanel} model={model} occupied={occupied} setActionMenu={setActionMenu} scopeKey={scopeKey} onAgent={onAgent} rememberList={rememberList} actions={actions} onHistory={onHistory} />;
  return <View ref={pageLayout.ref} onLayout={pageLayout.onLayout} style={styles.pageContainer}><ScrollView ref={scrollRef} testID="tasks-page-scroll" style={[styles.pageScroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => { if (listVisible) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <BackgroundSurface padded frosted testID="tasks-reading-panel" ref={node => { containerLayout.ref.current = node; pageHeading.current = node; }} role="region" accessibilityLabel="待辦" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})} onLayout={containerLayout.onLayout} style={styles.stack}>
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "目前為唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      {model.access === "read_only" ? <BackgroundSurface padded><Text style={styles.notice}>目前為唯讀：可以查看共享事項及歷史，不能新增或更改。</Text></BackgroundSurface> : null}
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        <WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online && !model.reading} />
        {composition.topActions ? <View testID="workbench-top-actions" style={styles.headerActions}>{pageActions}</View> : null}
      <OriginalCalendarLayout wide={wide} showAside={showAside} showPanel={showPanel} scopeKey={scopeKey} listVisible={listVisible} listRef={listRef} panelRef={panelRef} model={model} pending={pending} selectedDay={selectedDay} calendarMonth={calendarMonth} occupied={occupied} selectCalendarDay={selectCalendarDay} setCalendarMonth={setCalendarMonth} tab={tab} readUnavailable={readUnavailable} noPendingTasks={noPendingTasks} calendarOpen={calendarOpen}
 renderFilters={mobileCalendar => <OriginalFilters headerActionPorts={{ model, occupied, setActionMenu, scopeKey, rememberList, actions }} containerLayout={containerLayout} model={model} occupied={occupied} compact={compact} actionMenuOpen={actionMenuOpen} setActionMenu={setActionMenu} scopeKey={scopeKey} tabsId={tabsId} tab={tab} actions={actions} setTab={setTab} setFilter={setFilter} setQuery={setQuery} setPage={setPage} setSelectedDay={setSelectedDay} anchor={anchor} readUnavailable={readUnavailable} openCount={openCount} reviewCount={reviewCount} filter={filter} completed={completed} noPendingTasks={noPendingTasks} query={query} selectedDay={selectedDay} backlog={backlog} changeFilter={changeFilter} wide={wide} calendarOpen={calendarOpen} setCalendarOpen={setCalendarOpen} pageActions={pageActions} mobileCalendar={mobileCalendar}
 dateList={<OriginalDateList model={model} recovery={recovery} locked={locked} tab={tab} readUnavailable={readUnavailable} noPendingTasks={noPendingTasks} selectedDay={selectedDay} backlog={backlog} filter={filter} query={query} openCount={openCount} occupied={occupied} actions={actions} anchor={anchor} setQuery={setQuery} setSelectedDay={setSelectedDay} setFilter={setFilter} setPage={setPage} changeFilter={changeFilter} selectCalendarDay={selectCalendarDay} readState={readState} readMessage={readMessage} sections={sections} scopeKey={scopeKey} loading={loading} previousLoading={previousLoading} listVisible={listVisible} rowRefs={rowRefs} rememberList={rememberList} />} />}
 detailUnit={<>
              {!wide ? <Text style={styles.breadcrumb}>待辦清單 / {model.draft ? "編輯安排" : "事項詳情"}</Text> : null}

              {model.selected ? <View key="task-detail" ><TaskDetail model={model} actions={actions} /></View> : null}
            </>} />
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
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1.05, width: undefined }, detailColumn: { flex: 1, width: undefined },
  listSurface: { gap: spacing.md, minWidth: 0 },
  emptyCard: { minHeight: 176, padding: spacing.xl, justifyContent: "center" },
  scheduleList: { minWidth: 0, gap: spacing.sm }, mobileCalendar: { marginBottom: spacing.md },
  backlogToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, minWidth: 0 },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
  listContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: spacing.xs },
  contextLink: { paddingVertical: spacing.xs }, contextLinkText: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, textDecorationLine: "underline" },
  pagination: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm }, loadMore: { gap: spacing.sm, alignItems: "flex-start" },
  reviewShortcut: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
  reviewCopy: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.md, rowGap: spacing.xs },
  reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, fontWeight: "700" },
  reviewNote: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta },
  timeGroup: { minWidth: 0 }, groupHeading: { flexDirection: "row", gap: spacing.sm, alignItems: "baseline", paddingBottom: spacing.sm },
  groupTitle: { fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: "700" },
  pressed: { backgroundColor: colors.pressedOverlay }, reviewPressed: { backgroundColor: colors.warningPressed },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  notice: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool }, breadcrumb: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
});
