import { Workspace } from "../components/workspace/Workspace";
import { HistoryCategoryNavigation } from "../components/history/HistoryCategoryNavigation";
import { BackgroundSurface } from "../components/appearance/BackgroundSurface";
import { useEffect, useReducer, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppDateField } from "../components/DateTimeFields";
import { FormDialog } from "../components/FormDialog";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField } from "../components/ui";
import { useContainerWidth } from "../components/useContainerWidth";
import { TaskHistoryView } from "../components/tasks/TaskHistoryView";
import { CareReviewHistoryView, type CareReviewStatusFilter } from "../components/care/CareReviewHistoryView";
import { CareSavedRecordsView } from "../components/care/CareSavedRecordsView";
import { PreparationHistoryView } from "../components/preparations/PreparationWorkspace";
import { ProfileHistoryView } from "../components/profile/ProfileHistoryView";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { GrowthHistoryView } from "../components/growth/GrowthHistoryView";
import { createHistoryFilters, historyCategories, historyDateErrors, historyDateRange, historyFilterReducer, normalizeHistoryCategory, normalizeReviewHistoryStatus, normalizeHistoryOlderOnly, type HistoryCategory, type HistoryFilterAction } from "../components/history/history-filters";
import { useProduction } from "../production/ProductionProvider";
import { usePersonalHistoryWorkspace } from "../production/usePersonalHistory";
import { PersonalConversationHistoryView, PersonalNotificationHistoryView } from "../components/history/PersonalHistoryViews";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";

