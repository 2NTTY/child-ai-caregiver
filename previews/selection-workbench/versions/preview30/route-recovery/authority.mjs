// Self-written RR01 synthetic adapter. Not the product Router or operation owner.
import { routeErrorReference } from './safe-reference.mjs';
export function createRecoveryAuthority({ retry, home }) {
  let live = true, active = null;
  let state = { generation: 0, scope: 'root', phase: 'loading', reference: '', attempts: 0, homeCalls: 0 };
  const listeners = new Set();
  const snapshot = () => Object.freeze({ ...state });
  const publish = () => { if (live) for (const listener of [...listeners]) { if (live && listeners.has(listener)) listener(); } };
  function settle(token, phase) {
    if (!live || active !== token || state.generation !== token.generation) return;
    active = null; state = { ...state, phase }; publish();
  }
  return {
    snapshot,
    subscribe(listener) { if (!live) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    present(scope, error) {
      if (!live || !['root', 'chat'].includes(scope)) return false;
      active = null;
      state = { ...state, generation: state.generation + 1, scope, phase: error ? 'error' : 'loading', reference: error ? routeErrorReference(error) : '' };
      publish(); return true;
    },
    requestRetry() {
      if (!live || !['error', 'rejected'].includes(state.phase)) return false;
      const token = { generation: state.generation, attempt: state.attempts + 1 };
      active = token; state = { ...state, phase: 'pending', attempts: token.attempt };
      // Lock before the callback: even a synchronous reentrant call sees pending.
      let result;
      try { result = retry(Object.freeze({ ...token })); }
      catch { settle(token, 'rejected'); return true; }
      Promise.resolve(result).then(() => settle(token, 'complete'), () => settle(token, 'rejected'));
      if (live && active === token) publish();
      return true;
    },
    returnHome() {
      if (!live || state.scope !== 'chat' || !['error', 'pending', 'rejected', 'complete'].includes(state.phase)) return false;
      const generation = state.generation;
      active = null; state = { ...state, phase: 'home', homeCalls: state.homeCalls + 1 };
      // This is only a local callback receipt, never real navigation or guard approval.
      let failed = false;
      try { home(); } catch { failed = true; }
      // Synchronous callbacks may retire this view or establish a newer scope.
      if (!live || state.generation !== generation) return true;
      if (failed) state = { ...state, phase: 'home-rejected' };
      publish(); return true;
    },
    retire() { if (!live) return; live = false; active = null; listeners.clear(); },
  };
}
