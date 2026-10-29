import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import { useNavigationAuthority, usePrivateListQuery } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";
import type { HistoryCategory, HistoryFilterAction } from "../components/history/history-filters";

export type HistoryReader = { snapshot: object; occupied: boolean; guardedClose: boolean; close(): void };
type HistoryRoute = ReturnType<typeof parseHistoryRoute>;
const key = (route: HistoryRoute) => JSON.stringify(serializeHistoryRoute(route));

/** URL owns applied filters; the existing reader owns close/discard and its publication. */
export function useHistoryRouteFilters(scope: string, reader: HistoryReader | null, locked: boolean) {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/history" && focused;
  const authority = useNavigationAuthority(), leave = useGuardedNavigation(), [searchText, setSearchText] = usePrivateListQuery("history");
  const mounted = useRef(true), serial = useRef(0);
  const current = useRef({ route, reader, locked, scope, active }); current.current = { route, reader, locked, scope, active };
  const [closing, setClosing] = useState<{ token: number; basis: string; scope: string; snapshot: object; target: HistoryRoute } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && (basis === undefined || key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  useEffect(() => {
    if (!closing) return;
    if (!admitted(closing.basis) || closing.scope !== scope || closing.token !== serial.current) { setClosing(null); return; }
    if (reader?.snapshot === closing.snapshot || reader?.occupied) return;
    setClosing(null);
    router.push({ pathname: "/history", params: serializeHistoryRoute(closing.target) });
  }, [closing, reader, route, active, scope, authority, navigation, router]);
  function guarded(action: (token: number, basis: string) => void, intent: "workspace" | "navigation" = "navigation") {
    if (!admitted()) return;
    const token = ++serial.current, basis = key(current.current.route);
    leave(() => { if (admitted(basis) && token === serial.current) action(token, basis); }, intent);
  }
  return {
    route, filters: { scope, category: route.category, searchText, from: route.from, to: route.to },
    filter(action: HistoryFilterAction) {
      if (!admitted(key(route)) || current.current.locked) return;
      if (action.type !== "search" && action.type !== "dates" && action.type !== "reset") return;
      serial.current++; setClosing(null);
      if (reader?.occupied) reader.close();
      if (action.type === "search" || action.type === "reset") setSearchText(action.type === "search" ? action.value : "");
      const next = { ...route, page: 0, profileVersion: null, taskId: null, recordId: null, documentId: null, notificationId: null, messageId: null, ...(action.type === "dates" ? { from: action.from, to: action.to } : action.type === "reset" ? { from: "", to: "" } : {}) };
      if (key(next) !== key(route)) router.setParams(serializeHistoryRoute(next));
    },
    categoryHref(next: HistoryCategory): Href { return { pathname: "/history", params: serializeHistoryRoute({ ...route, category: next, status: "all", older: false, page: 0, profileVersion: null, taskId: null, recordId: null, documentId: null, notificationId: null, messageId: null }) }; },
    category(next: HistoryCategory) {
      if (next === current.current.route.category) return;
      const willClose = !!current.current.reader?.occupied;
      const guardedClose = willClose && !!current.current.reader?.guardedClose;
      guarded((token, basis) => {
        const target: HistoryRoute = { ...current.current.route, category: next, status: "all", older: false, page: 0, profileVersion: null, taskId: null, recordId: null, documentId: null, notificationId: null, messageId: null };
        const owner = current.current.reader;
        // Pure read navigation must not inherit a later, unconfirmed close.
        if (owner?.occupied && (!willClose || !guardedClose && owner.guardedClose)) return;
        if (!owner?.occupied) { router.push({ pathname: "/history", params: serializeHistoryRoute(target) }); return; }
        setClosing({ token, basis, scope, snapshot: owner.snapshot, target });
        owner.close();
      }, guardedClose ? "navigation" : "workspace");
    },
    openResource(href: Href) { guarded(() => router.push(href)); },
  };
}
