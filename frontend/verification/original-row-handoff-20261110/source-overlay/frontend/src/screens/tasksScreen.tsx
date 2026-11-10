import { useTasksChoiceSceneBinding } from "../preview/tasks-choice-host/TasksChoiceSceneBinding";
import { useTasksAppliedPresentation } from "../preview/tasks-choice-host/TasksAppliedPresentationProvider";
import { useRoute } from "expo-router/react-navigation";
import { TasksChoiceHostControl, useTasksChoiceHostPreview } from "../preview/tasks-choice-host/TasksChoiceHostControl";
import { useTaskFocusReturn, useTaskCandidatePresentation } from "../navigation/RoutePresentation";
import { parseTaskRoute, serializeTaskRoute, type TaskRouteState } from "../navigation/route-state";
import { useRouteNavigation } from "../navigation/useRouteNavigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { usePathname, useRouter } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useNativeTasksComparePort } from "../preview/NativeTasksComparePort";

export default function TasksPage() {
  const { model, actions, scopeKey, openAgentDraft, chatDraft, setChatDraft } = useProduction();
  const workspace = useTasksWorkspace();
  const choicePreview = useTasksChoiceHostPreview();
  const appliedPresentation = useTasksAppliedPresentation(), nativeRoute = useRoute();
  const candidatePresentation = useTaskCandidatePresentation();
  const taskFocus = useTaskFocusReturn();
  const focusScope = workspace ? `${workspace.model.child.id}:${workspace.model.access}` : null;
  const router = useRouter(), navigate = usePreviewNavigation();
  const route = useRouteNavigation(scopeKey, ["taskId"], "/tasks", { replaceQueryInPlace: true });
  const routeState = parseTaskRoute(route.params), taskId = routeState.taskId;
  const nativePathname = usePathname();
  useNativeTasksComparePort({ pathname: nativePathname, params: route.params, active: route.active,
    dispatch(params, mode, current) {
      let requested = false;
      // Keep Harbour's own active/scope route guard and its existing select/close consumer.
      route.run(() => { if (!current()) return; route.navigate(params, mode, false); requested = true; }, false);
      return requested;
    } });
  const retained = workspace && (workspace.model.draft || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state));
  const activeTaskId = retained && workspace?.model.selected ? workspace.model.selected.id : taskId;
  const requested = useRef("");
  const routeSignature = JSON.stringify(route.params);
  const [closeIntent, setCloseIntent] = useState<{ scope: string | null; route: string; focusToken: number | null } | null>(null);
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
    if (!route.active || closeIntent.scope !== scopeKey || closeIntent.route !== routeSignature) { taskFocus.cancel(closeIntent.focusToken); setCloseIntent(null); return; }
    if (!workspace || workspace.scopeKey !== scopeKey || workspace.model.draft || workspace.model.selected
      || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state)) return;
    // Expo drains imperative navigation later. Wait for the published owner close
    // and form guard cleanup rather than queuing a second removal during discard.
    setCloseIntent(null);
    if (taskId) {
      taskFocus.settled(closeIntent.focusToken, focusScope, taskId);
      route.navigate(serializeTaskRoute({ ...routeState, taskId: null }), "replace", false);
    } else taskFocus.cancel(closeIntent.focusToken);
  }, [closeIntent, route.active, scopeKey, routeSignature, workspace, taskFocus, focusScope]);
  function requestClosePanel() {
    if (!workspace) return;
    const focusToken = taskFocus.detailToken(focusScope, activeTaskId);
    navigate(() => route.run(() => {
      taskFocus.beginClose(focusToken, focusScope, activeTaskId);
      setCloseIntent({ scope: scopeKey, route: routeSignature, focusToken });
      workspace.actions.closePanel();
    }, false), "workspace");
  }
  const routeActions = workspace ? { ...workspace.actions,
    selectTask(id: string, intent: "open" | "toggle" = "open") {
      // A repeated row press uses the same guarded close/focus path as the detail button.
      // Explicit/default opens and a different row retain their existing route behavior.
      if (intent === "toggle" && activeTaskId === id && workspace.model.selected?.id === id) {
        requestClosePanel();
        return;
      }
      const focusToken = taskFocus.originToken(focusScope, id);
      navigate(() => route.run(() => {
        taskFocus.acceptOpen(focusToken, focusScope, id);
        route.navigate(serializeTaskRoute({ ...routeState, taskId: id }), "push", false);
      }, false), "workspace");
    },
    closePanel: requestClosePanel,
  } : null;
  // Route lifetime is not draft ownership; the scoped owner and explicit close own cleanup.
  const viewModel = workspace ? { ...workspace.model, selected: workspace.model.selected?.id === activeTaskId ? workspace.model.selected : null } : null;

  // Candidate host uses the same current viewModel occupied facts as TasksView.
  const headerReadState = viewModel ? viewModel.readState ?? (viewModel.reading ? "loading" : "ready") : "loading";
  const headerOccupied = !viewModel || ["saving", "unknown", "conflict"].includes(viewModel.operation.state)
    || !!viewModel.draft || viewModel.reading || headerReadState === "loading" || headerReadState === "error";
  const sceneRouteIdentity = useMemo(() => ({}), [nativePathname, routeSignature, route.active, scopeKey]);
  const choiceScene = useTasksChoiceSceneBinding({ enabled: choicePreview !== null, workspace, scopeKey,
    routeActive: route.active, routeIdentity: sceneRouteIdentity,
    occupied: headerOccupied || !!viewModel?.loadingMoreTasks });
  if (!route.active) return null;
  return <TasksChoiceHostControl configuration={choicePreview} presentation={candidatePresentation} scene={choiceScene.scene}
    appliedPresentation={appliedPresentation} appliedLeaf={{ nativeRouteKey: nativeRoute.key, bindingInstance: choiceScene.instance }} authorityToken={workspace?.scopeKey ?? ""}
    live={route.active && !!workspace && workspace.scopeKey === scopeKey} occupied={headerOccupied} access={viewModel?.access ?? "lost"}>
    {choice => <>{choice.controls}{workspace ? <TasksView key={workspace.scopeKey} modulePresentation={choice.modulePresentation} taskRowAppearance={choice.rowAppearance} headerActionsHF01={choice.controller} headerActionsHF01AuthorityToken={workspace.scopeKey} headerActionsHF01SceneProps={choice.sceneProps} model={viewModel!} requestedTaskId={activeTaskId} actions={routeActions!} recovery={workspace.recovery} routeState={routeState} onRouteChange={(next: TaskRouteState, mode = "replace") => route.navigate(serializeTaskRoute(next), mode)}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }}
    onHistory={() => navigate(() => router.push("/history?category=tasks"), "workspace")} /> :
    <PageFrame density="compact" title="待辦"><SectionCard><Text>{model.selectedChildId ? "正在讀取事項…" : "先選擇孩子。"}</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>}</>}</TasksChoiceHostControl>;
}
