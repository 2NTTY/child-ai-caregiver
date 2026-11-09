import {useLayoutEffect, useRef} from 'react';

type ListChange = 'add' | 'remove' | 'move' | null;
type Projection = {scopeKey: string; ids: readonly string[]; eventKey: string | null; consumed: string | null; eligible: boolean};

// One explicit local operation may animate one structural change. A later refresh,
// unavailable result or scope reset must never inherit its completed receipt.
export function useContentListMotion({ids, scopeKey, eventKey, change, settled, targetId}: {
  ids: readonly string[]; scopeKey: string; eventKey: string | null; change: ListChange; settled: boolean; targetId?: string | null;
}) {
  const previous = useRef<Projection>({scopeKey, ids, eventKey: null, consumed: null, eligible: false});
  const old = previous.current;
  const sameScope = old.scopeKey === scopeKey;
  const changed = old.ids.length !== ids.length || old.ids.some((id, index) => id !== ids[index]);
  let eligible = sameScope && !changed && change !== null && old.eventKey === eventKey && old.eligible;
  if (sameScope && changed && eventKey !== null && eventKey !== old.consumed) {
    const removed = old.ids.filter(id => !ids.includes(id));
    const added = ids.filter(id => !old.ids.includes(id));
    eligible = change === 'add' ? added.length > 0 && removed.length === 0
      : change === 'remove' ? removed.length === 1 && removed[0] === targetId && added.length === 0
        : change === 'move' && removed.length === 0 && added.length === 0;
  }
  const next: Projection = {scopeKey, ids, eventKey, eligible,
    consumed: !sameScope ? eventKey : eligible || settled ? eventKey : old.consumed};
  useLayoutEffect(() => {previous.current = next;});
  return eligible;
}
