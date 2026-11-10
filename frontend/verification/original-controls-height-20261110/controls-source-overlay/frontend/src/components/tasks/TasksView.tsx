import { CareTasksHeader } from "../../preview/tasks-care-presentation/CareTasksHeader";
import { originalTaskActionAppearance } from "../../preview/tasks-original-presentation/action-appearance";
import { getSourceRegionAppearance, taskSourceButtonAppearance } from "../../preview/tasks-module-presentation02/source-region-appearance";
import { isTaskSourceRegionProfile, type TaskModulePresentation } from "../../preview/tasks-choice-host/module-presentation";
import { HandbookTasksHeader } from "../../preview/tasks-handbook-presentation/HandbookTasksHeader";
import { handbookStyles } from "../../preview/tasks-handbook-presentation/styles";
import { originalTaskTabsAppearance } from '../../preview/tasks-original-presentation/tabs-appearance';
import { TasksFiltersPresentation, TasksFiltersSearch } from "./presentation/TasksFiltersPresentation";
import { TasksCalendarPresentation } from "./presentation/TasksCalendarPresentation";
import { taskCalendarLayout } from "./presentation/TasksCalendarLayoutPresentation";
import type { TaskFiltersPresentationProps } from "./presentation/contracts";
import type { HeaderActionsHF01SceneProps } from "../../preview/task-header-actions-hf01/TaskHeaderActionsHF01Control";
import { TasksHeaderActionsHF01 } from "./TasksHeaderActionsHF01";
import { HeaderActionsHF01FocusBoundary, type HeaderActionsHF01Controller } from "../../preview/task-header-actions-hf01/HeaderActionsHF01FocusBoundary";
import { restoreTaskReturnFocus, taskListSignature } from "../../navigation/task-return-focus";
import { parseTaskRoute, type TaskRouteState } from "../../navigation/route-state";
import { usePrivateRoutePresentation, useTaskFocusReturn } from "../../navigation/RoutePresentation";
import { BackgroundSurface, useCustomBackground } from "../appearance/BackgroundSurface";
import { useContainerWidth } from "../useContainerWidth";
import { useEffect, useLayoutEffect, useRef, useState, useId, useCallback, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { DateTime } from "luxon";
import { currentTaskMetadata, pendingTasks, recentCompletedTasks, taskCompletionLabel, taskScheduleSections, taskScheduleTime, type TasksActions, type TasksViewModel } from "../../task-view-model";
import type { WriteRecoveryActions } from "../../view-model";
import { chineseFont, colors, mobileLayout, mobileType, readingType, spacing, workspaceType } from "../../theme";
import { MotionDetail, MotionDisclosure, MotionList } from "../../motion";
import { AppIcon } from "../AppIcon";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { TaskOperationNotice } from "./TaskOperationNotice";
import { ReadStateNotice } from "../ReadStateNotice";
import { EmptyListCard } from "../EmptyListCard";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, SectionCard, UnderlineTabs, AppTabPanel, TabToolbar } from "../ui";
import { Workspace } from "../workspace/Workspace";
import { TaskListRow, type TaskRowAppearance } from "./TaskListRow";
import { TaskDetail } from "./TaskDetail";
import { FormDialog } from "../FormDialog";
import { TaskForm } from "./TaskForm";
import { taskAssigneeLabel } from "./TaskContent";
import { TasksCalendar } from "./TasksCalendar";
import { projectTaskBacklog, projectTaskCalendar, toggleTaskCalendarDay, type TaskBacklogFilter } from "./task-calendar";

const backlogLabels: Record<TaskBacklogFilter, string> = { near: "近期 7 天", earlier: "較早未處理", later: "之後", review: "待覆核", unconfirmed: "時間待核對", all: "全部日期" };

