import { createContext, useContext, type ReactNode } from "react";
import type { GrowthActions, GrowthViewModel } from "../growth-view-model";

// Read/write injection only. A formal controller must supply the concern archive port.
export interface GrowthWorkspaceValue {
  scopeKey: string;
  model: GrowthViewModel;
  actions: GrowthActions;
}
const Context = createContext<GrowthWorkspaceValue | null>(null);

export function GrowthWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: GrowthWorkspaceValue | null; children: ReactNode;
}) {
  const current = value && scopeKey && value.scopeKey === scopeKey && value.model.scopeKey === scopeKey ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function useGrowthWorkspace() { return useContext(Context); }
