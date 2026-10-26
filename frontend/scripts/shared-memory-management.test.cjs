const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// State rendering and navigation are ports here; execute the production hook's
// authorization, dispatch and receipt flow without DOM, network or model calls.
const moduleValue = { exports: {} };
const source = fs.readFileSync(path.resolve(__dirname, '../src/production/task-knowledge-memory-management.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === 'react') return { useEffect() {}, useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  if (name.endsWith('/memory-api')) return { MemoryApiError: class extends Error {} };
  if (name === './useDomainEnvironment') return { useDomainWriteGuard() {} };
  if (name === './task-knowledge-runtime') return { domainFailure: error => ({ status: error?.status ?? 0, code: error?.code ?? null, confirmed: error?.confirmed === true }) };
  throw new Error(`Unexpected import: ${name}`);
}, moduleValue, moduleValue.exports);
const { useTaskKnowledgeMemoryManagement } = moduleValue.exports;

test('shared memory requires an explicit confirmed family intent and preserves the existing write pipeline', async () => {
  const calls = [], requests = [], changes = [];
  const values = { key: 'Synthetic key', content: 'Human checked content', source: { kind: 'manual', description: 'Human source' }, validUntil: null };
  const api = { getSession: async () => 'actor',
    createFact: async (...args) => { calls.push(['candidate', ...args]); return {}; },
    createConfirmedFact: async (...args) => { calls.push(['confirmed', ...args]); return {}; },
    createTopic: async (...args) => { calls.push(['topic', ...args]); return {}; } };
  const env = { role: 'caregiver', sharedMode: true, childId: 'child', userId: 'actor', online: true, canStartWrite: () => true, invalidate() {} };
  const make = (overrides = {}) => useTaskKnowledgeMemoryManagement({ env: { ...env, ...overrides }, api,
    runtime: { lost: false, live: () => true, accessError: () => false,
      request(action) { requests.push(action(new AbortController().signal, () => true)); } },
    reading: () => false, readFailed() { assert.fail('Unexpected read failure'); }, loadAll: async () => {},
    changed: (intent) => changes.push(intent), currentEntity: () => null, latestEntity: async () => null });
  const confirmed = { kind: 'create_confirmed_fact', input: { values, intendedVisibility: 'family', confirm: true, confirmShared: true } };
  make().submit({ kind: 'create_fact', input: { values, intendedVisibility: 'family' } });
  make().submit({ ...confirmed, input: { ...confirmed.input, confirmShared: false } });
  make().submit({ ...confirmed, input: { ...confirmed.input, confirm: false } });
  make().submit({ ...confirmed, input: { ...confirmed.input, values: { ...values, source: { kind: 'private_chat', description: 'Private source', messageId: 'private-message' } } } });
  make().submit({ kind: 'create_topic', input: { title: 'Topic', note: '', visibility: 'private', confirmShared: true } });
  make({ role: 'viewer' }).submit(confirmed);
  assert.equal(requests.length, 0, 'No rejected intent reaches the request pipeline');
  const management = make(); management.submit(confirmed); await Promise.all(requests);
  assert.equal(calls[0][0], 'confirmed'); assert.equal(calls[0][1], 'child');
  assert.deepEqual(calls[0][2], confirmed.input); assert.equal(calls[0][4], 'actor');
  assert.deepEqual(changes, [confirmed]); assert.notEqual(changes[0], confirmed, 'The original intent is cloned through the existing pending pipeline');
  make().submit({ kind: 'create_topic', input: { title: 'Topic', note: '', visibility: 'family', confirmShared: true } }); await Promise.all(requests);
  assert.equal(calls[1][0], 'topic'); assert.equal(calls[1][2].visibility, 'family');
  make({ sharedMode: false }).submit({ kind: 'create_fact', input: { values, intendedVisibility: 'private' } }); await Promise.all(requests);
  assert.equal(calls[2][0], 'candidate', 'Personal mode retains candidate creation');
});
