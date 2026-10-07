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
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppSelect, AppSelectionTrigger, AppTextField, SectionCard, UnderlineTabs, AppTabPanel } from "../ui";
import { TaskListRow } from "./TaskListRow";
import { TaskDetail } from "./TaskDetail";
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
  const containerLayout = useContainerWidth();
  const compact = pageLayout.width < mobileLayout.breakpoint;
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [filter, setFilter] = useState<TaskBacklogFilter>("near");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const tabsId = useId();
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
  const wide = containerLayout.width >= 840;
  const scopeKey = `${model.child.id}:${model.access}`;
  const locked = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const occupied = locked || !!model.draft || model.reading || readUnavailable;
  const pending = pendingTasks(model.items);
  const completed = recentCompletedTasks(model.items);
  const backlog = projectTaskBacklog(model.items, model.scheduleContext, { filter, query, page, selectedDay }, model.eligibleAssignees);
  const visible = tab === "completed" ? completed : backlog.items;
  const sections = tab === "completed" ? [{ id: "completed", label: "最近回報完成", items: visible }]
    : selectedDay ? [{ id: selectedDay, label: DateTime.fromISO(selectedDay, { zone: model.scheduleContext.timeZone }).setLocale("zh-HK").toFormat("M月d日 cccc"), items: visible }]
      : taskScheduleSections(visible, model.scheduleContext);
  const openCount = pending.length;
  const reviewCount = backlog.counts.review;
  const timeZoneLabel = model.scheduleContext.timeZone === "Asia/Hong_Kong" ? "香港時間" : model.scheduleContext.timeZone;
  const showPanel = !!(model.selected || model.draft);
  const showAside = showPanel || (wide && tab === "pending" && !readUnavailable);
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
  useEffect(() => { anchor.current = null; setTab("pending"); }, [scopeKey]);
  useEffect(() => { setSelectedDay(null); setCalendarMonth(null); setCalendarOpen(false); setFilter("near"); setQuery(""); setPage(0); }, [scopeKey, model.scheduleContext.timeZone]);
  useEffect(() => { if (page !== backlog.page) setPage(backlog.page); }, [page, backlog.page]);
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
  function changeFilter(next: TaskBacklogFilter) {
    if (occupied) return;
    anchor.current = null; actions.closePanel(); setFilter(next); setSelectedDay(null); setPage(0);
  }
  function selectCalendarDay(day: string | null) {
    if (occupied) return;
    anchor.current = null; actions.closePanel(); setSelectedDay(current => toggleTaskCalendarDay(current, day)); setPage(0);
  }
  const calendar = <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) setCalendarMonth(month); }} />;
  const readState = loading || listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = model.reading || listReadState === "loading" ? "正在讀取事項…" : model.loadingMoreTasks ? "正在載入更多事項…" : listReadState === "error" ? "未能讀取事項，請重試。" : !model.online ? "目前離線，已載入內容只供參考；恢復連線後才可提交。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : visible.length ? "" : tab === "pending" ? "沒有符合篩選的事項。" : "暫時沒有已回報完成的事項。";
  return <View ref={pageLayout.ref} onLayout={pageLayout.onLayout} style={styles.pageContainer}><ScrollView ref={scrollRef} testID="tasks-page-scroll" style={styles.pageScroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => { if (listVisible) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View style={styles.pageHeader}><View style={styles.headerCopy}><Text accessibilityRole="header" style={[styles.pageTitle, compact && mobileType.heading]}>待辦與預約</Text><Text style={styles.description}>跟助手說好安排，在這裏查看及回報</Text></View>
      {model.access === "editable" ? <View style={styles.headerActions}><AppButton label="請助手安排" density="compact" disabled={occupied} onPress={onAgent} /><AppButton label="手動新增" accessibilityLabel="手動新增共享事項" density="compact" variant="secondary" disabled={occupied} onPress={() => { rememberList(null); actions.startCreate(); }} /></View> : null}
    </View>
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.stack}>
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "目前為唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      {model.access === "read_only" ? <Text style={styles.notice}>目前為唯讀：可以查看共享事項及歷史，不能新增或更改。</Text> : null}
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        <WriteRecoveryNotice operation={model.operation} recovery={recovery} online={model.online && !model.reading} />
        <View testID="tasks-workspace" style={[styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={[styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <View ref={listRef} tabIndex={-1} testID="tasks-list" style={styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>
              <View style={styles.tabsBar}><View style={styles.tabs}><UnderlineTabs id={tabsId} label="事項分類" items={[{ key: "pending", label: readUnavailable ? "待處理" : `待處理 ${openCount}${model.hasMoreTasks ? "+" : ""}` }, { key: "completed", label: "已回報完成" }]} value={tab} onChange={next => { if (occupied) return; actions.closePanel(); setTab(next); setFilter("near"); setQuery(""); setPage(0); setSelectedDay(null); anchor.current = null; }} /></View><AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={onHistory} /></View>
              {!readUnavailable && reviewCount > 0 ? <Pressable testID="tasks-review-shortcut" accessibilityRole="button" accessibilityLabel={`查看已載入的 ${reviewCount} 項待覆核安排，已停止催辦`} disabled={occupied} accessibilityState={{ disabled: occupied }} aria-disabled={occupied} onPress={() => { if (occupied) return; setTab("pending"); setQuery(""); changeFilter(tab === "pending" && filter === "review" ? "near" : "review"); }} style={({ pressed }) => [styles.reviewShortcut, pressed && !occupied && styles.reviewPressed]}><View style={styles.reviewCopy}><Text style={styles.reviewTitle}>{reviewCount} 項待覆核{model.hasMoreTasks ? "（已載入）" : ""}</Text><Text style={styles.reviewNote}>{filter === "review" && tab === "pending" ? "返回近期安排" : "完成或取消仍未確定 · 已停催"}</Text></View><AppIcon name={filter === "review" && tab === "pending" ? "chevron-left" : "chevron-right"} size={18} color={colors.warningInk} /></Pressable> : null}
              {tab === "completed" && !readUnavailable ? <Text style={styles.meta}>{model.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null}
              <AppTabPanel tabsId={tabsId} tabKey={tab} active>
              {tab === "pending" && !readUnavailable ? <View style={styles.backlogToolbar}>
                <View style={styles.searchField}><AppTextField dense label="搜尋已載入事項" placeholder="標題、內容或負責人" value={query} disabled={occupied} right={query ? <TextInput.Icon icon="close" accessibilityLabel="清除搜尋" disabled={occupied} onPress={() => { if (!occupied) { anchor.current = null; actions.closePanel(); setQuery(""); setPage(0); } }} /> : undefined} onChangeText={value => { if (occupied) return; anchor.current = null; actions.closePanel(); setQuery(value); setPage(0); }} /></View>
                <AppSelect<TaskBacklogFilter | "day"> label="範圍" value={selectedDay ? "day" : filter} options={[
                  ...(selectedDay ? [{ value: "day" as const, label: DateTime.fromISO(selectedDay).toFormat("M月d日") }] : []),
                  ...backlogFilters.filter(item => item.key !== "unconfirmed" || backlog.counts.unconfirmed > 0 || filter === item.key).map(item => ({ value: item.key, label: item.label, count: backlog.counts[item.key] })),
                ]} disabled={occupied} onChange={value => { if (value !== "day") changeFilter(value); }} />
                {!wide ? <AppSelectionTrigger label={selectedDay ? "日期 · 已選" : "日期"} calendar expanded={calendarOpen} disabled={occupied} onPress={() => { if (!occupied) setCalendarOpen(open => !open); }} /> : null}
              </View> : null}
              {tab === "pending" && !wide && !model.reading ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null}
              <View style={styles.scheduleList}>
              {tab === "pending" && !readUnavailable ? <View style={styles.listContext}>
                <Text style={styles.meta} accessibilityLiveRegion="polite">{selectedDay ? `${DateTime.fromISO(selectedDay).toFormat("M月d日")}` : backlogLabels[filter]}{!selectedDay && filter === "near" && backlog.nearLabel ? ` · ${backlog.nearLabel}` : ""}{query.trim() ? " · 搜尋結果" : ""} · {timeZoneLabel} · 已載入 {backlog.total} 項{backlog.total > 0 ? `，顯示 ${backlog.from}–${backlog.to}` : ""}</Text>
                {backlog.counts.earlier > 0 && filter !== "earlier" ? <Pressable accessibilityRole="button" accessibilityLabel={`查看已載入的 ${backlog.counts.earlier} 項較早未處理事項`} disabled={occupied} aria-disabled={occupied} onPress={() => changeFilter("earlier")} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>較早未處理 {backlog.counts.earlier}</Text></Pressable> : null}
                {selectedDay ? <Pressable accessibilityRole="button" accessibilityLabel="只取消日期篩選" disabled={occupied} aria-disabled={occupied} onPress={() => selectCalendarDay(null)} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>取消日期</Text></Pressable> : null}
              </View> : null}
              <ReadStateNotice state={readState} message={readMessage}>
                {(readState === "error" || readState === "stale") && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" variant="secondary" density="compact" disabled={!model.online || model.reading || locked || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
                {readState === "empty" && tab === "pending" ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied} onPress={() => { if (occupied) return; anchor.current = null; actions.closePanel(); setQuery(""); setSelectedDay(null); setFilter("all"); setPage(0); }} /> : null}
              </ReadStateNotice>
              {model.reading && model.draft ? <Text style={styles.meta}>草稿已保留。</Text> : null}
              {!readUnavailable && sections.map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={styles.timeGroup}>
                <View style={styles.groupHeading}><Text accessibilityRole="header" style={styles.groupTitle}>{section.label}</Text><Text style={styles.meta}>{section.items.length} 項</Text></View>
                <MotionList items={section.items} keyExtractor={task => task.id} scopeKey={`${scopeKey}:${tab}`} regionKey={`tasks:${section.id}`} eligible={model.operation.state === "saved" && !loading && !previousLoading.current && listVisible} renderItem={(task, { exiting }) => {
                  const work = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders).work;
                  const assigneeMissing = task.occurrence.state === "scheduled" && !model.eligibleAssignees.some(person => person.userId === task.assigneeUserId);
                  const warning = assigneeMissing ? "請重新核對負責人" : work?.status === "unknown" ? "提醒處理結果待核對" : work?.status === "failed" ? "提醒處理未成功，請查看詳情" : null;
                  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(model.scheduleContext.timeZone);
                  const date = section.id === "today" || (tab === "pending" && selectedDay) ? "" : due.isValid ? `${due.toFormat("M月d日")} ` : "";
                  const time = tab === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : `${date}${due.isValid ? due.toFormat("HH:mm") : taskScheduleTime(task)}${task.kind === "ordinary" ? " 前" : ""}`;
                  return <TaskListRow task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} warning={warning} selected={model.selected?.id === task.id} disabled={occupied || exiting}
                    rowRef={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} onPress={() => { rememberList(task.id); actions.selectTask(task.id, "toggle"); }} />;
                }} />
              </View>)}
              {tab === "pending" && backlog.pageCount > 1 ? <View style={styles.pagination}>
                <AppButton label="上一頁" accessibilityLabel="已載入事項上一頁" variant="quiet" density="compact" disabled={occupied || backlog.page === 0} onPress={() => { if (occupied) return; anchor.current = null; actions.closePanel(); setPage(backlog.page - 1); }} />
                <Text style={styles.meta}>第 {backlog.page + 1}／{backlog.pageCount} 頁</Text>
                <AppButton label="下一頁" accessibilityLabel="已載入事項下一頁" variant="quiet" density="compact" disabled={occupied || backlog.page >= backlog.pageCount - 1} onPress={() => { if (occupied) return; anchor.current = null; actions.closePanel(); setPage(backlog.page + 1); }} />
              </View> : null}
              </View>
              </AppTabPanel>
              {model.hasMoreTasks ? <View style={styles.loadMore}><Text style={styles.meta}>仍有事項未載入；月曆、搜尋及數目只包括已載入事項。</Text><AppButton label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /></View> : null}
            </View>
          </MotionDetail>
          {showAside ? <MotionDetail activeKey={showPanel ? model.draft ? `edit:${model.draft.key}` : model.selected?.id ?? "detail" : "calendar"} scopeKey={scopeKey} direction="forward" compact={!wide} style={[styles.column, wide && styles.detailColumn]}><View ref={panelRef} tabIndex={-1} testID={showPanel ? "task-detail-panel" : "task-calendar-panel"} style={styles.stack}>
            {showPanel ? <>
              {!wide ? <Text style={styles.breadcrumb}>待辦清單 / {model.draft ? "編輯安排" : "事項詳情"}</Text> : null}
              {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : null}
              {model.selected ? <View key="task-detail" style={model.draft ? styles.hidden : undefined} pointerEvents={model.draft ? "none" : "auto"} aria-hidden={!!model.draft} accessibilityElementsHidden={!!model.draft} importantForAccessibility={model.draft ? "no-hide-descendants" : "auto"}><TaskDetail model={model} actions={actions} /></View> : null}
            </> : calendar}
          </View></MotionDetail> : null}
        </View>
        <View style={styles.background}><AppSelectionTrigger label="提醒說明" expanded={backgroundOpen} onPress={() => setBackgroundOpen(value => !value)} />
          <MotionDisclosure expanded={backgroundOpen} scopeKey={scopeKey}><View style={styles.stack}>
            <Text style={styles.meta}>{model.dataLabel}</Text>
            <Text style={styles.meta}>{model.workerEnabled === true ? "背景提醒已啟用；送達情況請查看各項提醒。" : model.workerEnabled === false ? "背景提醒暫停；仍可保存安排。" : "背景提醒狀態暫未提供。"}</Text>
            <Text style={styles.meta}>站內提醒可見，不代表 Web Push／Telegram 送達、已讀或照護完成；本頁沒有發送通知。</Text>
          </View></MotionDisclosure>
        </View>
      </>}
      {previewControls}
    </View>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  pageContainer: { flex: 1, minWidth: 0, minHeight: 0 }, pageScroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  pageHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flexGrow: 1, flexShrink: 1, minWidth: 168, gap: spacing.xs },
  pageTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.title },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1.05, width: undefined }, detailColumn: { flex: 1, width: undefined },
  listSurface: { gap: spacing.md, minWidth: 0 }, tabsBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, tabs: { flex: 1, minWidth: 0 },
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
  background: { alignItems: "flex-start", borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.sm },
});
