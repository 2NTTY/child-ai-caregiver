import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Actual owner and projections, synthetic API only. No network, model, database or browser.
const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target)) target += '.ts';
    return load(target);
  }, module, module.exports);
  return module.exports;
}
const { ProductAgentOwner } = load('frontend/src/production/ProductAgentOwner.ts');
const { ProductAgentApiError } = load('src/client/product-agent-api.ts');
const scope = key => ({ key, childId: key, userId: 'synthetic-parent' });
const proposal = (id = 'synthetic-proposal', runId = 'synthetic-run') => ({ id, runId, version: 1, kind: 'memory_fact', status: 'pending',
  createdAt: '2026-10-07T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', result: null,
  value: { kind: 'memory_fact', key: 'synthetic-fact', content: 'Synthetic fact awaiting explicit confirmation', intendedVisibility: 'private', validUntil: null } });
const page = (...proposals) => ({ proposals, nextCursor: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function harness(getPendingProposals = async () => page(proposal())) {
  const calls = [], denied = [];
  const api = { getPendingProposals: (...args) => { calls.push(args); return getPendingProposals(...args); } };
  const owner = new ProductAgentOwner('/api', true, error => denied.push(error), () => {}, () => api);
  owner.syncContext(scope('child-a'), true);
  return { owner, api, calls, denied };
}

test('an initial gated discovery is coalesced and resumes once after the existing write gate clears', async () => {
  const h = harness(); h.owner.setWritesBlocked(true);
  await h.owner.readPending(); await h.owner.readPending();
  assert.equal(h.calls.length, 0); assert.notEqual(h.owner.getSnapshot().pending.state, 'ready');
  h.owner.setWritesBlocked(false); await settle();
  assert.equal(h.calls.length, 1); assert.equal(h.owner.getSnapshot().pending.state, 'ready');
  assert.equal(h.owner.getSnapshot().pending.entries[0].proposal.id, 'synthetic-proposal');
  h.owner.setWritesBlocked(true); h.owner.setWritesBlocked(false); await settle();
  assert.equal(h.calls.length, 1, 'a later unlock does not poll or repeat a completed request'); h.owner.dispose();
});

test('discovery deferred by another owner request resumes when that request finishes', async () => {
  const run = deferred(), h = harness();
  h.api.getRun = () => run.promise;
  h.owner.selectRun('synthetic-run'); await h.owner.readPending();
  assert.equal(h.calls.length, 0);
  run.reject(new Error('Synthetic run read failure')); await settle();
  assert.equal(h.calls.length, 1); assert.equal(h.owner.getSnapshot().pending.state, 'ready'); h.owner.dispose();
});

test('network failure is not empty and does not self-retry; an explicit retry can confirm empty', async () => {
  const h = harness(async () => { throw new Error('Synthetic failure'); });
  await h.owner.readPending(); assert.equal(h.owner.getSnapshot().pending.state, 'failed');
  h.owner.setWritesBlocked(true); h.owner.setWritesBlocked(false); await settle();
  assert.equal(h.calls.length, 1);
  h.api.getPendingProposals = async () => page(); await h.owner.readPending();
  assert.deepEqual(h.owner.getSnapshot().pending, { state: 'ready', entries: [], nextCursor: null }); h.owner.dispose();
});

test('a scope change clears queued intent and rejects late results from the previous child', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const request = h.owner.readPending(); await h.owner.readPending();
  h.owner.syncContext(scope('child-b'), true); assert.equal(h.calls[0][1].aborted, true);
  pending.resolve(page(proposal('child-a-only'))); await request; await settle();
  assert.deepEqual(h.owner.getSnapshot().pending, { state: 'idle', entries: [], nextCursor: null });
  assert.equal(h.calls.length, 1); h.owner.dispose();
});

test('blocked intent does not cross a scope change or disposal', async () => {
  const h = harness(); h.owner.setWritesBlocked(true); await h.owner.readPending();
  h.owner.syncContext(scope('child-b'), true); h.owner.setWritesBlocked(false); await settle();
  assert.equal(h.calls.length, 0);
  h.owner.setWritesBlocked(true); await h.owner.readPending(); h.owner.setWritesBlocked(false); h.owner.dispose(); await settle();
  assert.equal(h.calls.length, 0);
});

test('an offline-aborted response cannot confirm empty and reconnect resumes an explicitly queued read', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const request = h.owner.readPending(); h.owner.syncContext(scope('child-a'), false);
  pending.resolve(page()); await request;
  assert.notEqual(h.owner.getSnapshot().pending.state, 'ready');
  h.api.getPendingProposals = async () => page(proposal());
  await h.owner.readPending(); h.owner.syncContext(scope('child-a'), true); await settle();
  assert.equal(h.owner.getSnapshot().pending.entries.length, 1); h.owner.dispose();
});

test('access denial is explicit and clears deferred discovery without retrying', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  const request = h.owner.readPending(); await h.owner.readPending();
  pending.reject(new ProductAgentApiError(403)); await request; await settle();
  assert.equal(h.owner.getSnapshot().pending.state, 'denied'); assert.equal(h.denied.length, 1);
  h.owner.setWritesBlocked(false); await h.owner.readPending(); await settle(); assert.equal(h.calls.length, 1); h.owner.dispose();
});

test('an unknown decision retains its guard and discovery resumes only after original resolution', async () => {
  const h = harness(); let writes = 0;
  const result = () => ({ runId: 'synthetic-run', status: 'completed', text: 'Synthetic reply', counts: {}, tools: [], citations: [], proposals: [proposal()] });
  h.api.getRun = async () => result();
  h.api.decideProposal = async () => { writes++; throw new Error('Synthetic unknown decision'); };
  h.owner.selectRun('synthetic-run'); await settle(); h.owner.decide('synthetic-proposal', 'accept'); await settle();
  assert.ok(h.owner.getSnapshot().model.pendingDecision);
  await h.owner.readPending(); h.owner.setWritesBlocked(false); await settle(); assert.equal(h.calls.length, 0);
  h.owner.decide('synthetic-proposal', 'accept'); assert.equal(writes, 1);
  h.api.getRun = async () => ({ ...result(), proposals: [{ ...proposal(), status: 'accepted' }] });
  await h.owner.refresh(); await settle();
  assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  assert.equal(h.calls.length, 1); assert.equal(writes, 1); h.owner.dispose();
});


test('post-reply invalidation discovers a cold pending owner and preserves the mutation gate', async () => {
  const { ProductionOwner } = load('frontend/src/production/ProductionOwner.ts');
  const recordsApi = { getSession: async () => ({ user: { id: 'synthetic-parent' }, children: [] }) };
  const owner = new ProductionOwner('/api', true, recordsApi, {});
  const calls = [], agent = owner.agentOwner;
  agent.syncContext(scope('child-a'), true);
  agent.api = { getPendingProposals: async () => { calls.push('pending'); return page(proposal()); } };
  owner.scopeKey = () => 'child-a';
  owner.setDomainPending('synthetic-initial-read', true);
  owner.invalidatePrivateReads(false); assert.equal(calls.length, 0);
  owner.setDomainPending('synthetic-initial-read', false); await settle();
  assert.equal(calls.length, 1); assert.equal(agent.getSnapshot().pending.entries.length, 1);
  owner.dispose();
});
