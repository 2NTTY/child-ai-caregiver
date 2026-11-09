import {useRef} from 'react';
import type {ContactViewModel} from '../../contact-view-model';

export function useContactFeedback(model: ContactViewModel, target: string, contentKey: string) {
  const scopeKey = `${model.scopeKey}:${model.userId}:${model.access}:${target}`;
  const state = useRef({scopeKey, before: contentKey, reference: null as string | null, trigger: null as string | null});
  if (state.current.scopeKey !== scopeKey) state.current = {scopeKey, before: contentKey, reference: null, trigger: null};
  const pending = model.pending;
  const pendingTarget = pending?.decision.kind === 'consent' ? 'consent' : pending?.decision.kind === 'authorization' ? `grant:${pending.decision.taskId}` : null;
  if (pending && pendingTarget === target && state.current.reference !== pending.reference) {
    state.current.reference = pending.reference;
    state.current.before = contentKey;
  }
  if (model.operation === 'saved' && !model.busy && !pending && state.current.reference) {
    state.current.trigger = state.current.before !== contentKey ? state.current.reference : null;
    state.current.reference = null;
  } else if (['none', 'failed', 'conflict'].includes(model.operation) && !pending) state.current.reference = null;
  return {scopeKey, trigger: state.current.trigger};
}
