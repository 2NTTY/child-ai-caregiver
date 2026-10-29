import { createContext, use, useMemo, useRef, type ReactNode } from "react";

// indexRequested is only accepted reading presentation, never a domain selection.
type Position = { scopeKey: string; selectedId: string | null; origin: { id: string; scrollOffset: number } | null; focusNode: HTMLElement | null; indexRequested?: boolean };
type Boundary = { pathname: string | null; scopeKey: string | null; identityKey: string | null };
type PositionPort = {
  state: Boundary;
  actions: { read(): Position | null; write(position: Position | null): void };
  meta: { isCurrent(): boolean };
};
const ReaderPositionContext = createContext<PositionPort | null>(null);
function createPositionPort(state: Boundary, isCurrent: () => boolean): PositionPort {
  let position: Position | null = null;
  return { state, meta: { isCurrent }, actions: {
    read() { if (!isCurrent()) position = null; return position; },
    write(value) { position = isCurrent() ? value : null; },
  } };
}

/** Only reading position survives same-page route remounts; never source text or drafts. */
export function ReaderPositionProvider({ pathname, scopeKey, identityKey, isCurrent, children }: {
  pathname: string; scopeKey: string | null; identityKey: string | null; isCurrent(): boolean; children: ReactNode;
}) {
  const latest = useRef({ pathname, scopeKey, identityKey, isCurrent }); latest.current = { pathname, scopeKey, identityKey, isCurrent };
  const port = useMemo(() => createPositionPort({ pathname, scopeKey, identityKey }, () => {
    const live = latest.current;
    return live.pathname === pathname && live.scopeKey === scopeKey && live.identityKey === identityKey && live.isCurrent();
  }), [pathname, scopeKey, identityKey]);
  return <ReaderPositionContext value={port}>{children}</ReaderPositionContext>;
}

export function useReaderPosition() {
  const shared = use(ReaderPositionContext);
  const local = useMemo(() => createPositionPort({ pathname: null, scopeKey: null, identityKey: null }, () => true), []);
  return shared ?? local;
}
