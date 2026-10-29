import { createContext, use, useLayoutEffect, useRef, type ReactNode } from "react";

type Target = { pathname: string; signature: string; scopeKey: string | null };
type Origin = { node: HTMLElement; group: string; key: string };
type Receipt = Target & Origin & { approvedFocus: Element | null; fromSignature: string; current(): boolean };
const Context = createContext<{ current: Receipt | null } | null>(null);

// One-shot focus continuity, not selection, history, domain state or draft ownership.
export function RouteTabFocusProvider({ children }: { children: ReactNode }) {
  const receipt = useRef<Receipt | null>(null);
  return <Context.Provider value={receipt}>{children}</Context.Provider>;
}
export function useRouteTabFocus(target: Target, active: boolean) {
  const receipt = use(Context);
  useLayoutEffect(() => {
    if (typeof document === "undefined" || !active || !receipt?.current) return;
    const old = receipt.current;
    if (old.pathname === target.pathname && old.scopeKey === target.scopeKey && old.fromSignature === target.signature && old.signature !== target.signature && old.current()) return;
    receipt.current = null;
    if (old.pathname !== target.pathname || old.signature !== target.signature || old.scopeKey !== target.scopeKey || !old.current()) return;
    if (old.node.isConnected) return;
    // A deliberate focus move wins over navigation continuity. A removed guard
    // button is allowed: approval happened before its dialog was unmounted.
    const focus = document.activeElement;
    if (focus !== document.body && focus !== old.node && focus !== old.approvedFocus) return;
    const next = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"][data-route-tab-key]'))
      .find(node => node.dataset.routeTabKey === old.key && node.closest('[role="tablist"]')?.getAttribute("aria-label") === old.group
        && !node.closest('[inert],[aria-hidden="true"]') && node.getAttribute("aria-disabled") !== "true");
    next?.focus({ preventScroll: true });
  });
  return {
    capture(): Origin | null {
      if (typeof document === "undefined" || !receipt) return null;
      const node = document.activeElement as HTMLElement | null;
      const group = node?.closest('[role="tablist"]')?.getAttribute("aria-label");
      return node?.matches('[role="tab"][data-route-tab-key]') && group ? { node, group, key: node.dataset.routeTabKey! } : null;
    },
    accepted(origin: Origin | null, destination: Target, current: () => boolean) {
      if (receipt) receipt.current = origin ? { ...origin, ...destination, current, fromSignature: target.signature, approvedFocus: document.activeElement } : null;
    },
  };
}
