import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import ts from 'typescript';

// Run the shipped owner functions with the real Query cache and synthetic authenticated ports.
const source = readFileSync(new URL('../src/production/CareProfileDomains.tsx', import.meta.url), 'utf8');
const readers = source.slice(source.indexOf('  async function verify('), source.indexOf('  function publishProfile('));
const latest = source.slice(source.indexOf('  async function latestCare('), source.indexOf('  async function submit('));
const actions = source.slice(source.indexOf('  const careActions:'), source.indexOf('  const profileActions:'));
const projection = source.slice(source.indexOf('  const careModel:'), source.indexOf('  const profileModel ='));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const rec = (version = 1, id = 'record') => ({ id, childId: 'child', version, text: `revision ${version}`, createdAt: '2026-10-07T12:00:00Z' });
const page = (records = [], nextCursor = null) => ({ records, scanned: records.length, nextCursor });
const revisions = (...records) => ({ revisions: records, nextBeforeVersion: null });
class CareApiError extends Error { constructor(status, onlineCode) { super('Synthetic record read failure'); Object.assign(this, { status, onlineCode }); } }

function owner(t) {
  let active = true, searchResult = async () => page(), historyResult = async () => revisions(rec()), historyCalls = 0;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => queryClient.clear());
  const careKey = ['production', 'scope', 'care'];
  const careRef = { current: { scopeKey: 'scope', child: { id: 'child' }, access: 'editable', detail: null, draft: null, deletion: null,
    operation: { state: 'none' }, list: { state: 'loading', records: [], activeQuery: '', activeKind: 'all', scanned: 0,
      hasMore: false, page: 1, hasPrevious: false, message: null } } };
  const controllers = new Set();
  const env = { childName: 'Synthetic child', scopeKey: 'scope', online: true, queryClient, role: 'owner', invalidate() {},
    accessError() { active = false; queryClient.clear(); careRef.current = { ...careRef.current, access: 'lost', detail: null,
      draft: null, deletion: null, list: { ...careRef.current.list, records: [] } }; } };
  const deps = { env, envRef: { current: env }, careRef, careKey, userId: 'user', childId: 'child', editable: true, CareApiError,
    current: () => active, writing: { current: false }, attempt: { current: null }, careRead: { current: null }, careGeneration: { current: 0 },
    recordReadGeneration: { current: 0 }, recordRemovals: { current: new Map() }, historyGeneration: { current: 0 }, openGeneration: { current: 0 },
    pageCursors: { current: [null] }, pageIndex: { current: 0 }, nextCursor: { current: null }, draftBasis: { current: null },
    controller() { const control = new AbortController(); controllers.add(control); return control; }, released(control) { controllers.delete(control); },
    api: { getSession: async () => 'user', search: (...args) => searchResult(...args), history: (...args) => { historyCalls++; return historyResult(...args); } },
    setCare(change) { careRef.current = change(careRef.current); }, setPending() {},
    careRecordView: record => ({ id: record.id, childId: record.childId, current: { version: record.version, values: { text: record.text } } }),
    careOperation: () => ({ state: 'none', message: '' }), savedRecordReview: record => ({ id: record.id, version: record.version, text: record.text }),
    canWrite: () => active && env.online && !deps.attempt.current && !deps.writing.current,
    emptyCareForm: () => ({ text: '', reason: '' }), careFormSchema: () => ({ safeParse: () => ({ success: true }) }),
  };
  const module = {};
  const code = 'const {' + Object.keys(deps).join(',') + '} = deps;\n' + readers + '\n' + latest + '\n' + actions
    + '\nexports.load = loadCare; exports.latest = latestCare; exports.finish = finish; exports.actions = careActions;'
    + '\nexports.project = () => { const care = careRef.current; ' + projection + '; return careModel; };';
  new Function('deps', 'exports', ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(deps, module);
  return { ...module, env, deps, queryClient, careKey, state: () => careRef.current,
    raw: (id = 'record') => queryClient.getQueryData([...careKey, 'record', id]),
    cached: (id = 'record') => queryClient.getQueryState([...careKey, 'record', id]), historyCalls: () => historyCalls,
    search: value => { searchResult = typeof value === 'function' ? value : async () => value; },
    history: value => { historyResult = typeof value === 'function' ? value : async () => value; },
    invalidate: () => queryClient.invalidateQueries({ queryKey: careKey, refetchType: 'none' }),
    loseScope() { active = false; controllers.forEach(control => control.abort()); queryClient.clear(); },
    set: change => { careRef.current = { ...careRef.current, ...change }; },
  };
}

test('opening an invalidated cached record waits for the current server revision', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); await h.invalidate();
  const pending = deferred(); h.history(() => pending.promise); h.actions.openRecord('record'); await tick();
  assert.equal(h.historyCalls(), 1); assert.equal(h.state().detail, null);
  pending.resolve(revisions(rec(2))); await tick();
  assert.equal(h.raw().version, 2); assert.equal(h.state().detail.record.current.version, 2); assert.equal(h.cached().isInvalidated, false);
});

