import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { createSharingApi } from "../../../src/client/sharing-api.ts";
import type { ProductionOwner } from "./ProductionOwner";
import { useProduction } from "./ProductionProvider";
import { SharingController, type SharingState } from "./SharingController.ts";

const controllers = new WeakMap<ProductionOwner, { controller: SharingController; bind(): void }>();
function controllerFor(owner: ProductionOwner) {
  const existing = controllers.get(owner); if (existing) return existing;
  const controller = new SharingController(createSharingApi(owner.apiBaseUrl, owner.fetcher));
  const sync = () => {
    const snapshot = owner.getSnapshot(), ready = snapshot.records.auth === "signedIn" && snapshot.account.gate === "ready";
    controller.syncContext(ready ? snapshot.records.user?.id ?? null : null,
      ready && snapshot.identityKey ? snapshot.identityKey + ":sharing:" + snapshot.sessionGeneration : null, snapshot.records.online);
  };
  let unsubscribe: (() => void) | undefined;
  const bind = () => { unsubscribe?.(); unsubscribe = owner.subscribe(sync); sync(); };
  controller.subscribe(() => { const state = controller.getSnapshot(); owner.setDomainPending("sharing-management", !!state.pending || state.busy === "write"); });
  const entry = { controller, bind }; controllers.set(owner, entry); bind(); return entry;
}

/** Identity-level management remains separate from the globally selected child. */
export function useProductionSharing() {
  const { owner, userId, identityKey, sessionGeneration, auth, account, online } = useProduction();
  const entry = useMemo(() => controllerFor(owner), [owner]), controller = entry.controller;
  useLayoutEffect(() => { entry.bind(); }, [entry]);
  const current = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const expected = auth === "signedIn" && account.gate === "ready" && identityKey ? identityKey + ":sharing:" + sessionGeneration : null;
  const state: SharingState = current.identityKey === expected && current.userId === userId ? current : {
    ...current, identityKey: null, userId: null, online, loaded: false, busy: null, spaces: { items: [], nextCursor: null }, selected: null,
    members: { items: [], nextCursor: null }, shares: { items: [], nextCursor: null }, invitations: { items: [], nextCursor: null },
    pending: null, invitationToken: null, receipt: null, notice: null,
  };
  useEffect(() => { if (state.userId && state.online && !state.loaded) void controller.loadSpaces(); }, [controller, state.identityKey, state.online]);
  return { controller, state };
}
