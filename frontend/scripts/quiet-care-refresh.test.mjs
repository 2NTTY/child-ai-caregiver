import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { authorizedCareCaptureReview } from '../src/care-view-model.ts';

// Execute the shipped read/publish functions with synthetic ports, not a second owner implementation.
const source = readFileSync(new URL('../src/production/CareProfileDomains.tsx', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('  function publishPage('), source.indexOf('  function publishProfile('));
const projection = source.slice(source.indexOf('  const careModel:'), source.indexOf('  const profileModel ='));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class CareApiError extends Error { constructor(status, onlineCode) { super('Synthetic read failure'); Object.assign(this, { status, onlineCode }); } }
function owner() {
  let active = true, result = async () => ({ records: [], scanned: 0, nextCursor: null });
  const cache = new Map(), careRef = { current: { scopeKey: 'scope', child: { id: 'child' }, access: 'editable', detail: null,
    list: { state: 'loading', records: [], activeQuery: '', activeKind: 'all', scanned: 0, hasMore: false, page: 1, hasPrevious: false, message: null } } };
  const env = { childName: 'Synthetic child', scopeKey: 'scope', online: true, queryClient: { async cancelQueries() {}, setQueryData(key, value) { cache.set(key.join(':'), value); } } };
  const deps = { env, careRef, userId: 'user', childId: 'child', current: () => active, envRef: { current: env },
    careKey: ['care'], writing: { current: false }, attempt: { current: null }, careRead: { current: null }, careGeneration: { current: 0 },
    pageCursors: { current: [null] }, pageIndex: { current: 0 }, nextCursor: { current: null }, historyGeneration: { current: 0 },
    controller: () => new AbortController(), setCare: change => { careRef.current = change(careRef.current); },
    read: (_key, control, action) => action(control.signal), api: { search: (...args) => result(...args) }, released() {}, latestCare() {},
    CareApiError, accessError(error) { if (error.status === 403) { active = false; careRef.current = { ...careRef.current, access: 'lost', list: { ...careRef.current.list, records: [] } }; return true; } return false; },
    careRecordView: raw => ({ ...raw, current: { version: raw.version } }),
  };
  const module = {};
  const compiled = ts.transpileModule('const { '+Object.keys(deps).join(',')+' } = deps;\n'+functions+'\nexports.read = loadCare;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('deps', 'exports', compiled)(deps, module);
  return { read: module.read, state: () => careRef.current, setResult(value) { result = value; }, invalidate() { active = false; },
    offline() {
      env.online = false;
      const start = source.indexOf('  useEffect(() => {\n    if (env.online)');
      const effect = source.slice(start, source.indexOf('  useEffect(() => {\n    const refresh', start));
      const ports = { ...deps, useEffect: fn => fn(), refreshDeferred: { current: false }, profileGeneration: { current: 0 },
        profileRead: { current: null }, reloadRef: { current: {} }, setProfile() {} };
      new Function('deps', ts.transpileModule('const { '+Object.keys(ports).join(',')+' } = deps;\n'+effect, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(ports);
    },
    project() {
      const inputs = { care: careRef.current, env, editable: true, attempt: deps.attempt, userId: 'user',
        rawRecord: id => cache.get('care:record:'+id), savedRecordReview: raw => raw };
      const output = {};
      new Function('deps', 'exports', ts.transpileModule('const { '+Object.keys(inputs).join(',')+' } = deps;\n'+projection+'\nexports.model = careModel;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(inputs, output);
      return output.model;
    } };
}

test('Care retains a confirmed empty page and review projection during a same-query refresh', async () => {
  const h = owner(); h.setResult(async () => ({ records: [], scanned: 0, nextCursor: 'synthetic-next-page' }));
  await h.read(); assert.equal(h.state().list.hasSnapshot, true);
  const pending = deferred(); h.setResult(() => pending.promise); const work = h.read();
  assert.equal(h.state().list.state, 'loading', 'The original read/write guard remains active');
  assert.equal(h.state().list.hasSnapshot, true); assert.equal(h.project().review.state, 'ready');
  assert.equal(h.state().list.hasMore, true, 'An existing pager keeps its place while reading');
  assert.equal(h.project().review.hasMore, true);
  pending.resolve({ records: [], scanned: 0, nextCursor: null }); await work;
  assert.equal(h.state().list.state, 'ready');
});

test('Care read failure preserves same-scope records as stale and success removes missing records', async () => {
  const h = owner(); h.setResult(async () => ({ records: [{ id: 'record', childId: 'child', version: 1 }], scanned: 1, nextCursor: null }));
  await h.read(); h.setResult(async () => { throw new CareApiError(503); }); await h.read();
  assert.equal(h.state().list.state, 'stale'); assert.equal(h.state().list.records.length, 1);
  assert.equal(authorizedCareCaptureReview(h.project()).items[0].id, 'record');
  assert.deepEqual(authorizedCareCaptureReview({ ...h.project(), scopeKey: 'new-scope' }).items, []);
  assert.deepEqual(authorizedCareCaptureReview({ ...h.project(), access: 'lost' }).items, []);
  h.setResult(async () => ({ records: [], scanned: 0, nextCursor: null })); await h.read();
  assert.deepEqual(authorizedCareCaptureReview(h.project()).items, []);
});

test('Care first failure stays error, different queries cannot claim an old snapshot, and obsolete reads are ignored', async () => {
  const h = owner(); h.setResult(async () => { throw new CareApiError(503); }); await h.read();
  assert.equal(h.state().list.state, 'error'); assert.equal(h.state().list.hasSnapshot, false);
  h.setResult(async () => ({ records: [], scanned: 0, nextCursor: null })); await h.read();
  const pending = deferred(); h.setResult(() => pending.promise); const work = h.read('different query');
  assert.equal(h.state().list.hasSnapshot, false); assert.equal(h.project().review.state, 'loading');
  h.invalidate(); pending.resolve({ records: [{ id: 'late', childId: 'child', version: 1 }], scanned: 1, nextCursor: null }); await work;
  assert.deepEqual(h.state().list.records, []);
});


test('first offline Care is unavailable until a real snapshot exists', async () => {
  const cold = owner(); cold.offline();
  assert.equal(cold.state().list.state, 'stale'); assert.equal(cold.state().list.hasSnapshot, undefined);
  assert.equal(cold.project().review.state, 'unavailable');
  assert.deepEqual(authorizedCareCaptureReview(cold.project()).items, []);
  const warm = owner(); await warm.read(); warm.offline();
  assert.equal(warm.state().list.hasSnapshot, true); assert.equal(warm.project().review.state, 'ready');
});
