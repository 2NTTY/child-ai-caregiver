import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import { useNavigationAuthority } from "./NavigationAuthority";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { parseHistoryRoute, serializeHistoryRoute } from "./route-state";

export type ProfileHistoryNavigation = { version: string | null; href(version: string): Href; open(version: string): void; close(): void };
const key = (route: ReturnType<typeof parseHistoryRoute>) => JSON.stringify(serializeHistoryRoute(route));

/** Read-only version selection. Mount above the scope-keyed history workspace. */
export function useHistoryProfileRoute(scope: string | null): ProfileHistoryNavigation {
  const route = parseHistoryRoute(useLocalSearchParams()), router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), active = pathname === "/history" && focused;
  const authority = useNavigationAuthority(), leave = useGuardedNavigation();
  const boundScope = useRef<string | null | undefined>(undefined), mounted = useRef(true), serial = useRef(0);
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  const current = useRef({ route, scope, active }); current.current = { route, scope, active };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted(basis?: string) {
    const state = navigation.getState(), live = state?.routes[state.index];
    return mounted.current && current.current.active && navigation.isFocused() && live?.key === entry.key && current.current.scope === scope
      && (!authority || authority.isCurrent()) && (basis === undefined || key(parseHistoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) === basis);
  }
  useEffect(() => {
    if (!admitted()) return;
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (scopeChanged) { serial.current++; if (route.profileVersion !== null) router.setParams(serializeHistoryRoute({ ...route, profileVersion: null })); }
  }, [scope, scopeChanged, active, route.profileVersion, route.category, authority, navigation, router]);
  return {
    version: scopeChanged ? null : route.profileVersion,
    href: version => ({ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "profile", profileVersion: version }) }),
    open(version) {
      if (!scope || !admitted() || current.current.route.category !== "profile") return;
      const token = ++serial.current, basis = key(current.current.route);
      leave(() => {
        if (!admitted(basis) || serial.current !== token) return;
        router.push({ pathname: "/history", params: serializeHistoryRoute({ ...current.current.route, profileVersion: version }) });
      }, "workspace");
    },
    close() {
      if (!admitted(key(route)) || current.current.route.category !== "profile") return;
      serial.current++;
      if (route.profileVersion !== null) router.setParams(serializeHistoryRoute({ ...route, profileVersion: null }));
    },
  };
}
