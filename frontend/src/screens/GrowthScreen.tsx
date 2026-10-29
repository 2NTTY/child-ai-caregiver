import { Redirect, useLocalSearchParams, usePathname } from "expo-router";
import { Text } from "react-native-paper";
import { useGrowthRouteNavigation } from "../navigation/useGrowthRouteNavigation";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeGrowthCandidates, GrowthSuggestionSettings } from "../production/TaskKnowledgeGrowthCandidates";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { GrowthView } from "../components/growth/GrowthView";
import { AppButton, SectionCard } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

export function GrowthScreen() {
  const { model, actions, scopeKey } = useProduction(), workspace = useGrowthWorkspace();
  const preparations = usePreparationWorkspace();
  const params = useLocalSearchParams();
  const navigation = useGrowthRouteNavigation(preparations, scopeKey), route = navigation.route;
  const requested = typeof params.tab === "string" ? params.tab : undefined;
  const tab = route.tab, pathname = usePathname();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const openTask = (id: string) => navigation.open({ pathname: "/tasks", params: { taskId: id } });
  if (pathname !== "/growth") return null;
  // Compatibility routes reuse the same dashboard owners; no data or operation is migrated.
  if (requested === "archive") return <Redirect href="/summary?tab=archive" />;
  if (!child || !workspace) return <PageFrame density="compact" title="關注手冊"><SectionCard>
    <Text>{child ? "正在讀取關注…" : "先選擇孩子。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions} tab={tab} requestedConcernId={route.concernId}
    concernHref={navigation.concernHref} onConcernChange={navigation.selectConcern} onTabChange={navigation.changeTab}
    preparationNavigation={navigation.preparation}
    onTask={openTask}
    onRecord={id => navigation.open(id ? `/care?record=${encodeURIComponent(id)}` : "/care")}
    onHistory={() => navigation.open("/history?category=growth")}
    onChat={() => navigation.open("/chat")}
    onPrepareQuestion={actions.prepareQuestion}
    onPreparationHistory={() => navigation.open({ pathname: "/history", params: { category: "preparations" } })}
    managementTools={<GrowthSuggestionSettings model={workspace.model} actions={workspace.actions} />}
    previewTools={<TaskKnowledgeGrowthCandidates model={workspace.model} actions={workspace.actions} onTask={openTask} />} />;
}