function HistoryWorkspace({ scope, initialCategory, initialReviewStatus, olderOnly }: { scope: string; initialCategory: HistoryCategory; initialReviewStatus: CareReviewStatusFilter; olderOnly: boolean }) {
  const router = useRouter(), navigate = usePreviewNavigation();
  const { actions: homeActions } = useProduction();
  const tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const care = useCareWorkspace();
  const growth = useGrowthWorkspace();
  const personal = usePersonalHistoryWorkspace();
  const profile = useProfileWorkspace();
  const [filters, dispatch] = useReducer(historyFilterReducer, undefined, () => createHistoryFilters(scope, initialCategory));
  const [dateDraft, setDateDraft] = useState<{ scope: string; category: HistoryCategory; from: string; to: string } | null>(null);
  const dateTrigger = useRef<View>(null);
  const layout = useContainerWidth(), compact = layout.width < 880;
  const scrollRef = useRef<ScrollView>(null), scrollPosition = useRef(0);
  const current = historyCategories.find(item => item.key === filters.category)!;
  const dateRange = historyDateRange(filters.from, filters.to);
  const dateErrors = dateDraft ? historyDateErrors(dateDraft.from, dateDraft.to) : {};
  const conversationCategory = filters.category === "conversations", notificationCategory = filters.category === "notifications";
  const personalCategory = conversationCategory || notificationCategory;
  const taskCategory = filters.category === "tasks";
  const preparationCategory = filters.category === "preparations";
  const growthCategory = filters.category === "growth";
  const profileCategory = filters.category === "profile";
  const reviewCategory = filters.category === "review", careCategory = filters.category === "care";
  const taskLocked = !!tasks && (tasks.model.reading || tasks.model.access === "lost" || ["saving", "unknown", "conflict"].includes(tasks.model.operation.state) || !!tasks.model.draft);
  const preparationLocked = !preparations || ["loading", "unavailable", "lost"].includes(preparations.model.condition);
  const careLocked = !care || care.model.access === "lost" || ["loading", "loading_more"].includes(care.model.list.state)
    || ["saving", "unknown", "conflict"].includes(care.model.operation.state) || !!care.model.draft || !!care.model.deletion
    || reviewCategory && care.model.review?.state !== "ready";
  const growthLocked = !growth || growth.model.access === "lost" || growth.model.busy || !!growth.model.pending || growth.model.dirty || growth.model.page?.concerns?.state !== "ready";
  const currentLocked = taskCategory ? taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory || careCategory ? careLocked : false;
  const filterDisabled = taskCategory ? !tasks || taskLocked : preparationCategory ? preparationLocked : growthCategory ? growthLocked : reviewCategory ? careLocked : personalCategory ? !personal : true;
  const showSearch = !careCategory && !profileCategory;
  const supportsDates = taskCategory || preparationCategory || growthCategory || personalCategory;
  const hasDates = supportsDates && !!(filters.from || filters.to);
  const hasFilters = !!filters.searchText || hasDates;
  const dateDialogVisible = !!dateDraft && dateDraft.scope === scope && dateDraft.category === filters.category && showSearch && supportsDates;
  useEffect(() => { dispatch({ type: "category", value: initialCategory }); }, [initialCategory]);
  useEffect(() => { setDateDraft(null); }, [scope, filters.category]);

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
    }, "workspace");
  }
  const results = taskCategory ? dateRange ? <TaskHistoryView searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
    : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : preparationCategory ? dateRange ? <PreparationHistoryView onPrepareQuestion={homeActions.prepareQuestion} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : reviewCategory ? care ? <CareReviewHistoryView key={care.scopeKey} model={care.model} actions={care.actions} searchText={filters.searchText} initialStatus={initialReviewStatus} olderOnly={olderOnly} />
      : <Text style={styles.meta}>正在讀取核對記錄…</Text>
    : careCategory ? care ? <CareSavedRecordsView key={care.scopeKey} model={care.model} actions={care.actions} />
      : <Text style={styles.meta}>正在讀取已保存記錄…</Text>
    : profileCategory ? profile ? <ProfileHistoryView key={profile.scopeKey} scopeKey={profile.scopeKey} model={profile.model} actions={profile.actions} />
      : <Text style={styles.meta}>正在讀取孩子檔案…</Text>
    : growthCategory ? dateRange ? <GrowthHistoryView key={growth?.scopeKey ?? scope} searchText={filters.searchText} dateRange={dateRange}
      onRecord={id => navigate(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))} onTask={id => navigate(() => { tasks?.actions.selectTask(id); router.push("/tasks"); })} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : personalCategory ? dateRange ? conversationCategory ? <PersonalConversationHistoryView searchText={filters.searchText} dateRange={dateRange} onPrepareQuestion={homeActions.prepareQuestion} />
      : <PersonalNotificationHistoryView searchText={filters.searchText} dateRange={dateRange} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : <View testID={`history-unavailable-${filters.category}`}  style={styles.unavailable}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{current.label}暫未可在這裏查閱</Text>
      <Text style={styles.body}>{current.unavailable}</Text>
    </View>;

  const resultSurface = <View style={styles.results}>{results}</View>;
  return <PageFrame density="compact" title="歷史資料庫" description="按分類找回原文、已完成安排與過往修改；每一項仍連回原資料。" scrollRef={scrollRef} scrollTestID="history-scroll"
    onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View ref={layout.ref} onLayout={layout.onLayout} style={styles.workspace}>
      <Workspace.Provider title="歷史資料庫" compact={compact}><Workspace.Split>
        <Workspace.Aside style={!compact ? styles.categoryRail : undefined}><HistoryCategoryNavigation value={filters.category} compact={compact} onChange={category} /></Workspace.Aside>
        <Workspace.Main>
          <View style={styles.categoryHeading}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{current.label}</Text><Text style={styles.meta}>{current.description}</Text></View>
      {showSearch ? <BackgroundSurface padded testID="history-filter-toolbar" style={styles.toolbar}>
        <View style={styles.controlRow}>
          {showSearch ? <View style={styles.searchField}><AppTextField label={`搜尋${current.label}`} accessibilityLabel={`搜尋${current.label}`} value={filters.searchText} maxLength={200} disabled={filterDisabled} onChangeText={value => filter({ type: "search", value })} /></View> : null}
          {supportsDates || hasFilters ? <View style={styles.toolbarActions}>
            {showSearch && supportsDates ? <AppButton ref={dateTrigger} label={hasDates ? "日期已篩選" : "日期篩選"} variant="secondary" density="compact" disabled={filterDisabled}
              onPress={() => { if (!filterDisabled) setDateDraft({ scope, category: filters.category, from: filters.from, to: filters.to }); }} /> : null}
            {showSearch && hasFilters ? <AppButton label={reviewCategory ? "清除搜尋" : "清除篩選"} variant="quiet" density="compact" disabled={currentLocked}
              onPress={() => filter(reviewCategory ? { type: "search", value: "" } : { type: "reset" })} /> : null}
          </View> : null}
        </View>
        {showSearch && hasDates ? <Text testID="history-applied-dates" style={styles.meta}>日期：{filters.from && filters.to ? `${filters.from} 至 ${filters.to}` : filters.from ? `${filters.from} 起` : `截至 ${filters.to}`}</Text> : null}
        {notificationCategory ? <Text style={styles.meta}>本人消息，涵蓋帳戶及其他孩子</Text> : null}
        {reviewCategory ? <Text style={styles.meta}>按內容及處理狀態搜尋；暫不支援日期篩選。</Text> : null}
      </BackgroundSurface> : null}
      {/* Category controls change presentation only; the same reader stays mounted across widths. */}
      <View testID="history-current-results" role="region" accessibilityLabel={current.label} style={styles.results}>{resultSurface}</View>
      <FormDialog visible={dateDialogVisible} dismissMode="local" scopeKey={scope} formKey={filters.category} title="日期篩選" returnFocusRef={dateTrigger} onClose={() => setDateDraft(null)}>
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
        </Workspace.Main>
      </Workspace.Split></Workspace.Provider>
    </View>
  </PageFrame>;
}

export default function HistoryScreen() {
  const pathname = usePathname();
  const { category, status, older } = useLocalSearchParams<{ category?: string | string[]; status?: string | string[]; older?: string | string[] }>();
  const { model, actions, scopeKey } = useProduction();
  const personal = usePersonalHistoryWorkspace();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scope = scopeKey ?? personal?.scopeKey ?? "";
  if (pathname !== "/history") return null;
  if (!child && normalizeHistoryCategory(category) !== "notifications") return <PageFrame title="歷史" density="compact" description="按分類查閱過往資料。"><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></PageFrame>;
  return <HistoryWorkspace key={scope} scope={scope} initialCategory={normalizeHistoryCategory(category)} initialReviewStatus={normalizeReviewHistoryStatus(status)} olderOnly={normalizeHistoryOlderOnly(older)} />;
}

const styles = StyleSheet.create({
  categoryRail: { width: 208 }, categoryHeading: { gap: spacing.xs },
  workspace: { gap: spacing.lg, minWidth: 0 },
  toolbar: { gap: spacing.sm },
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
