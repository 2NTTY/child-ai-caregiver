const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const source = path.resolve(process.env.DOCUMENT_ARCHIVE_NOTICE_ROOT || path.join(__dirname, '../..'));
const req = createRequire(path.join(source, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom; no product dependency is added.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const child = id(1), reportId = id(2), snapshotId = id(3);
const readFailure = '未能載入更多文件，已取得的內容保留。';
const snapshot = { id: snapshotId, version: 5, generatedAt: '2026-10-10T00:00:00Z', sourceBasis: 'synthetic:1',
  title: 'Synthetic report', summary: 'Synthetic only', ageLabel: 'Unknown', period: { from: '2026-09-01', to: '2026-09-30' },
  eventDate: null, coverageNote: 'Synthetic only', sections: [], sources: [], changes: [] };
const report = { id: reportId, childId: child, kind: 'growth_report', purpose: 'family', version: 5, status: 'active',
  archivedAt: null, current: snapshot, history: [], readState: 'ready', autoRefresh: false };
const page = (items = [report], authorityVersion = 'auth:1') => json({ page: { authorityVersion, canManage: true, items, hasMore: false, nextCursor: null } });
const createInput = { kind: 'preparation', purpose: 'outing', title: 'Synthetic unsaved plan', eventDate: null, period: snapshot.period };
const audits = [];

// Real React useFamilyDocuments, task-knowledge runtime, QueryClient, API and strict parsers.
// The environment/navigation write-guard ports and HTTP transport are synthetic; this is not browser coverage.
function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid/growth' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const oldFetch = global.fetch;
  let nativeFetchCalls = 0, projection;
  global.fetch = () => { nativeFetchCalls++; throw new Error('Real network forbidden'); };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const requests = [], activeResponses = [], archivedResponses = [], writeResponses = [], accessLoss = [], guard = [];
  const env = { scopeKey: 'synthetic:' + child, childId: child, childName: 'Synthetic child', userId: 'synthetic-parent',
    role: 'owner', online: true, apiBaseUrl: '/api', queryClient, current: () => true, canStartWrite: () => true,
    accessError: error => accessLoss.push(error), invalidate() {} };
  const take = (queue, fallback, context) => queue.length ? queue.shift()(context) : fallback();
  const transport = async (url, init) => {
    const parsed = new URL(url, 'https://synthetic.invalid');
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers['x-expected-user-id'], env.userId);
    requests.push({ method: init.method, path: parsed.pathname + parsed.search, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(parsed.pathname, '/api/children/' + child + '/documents');
    if (init.method === 'POST') {
      assert.ok(writeResponses.length, 'Synthetic writes must be explicitly queued');
      return writeResponses.shift()({ body: JSON.parse(init.body), signal: init.signal });
    }
    assert.equal(init.method, 'GET');
    const status = parsed.searchParams.get('status');
    assert.ok(status === 'active' || status === 'archived');
    return status === 'archived' ? take(archivedResponses, () => page([]), { signal: init.signal })
      : take(activeResponses, () => page(), { signal: init.signal });
  };
  env.owner = { fetcher: transport };
  const modules = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === './useDomainEnvironment') return { useDomainEnvironment: () => env,
        useDomainWriteGuard: (dirty, pending) => guard.push({ dirty, pending }) };
      if (!name.startsWith('.')) return req(name);
      const target = path.resolve(path.dirname(file), name);
      const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
      const value = compile(resolved);
      return /\/family-documents-api(?:\.ts)?$/.test(name) ? { ...value, createFamilyDocumentsApi: base => value.createFamilyDocumentsApi(base, transport) } : value;
    }, module, module.exports);
    return module.exports;
  }
  const { useFamilyDocuments } = compile('frontend/src/production/useFamilyDocuments.ts');
  function Host() { projection = useFamilyDocuments(env); return null; }
  const root = createRoot(document.getElementById('root'));
  return { requests, activeResponses, archivedResponses, writeResponses, accessLoss, guard, get: () => projection,
    async start() { await act(async () => { root.render(React.createElement(Host)); await tick(); }); await act(async () => { await tick(); }); assert.equal(projection.readState, 'ready'); },
    async action(fn) { await act(async () => { fn(projection); await tick(); }); },
    async resolve(wait, response) { await act(async () => { wait.resolve(response); await tick(); }); },
    async close() { await act(async () => root.unmount()); queryClient.clear(); dom.window.close(); global.fetch = oldFetch;
      audits.push({ requests, nativeFetchCalls }); assert.equal(nativeFetchCalls, 0); },
  };
}
const postCount = h => h.requests.filter(row => row.method === 'POST').length;
async function failArchive(h) {
  h.archivedResponses.push(() => json({}, 503));
  await h.action(owner => owner.archive.reading.ensureArchived());
  assert.equal(h.get().archive.reading.pageError, true); assert.equal(h.get().archive.reading.archiveReady, false);
  assert.equal(h.get().notice, readFailure);
}

