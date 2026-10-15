import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import ts from 'typescript';
import { CareApiError } from '../../src/client/care-api.ts';
import { createCareReadCoordinator } from '../src/production/CareReadCoordinator.ts';

// Import the read coordinator directly. Compile the complete bridge only to retain its real
// draft, close and confirmed-write callbacks; no hook body is extracted or copied into this test.
const bridgeSource = readFileSync(new URL('../src/production/CareProfileDomains.tsx', import.meta.url), 'utf8');
const compiledBridge = ts.transpileModule(bridgeSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const rec = (version = 1, id = 'record') => ({ id, childId: 'child', version, text: `revision ${version}`, createdAt: '2026-10-07T12:00:00Z' });
const page = (records = [], nextCursor = null) => ({ records, scanned: records.length, nextCursor });
const revisions = (...records) => ({ revisions: records, nextBeforeVersion: null });

function owner(t) {
  let active = true, searchResult = async () => page(), historyResult = async () => revisions(rec()), historyCalls = 0;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const careKey = ['production', 'scope', 'care'];
  const states = [], refs = [];
  let stateIndex, refIndex, layoutEffects, Owner, projection, reads, ports;
  const env = { childName: 'Synthetic child', scopeKey: 'scope', childId: 'child', userId: 'user', online: true,
    queryClient, role: 'owner', apiBaseUrl: '', invalidate() {}, current: () => active, currentIdentity: () => active, canStartWrite: () => true,
    accessError() { active = false; queryClient.clear(); ports.setCare(previous => ({ ...previous, access: 'lost', detail: null,
      draft: null, deletion: null, list: { ...previous.list, records: [] } })); } };
  const api = { getSession: async () => 'user', search: (...args) => searchResult(...args),
    history: (...args) => { historyCalls++; return historyResult(...args); }, delete: async () => {},
    getProfile: async () => ({ childId: 'child', version: 0, data: null }) };
  function render() {
    stateIndex = 0; refIndex = 0; layoutEffects = [];
    Owner({ env, publish: value => { projection = value; } });
    for (const effect of layoutEffects) effect();
  }
  const mocks = {
    react: {
      createContext: () => ({}), useContext() {}, memo: component => { Owner = component; return component; },
      useMemo: calculate => calculate(), useEffect() {}, useLayoutEffect: effect => { layoutEffects.push(effect); },
      useState(initial) {
        const index = stateIndex++;
        if (!states[index]) states[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [states[index].value, update => { states[index].value = typeof update === 'function' ? update(states[index].value) : update; render(); }];
      },
      useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    },
    'react/jsx-runtime': { jsx() {}, jsxs() {} }, 'expo-router': { usePathname: () => '/care' },
    '../../../src/client/care-api': { CareApiError, createCareApi: () => api },
    '../../../src/client/use-online-updates': { ONLINE_REFRESH_EVENT: 'synthetic-refresh' },
    '../care-view-model': { emptyCareForm: () => ({ text: '', reason: '' }) },
    '../profile-view-model': { emptyProfileForm: () => ({}), profileFormFromData: () => ({}) },
    '../components/care/care-form': { careFormSchema: () => ({ safeParse: () => ({ success: true }) }) },
    '../components/profile/profile-form': {}, '../workspaces/CareWorkspace': {}, '../workspaces/ProfileWorkspace': {},
    './CareProfileProjections': {
      careRecordView: record => ({ id: record.id, childId: record.childId, current: { version: record.version, values: { text: record.text } } }),
      careRevisionView: value => value, savedRecordReview: record => ({ id: record.id, version: record.version, text: record.text }),
      profileRevisionView: value => value,
    },
    './CareReadCoordinator': { createCareReadCoordinator(value) { ports = value; return reads = createCareReadCoordinator(value); } },
    './useDomainEnvironment': { useDomainWriteGuard() {} },
  };
  new Function('require', 'exports', compiledBridge)(name => { assert.ok(mocks[name], name); return mocks[name]; }, {});
  render();
  const controllers = refs.find(ref => ref.current instanceof Set).current;
  t.after(() => { controllers.forEach(control => control.abort()); queryClient.clear(); });
  // The bridge alone owns draftBasis; locate its real cell when its callback selects the cached snapshot.
  let draftBasis;
  const actions = new Proxy({}, { get(_target, name) {
    if (name === 'startCorrection') return id => {
      const snapshot = reads.rawRecord(id); projection.care.actions.startCorrection(id);
      draftBasis = refs.find(ref => ref.current === snapshot);
    };
    return projection.care.actions[name];
  } });
  const deps = { get attempt() { return ports.state.attempt; }, get draftBasis() { return draftBasis; } };
  return { load: (...args) => reads.loadCare(...args), latest: (...args) => reads.latestCare(...args), actions,
    project: () => projection.care.model,
    env, deps, queryClient, careKey, state: () => ports.state.careRef.current,
    raw: (id = 'record') => queryClient.getQueryData([...careKey, 'record', id]),
    cached: (id = 'record') => queryClient.getQueryState([...careKey, 'record', id]), historyCalls: () => historyCalls,
    search: value => { searchResult = typeof value === 'function' ? value : async () => value; },
    history: value => { historyResult = typeof value === 'function' ? value : async () => value; },
    invalidate: () => queryClient.invalidateQueries({ queryKey: careKey, refetchType: 'none' }),
    loseScope() { active = false; controllers.forEach(control => control.abort()); queryClient.clear(); },
    set: change => { ports.setCare(previous => ({ ...previous, ...change })); },
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
  h.search(page([])); h.actions.startDeletion('record'); h.actions.confirmDeletionScope(true); h.actions.submitDeletion(); await tick();
  pending.resolve(revisions(rec())); await reading;
  assert.equal(h.raw(), undefined); assert.equal(h.state().detail, null); assert.deepEqual(h.state().list.records, []);
});

test('offline opens do not show an invalidated record and make no server request', async t => {
  const h = owner(t); h.search(page([rec()])); await h.load(); await h.invalidate(); h.env.online = false;
  h.actions.openRecord('record'); assert.equal(h.historyCalls(), 0); assert.equal(h.state().detail, null);
  assert.match(h.state().list.message, /連線恢復/);
});
