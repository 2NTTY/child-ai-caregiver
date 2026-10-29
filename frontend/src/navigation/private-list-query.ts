export type PrivateListRoute = "tasks" | "history";
type Scope = { identityKey: string | null; scopeKey: string | null };
/** Only two private search strings; no domain data, storage, URL or cross-scope retention. */
export function createPrivateListQueries(read: () => Scope) {
  let scope: Scope = read(), queries: Partial<Record<PrivateListRoute, string>> = {};
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  function observe() {
    const live = read();
    if (live.identityKey !== scope.identityKey || live.scopeKey !== scope.scopeKey) { scope = live; queries = {}; emit(); }
    return live;
  }
  function current(route: PrivateListRoute, expected: Scope) {
    const live = read();
    return live.identityKey === scope.identityKey && live.scopeKey === scope.scopeKey && !!live.identityKey && (route === "history" || !!live.scopeKey) && live.identityKey === expected.identityKey && live.scopeKey === expected.scopeKey;
  }
  return {
    observe,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read(route: PrivateListRoute, expected: Scope) { return current(route, expected) ? queries[route] ?? "" : ""; },
    write(route: PrivateListRoute, expected: Scope, query: string) { observe(); if (current(route, expected) && queries[route] !== query) { queries[route] = query; emit(); } },
    clear() { queries = {}; scope = read(); emit(); },
  };
}
