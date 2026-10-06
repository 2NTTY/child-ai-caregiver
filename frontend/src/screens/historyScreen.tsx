import { useEffect, useReducer, useRef } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppDateField } from "../components/DateTimeFields";
import { timeZoneLabel } from "../components/date-time";
import { PageFrame } from "../components/PageFrame";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppButton, AppSelect, AppTabPanel, AppTextField, UnderlineTabs } from "../components/ui";
import { useContainerWidth } from "../components/useContainerWidth";
import { TaskHistoryView } from "../components/tasks/TaskHistoryView";
import { CareReviewHistoryView, type CareReviewStatusFilter } from "../components/care/CareReviewHistoryView";
import { CareSavedRecordsView } from "../components/care/CareSavedRecordsView";
import { PreparationHistoryView } from "../components/preparations/PreparationWorkspace";
import { GrowthHistoryView } from "../components/growth/GrowthHistoryView";
import { createHistoryFilters, historyCategories, historyDateErrors, historyDateRange, historyFilterReducer, normalizeHistoryCategory, normalizeReviewHistoryStatus, normalizeHistoryOlderOnly, type HistoryCategory, type HistoryFilterAction } from "../components/history/history-filters";
import { useProduction } from "../production/ProductionProvider";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { searchPreparationHistory } from "../preparation-view-model";
import { chineseFont, colors, readingType, spacing } from "../theme";

