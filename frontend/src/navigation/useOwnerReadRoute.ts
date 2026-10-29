import { useEffect, useRef } from "react";
import { useLocalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import type { OwnerReadRouteRequest } from "./owner-read-route";

/** Selection stays with the domain owner. The URL follows only an accepted read. */
export function useOwnerReadRoute<T extends { id: string }>({ scopeKey, requestedId, items, selectedId, ready, blocked, open, href, createdSelection = false, recoveryOwnsSelection = false }: {
  scopeKey: string | null; requestedId: string | null; items: readonly T[]; selectedId: string | null;
  ready: boolean; blocked: boolean; createdSelection?: boolean; recoveryOwnsSelection?: boolean; open: (item: T, request: OwnerReadRouteRequest) => void; href: (id: string | null) => Href;
}) {
  const router = useRouter(), pathname = usePathname(), params = useLocalSearchParams();
  const routeKey = `${pathname}:${JSON.stringify(params)}`;
  const live = useRef({ scopeKey, routeKey, mounted: true });
  live.current = { scopeKey, routeKey, mounted: true };
  const previousScope = useRef(scopeKey), hasBoundScope = useRef(!!scopeKey), attempted = useRef("");
  const creation = useRef<OwnerReadRouteRequest | null>(null);
  const sameScope = previousScope.current === scopeKey || !hasBoundScope.current;
  const id = sameScope ? recoveryOwnsSelection ? selectedId : requestedId : null;
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    const wasBound = hasBoundScope.current;
    previousScope.current = scopeKey; if (scopeKey) hasBoundScope.current = true;
    attempted.current = "";
    if (wasBound) router.replace(href(null));
  }, [scopeKey]);
  function request(onAccepted: (selectedId?: string | null) => void, onRejected?: (acceptedId: string | null) => void): OwnerReadRouteRequest {
    const isCurrent = () => live.current.mounted && live.current.scopeKey === scopeKey && live.current.routeKey === routeKey;
    return { isCurrent, onAccepted: id => { if (isCurrent()) onAccepted(id); }, onRejected: id => { if (isCurrent()) onRejected?.(id); } };
  }
  useEffect(() => {
    if (sameScope && recoveryOwnsSelection && requestedId !== selectedId) router.replace(href(selectedId));
  }, [sameScope, recoveryOwnsSelection, requestedId, selectedId, scopeKey, routeKey]);
  useEffect(() => {
    if (recoveryOwnsSelection || !sameScope || !id || !ready || blocked || selectedId === id) return;
    const item = items.find(value => value.id === id), key = `${scopeKey}:${routeKey}:${id}`;
    if (!item || attempted.current === key) return;
    attempted.current = key;
    open(item, request(() => {}, acceptedId => {
      attempted.current = "";
      router.replace(href(acceptedId));
    }));
  }, [scopeKey, routeKey, id, sameScope, ready, blocked, items, selectedId, recoveryOwnsSelection]);
  useEffect(() => {
    if (!createdSelection || !selectedId || !creation.current) return;
    const pending = creation.current; creation.current = null;
    if (pending.isCurrent()) router.replace(href(selectedId));
  }, [createdSelection, selectedId]);
  return {
    create(action: () => void) { creation.current = request(() => {}); action(); },
    id, unavailable: !!id && ready && !items.some(item => item.id === id),
    request,
    openRow(item: T) {
      if (!sameScope || !ready || blocked || !items.some(value => value.id === item.id)) return;
      open(item, request(() => { if (id !== item.id) router.push(href(item.id)); }));
    },
  };
}
