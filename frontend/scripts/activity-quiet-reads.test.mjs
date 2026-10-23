import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

// Actual list owner with synthetic API/fetch ports; no browser, model or writes.
const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (!name.startsWith('.')) return require(name);
    const target = path.resolve(path.dirname(file), name); return load(existsSync(target) ? target : `${target}.ts`);
  }, module, module.exports); return module.exports;
}
const { ProductAgentOwner } = load('frontend/src/production/ProductAgentOwner.ts');
const { ProductAgentApiError } = load('src/client/product-agent-api.ts');
const id = '11111111-1111-4111-8111-111111111111', time = '2026-10-23T00:00:00Z';
const scope = child => ({ key: child, userId: 'synthetic-user', childId: child });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
const proposal = (key = 'p') => ({ id: key, runId: id, version: 1, kind: 'memory_fact', status: 'pending', createdAt: time, expiresAt: '2099-01-01T00:00:00Z', result: null,
  value: { kind: 'memory_fact', key, content: 'Synthetic fact', intendedVisibility: 'private', validUntil: null } });
const page = (entries = [proposal()], cursor = null) => ({ proposals: entries, nextCursor: cursor });
const result = (entries = []) => ({ runId: id, status: 'completed', text: 'Synthetic result', counts: {}, tools: [], citations: [], proposals: entries });
function setup(t) {
  const calls = [];
  const port = { pending: async () => page(), inbox: async () => Response.json({ runs: [{ runId: id, createdAt: time }] }), run: async () => result(), decide: async () => { throw new Error('No automatic writes allowed'); } };
  const api = { getPendingProposals: (...args) => { calls.push(['pending', ...args]); return port.pending(...args); }, getRun: (...args) => { calls.push(['run', ...args]); return port.run(...args); }, decideProposal: (...args) => { calls.push(['write', ...args]); return port.decide(...args); } };
  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => api, (url, options) => { calls.push(['inbox', url, options]); return port.inbox(url, options); });
  owner.syncContext(scope('child-a'), true); t.after(() => owner.dispose());
  return { owner, calls, port, count: type => calls.filter(call => call[0] === type).length };
}

test('activity auto-read uses only pending and inbox GETs without putting the run into busy/read', async t => {
  const h = setup(t), runModel = h.owner.getSnapshot().model;
  h.owner.readActivity(); assert.equal(h.owner.getSnapshot().model, runModel);
  await tick(); await tick();
  assert.equal(h.count('pending'), 1); assert.equal(h.count('inbox'), 1); assert.equal(h.count('run'), 0); assert.equal(h.count('write'), 0);
  assert.equal(h.owner.getSnapshot().pending.state, 'ready'); assert.equal(h.owner.getSnapshot().inbox.state, 'ready'); assert.equal(h.owner.getSnapshot().model, runModel);
});

test('quiet pending revalidates its full loaded depth atomically and leaves the original run projection untouched', async t => {
  const h = setup(t); h.port.pending = async (_child, _signal, _user, cursor) => cursor ? page([proposal('tail')]) : page([proposal('head')], 'next');
  await h.owner.readPending(); await h.owner.readPending(true);
  h.owner.selectRun(id); await tick(); const runModel = h.owner.getSnapshot().model;
  const gate = deferred(); h.port.pending = async (_child, _signal, _user, cursor) => cursor ? gate.promise : page([proposal('new-head')], 'new-next');
  const before = h.owner.getSnapshot().pending, reading = h.owner.readPending(false, true); await tick();
  assert.equal(h.owner.getSnapshot().pending, before); assert.equal(h.owner.getSnapshot().model, runModel);
  gate.resolve(page([proposal('new-tail')])); await reading;
  assert.deepEqual(h.owner.getSnapshot().pending.entries.map(entry => entry.proposal.id), ['new-head', 'new-tail']); assert.equal(h.owner.getSnapshot().model, runModel);
  assert.equal(h.count('write'), 0);
});

test('quiet inbox transient failure retains the loaded snapshot and never self-retries', async t => {
  const h = setup(t); await h.owner.readInbox(); const before = h.owner.getSnapshot().inbox, gate = deferred();
  h.port.inbox = () => gate.promise; const reading = h.owner.readInbox(true);
  assert.equal(h.owner.getSnapshot().inbox.state, 'ready'); assert.equal(h.owner.getSnapshot().inbox.entries, before.entries); assert.equal(h.owner.getSnapshot().model.busy, null);
  gate.reject(new Error('Synthetic network failure')); await reading; await tick();
  assert.equal(h.owner.getSnapshot().inbox.state, 'failed'); assert.equal(h.owner.getSnapshot().inbox.entries, before.entries); assert.equal(h.owner.getSnapshot().inbox.loadedAt, before.loadedAt);
  assert.equal(h.count('inbox'), 2); assert.equal(h.count('write'), 0);
});

