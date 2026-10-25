import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { useProductionOwner } from './ProductionProvider';
import { useDomainWriteGuard } from './useDomainEnvironment';

/** Read projection and editor share the ProductionOwner's single target lane. */
export function useProductionAvatar(kind: 'self' | 'child', editing = false) {
  const owner = useProductionOwner(), lane = owner.avatarOwner[kind];
  const state = useSyncExternalStore(lane.subscribe, lane.getSnapshot, lane.getSnapshot);
  useDomainWriteGuard(editing && !!state.selected, editing && (state.busy || state.unknown), kind === 'self' ? 'account' : 'child', false);
  useEffect(() => {
    if (!state.key) return;
    void lane.load();
    const focus = () => { void lane.load(); };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus);
    }
    const sub = AppState.addEventListener('change', value => { if (value === 'active') focus(); }); return () => sub.remove();
  }, [lane, state.key]);
  useEffect(() => () => { if (editing) lane.cancelSelection(); }, [lane, editing]);
  return { lane, state };
}
