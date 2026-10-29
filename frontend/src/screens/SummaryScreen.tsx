import { parseSummaryRoute, serializeSummaryRoute } from "../navigation/route-state";
import { useScopedRouteState } from "../navigation/useScopedRouteState";
import { AvatarView } from '../components/avatar/AvatarView';
import { useProductionAvatar } from '../production/useProductionAvatar';
import { useEffect, useLayoutEffect, useRef } from "react";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { ChildOverviewConcerns } from "../components/child-overview/ChildOverviewConcerns";
import { ChildOverviewContent } from "../components/child-overview/ChildOverviewContent";
import { GrowthArchive } from "../components/growth/GrowthArchive";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { FamilyReportControls } from "../production/FamilyReportControls";
import { useProductionFamilyDocuments } from "../production/TaskKnowledgeDomains";
import { useFileExportAvailable } from "../platform/file-export";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { WorkspaceSwitch } from "../components/workspace/WorkspaceSwitch";
import { Workspace } from "../components/workspace/Workspace";
import { PageFrame } from "../components/PageFrame";
import { ReadTargetLink } from "../components/ReadTargetLink";
import { AppButton, AppTabPanel, UnderlineTabs } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeSummaryContent } from "../production/TaskKnowledgeSummaryContent";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";

export type SummaryTab = "overview" | "archive";
export type SummaryRouteTab = SummaryTab | "preparation" | "legacy-preparation";
export function normalizeSummaryTab(value: string | string[] | undefined): SummaryRouteTab {
  return parseSummaryRoute({ tab: value }).tab;
}