test('a queued next-page intent that becomes obsolete cannot starve the visible inbox read', async t => {
  const h = setup(t); h.port.pending = async () => page([proposal('old-head')], 'old-next');
  await h.owner.readPending(); const gate = deferred(); h.port.pending = () => gate.promise;
  h.owner.readActivity(); await h.owner.readPending(true);
  assert.equal(h.count('pending'), 2); assert.equal(h.count('inbox'), 0);
  gate.resolve(page([])); await tick(); await tick();
  assert.equal(h.owner.getSnapshot().pending.nextCursor, null); assert.deepEqual(h.owner.getSnapshot().pending.entries, []);
  assert.equal(h.count('pending'), 2, 'An invalidated cursor never gets sent');
  assert.equal(h.count('inbox'), 1, 'The queued visible inbox read must drain after the invalid next-page intent');
  assert.equal(h.owner.getSnapshot().inbox.state, 'ready'); assert.equal(h.count('run'), 0); assert.equal(h.count('write'), 0);
  h.owner.readActivity(false); await tick();
  assert.equal(h.count('inbox'), 2); assert.equal(h.count('pending'), 2); assert.equal(h.count('run'), 0); assert.equal(h.count('write'), 0);
});

test('explicit run selection interrupts a quiet list GET and uses the original run read/confirmation-reset path', async t => {
  const h = setup(t); await h.owner.readPending(); const gate = deferred(); let first = true;
  h.port.pending = () => first ? (first = false, gate.promise) : Promise.resolve(page([proposal('fresh')]));
  const reading = h.owner.readPending(false, true), pendingCall = h.calls.at(-1);
  h.owner.selectRun(id); assert.equal(pendingCall[2].aborted, true); assert.equal(h.owner.getSnapshot().model.busy, 'read'); assert.deepEqual(h.owner.getSnapshot().model.sharedConfirmed, {});
  gate.resolve(page([proposal('late')])); await reading; await tick(); await tick();
  assert.equal(h.owner.getSnapshot().model.run.id, id); assert.deepEqual(h.owner.getSnapshot().pending.entries.map(entry => entry.proposal.id), ['fresh']); assert.equal(h.count('write'), 0);
});

test('background selection interrupts a quiet inbox GET without losing the selected run ID', async t => {
  const h = setup(t); await h.owner.readInbox(); const gate = deferred(); let first = true;
  h.port.inbox = () => first ? (first = false, gate.promise) : Promise.resolve(Response.json({ runs: [{ runId: id, createdAt: time }] }));
  const reading = h.owner.readInbox(true), inboxCall = h.calls.at(-1);
  h.owner.selectRun(id, true); assert.equal(inboxCall[2].signal.aborted, true); assert.equal(h.owner.getSnapshot().inbox.selectedRunId, id);
  gate.resolve(Response.json({ runs: [] })); await reading; await tick(); await tick();
  assert.equal(h.owner.getSnapshot().inbox.selectedRunId, id); assert.equal(h.owner.getSnapshot().model.run.id, id); assert.equal(h.count('write'), 0);
});

test('quiet discovery and inbox wait for an unknown decision and never check or resend the original run themselves', async t => {
  const h = setup(t); h.port.run = async () => result([proposal()]); h.owner.selectRun(id); await tick();
  h.owner.decide('p', 'accept'); await tick(); assert.ok(h.owner.getSnapshot().model.pendingDecision);
  h.owner.readActivity(); h.owner.readActivity(); await tick();
  assert.equal(h.count('pending'), 0); assert.equal(h.count('inbox'), 0); assert.equal(h.count('run'), 1); assert.equal(h.count('write'), 1);
  h.port.run = async () => result([{ ...proposal(), status: 'accepted' }]); await h.owner.refresh(); await tick(); await tick();
  assert.equal(h.count('pending'), 1); assert.equal(h.count('inbox'), 1); assert.equal(h.count('write'), 1);
});

test('scope changes reject late quiet replies and access denial really clears every list', async t => {
  const h = setup(t); await h.owner.readPending(); await h.owner.readInbox(); const gate = deferred(); h.port.inbox = () => gate.promise;
  const reading = h.owner.readInbox(true); h.owner.syncContext(scope('child-b'), true);
  gate.resolve(Response.json({ runs: [{ runId: id, createdAt: time }] })); await reading;
  assert.deepEqual(h.owner.getSnapshot().inbox.entries, []); assert.equal(h.owner.getSnapshot().inbox.state, 'idle');
  h.port.pending = async () => { throw new ProductAgentApiError(403); }; await h.owner.readPending(false, true);
  assert.equal(h.owner.getSnapshot().pending.state, 'denied'); assert.deepEqual(h.owner.getSnapshot().inbox.entries, []); assert.equal(h.count('write'), 0);
});

test('a timed-out quiet inbox read becomes a contextual failure rather than remaining in loading', async t => {
  const h = setup(t); await h.owner.readInbox(); let timeout;
  t.mock.method(globalThis, 'setTimeout', fn => { timeout = fn; return 1; }); t.mock.method(globalThis, 'clearTimeout', () => {});
  h.port.inbox = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Synthetic timeout')), { once: true }));
  const reading = h.owner.readInbox(true); timeout(); await reading;
  assert.equal(h.owner.getSnapshot().inbox.state, 'failed'); assert.equal(h.owner.getSnapshot().inbox.entries.length, 1); assert.equal(h.owner.getSnapshot().model.busy, null);
});
