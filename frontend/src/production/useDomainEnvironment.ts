import { useEffect, useId, useMemo } from "react";
import { usePreviewLeaveGuard, type LeavePendingKind, type LeaveScope } from "../preview/PreviewNavigationGuard";
import { useProduction, useProductionOwner } from "./ProductionProvider";
import type { SharedModule, SharedSelection } from '../../../src/shared/sharing.ts';

/** One Server identity/scope for domain owners; never creates another business store. */
export function useDomainEnvironment() {
  const { owner, scopeKey, identityKey, userId, selectedChildId, online, activeChild:child, sharedChild, apiBaseUrl, queryClient } = useProduction();
  const sharedMode=!!sharedChild.target;
  const sharing=useMemo<SharedSelection|undefined>(()=>sharedChild.view&&scopeKey
    ? {spaceId:sharedChild.view.spaceId,expectedBasis:sharedChild.view.basis}:undefined,[scopeKey]);
  const modules=sharedChild.view?.modules;
  const writeReady = owner.canStartDomainWrite();
  return useMemo(() => ({
    owner, scopeKey: scopeKey ?? "", identityKey: identityKey ?? "", userId,
    childId: scopeKey ? selectedChildId : null, childName: child?.displayName ?? "", role: child?.accessRole ?? null,
    online, apiBaseUrl, queryClient, sharing, sharedMode,
    allows: (module:SharedModule|'private') => !sharedMode || module!=='private'&&!!modules?.includes(module),
    current: () => !!scopeKey && owner.getSnapshot().scopeKey === scopeKey,
    currentIdentity: () => !!identityKey && owner.getSnapshot().identityKey === identityKey,
    canStartWrite: owner.canStartDomainWrite, writeReady,
    invalidate: owner.invalidatePrivateReads,
    accessError: owner.handleDomainAccessError,
  }), [owner, scopeKey, identityKey, userId, selectedChildId, child?.displayName, child?.accessRole, online, apiBaseUrl, queryClient, writeReady,sharing,sharedMode,modules]);
}

/** Disabled facets make no request; the route gate explains the unavailable scope. */
export function forSharedModule(env:ReturnType<typeof useDomainEnvironment>,module:SharedModule|'private'|readonly SharedModule[]):ReturnType<typeof useDomainEnvironment>{
  const allowed=typeof module==='string'?env.allows(module):module.some(item=>env.allows(item));
  return allowed?env:{...env,online:false,childId:null,current:()=>false,canStartWrite:()=>false,writeReady:false};
}

/** Preserve unknown operations across navigation and block logout while outcome is unresolved. */
export function useDomainWriteGuard(dirty: boolean, pending: boolean, scope: LeaveScope = "child", retainedInWorkspace = true, pendingKind?: LeavePendingKind) {
  const owner = useProductionOwner();
  const id = useId();
  const leaveGuardId = usePreviewLeaveGuard(dirty, pending, scope, undefined, retainedInWorkspace, pendingKind);
  useEffect(() => { owner.setDomainPending(id, pending); return () => owner.setDomainPending(id, false); }, [owner, id, pending]);
  return leaveGuardId;
}
