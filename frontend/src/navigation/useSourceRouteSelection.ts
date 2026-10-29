import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { SourcesActions, SourcesViewModel } from "../shared-input-view-model";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parseSourceRoute, serializeSourceRoute } from "./route-state";

export type SourceReaderNavigation = {
  sourceId: string | null;
  message: string;
  canReturn: boolean;
  href(id: string): Href;
  open(id: string): void;
  returnToIndex(): void;
};
type Domain = { model: SourcesViewModel; actions: SourcesActions };

/** URL owns index/reader presentation; the existing source owner owns selection and drafts. */
export function useSourceRouteSelection(domain: Domain | null, scope: string | null): SourceReaderNavigation {
  const router = useRouter(), navigation = useNavigation(), routeEntry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), authority = useNavigationAuthority();
  const active = focused && pathname === "/sources";
  const parsed = parseSourceRoute(useLocalSearchParams()).sourceId;
  const boundScope = useRef<string | null | undefined>(undefined);
  const pendingBoundary = useRef(false);
  const scopeChanged = pendingBoundary.current || boundScope.current !== undefined && boundScope.current !== scope;
  const requestedId = scopeChanged ? null : parsed;
  const latest = useRef({ domain, scope, active, parsed }); latest.current = { domain, scope, active, parsed };
  const mounted = useRef(true), serial = useRef(0);
  const seen = useRef<string | null | undefined>(undefined);
  const acceptedOwner = useRef<string | null | undefined>(undefined);
  // A router acknowledgement is not a new request. A read may finish before the
  // canonical-owner replace renders, so retain both issued values until observed.
  const acknowledgements = useRef<(string | null)[]>([]);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<{ id: string; mode: "push" | "replace"; isCurrent(): boolean } | null>(null);
  const ownerId = domain?.model.selected?.id ?? null;
  const unresolved = !!domain && (!!domain.model.direct || ["saving", "unknown", "unconfirmed", "confirmed_unavailable"].includes(domain.model.operation.state));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);

  useEffect(() => {
    if (boundScope.current !== undefined && boundScope.current !== scope) { pendingBoundary.current = true; serial.current++; }
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
  }, [scope]);

  function admitted() {
    const state = navigation.getState();
    return mounted.current && latest.current.active && navigation.isFocused() && !!state && state.routes[state.index]?.key === routeEntry.key && (!authority || authority.isCurrent());
  }
  function write(id: string | null, mode: "push" | "replace") {
    if (!admitted()) return;
    acknowledgements.current.push(id);
    const params = serializeSourceRoute({ sourceId: id });
    if (mode === "push") router.push({ pathname: "/sources", params }); else router.setParams(params);
  }
  function open(id: string, mode: "push" | "replace") {
    if (!admitted()) return;
    const value = latest.current.domain, token = ++serial.current, expectedScope = latest.current.scope;
    if (!value || !expectedScope) return;
    const acceptedId = value.model.selected?.id ?? null, startingId = latest.current.parsed;
    if (mode === "replace" && parsed !== acceptedId) write(acceptedId, "replace");
    const input = value.model.items.find(item => item.id === id);
    if (!input) { setMessage("這份來源未在目前已載入的清單中，暫時無法查看。可重新讀取清單，或選擇另一份來源。"); return; }
    if (acceptedId !== id && (!value.model.fresh || value.model.direct || value.model.access === "lost")) {
      setMessage("目前未能轉到另一份來源；原文與草稿保留。請先完成原次查核，或等候讀取後再選擇。"); return;
    }
    setMessage("");
    const isCurrent = () => {
      if (!admitted() || serial.current !== token || latest.current.scope !== expectedScope) return false;
      // Read the navigator as well as React refs: a newer route can precede render.
      const state = navigation.getState(), liveRoute = state?.routes[state.index];
      if (liveRoute?.key !== routeEntry.key) return false;
      const liveId = parseSourceRoute((liveRoute.params ?? {}) as Record<string, string | string[] | undefined>).sourceId;
      return liveId === acceptedId || liveId === id || liveId === startingId;
    };
    value.actions.openInput(input, { isCurrent, onOpened() { if (isCurrent()) setCompleted({ id, mode, isCurrent }); } });
  }
  useEffect(() => {
    if (!active) acceptedOwner.current = undefined;
    if (!admitted()) return;
    if (scopeChanged) {
      pendingBoundary.current = false; acceptedOwner.current = undefined; seen.current = null; acknowledgements.current = []; serial.current++; setMessage(""); setCompleted(null);
      if (parsed !== null) write(null, "replace");
      return;
    }
    if (!domain) return;
    const previousOwner = acceptedOwner.current; acceptedOwner.current = ownerId;
    if (!completed && previousOwner !== undefined && previousOwner !== ownerId) {
      // Create/delete/new-input actions still belong to the existing owner.
      // Reconcile their accepted context instead of reopening an old URL target.
      serial.current++;
      if (parsed !== ownerId) write(ownerId, "replace");
      return;
    }
    if (completed) {
      if (!completed.isCurrent()) { setCompleted(null); }
      else if (ownerId === completed.id && !domain.model.busy) {
        // Wait for owner publication and old form-guard cleanup, not a timer.
        setMessage(""); setCompleted(null);
        write(completed.id, unresolved ? "replace" : completed.mode);
      }
      return;
    }
    if (unresolved && ownerId) {
      serial.current++; seen.current = ownerId;
      if (parsed !== ownerId) write(ownerId, "replace");
      return;
    }
    const acknowledged = acknowledgements.current.indexOf(parsed);
    if (acknowledged !== -1) {
      acknowledgements.current.splice(0, acknowledged + 1); seen.current = parsed; return;
    }
    if (seen.current === parsed) return;
    if (domain.model.load === "loading") return;
    seen.current = parsed; acknowledgements.current = []; serial.current++;
    if (parsed !== null && ownerId !== parsed) open(parsed, "replace");
    else setMessage("");
  }, [active, scope, scopeChanged, parsed, domain, completed, unresolved, ownerId, authority, navigation, router]);

  return {
    sourceId: scopeChanged ? null : unresolved && ownerId ? ownerId : requestedId !== null ? ownerId : null,
    message, canReturn: !unresolved,
    href: id => ({ pathname: "/sources", params: serializeSourceRoute({ sourceId: id }) }),
    open: id => open(id, "push"),
    returnToIndex() {
      if (!admitted() || unresolved) return;
      serial.current++; setMessage(""); write(null, "replace");
      // Index is a presentation, not newInput: keep the same owner and both drafts.
    },
  };
}
