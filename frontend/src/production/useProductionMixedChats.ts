import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { createMixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import { MixedChatController } from './MixedChatController.ts';
import type { ProductionOwner } from './ProductionOwner';
import type { SharingController } from './SharingController.ts';
import { useProduction } from './ProductionProvider';

type Entry = { controller: MixedChatController; bind(): void; selection(): string[]; selectChild(childId: string, selected: boolean): void };
const owners = new WeakMap<ProductionOwner, WeakMap<SharingController, Entry>>();
const personalOwners = new WeakMap<ProductionOwner, Entry>();
function controllerFor(owner: ProductionOwner, sharing?: SharingController) {
  const entries = owners.get(owner) ?? new WeakMap<SharingController, Entry>();
  const existing = sharing ? entries.get(sharing) : personalOwners.get(owner); if (existing) return existing;
  let personalSelection: string[] = [], personalIdentity: string | null = null;
  const controller = new MixedChatController(createMixedChatApi(owner.apiBaseUrl, owner.fetcher), () => {
    if (sharing) void sharing.refreshSelected(); else void owner.controller.reloadChildren();
  });
  const sync = () => {
    const snapshot = owner.getSnapshot(), state = sharing?.getSnapshot(), selected = state?.selected;
    const authenticated = snapshot.records.auth === 'signedIn' && snapshot.account.gate === 'ready';
    const ready = authenticated && (!sharing || state?.userId === snapshot.records.user?.id && state?.identityKey !== null);
    const identity = ready && snapshot.identityKey ? snapshot.identityKey + ':mixed:' + snapshot.sessionGeneration : null;
    let scope: Parameters<MixedChatController['syncContext']>[3] = null, selectionKey = '';
    if (sharing && state) {
      scope = ready && selected?.kind === 'class' ? { kind: 'class', spaceId: selected.id,
        spaceVersion: selected.version, teacherSpaceVersion: selected.teacherSpaceVersion ?? null } : null;
      selectionKey = JSON.stringify([state.rosterLoaded, [...state.classTasks.selected].sort(),
        selected?.role, selected?.teacherSpaceId,
        [...state.spaces.items, ...state.teacherClasses.items].filter(space => space.id === selected?.id)
          .map(space => [space.version, space.role, space.teacherSpaceId, space.teacherSpaceVersion]),
        state.members.items.filter(member => member.userId === state.userId).map(member => [member.version, member.role]),
        state.shares.items.map(grant => [grant.childId, grant.childName, grant.version, grant.modules])]);
    } else {
      if (personalIdentity !== identity) { personalIdentity = identity; personalSelection = []; }
      const children = snapshot.records.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined);
      personalSelection = personalSelection.filter(id => children.some(child => child.id === id));
      const known = snapshot.records.childrenLoadedAt !== null && !snapshot.records.childrenError;
      if (!known) personalSelection = [];
      scope = ready && known ? { kind: 'personal' } : null;
      selectionKey = JSON.stringify([known, [...personalSelection].sort(),
        children.map(child => [child.id, child.workspaceId, child.displayName, child.accessRole])]);
    }
    controller.syncContext(ready ? snapshot.records.user?.id ?? null : null,
      identity, snapshot.records.online, scope, selectionKey);
  };
  let unsubscribeOwner: (() => void) | undefined, unsubscribeSharing: (() => void) | undefined;
  const bind = () => { unsubscribeOwner?.(); unsubscribeSharing?.(); unsubscribeOwner = owner.subscribe(sync); unsubscribeSharing = sharing?.subscribe(sync); sync(); };
  controller.subscribe(() => { const state = controller.getSnapshot(); owner.setDomainPending('mixed-conversation:' + (sharing ? 'class' : 'personal'),
    !!state.pending || state.busy === 'write' || state.busy === 'reply'); });
  const entry: Entry = { controller, bind, selection: () => [...personalSelection], selectChild(childId, selected) {
    const state = controller.getSnapshot();
    if (sharing || !state.contextKey || state.busy || state.pending || !owner.getSnapshot().records.children.some(child => child.id === childId
      && (child.accessRole === 'owner' || child.accessRole === undefined))) return;
    personalSelection = [...personalSelection.filter(id => id !== childId), ...(selected ? [childId] : [])]; sync();
  } };
  if (sharing) { entries.set(sharing, entry); owners.set(owner, entries); } else personalOwners.set(owner, entry);
  bind(); return entry;
}
export function useProductionMixedChats(sharing?: SharingController) {
  const { owner, identityKey, sessionGeneration, userId, auth, account } = useProduction();
  const entry = useMemo(() => controllerFor(owner, sharing), [owner, sharing]);
  useLayoutEffect(() => { entry.bind(); }, [entry]);
  const current = useSyncExternalStore(entry.controller.subscribe, entry.controller.getSnapshot, entry.controller.getSnapshot);
  const expected = auth === 'signedIn' && account.gate === 'ready' && identityKey ? identityKey + ':mixed:' + sessionGeneration : null;
  const visible = current.identityKey === expected && current.userId === userId;
  const state = visible ? current : { ...current, room: null, rooms: [], messages: [], results: {}, resultErrors: [], batches: {}, batchErrors: [], draft: '',
    pending: null, busy: null, notice: null, roomsLoaded: false, nextRoomCursor: null, nextMessageCursor: null };
  return { controller: entry.controller, state, selected: visible ? entry.selection() : [], selectChild: entry.selectChild };
}
