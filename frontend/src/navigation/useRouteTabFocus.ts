import { useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, type View } from "react-native";

type RouteIdentity = { pathname: string; searchKey: string; scopeKey: string | null; identityKey: string | null };
type FocusTarget = { kind: "tab"; group: string; key: string } | { kind: "control"; key: string };
type FocusReceipt = RouteIdentity & { node: HTMLElement; target: FocusTarget };

/** Position-only continuity across an accepted same-page tab or explicitly named chapter-picker push. No selection or navigation owner. */
export function useRouteTabFocus(root: RefObject<View | null>, route: RouteIdentity, isCurrent: () => boolean) {
  const latest = useRef({ route, isCurrent }); latest.current = { route, isCurrent };
  const receipt = useRef<FocusReceipt | null>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const surface = root.current as unknown as HTMLElement | null;
    if (!surface) return;
    function remember(event: Event) {
      const target = event.target as HTMLElement | null;
      const tab = target?.closest<HTMLElement>('[role="tab"][data-tab-key]');
      const group = tab?.closest<HTMLElement>('[role="tablist"]')?.getAttribute("aria-label");
      const control = target?.closest<HTMLElement>('[data-route-focus-key]');
      const current = latest.current;
      receipt.current = !current.isCurrent() ? null : tab && group
        ? { ...current.route, node: tab, target: { kind: "tab", group, key: tab.dataset.tabKey! } }
        : control?.dataset.routeFocusKey ? { ...current.route, node: control, target: { kind: "control", key: control.dataset.routeFocusKey } } : null;
    }
    surface.addEventListener("focusin", remember);
    return () => { surface.removeEventListener("focusin", remember); receipt.current = null; };
  }, [root]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const old = receipt.current;
    if (!old) return;
    if (!isCurrent() || old.pathname !== route.pathname || old.scopeKey !== route.scopeKey || old.identityKey !== route.identityKey) { receipt.current = null; return; }
    if (old.searchKey === route.searchKey) return;
    receipt.current = null;
    // Do not steal focus deliberately moved elsewhere, or restore a rejected/non-selected target.
    if (document.activeElement !== document.body && document.activeElement !== old.node) return;
    const surface = root.current as unknown as HTMLElement | null;
    const target = old.target;
    const next = target.kind === "tab" ? Array.from(surface?.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"][data-tab-key]') ?? [])
      .find(node => node.dataset.tabKey === target.key && node.closest('[role="tablist"]')?.getAttribute("aria-label") === target.group)
      : Array.from(surface?.querySelectorAll<HTMLElement>('[data-route-focus-key]') ?? []).find(node => node.dataset.routeFocusKey === target.key);
    if (!next || next.closest('[aria-hidden="true"],[inert]') || next.getAttribute("aria-disabled") === "true") return;
    next.focus({ preventScroll: true });
    // The focus event is not a fresh navigation intent and must not survive Back/Forward.
    receipt.current = null;
  });
}