export function SummaryScreen() {
  const avatar = useProductionAvatar('child');
  const { model, actions, scopeKey: productionScope, identityKey, owner } = useProduction(), profile = useProfileWorkspace();
  const growth = useGrowthWorkspace(), documents = useProductionFamilyDocuments();
  const fileExportAvailable = useFileExportAvailable();
  const router = useRouter(), navigate = usePreviewNavigation(), pathname = usePathname();
  const params = useLocalSearchParams(), parsed = parseSummaryRoute(params);
  const route = useScopedRouteState(productionScope, "/summary", parsed, { ...parsed, periodId: null, documentId: null, snapshotId: null, snapshotVersion: null }, value => ({ pathname: "/summary", params: serializeSummaryRoute(value) }));
  const tab = route.tab, routeKey = JSON.stringify(params);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scopeKey = productionScope ?? "";
  const scrollRef = useRef<ScrollView>(null);
  const current = useRef({ scopeKey, pathname, routeKey, mounted: true });
  current.current = { scopeKey, pathname, routeKey, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scopeKey, tab]);

  // Delayed guard confirmation must never apply an old child's or old route's intent.
  function guarded(action: () => void, intent: "navigation" | "workspace" = "workspace") {
    navigate(() => {
      const live = current.current, snapshot = owner.getSnapshot();
      if (snapshot.scopeKey !== productionScope || snapshot.identityKey !== identityKey) return;
      if (!live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.routeKey !== routeKey) return;
      action();
    }, intent);
  }
  function changeTab(next: SummaryRouteTab) {
    if (next === tab) return;
    guarded(() => {
      router.push({ pathname: "/summary", params: serializeSummaryRoute({ tab: next, periodId: null, documentId: null, snapshotId: null, snapshotVersion: null }) });
    }, "navigation");
  }
  function openProfileHistory() {
    guarded(() => {
      router.push("/history?category=profile");
    });
  }
  if (pathname !== "/summary") return null;
  if (tab === "preparation") return <Redirect href={{ pathname: "/growth", params: { tab: "preparation", ...(route.documentId ? { documentId: route.documentId } : {}) } }} />;
  return <PageFrame density="compact" title="概況" scrollRef={scrollRef} scrollTestID="child-growth-scroll">
    <View key={scopeKey} style={styles.workspace}>
      <WorkspaceSwitch<SummaryTab> id="child-growth-tabs" label="概況與成長檔案" items={[{ key: "overview", label: "目前照顧概況", description: "孩子的已知資料與最近安排" }, { key: "archive", label: "成長檔案與報告", description: "按期間整理記錄，保留可追溯來源" }]} value={tab === "legacy-preparation" ? "overview" : tab} onChange={changeTab} />
      {!child ? <View style={styles.empty}><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" variant="secondary" onPress={() => guarded(() => router.push("/profile"))} /></View> : <>
        <AppTabPanel tabsId="child-growth-tabs" tabKey="overview" active={tab === "overview"}>
          {tab === "overview" ? <><ChildOverviewContent onOpenProfile={() => guarded(() => router.push("/profile"))} onOpenProfileHistory={openProfileHistory}
            avatar={<AvatarView name={child.displayName} uri={avatar.state.key === scopeKey ? avatar.state.uri : null} size={64} subtle />}
            measurements={profile?.measurements} profileSource={profile?.profileSource}
            companion={<ChildOverviewConcerns model={growth?.model ?? null} scopeKey={scopeKey} childId={child.id} onOpen={() => guarded(() => router.push("/growth?tab=concerns"))} onOpenConcern={id => guarded(() => router.push(`/growth?tab=concerns&concernId=${encodeURIComponent(id)}`))} />}
            onOpenMeasurement={recordId => guarded(() => router.push(`/care?tab=records&recordId=${encodeURIComponent(recordId)}`))} />
            <TaskKnowledgeSummaryContent presentation="overview" scopeKey={scopeKey} childId={child.id} onRecord={id => guarded(() => router.push(`/care?tab=records&recordId=${encodeURIComponent(id)}`))} onTask={id => guarded(() => router.push(`/tasks?taskId=${encodeURIComponent(id)}`))} />
          </> : null}
        </AppTabPanel>
        <AppTabPanel tabsId="child-growth-tabs" tabKey="archive" active={tab === "archive"}>
          {tab === "archive" ? growth ? <>
            <GrowthArchive key={growth.scopeKey} selection={route} onSelectionChange={next => guarded(() => {
              growth.model.page?.archive?.reading?.closeVersion();
              router.push({ pathname: "/summary", params: serializeSummaryRoute({ ...next, tab: "archive" }) });
            })} model={growth.model} scrollRef={scrollRef} active
              onRecord={id => guarded(() => router.push(id ? `/care?tab=records&recordId=${encodeURIComponent(id)}` : "/care?tab=records"))}
              onExportReport={fileExportAvailable ? documents?.exportReport : undefined} exportBusy={documents?.exportBusy}
              footerActions={<ReadTargetLink href="/care?tab=records" label="前往原始記錄" onOpen={() => guarded(() => router.push("/care?tab=records"))} style={styles.readLink}><Text style={styles.readLinkLabel}>前往原始記錄</Text></ReadTargetLink>} />
            <Workspace.Section title="報告管理" detail="查看產生狀態，或以已確認的資料重新整理。"><FamilyReportControls scopeKey={growth.scopeKey} online={growth.model.online} onRefresh={growth.actions.refresh} /></Workspace.Section>
          </> : <ReadStateNotice state="loading" scopeKey={scopeKey} message="正在讀取成長檔案…" /> : null}
        </AppTabPanel>
        {tab === "legacy-preparation" ? <TaskKnowledgeSummaryContent preparation onRecord={id => guarded(() => router.push(`/care?tab=records&recordId=${encodeURIComponent(id)}`))}
          onTask={id => guarded(() => router.push(`/tasks?taskId=${encodeURIComponent(id)}`))} onAgent={() => actions.prepareQuestion("想核對這份到診準備的問題與來源：")} /> : null}
      </>}
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 },
  empty: { gap: spacing.md },
  readLink: {minHeight: 44, justifyContent: "center", maxWidth: "100%", paddingVertical: spacing.sm},
  readLinkLabel: {fontFamily: chineseFont, color: colors.teal, ...readingType.body, textDecorationLine: "underline"},
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
});
