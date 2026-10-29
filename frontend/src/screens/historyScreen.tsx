import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppDateField } from "../components/DateTimeFields";
import { FormDialog } from "../components/FormDialog";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppSelect, AppTabPanel, AppTextField } from "../components/ui";
import { useContainerWidth } from "../components/useContainerWidth";
import { TaskHistoryView } from "../components/tasks/TaskHistoryView";
import { CareReviewHistoryView } from "../components/care/CareReviewHistoryView";
import { CareSavedRecordsView } from "../components/care/CareSavedRecordsView";
import { PreparationHistoryView } from "../components/preparations/PreparationWorkspace";
import { ProfileHistoryView } from "../components/profile/ProfileHistoryView";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { GrowthHistoryView } from "../components/growth/GrowthHistoryView";
import { historyCategories, historyDateErrors, historyDateRange, type HistoryCategory } from "../components/history/history-filters";
import { useProduction } from "../production/ProductionProvider";
import { usePersonalHistoryWorkspace } from "../production/usePersonalHistory";
import { PersonalConversationHistoryView, PersonalNotificationHistoryView } from "../components/history/PersonalHistoryViews";
import { useHistoryConversationRoute, type ConversationHistoryNavigation } from "../navigation/useHistoryConversationRoute";
import { useHistoryNotificationRoute, type NotificationHistoryNavigation } from "../navigation/useHistoryNotificationRoute";
import { useHistoryPreparationRoute, type HistoryPreparationNavigation } from "../navigation/useHistoryPreparationRoute";
import { useHistoryCareRoute, type HistoryCareNavigation } from "../navigation/useHistoryCareRoute";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useHistoryTaskRoute, type HistoryTaskNavigation } from "../navigation/useHistoryTaskRoute";
import { useHistoryProfileRoute, type ProfileHistoryNavigation } from "../navigation/useHistoryProfileRoute";
import { parseHistoryRoute } from "../navigation/route-state";
import { useHistoryRouteFilters, type HistoryReader } from "../navigation/useHistoryRouteFilters";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { HistoryCategoryIndex } from "../components/history/HistoryCategoryIndex";

