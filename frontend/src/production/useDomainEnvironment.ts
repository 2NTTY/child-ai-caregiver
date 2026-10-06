import { useEffect, useId, useMemo } from "react";
import { usePreviewLeaveGuard, type LeaveScope } from "../preview/PreviewNavigationGuard";
import { useProduction } from "./ProductionProvider";

/** One Server identity/scope for domain owners; never creates another business store. */
export function useDomainEnvironment() {
  const { owner, scopeKey, identityKey, userId, selectedChildId, online, recordsState, apiBaseUrl, queryClient } = useProduction();
  const child = recordsState.children.find(item => item.id === selectedChildId);
  return useMemo(() => ({
    owner, scopeKey: scopeKey ?? "", identityKey: identityKey ?? "", userId,
    childId: scopeKey ? selectedChildId : null, childName: child?.displayName ?? "", role: child?.accessRole ?? null,
    online, apiBaseUrl, queryClient,
    current: () => !!scopeKey && owner.getSnapshot().scopeKey === scopeKey,
    currentIdentity: () => !!identityKey && owner.getSnapshot().identityKey === identityKey,
    canStartWrite: owner.canStartDomainWrite,
    invalidate: owner.invalidatePrivateReads,
    accessError: owner.handleDomainAccessError,
  }), [owner, scopeKey, identityKey, userId, selectedChildId, child?.displayName, child?.accessRole, online, apiBaseUrl, queryClient]);
}

/** Preserve unknown operations across navigation and block logout while outcome is unresolved. */
export function useDomainWriteGuard(dirty: boolean, pending: boolean, scope: LeaveScope = "child") {
  const { owner } = useProduction();
  const id = useId();
  usePreviewLeaveGuard(dirty, pending, scope);
  useEffect(() => { owner.setDomainPending(id, pending); return () => owner.setDomainPending(id, false); }, [owner, id, pending]);
}
