/** LOCAL SYNTHETIC HOST ONLY. Not HandoverImportOwner, authority or a production adapter. */
const gates = Object.freeze({ ready: null, offline: 'offline', 'importer-offline': 'importer_offline', identity: 'identity_not_current', 'account-not-ready': 'account_not_ready', 'import-busy': 'importer_busy', pending: 'importer_pending', 'account-busy': 'account_busy', deletion: 'account_deletion' });
const baseRows = [
  { id: 'syn-cln-1104-a', filename: '晨光交接_合成示例.zip', createdAt: '2026-11-04T01:12:00Z', expiresAt: '2026-11-04T03:12:00Z', state: 'expired', error: null, expectedArchiveSha256: 'a73c08e1'.repeat(8) },
  { id: 'syn-cln-1102-b', filename: '雨後小徑_合成示例.zip', createdAt: '2026-11-02T08:45:00Z', expiresAt: '2026-11-02T10:45:00Z', state: 'failed', error: 'invalid_archive', expectedArchiveSha256: '6ef3b9d2'.repeat(8) },
  { id: 'syn-cln-1028-c', filename: '週末備忘_合成示例.zip', createdAt: '2026-10-28T10:30:00Z', expiresAt: '2026-10-28T12:30:00Z', state: 'cancelled', error: null },
  { id: 'syn-cln-undated-d', filename: '日期待核_合成示例.zip', createdAt: null, expiresAt: 'unknown', state: 'failed', error: 'response_unconfirmed' },
  { id: 'syn-cln-1025-e', filename: '晨光交接_合成示例.zip', createdAt: '2026-10-25T01:12:00Z', expiresAt: '2026-10-25T03:12:00Z', state: 'ready', error: null, expectedArchiveSha256: '79ab421c'.repeat(8) },
];
const project = row => Object.freeze({ id: String(row.id), filename: String(row.filename), createdAt: row.createdAt ?? null, expiresAt: row.expiresAt ?? null, state: String(row.state), error: row.error == null ? null : String(row.error), ...(typeof row.expectedArchiveSha256 === 'string' ? { expectedArchiveSha256: row.expectedArchiveSha256 } : {}) });
function dedupe(rows, prior = []) {
  const result = [...prior], ids = new Set(prior.map(row => row.id));
  for (const row of rows) if (!ids.has(row.id)) { ids.add(row.id); result.push(project(row)); }
  return Object.freeze(result);
}
export function createSyntheticHost({ schedule = fn => setTimeout(fn, 650), cancel = clearTimeout } = {}) {
  const listeners = new Set(); let bindingKey = Object.freeze({}), gate = 'ready', scenario = 'normal', held = false, pending = null, timer = null, lastDiscarded = null, serial = 0, accepted = 0, ignored = 0, epoch = 1;
  let data = { items: dedupe(baseRows.slice(0, 3)), loaded: true, loading: false, error: null, nextCursor: 'synthetic-page-2' };
  const getSnapshot = () => Object.freeze({ bindingKey, ...data, readAvailability: Object.freeze({ canRead: gate === 'ready' && !data.loading, canReadMore: gate === 'ready' && !data.loading && data.loaded && !!data.nextCursor, lockedReasons: Object.freeze(gates[gate] ? [gates[gate]] : data.loading ? ['importer_busy'] : []) }) });
  const getHarnessSnapshot = () => ({ pending, lastDiscarded, held, scenario, gate, epoch, accepted, ignored });
  const emit = () => listeners.forEach(fn => fn());
  const invalidate = () => { if (pending) lastDiscarded = pending; pending = null; if (timer !== null) cancel(timer); timer = null; data = { ...data, loading: false }; };
  const defaultOutcome = token => {
    if (scenario === 'first-error' || scenario === 'reload-error' && !token.more || scenario === 'more-error' && token.more) return { error: { status: 503, code: 'synthetic_unavailable' } };
    if (scenario === 'forbidden') return { error: { status: 403, code: 'synthetic_forbidden' } };
    if (scenario === 'empty') return { items: [], nextCursor: null };
    if (scenario === 'empty-page' && !token.more) return { items: [], nextCursor: 'synthetic-page-2' };
    return token.more ? { items: baseRows.slice(1), nextCursor: null } : { items: baseRows.slice(0, 3), nextCursor: 'synthetic-page-2' };
  };
  const complete = (token, supplied) => {
    if (!token || pending !== token || token.bindingKey !== bindingKey || gate !== 'ready') { ignored++; emit(); return false; }
    const outcome = supplied ?? defaultOutcome(token);
    if (timer !== null) cancel(timer); timer = null; pending = null;
    if (outcome.error) {
      const error = Object.freeze({ status: Number(outcome.error.status) || 0, code: String(outcome.error.code || 'synthetic_unavailable') });
      data = { ...(error.status === 403 ? { items: Object.freeze([]), loaded: false, nextCursor: null } : data), loading: false, error };
    } else {
      data = { items: dedupe(outcome.items, token.more ? data.items : []), loaded: true, loading: false, error: null, nextCursor: outcome.nextCursor ?? null };
    }
    emit(); return true;
  };
  const begin = (observedBinding, more) => {
    const live = getSnapshot();
    if (observedBinding !== bindingKey || !(more ? live.readAvailability.canReadMore : live.readAvailability.canRead)) return false;
    const token = Object.freeze({ bindingKey, serial: ++serial, more, cursor: more ? data.nextCursor : null });
    pending = token; accepted++; data = { ...data, loading: true, error: null }; emit();
    if (!held) timer = schedule(() => complete(token));
    return true;
  };
  const rotateIdentity = () => { invalidate(); bindingKey = Object.freeze({}); epoch++; data = { items: Object.freeze([]), loaded: false, loading: false, error: null, nextCursor: null }; emit(); };
  const setScenario = name => {
    if (!['normal', 'unread', 'empty', 'empty-page', 'first-error', 'reload-error', 'more-error', 'forbidden'].includes(name)) return;
    invalidate(); bindingKey = Object.freeze({}); epoch++; scenario = name; gate = 'ready';
    const unread = name === 'unread' || name === 'first-error';
    data = { items: unread || name === 'empty' || name === 'empty-page' ? Object.freeze([]) : dedupe(baseRows.slice(0, 3)), loaded: !unread, loading: false, error: null, nextCursor: unread || name === 'empty' ? null : 'synthetic-page-2' }; emit();
  };
  return Object.freeze({
    getSnapshot, getHarnessSnapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    readCleanedHistory: key => begin(key, false),
    readMoreCleanedHistory: key => begin(key, true),
    complete, rotateIdentity, setScenario,
    setGate(next) { if (!(next in gates)) return; invalidate(); gate = next; if (next === 'identity' || next === 'account-not-ready') rotateIdentity(); else emit(); },
    setHeld(value) { held = !!value; if (held && timer !== null) { cancel(timer); timer = null; } else if (!held && pending && timer === null) { const token = pending; timer = schedule(() => complete(token)); } emit(); },
    replayDiscarded() { return complete(lastDiscarded); },
    dispose() { invalidate(); listeners.clear(); },
  });
}