test('an off-page cached record is verified and a 404 clears only that record and history', async t => {
  const h = owner(t); h.search(page([rec(), rec(1, 'other')])); await h.load();
  h.queryClient.setQueryData([...h.careKey, 'history', 'record', 1], revisions(rec()));
  h.search(page([])); await h.load();
  assert.equal(h.cached().isInvalidated, true); assert.equal(h.raw().version, 1, 'Absence is not deletion');
  h.history(async () => { throw new CareApiError(404); }); h.actions.openRecord('record'); await tick();
  assert.equal(h.historyCalls(), 1); assert.equal(h.raw(), undefined); assert.equal(h.state().detail, null);
  assert.equal(h.queryClient.getQueryData([...h.careKey, 'history', 'record', 1]), undefined);
  assert.equal(h.queryClient.getQueryData([...h.careKey, 'latest', 'record']), undefined);
  assert.equal(h.raw('other').version, 1); assert.match(h.state().operation.message, /不可讀|未能核對/);
});

test('pagination and search absence preserve legitimate records and repeat opens preserve history', async t => {
  const h = owner(t); h.search(page([rec()], { id: 'cursor', createdAt: 'synthetic' })); await h.load();
  h.search(page([rec(1, 'other')])); await h.load('', 'all', 1);
  assert.equal(h.state().list.page, 2); assert.equal(h.raw().version, 1);
  h.actions.openRecord('record'); await tick();
  assert.equal(h.state().detail.record.id, 'record'); assert.equal(h.historyCalls(), 1);
  const detail = { ...h.state().detail, historyOpen: true, historyState: 'ready', history: [{ version: 1 }] };
  h.set({ detail }); h.actions.openRecord('record'); h.actions.openRecord('record');
  assert.equal(h.historyCalls(), 1); assert.equal(h.state().detail, detail);
  h.search(page([])); await h.load('unrelated search');
  assert.equal(h.state().list.records.length, 0); assert.equal(h.state().detail.record.id, 'record'); assert.equal(h.historyCalls(), 2);
});

test('late detail v1 cannot overwrite a newer list v2 or its read-only review projection', async t => {
  const h = owner(t), pending = deferred(); h.history(() => pending.promise); h.actions.openRecord('record'); await tick();
  h.search(page([rec(2)])); await h.load();
  pending.resolve(revisions(rec(1))); await tick();
  assert.equal(h.raw().version, 2); assert.equal(h.state().detail.record.current.version, 2);
  assert.equal(h.state().list.records[0].current.version, 2); assert.equal(h.project().review.items[0].version, 2);
});

test('a late detail reply from before a successful empty refresh must revalidate before publishing', async t => {
  const h = owner(t), old = deferred(), fresh = deferred();
  h.search(page([rec()])); await h.load(); await h.invalidate();
  h.history(() => h.historyCalls() === 1 ? old.promise : fresh.promise);
  h.actions.openRecord('record'); await tick(); h.search(page([])); await h.load();
  old.resolve(revisions(rec())); await tick();
  assert.equal(h.historyCalls(), 2); assert.equal(h.state().detail, null);
  assert.equal(h.cached().isInvalidated, true, 'An obsolete success cannot freshen the cached snapshot');
  fresh.reject(new CareApiError(404)); await tick();
  assert.equal(h.raw(), undefined); assert.equal(h.state().detail, null);
});

test('stale in-flight revalidation can still find a legitimate off-page record', async t => {
  const h = owner(t), old = deferred(), fresh = deferred();
  h.history(() => h.historyCalls() === 1 ? old.promise : fresh.promise);
  h.actions.openRecord('record'); await tick(); h.search(page([])); await h.load('other records');
  old.resolve(revisions(rec())); await tick();
  assert.equal(h.state().detail, null); assert.equal(h.raw(), undefined); assert.equal(h.historyCalls(), 2);
  fresh.resolve(revisions(rec())); await tick();
  assert.equal(h.state().detail.record.id, 'record'); assert.equal(h.raw().version, 1); assert.equal(h.cached().isInvalidated, false);
});

test('another refresh during the replacement read fails closed without unbounded retries', async t => {
  const h = owner(t), old = deferred(), fresh = deferred();
  h.history(() => h.historyCalls() === 1 ? old.promise : fresh.promise);
  h.actions.openRecord('record'); await tick(); await h.load(); old.resolve(revisions(rec())); await tick();
  await h.load(); fresh.resolve(revisions(rec())); await tick();
  assert.equal(h.historyCalls(), 2); assert.equal(h.raw(), undefined); assert.equal(h.state().detail, null);
  assert.match(h.state().operation.message, /未能核對/);
});

test('late list v1 cannot downgrade a known detail v2 or the review projection', async t => {
  const h = owner(t), pending = deferred(); h.search(() => pending.promise); const loading = h.load(); await tick();
  h.history(revisions(rec(2))); h.actions.openRecord('record'); await tick();
  pending.resolve(page([rec(1)])); await loading;
  assert.equal(h.raw().version, 2); assert.equal(h.state().detail.record.current.version, 2);
  assert.equal(h.state().list.records[0].current.version, 2); assert.equal(h.project().review.items[0].version, 2);
});

