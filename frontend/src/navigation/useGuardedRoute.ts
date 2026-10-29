import type { ProductionOwner } from "../production/ProductionOwner";
import { useEffect, useRef } from "react";
import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";

/** A thin closure guard, not a router store or a second selection owner. */
export function useGuardedRoute(scopeKey: string | null, owner: Pick<ProductionOwner, "getSnapshot">) {
  const router = useRouter(), pathname = usePathname(), params = useLocalSearchParams(), leave = usePreviewNavigation();
  const identityKey = owner.getSnapshot().identityKey;
  const routeKey = `${pathname}:${JSON.stringify(params)}`;
  const current = useRef({ scopeKey, routeKey, mounted: true });
  current.current = { scopeKey, routeKey, mounted: true };
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  function navigate(href: Href, mode: "push" | "replace" = "push", intent: "navigation" | "workspace" = "workspace", beforeNavigate?: () => boolean | void, retainedDrafts: readonly string[] = []) {
    leave(() => {
      const live = current.current, snapshot = owner.getSnapshot();
      if (snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey) return;
      if (!live.mounted || live.scopeKey !== scopeKey || live.routeKey !== routeKey) return;
      if (beforeNavigate?.() === false) return;
      router[mode](href);
    }, intent, retainedDrafts);
  }
  return navigate;
}
