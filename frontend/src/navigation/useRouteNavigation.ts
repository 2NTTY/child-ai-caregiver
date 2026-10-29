import { useRouteTabFocus } from "./RouteTabFocus";
import { useNavigationScope } from "./NavigationScope";
import { useEffect, useRef } from "react";
import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import type { RouteParams } from "./route-state";

// Presentation adapter only. The domain owner still decides what may be read or written.
export function useRouteNavigation(providedScopeKey: string | null, selectionKeys: readonly string[] = [], expectedPath?: string) {
  const scopeKey = providedScopeKey || null;
  const raw = useLocalSearchParams() as RouteParams;
  const pathname = usePathname(), router = useRouter(), leave = usePreviewNavigation(), scope = useNavigationScope();
  const active = expectedPath === undefined || pathname === expectedPath;
  const signature = JSON.stringify(raw), previousScope = useRef(scopeKey);
  // Hidden routes can mount before the first authorized child is loaded. That
  // first binding is not a child switch; once bound, even logout is a boundary.
  const binding = useRef({ scopeKey, bound: scopeKey !== null, departed: false });
  if (binding.current.scopeKey !== scopeKey) {
    if (binding.current.bound) binding.current.departed = true;
    binding.current.scopeKey = scopeKey;
    binding.current.bound ||= scopeKey !== null;
  }
  const boundary = useRef({ scopeKey, discarded: null as string | null });
  if (active && boundary.current.scopeKey !== scopeKey) {
    const initialBinding = boundary.current.scopeKey === null && scopeKey !== null && !binding.current.departed;
    boundary.current = { scopeKey, discarded: initialBinding ? null : signature };
    if (initialBinding) previousScope.current = scopeKey;
  }
  else if (active && boundary.current.discarded !== null && boundary.current.discarded !== signature) boundary.current.discarded = null;
  const tabFocus = useRouteTabFocus({ scopeKey, pathname, signature }, active);
  const current = useRef({ scopeKey, pathname, signature, active, mounted: true });
  current.current = { scopeKey, pathname, signature, active, mounted: true };
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  // Do not briefly show an old stable ID while asynchronous URL replacement is pending.
  const params = boundary.current.discarded === signature
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => !selectionKeys.includes(key))) : raw;
  useEffect(() => {
    if (!active || previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    router.replace({ pathname, params } as Href);
  }, [scopeKey, active]);
  function run(action: () => void, guarded = true, retainedDrafts: readonly string[] = []) {
    const apply = () => {
      const live = current.current;
      if (!active || !live.active || !live.mounted || live.scopeKey !== scopeKey || live.pathname !== pathname || live.signature !== signature || scope && !scope.isCurrent()) return;
      action();
    };
    if (guarded) leave(apply, "workspace", retainedDrafts); else apply();
  }
  function navigate(params: Record<string, string>, mode: "push" | "replace" = "push", guarded = true, retainedDrafts: readonly string[] = []) {
    const origin = tabFocus.capture();
    run(() => {
      tabFocus.accepted(origin, { pathname, signature: JSON.stringify(params), scopeKey }, () => !scope || scope.isCurrent());
      router[mode]({ pathname, params } as Href);
    }, guarded, retainedDrafts);
  }
  return { params, navigate, run, active };
}
