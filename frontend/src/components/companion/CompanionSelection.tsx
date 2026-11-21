import { useFocusEffect, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ChatPageItem } from '../../../../src/shared/chat-page-context';

type Selection = { childId: string; page: string; label?: string; item: ChatPageItem };
type Registry = { selection: Selection | null; select(value: Selection): () => void };
const Context = createContext<Registry | null>(null);

export function CompanionSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const select = useCallback((value: Selection) => {
    setSelection(value);
    return () => setSelection(current => current === value ? null : current);
  }, []);
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
