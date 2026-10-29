import { parseTaskRoute, serializeTaskRoute, type TaskRouteState } from "../navigation/route-state";
import { useRouteNavigation } from "../navigation/useRouteNavigation";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useRouter } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

export default function TasksPage() {
  const { model, actions, scopeKey, openAgentDraft, chatDraft, setChatDraft } = useProduction();
  const workspace = useTasksWorkspace();
  const router = useRouter(), navigate = usePreviewNavigation();
  const route = useRouteNavigation(scopeKey, ["taskId"], "/tasks");
  const routeState = parseTaskRoute(route.params), taskId = routeState.taskId;
  const retained = workspace && (workspace.model.draft || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state));
  const activeTaskId = retained && workspace?.model.selected ? workspace.model.selected.id : taskId;
  const requested = useRef("");
  const routeSignature = JSON.stringify(route.params);
  const [closeIntent, setCloseIntent] = useState<{ scope: string | null; route: string } | null>(null);
  useEffect(() => {
    if (route.active && activeTaskId !== taskId) route.navigate(serializeTaskRoute({ ...routeState, taskId: activeTaskId }), "replace", false);
  }, [activeTaskId, taskId, route.active]);
  useEffect(() => {
    if (!route.active || !workspace || workspace.scopeKey !== scopeKey) return;
    const key = `${workspace.scopeKey}:${activeTaskId ?? "list"}`;
    if (requested.current === key) return;
    requested.current = key;
    if (activeTaskId) workspace.actions.selectTask(activeTaskId, "open");
    else if (workspace.model.selected && !workspace.model.draft && !["saving", "unknown", "conflict"].includes(workspace.model.operation.state)) workspace.actions.closePanel();
  }, [workspace?.scopeKey, scopeKey, activeTaskId, workspace, route.active]);
  useEffect(() => {
    if (!closeIntent) return;
    if (!route.active || closeIntent.scope !== scopeKey || closeIntent.route !== routeSignature) { setCloseIntent(null); return; }
    if (!workspace || workspace.scopeKey !== scopeKey || workspace.model.draft || workspace.model.selected
      || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state)) return;
    // Expo drains imperative navigation later. Wait for the published owner close
    // and form guard cleanup rather than queuing a second removal during discard.
    setCloseIntent(null);
    if (taskId) route.navigate(serializeTaskRoute({ ...routeState, taskId: null }), "replace", false);
  }, [closeIntent, route.active, scopeKey, routeSignature, workspace]);
  const routeActions = workspace ? { ...workspace.actions,
    selectTask(id: string) { route.navigate(serializeTaskRoute({ ...routeState, taskId: id })); },
    closePanel() { navigate(() => route.run(() => { setCloseIntent({ scope: scopeKey, route: routeSignature }); workspace.actions.closePanel(); }, false), "workspace"); },
  } : null;
  // Route lifetime is not draft ownership; the scoped owner and explicit close own cleanup.
  const viewModel = workspace ? { ...workspace.model, selected: workspace.model.selected?.id === activeTaskId ? workspace.model.selected : null } : null;
  if (!route.active) return null;
  return workspace ? <TasksView key={workspace.scopeKey} model={viewModel!} requestedTaskId={activeTaskId} actions={routeActions!} recovery={workspace.recovery} routeState={routeState} onRouteChange={(next: TaskRouteState, mode = "replace") => route.navigate(serializeTaskRoute(next), mode)}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }}
    onHistory={() => navigate(() => router.push("/history?category=tasks"), "workspace")} /> :
    <PageFrame density="compact" title="待辦"><SectionCard><Text>{model.selectedChildId ? "正在讀取事項…" : "先選擇孩子。"}</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
