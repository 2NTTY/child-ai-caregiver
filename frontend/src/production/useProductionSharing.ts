import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { createSharingApi } from "../../../src/client/sharing-api.ts";
import type { ProductionOwner } from "./ProductionOwner";
import { useProduction } from "./ProductionProvider";
import { SharingController, type SharingMode, type SharingState } from "./SharingController.ts";

type Entry = { controller: SharingController; bind(): void };
const controllers = new WeakMap<ProductionOwner, Partial<Record<SharingMode, Entry>>>();
function controllerFor(owner: ProductionOwner, mode: SharingMode) {
  const modes = controllers.get(owner) ?? {}, existing = modes[mode]; if (existing) return existing;
  const controller = new SharingController(createSharingApi(owner.apiBaseUrl, owner.fetcher), mode);
  const sync = () => {
    const snapshot = owner.getSnapshot(), ready = snapshot.records.auth === "signedIn" && snapshot.account.gate === "ready";
    controller.syncContext(ready ? snapshot.records.user?.id ?? null : null,
      ready && snapshot.identityKey ? snapshot.identityKey + ":sharing:" + mode + ":" + snapshot.sessionGeneration : null, snapshot.records.online);
  };
  let unsubscribe: (() => void) | undefined;
  const bind = () => { unsubscribe?.(); unsubscribe = owner.subscribe(sync); sync(); };
  controller.subscribe(() => { const state = controller.getSnapshot(); owner.setDomainPending("sharing-management:" + mode, !!state.pending || state.busy === "write"); });
  const entry = { controller, bind }; modes[mode] = entry; controllers.set(owner, modes); bind(); return entry;
}

/** Identity-level management remains separate from the globally selected child. */
export function useProductionSharing(mode: SharingMode = "family") {
  const { owner, userId, identityKey, sessionGeneration, auth, account, online } = useProduction();
  const entry = useMemo(() => controllerFor(owner, mode), [owner, mode]), controller = entry.controller;
  useLayoutEffect(() => { entry.bind(); }, [entry]);
  const current = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const expected = auth === "signedIn" && account.gate === "ready" && identityKey ? identityKey + ":sharing:" + mode + ":" + sessionGeneration : null;
  const state: SharingState = current.identityKey === expected && current.userId === userId ? current : {
    ...current, identityKey: null, userId: null, online, loaded: false, busy: null, spaces: { items: [], nextCursor: null }, selected: null, rosterQuery: "", rosterLoaded: false,
    teacherSpaces: { items: [], nextCursor: null }, teacherClasses: { items: [], nextCursor: null }, teacherClassesLoaded: false,
    members: { items: [], nextCursor: null }, shares: { items: [], nextCursor: null }, invitations: { items: [], nextCursor: null },
    pending: null, invitationToken: null, receipt: null, notice: null,
  };
  useEffect(() => { if (state.userId && state.online && !state.loaded) void controller.loadSpaces(); }, [controller, state.identityKey, state.online]);
  return { controller, state };
}
