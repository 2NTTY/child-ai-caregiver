import { createSourceReaderPosition } from "./source-reader-position";
import { createPrivateListQueries, type PrivateListRoute } from "./private-list-query";
import { createContext, use, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

type RouteAuthority = { identityKey: string | null; scopeKey: string | null };
type NavigationAuthority = RouteAuthority & { isCurrent(): boolean; queries: ReturnType<typeof createPrivateListQueries>; sourcePosition: ReturnType<typeof createSourceReaderPosition> };
const Context = createContext<NavigationAuthority | null>(null);

/** Read-only navigation admission; domain owners continue to own all authorization and writes. */
export function NavigationAuthorityProvider({ identityKey, scopeKey, read, subscribe, children }: RouteAuthority & { read(): RouteAuthority; subscribe(listener: () => void): () => void; children: ReactNode }) {
  const queries = useMemo(() => createPrivateListQueries(read), [read]);
  const sourcePosition = useMemo(() => createSourceReaderPosition(read), [read]);
  useLayoutEffect(() => { queries.observe(); sourcePosition.observe(); return subscribe(() => { queries.observe(); sourcePosition.observe(); }); }, [queries, sourcePosition, subscribe]);
  const value = useMemo<NavigationAuthority>(() => ({ identityKey, scopeKey, queries, sourcePosition, isCurrent() {
    const live = read();
    return live.identityKey === identityKey && live.scopeKey === scopeKey;
  } }), [identityKey, scopeKey, read, queries, sourcePosition]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useNavigationAuthority() { return use(Context); }

const noSubscribe = () => () => {};
export function usePrivateListQuery(route: PrivateListRoute): [string, (query: string) => void] {
  const authority = useNavigationAuthority();
  const [local, setLocal] = useState("");
  const query = useSyncExternalStore(authority?.queries.subscribe ?? noSubscribe,
    () => authority ? authority.queries.read(route, authority) : local,
    () => "");
  return [query, value => {
    if (!authority) { setLocal(value); return; }
    if (authority.isCurrent()) authority.queries.write(route, authority, value);
  }];
}
