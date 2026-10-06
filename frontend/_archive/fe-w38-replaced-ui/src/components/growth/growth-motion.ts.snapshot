import {useRef} from 'react';

// resetCount is the existing per-entity confirmed-save signal, not a refresh version.
export function useGrowthFeedback(scopeKey: string, resetCount: number, contentKey: string) {
  const previous = useRef({scopeKey, resetCount, contentKey, trigger: null as string | null});
  const last = previous.current;
  if (last.scopeKey !== scopeKey) previous.current = {scopeKey, resetCount, contentKey, trigger: null};
  else {
    if (last.resetCount !== resetCount) last.trigger = last.contentKey !== contentKey ? `${resetCount}:${contentKey}` : null;
    last.resetCount = resetCount;
    last.contentKey = contentKey;
  }
  return previous.current.trigger;
}
