import { useEffect, useRef } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import { useGuardedNavigation } from "./useGuardedNavigation";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parseMemoryRoute, serializeMemoryRoute } from "./route-state";

type MemoryRoute = ReturnType<typeof parseMemoryRoute>;
export type MemoryReaderNavigation = MemoryRoute & {
  active: boolean; href(id: string): Href; selectFact(id: string): void;
  changeTab(tab: MemoryRoute["tab"]): void; openResource(href: Href): void;
};
const key = (route: MemoryRoute) => JSON.stringify(serializeMemoryRoute(route));

/** Read selection only. Memory writes, authorization and version history stay with their owners. */
export function useMemoryRouteSelection(scope: string | null): MemoryReaderNavigation {
  const route = parseMemoryRoute(useLocalSearchParams()), pathname = usePathname(), focused = useIsFocused();
  const router = useRouter(), navigation = useNavigation(), entry = useRoute(), authority = useNavigationAuthority(), leave = useGuardedNavigation();
  const active = pathname === "/memory" && focused;
  const observedScope = useRef<string | null | undefined>(undefined), mounted = useRef(true), serial = useRef(0);
  const scopeChanged = observedScope.current !== undefined && observedScope.current !== scope;
  const current = useRef({ active, scope, route }); current.current = { active, scope, route };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted() {
    const state = navigation.getState();
    return mounted.current && current.current.active && navigation.isFocused() && state?.routes[state.index]?.key === entry.key && (!authority || authority.isCurrent());
  }
  useEffect(() => {
    if (!admitted()) return;
    if (scope !== null || observedScope.current !== undefined) observedScope.current = scope;
    if (scopeChanged) { serial.current++; if (route.factId !== null) router.setParams(serializeMemoryRoute({ ...route, factId: null })); }
  }, [active, scope, scopeChanged, route.factId, route.tab, authority, navigation, router]);
  function guarded(action: () => void) {
    if (!admitted() || !scope) return;
    const token = ++serial.current, basis = key(current.current.route);
    leave(() => {
      const state = navigation.getState(), live = state?.routes[state.index];
      if (!admitted() || serial.current !== token || current.current.scope !== scope || !live
        || key(parseMemoryRoute((live.params ?? {}) as Record<string, string | string[] | undefined>)) !== basis) return;
      action();
    }, "navigation");
  }
  return { ...route, active, factId: scopeChanged ? null : route.factId,
    href: id => ({ pathname: "/memory", params: serializeMemoryRoute({ tab: "long", factId: id }) }),
    selectFact(id) { guarded(() => router.push({ pathname: "/memory", params: serializeMemoryRoute({ tab: "long", factId: id }) })); },
    changeTab(tab) { if (tab !== current.current.route.tab) guarded(() => router.push({ pathname: "/memory", params: serializeMemoryRoute({ ...current.current.route, tab }) })); },
    openResource: href => guarded(() => router.push(href)),
  };
}
