import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { archiveReadingView, type ArchiveFilter } from "../components/growth/growth-archive-view";
import { useNavigationAuthority } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseSummaryRoute, serializeSummaryRoute } from "./route-state";

type SummaryRoute = ReturnType<typeof parseSummaryRoute>;
export type SummaryArchiveNavigation = {
  periodId: string | null; filter: ArchiveFilter;
  href(periodId: string): Href;
  select(periodId: string): boolean;
  selectVersion(documentId: string, snapshotId: string, snapshotVersion: number): boolean;
  setFilter(filter: ArchiveFilter): void;
};
const key = (route: SummaryRoute) => JSON.stringify(serializeSummaryRoute(route));

/** Thin read-only view state over the original authorized report projection. */
export function useSummaryRouteNavigation(owner: GrowthWorkspaceValue | null, scope: string | null) {
  const route = parseSummaryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/summary" && focused;
  const authority = useNavigationAuthority(), leave = useGuardedNavigation();
  const current = useRef({ owner, scope, route, active }); current.current = { owner, scope, route, active };
  const mounted = useRef(true), serial = useRef(0), boundScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis = key(current.current.route)) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && key(parseSummaryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis;
  }
  function write(next: SummaryRoute, mode: "push" | "replace") {
    if (key(next) === key(current.current.route)) return;
    const params = serializeSummaryRoute(next);
    if (mode === "push") router.push({ pathname: "/summary", params }); else router.setParams(params);
  }
  useEffect(() => {
    if (!active || !admitted()) return;
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (scopeChanged && route.periodId !== null) { serial.current++; write({ ...route, periodId: null }, "replace"); }
  }, [active, scope, scopeChanged, route.periodId, authority, navigation, router]);
  function guarded(action: () => void, intent: "workspace" | "navigation" = "workspace") {
    if (!admitted()) return;
    const basis = key(current.current.route), token = ++serial.current;
    leave(() => { if (token === serial.current && admitted(basis)) action(); }, intent);
  }
  function archiveOwner() {
    const value = current.current.owner;
    return admitted() && (boundScope.current === undefined || boundScope.current === scope) && scope && value?.scopeKey === scope && value.model.scopeKey === scope
      && current.current.route.tab === "archive" && archiveReadingView(value.model).authorized ? value : null;
  }
  const archive: SummaryArchiveNavigation = {
    periodId: scopeChanged ? null : route.periodId, filter: route.archiveFilter,
    href: periodId => ({ pathname: "/summary", params: serializeSummaryRoute({ ...route, tab: "archive", periodId }) }),
    select(periodId) {
      const value = archiveOwner();
      if (!value || !archiveReadingView(value.model).items.some(item => item.key === periodId)) return false;
      serial.current++; value.model.page?.archive?.reading?.closeVersion();
      write({ ...current.current.route, periodId }, "push"); return true;
    },
    selectVersion(documentId, snapshotId, snapshotVersion) {
      const value = archiveOwner(), reading = value?.model.page?.archive?.reading;
      if (!reading?.online || !reading.indexes.some(index => index.documentId === documentId && index.versions.some(version => version.snapshotId === snapshotId && version.snapshotVersion === snapshotVersion && !version.invalidated))) return false;
      serial.current++; reading.readVersion(documentId, snapshotId, snapshotVersion);
      write({ ...current.current.route, periodId: snapshotId + ":" + snapshotVersion }, "push"); return true;
    },
    setFilter(archiveFilter) {
      if (!archiveOwner()) return;
      serial.current++; write({ ...current.current.route, archiveFilter }, "replace");
    },
  };
  return {
    route: scopeChanged ? { ...route, periodId: null } : route, archive, active, pathname,
    guarded,
    changeTab(tab: SummaryRoute["tab"]) { if (tab !== current.current.route.tab) guarded(() => write({ ...current.current.route, tab }, "push"), "navigation"); },
  };
}
