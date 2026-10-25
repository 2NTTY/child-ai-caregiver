import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

const childId = '00000000-0000-4000-8000-000000000001', documentId = '00000000-0000-4000-8000-000000000002';
const seed = () => ({ id: documentId, childId, kind: 'preparation', purpose: 'appointment', version: 1, status: 'active', archivedAt: null,
  current: { id: '10000000-0000-4000-8000-000000000001', version: 1, generatedAt: '2026-10-24T00:00:00Z', sourceBasis: 'synthetic',
    title: 'Synthetic preparation', summary: '', ageLabel: 'unknown', period: { from: '2026-10-01', to: '2026-10-24' }, eventDate: null, coverageNote: '',
    sections: [{ id: 'checklist', title: 'Checklist', kind: 'checklist', domain: null, items: ['a', 'b'].map(id => ({ id, text: id, sourceIds: [], checked: false })) }],
    sources: [], changes: [] }, history: [], readState: 'ready', autoRefresh: false });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('shared document owner batches continuous clicks, flushes on leave and recovers the original unknown operation', async t => {
  let now = 10000, live = true, document = seed(), value, release, loseReply = false;
  const realNow = Date.now; Date.now = () => now; t.after(() => { Date.now = realNow; });
  const jobs = [], writes = [], reads = [], receipts = new Map(), leases = new Map(); let guard;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const owner = { fetcher: async (url, options) => {
    if (options.method === 'GET') { reads.push(url); return json({ page: { authorityVersion: 'authority', canManage: true, items: [document], hasMore: false } }); }
    const body = JSON.parse(options.body); writes.push(body);
    if (release) await release.promise;
    if (receipts.has(body.opId)) return json({ item: receipts.get(body.opId) });
    if (body.change.expectedVersion !== document.version) return json({ error: { code: 'document_changed' } }, 409);
    const next = structuredClone(document); next.version++; next.current.version++; next.current.id = `10000000-0000-4000-8000-${String(next.version).padStart(12, '0')}`;
    for (const check of body.change.checks) next.current.sections[0].items.find(item => item.id === check.itemId).checked = check.checked;
    document = next; receipts.set(body.opId, structuredClone(next));
    if (loseReply) { loseReply = false; throw new Error('Synthetic lost reply'); }
    return json({ item: next });
  } };
  const env = { owner, apiBaseUrl: '/api', userId: 'synthetic-parent', childId, childName: 'Synthetic', role: 'owner', online: true,
    scopeKey: 'synthetic-parent:child', current: () => live, canStartWrite: () => leases.size === 0, invalidate() {} };
  const runtime = { lost: false, live: () => live, accessError: () => false, read: (_key, action, signal) => action(signal),
    request(action) { const job = action(new AbortController().signal, () => live); jobs.push(job); return job; } };
  const mocks = {
    './task-knowledge-runtime': { useTaskKnowledgeRuntime: () => runtime, useTaskKnowledgeRefresh() {} },
    './useDomainEnvironment': { useDomainWriteGuard(dirty, pending, scope, retained) { guard = { dirty, pending, scope, retained }; if (pending) leases.set('documents', true); else leases.delete('documents'); } },
    '../platform/file-export': { exportBlob() { throw new Error('No export'); } },
  };
  const h = harness(mocks);
  mocks['./task-knowledge-runtime'].useTaskKnowledgeRefresh = h.load('src/production/task-knowledge-runtime.ts').useTaskKnowledgeRefresh;
  env.invalidate = h.load('../src/client/online-refresh-events.ts').publishOnlineRefresh;
  const { useFamilyDocuments } = h.load('src/production/useFamilyDocuments.ts');
  function Host() { value = useFamilyDocuments(env); return null; }
  const render = () => h.render(h.jsx(Host, {}));
  const settle = async () => { do { while (jobs.length) await jobs.shift(); render(); } while (jobs.length); };
  const tickSave = () => { const entry = [...h.timers].find(([, timer]) => timer.ms <= 3000); assert.ok(entry, 'background timer'); h.timers.delete(entry[0]); entry[1].fn(); render(); };
  const click = (id, checked) => { value.preparation.actions.checkItem(documentId, value.preparation.model.selected.version, 'checklist', id, checked); render(); };
  const checked = id => value.preparation.model.selected.revision.sections[0].items.find(item => item.id === id).checked;
  render(); await settle(); value.preparation.actions.selectDocument(documentId); render();
  click('a', true); assert.equal(checked('a'), true); assert.equal(writes.length, 0); assert.equal(guard.dirty, true);
  click('a', false); assert.equal(guard.dirty, false); assert.equal(h.timers.size, 0, 'reverted changes need no write');
  click('a', true); now += 1000; click('b', true);
  assert.equal([...h.timers.values()][0].ms, 3000, 'last click resets idle delay');
  release = deferred(); now += 3000; tickSave();
  assert.equal(writes.length, 1); assert.equal(writes[0].change.checks.length, 2);
  assert.equal(value.preparation.model.busy, false); assert.equal(value.preparation.model.capabilities.checkItem, true);
  click('a', false); assert.equal(checked('a'), false);
  value.flushChecks(); render(); assert.equal(writes.length, 1); assert.equal(guard.retained, true);
  release.resolve(); release = null; await settle();
  assert.equal(checked('a'), false); tickSave(); await settle();
  assert.equal(writes.length, 2); assert.equal(writes[1].change.expectedVersion, 2);
  assert.deepEqual(writes[1].change.checks, [{ sectionId: 'checklist', itemId: 'a', checked: false }]);
  assert.equal(document.version, 3); assert.equal(reads.length, 1, 'successful batches do not read the whole list');
  assert.equal(guard.pending, false); assert.equal(guard.dirty, false);

  click('a', true); now += 3000; loseReply = true; tickSave(); await settle();
  const original = writes.at(-1); assert.equal(value.preparation.model.checkSave, 'unknown'); assert.equal(h.timers.size, 0);
  value.preparation.recovery.checkOriginalOperation(); await settle();
  value.preparation.recovery.retryOriginalOperation(); await settle();
  assert.deepEqual(writes.at(-1), original); assert.equal(document.version, 4); assert.equal(guard.dirty, false);

  click('b', false); document = { ...document, version: 5, current: { ...document.current, version: 5 } };
  now += 3000; tickSave(); await settle();
  assert.equal(value.preparation.model.checkSave, 'conflict'); assert.equal(h.timers.size, 0);
  value.preparation.recovery.reloadCurrent(); await settle(); assert.equal(value.preparation.model.canReapplyChecks, true);
  value.preparation.actions.reapplyChecks(); render(); tickSave(); await settle();
  assert.equal(document.version, 6); assert.equal(document.current.sections[0].items[1].checked, false);
  click('b', true); env.online = false; render();
  assert.equal(value.preparation.model.checkSave, 'conflict'); assert.equal(h.timers.size, 0);
  env.online = true; render(); await settle();
  assert.equal(h.timers.size, 0, 'reconnect must not silently replay an offline draft');
  value.preparation.recovery.reloadCurrent(); await settle(); value.preparation.actions.discardChecks(); await settle();
  click('a', false); const count = writes.length; live = false; now += 3000; tickSave();
  assert.equal(writes.length, count, 'late scope response cannot save'); h.unmount();
});