function HistoryWorkspace({ scope, profileNavigation, taskNavigation, careNavigation, preparationNavigation, notificationNavigation, conversationNavigation }: { conversationNavigation: ConversationHistoryNavigation; notificationNavigation: NotificationHistoryNavigation; scope: string; profileNavigation: ProfileHistoryNavigation; taskNavigation: HistoryTaskNavigation; careNavigation: HistoryCareNavigation; preparationNavigation: HistoryPreparationNavigation }) {
  const route = parseHistoryRoute(useLocalSearchParams());
  const { actions: homeActions } = useProduction();
  const tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const care = useCareWorkspace();
  const growth = useGrowthWorkspace();
  const personal = usePersonalHistoryWorkspace();
  const profile = useProfileWorkspace();
  const [dateDraft, setDateDraft] = useState<{ scope: string; category: HistoryCategory; from: string; to: string } | null>(null);
  const dateTrigger = useRef<View>(null);
  const layout = useContainerWidth(), compact = layout.width < 900;
  const scrollRef = useRef<ScrollView>(null), scrollPosition = useRef(0);
  const current = historyCategories.find(item => item.key === route.category)!;
  const dateErrors = dateDraft ? historyDateErrors(dateDraft.from, dateDraft.to) : {};
  const conversationCategory = route.category === "conversations", notificationCategory = route.category === "notifications";
  const personalCategory = conversationCategory || notificationCategory;
  const taskCategory = route.category === "tasks";
  const preparationCategory = route.category === "preparations";
  const growthCategory = route.category === "growth";
  const profileCategory = route.category === "profile";
  const reviewCategory = route.category === "review", careCategory = route.category === "care";
  const taskLocked = !!tasks && (tasks.model.reading || tasks.model.access === "lost" || ["saving", "unknown", "conflict"].includes(tasks.model.operation.state) || !!tasks.model.draft);
  const preparationLocked = !preparations || ["loading", "unavailable", "lost"].includes(preparations.model.condition)
    || !!preparations.model.busy || !!preparations.model.dirty || !!preparations.model.checkSave || !!preparations.model.createDraft
    || ["saving", "unknown", "conflict"].includes(preparations.model.operation?.state ?? "none");
  const careLocked = !care || care.model.access === "lost" || ["loading", "loading_more"].includes(care.model.list.state)
    || ["saving", "unknown", "conflict"].includes(care.model.operation.state) || !!care.model.draft || !!care.model.deletion
    || reviewCategory && care.model.review?.state !== "ready";
  const growthLocked = !growth || growth.model.access === "lost" || growth.model.busy || !!growth.model.pending || growth.model.dirty || growth.model.page?.concerns?.state !== "ready";
  const currentLocked = taskCategory ? taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory || careCategory ? careLocked : false;
  // Preparation close only releases read selection; its checks, draft and operation stay owned.
  // Task/Care close can discard mutable work, unlike their clean readonly readers.
  const reader: HistoryReader | null = taskCategory && tasks ? { snapshot: tasks.model, occupied: !!(tasks.model.selected || tasks.model.draft), guardedClose: !!tasks.model.draft || ["saving", "unknown", "conflict"].includes(tasks.model.operation.state), close: taskNavigation.closeForNavigation }
    : preparationCategory && preparations ? { snapshot: preparations.model, occupied: !!preparations.model.selected, guardedClose: false, close: preparationNavigation.closeForNavigation }
    : (reviewCategory || careCategory) && care ? { snapshot: care.model, occupied: !!(care.model.detail || care.model.draft || care.model.deletion), guardedClose: !!(care.model.draft || care.model.deletion) || ["saving", "unknown", "conflict"].includes(care.model.operation.state), close: careCategory ? careNavigation.closeForNavigation : care.actions.closePanel } : conversationCategory && personal ? { snapshot: personal.message, occupied: conversationNavigation.ownsRead, guardedClose: false, close: conversationNavigation.closeForNavigation } : null;
  const { filters, filter, category, categoryHref, openResource } = useHistoryRouteFilters(scope, reader, currentLocked);
  const dateRange = historyDateRange(filters.from, filters.to);
  const filterDisabled = taskCategory ? !tasks || taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory ? careLocked : personalCategory ? !personal : true;
  const showSearch = !careCategory && !profileCategory;
  const supportsDates = taskCategory || preparationCategory || growthCategory || personalCategory;
  const hasDates = supportsDates && !!(filters.from || filters.to);
  const hasFilters = !!filters.searchText || hasDates;
  const dateDialogVisible = !!dateDraft && dateDraft.scope === scope && dateDraft.category === route.category && showSearch && supportsDates;
  useEffect(() => { setDateDraft(null); }, [scope, route.category]);

  const results = taskCategory ? dateRange ? <TaskHistoryView navigation={taskNavigation} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
    : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : preparationCategory ? dateRange ? <PreparationHistoryView navigation={preparationNavigation} onPrepareQuestion={homeActions.prepareQuestion} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : reviewCategory ? care ? <CareReviewHistoryView key={care.scopeKey} model={care.model} actions={care.actions} searchText={filters.searchText} initialStatus={route.status} olderOnly={route.older} />
      : <Text style={styles.meta}>正在讀取核對記錄…</Text>
    : careCategory ? care ? <CareSavedRecordsView key={care.scopeKey} model={care.model} actions={care.actions} navigation={careNavigation} />
      : <Text style={styles.meta}>正在讀取已保存記錄…</Text>
    : profileCategory ? profile ? <ProfileHistoryView key={profile.scopeKey} scopeKey={profile.scopeKey} model={profile.model} actions={profile.actions} navigation={profileNavigation} />
      : <Text style={styles.meta}>正在讀取孩子檔案…</Text>
    : growthCategory ? dateRange ? <GrowthHistoryView key={growth?.scopeKey ?? scope} searchText={filters.searchText} dateRange={dateRange}
      onRecord={id => openResource(id ? `/care?record=${encodeURIComponent(id)}` : "/care")} onTask={id => openResource({ pathname: "/tasks", params: { taskId: id } })} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : personalCategory ? dateRange ? conversationCategory ? <PersonalConversationHistoryView navigation={conversationNavigation} searchText={filters.searchText} dateRange={dateRange} onPrepareQuestion={homeActions.prepareQuestion} />
      : <PersonalNotificationHistoryView navigation={notificationNavigation} searchText={filters.searchText} dateRange={dateRange} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : <View testID={`history-unavailable-${route.category}`}  style={styles.unavailable}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{current.label}暫未可在這裏查閱</Text>
      <Text style={styles.body}>{current.unavailable}</Text>
    </View>;

  const resultSurface = <View style={styles.results}>{results}</View>;
  return <PageFrame density="compact" title="歷史檔案" description="找回已完成的安排、保存的記錄，以及當時的版本。" scrollRef={scrollRef} scrollTestID="history-scroll"
    onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.workspace, !compact && styles.columns]}>
      <View style={compact ? styles.mobileIndex : styles.index}>
        {compact ? <AppSelect<HistoryCategory> label="歷史分類" value={route.category} options={historyCategories.map(item => ({ value: item.key, label: item.label }))} onChange={() => {}} onSelectionClosed={category} />
          : <HistoryCategoryIndex value={route.category} href={categoryHref} onChange={category} />}
      </View>
      <View style={[styles.resultWorkspace, !compact && styles.resultMain]}>
      <View testID="history-current-category" style={styles.resultHeading}><Text accessibilityRole="header" aria-level={2} style={styles.categoryTitle}>{current.label}</Text><Text style={styles.body}>{current.description}</Text></View>
      {showSearch ? <View testID="history-filter-toolbar" style={styles.toolbar}>
        <View style={styles.controlRow}>
          {showSearch ? <View style={styles.searchField}><AppTextField label={`搜尋${current.label}`} accessibilityLabel={`搜尋${current.label}`} value={filters.searchText} maxLength={200} disabled={filterDisabled} onChangeText={value => filter({ type: "search", value })} /></View> : null}
          {supportsDates || hasFilters ? <View style={styles.toolbarActions}>
            {showSearch && supportsDates ? <AppButton ref={dateTrigger} label={hasDates ? "日期已篩選" : "日期篩選"} variant="secondary" density="compact" disabled={filterDisabled}
              onPress={() => { if (!filterDisabled) setDateDraft({ scope, category: route.category, from: filters.from, to: filters.to }); }} /> : null}
            {showSearch && hasFilters ? <AppButton label={reviewCategory ? "清除搜尋" : "清除篩選"} variant="quiet" density="compact" disabled={currentLocked}
              onPress={() => filter(reviewCategory ? { type: "search", value: "" } : { type: "reset" })} /> : null}
          </View> : null}
        </View>
        {showSearch && hasDates ? <Text testID="history-applied-dates" style={styles.meta}>日期：{filters.from && filters.to ? `${filters.from} 至 ${filters.to}` : filters.from ? `${filters.from} 起` : `截至 ${filters.to}`}</Text> : null}
        {notificationCategory ? <Text style={styles.meta}>本人消息，涵蓋帳戶及其他孩子</Text> : null}
        {reviewCategory ? <Text style={styles.meta}>按內容及處理狀態搜尋；暫不支援日期篩選。</Text> : null}
      </View> : null}
      {/* Keep the reader mounted while navigation changes between the category index and select. */}
      <AppTabPanel tabsId="history-categories" tabKey={route.category} active hasTabList={false} style={styles.results}>{resultSurface}</AppTabPanel>
      </View>
      <FormDialog visible={dateDialogVisible} dismissMode="local" scopeKey={scope} formKey={route.category} title="日期篩選" returnFocusRef={dateTrigger} onClose={() => setDateDraft(null)}>
        {dateDialogVisible && dateDraft ? <>
          <AppDateField label="開始日期（可不填）" value={dateDraft.from} error={dateErrors.from} disabled={filterDisabled} onChange={from => setDateDraft({ ...dateDraft, from })} />
          <AppDateField label="結束日期（可不填）" value={dateDraft.to} error={dateErrors.to} disabled={filterDisabled} onChange={to => setDateDraft({ ...dateDraft, to })} />
          <View style={styles.toolbarActions}>
            <AppButton label="套用日期" disabled={filterDisabled || !!dateErrors.from || !!dateErrors.to} onPress={() => {
              if (filterDisabled || !historyDateRange(dateDraft.from, dateDraft.to)) return;
              filter({ type: "dates", from: dateDraft.from, to: dateDraft.to });
              setDateDraft(null);
            }} />
            <AppButton label="清空日期" variant="quiet" disabled={filterDisabled || !dateDraft.from && !dateDraft.to} onPress={() => setDateDraft({ ...dateDraft, from: "", to: "" })} />
          </View>
        </> : null}
      </FormDialog>
    </View>
  </PageFrame>;
}

