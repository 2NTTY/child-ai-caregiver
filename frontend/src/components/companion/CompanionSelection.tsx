import { useFocusEffect, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useProduction } from '../../production/ProductionProvider';
import type { ChatPageItem } from '../../../../src/shared/chat-page-context';

type Selection = { childId: string; page: string; label?: string; item: ChatPageItem };
type Registry = { selection: Selection | null; select(value: Selection): () => void };
const Context = createContext<Registry | null>(null);

export function CompanionSelectionProvider({ children }: { children: ReactNode }) {
  const { scopeKey, selectedChildId, sharedChild, chatState } = useProduction();
  const scope = !sharedChild.target && chatState.selectedChildId === selectedChildId ? scopeKey : null;
  const [entry, setEntry] = useState<{ scope: string; value: Selection } | null>(null);
  const selection = scope && entry?.scope === scope ? entry.value : null;
  useLayoutEffect(() => { setEntry(current => current?.scope === scope ? current : null); }, [scope]);
  const select = useCallback((value: Selection) => {
    if (!scope || selectedChildId !== value.childId) return () => {};
    const next = { scope, value };
    setEntry(next);
    return () => setEntry(current => current === next ? null : current);
  }, [scope, selectedChildId]);
  return <Context.Provider value={useMemo(() => ({ selection, select }), [selection, select])}>{children}</Context.Provider>;
}
export function useCompanionSelection() { return useContext(Context)?.selection; }

// Only a mounted, focused detail can nominate a saved reference. Never register form values.
export function useSavedPageItem(kind: ChatPageItem['kind'], childId: string, id: string, version: number, visible = true, snapshotId?: string, label?: string) {
  const select = useContext(Context)?.select, page = usePathname();
  useFocusEffect(useCallback(() => {
    if (select && visible) return select({ page, childId, label, item: { kind, id, version, ...(snapshotId ? { snapshotId } : {}) } });
  }, [select, visible, page, childId, kind, id, version, snapshotId, label]));
}
