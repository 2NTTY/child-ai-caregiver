import { parseHistoryRoute, serializeHistoryRoute, type HistoryRouteState } from "../navigation/route-state";
import { useScopedRouteState } from "../navigation/useScopedRouteState";
import { useGuardedRoute } from "../navigation/useGuardedRoute";
import { usePrivateQuery } from "../navigation/usePrivateQuery";
import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppDateField } from "../components/DateTimeFields";
import { FormDialog } from "../components/FormDialog";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppSelect, AppTextField } from "../components/ui";
import { RouteTextLink } from "../components/RouteTextLink";
import { TaskHistoryView } from "../components/tasks/TaskHistoryView";
import { CareReviewHistoryView } from "../components/care/CareReviewHistoryView";
import { CareSavedRecordsView } from "../components/care/CareSavedRecordsView";
import { PreparationHistoryView } from "../components/preparations/PreparationWorkspace";
import { ProfileHistoryView } from "../components/profile/ProfileHistoryView";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { GrowthHistoryView } from "../components/growth/GrowthHistoryView";
import { historyCategories, historyDateErrors, historyDateRange, type HistoryCategory, type HistoryFilterAction } from "../components/history/history-filters";
import { useProduction } from "../production/ProductionProvider";
import { usePersonalHistoryWorkspace } from "../production/usePersonalHistory";
import { PersonalConversationHistoryView, PersonalNotificationHistoryView } from "../components/history/PersonalHistoryViews";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";

type HistoryReaderReceipt = { scopeKey: string; revision: object; selected: object | null; draft: object | null; deletion: object | null; operation: { state: string }; close(): boolean | void };
const mutableHistoryReader = (reader: HistoryReaderReceipt | null) => !!reader && (!!reader.draft || !!reader.deletion || ["saving", "unknown", "conflict"].includes(reader.operation.state));

