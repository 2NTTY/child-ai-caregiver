type Scope = { identityKey: string | null; scopeKey: string | null };
export type SourceReaderPosition = { originId: string; scrollOffset: number };
/** A single return position, not a source payload or persistent store. */
export function createSourceReaderPosition(read: () => Scope) {
  let scope = read(), position: SourceReaderPosition | null = null;
  function observe() {
    const live = read();
    if (scope.identityKey !== live.identityKey || scope.scopeKey !== live.scopeKey) { scope = live; position = null; }
  }
  const current = (expected: Scope) => {
    const live = read();
    return !!live.identityKey && !!live.scopeKey && live.identityKey === scope.identityKey && live.scopeKey === scope.scopeKey
      && live.identityKey === expected.identityKey && live.scopeKey === expected.scopeKey;
  };
  return { observe, read(expected: Scope) { return current(expected) ? position : null; },
    write(expected: Scope, next: SourceReaderPosition) { observe(); if (current(expected)) position = { originId: next.originId, scrollOffset: Math.max(0, next.scrollOffset) }; },
  };
}
