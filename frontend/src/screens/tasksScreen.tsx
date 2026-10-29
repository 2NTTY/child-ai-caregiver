import { useCallback, useEffect, useRef } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from "expo-router";
import { useFocusEffect, useIsFocused } from "expo-router/react-navigation";
import { useNavigationAuthority } from "../navigation/NavigationAuthority";
import { parseTaskRoute, serializeTaskRoute, type TaskRouteState } from "../navigation/route-state";

export default function TasksPage() {
  const { model, actions, openAgentDraft, chatDraft, setChatDraft, scopeKey: productionScope } = useProduction();
  const workspace = useTasksWorkspace();
  const router = useRouter(), authority = useNavigationAuthority();
  const navigation = useNavigation(), pathname = usePathname(), focused = useIsFocused();
  const active = focused && pathname === "/tasks";
  const latest = useRef({ workspace, authority });
  if (active) latest.current = { workspace, authority };
  const parsed = parseTaskRoute(useLocalSearchParams());
  const scope = productionScope ?? workspace?.scopeKey ?? null;
  // This screen survives the keyed reader, so a child transition cannot inherit its URL target.
  const observedScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = observedScope.current !== undefined && observedScope.current !== scope;
  const route = scopeChanged ? { ...parsed, taskId: null } : parsed;
  const routeRef = useRef(route); routeRef.current = route;
  const taskId = route.taskId;
  const previousRoute = useRef<{ scope: string | null; id: string | null } | null>(null);
  const requested = useRef<{ scope: string; id: string | null; model: object } | null>(null);
  const closing = useRef<{ scope: string; model: object; routeKey: string } | null>(null);
  const opening = useRef<{ scope: string; routeKey: string; selectedBefore: string | null } | null>(null);
  const observedCreate = useRef<string | null>(null);
  const occupied = !!workspace && (!!workspace.model.draft || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state));
  function updateRoute(patch: Partial<TaskRouteState>) {
    if (!active || !navigation.isFocused() || authority && !authority.isCurrent()) return;
    const chapterChange = patch.tab !== undefined && patch.tab !== routeRef.current.tab;
    routeRef.current = { ...routeRef.current, ...patch };
    const params = serializeTaskRoute(routeRef.current);
    if (chapterChange) router.push({ pathname: "/tasks", params }); else router.setParams(params);
  }
  function closePanel() {
    if (!active || !navigation.isFocused() || !workspace || authority && !authority.isCurrent() || ["saving", "unknown"].includes(workspace.model.operation.state)) return;
    opening.current = null;
    closing.current = { scope: workspace.scopeKey, model: workspace.model, routeKey: JSON.stringify(serializeTaskRoute(routeRef.current)) };
    workspace.actions.closePanel();
  }
  useEffect(() => {
    const createKey = workspace?.model.draft?.mode === "create" ? workspace.model.draft.key : null;
    const newCreate = createKey !== null && observedCreate.current !== createKey;
    observedCreate.current = createKey;
    if (!active || !navigation.isFocused() || authority && !authority.isCurrent()) { opening.current = null; return; }
    if (scopeChanged) {
      observedScope.current = scope;
      previousRoute.current = { scope, id: null }; requested.current = null; closing.current = null; opening.current = null;
      if (parsed.taskId) router.setParams({ taskId: undefined });
      return;
    }
    if (scope !== null || observedScope.current !== undefined) observedScope.current = scope;
    if (!workspace) return;
    const routeKey = JSON.stringify(serializeTaskRoute(route));
    if (opening.current && (opening.current.scope !== workspace.scopeKey || opening.current.routeKey !== routeKey)) opening.current = null;
    if (newCreate && createKey) opening.current = { scope: workspace.scopeKey, routeKey, selectedBefore: workspace.model.selected?.id ?? null };
    const ownerId = workspace.model.selected?.id ?? workspace.model.draft?.basis?.id ?? null;
    const close = closing.current;
    if (close?.scope === workspace.scopeKey) {
      // The owner publication acknowledges only the route/selection that closed.
      // A newer URL in the same batch keeps its intent and is resolved below.
      if (close.routeKey !== JSON.stringify(serializeTaskRoute(route))) closing.current = null;
      else {
        if (workspace.model === close.model) return;
        closing.current = null;
        if (!workspace.model.selected && !workspace.model.draft) {
          requested.current = null; previousRoute.current = { scope, id: null };
          if (taskId) router.setParams({ taskId: undefined });
          return;
        }
      }
    }
    // A blocked deep link is rejected, not queued over the original pending operation.
    if (occupied) {
      requested.current = null; previousRoute.current = { scope, id: ownerId };
      if (taskId !== ownerId) {
        if (opening.current) opening.current.routeKey = JSON.stringify(serializeTaskRoute({ ...route, taskId: ownerId }));
        router.setParams({ taskId: ownerId ?? undefined });
      }
      return;
    }
    // A mounted index is an incoming URL intent, not evidence of a new owner selection.
    // Href selection stays URL-first; only this create draft's confirmed new result may open it.
    const intent = opening.current;
    opening.current = null;
    const accepted = intent && ownerId && workspace.model.operation.state === "saved" && intent.selectedBefore !== ownerId;
    if (accepted) {
      requested.current = null; previousRoute.current = { scope, id: ownerId };
      if (taskId !== ownerId) router.setParams({ taskId: ownerId });
      return;
    }
    const previous = previousRoute.current;
    previousRoute.current = { scope, id: taskId };
    if (!taskId) {
      if (previous?.scope === scope && previous.id) {
        requested.current = { scope: workspace.scopeKey, id: null, model: workspace.model };
        workspace.actions.closePanel();
      } else if (!workspace.model.selected) requested.current = null;
      return;
    }
    const detailRead = workspace.model.detailRead;
    // Loading/error receipts suppress implicit retries; a closed ready read is not a selection.
    const unresolvedRead = detailRead?.id === taskId && (detailRead.state === "loading" || detailRead.state === "error");
    if (ownerId === taskId || unresolvedRead) { requested.current = null; return; }
    const last = requested.current;
    if (last?.scope === workspace.scopeKey && last.id === taskId && last.model === workspace.model) return;
    requested.current = { scope: workspace.scopeKey, id: taskId, model: workspace.model };
    workspace.actions.selectTask(taskId);
  }, [active, navigation, scope, scopeChanged, parsed.taskId, taskId, occupied, workspace, authority, router]);
  useFocusEffect(useCallback(() => () => {
    // A React effect replay is not an accepted route departure.
    if (navigation.isFocused()) return;
    opening.current = null;
    const { workspace: value, authority: admission } = latest.current;
    if (admission && !admission.isCurrent()) return;
    if (value && !["saving", "unknown"].includes(value.model.operation.state)) value.actions.closePanel();
  }, [navigation]));
  if (!active) return null;
  return workspace ? <TasksView key={workspace.scopeKey} routeState={route} onRouteStateChange={updateRoute}
    taskHref={id => ({ pathname: "/tasks", params: { ...serializeTaskRoute(route), taskId: id } })}
    model={!occupied && workspace.model.selected?.id !== taskId ? { ...workspace.model, selected: null } : workspace.model}
    actions={workspace.actions} onClosePanel={closePanel} recovery={workspace.recovery}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }} /> :
    <PageFrame density="compact" title="待辦與安排"><SectionCard><Text>{model.selectedChildId ? "正在讀取事項…" : "先選擇孩子。"}</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
