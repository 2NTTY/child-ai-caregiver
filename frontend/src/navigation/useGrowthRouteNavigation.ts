import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { PreparationWorkspaceValue } from "../workspaces/PreparationWorkspace";
import { useNavigationAuthority } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseGrowthRoute, serializeGrowthRoute } from "./route-state";

type GrowthRoute = ReturnType<typeof parseGrowthRoute>;
export type PreparationNavigation = { selectedId: string | null; message: string; href(id: string): Href; open(id: string): void; close(): void };
const key = (route: GrowthRoute) => JSON.stringify(serializeGrowthRoute(route));

/** Selection remains in the document owner; URL publication waits for its accepted read. */
export function useGrowthRouteNavigation(owner: PreparationWorkspaceValue | null, scope: string | null) {
  const route = parseGrowthRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/growth" && focused;
  const authority = useNavigationAuthority(), leave = useGuardedNavigation();
  const current = useRef({ owner, scope, route, active }); current.current = { owner, scope, route, active };
  const mounted = useRef(true), serial = useRef(0), boundScope = useRef<string | null | undefined>(undefined);
  const guardSerial = useRef(0), acceptedRead = useRef<{ token: number; route: string } | null>(null);
  const observation = useRef<{ route: string; ownerId: string | null } | null>(null);
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  const [pending, setPending] = useState<{ token: number; basis: string; scope: string; snapshot: object; originId: string | null; id: string | null; mode: "push" | "replace" } | null>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && (basis === undefined || key(parseGrowthRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  function write(next: GrowthRoute, mode: "push" | "replace") {
    if (key(next) === key(current.current.route)) return;
    const params = serializeGrowthRoute(next);
    if (mode === "push") router.push({ pathname: "/growth", params }); else router.setParams(params);
  }
  function select(id: string | null, mode: "push" | "replace") {
    const value = current.current.owner, starting = current.current.route;
    if (!admitted(key(starting)) || !scope || !value || value.model.condition === "lost" || starting.tab !== "preparation") return;
    if (id !== null && !value.model.documents.some(item => item.id === id && item.status === "active")) return;
    const selected = value.model.selected?.id ?? null;
    if (selected === id) {
      const superseded = pendingRef.current;
      serial.current++; pendingRef.current = null; setPending(null);
      // Published A can still have an uncommitted B selection in the owner.
      // Reassert A through that owner; a batched B→A need not publish a new model.
      if (superseded) {
        if (id === null) value.actions.closeDocument(); else value.actions.selectDocument(id);
      }
      write({ ...starting, documentId: id }, mode); return;
    }
    const request = { token: ++serial.current, basis: key(starting), scope, snapshot: value.model, originId: selected, id, mode };
    pendingRef.current = request; setPending(request);
    // Both original methods retain checklist writes, create drafts and unknown receipts.
    if (id === null) value.actions.closeDocument(); else value.actions.selectDocument(id);
  }
  useEffect(() => {
    if (!active) {
      observation.current = null;
      if (pendingRef.current) { serial.current++; pendingRef.current = null; setPending(null); }
      return;
    }
    if (!admitted()) return;
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (scopeChanged) {
      serial.current++; pendingRef.current = null; setPending(null); observation.current = null;
      if (route.documentId !== null || route.concernId !== null) write({ ...route, documentId: null, concernId: null }, "replace");
      return;
    }
    if (!owner || owner.model.condition === "lost" || route.tab !== "preparation") return;
    const previous = observation.current, ownerId = owner.model.selected?.id ?? null;
    observation.current = { route: key(route), ownerId };
    const request = pendingRef.current;
    if (request) {
      if (!admitted(request.basis) || request.scope !== scope || request.token !== serial.current) { pendingRef.current = null; setPending(null); }
      else {
        if (owner.model !== request.snapshot && ownerId !== request.id && ownerId !== request.originId && owner.model.selected?.status === "active") {
          pendingRef.current = null; setPending(null); serial.current++;
          write({ ...route, documentId: ownerId }, "replace"); return;
        }
        if (owner.model === request.snapshot || (owner.model.selected?.id ?? null) !== request.id) return;
        pendingRef.current = null; setPending(null);
        acceptedRead.current = { token: request.token, route: key({ ...route, documentId: request.id }) };
        write({ ...route, documentId: request.id }, request.mode);
        return;
      }
    }
    if (route.documentId && owner.model.justArchivedId === route.documentId && owner.model.selected?.status === "archived") {
      write({ ...route, documentId: null }, "replace"); return;
    }
    if (previous?.route === key(route) && previous.ownerId !== ownerId && owner.model.selected?.status === "active") {
      write({ ...route, documentId: ownerId }, "replace"); return;
    }
    if (route.documentId !== null && owner.model.selected?.id !== route.documentId) select(route.documentId, "replace");
  }, [route.tab, route.documentId, route.concernId, owner, scope, scopeChanged, active, pending, authority, navigation, router]);
  function guarded(action: () => void) {
    if (!admitted()) return;
    const basis = key(current.current.route), token = ++guardSerial.current, readToken = serial.current, precedingRead = pendingRef.current;
    leave(() => {
      const ownedAck = precedingRead && acceptedRead.current?.token === precedingRead.token && admitted(acceptedRead.current.route);
      if ((!admitted(basis) && !ownedAck) || token !== guardSerial.current || readToken !== serial.current) return;
      action();
    }, "workspace");
  }
  const selected = owner?.model.selected, requested = route.documentId;
  const eligible = !!requested && !!owner?.model.documents.some(item => item.id === requested && item.status === "active");
  const preparation: PreparationNavigation = {
    selectedId: !scopeChanged && eligible && selected?.id === requested && selected.status === "active" ? requested : null,
    message: requested && !eligible ? owner?.model.condition === "loading" ? "正在讀取準備單…" : "這份準備單未在目前已載入的清單中。可載入更多，或返回清單選擇。" : "",
    href: id => ({ pathname: "/growth", params: serializeGrowthRoute({ ...route, tab: "preparation", documentId: id }) }),
    open: id => select(id, "push"), close: () => select(null, "replace"),
  };
  return {
    route: scopeChanged ? { ...route, concernId: null, documentId: null } : route, preparation,
    concernHref(id: string): Href { return { pathname: "/growth", params: serializeGrowthRoute({ ...route, tab: "concerns", concernId: id }) }; },
    changeTab(tab: GrowthRoute["tab"]) { if (tab !== current.current.route.tab) guarded(() => router.push({ pathname: "/growth", params: serializeGrowthRoute({ ...current.current.route, tab }) })); },
    selectConcern(concernId: string | null) { guarded(() => router.push({ pathname: "/growth", params: serializeGrowthRoute({ ...current.current.route, concernId }) })); },
    open(href: Href) { guarded(() => router.push(href)); },
  };
}
