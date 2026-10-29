import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { CareWorkspaceValue } from "../workspaces/CareWorkspace";
import { useNavigationAuthority } from "./NavigationAuthority";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

type HistoryRoute = ReturnType<typeof parseHistoryRoute>;
const key = (route: HistoryRoute) => JSON.stringify(serializeHistoryRoute(route));
export type HistoryCareNavigation = { recordId: string | null; waiting: boolean; href(id: string): Href; open(id: string, onAccepted?: () => void): void; close(): void; retry(): void; closeForNavigation(): void };

/** History owns its URL; the original Care owner remains the sole reader/write owner. */
export function useHistoryCareRoute(scope: string | null, workspace: CareWorkspaceValue | null, pending: boolean): HistoryCareNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), authority = useNavigationAuthority(), leave = usePreviewNavigation();
  const active = pathname === "/history" && route.category === "care" && focused;
  const mounted = useRef(true), observedScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = observedScope.current !== undefined && observedScope.current !== scope;
  const current = useRef({ route, scope, workspace, active, pending }); current.current = { route, scope, workspace, active, pending };
  const requested = useRef<{ scope: string; id: string; model: object } | null>(null);
  const closing = useRef<{ scope: string; basis: string; model: object; target: "index" | "navigation" } | null>(null);
  const deletion = useRef<{ scope: string; basis: string; id: string } | null>(null);
  const occupied = !!workspace && (!!workspace.model.draft || !!workspace.model.deletion || ["saving", "unknown", "conflict"].includes(workspace.model.operation.state));
  const ownerId = workspace?.model.detail?.record.id ?? workspace?.model.draft?.basis?.id ?? workspace?.model.deletion?.basis.id ?? null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis = key(route)) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key
      && current.current.scope === scope && (!authority || authority.isCurrent())
      && key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis;
  }
  function replaceId(id: string | null) { router.setParams(serializeHistoryRoute({ ...current.current.route, recordId: id })); }
  function close(target: "index" | "navigation") {
    if (!admitted() || !workspace) return;
    // FormDialog/category owns guard admission. A captured readonly close cannot
    // discard a draft/deletion that appeared after that request.
    const live = current.current.workspace;
    if (!live || current.current.pending || ["saving", "unknown"].includes(live.model.operation.state)
      || !workspace.model.draft && !!live.model.draft || !workspace.model.deletion && !!live.model.deletion) return;
    if (!workspace.model.detail && !workspace.model.draft && !workspace.model.deletion && !workspace.model.detailRead && workspace.model.operation.state === "none") {
      closing.current = null;
      if (target === "index" && route.recordId) replaceId(null);
      return;
    }
    closing.current = { scope: workspace.scopeKey, basis: key(route), model: workspace.model, target };
    workspace.actions.closePanel();
  }
  useEffect(() => {
    if (!admitted()) return;
    if (scopeChanged) {
      observedScope.current = scope; requested.current = null; closing.current = null; deletion.current = null;
      if (route.recordId !== null) replaceId(null);
      return;
    }
    if (scope !== null || observedScope.current !== undefined) observedScope.current = scope;
    if (!workspace || workspace.scopeKey !== scope) return;
    if (workspace.model.deletion) deletion.current = { scope: workspace.scopeKey, basis: key(route), id: workspace.model.deletion.basis.id };
    else if (deletion.current) {
      const original = deletion.current; deletion.current = null;
      if (original.scope === scope && original.basis === key(route) && original.id === route.recordId
        && workspace.model.operation.state === "saved" && workspace.model.operation.kind === "delete") {
        requested.current = null; closing.current = null; replaceId(null); return;
      }
    }
    const close = closing.current;
    if (close) {
      if (close.scope !== scope || close.basis !== key(route)) closing.current = null;
      else {
        if (workspace.model === close.model) return;
        if (workspace.model.detail || workspace.model.draft || workspace.model.deletion) { closing.current = null; }
        else if (close.target === "navigation") return; // The category/filter commits its own complete URL.
        else {
          closing.current = null; requested.current = null;
          if (route.recordId !== null) replaceId(null);
          return;
        }
      }
    }
    if (occupied) {
      requested.current = null;
      if (route.recordId !== ownerId) replaceId(ownerId);
      return;
    }
    if (pending) return; // The original shared Care/Profile attempt owns admission.
    if (!route.recordId) {
      requested.current = null;
      // A pure return to the index keeps readonly owner context. Explicit Close
      // and guarded filter/category changes still call the original closePanel.
      return;
    }
    if (ownerId === route.recordId || workspace.model.detailRead?.id === route.recordId && workspace.model.detailRead.state !== "ready") return;
    const last = requested.current;
    if (last?.scope === scope && last.id === route.recordId && last.model === workspace.model) return;
    requested.current = { scope, id: route.recordId, model: workspace.model };
    workspace.actions.openRecord(route.recordId);
  }, [route, scope, scopeChanged, active, workspace, ownerId, occupied, pending, authority, navigation, router]);
  return {
    recordId: scopeChanged ? null : occupied ? ownerId : route.recordId, waiting: pending && !occupied,
    href: id => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "care", recordId: id }) }),
    open(id, onAccepted) {
      if (!admitted() || occupied || pending) return;
      leave(() => {
        const live = current.current.workspace;
        if (!admitted() || !live || current.current.pending || live.model.draft || live.model.deletion
          || ["saving", "unknown", "conflict"].includes(live.model.operation.state)) return;
        onAccepted?.(); closing.current = null; requested.current = null;
        if (current.current.route.recordId === id) live.actions.openRecord(id);
        else router.push({ pathname: "/history", params: serializeHistoryRoute({ ...current.current.route, recordId: id }) });
      }, "workspace");
    },
    close: () => close("index"), closeForNavigation: () => close("navigation"),
    retry() { if (admitted() && workspace && !occupied && !pending && workspace.model.online && route.recordId) workspace.actions.openRecord(route.recordId); },
  };
}
