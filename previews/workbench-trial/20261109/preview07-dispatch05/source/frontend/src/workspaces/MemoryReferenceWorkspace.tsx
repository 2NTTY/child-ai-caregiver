import { createContext, useContext, type ReactNode } from "react";
import { memoryReferenceScopeMatches, type MemoryReferenceWorkspaceValue } from "../memory-reference-view-model";

export type { MemoryReferenceWorkspaceValue } from "../memory-reference-view-model";
const Context = createContext<MemoryReferenceWorkspaceValue | null>(null);

// A read port only. No fixture, copied state, transport or memory mutation is created here.
// Independent host scope masks old snapshots immediately, before any cleanup effect.
export function MemoryReferenceWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: MemoryReferenceWorkspaceValue | null; children: ReactNode;
}) {
  const current = memoryReferenceScopeMatches(scopeKey, value) ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function useMemoryReferenceWorkspace() { return useContext(Context); }