function HistoryWorkspace({ scope, childName, initialCategory, initialReviewStatus, olderOnly }: { scope: string; childName: string; initialCategory: HistoryCategory; initialReviewStatus: CareReviewStatusFilter; olderOnly: boolean }) {
  const router = useRouter(), navigate = usePreviewNavigation();
  const { actions: homeActions } = useProduction();
  const tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const care = useCareWorkspace();
  const growth = useGrowthWorkspace();
  const [filters, dispatch] = useReducer(historyFilterReducer, undefined, () => createHistoryFilters(scope, initialCategory));
  const layout = useContainerWidth(), compact = layout.width < 680;
  const scrollRef = useRef<ScrollView>(null), scrollPosition = useRef(0);
  const current = historyCategories.find(item => item.key === filters.category)!;
  const dateErrors = historyDateErrors(filters.from, filters.to), dateRange = historyDateRange(filters.from, filters.to);
  const taskCategory = filters.category === "tasks";
  const preparationCategory = filters.category === "preparations";
  const growthCategory = filters.category === "growth";
  const reviewCategory = filters.category === "review", careCategory = filters.category === "care";
  const showingCompactTaskDetail = taskCategory && layout.width < 840 && !!tasks?.model.selected && ["completed", "cancelled"].includes(tasks.model.selected.occurrence.state);
  const taskLocked = !!tasks && (tasks.model.reading || tasks.model.access === "lost" || ["saving", "unknown", "conflict"].includes(tasks.model.operation.state) || !!tasks.model.draft);
  const preparationLocked = !preparations || ["loading", "unavailable", "lost"].includes(preparations.model.condition);
  const careLocked = !care || care.model.access === "lost" || ["loading", "loading_more"].includes(care.model.list.state)
    || ["saving", "unknown", "conflict"].includes(care.model.operation.state) || !!care.model.draft || !!care.model.deletion
    || reviewCategory && care.model.review?.state !== "ready";
  const growthLocked = !growth || growth.model.access === "lost" || growth.model.busy || !!growth.model.pending || growth.model.dirty || growth.model.page?.concerns?.state !== "ready";
  const currentLocked = taskCategory ? taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory || careCategory ? careLocked : false;
  const filterDisabled = taskCategory ? !tasks || taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory ? careLocked : true;
  const showingCompactPreparationDetail = preparationCategory && layout.width < 840 && preparations?.model.selected?.status === "archived" && !!dateRange
    && searchPreparationHistory(preparations.model.documents, filters.searchText, dateRange).some(document => document.id === preparations.model.selected?.id);
  const hasFilters = !!(filters.searchText || filters.from || filters.to);
  useEffect(() => { dispatch({ type: "category", value: initialCategory }); }, [initialCategory]);

  function filter(action: HistoryFilterAction) {
    if (currentLocked) return;
    tasks?.actions.closePanel();
    preparations?.actions.closeDocument();
    care?.actions.closePanel();
    dispatch(action);
  }
  function category(next: HistoryCategory) {
    if (next === filters.category) return;
    navigate(() => {
      tasks?.actions.closePanel();
      preparations?.actions.closeDocument();
      care?.actions.closePanel();
      dispatch({ type: "category", value: next });
      router.setParams({ category: next, status: undefined, older: undefined });
    });
  }
  const results = taskCategory ? dateRange ? <TaskHistoryView searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
    : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : preparationCategory ? dateRange ? <PreparationHistoryView onPrepareQuestion={homeActions.prepareQuestion} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : reviewCategory ? care ? <CareReviewHistoryView key={care.scopeKey} model={care.model} actions={care.actions} searchText={filters.searchText} initialStatus={initialReviewStatus} olderOnly={olderOnly} />
      : <Text style={styles.meta}>正在準備目前孩子的核對記錄，未取得正確作用域前不顯示舊內容。</Text>
    : careCategory ? care ? <CareSavedRecordsView key={care.scopeKey} model={care.model} actions={care.actions} />
      : <Text style={styles.meta}>正在準備目前孩子的已保存記錄，未取得正確作用域前不顯示舊內容。</Text>
    : growthCategory ? dateRange ? <GrowthHistoryView key={growth?.scopeKey ?? scope} searchText={filters.searchText} dateRange={dateRange}
      onRecord={id => navigate(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))} onTask={id => navigate(() => { tasks?.actions.selectTask(id); router.push("/tasks"); })} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : <View testID={`history-unavailable-${filters.category}`}  style={styles.unavailable}>
      <AppStatusBadge label="尚未接入歷史頁" tone="neutral" />
      <Text accessibilityRole="header" style={styles.sectionTitle}>{current.label}暫未可在這裏查閱</Text>
      <Text style={styles.body}>{current.unavailable}</Text>
      <Text style={styles.meta}>這不代表沒有歷史；搜尋及日期篩選會在同一資料來源接入後啟用。</Text>
      <AppButton label={current.sourceAction} variant="secondary" onPress={() => navigate(() => router.push(current.sourcePath))} />
    </View>;

  return <PageFrame density="compact" title="歷史" description={`分類回看${childName}的過往資料，從原始來源查看詳情。`} scrollRef={scrollRef} scrollTestID="history-scroll"
    onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View ref={layout.ref} onLayout={layout.onLayout} style={styles.workspace}>
      {compact ? <AppSelect<HistoryCategory> label="歷史分類" value={filters.category} options={historyCategories.map(item => ({ value: item.key, label: item.label }))} onChange={category} />
        : <UnderlineTabs<HistoryCategory> id="history-categories" label="歷史分類" items={historyCategories} value={filters.category} onChange={category} />}
      <View style={styles.sourceRow}>
        <View style={styles.sourceCopy}><Text accessibilityRole="header" style={styles.sectionTitle}>{current.label}</Text><Text style={styles.meta}>{current.description}{!growthCategory ? ` · 來源：${current.sourceLabel}` : null}</Text></View>
        {reviewCategory || careCategory ? <AppButton label="開啟記錄與核對" variant="secondary" density="compact" onPress={() => navigate(() => router.push("/care"))} /> : null}
        {taskCategory ? <AppButton label="開啟待辦" variant="secondary" density="compact" onPress={() => navigate(() => router.push("/tasks"))} /> : null}
        {preparationCategory ? <AppButton label="開啟準備單" variant="secondary" density="compact" onPress={() => navigate(() => router.push({ pathname: "/summary", params: { tab: "preparation" } }))} /> : null}
        {growthCategory ? <View style={styles.sourceActions}>
          <AppButton label="查看持續關注" variant="secondary" density="compact" style={styles.sourceAction} onPress={() => navigate(() => router.push("/growth"))} />
          <AppButton label="查看年度與季度檔案" variant="quiet" density="compact" style={styles.sourceAction} onPress={() => navigate(() => router.push("/growth?tab=archive"))} />
        </View> : null}
      </View>
      {!careCategory && !showingCompactTaskDetail && !showingCompactPreparationDetail ? <View testID="history-filter-toolbar" style={styles.toolbar}>
        <AppTextField label={`搜尋${current.label}`} accessibilityLabel={`搜尋${current.label}`} value={filters.searchText} maxLength={200} disabled={filterDisabled} onChangeText={value => filter({ type: "search", value })} />
        {!reviewCategory ? <View style={[styles.dateRow, compact && styles.dateStack]}>
          <View style={styles.dateField}><AppDateField label="開始日期（可不填）" value={filters.from} error={dateErrors.from} disabled={filterDisabled} onChange={value => filter({ type: "from", value })} /></View>
          <View style={styles.dateField}><AppDateField label="結束日期（可不填）" value={filters.to} error={dateErrors.to} disabled={filterDisabled} onChange={value => filter({ type: "to", value })} /></View>
          <AppButton label="清除篩選" variant="quiet" style={[styles.clearFilter, compact && styles.clearFilterStack]} disabled={!hasFilters || currentLocked} onPress={() => filter({ type: "reset" })} />
        </View> : <><Text style={styles.meta}>核對記錄尚未提供可核實的日期欄位，這裏只按內容及處理狀態搜尋。</Text><AppButton label="清除搜尋" variant="quiet" disabled={!filters.searchText || currentLocked} onPress={() => filter({ type: "search", value: "" })} /></>}
        {taskCategory && tasks ? <Text style={styles.meta}>日期只按已取得且吻合版本的完成／取消修訂時間篩選（{timeZoneLabel(tasks.model.scheduleContext.timeZone)}）；未讀取修訂的事項沒有完成日期，不會用安排時間代替。只顯示同一任務 owner 已取得的分頁。</Text> : null}
        {preparationCategory && preparations ? <Text style={styles.meta}>目前 API 只提供單一共享到診準備，尚未接通文件歸檔歷史；此區不能代表完整準備單歷史。</Text> : null}
      </View> : null}
      {compact ? <View style={styles.results}>{results}</View> : <AppTabPanel tabsId="history-categories" tabKey={filters.category} active style={styles.results}>{results}</AppTabPanel>}
    </View>
  </PageFrame>;
}