test('successful archived-list retry clears only its stale read failure once the real parsed page is ready', async () => {
  const h = fixture(), wait = defer();
  try {
    await h.start(); await h.action(owner => owner.markDraft());
    const before = { epoch: h.get().epoch, snapshot: h.get().archive.snapshot, operation: h.get().operation };
    await failArchive(h);
    h.archivedResponses.push(() => wait.promise);
    await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
    assert.equal(h.get().busy, true); assert.equal(h.get().archive.reading.archiveReady, false);
    assert.equal(h.get().notice, readFailure, 'Pending read cannot clear the error');
    await h.resolve(wait, page([]));
    assert.equal(h.get().readState, 'ready'); assert.equal(h.get().archive.reading.archiveReady, true);
    assert.equal(h.get().archive.reading.pageError, false); assert.equal(h.get().archive.reading.archiveHasMore, false);
    assert.equal(h.get().notice, '', 'The footer cannot retain a failed-read notice after successful archived-list retry');
    assert.equal(h.get().dirty, true); assert.equal(h.get().epoch, before.epoch);
    assert.deepEqual(h.get().archive.snapshot, before.snapshot); assert.deepEqual(h.get().operation, before.operation);
    assert.deepEqual(h.guard.at(-1), { dirty: true, pending: false }); assert.equal(postCount(h), 0);
  } finally { wait.resolve(page([])); await h.close(); }
});

test('a second 503 keeps the archive failure and does not claim a ready archive', async () => {
  const h = fixture(); try {
    await h.start(); await failArchive(h); h.archivedResponses.push(() => json({}, 503));
    await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
    assert.equal(h.get().archive.reading.pageError, true); assert.equal(h.get().archive.reading.archiveReady, false);
    assert.equal(h.get().notice, readFailure); assert.equal(postCount(h), 0);
  } finally { await h.close(); }
});

for (const status of [403, 404]) test(`archive retry ${status} preserves access-loss clearing and does not run successful notice cleanup`, async () => {
  const h = fixture(); try {
    await h.start(); await h.action(owner => owner.markDraft()); await failArchive(h);
    h.archivedResponses.push(() => json({}, status)); await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
    assert.equal(h.get().archive.state, 'invalidated'); assert.equal(h.get().archive.snapshot, null);
    assert.equal(h.get().dirty, false); assert.equal(h.get().locked, true); assert.equal(h.get().notice, readFailure);
    assert.equal(h.accessLoss.length, 1); assert.equal(h.accessLoss[0].status, status);
    const count = h.requests.length; await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
    assert.equal(h.requests.length, count); assert.equal(postCount(h), 0);
  } finally { await h.close(); }
});

test('authority mismatch keeps its recheck notice and hides the current report instead of clearing it as success', async () => {
  const h = fixture(); try {
    await h.start(); await failArchive(h); h.archivedResponses.push(() => page([], 'auth:changed'));
    await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
    assert.equal(h.get().readState, 'error'); assert.equal(h.get().archive.snapshot, null);
    assert.equal(h.get().archive.reading.pageError, true); assert.equal(h.get().archive.reading.archiveReady, false);
    assert.equal(h.get().notice, '來源或權限基準已有變更，請重新讀取文件。'); assert.equal(postCount(h), 0);
  } finally { await h.close(); }
});

test('unknown and conflict document operations retain their receipt and recovery gates without a new write', async () => {
  for (const status of [503, 409]) {
    const h = fixture(); try {
      await h.start(); await h.action(owner => owner.markDraft()); h.writeResponses.push(() => json({}, status));
      await h.action(owner => owner.createDocument(createInput));
      const first = h.get().operation; assert.equal(first.state, status === 503 ? 'unknown' : 'conflict');
      assert.ok(first.reference); assert.equal(postCount(h), 1); const count = h.requests.length;
      await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
      assert.equal(h.requests.length, count); assert.deepEqual(h.get().operation, first);
      await h.action(owner => owner.recovery.checkOriginalOperation());
      const checked = h.get().operation, notice = h.get().notice;
      assert.equal(checked.state, status === 503 ? 'unknown' : 'conflict');
      if (status === 503) { assert.equal(checked.reference, first.reference); assert.equal(checked.recovery, 'retry'); }
      await h.action(owner => owner.archive.reading.loadMoreDocuments('archived'));
      assert.deepEqual(h.get().operation, checked); assert.equal(h.get().notice, notice);
      assert.equal(h.get().dirty, true); assert.equal(postCount(h), 1);
    } finally { await h.close(); }
  }
});

test.after(() => { if (process.env.DOCUMENT_ARCHIVE_NOTICE_AUDIT) fs.writeFileSync(process.env.DOCUMENT_ARCHIVE_NOTICE_AUDIT, JSON.stringify(audits, null, 2) + '\n'); });
