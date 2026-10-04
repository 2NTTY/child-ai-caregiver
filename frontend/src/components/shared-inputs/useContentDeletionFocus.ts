import {useCallback, useLayoutEffect, useRef} from 'react';
import {Platform, View} from 'react-native';

type Operation = {state: string; phase: string | null; reference: string | null};
type Attempt = {scopeKey: string; targetId: string; order: readonly string[]; previousReference: string | null; reference: string | null};

export function useContentDeletionFocus({scopeKey, ids, visible, available, operation}: {
  scopeKey: string; ids: readonly string[]; visible: boolean; available: boolean; operation: Operation;
}) {
  const listRef = useRef<View>(null);
  const rowRefs = useRef(new Map<string, View>());
  const attempt = useRef<Attempt | null>(null);
  const mounted = useRef(true);
  const closed = useRef(!visible);
  const latest = useRef({scopeKey, ids, visible, available, operation});
  latest.current = {scopeKey, ids, visible, available, operation};

  const restore = useCallback(() => {
    const current = latest.current, pending = attempt.current;
    if (!mounted.current || !closed.current || current.visible || !current.available || !pending || pending.scopeKey !== current.scopeKey
      || current.operation.phase !== 'delete' || current.operation.state !== 'saved' || !pending.reference
      || current.operation.reference !== pending.reference || current.ids.includes(pending.targetId)) return;
    // Consume once; late modal callbacks or ordinary refreshes cannot replay focus.
    attempt.current = null;
    const index = pending.order.indexOf(pending.targetId);
    const candidates = [...pending.order.slice(index + 1), ...pending.order.slice(0, index).reverse(), ...current.ids]
      .filter(id => current.ids.includes(id));
    for (const node of [...candidates.map(id => rowRefs.current.get(id)), listRef.current]) {
      if (!node) continue;
      if (Platform.OS === 'web') {
        const element = node as unknown as HTMLElement;
        if (!element.isConnected || element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
          || element.closest('[inert]') || !element.getClientRects().length) continue;
        element.focus({preventScroll: true});
        if (!element.contains(document.activeElement)) continue;
      } else node.focus();
      return;
    }
  }, []);

  useLayoutEffect(() => {
    const pending = attempt.current;
    if (visible) closed.current = false;
    if (pending && (pending.scopeKey !== scopeKey || ['failed', 'conflict', 'confirmed_unavailable'].includes(operation.state)
      || operation.state === 'saved' && !available)) {
      attempt.current = null;
    } else if (pending && operation.phase === 'delete' && operation.reference && operation.reference !== pending.previousReference) {
      pending.reference ??= operation.reference;
    }
    // If an unknown operation was checked after its dialog already closed, no new
    // modal dismissal is needed. Otherwise onClosed waits for the focus trap exit.
    restore();
  }, [scopeKey, ids, visible, available, operation.state, operation.phase, operation.reference, restore]);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false; attempt.current = null;};}, []);

  return {listRef,
    rowRef: (id: string, node: View | null) => {if (node) rowRefs.current.set(id, node); else rowRefs.current.delete(id);},
    start: (targetId: string) => {
      const current = latest.current;
      attempt.current = {scopeKey: current.scopeKey, targetId, order: [...current.ids], previousReference: current.operation.reference, reference: null};
    },
    onClosed: () => {closed.current = true; restore();},
  };
}
