import { parseTaskRoute, serializeTaskRoute, type TaskRouteState } from "../navigation/route-state";
import { useScopedRouteState } from "../navigation/useScopedRouteState";
import { useGuardedRoute } from "../navigation/useGuardedRoute";
import { usePrivateQuery } from "../navigation/usePrivateQuery";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { TasksView } from "../components/tasks/TasksView";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";

export default function TasksPage() {
  const { owner, model, actions, scopeKey, identityKey, openAgentDraft, chatDraft, setChatDraft } = useProduction();
  const workspace = useTasksWorkspace(), latest = useRef(workspace); latest.current = workspace;
  const router = useRouter(), pathname = usePathname();
  const params = useLocalSearchParams();
  const route = parseTaskRoute(params), go = useGuardedRoute(scopeKey, owner);
  const [query, setQuery] = usePrivateQuery(workspace?.model.access === "lost" ? null : scopeKey, "/tasks");
  const currentRoute = useScopedRouteState(scopeKey, "/tasks", route, parseTaskRoute({}), value => ({ pathname: "/tasks", params: serializeTaskRoute(value) }));
  const routeSignature = `${pathname}:${JSON.stringify(params)}`;
  const [closeIntent, setCloseIntent] = useState<{ scopeKey: string | null; identityKey: string | null; routeSignature: string; next: TaskRouteState; mode: "push" | "replace"; original: NonNullable<typeof workspace>["model"] } | null>(null);
  const emitted = useRef<typeof closeIntent>(null);
  const recoveryOwnsSelection = !!workspace?.model.draft || !!workspace && ["saving", "unknown", "conflict"].includes(workspace.model.operation.state);
  const recoveryId = workspace?.model.selected?.id ?? workspace?.model.draft?.basis?.id ?? null;
  const visibleRoute = recoveryOwnsSelection ? { ...currentRoute, taskId: recoveryId } : currentRoute;
  useEffect(() => {
    const snapshot = owner.getSnapshot();
    if (closeIntent || pathname !== "/tasks" || !workspace || snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey) return;
    if (recoveryOwnsSelection) {
      if (currentRoute.taskId !== recoveryId) router.replace({ pathname: "/tasks", params: serializeTaskRoute(visibleRoute) });
      return;
    }
    const id = currentRoute.taskId;
    if (!id) { if (workspace.model.selected) workspace.actions.closePanel(); return; }
    if (workspace.model.selected?.id === id) return;
    const receipt = workspace.model.detailRead;
    if (receipt?.id === id && ["loading", "error"].includes(receipt.state)) return;
    workspace.actions.selectTask(id);
  }, [scopeKey, currentRoute.taskId, recoveryOwnsSelection, recoveryId, workspace?.model.selected?.id, workspace?.model.detailRead, pathname, closeIntent, identityKey]);
  useEffect(() => {
    if (!closeIntent) return;
    const snapshot = owner.getSnapshot();
    if (pathname !== "/tasks" || closeIntent.scopeKey !== scopeKey || closeIntent.identityKey !== identityKey
      || snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey || closeIntent.routeSignature !== routeSignature) {
      // A newer URL must not be overwritten by the still-published old draft.
      // Wait for that original snapshot to retire, but never dispatch this intent.
      if (pathname === "/tasks" && closeIntent.scopeKey === scopeKey && closeIntent.identityKey === identityKey
        && snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey
        && workspace?.model === closeIntent.original && (closeIntent.original.draft || closeIntent.original.selected)) return;
      emitted.current = null; setCloseIntent(null); return;
    }
    if (!workspace || workspace.scopeKey !== scopeKey) return;
    const value = workspace.model;
    if (value.draft || value.selected || ["saving", "unknown", "conflict"].includes(value.operation.state)) {
      // Do not consume a newer editor/recovery while awaiting the original close.
      if (value !== closeIntent.original && (value.draft !== closeIntent.original.draft || value.selected !== closeIntent.original.selected || value.operation !== closeIntent.original.operation)) {
        emitted.current = null; setCloseIntent(null);
      }
      return;
    }
    if (emitted.current === closeIntent) return;
    if (JSON.stringify(serializeTaskRoute(closeIntent.next)) === JSON.stringify(serializeTaskRoute(currentRoute))) {
      setCloseIntent(null); return; // A new form without an ID needs no URL write.
    }
    // The original owner is now published closed and child form guards have
    // cleaned up. Expo drains its imperative queue after this committed state.
    emitted.current = closeIntent;
    router[closeIntent.mode]({ pathname: "/tasks", params: serializeTaskRoute(closeIntent.next) });
    // Keep the resolver suspended until the URL acknowledges this navigation.
  }, [closeIntent, workspace, pathname, scopeKey, identityKey, routeSignature]);
  function changeRoute(next: TaskRouteState, mode: "push" | "replace" = "replace") {
    go({ pathname: "/tasks", params: serializeTaskRoute(next) }, mode, "navigation", () => {
      const value = latest.current;
      if (!value || value.scopeKey !== scopeKey || ["saving", "unknown"].includes(value.model.operation.state)) return false;
      if (value.actions.closePanel() === false) return false;
      emitted.current = null;
      setCloseIntent({ scopeKey, identityKey, routeSignature, next, mode, original: value.model });
      return false; // Acceptance is not the owner/guard publication acknowledgement.
    });
  }
  if (pathname !== "/tasks") return null;
  return workspace ? <TasksView key={workspace.scopeKey} model={{ ...workspace.model, selected: recoveryOwnsSelection || workspace.model.selected?.id === currentRoute.taskId ? workspace.model.selected : null }} actions={{ ...workspace.actions,
    selectTask: (id, intent) => changeRoute({ ...currentRoute, taskId: intent === "toggle" && currentRoute.taskId === id ? null : id }, "push"),
    closePanel: () => changeRoute({ ...currentRoute, taskId: null }, "replace"),
  }} recovery={workspace.recovery} route={visibleRoute} onRouteChange={changeRoute} query={query} onQueryChange={setQuery}
    onAgent={() => { if (!chatDraft.trim()) setChatDraft("想請你幫我記低一項安排："); openAgentDraft(true); }}
    onHistory={() => go("/history?category=tasks")} /> :
    <PageFrame density="compact" title="待辦"><SectionCard><Text>{model.selectedChildId ? "正在讀取事項…" : "先選擇孩子。"}</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