export function TasksView({ model, actions, recovery, previewControls, onAgent, onHistory, routeState, onRouteChange, requestedTaskId, taskRowAppearance, modulePresentation, headerActionsHF01, headerActionsHF01AuthorityToken, headerActionsHF01SceneProps }: { modulePresentation?: TaskModulePresentation; taskRowAppearance?: TaskRowAppearance; headerActionsHF01SceneProps?: HeaderActionsHF01SceneProps; headerActionsHF01?: HeaderActionsHF01Controller; headerActionsHF01AuthorityToken?: string; requestedTaskId?: string | null; routeState?: TaskRouteState; onRouteChange?: (next: TaskRouteState, mode?: "push" | "replace") => void; onAgent(): void; onHistory(): void; model: TasksViewModel; actions: TasksActions; recovery?: WriteRecoveryActions; previewControls?: ReactNode }) {
  const pageLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const containerLayout = useContainerWidth();
  const compact = pageLayout.width < mobileLayout.breakpoint;
  const originalFiltersControls = modulePresentation?.filters === 'original-filters-controls01';
  const originalFiltersCombined = originalFiltersControls || modulePresentation?.filters === 'original-filters-combination01';
  const originalFiltersVersion = originalFiltersControls ? 'original-filters-controls01' : modulePresentation?.filters === 'original-filters-combination01'
    ? 'original-filters-combination01' : modulePresentation?.filters === 'original-search-frame-fragment01' ? 'original-search-frame-fragment01' : undefined;
  const originalTabs = originalFiltersCombined || modulePresentation?.filters === 'original-tabs-fragment01';
  const originalSearchFrame = originalFiltersCombined || modulePresentation?.filters === 'original-search-frame-fragment01';
  const filtersVariant = originalTabs || originalSearchFrame ? null : modulePresentation?.filters;
  const calendarVariant = modulePresentation?.["calendar-layout"];
  const handbookHeader = modulePresentation?.["header-actions"] === "handbook";
  const handbookDateList = modulePresentation?.["date-list"] === "handbook";
  const headerChoice = modulePresentation?.["header-actions"], dateChoice = modulePresentation?.["date-list"];
  const headerProfile = isTaskSourceRegionProfile(headerChoice) ? headerChoice : undefined;
  const dateProfile = isTaskSourceRegionProfile(dateChoice) ? dateChoice : undefined;
  const sourcePlatform = Platform.OS === "web" ? "web" : "native";
  const sourceHeader = headerProfile ? getSourceRegionAppearance(headerProfile.variantId, compact, sourcePlatform) : undefined;
  const sourceDate = dateProfile ? getSourceRegionAppearance(dateProfile.variantId, compact, sourcePlatform) : undefined;
  const careHeader = headerProfile?.variantId === "care", wrappingHeader = handbookHeader || careHeader;
  const headerAppearance = headerChoice === "original-actions-fragment01" ? {
    create: originalTaskActionAppearance("secondary", sourcePlatform),
    assistant: originalTaskActionAppearance("primary", sourcePlatform),
    history: originalTaskActionAppearance("quiet", sourcePlatform),
    trigger: originalTaskActionAppearance("quiet", sourcePlatform),
  } : headerProfile && (headerProfile.variantId === "harbour" || headerProfile.variantId === "fourth") ? {
    create: taskSourceButtonAppearance(headerProfile.variantId, headerProfile.variantId === "harbour" ? "primary" : "secondary", "compact", sourcePlatform),
    assistant: taskSourceButtonAppearance(headerProfile.variantId, headerProfile.variantId === "harbour" ? "secondary" : "primary", "compact", sourcePlatform),
    history: taskSourceButtonAppearance(headerProfile.variantId, "quiet", "compact", sourcePlatform),
    trigger: taskSourceButtonAppearance(headerProfile.variantId, "quiet", "compact", sourcePlatform),
  } : undefined;
  const listQuiet = dateProfile ? taskSourceButtonAppearance(dateProfile.variantId, "quiet", "compact", sourcePlatform) : undefined;
  const listSecondary = dateProfile ? taskSourceButtonAppearance(dateProfile.variantId, "secondary", "compact", sourcePlatform) : undefined;
  const listLoadMore = dateProfile ? taskSourceButtonAppearance(dateProfile.variantId, "secondary", "standard", sourcePlatform) : undefined;
  // Appearance-only observation of the actual calendar root, never a viewport guess.
  const calendarRoot = useRef<View | null>(null);
  const [calendarRootWidth, setCalendarRootWidth] = useState<number | null>(null);
  const recordCalendarWidth = useCallback((width: number) => {
    setCalendarRootWidth(Number.isFinite(width) && width > 0 ? width : null);
  }, []);
  const calendarRootRef = useCallback((node: View | null) => {
    calendarRoot.current = node;
    if (!node) setCalendarRootWidth(null);
    else if (Platform.OS === "web") recordCalendarWidth((node as unknown as HTMLElement).getBoundingClientRect().width);
  }, [recordCalendarWidth]);
  const calendarRootLayout = useCallback((event: LayoutChangeEvent) => {
    if (Platform.OS === "web") {
      const node = calendarRoot.current as unknown as HTMLElement | null;
      if (node) recordCalendarWidth(node.getBoundingClientRect().width);
    } else recordCalendarWidth(event.nativeEvent.layout.width);
  }, [recordCalendarWidth]);
  const [localRoute,setLocalRoute] = useState(() => parseTaskRoute({}));
  const viewRoute = routeState ?? localRoute;
  const { tab, filter, page, day: selectedDay, month: calendarMonth } = viewRoute;
  const [privateView,setQuery,rememberScroll] = usePrivateRoutePresentation("tasks");
  const query = privateView.query;
  const taskFocus = useTaskFocusReturn();
  const listSignature = taskListSignature(viewRoute, query);
  const changeRoute = (patch: Partial<TaskRouteState>, mode: "push" | "replace" = "replace") => { const next = { ...viewRoute, ...patch }; if(onRouteChange) onRouteChange(next, mode); else setLocalRoute(next); };
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState({ scope: "", open: false });
  const tabsId = useId();
  const listReadState = model.readState ?? (model.reading ? "loading" : "ready");
  const readUnavailable = listReadState === "loading" || listReadState === "error";
  const loading = model.reading || model.loadingMoreTasks;
  const previousLoading = useRef(loading);
  useLayoutEffect(() => { previousLoading.current = loading; }, [loading]);
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
  const moduleLayout = calendarVariant ? taskCalendarLayout({ variant: calendarVariant, width: containerLayout.width,
    tab, showPanel, readUnavailable, noPendingTasks }) : null;
  const wide = moduleLayout?.wide ?? containerLayout.width >= 840;
  const showAside = moduleLayout?.showAside ?? (showPanel || (wide && tab === "pending" && !readUnavailable));
  const listVisible = moduleLayout?.listVisible ?? (wide || !showPanel);
  const calendarPlacement = moduleLayout?.calendarPlacement ?? (tab === "pending" && !readUnavailable
    ? !wide && !noPendingTasks ? "inline" : wide && !showPanel ? "aside" : "none" : "none");
  const sourceSurface = !!moduleLayout && calendarVariant !== "harbour";
  const scrollRef = useRef<NativeScrollView>(null);
  const scrollPosition = useRef(privateView.scroll);
  useLayoutEffect(() => { scrollRef.current?.scrollTo({y:privateView.scroll,animated:false}); }, []);
  const rowRefs = useRef(new Map<string, View>());
  const listRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  // A background read may disable action buttons immediately after close; return to stable page context.
  const pageHeading = containerLayout.hostRef;
  const anchor = useRef<{ id: string | null; position: number; scope: string } | null>(null);
  const previousPanel = useRef(showPanel);
  const restoreFrame = useRef<number | null>(null);
  const returnState = useRef({ showPanel, wide, scopeKey });
  returnState.current = { showPanel, wide, scopeKey };
  useEffect(() => { anchor.current = null; taskFocus.invalidateScope(scopeKey); setActionMenu({ scope: scopeKey, open: false }); }, [scopeKey, taskFocus]);
  useEffect(() => { setCalendarOpen(false); if (!routeState) { setLocalRoute(parseTaskRoute({})); setQuery(""); } }, [scopeKey, model.scheduleContext.timeZone]);
  useEffect(() => { if (page !== backlog.page && !readUnavailable) changeRoute({page:backlog.page}); }, [page, backlog.page]);
  useLayoutEffect(() => () => { if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current); }, []);
  useLayoutEffect(() => {
    const entering = !previousPanel.current && showPanel;
    const returning = previousPanel.current && !showPanel;
    previousPanel.current = showPanel;
    if ((entering || model.access === "lost") && restoreFrame.current !== null) {
      cancelAnimationFrame(restoreFrame.current); restoreFrame.current = null;
    }
    if (model.access === "lost") { taskFocus.clear(); return; }
    if (routeState && model.selected) taskFocus.displayed(scopeKey, model.selected.id, listSignature);
    if (!wide && entering) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === "web") (panelRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    }
    const saved = routeState
      ? (!showPanel && !requestedTaskId ? taskFocus.take(scopeKey, listSignature) : null)
      : returning ? anchor.current : null;
    if (saved?.scope === scopeKey) {
      if (Platform.OS === "web") {
        const candidates = [saved.id ? rowRefs.current.get(saved.id) : null, listRef.current] as unknown as (HTMLElement | null | undefined)[];
        if (routeState) restoreTaskReturnFocus(candidates, document);
        else for (const target of candidates) {
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
  }, [showPanel, model.selected?.id, model.draft?.key, model.access, scopeKey, wide, requestedTaskId, listSignature, routeState, taskFocus]);
  function rememberList(id: string | null) {
    anchor.current = { id, position: scrollPosition.current, scope: scopeKey };
    if (routeState) taskFocus.remember(scopeKey, id, listSignature, scrollPosition.current);
  }
  function clearListAnchor() { anchor.current = null; taskFocus.clear(); }
  function changeFilter(next: TaskBacklogFilter) {
    if (occupied) return;
    clearListAnchor(); changeRoute({filter:next,day:null,page:0,taskId:null});
  }
  function selectCalendarDay(day: string | null) {
    if (occupied) return;
    clearListAnchor(); changeRoute({day:toggleTaskCalendarDay(selectedDay,day),page:0,taskId:null});
  }
  const calendar = calendarVariant ? <TasksCalendarPresentation variant={calendarVariant}
    calendar={projectTaskCalendar(pending, model.scheduleContext, calendarMonth)} context={model.scheduleContext}
    selectedDay={selectedDay} width={calendarRootWidth ?? 0} rootRef={calendarRootRef} onLayout={calendarRootLayout}
    disabled={occupied || (calendarVariant === "care" && calendarRootWidth === null)}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) changeRoute({month}); }} />
    : <TasksCalendar items={pending} context={model.scheduleContext} selectedDay={selectedDay} month={calendarMonth} disabled={occupied}
    onSelectDay={selectCalendarDay} onChangeMonth={month => { if (!occupied) changeRoute({month}); }} />;
  // These are the original host callback bodies, not a variant-specific owner.
  const filterHost: Omit<TaskFiltersPresentationProps, "variant" | "region"> = {
    tabsId, tab, occupied, readUnavailable, noPendingTasks, openCount,
    completedCount: completed.length, hasMoreTasks: model.hasMoreTasks, query, filter, selectedDay, calendarOpen, backlog,
    calendarTriggerVisible: moduleLayout?.calendarTriggerVisible ?? !wide,
    onChangeTab: next => { if (occupied) return; setQuery(""); changeRoute({tab:next,filter:"near",page:0,day:null,taskId:null}, "push"); clearListAnchor(); },
    onChangeQuery: value => { if (occupied) return; clearListAnchor(); setQuery(value); if(page!==0)changeRoute({page:0,taskId:null}); },
    onClearQuery: () => { if (!occupied) { clearListAnchor(); setQuery(""); changeRoute({page:0,taskId:null}); } },
    onChangeFilter: changeFilter,
    onReview: () => { if (occupied) return; setQuery(""); changeRoute({tab:"pending",filter:tab === "pending" && filter === "review" ? "near" : "review",page:0,day:null,taskId:null}, tab === "pending" ? "replace" : "push"); },
    onClearDay: () => selectCalendarDay(null),
    onToggleCalendar: () => { if (!occupied) setCalendarOpen(open => !open); },
    onClearFilters: () => { if (occupied) return; clearListAnchor(); setQuery(""); changeRoute({day:null,filter:"all",page:0,taskId:null}); },
  };
  const filterPresentation = filtersVariant ? { ...filterHost, variant: filtersVariant } : null;
  const readState = listReadState === "loading" ? "loading" : listReadState === "error" ? "error" : listReadState === "stale" || !model.online ? "stale" : visible.length ? "ready" : "empty";
  const readMessage = listReadState === "loading" ? "正在讀取事項…" : listReadState === "error" ? "未能讀取事項，請重試。" : !model.online ? "目前離線，已載入內容只供參考；恢復連線後才可提交。" : listReadState === "stale" ? "未能更新，現正顯示上次讀取的事項。" : visible.length ? "" : tab === "pending" ? noPendingTasks ? "暫無待辦" : openCount === 0 && model.hasMoreTasks ? "已載入的事項中暫無待辦" : "沒有符合篩選的事項" : model.hasMoreTasks ? "已載入的事項中暫無已完成的事項" : "暫無已完成的事項";
  const createAction = model.access === "editable" ? <AppButton label="新增事項" accessibilityLabel="新增共享事項" density="compact" disabled={occupied}
    onPress={() => { setActionMenu({ scope: scopeKey, open: false }); rememberList(null); actions.startCreate(); }} /> : null;
  const pageActions = <>
    {!compact ? createAction : null}
    {model.access === "editable" ? <AppButton label="請助手安排" variant="secondary" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onAgent(); }} /> : null}
    <AppButton label="歷史" accessibilityLabel="事項歷史" variant="quiet" density="compact" disabled={occupied} onPress={() => { setActionMenu({ scope: scopeKey, open: false }); onHistory(); }} />
  </>;
  return <View {...headerActionsHF01SceneProps} ref={pageLayout.ref} onLayout={pageLayout.onLayout} style={styles.pageContainer}><ScrollView ref={scrollRef} testID="tasks-page-scroll" style={[styles.pageScroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => { if (listVisible) { scrollPosition.current = event.nativeEvent.contentOffset.y; rememberScroll(scrollPosition.current); } }}>
    <BackgroundSurface padded frosted testID="tasks-reading-panel" ref={containerLayout.ref} role="region" accessibilityLabel="待辦" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})} onLayout={containerLayout.onLayout} style={styles.stack}>
      <HeaderActionsHF01FocusBoundary controller={headerActionsHF01} actualAuthorityToken={headerActionsHF01AuthorityToken}
                access={model.access} occupied={occupied} compact={wrappingHeader ? false : compact} pageContextRef={pageHeading}
                onActivate={action => {
                  if (action === "create") { rememberList(null); actions.startCreate(); }
                  else if (action === "assistant") onAgent();
                  else if (action === "history") onHistory();
                }}>{hf01 => <>
      {careHeader ? <View ref={hf01?.toolbar.refs.toolbarRegion}>
        <CareTasksHeader compact={compact} access={hf01?.toolbar.access ?? "lost"} showPanel={showPanel}
          disabled={!hf01 || hf01.toolbar.occupied || hf01.toolbar.selectionMode}
          renderAction={(action, appearance) => {
            const id=action.id;
            if (id !== "create" && id !== "assistant" && id !== "history") return null;
            return <AppButton ref={hf01?.toolbar.refs[id]} label={action.label} accessibilityLabel={action.accessibilityLabel}
              density={action.density} disabled={action.disabled} appearance={{...appearance,focusStyle:taskSourceButtonAppearance("care",action.variant,action.density,sourcePlatform).focusStyle}} onPress={() => hf01?.toolbar.onActivate(id)} />;
          }} />
      </View> : sourceHeader?.header ? <View testID="workspace-heading" style={sourceHeader.header.styles.root}>
        <View style={sourceHeader.header.styles.copy}>
          <Text accessibilityRole="header" {...(sourceHeader.header.titleLevelPlatform === "all" || Platform.OS === "web" ? {"aria-level":1} : {})} style={sourceHeader.header.styles.title}>{sourceHeader.header.title}</Text>
          {sourceHeader.header.description ? <Text style={sourceHeader.header.styles.description}>{sourceHeader.header.description}</Text> : null}
        </View>
      </View> : handbookHeader ? <View ref={hf01?.toolbar.refs.toolbarRegion}>
        <HandbookTasksHeader compact={containerLayout.width < 650} access={hf01?.toolbar.access ?? "lost"}
          disabled={!hf01 || hf01.toolbar.occupied || hf01.toolbar.selectionMode}
          renderAction={(action, appearance) => <AppButton ref={hf01?.toolbar.refs[action.id]}
            label={action.label} accessibilityLabel={action.accessibilityLabel} disabled={action.disabled}
            appearance={appearance} onPress={() => hf01?.toolbar.onActivate(action.id)} />} />
      </View> : <Workspace.Provider title="待辦與預約" compact={compact}><Workspace.Header><Workspace.Heading description="看清近期安排，接續待處理的事情。" /></Workspace.Header></Workspace.Provider>}
      <StatusAnnouncement key={model.child.id} eventKey={model.access} urgent={model.access === "lost"} message={model.access === "lost" ? "孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除。" : model.access === "read_only" ? "目前為唯讀：可以查看共享事項及歷史，不能新增或更改。" : model.access === "editable" ? "已恢復共享事項的編輯權限。" : ""} />
      {model.access === "read_only" ? <BackgroundSurface padded><Text style={styles.notice}>目前為唯讀：可以查看共享事項及歷史，不能新增或更改。</Text></BackgroundSurface> : null}
      {model.access === "lost" ? <SectionCard><Text style={styles.notice}>孩子權限已失效。任務、提醒、歷史、草稿及待查核原操作已清除；重新取得權限後才可讀取。</Text></SectionCard> : <>
        {requestedTaskId && model.selected?.id !== requestedTaskId ? <View testID="task-target-notice"><Text style={styles.meta}>{model.detailRead?.id === requestedTaskId && model.detailRead.state === "loading" ? "正在讀取所選事項…" : "目前不能查看這項事項；可能未載入、已刪除或不能存取。"}</Text><AppButton label="返回事項清單" variant="quiet" onPress={actions.closePanel} /></View> : null}
        <TaskOperationNotice model={model} recovery={recovery} online={model.online && !model.reading} />
        <View testID="tasks-workspace" style={moduleLayout?.workspaceStyle ?? [styles.workspace, wide && showAside && styles.workspaceWide]}>
          <MotionDetail activeKey={showPanel ? "panel" : "list"} scopeKey={scopeKey} direction="back" compact={!wide && !showPanel} style={moduleLayout?.listColumnStyle ?? [styles.column, wide && showAside && styles.listColumn, !listVisible && styles.hidden]}>
            <BackgroundSurface padded ref={listRef} tabIndex={-1} testID="tasks-list" enabled={sourceSurface ? false : undefined} style={moduleLayout?.listSurfaceStyle ?? styles.listSurface} pointerEvents={listVisible ? "auto" : "none"} aria-hidden={!listVisible} accessibilityElementsHidden={!listVisible} importantForAccessibility={listVisible ? "auto" : "no-hide-descendants"}>

              <TabToolbar testID="tasks-tab-toolbar" stacked={compact && containerLayout.width < 360} actions={wrappingHeader ? undefined : hf01 ? <TasksHeaderActionsHF01 region="toolbar" {...hf01.toolbar} appearance={headerAppearance} /> : compact ? <View style={styles.headerActions}>{createAction}<AppButton label="其他" accessibilityLabel="其他待辦操作" variant="quiet" density="compact" expanded={actionMenuOpen} disabled={occupied} onPress={() => setActionMenu({ scope: scopeKey, open: !actionMenuOpen })} /></View> : pageActions}>{filterPresentation ? <TasksFiltersPresentation {...filterPresentation} region="tabs" /> : <UnderlineTabs appearance={originalTabs ? originalTaskTabsAppearance(Platform.OS === "web" ? "web" : "native") : undefined} id={tabsId} label="事項分類" items={[{ key: "pending", label: "待處理", count: readUnavailable ? undefined : `${openCount}${model.hasMoreTasks ? "+" : ""}` }, { key: "completed", label: "已完成" }]} value={tab} onChange={next => { if (occupied) return; setQuery(""); changeRoute({tab:next,filter:"near",page:0,day:null,taskId:null}, "push"); clearListAnchor(); }} />}</TabToolbar>
              {wrappingHeader ? null : hf01 ? <TasksHeaderActionsHF01 region="disclosure" {...hf01.disclosure} appearance={headerAppearance} /> : compact ? <MotionDisclosure expanded={actionMenuOpen} scopeKey={scopeKey}><View testID="tasks-page-actions" style={styles.headerActions}>{pageActions}</View></MotionDisclosure> : null}
              {filterPresentation ? <TasksFiltersPresentation {...filterPresentation} region="review" /> : !readUnavailable && reviewCount > 0 ? <Pressable testID="tasks-review-shortcut" accessibilityRole="button" accessibilityLabel={`查看已載入的 ${reviewCount} 項待覆核安排，已停止催辦`} disabled={occupied} accessibilityState={{ disabled: occupied }} aria-disabled={occupied} onPress={() => { if (occupied) return; setQuery(""); changeRoute({tab:"pending",filter:tab === "pending" && filter === "review" ? "near" : "review",page:0,day:null,taskId:null}, tab === "pending" ? "replace" : "push"); }} style={({ pressed }) => [styles.reviewShortcut, pressed && !occupied && styles.reviewPressed]}><View style={styles.reviewCopy}><Text style={styles.reviewTitle}>{reviewCount} 項待覆核{model.hasMoreTasks ? "（已載入）" : ""}</Text><Text style={styles.reviewNote}>{filter === "review" && tab === "pending" ? "返回近期安排" : "完成或取消仍未確定 · 已停催"}</Text></View><AppIcon name={filter === "review" && tab === "pending" ? "chevron-left" : "chevron-right"} size={18} color={colors.warningInk} /></Pressable> : null}
              {filterPresentation ? <TasksFiltersPresentation {...filterPresentation} region="completed-note" /> : tab === "completed" && !readUnavailable && completed.length > 0 ? <Text style={styles.meta}>{model.hasMoreTasks ? "目前只按已載入資料顯示最近 10 項，載入更多後會重新排序。" : "只顯示最近 10 項；較早及已取消的安排可到事項歷史查看。"}</Text> : null}
              <AppTabPanel tabsId={tabsId} tabKey={tab} active>
              <TasksFiltersSearch {...filterHost} variant={filtersVariant ?? undefined} originalFiltersVersion={originalFiltersVersion} />
              {calendarPlacement === "inline" ? <MotionDisclosure expanded={calendarOpen} scopeKey={scopeKey}><View style={styles.mobileCalendar}>{calendar}</View></MotionDisclosure> : null}
              <View style={sourceDate?.list.scheduleList ?? (handbookDateList ? handbookStyles.scheduleList : styles.scheduleList)}>
              {filterPresentation ? <TasksFiltersPresentation {...filterPresentation} region="context" /> : tab === "pending" && !readUnavailable && !noPendingTasks ? <View style={styles.listContext}>
                <Text style={styles.meta} accessibilityLiveRegion="polite">{selectedDay ? `${DateTime.fromISO(selectedDay).toFormat("M月d日")}` : backlogLabels[filter]}{!selectedDay && filter === "near" && backlog.nearLabel ? ` · ${backlog.nearLabel}` : ""}{query.trim() ? " · 搜尋結果" : ""} · 已載入 {backlog.total} 項{backlog.total > 0 ? `，顯示 ${backlog.from}–${backlog.to}` : ""}</Text>
                {backlog.counts.earlier > 0 && filter !== "earlier" ? <Pressable accessibilityRole="button" accessibilityLabel={`查看已載入的 ${backlog.counts.earlier} 項較早未處理事項`} disabled={occupied} aria-disabled={occupied} onPress={() => changeFilter("earlier")} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>較早未處理 {backlog.counts.earlier}</Text></Pressable> : null}
                {selectedDay ? <Pressable accessibilityRole="button" accessibilityLabel="只取消日期篩選" disabled={occupied} aria-disabled={occupied} onPress={() => selectCalendarDay(null)} style={({ pressed }) => [styles.contextLink, pressed && !occupied && styles.pressed]}><Text style={styles.contextLinkText}>取消日期</Text></Pressable> : null}
              </View> : null}
              {readState === "empty" ? <><StatusAnnouncement eventKey={`${tab}:${readMessage}`} message={readMessage} />
              <EmptyListCard testID="tasks-empty-card" title={readMessage} icon="clipboard-check-outline" appearance={sourceDate?.empty} style={sourceDate?.list.emptyCard ?? styles.emptyCard}>
                {filterPresentation ? <TasksFiltersPresentation {...filterPresentation} region="clear" /> : tab === "pending" && !noPendingTasks && openCount > 0 ? <AppButton label="清除篩選" appearance={listQuiet} variant="quiet" density="compact" disabled={occupied} onPress={() => { if (occupied) return; clearListAnchor(); setQuery(""); changeRoute({day:null,filter:"all",page:0,taskId:null}); }} /> : null}
              </EmptyListCard></> : <ReadStateNotice state={readState} message={readMessage} appearance={sourceDate?.read}>
                {(readState === "error" || readState === "stale") && recovery?.reloadCurrent ? <AppButton label="重新讀取事項" appearance={listSecondary} variant="secondary" density="compact" disabled={!model.online || model.reading || locked || !!model.draft} onPress={recovery.reloadCurrent} /> : null}
              </ReadStateNotice>}
              {!readUnavailable && sections.filter(section => section.items.length > 0).map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={sourceDate?.list.timeGroup ?? (handbookDateList ? handbookStyles.timeGroup : styles.timeGroup)}>
                <View style={sourceDate?.list.groupHeading ?? (handbookDateList ? handbookStyles.groupHeading : styles.groupHeading)}><Text accessibilityRole="header" aria-level={2} style={sourceDate?.list.groupTitle ?? (handbookDateList ? handbookStyles.groupTitle : styles.groupTitle)}>{section.label}</Text><Text style={sourceDate?.list.meta ?? (handbookDateList ? handbookStyles.meta : styles.meta)}>{section.items.length} 項</Text></View>
                <MotionList items={section.items} keyExtractor={task => task.id} scopeKey={`${scopeKey}:${tab}`} regionKey={`tasks:${section.id}`} eligible={model.operation.state === "saved" && !loading && !previousLoading.current && listVisible} renderItem={(task, { exiting }) => {
                  const work = currentTaskMetadata(task, model.eligibleAssignees, model.work, model.reminders).work;
                  const assigneeMissing = task.occurrence.state === "scheduled" && !model.eligibleAssignees.some(person => person.userId === task.assigneeUserId);
                  const warning = assigneeMissing ? "請重新核對負責人" : work?.status === "unknown" ? "提醒處理結果待核對" : work?.status === "failed" ? "提醒處理未成功，請查看詳情" : null;
                  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(model.scheduleContext.timeZone);
                  const date = section.id === "today" || (tab === "pending" && selectedDay) ? "" : due.isValid ? `${due.toFormat("M月d日")} ` : "";
                  const time = tab === "completed" ? taskCompletionLabel(task, model.scheduleContext.timeZone) : `${date}${due.isValid ? due.toFormat("HH:mm") : taskScheduleTime(task)}${task.kind === "ordinary" ? " 前" : ""}`;
                  return <TaskListRow sourceAppearance={dateProfile?.variantId} taskRowAppearance={handbookDateList ? "handbook" : taskRowAppearance} history={false} task={task} time={time} assignee={taskAssigneeLabel(task.assigneeUserId, model.eligibleAssignees)} warning={warning} selected={model.selected?.id === task.id} disabled={occupied || exiting}
                    rowRef={node => { if (node) rowRefs.current.set(task.id, node); else rowRefs.current.delete(task.id); }} onPress={() => { rememberList(task.id); actions.selectTask(task.id, "toggle"); }} />;
                }} />
              </View>)}
              {tab === "pending" && backlog.pageCount > 1 ? <View style={sourceDate?.list.pagination ?? styles.pagination}>
                <AppButton appearance={listQuiet} label="上一頁" accessibilityLabel="已載入事項上一頁" variant="quiet" density="compact" disabled={occupied || backlog.page === 0} onPress={() => { if (occupied) return; clearListAnchor(); changeRoute({page:backlog.page - 1,taskId:null}); }} />
                <Text style={sourceDate?.list.meta ?? styles.meta}>第 {backlog.page + 1}／{backlog.pageCount} 頁</Text>
                <AppButton appearance={listQuiet} label="下一頁" accessibilityLabel="已載入事項下一頁" variant="quiet" density="compact" disabled={occupied || backlog.page >= backlog.pageCount - 1} onPress={() => { if (occupied) return; clearListAnchor(); changeRoute({page:backlog.page + 1,taskId:null}); }} />
              </View> : null}
              </View>
              </AppTabPanel>
              {model.hasMoreTasks ? <View style={sourceDate?.list.loadMore ?? styles.loadMore}><Text style={sourceDate?.list.meta ?? styles.meta}>仍有事項未載入；月曆、搜尋及數目只包括已載入事項。</Text><AppButton appearance={listLoadMore} label={model.loadingMoreTasks ? "正在載入更多事項…" : "載入更多事項"} variant="secondary" disabled={model.loadingMoreTasks || !model.online || occupied} onPress={actions.loadMoreTasks} /></View> : null}
            </BackgroundSurface>
          </MotionDetail>
          {showAside ? <MotionDetail activeKey={showPanel ? model.selected?.id ?? "detail" : "calendar"} scopeKey={scopeKey} direction="forward" compact={!wide} style={showPanel ? [styles.column, wide && styles.detailColumn] : moduleLayout?.asideColumnStyle ?? [styles.column, wide && styles.detailColumn]}><BackgroundSurface padded ref={panelRef} tabIndex={-1} testID={showPanel ? "task-detail-panel" : "task-calendar-panel"} enabled={!showPanel && sourceSurface ? false : undefined} style={showPanel ? styles.stack : moduleLayout?.calendarSurfaceStyle ?? styles.stack}>
            {showPanel ? <>
              {!wide ? <Text style={styles.breadcrumb}>待辦清單 / {model.draft ? "編輯安排" : "事項詳情"}</Text> : null}

              {model.selected ? <View key="task-detail" ><TaskDetail model={model} actions={actions} /></View> : null}
            </> : calendar}
          </BackgroundSurface></MotionDetail> : null}
        </View>
      </>}
      <FormDialog formKey={model.draft?.key} visible={!!model.draft} scopeKey={scopeKey} title="安排事項" returnFocusRef={pageHeading} onClose={actions.closePanel}
        recovery={<TaskOperationNotice model={model} recovery={recovery} online={model.online} />}>
        {model.draft ? <TaskForm key={model.draft.key} model={model} actions={actions} /> : null}
      </FormDialog>
      {previewControls}
      </>}</HeaderActionsHF01FocusBoundary>
    </BackgroundSurface>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  transparent: { backgroundColor: "transparent" },
  pageContainer: { flex: 1, minWidth: 0, minHeight: 0 }, pageScroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: 32, paddingVertical: 32, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  hidden: { display: "none" }, stack: { gap: spacing.lg, minWidth: 0 },
  workspace: { gap: spacing.lg, minWidth: 0 }, workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { minWidth: 0, width: "100%" }, listColumn: { flex: 1.05, width: undefined }, detailColumn: { flex: 1, width: undefined },
  listSurface: { gap: spacing.md, minWidth: 0, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, borderRadius: 14, padding: spacing.lg },
  emptyCard: { minHeight: 176, padding: spacing.xl, justifyContent: "center" },
  scheduleList: { minWidth: 0, gap: spacing.sm }, mobileCalendar: { marginBottom: spacing.md },
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
