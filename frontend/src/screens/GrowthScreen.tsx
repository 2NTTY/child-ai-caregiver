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
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const requested = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const tab = requested === "preparation" ? "preparation" : "concerns";
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
  const openTask = (id: string) => guarded(() => { tasks?.actions.selectTask(id); router.push("/tasks"); });
  if (pathname !== "/growth") return null;
  // Compatibility routes reuse the same dashboard owners; no data or operation is migrated.
  if (requested === "archive") return <Redirect href="/summary?tab=archive" />;
  if (!child || !workspace) return <PageFrame density="compact" title="關注"><SectionCard>
    <Text>{child ? "正在讀取關注…" : "先選擇孩子。"}</Text>
    <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
  </SectionCard></PageFrame>;
  return <GrowthView key={workspace.scopeKey} model={workspace.model} actions={workspace.actions} tab={tab}
    onTabChange={next => { if (next !== tab) guarded(() => { preparations?.actions.closeDocument(); router.setParams({ tab: next }); }, "workspace"); }}
    onTask={openTask}
    onRecord={id => guarded(() => router.push(id ? `/care?record=${encodeURIComponent(id)}` : "/care"))}
    onHistory={() => guarded(() => router.push("/history?category=growth"))}
    onChat={() => guarded(() => router.push("/chat"))}
    onPrepareQuestion={actions.prepareQuestion}
    onPreparationHistory={() => guarded(() => router.push({ pathname: "/history", params: { category: "preparations" } }))}
    managementTools={<GrowthSuggestionSettings model={workspace.model} actions={workspace.actions} />}
    previewTools={<TaskKnowledgeGrowthCandidates model={workspace.model} actions={workspace.actions} onTask={openTask} />} />;
}
