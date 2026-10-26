import { AvatarView } from '../components/avatar/AvatarView';
import { useProductionAvatar } from '../production/useProductionAvatar';
import { useEffect, useLayoutEffect, useRef } from "react";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { JournalSection } from "../components/journal/JournalLayout";
import { ChildOverviewConcerns } from "../components/child-overview/ChildOverviewConcerns";
import { ChildOverviewContent } from "../components/child-overview/ChildOverviewContent";
import { GrowthArchive } from "../components/growth/GrowthArchive";
import { useContainerWidth } from "../components/useContainerWidth";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { FamilyReportControls } from "../production/FamilyReportControls";
import { useProductionFamilyDocuments } from "../production/TaskKnowledgeDomains";
import { useFileExportAvailable } from "../platform/file-export";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTabPanel, UnderlineTabs } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeSummaryContent } from "../production/TaskKnowledgeSummaryContent";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";

export type SummaryTab = "overview" | "archive";
export type SummaryRouteTab = SummaryTab | "preparation" | "legacy-preparation";
export function normalizeSummaryTab(value: string | string[] | undefined): SummaryRouteTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "legacy-preparation" || candidate === "preparation" || candidate === "archive" ? candidate : "overview";
}

export function SummaryScreen() {
  const avatar = useProductionAvatar('child');
  const { model, actions, scopeKey: productionScope } = useProduction(), profile = useProfileWorkspace();
  const growth = useGrowthWorkspace(), documents = useProductionFamilyDocuments(), layout = useContainerWidth();
  const fileExportAvailable = useFileExportAvailable();
  const router = useRouter(), navigate = usePreviewNavigation(), pathname = usePathname();
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const tab = normalizeSummaryTab(requestedTab);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scopeKey = productionScope ?? "";
  const scrollRef = useRef<ScrollView>(null);
  const current = useRef({ scopeKey, pathname, tab, mounted: true });
  current.current = { scopeKey, pathname, tab, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scopeKey, tab]);

  // Delayed guard confirmation must never apply an old child's or old route's intent.
  function guarded(action: () => void, intent: "navigation" | "workspace" = "workspace") {
    navigate(() => {
      const live = current.current;
      if (!live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.tab !== tab) return;
      action();
    }, intent);
  }
  function changeTab(next: SummaryRouteTab) {
    if (next === tab) return;
    guarded(() => {
      router.setParams({ tab: next });
    }, "navigation");
  }
  function openProfileHistory() {
    guarded(() => {
      router.push("/history?category=profile");
    });
  }
  if (pathname !== "/summary") return null;
  if (tab === "preparation") return <Redirect href="/growth?tab=preparation" />;
  return <PageFrame density="compact" title="孩子手冊" description="先看孩子的生活脈絡，再回看近期記錄、持續關注和已整理的文件。" scrollRef={scrollRef} scrollTestID="child-growth-scroll">
    <View key={scopeKey} ref={layout.ref} onLayout={layout.onLayout} style={styles.workspace}>
      <UnderlineTabs<SummaryTab> id="child-growth-tabs" label="概況與成長檔案" items={[{ key: "overview", label: "概況" }, { key: "archive", label: "成長檔案" }]} value={tab === "legacy-preparation" ? "overview" : tab} onChange={changeTab} />
      {!child ? <View style={styles.empty}><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" variant="secondary" onPress={() => guarded(() => router.push("/profile"))} /></View> : <>
        <AppTabPanel tabsId="child-growth-tabs" tabKey="overview" active={tab === "overview"}>
          {tab === "overview" ? <><ChildOverviewContent onOpenProfile={() => guarded(() => router.push("/profile"))} onOpenProfileHistory={openProfileHistory}
            avatar={<AvatarView name={child.displayName} uri={avatar.state.key === scopeKey ? avatar.state.uri : null} size={64} subtle />}
            measurements={profile?.measurements} profileSource={profile?.profileSource}
            companion={<ChildOverviewConcerns model={growth?.model ?? null} scopeKey={scopeKey} childId={child.id} onOpen={() => guarded(() => router.push("/growth?tab=concerns"))} />}
            onOpenMeasurement={recordId => guarded(() => router.push({ pathname: "/care", params: { record: recordId } }))} />
            <TaskKnowledgeSummaryContent presentation="overview" scopeKey={scopeKey} childId={child.id} onRecord={id => guarded(() => router.push(`/care?record=${encodeURIComponent(id)}`))} onTask={id => guarded(() => router.push(`/tasks?taskId=${encodeURIComponent(id)}`))} />
          </> : null}
        </AppTabPanel>
        <AppTabPanel tabsId="child-growth-tabs" tabKey="archive" active={tab === "archive"}>
          {tab === "archive" ? growth ? <JournalSection title="成長文件目錄" description="閱讀已整理的文件、核對版本，或回到原始記錄。" action={<AppButton label="開啟到診準備" variant="secondary" onPress={() => guarded(() => router.push("/growth?tab=preparation"))} />}>
            <GrowthArchive key={growth.scopeKey} model={growth.model} wide={layout.width >= 880} scrollRef={scrollRef} active
              onRecord={id => guarded(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))}
              onExportReport={fileExportAvailable ? documents?.exportReport : undefined} exportBusy={documents?.exportBusy}
              footerActions={<AppButton label="前往原始記錄" variant="secondary" density="compact" onPress={() => guarded(() => router.push("/care"))} />} />
            <FamilyReportControls scopeKey={growth.scopeKey} online={growth.model.online} onRefresh={growth.actions.refresh} />
          </JournalSection> : <ReadStateNotice state="loading" scopeKey={scopeKey} message="正在讀取成長檔案…" /> : null}
        </AppTabPanel>
        {tab === "legacy-preparation" ? <TaskKnowledgeSummaryContent preparation onRecord={id => guarded(() => router.push(`/care?record=${encodeURIComponent(id)}`))}
          onTask={id => guarded(() => router.push(`/tasks?taskId=${encodeURIComponent(id)}`))} onAgent={() => actions.prepareQuestion("想核對這份到診準備的問題與來源：")} /> : null}
      </>}
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 },
  empty: { gap: spacing.md },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
});
