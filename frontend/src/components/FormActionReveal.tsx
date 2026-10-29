import { createContext, use, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Platform, type ScrollView, type View } from "react-native";
import { useNavigationScope } from "../navigation/NavigationScope";

type RevealTicket = { current(): boolean; cancel(): void; reveal(target?: View | null, focusViewport?: boolean): void };
const Context = createContext<(() => RevealTicket | null) | null>(null);

/** Optional web presentation: only this dialog; automatic reveal never moves focus. */
export function FormActionRevealProvider({ active, boundary, scrollRef, hasRecovery, children }: {
  active: boolean; boundary: string; scrollRef: RefObject<ScrollView | null>; hasRecovery: boolean; children: ReactNode;
}) {
  const scope = useNavigationScope(), mounted = useRef(true), pending = useRef<RevealTicket | null>(null);
  const latest = useRef({ active, boundary, hasRecovery }); latest.current = { active, boundary, hasRecovery };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.cancel(); }; }, []);
  useLayoutEffect(() => { pending.current?.cancel(); }, [active, boundary]);
  function capture(): RevealTicket | null {
    pending.current?.cancel();
    if (Platform.OS !== "web" || !active || typeof document === "undefined" || scope && !scope.isCurrent()) return null;
    const href = window.location.href;
    let valid = true;
    const current = () => valid && mounted.current && latest.current.active && latest.current.boundary === boundary
      && window.location.href === href && (!scope || scope.isCurrent());
    const cancel = () => {
      valid = false;
      for (const event of ["focusin", "pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"]) document.removeEventListener(event, cancel, true);
      for (const event of ["popstate", "hashchange", "blur"]) window.removeEventListener(event, cancel, true);
    };
    // A later user interaction wins over an asynchronously published result.
    for (const event of ["focusin", "pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"]) document.addEventListener(event, cancel, true);
    for (const event of ["popstate", "hashchange", "blur"]) window.addEventListener(event, cancel, true);
    const ticket: RevealTicket = { current, cancel, reveal(target, focusViewport = false) {
      const allowed = current(); cancel();
      const viewport = (scrollRef.current as ScrollView & { getScrollableNode?(): HTMLElement } | null)?.getScrollableNode?.();
      if (!allowed || !viewport?.isConnected || viewport.closest('[aria-hidden="true"],[hidden]')) return;
      // Recovery is already the first content in this dialog; no extra wrapper
      // or empty-layout gap is needed to reveal its original controls.
      if (target === undefined) {
        if (latest.current.hasRecovery) {
          if (viewport.scrollTop > 0) scrollRef.current?.scrollTo({ y: 0, animated: false });
          // Only an explicit "view recovery" activation requests focus here;
          // automatic publication must never move it. Next Tab enters recovery.
          if (focusViewport) viewport.focus({ preventScroll: true });
        }
        return;
      }
      const element = target as unknown as HTMLElement | null;
      if (!element?.isConnected || !viewport.contains(element) || element.closest('[aria-hidden="true"],[hidden]')) return;
      const area = viewport.getBoundingClientRect(), box = element.getBoundingClientRect();
      if (area.height <= 0 || box.height <= 0 || box.top >= area.top && box.bottom <= area.bottom) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, viewport.scrollTop + box.top - area.top), animated: false });
    } };
    pending.current = ticket; return ticket;
  }
  return <Context.Provider value={capture}>{children}</Context.Provider>;
}

/** Wait for this action's owner projection, not a void callback's return value. */
export function useFormPublicationReveal({ scopeKey, formKey, reviewedValues, state, revision }: {
  scopeKey: string; formKey: string | number; reviewedValues: object | null; state: string; revision: unknown;
}) {
  const capture = use(Context), reviewRef = useRef<View>(null);
  type Intent = { kind: "review" | "submit"; ticket: RevealTicket; revision: unknown; values: object | null; expected?: string };
  const pending = useRef<Intent | null>(null);
  useEffect(() => () => { pending.current?.ticket.cancel(); pending.current = null; }, [scopeKey, formKey]);
  useLayoutEffect(() => {
    const intent = pending.current;
    if (!intent) return;
    if (!intent.ticket.current()) { pending.current = null; intent.ticket.cancel(); return; }
    if ((intent.expected === undefined && intent.kind === "review") || intent.revision === revision) return;
    if (intent.kind === "submit" && reviewedValues === intent.values && state === "saving") return;
    pending.current = null;
    if (intent.kind === "review" && state === "needs_confirmation" && reviewedValues !== intent.values && JSON.stringify(reviewedValues) === intent.expected) intent.ticket.reveal(reviewRef.current);
    else if (intent.kind === "submit" && reviewedValues === intent.values && ["unknown", "failed", "conflict"].includes(state)) intent.ticket.reveal();
    else intent.ticket.cancel();
  });
  function begin(kind: Intent["kind"]) {
    pending.current?.ticket.cancel();
    const ticket = capture?.();
    const intent: Intent | null = ticket ? { kind, ticket, revision, values: reviewedValues } : null;
    pending.current = intent;
    return {
      reviewed(values: object) { if (intent && pending.current === intent) intent.expected = JSON.stringify(values); },
      cancel() { intent?.ticket.cancel(); if (pending.current === intent) pending.current = null; },
    };
  }
  return { reviewRef, beginReview: () => begin("review"), beginSubmit: () => begin("submit"),
    canRevealRecovery: Platform.OS === "web" && capture !== null,
    // A fresh explicit action may reveal recovery even after a prior automatic
    // ticket was withdrawn by focus/interaction. It never checks or retries.
    revealRecovery: () => capture?.()?.reveal(undefined, true),
  };
}
