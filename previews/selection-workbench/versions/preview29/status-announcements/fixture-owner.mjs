// Original, synthetic-only owner. No product controller, persistence, timer or network.
import { createEventGate, formEvent, readEvent, operationEvent } from './source-derived.mjs';
export const channels = Object.freeze(['form', 'read', 'operation']);
export const labels = Object.freeze({ form: '表單修正', read: '資料讀取', operation: '操作結果' });
export function createFixtureOwner() {
  let generation = 1, disposed = false, mounted = true, sequence = 0;
  let history = [], entries = [], field = '合成主題', operationVisible = true;
  const listeners = new Set();
  function initial() {
    return { form: formEvent([]), read: readEvent({ state: 'stale', message: '合成的較早資料，尚未重新讀取' }), operation: operationEvent({ state: 'saved', title: '合成歷史快照', message: '這不是新完成的操作', referenceLabel: 'DEMO-01' }) };
  }
  let events = initial();
  let gates = Object.fromEntries(channels.map(key => [key, createEventGate(events[key].eventKey)]));
  const snapshot = () => ({ generation, mounted, field, entries: entries.map(e => ({ ...e })), operationVisible, events: structuredClone(events), accepted: Object.fromEntries(channels.map(key => [key, gates?.[key].snapshot() ?? { message: '', urgent: false, revision: 0 }])), history: history.map(e => ({ ...e })) });
  const notify = () => { for (const listener of listeners) listener(snapshot()); };
  function deliver(token, channel, event) {
    if (disposed || token !== generation || !channels.includes(channel)) return false;
    if (!event || typeof event.eventKey !== 'string' || typeof event.message !== 'string' || typeof event.urgent !== 'boolean') return false;
    events[channel] = { eventKey: event.eventKey, message: event.message, urgent: event.urgent };
    if (mounted && gates[channel].update(events[channel])) {
      history = [{ sequence: ++sequence, channel, ...events[channel] }, ...history].slice(0, 6);
    }
    notify(); return true;
  }
  function dispatch(action) {
    if (disposed) return false;
    if (action === 'form-error' || action === 'form-clear') {
      entries = action === 'form-error' ? [{ field: 'title', label: '主題標題', message: '請以合成文字補上主題' }] : [];
      return deliver(generation, 'form', formEvent(entries));
    }
    const readStates = { 'read-error': 'error', 'read-stale': 'stale', 'read-ready': 'ready', 'read-loading': 'loading' };
    if (readStates[action]) return deliver(generation, 'read', readEvent({ state: readStates[action], scopeKey: 'synthetic-read' }, action === 'read-loading' ? 'synthetic-read' : null));
    const operationStates = { 'operation-saved': 'saved', 'operation-failed': 'failed', 'operation-unknown': 'unknown' };
    if (operationStates[action]) return deliver(generation, 'operation', operationEvent({ state: operationStates[action], title: '合成操作', message: operationStates[action] === 'failed' ? '本次未完成，並未發送請求' : operationStates[action] === 'unknown' ? '結果未定，不自動重送' : '成功示例，不代表真實保存', referenceLabel: 'DEMO-01' }));
    if (action === 'duplicate') return deliver(generation, 'operation', events.operation);
    if (action === 'same-key-edit') return deliver(generation, 'operation', { ...events.operation, message: '同 key 的改字示例，不應重播', urgent: !events.operation.urgent });
    if (action === 'new-key-same-text') {
      const last = gates?.operation.snapshot() ?? { message: '', urgent: false };
      return deliver(generation, 'operation', { eventKey: `synthetic-new-${++sequence}`, message: last.message, urgent: last.urgent });
    }
    if (action === 'toggle-visible') { operationVisible = !operationVisible; notify(); return true; }
    return false;
  }
  return {
    snapshot, dispatch, deliver, token: () => generation,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setField(value) { if (!disposed) field = String(value).slice(0, 80); },
    setMounted(value) {
      if (disposed || mounted === value) return false;
      mounted = value;
      gates = value ? Object.fromEntries(channels.map(key => [key, createEventGate(events[key].eventKey)])) : null;
      notify(); return true;
    },
    replaceScope() {
      if (disposed) return false;
      generation++; sequence = 0; history = []; entries = []; field = '另一組合成主題'; operationVisible = true; events = initial();
      gates = mounted ? Object.fromEntries(channels.map(key => [key, createEventGate(events[key].eventKey)])) : null;
      notify(); return true;
    },
    dispose() { disposed = true; gates = null; listeners.clear(); },
  };
}
