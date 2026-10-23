const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'package.json')), ts = req('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(file), name);
    return load(fs.existsSync(target) ? target : `${target}.ts`);
  }, module, module.exports);
  return module.exports;
}
const { ProductionOwner } = load('frontend/src/production/ProductionOwner.ts');
const { ClientApiError } = load('src/client/records-api.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const calls = { deletes: [], reads: [], network: [] };
  let user = { id: 'synthetic-parent', name: 'Synthetic parent', email: 'parent@example.invalid' };
  let children = ['a', 'b'].map((id, i) => ({ id: `child-${id}`, workspaceId: 'synthetic-family', displayName: i ? '合成小晴' : '合成小明', accessRole: 'owner', createdAt: '2026-10-23T00:00:00Z' }));
  const rejectWrite = async () => { throw new Error('Unexpected synthetic write; no network is permitted'); };
  const api = { getSession: async () => user, authenticate: rejectWrite, signOut: rejectWrite,
    listChildren: async () => { calls.reads.push('children'); return children; }, listRecords: async () => ({ records: [], limit: 100 }),
    createChild: rejectWrite, createRecord: rejectWrite,
    deleteChild: async id => { calls.deletes.push(id); throw new ClientApiError(400); } };
  const chat = { getSession: async () => user, listMessages: async () => ({ messages: [], limit: 100 }),
    getStatus: async () => true, getUsage: async () => ({ day: '2026-10-23', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
    saveMessage: rejectWrite, requestReply: rejectWrite };
  const account = { canVerifyDeletionIdentity: () => false, clearDeletionVerification() {}, setIdentity() {}, deletionRecovery: () => null,
    status: async () => ({ enabled: false, registration: 'trial', mailConfigured: false, policyVersion: 'synthetic', notice: 'Synthetic test only', user: null }) };
  const fetcher = (...args) => { calls.network.push(args); throw new Error('Real network and HTTP DELETE are forbidden'); };
  const preferences = { read: () => null, write() {}, clear() {} };
  const owner = new ProductionOwner('/api', true, api, chat, preferences, { api: account }, { platform: 'web', fetcher });
  await owner.controller.restoreSession(); await settle();
  assert.equal(owner.getSnapshot().records.selectedChildId, 'child-a');
  assert.ok(owner.getSnapshot().scopeKey, 'The real owner must start with an admitted ordinary scope');
  owner.controller.reviewDeleteChild();
  assert.equal(owner.getSnapshot().records.deletion?.phase, 'confirm');
  assert.equal(owner.getSnapshot().scopeKey, null, 'Review must retain the real global deletion barrier');
  assert.equal(owner.getSnapshot().chat.selectedChildId, null);
  assert.deepEqual(owner.getSnapshot().chat.messages, []);
  return { owner, api, calls, settle, state: () => owner.controller.getSnapshot(),
    patch(value) { owner.controller.update(value); },
    children(value) { children = value; }, user(value) { user = value; },
    dispose() { owner.dispose(); assert.deepEqual(calls.network, [], 'Only supplied synthetic API ports may be used'); } };
}
module.exports = { fixture, load, settle, ClientApiError };