export default function HistoryScreen() {
  const pathname = usePathname();
  const route = parseHistoryRoute(useLocalSearchParams());
  const { model, actions, scopeKey } = useProduction();
  const profileNavigation = useHistoryProfileRoute(scopeKey);
  const preparationNavigation = useHistoryPreparationRoute(scopeKey, usePreparationWorkspace());
  const taskNavigation = useHistoryTaskRoute(scopeKey, useTasksWorkspace());
  const careNavigation = useHistoryCareRoute(scopeKey, useCareWorkspace(), !!useProductionCareProfile()?.pending);
  const personal = usePersonalHistoryWorkspace();
  const notificationNavigation = useHistoryNotificationRoute(personal);
  const conversationNavigation = useHistoryConversationRoute(personal);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scope = scopeKey ?? personal?.scopeKey ?? "";
  if (pathname !== "/history") return null;
  if (!child && route.category !== "notifications") return <PageFrame title="歷史檔案" density="compact" description="按分類查閱過往資料。"><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></PageFrame>;
  return <HistoryWorkspace key={scope} scope={scope} profileNavigation={profileNavigation} taskNavigation={taskNavigation} careNavigation={careNavigation} preparationNavigation={preparationNavigation} notificationNavigation={notificationNavigation} conversationNavigation={conversationNavigation} />;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.xl, minWidth: 0 }, columns: { flexDirection: "row", alignItems: "flex-start" },
  index: { width: 240, flexShrink: 0 }, mobileIndex: { width: "100%" },
  resultWorkspace: { minWidth: 0, width: "100%", backgroundColor: colors.paper, padding: spacing.lg, gap: spacing.lg, borderTopWidth: 3, borderTopColor: colors.teal }, resultMain: { flex: 1, width: undefined },
  resultHeading: { gap: spacing.xs }, categoryTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  toolbar: { gap: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line },
  controlRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, maxWidth: "100%" },
  toolbarActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, maxWidth: "100%" },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
  results: { gap: spacing.md },
  unavailable: { gap: spacing.md, paddingVertical: spacing.lg, maxWidth: 720 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
});
