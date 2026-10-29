import { RouteTabFocusProvider } from "./RouteTabFocus";
import { createContext, use, useMemo, useRef, useState, type ReactNode } from 'react';
// Private search, scroll and readonly disclosure state only; never domain payloads or operations.
export type PrivateRoutePresentation = { query: string; scroll: number };
const Context = createContext<Map<string, PrivateRoutePresentation> | null>(null);
export type MemoryReaderDisclosure = { details: boolean; historyOpen: boolean };
type MemoryPresentation = { scopeKey: string | null; readers: Record<string, MemoryReaderDisclosure>; returnTo: { current: string | null } };
const MemoryContext = createContext<MemoryPresentation | null>(null);
const createMemoryPresentation = (scopeKey: string | null): MemoryPresentation => ({ scopeKey, readers: {}, returnTo: { current: null } });
export function RoutePresentationProvider({ scopeKey, children }: { scopeKey: string | null; children: ReactNode }) {
  const value = useMemo(() => new Map<string, PrivateRoutePresentation>(), [scopeKey]);
  const memory = useMemo(() => createMemoryPresentation(scopeKey), [scopeKey]);
  return <RouteTabFocusProvider><Context.Provider value={value}><MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider></Context.Provider></RouteTabFocusProvider>;
}
export function usePrivateRoutePresentation(route: string) {
  const cache = use(Context);
  const local = useRef({ cache, route, value: cache?.get(route) ?? { query: '', scroll: 0 } });
  if (local.current.cache !== cache || local.current.route !== route) local.current = { cache, route, value: cache?.get(route) ?? { query: '', scroll: 0 } };
  const [, publish] = useState(0);
  const current = () => local.current.cache === cache && local.current.route === route;
  const setQuery = (query: string) => {
    if (!current() || local.current.value.query === query) return;
    const value = { ...local.current.value, query };
    local.current.value = value; cache?.set(route, value); publish(revision => revision + 1);
  };
  // Scroll restores on return; it does not affect this render's visual content.
  const rememberScroll = (scroll: number) => {
    if (!current() || !Number.isFinite(scroll)) return;
    const value = { ...local.current.value, scroll };
    local.current.value = value; cache?.set(route, value);
  };
  return [local.current.value, setQuery, rememberScroll] as const;
}


// Same-page Expo pushes remount readers. Keep their tiny presentation receipt at
// the existing scoped route boundary, not in a new data or navigation owner.
export function useMemoryReaderPresentation(scopeKey: string) {
  const shared = use(MemoryContext);
  const fallback = useMemo(() => createMemoryPresentation(scopeKey), [scopeKey]);
  const cache = shared?.scopeKey === scopeKey ? shared : fallback;
  const current = useRef(cache); current.current = cache;
  const [, publish] = useState(0);
  const setReaderStates = (update: (previous: Record<string, MemoryReaderDisclosure>) => Record<string, MemoryReaderDisclosure>) => {
    if (current.current !== cache) return;
    const next = update(cache.readers);
    if (next === cache.readers) return;
    cache.readers = next; publish(revision => revision + 1);
  };
  return { readerStates: cache.readers, setReaderStates, returnTo: cache.returnTo };
}