export default function HistoryScreen() {
  const router = useRouter(), pathname = usePathname(), params = useLocalSearchParams();
  const { actions: homeActions, model: homeModel, scopeKey, identityKey, owner } = useProduction();
  const go = useGuardedRoute(scopeKey, owner);
  const tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const care = useCareWorkspace();
  const growth = useGrowthWorkspace();
  const personal = usePersonalHistoryWorkspace();
  const profile = useProfileWorkspace();
  const child = homeModel.children.find(item => item.id === homeModel.selectedChildId);
  const parsed = parseHistoryRoute(params);
  const scope = scopeKey ?? (parsed.category === "notifications" ? personal?.scopeKey : null) ?? "";
  const route = useScopedRouteState(scope, "/history", parsed, { ...parsed, selectedId: null, page: 0 }, value => ({ pathname: "/history", params: serializeHistoryRoute(value) }));
  const [query, setQuery] = usePrivateQuery(scopeKey, "/history");
  const filters = { scope, category: route.category, searchText: query, from: route.from ?? "", to: route.to ?? "" };
  const [dateDraft, setDateDraft] = useState<{ scope: string; category: HistoryCategory; from: string; to: string } | null>(null);
  const dateTrigger = useRef<View>(null);
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
  useEffect(() => { setDateDraft(null); }, [scope, filters.category]);

  const reader: HistoryReaderReceipt | null = taskCategory && tasks ? { scopeKey: tasks.scopeKey, revision: tasks.model, selected: tasks.model.selected, draft: tasks.model.draft, deletion: null, operation: tasks.model.operation, close: tasks.actions.closePanel }
    : (careCategory || reviewCategory) && care ? { scopeKey: care.scopeKey, revision: care.model, selected: care.model.detail, draft: care.model.draft, deletion: care.model.deletion, operation: care.model.operation, close: care.actions.closePanel } : null;
  const latestReader = useRef(reader); latestReader.current = reader;
  const signature = `${pathname}:${JSON.stringify(params)}`;
  const [closeIntent, setCloseIntent] = useState<{ scopeKey: string | null; identityKey: string | null; signature: string; original: HistoryReaderReceipt; next: HistoryRouteState; mode: "push" | "replace"; accepted?: () => void } | null>(null);
  const emitted = useRef<typeof closeIntent>(null);
  useEffect(() => {
    if (!closeIntent) return;
    const current = latestReader.current, snapshot = owner.getSnapshot();
    if (pathname !== "/history" || closeIntent.scopeKey !== scopeKey || closeIntent.identityKey !== identityKey || snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey || closeIntent.signature !== signature) {
      // A newer URL wins; keep the old resolver suspended until its retired
      // owner snapshot can no longer reassert a discarded draft's target.
      if (pathname === "/history" && closeIntent.scopeKey === scopeKey && closeIntent.identityKey === identityKey && snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey
        && current?.revision === closeIntent.original.revision && (current.selected || mutableHistoryReader(current))) return;
      emitted.current = null; setCloseIntent(null); return;
    }
    if (!current || current.scopeKey !== scopeKey) { emitted.current = null; setCloseIntent(null); return; }
    if (current.selected || current.draft || current.deletion || current.operation.state !== "none") {
      const old = closeIntent.original;
      if (current.revision !== old.revision && (current.selected !== old.selected || current.draft !== old.draft || current.deletion !== old.deletion || current.operation !== old.operation)) { emitted.current = null; setCloseIntent(null); }
      return;
    }
    if (emitted.current === closeIntent) return;
    emitted.current = closeIntent; closeIntent.accepted?.();
    if (JSON.stringify(serializeHistoryRoute(closeIntent.next)) === JSON.stringify(serializeHistoryRoute(route))) { setCloseIntent(null); return; }
    // Original owner publication and form guard cleanup precede Expo's queue.
    router[closeIntent.mode]({ pathname: "/history", params: serializeHistoryRoute(closeIntent.next) });
  }, [closeIntent, reader?.revision, signature, pathname, scopeKey, identityKey]);
  function closeReadOnlyReader() {
    if (preparationCategory) preparations?.actions.closeDocument();
    if (conversationCategory) personal?.actions.closeMessage();
  }
  function changeRoute(next: HistoryRouteState, mode: "push" | "replace" = "replace", accepted?: () => void) {
    const intent = mutableHistoryReader(latestReader.current) ? "navigation" : "workspace";
    go({ pathname: "/history", params: serializeHistoryRoute(next) }, mode, intent, () => {
      const current = latestReader.current;
      if (!current) { emitted.current = null; setCloseIntent(null); closeReadOnlyReader(); accepted?.(); return; }
      if (current.scopeKey !== scopeKey || intent === "workspace" && mutableHistoryReader(current) || ["saving", "unknown"].includes(current.operation.state) || current.close() === false) return false;
      emitted.current = null; setCloseIntent({ scopeKey, identityKey, signature, original: current, next, mode, accepted });
      return false;
    });
  }
  function filter(action: HistoryFilterAction) {
    if (currentLocked) return;
    if (action.type === "search") {
      if (!route.selectedId && route.page === 0) { setQuery(action.value); return; }
      changeRoute({ ...route, selectedId: null, page: 0 }, "replace", () => setQuery(action.value));
    } else if (action.type === "dates") changeRoute({ ...route, from: action.from || null, to: action.to || null, selectedId: null, page: 0 });
    else if (action.type === "reset") changeRoute({ ...route, from: null, to: null, selectedId: null, page: 0 }, "replace", () => setQuery(""));
  }
  function category(next: HistoryCategory) {
    if (next !== filters.category) changeRoute({ ...parseHistoryRoute({ category: next }), from: null, to: null }, "push");
  }
  const recoveryOwnsSelection = taskCategory ? !!tasks?.model.draft || !!tasks && ["saving", "unknown", "conflict"].includes(tasks.model.operation.state)
    : careCategory || reviewCategory ? !!care?.model.draft || !!care?.model.deletion || !!care && ["saving", "unknown", "conflict"].includes(care.model.operation.state) : false;
  const recoveryId = taskCategory ? tasks?.model.selected?.id ?? tasks?.model.draft?.basis?.id ?? null
    : reviewCategory ? care?.model.draft?.captureId ?? care?.model.draft?.captureSnapshot?.id ?? (care?.model.operation.kind === "review" ? route.selectedId : null)
    : careCategory ? care?.model.detail?.record.id ?? care?.model.draft?.basis?.id ?? care?.model.deletion?.basis.id ?? null : null;
  const selectionRoute = recoveryOwnsSelection ? { ...route, selectedId: recoveryId } : route;
  useEffect(() => {
    if (closeIntent || pathname !== "/history" || owner.getSnapshot().scopeKey !== scopeKey || owner.getSnapshot().identityKey !== identityKey) return;
    if (recoveryOwnsSelection) {
      if (route.selectedId !== recoveryId) router.replace({ pathname: "/history", params: serializeHistoryRoute(selectionRoute) });
      return;
    }
    const id = route.selectedId;
    if (taskCategory && tasks) {
      if (!id) { if (tasks.model.selected) tasks.actions.closePanel(); return; }
      if (tasks.model.selected?.id === id || tasks.model.detailRead?.id === id && ["loading", "error"].includes(tasks.model.detailRead.state)) return;
      tasks.actions.selectTask(id);
    } else if (preparationCategory && preparations) {
      if (!id) { if (preparations.model.selected) preparations.actions.closeDocument(); return; }
      if (preparations.model.selected?.id !== id && preparations.model.documents.some(document => document.id === id && document.status === "archived")) preparations.actions.selectDocument(id);
    } else if (careCategory && care) {
      if (!id) { if (care.model.detail) care.actions.closePanel(); return; }
      if (care.model.detail?.record.id === id || care.model.detailRead?.id === id && ["loading", "error"].includes(care.model.detailRead.state)) return;
      care.actions.openRecord(id);
    }
  }, [closeIntent, pathname, scopeKey, identityKey, route.category, route.selectedId, recoveryOwnsSelection, recoveryId, tasks?.model.selected, tasks?.model.detailRead, preparations?.model.documents, preparations?.model.selected, care?.model.detail, care?.model.detailRead]);
  const attemptedPage = useRef("");
  useEffect(() => {
    if (pathname !== "/history" || !careCategory || !care || recoveryOwnsSelection || owner.getSnapshot().scopeKey !== scopeKey) return;
    const actual = Math.max(0, (care.model.list.page ?? 1) - 1), key = `${scopeKey}:${route.category}:${route.page}`;
    if (actual === route.page) { attemptedPage.current = ""; return; }
    if (!care.model.online || ["loading", "loading_more"].includes(care.model.list.state) || attemptedPage.current === key) return;
    attemptedPage.current = key;
    void care.actions.readPageForRoute?.(route.page);
  }, [pathname, scopeKey, route.category, route.page, care?.model.list.page, care?.model.list.state, care?.model.online, recoveryOwnsSelection]);
  const select = (selectedId: string | null) => changeRoute({ ...route, selectedId }, selectedId ? "push" : "replace");
  const taskReader = tasks ? { ...tasks, model: { ...tasks.model, selected: recoveryOwnsSelection || tasks.model.selected?.id === route.selectedId ? tasks.model.selected : null },
    actions: { ...tasks.actions, selectTask: (id: string) => select(id), closePanel: () => select(null) } } : undefined;
  const careReader = care ? { ...care.model, detail: recoveryOwnsSelection || care.model.detail?.record.id === route.selectedId ? care.model.detail : null } : undefined;
  const results = taskCategory ? dateRange ? <TaskHistoryView workspace={taskReader} route={selectionRoute} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
    : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : preparationCategory ? dateRange ? <PreparationHistoryView route={route} onSelect={select} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} onPrepareQuestion={homeActions.prepareQuestion} searchText={filters.searchText} dateRange={dateRange} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : reviewCategory ? care ? <CareReviewHistoryView key={care.scopeKey} historyRoute={selectionRoute} onHistoryRouteChange={(next, mode) => changeRoute({ ...route, ...next }, mode)} model={care.model} actions={{ ...care.actions, openRecord: id => go({ pathname: "/care", params: { tab: "records", recordId: id } }) }} searchText={filters.searchText} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />
      : <Text style={styles.meta}>正在讀取核對記錄…</Text>
    : careCategory ? care ? <CareSavedRecordsView key={care.scopeKey} model={careReader!} route={selectionRoute} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} actions={{ ...care.actions, search: (query, kind) => changeRoute({ ...route, page: 0, selectedId: null }, "replace", () => care.actions.search(query, kind)), openRecord: select, closePanel: () => select(null) }} />
      : <Text style={styles.meta}>正在讀取已保存記錄…</Text>
    : profileCategory ? profile ? <ProfileHistoryView key={profile.scopeKey} scopeKey={profile.scopeKey} model={profile.model} actions={profile.actions} route={route} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} onSelect={select} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} />
      : <Text style={styles.meta}>正在讀取孩子檔案…</Text>
    : growthCategory ? dateRange ? <GrowthHistoryView scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} route={route} onSelect={select} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} key={growth?.scopeKey ?? scope} searchText={filters.searchText} dateRange={dateRange}
      onRecord={id => go({ pathname: "/care", params: { tab: "records", ...(id ? { recordId: id } : {}) } })} onReview={() => go({ pathname: "/history", params: { category: "review" } })} onTask={id => go({ pathname: "/tasks", params: { taskId: id } })} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : personalCategory ? dateRange ? conversationCategory ? <PersonalConversationHistoryView scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} route={route} onSelect={select} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} searchText={filters.searchText} dateRange={dateRange} onPrepareQuestion={homeActions.prepareQuestion} />
      : <PersonalNotificationHistoryView scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} route={route} onSelect={select} onPageChange={page => changeRoute({ ...route, page, selectedId: null })} searchText={filters.searchText} dateRange={dateRange} />
      : <Text accessibilityRole="alert" style={styles.error}>請先修正日期範圍，再查看結果。</Text>
    : <View testID={`history-unavailable-${filters.category}`}  style={styles.unavailable}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{current.label}暫未可在這裏查閱</Text>
      <Text style={styles.body}>{current.unavailable}</Text>
    </View>;

  if (pathname !== "/history") return null;
  if (!child && route.category !== "notifications") return <PageFrame title="歷史" density="compact"><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => homeActions.open("profile")} /></PageFrame>;
  return <PageFrame density="compact" title="歷史" scrollRef={scrollRef} scrollTestID="history-scroll"
    onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View style={styles.workspace}>
      <View style={styles.categoryRow}>
        <View style={styles.categoryPicker}><AppSelect<HistoryCategory> label="歷史分類" routeFocusKey="history-category" value={filters.category} options={historyCategories.map(item => ({ value: item.key, label: item.label }))}
          onChange={() => {}} onSelectionClosed={category} /></View>
        {!notificationCategory ? <RouteTextLink href={current.sourcePath} label={current.sourceAction} scopeKey={scopeKey} /> : null}
      </View>
      {showSearch ? <View testID="history-filter-toolbar" style={styles.toolbar}>
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
      </View> : null}
      <View testID="history-results" role="region" accessibilityLabel={current.label} style={styles.results}>
        <View style={styles.resultCopy}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{current.label}</Text>
          <Text style={styles.body}>{notificationCategory ? "本人消息，涵蓋帳戶及其他孩子。" : current.description}</Text></View>
        {results}
      </View>
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
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  categoryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  categoryPicker: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, maxWidth: 480 },
  resultCopy: { minWidth: 0, gap: spacing.xs },
  workspace: { gap: spacing.lg, minWidth: 0 },
  toolbar: { gap: spacing.sm },
  controlRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, maxWidth: "100%" },
  toolbarActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, maxWidth: "100%" },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
  results: { gap: spacing.md },
  unavailable: { gap: spacing.md, paddingVertical: spacing.lg, maxWidth: 720 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.body },
});
