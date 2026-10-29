import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { TasksWorkspaceValue } from "../workspaces/TasksWorkspace";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

type HistoryRoute = ReturnType<typeof parseHistoryRoute>;
const key = (route: HistoryRoute) => JSON.stringify(serializeHistoryRoute(route));
export type HistoryTaskNavigation = { taskId: string | null; href(id: string): Href; close(): void; retry(): void; closeForNavigation(): void };

/** History owns its URL; the original Task owner remains the sole reader/write owner. */
export function useHistoryTaskRoute(scope: string | null, workspace: TasksWorkspaceValue | null): HistoryTaskNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), authority = useNavigationAuthority();
  const active = pathname === "/history" && route.category === "tasks" && focused;
  const mounted = useRef(true), observedScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = observedScope.current !== undefined && observedScope.current !== scope;
  const current = useRef({ route, scope, workspace, active }); current.current = { route, scope, workspace, active };
  const requested = useRef<{ scope: string; id: string; model: object } | null>(null);
  const closing = useRef<{ scope: string; basis: string; model: object; target: "index" | "navigation" } | null>(null);
  const occupied = !!workspace && (!!workspace.model.draft || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state));
  const ownerId = workspace?.model.selected?.id ?? workspace?.model.draft?.basis?.id ?? null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis = key(route)) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key
      && current.current.scope === scope && (!authority || authority.isCurrent())
      && key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis;
  }
  function replaceId(id: string | null) { router.setParams(serializeHistoryRoute({ ...current.current.route, taskId: id })); }
  function close(target: "index" | "navigation") {
    if (!admitted() || !workspace) return;
    // The filter/category caller already owns its guard. Local readonly dismissal
    // must not discard this owner's draft or unresolved operation.
    if (target === "index" && occupied) return;
    if (!workspace.model.selected && !workspace.model.draft && workspace.model.operation.state === "none") {
      closing.current = null;
      if (target === "index" && route.taskId) replaceId(null);
      return;
    }
    closing.current = { scope: workspace.scopeKey, basis: key(route), model: workspace.model, target };
    workspace.actions.closePanel();
  }
  useEffect(() => {
    if (!admitted()) return;
    if (scopeChanged) {
      observedScope.current = scope; requested.current = null; closing.current = null;
      if (route.taskId !== null) replaceId(null);
      return;
    }
    if (scope !== null || observedScope.current !== undefined) observedScope.current = scope;
    if (!workspace || workspace.scopeKey !== scope) return;
    const close = closing.current;
    if (close) {
      if (close.scope !== scope || close.basis !== key(route)) closing.current = null;
      else {
        if (workspace.model === close.model) return;
        if (workspace.model.selected || workspace.model.draft) { closing.current = null; }
        else if (close.target === "navigation") return; // The category/filter commits its own complete URL.
        else {
          closing.current = null; requested.current = null;
          if (route.taskId !== null) replaceId(null);
          return;
        }
      }
    }
    if (occupied) {
      requested.current = null;
      if (route.taskId !== ownerId) replaceId(ownerId);
      return;
    }
    if (!route.taskId) {
      requested.current = null;
      // A pure return to the index keeps readonly owner context. Explicit Close
      // and guarded filter/category changes still call the original closePanel.
      return;
    }
    if (ownerId === route.taskId || workspace.model.detailRead?.id === route.taskId || workspace.model.reading) return;
    const last = requested.current;
    if (last?.scope === scope && last.id === route.taskId && last.model === workspace.model) return;
    requested.current = { scope, id: route.taskId, model: workspace.model };
    workspace.actions.selectTask(route.taskId);
  }, [route, scope, scopeChanged, active, workspace, ownerId, occupied, authority, navigation, router]);
  return {
    taskId: scopeChanged ? null : occupied ? ownerId : route.taskId,
    href: id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "tasks", taskId: id }) }),
    close: () => close("index"), closeForNavigation: () => close("navigation"),
    retry() { if (admitted() && workspace && !occupied && !workspace.model.reading && workspace.model.online && route.taskId) workspace.actions.selectTask(route.taskId); },
  };
}
