import { useEffect, useRef } from "react";
import { usePathname, useRouter, type Href } from "expo-router";

/** Withhold a previous scope's selection before a keyed reader can remount. */
export function useScopedRouteState<T>(scopeKey: string | null, pathname: string, state: T, cleared: T, href: (value: T) => Href): T {
  const activePath = usePathname(), router = useRouter(), key = JSON.stringify(state);
  const previous = useRef(scopeKey), hasBoundScope = useRef(!!scopeKey), stale = useRef<string | null>(null);
  if (previous.current !== scopeKey) {
    // Initial authorization may arrive after a hidden screen has mounted. Its
    // explicit deep link is not an old child selection until a scope was bound.
    if (hasBoundScope.current) stale.current = key;
    previous.current = scopeKey;
    if (scopeKey) hasBoundScope.current = true;
  }
  if (stale.current !== null && stale.current !== key) stale.current = null;
  const invalid = stale.current === key;
  useEffect(() => {
    if (activePath === pathname && invalid) router.replace(href(cleared));
  }, [scopeKey, activePath, pathname, key, invalid]);
  return invalid ? cleared : state;
}
