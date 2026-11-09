import { useRouteNavigation } from "../navigation/useRouteNavigation";
import { parseGrowthRoute, serializeGrowthRoute } from "../navigation/route-state";
import { useEffect, useRef } from "react";
import { Redirect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { TaskKnowledgeGrowthCandidates, GrowthSuggestionSettings } from "../production/TaskKnowledgeGrowthCandidates";
import { useGrowthWorkspace } from "../workspaces/GrowthWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { usePreparationWorkspace } from "../workspaces/PreparationWorkspace";
import { GrowthView } from "../components/growth/GrowthView";
import { AppButton, SectionCard } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

export function GrowthScreen() {
  const { model, actions, scopeKey } = useProduction(), workspace = useGrowthWorkspace(), tasks = useTasksWorkspace();
  const preparations = usePreparationWorkspace();
  const route = useRouteNavigation(scopeKey, ["concernId","documentId"], "/growth");
  const requested = route.params.tab;
  const routeState = parseGrowthRoute(route.params), tab = routeState.tab;
  const router = useRouter(), navigate = usePreviewNavigation(), pathname = usePathname();
  const current = useRef({ scopeKey, pathname, requested, mounted: true });
  current.current = { scopeKey, pathname, requested, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  function guarded(action: () => void, intent: "navigation" | "workspace" = "workspace") {
    navigate(() => {
      const live = current.current;
      if (!live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.requested !== requested) return;
      action();
    }, intent);
  }
  const child = model.children.find(item => item.id === model.selectedChildId);
  const openTask = (id: string) => guarded(() => { router.push({pathname:"/tasks",params:{taskId:id}}); });
  if (pathname !== "/growth") return null;
  // Compatibility routes reuse the same dashboard owners; no data or operation is migrated.
  if (requested === "archive") return <Redirect href="/summary?tab=archive" />;
  if (!child || !workspace) return <PageFrame density="compact" title="關注"><SectionCard>
    <Text>{child ? "正在讀取關注…" : "先選擇孩子。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions} tab={tab}
    requestedDocumentId={routeState.documentId} onDocumentChange={(documentId,replace=false)=>route.navigate(serializeGrowthRoute({...routeState,documentId}),replace?"replace":"push",!replace)}
    selectedConcernId={routeState.concernId} onConcernChange={concernId => route.navigate(serializeGrowthRoute({...routeState,concernId}))}
    onTabChange={next => { if (next !== tab) route.navigate(serializeGrowthRoute({...routeState,tab:next})); }}
    onTask={openTask}
    onRecord={id => guarded(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))}
    onHistory={() => guarded(() => router.push("/history?category=growth"))}
    onChat={() => guarded(() => router.push("/chat"))}
    onPrepareQuestion={actions.prepareQuestion}
    onPreparationHistory={() => guarded(() => router.push({ pathname: "/history", params: { category: "preparations" } }))}
    managementTools={<GrowthSuggestionSettings model={workspace.model} actions={workspace.actions} />}
    previewTools={<TaskKnowledgeGrowthCandidates model={workspace.model} actions={workspace.actions} onTask={openTask} />} />;
}
