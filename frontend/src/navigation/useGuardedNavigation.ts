import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useNavigationAuthority } from "./NavigationAuthority";

/** Recheck the captured route and authoritative scope when the existing leave guard accepts. */
export function useGuardedNavigation() {
  const leave = usePreviewNavigation(), pathname = usePathname(), authority = useNavigationAuthority();
  const current = useRef({ pathname, mounted: true });
  current.current.pathname = pathname;
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; }; }, []);
  return (action: () => void, intent: "workspace" | "navigation" | "child" = "workspace", retained: readonly string[] = []) => {
    leave(() => {
      if (!current.current.mounted || current.current.pathname !== pathname || authority && !authority.isCurrent()) return;
      action();
    }, intent, retained);
  };
}