export default function HistoryScreen() {
  const pathname = usePathname();
  const { category, status, older } = useLocalSearchParams<{ category?: string | string[]; status?: string | string[]; older?: string | string[] }>();
  const { model, actions, scopeKey } = useProduction();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scope = scopeKey ?? "";
  if (pathname !== "/history") return null;
  if (!child) return <PageFrame title="歷史" density="compact" description="按分類查閱過往資料。"><Text style={styles.body}>先選擇有權查看的孩子，不會顯示其他孩子的歷史。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></PageFrame>;
  return <HistoryWorkspace key={scope} scope={scope} childName={child.displayName} initialCategory={normalizeHistoryCategory(category)} initialReviewStatus={normalizeReviewHistoryStatus(status)} olderOnly={normalizeHistoryOlderOnly(older)} />;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 },
  sourceRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md },
  sourceCopy: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  sourceActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md, maxWidth: "100%" },
  sourceAction: { alignSelf: "center" },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
  toolbar: { gap: spacing.md, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  dateRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  dateStack: { flexDirection: "column", alignItems: "stretch" },
  // Paper's labelled outlined field reserves 6px above its 50px visible outline.
  clearFilter: { marginTop: 6, minHeight: 50, justifyContent: "center" },
  clearFilterStack: { marginTop: 0 },
  dateField: { flex: 1, minWidth: 0 }, results: { gap: spacing.md },
  unavailable: { gap: spacing.md, paddingVertical: spacing.lg, maxWidth: 720 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
});
