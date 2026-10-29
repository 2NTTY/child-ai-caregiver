import { createContext, use, useMemo, type ReactNode } from "react";

type ScopeSnapshot = { identityKey: string | null; scopeKey: string | null };
type NavigationScope = { key: string; isCurrent(): boolean };
const Context = createContext<NavigationScope | null>(null);

// A narrow admission check, not a second owner. The immediate owner snapshot
// closes the gap between an identity/child change and React's next render.
export function NavigationScopeProvider({ identityKey, scopeKey, getSnapshot, children }: ScopeSnapshot & {
  getSnapshot(): ScopeSnapshot; children: ReactNode;
}) {
  const value = useMemo(() => ({
    key: JSON.stringify([identityKey, scopeKey]),
    isCurrent() {
      const live = getSnapshot();
      return live.identityKey === identityKey && live.scopeKey === scopeKey;
    },
  }), [identityKey, scopeKey, getSnapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useNavigationScope() { return use(Context); }
