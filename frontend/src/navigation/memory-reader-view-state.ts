type Scope = { identityKey: string | null; scopeKey: string | null };
export type MemoryFactDisclosure = { details: boolean; historyOpen: boolean };
export type MemoryReaderDisclosures = Readonly<Record<string, MemoryFactDisclosure & { version: number }>>;
export const emptyMemoryDisclosures: MemoryReaderDisclosures = Object.freeze({});

/** Reversible reader flags only; bounded to the current authorized loaded facts. */
export function createMemoryReaderViewState(read: () => Scope) {
  const readKeys = (): Scope => { const { identityKey, scopeKey } = read(); return { identityKey, scopeKey }; };
  let scope = readKeys();
  let value = emptyMemoryDisclosures;
  let eligible = new Map<string, number>();
  let revision = 0;
  const listeners = new Set<() => void>();
  function emit() { revision += 1; listeners.forEach(listener => listener()); }
  function observe() {
    const live = read();
    if (live.identityKey !== scope.identityKey || live.scopeKey !== scope.scopeKey) {
      scope = { identityKey: live.identityKey, scopeKey: live.scopeKey }; value = emptyMemoryDisclosures; eligible = new Map(); emit();
    }
  }
  function current(expected: Scope | null) {
    const live = read();
    return expected === scope && !!live.identityKey && !!live.scopeKey && live.identityKey === scope.identityKey && live.scopeKey === scope.scopeKey;
  }
  return {
    observe,
    getRevision: () => revision,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    capture(scopeKey: string) { return current(scope) && scopeKey === scope.scopeKey ? scope : null; },
    get(expected: Scope | null) { return current(expected) ? value : emptyMemoryDisclosures; },
    reconcile(expected: Scope | null, facts: readonly { id: string; version: number }[]) {
      observe(); if (!current(expected)) return;
      const versions = new Map<string, number>();
      for (const fact of facts) if (!versions.has(fact.id)) versions.set(fact.id, fact.version);
      eligible = versions;
      const entries = Object.entries(value).filter(([id, item]) => versions.get(id) === item.version);
      if (entries.length !== Object.keys(value).length) { value = Object.fromEntries(entries); emit(); }
    },
    write(expected: Scope | null, id: string, version: number, next: MemoryFactDisclosure) {
      observe(); if (!current(expected) || eligible.get(id) !== version) return;
      const previous = value[id];
      if (previous?.version === version && previous.details === next.details && previous.historyOpen === next.historyOpen) return;
      value = { ...value, [id]: { version, details: next.details, historyOpen: next.historyOpen } }; emit();
    },
  };
}
