import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { ChildOverviewContent } from "../components/child-overview/ChildOverviewContent";
import { PreparationWorkspace } from "../components/preparations/PreparationWorkspace";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTabPanel, UnderlineTabs } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeSummaryContent } from "../production/TaskKnowledgeSummaryContent";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { chineseFont, colors, readingType, spacing } from "../theme";

export type SummaryTab = "overview" | "preparation";
export type SummaryRouteTab = SummaryTab | "legacy-preparation";
export function normalizeSummaryTab(value: string | string[] | undefined): SummaryRouteTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "legacy-preparation" ? "legacy-preparation" : candidate === "preparation" ? "preparation" : "overview";
}

export function SummaryScreen() {
  const { model, actions, scopeKey: productionScope } = useProduction(), profile = useProfileWorkspace(), preparations = usePreparationWorkspace();
  const router = useRouter(), navigate = usePreviewNavigation(), pathname = usePathname();
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const tab = normalizeSummaryTab(requestedTab);
  const child = model.children.find(item => item.id === model.selectedChildId);
  const scopeKey = productionScope ?? "";
  const scrollRef = useRef<ScrollView>(null), scrollPosition = useRef(0);
  const current = useRef({ scopeKey, pathname, tab, mounted: true });
  current.current = { scopeKey, pathname, tab, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  useLayoutEffect(() => {
    scrollPosition.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scopeKey, tab]);

  // Delayed guard confirmation must never apply an old child's or old route's intent.
  function guarded(action: () => void) {
    navigate(() => {
      const live = current.current;
      if (!live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.tab !== tab) return;
      action();
    });
  }
  function changeTab(next: SummaryRouteTab) {
    if (next === tab) return;
    guarded(() => {
      preparations?.actions.closeDocument();
      router.setParams({ tab: next });
    });
  }
  function openProfileHistory() {
    guarded(() => {
      profile?.actions.showHistory();
      router.push("/profile");
    });
  }
  if (pathname !== "/summary") return null;
  return <PageFrame density="compact" title="孩子概況與準備" description="查看孩子目前的資料、已確認照顧摘要及家庭共享準備文件。"
    scrollRef={scrollRef} scrollTestID="child-preparation-scroll" onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    <View key={scopeKey} style={styles.workspace}>
      <UnderlineTabs<SummaryTab> id="child-preparation-tabs" label="孩子概況與準備" items={[{ key: "overview", label: "孩子概況" }, { key: "preparation", label: "準備單" }]} value={tab === "legacy-preparation" ? "overview" : tab} onChange={changeTab} />
      {!child ? <View style={styles.empty}><Text style={styles.body}>先選擇孩子。</Text><AppButton label="查看子女檔案" variant="secondary" onPress={() => guarded(() => router.push("/profile"))} /></View> : <>
        <AppTabPanel tabsId="child-preparation-tabs" tabKey="overview" active={tab === "overview"}>
          {tab === "overview" ? <><ChildOverviewContent onOpenProfile={() => guarded(() => router.push("/profile"))} onOpenProfileHistory={openProfileHistory}
            measurements={profile?.measurements} profileSource={profile?.profileSource}
            onOpenMeasurement={recordId => guarded(() => router.push({ pathname: "/care", params: { record: recordId } }))} />
            <TaskKnowledgeSummaryContent onRecord={id => guarded(() => router.push(`/care?record=${encodeURIComponent(id)}`))} onTask={() => guarded(() => router.push("/tasks"))} />
          </> : null}
        </AppTabPanel>
        <AppTabPanel tabsId="child-preparation-tabs" tabKey="preparation" active={tab === "preparation"}>
          {tab === "preparation" ? <PreparationWorkspace onPrepareQuestion={actions.prepareQuestion} onHistory={() => guarded(() => router.push({ pathname: "/history", params: { category: "preparations" } }))}
            scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} /> : null}
        </AppTabPanel>
        {tab === "legacy-preparation" ? <TaskKnowledgeSummaryContent preparation onRecord={id => guarded(() => router.push(`/care?record=${encodeURIComponent(id)}`))}
          onTask={() => guarded(() => router.push("/tasks"))} onAgent={() => actions.prepareQuestion("想核對這份到診準備的問題與來源：")} /> : null}
      </>}
    </View>
  </PageFrame>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 },
  empty: { gap: spacing.md },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
});
