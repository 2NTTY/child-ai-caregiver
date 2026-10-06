import { createContext, useContext, type ReactNode } from "react";
import type { ProfileActions, ProfileViewModel } from "../profile-view-model";
import type { ChildMeasurementsProjection, ChildProfileSourceProjection } from "../child-overview-view-model";

// Presentation injection only. The external domain controller owns reads, writes and authorization.
export interface ProfileWorkspaceValue {
  scopeKey: string;
  model: ProfileViewModel;
  actions: ProfileActions;
  dataLabel?: string;
  measurements?: ChildMeasurementsProjection;
  profileSource?: ChildProfileSourceProjection;
}
const Context = createContext<ProfileWorkspaceValue | null>(null);

// The host passes its current identity/server/child/role scope independently of the loaded value.
// No preview hook runs here; mismatched or not-yet-loaded authority is withheld synchronously.
export function ProfileWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: ProfileWorkspaceValue | null; children: ReactNode;
}) {
  const current = value && scopeKey && value.scopeKey === scopeKey ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function useProfileWorkspace() { return useContext(Context); }
