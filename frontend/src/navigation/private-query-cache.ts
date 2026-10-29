/** Presentation-only, in-memory strings; never domain payloads, URLs or persistent storage. */
export function createPrivateQueryCache() {
  let activeScope: string | null = null, activeIdentity: string | null = null;
  const queries = new Map<string, string>(), listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  return {
    scope(scope: string | null, identity: string | null = null) {
      if (scope === activeScope && identity === activeIdentity) return;
      queries.clear(); activeScope = scope; activeIdentity = identity; emit();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(scope: string | null, route: string) { return (scope || activeIdentity) && scope === activeScope ? queries.get(route) ?? "" : ""; },
    set(scope: string | null, route: string, query: string) {
      if ((!scope && !activeIdentity) || scope !== activeScope || query === (queries.get(route) ?? "")) return;
      if (query) queries.set(route, query); else queries.delete(route); emit();
    },
  };
}
export const privateQueries = createPrivateQueryCache();

/** Invalidate synchronously with owner notifications, not a later screen render. */
export function bindPrivateQueries(owner: {
  getSnapshot(): { scopeKey: string | null; identityKey: string | null };
  subscribe(listener: () => void): () => void;
}) {
  const sync = () => { const snapshot = owner.getSnapshot(); privateQueries.scope(snapshot.scopeKey, snapshot.identityKey); };
  const unsubscribe = owner.subscribe(sync); sync();
  return () => { unsubscribe(); privateQueries.scope(null); };
}
