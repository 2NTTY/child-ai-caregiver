import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { CareRecordsViewModel, CareReviewTab } from "../care-view-model";
import type { CareWorkspaceValue } from "../workspaces/CareWorkspace";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parseCareRoute, serializeCareRoute } from "./route-state";

type Route = ReturnType<typeof parseCareRoute>;
const key = (route: Route) => JSON.stringify(serializeCareRoute(route));
const occupied = (model: CareRecordsViewModel) => !!model.draft || !!model.deletion || ["saving", "unknown", "conflict"].includes(model.operation.state);
const selectedId = (model: CareRecordsViewModel) => model.detail?.record.id ?? model.draft?.basis?.id ?? model.deletion?.basis.id ?? null;
export type CareRecordNavigation = { tab: CareReviewTab; recordId: string | null; waiting: boolean; href(id: string): Href; open(id: string): void; close(): void; retry(): void; changeTab(tab: CareReviewTab): void };

/** Presentation only. Original Care actions own read admission, drafts and receipts. */
export function useCareRouteNavigation(scope: string | null, workspace: CareWorkspaceValue | null, pending: boolean, canCreate: boolean): CareRecordNavigation {
  const route = parseCareRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), authority = useNavigationAuthority(), leave = usePreviewNavigation();
  const active = pathname === "/care" && focused;
  const mounted = useRef(true), observedScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = observedScope.current !== undefined && observedScope.current !== scope;
  const current = useRef({ route, scope, workspace, active, pending }); current.current = { route, scope, workspace, active, pending };
  const requested = useRef<{ scope: string; id: string; model: object } | null>(null);
  const closing = useRef<{ scope: string; basis: string; model: object; next: Route; push: boolean } | null>(null);
  const composed = useRef(""), previousDraft = useRef(workspace?.model.draft ?? null);
  const ownBusy = !!workspace && occupied(workspace.model), ownerId = workspace ? selectedId(workspace.model) : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis = key(route)) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key
      && current.current.scope === scope && (!authority || authority.isCurrent())
      && key(parseCareRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis;
  }
  const replace = (next: Route) => router.setParams(serializeCareRoute(next));
  function finishClose(next: Route, push: boolean) {
    const live = current.current.workspace;
    if (!admitted() || !workspace || !live || current.current.pending || ["saving", "unknown"].includes(live.model.operation.state)
      || !workspace.model.draft && !!live.model.draft || !workspace.model.deletion && !!live.model.deletion) return;
    if (!workspace.model.detail && !workspace.model.draft && !workspace.model.deletion && !workspace.model.detailRead && workspace.model.operation.state === "none") {
      closing.current = null;
      if (push) router.push({ pathname: "/care", params: serializeCareRoute(next) }); else if (key(next) !== key(route)) replace(next);
      return;
    }
    closing.current = { scope: workspace.scopeKey, basis: key(route), model: workspace.model, next, push };
    workspace.actions.closePanel();
  }
  useEffect(() => {
    if (!admitted()) return;
    if (scopeChanged) {
      observedScope.current = scope; requested.current = null; closing.current = null; composed.current = ""; previousDraft.current = null;
      if (route.recordId || route.compose) replace({ ...route, recordId: null, compose: null });
      return;
    }
    if (scope !== null || observedScope.current !== undefined) observedScope.current = scope;
    if (!workspace || workspace.scopeKey !== scope) return;
    const model = workspace.model, close = closing.current;
    if (close) {
      if (close.scope !== scope || close.basis !== key(route)) closing.current = null;
      else {
        if (model === close.model) return;
        if (model.detail || model.draft || model.deletion || model.operation.state !== "none") closing.current = null;
        else {
          closing.current = null; requested.current = null; previousDraft.current = null;
          if (close.push) router.push({ pathname: "/care", params: serializeCareRoute(close.next) }); else if (key(close.next) !== key(route)) replace(close.next);
          return;
        }
      }
    }
    const saved = previousDraft.current && !model.draft && model.operation.state === "saved" && model.detail;
    previousDraft.current = model.draft;
    if (saved) { replace({ ...route, tab: "recorded", recordId: saved.record.id, compose: null }); return; }
    if (ownBusy) {
      requested.current = null;
      if (route.recordId !== ownerId) replace({ ...route, tab: ownerId ? "recorded" : route.tab, recordId: ownerId });
      return;
    }
    if (pending) return; // The original shared Care/Profile attempt already refuses a new read.
    if (!route.recordId) {
      requested.current = null;
      // Returning to the index hides readonly context; it is not a discard action.
      const composeKey = `${scope}:${route.compose}`;
      if (route.compose && composed.current !== composeKey && canCreate && model.online && model.access === "editable") {
        composed.current = composeKey; workspace.actions.startCreate(route.compose);
      }
      return;
    }
    if (ownerId === route.recordId || model.detailRead?.id === route.recordId && model.detailRead.state !== "ready") return;
    const last = requested.current;
    if (last?.scope === scope && last.id === route.recordId && last.model === model) return;
    requested.current = { scope, id: route.recordId, model };
    workspace.actions.openRecord(route.recordId);
  }, [route, scope, scopeChanged, workspace, active, pending, ownBusy, ownerId, canCreate, authority, navigation, router]);
  return {
    tab: ownerId && ownBusy ? "recorded" : route.tab,
    recordId: scopeChanged ? null : ownBusy ? ownerId : route.recordId, waiting: pending && !ownBusy,
    href: id => ({ pathname: "/care", params: serializeCareRoute({ ...route, tab: "recorded", recordId: id, compose: null }) }),
    open(id) {
      if (!admitted() || !workspace || ownBusy || pending) return;
      leave(() => {
        const live = current.current;
        if (!admitted() || !live.workspace || occupied(live.workspace.model) || live.pending) return;
        closing.current = null; requested.current = null;
        if (live.route.recordId === id) { live.workspace.actions.openRecord(id); return; }
        router.push({ pathname: "/care", params: serializeCareRoute({ ...live.route, tab: "recorded", recordId: id, compose: null }) });
      }, "workspace");
    },
    close: () => finishClose({ ...route, recordId: null, compose: null }, false),
    retry() { if (admitted() && workspace && !ownBusy && !pending && workspace.model.online && route.recordId) workspace.actions.openRecord(route.recordId); },
    changeTab(tab) {
      if (!admitted() || !workspace || ownBusy || pending || tab === route.tab) return;
      leave(() => { if (!admitted() || !current.current.workspace || occupied(current.current.workspace.model) || current.current.pending) return;
        finishClose({ ...route, tab, recordId: null, compose: null }, true);
      }, "workspace");
    },
  };
}