test('a verified 404 clears selected detail and prevents an older list from resurrecting it', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); h.actions.openRecord('record');
  const pending = deferred(); h.search(() => pending.promise); const loading = h.load(); await tick();
  h.history(async () => { throw new CareApiError(404); }); assert.equal(await h.latest('record'), null);
  assert.equal(h.state().detail, null); assert.equal(h.raw(), undefined);
  pending.resolve(page([rec()])); await loading;
  assert.equal(h.raw(), undefined); assert.deepEqual(h.state().list.records, []); assert.deepEqual(h.project().review.items, []);
});

test('close, a newer selection and child-scope changes ignore obsolete detail replies', async t => {
  for (const event of ['close', 'newer selection', 'child switch']) {
    const h = owner(t), pending = deferred(); h.history(() => pending.promise); h.actions.openRecord('record'); await tick();
    if (event === 'close') h.actions.closePanel();
    else if (event === 'newer selection') {
      h.queryClient.setQueryData([...h.careKey, 'record', 'other'], rec(1, 'other')); h.actions.openRecord('other');
    } else h.loseScope();
    pending.resolve(revisions(rec())); await tick();
    assert.equal(h.state().detail?.record.id ?? null, event === 'newer selection' ? 'other' : null, event);
    if (event === 'child switch') assert.equal(h.raw(), undefined);
  }
});

test('a 403 invokes the authority clear and cannot leave old detail or cache available', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); h.actions.openRecord('record'); await h.invalidate();
  h.history(async () => { throw new CareApiError(403); }); h.actions.openRecord('record'); await tick();
  assert.equal(h.state().access, 'lost'); assert.equal(h.state().detail, null); assert.equal(h.raw(), undefined);
  assert.deepEqual(h.state().list.records, []);
});

test('same-query refresh retains its snapshot and history until a new version really arrives', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); h.actions.openRecord('record');
  const detail = { ...h.state().detail, historyOpen: true, historyState: 'ready', history: [{ version: 1 }] }; h.set({ detail });
  const pending = deferred(); h.search(() => pending.promise); const loading = h.load();
  assert.equal(h.state().detail, detail); assert.equal(h.state().list.hasSnapshot, true); assert.equal(h.project().review.state, 'ready');
  pending.resolve(page([rec()])); await loading;
  assert.equal(h.historyCalls(), 0); assert.equal(h.state().detail.historyOpen, true); assert.equal(h.state().detail.history, detail.history);
});

test('failed detail verification never publishes a cached success or a fabricated empty record', async t => {
  for (const result of ['error', 'empty']) {
    const h = owner(t); h.search(page([rec()])); await h.load(); await h.invalidate();
    h.history(result === 'empty' ? revisions() : async () => { throw new CareApiError(503); }); h.actions.openRecord('record'); await tick();
    assert.equal(h.state().detail, null, result); assert.equal(h.cached().isInvalidated, true, result);
    assert.equal(h.raw().version, 1); assert.match(h.state().operation.message, /未能核對/);
  }
});

test('a refresh failure retains the selected snapshot with an explicit unverified notice', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); h.actions.openRecord('record');
  h.search(page([])); h.history(async () => { throw new CareApiError(503); }); await h.load();
  assert.equal(h.state().detail.record.current.version, 1); assert.equal(h.cached().isInvalidated, true);
  assert.match(h.state().operation.message, /未能核對.*上次讀取/);
});

test('a draft started during a refresh keeps its original basis and is not replaced by the late read', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); h.actions.openRecord('record');
  const pending = deferred(); h.search(page([])); h.history(() => pending.promise); const loading = h.load(); await tick();
  h.actions.startCorrection('record'); const draft = h.state().draft; assert.equal(draft.basis.current.version, 1);
  pending.resolve(revisions(rec(2))); await loading;
  assert.equal(h.state().draft, draft); assert.equal(h.deps.draftBasis.current.version, 1);
  assert.equal(h.state().detail.record.current.version, 1); assert.equal(h.raw().version, 2);
});

test('pending writes block opens and a confirmed deletion cannot be undone by an older detail result', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load();
  h.deps.attempt.current = { domain: 'care' }; h.actions.openRecord('record');
  assert.equal(h.state().detail, null); assert.equal(h.historyCalls(), 0); h.deps.attempt.current = null;
  const pending = deferred(); h.history(() => pending.promise); const reading = h.latest('record'); await tick();
  h.finish({ domain: 'care', kind: 'delete', recordId: 'record', receipt: null });
  pending.resolve(revisions(rec())); await reading;
  assert.equal(h.raw(), undefined); assert.equal(h.state().detail, null); assert.deepEqual(h.state().list.records, []);
});

test('offline opens do not show an invalidated record and make no server request', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); await h.invalidate(); h.env.online = false;
  h.actions.openRecord('record'); assert.equal(h.historyCalls(), 0); assert.equal(h.state().detail, null);
  assert.match(h.state().list.message, /連線恢復/);
});
