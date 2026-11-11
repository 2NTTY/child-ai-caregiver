import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { createMixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import { MixedChatController } from './MixedChatController.ts';
import type { ProductionOwner } from './ProductionOwner';
import type { SharingController } from './SharingController.ts';
import { useProduction } from './ProductionProvider';

type Entry = { controller: MixedChatController; bind(): void };
const owners = new WeakMap<ProductionOwner, WeakMap<SharingController, Entry>>();
function controllerFor(owner: ProductionOwner, sharing: SharingController) {
  const entries = owners.get(owner) ?? new WeakMap<SharingController, Entry>();
  const existing = entries.get(sharing); if (existing) return existing;
  const controller = new MixedChatController(createMixedChatApi(owner.apiBaseUrl, owner.fetcher), () => { void sharing.refreshSelected(); });
  const sync = () => {
    const snapshot = owner.getSnapshot(), state = sharing.getSnapshot(), selected = state.selected;
    const ready = snapshot.records.auth === 'signedIn' && snapshot.account.gate === 'ready'
      && state.userId === snapshot.records.user?.id && state.identityKey !== null;
    const scope = ready && selected?.kind === 'class' ? { kind: 'class' as const, spaceId: selected.id,
      spaceVersion: selected.version, teacherSpaceVersion: selected.teacherSpaceVersion ?? null } : null;
    const selectionKey = JSON.stringify([state.rosterLoaded, [...state.classTasks.selected].sort(),
      selected?.role, selected?.teacherSpaceId,
      [...state.spaces.items, ...state.teacherClasses.items].filter(space => space.id === selected?.id)
        .map(space => [space.version, space.role, space.teacherSpaceId, space.teacherSpaceVersion]),
      state.members.items.filter(member => member.userId === state.userId).map(member => [member.version, member.role]),
      state.shares.items.map(grant => [grant.childId, grant.childName, grant.version, grant.modules])]);
    controller.syncContext(ready ? snapshot.records.user?.id ?? null : null,
      ready && snapshot.identityKey ? snapshot.identityKey + ':mixed:' + snapshot.sessionGeneration : null,
      snapshot.records.online, scope, selectionKey);
  };
  let unsubscribeOwner: (() => void) | undefined, unsubscribeSharing: (() => void) | undefined;
  const bind = () => { unsubscribeOwner?.(); unsubscribeSharing?.(); unsubscribeOwner = owner.subscribe(sync); unsubscribeSharing = sharing.subscribe(sync); sync(); };
  controller.subscribe(() => { const state = controller.getSnapshot(); owner.setDomainPending('mixed-conversation', !!state.pending || state.busy === 'write' || state.busy === 'reply'); });
  const entry = { controller, bind }; entries.set(sharing, entry); owners.set(owner, entries); bind(); return entry;
}
export function useProductionMixedChats(sharing: SharingController) {
  const { owner, identityKey, sessionGeneration, userId, auth, account } = useProduction();
  const entry = useMemo(() => controllerFor(owner, sharing), [owner, sharing]);
  useLayoutEffect(() => { entry.bind(); }, [entry]);
  const current = useSyncExternalStore(entry.controller.subscribe, entry.controller.getSnapshot, entry.controller.getSnapshot);
  const expected = auth === 'signedIn' && account.gate === 'ready' && identityKey ? identityKey + ':mixed:' + sessionGeneration : null;
  const visible = current.identityKey === expected && current.userId === userId;
  const state = visible ? current : { ...current, room: null, rooms: [], messages: [], results: {}, resultErrors: [], draft: '',
    pending: null, busy: null, notice: null, roomsLoaded: false, nextRoomCursor: null, nextMessageCursor: null };
  return { controller: entry.controller, state };
}
