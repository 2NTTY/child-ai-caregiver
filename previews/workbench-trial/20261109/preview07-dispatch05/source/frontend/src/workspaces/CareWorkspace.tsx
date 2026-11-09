import { createContext, useContext, type ReactNode } from "react";
import type { CareRecordsActions, CareRecordsViewModel } from "../care-view-model";

// Presentation injection only. The external domain controller owns reads, writes and authorization.
export interface CareWorkspaceValue {
  scopeKey: string;
  model: CareRecordsViewModel;
  actions: CareRecordsActions;
}
const Context = createContext<CareWorkspaceValue | null>(null);

// The host passes its current identity/server/child/role scope independently of the loaded value.
// No preview hook runs here; mismatched or not-yet-loaded authority is withheld synchronously.
export function CareWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: CareWorkspaceValue | null; children: ReactNode;
}) {
  const current = value && scopeKey && value.scopeKey === scopeKey && value.model.scopeKey === scopeKey ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function useCareWorkspace() { return useContext(Context); }
