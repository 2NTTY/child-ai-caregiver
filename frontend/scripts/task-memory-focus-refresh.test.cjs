const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const source = path.resolve(__dirname, '../..');
const req = createRequire(path.join(source, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const childId = '11111111-1111-4111-8111-111111111111';
const id = index => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
const at = '2026-10-23T00:00:00Z';
const fact = index => ({ id: id(index), childId, version: 51, key: `Synthetic fact ${index}`, content: 'Synthetic content',
  source: { kind: 'manual', description: 'Synthetic source' }, validUntil: null, visibility: 'private', intendedVisibility: 'private',
  status: 'confirmed', createdBy: 'parent', confirmedBy: 'parent', confirmedAt: at, reason: '', applicable: true, sourceState: 'current' });
const topic = index => ({ id: id(index), childId, version: 51, title: `Synthetic topic ${index}`, note: 'Synthetic note', visibility: 'private',
  status: 'pending', updatedBy: 'parent', updatedAt: at, resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true });
const task = index => ({ id: id(index), childId, version: 1, title: `Synthetic task ${index}`, details: '', kind: 'ordinary',
  assigneeUserId: 'parent', createdBy: 'parent', createdAt: at, updatedAt: at,
  occurrence: { id: id(index + 1000), dueAt: at, timeZone: 'Asia/Hong_Kong', state: 'scheduled', terminalBasisVersion: null } });

// Actual hooks, runtime, QueryClient and API parsers; only the environment and GET transport are synthetic.
// This covers owner state, not browser paint, page scrolling or live Server snapshot isolation.
function fixture(kind) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.invalid/' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const previousFetch = global.fetch;
  let nativeCalls = 0, value, env, session = 'parent', interceptor = () => null;
  global.fetch = () => { nativeCalls++; throw new Error('Real network is forbidden'); };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = { facts: Array.from({ length: 51 }, (_, n) => fact(n + 1)), topics: Array.from({ length: 51 }, (_, n) => topic(n + 1)),
    tasks: Array.from({ length: 51 }, (_, n) => task(n + 1)) };
  const requests = [], accessLoss = [];
  const page = (domain, after) => {
    const rest = data[domain].filter(item => after === null || item.id > after).sort((a, b) => a.id < b.id ? -1 : 1);
    const items = rest.slice(0, 50), nextAfterId = rest.length > 50 ? items.at(-1).id : null;
    if (domain !== 'tasks') return { items, nextAfterId };
    return { items, nextAfterId, eligibleAssignees: [{ userId: 'parent', name: 'Synthetic parent' }], workerEnabled: true,
      reminders: items.filter(item => item.occurrence.state === 'scheduled').map(item => ({ id: item.id, batchId: id(9000), taskId: item.id,
        taskVersion: item.version, occurrenceId: item.occurrence.id, phase: 'initial', createdAt: at })),
      work: items.map(item => ({ taskId: item.id, taskVersion: item.version, status: 'pending', nextAt: at, failures: 0 })) };
  };
  const transport = async (url, init) => {
    const parsed = new URL(url, 'https://synthetic.invalid');
    assert.equal(init.method, 'GET', 'Only synthetic reads are allowed');
    const entry = { path: parsed.pathname, after: parsed.searchParams.get('afterId'), before: parsed.searchParams.get('beforeVersion'), signal: init.signal };
    requests.push(entry);
    const override = interceptor(entry); if (override) return await override;
    if (entry.path === '/api/auth/get-session') return json({ user: { id: session } });
    const prefix = `/api/children/${env.childId}`;
    if (entry.path === `${prefix}/memory/summary`) return json({ summary: null });
    const matched = entry.path.match(/\/(facts|topics|tasks)(?:\/([^/]+)(\/history)?)?$/);
    assert.ok(matched, entry.path);
    const [, domain, entityId, history] = matched;
    if (!entityId) return json(page(domain, entry.after));
    const basis = data[domain].find(item => item.id === entityId);
    if (!basis) return json({}, 404);
    if (!history) return json({ task: basis });
    const versions = Array.from({ length: basis.version }, (_, n) => basis.version - n).filter(version => !entry.before || version < Number(entry.before));
    const revisions = versions.slice(0, 50).map(version => domain === 'tasks' ? { task: { ...basis, version }, action: 'create', actorUserId: 'parent', basisVersion: 0, note: '', at } : { ...basis, version });
    return json({ revisions, nextBeforeVersion: versions.length > 50 ? versions[49] : null });
  };
  const makeEnv = scopeKey => ({ scopeKey, identityKey: scopeKey, childId, childName: 'Synthetic child', userId: session,
    role: 'owner', online: true, apiBaseUrl: '/api', queryClient, owner: { fetcher: transport },
    current: () => env.scopeKey === scopeKey, currentIdentity: () => env.scopeKey === scopeKey, canStartWrite: () => true,
    invalidate() {}, accessError: error => accessLoss.push(error) });
  env = makeEnv('scope-a');
  const cache = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name.endsWith('/useDomainEnvironment')) return { useDomainWriteGuard() {} };
      if (!name.startsWith('.')) return req(name);
      const target = path.resolve(path.dirname(file), name);
      return compile(fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
    }, module, module.exports);
    return module.exports;
  }
  const hook = kind === 'memory' ? compile('frontend/src/production/task-knowledge-memory.ts').useTaskKnowledgeMemory
    : compile('frontend/src/production/task-knowledge-tasks.ts').useTaskKnowledgeTasks;
  function Owner() { value = hook(env); return null; }
  const root = createRoot(document.getElementById('root'));
  const settle = () => act(async () => { await tick(); });
  const render = () => act(async () => { root.render(React.createElement(Owner, { key: env.scopeKey })); await tick(); });
  return { data, requests, accessLoss, page, get: () => value, intercept: fn => { interceptor = fn; }, settle,
    async start() { await render(); await settle(); },
    async action(fn) { await act(async () => { fn(value); await tick(); }); },
    async refresh() { await act(async () => { window.dispatchEvent(new window.Event('yuban-online-refresh')); await tick(); }); },
    async resolve(wait, response) { await act(async () => { wait.resolve(response); await tick(); }); },
    async scope(next) { env = makeEnv(next); await render(); await settle(); },
    session(next) { session = next; },
    async close() { await act(async () => root.unmount()); queryClient.clear(); dom.window.close(); global.fetch = previousFetch; assert.equal(nativeCalls, 0); },
  };
}
const memoryData = h => h.get().value.model.longTerm;
async function loadMemory(h, withHistory = true) {
  await h.start();
  await h.action(v => v.value.reads.loadMoreFacts()); await h.action(v => v.moreTopics());
  if (withHistory) {
    await h.action(v => v.value.reads.readFactHistory(id(1), 51));
    await h.action(v => v.value.reads.loadMoreFactHistory(id(1), 51));
    await h.action(v => v.topicHistory(id(1), 51)); await h.action(v => v.topicHistory(id(1), 51, true));
  }
}

test('memory automatic refresh preserves loaded facts/topics and same-version expanded history pages', async () => {
  const h = fixture('memory');
  try {
    await loadMemory(h);
    const originalHistory = memoryData(h).data.histories[id(1)], originalTopics = h.get().topicHistories[id(1)];
    assert.equal(originalHistory.items.length, 51); assert.equal(originalTopics.items.length, 51);
    const count = h.requests.length;
    await h.refresh();
    assert.equal(memoryData(h).data.facts.length, 51); assert.equal(h.get().topics.length, 51);
    assert.deepEqual(memoryData(h).data.histories[id(1)], originalHistory); assert.deepEqual(h.get().topicHistories[id(1)], originalTopics);
    assert.equal(h.requests.slice(count).filter(request => request.path.endsWith('/history')).length, 0);
    assert.equal(memoryData(h).state, 'ready');
  } finally { await h.close(); }
});

test('tasks refresh revalidates the full loaded range and metadata before one replacement', async () => {
  const h = fixture('tasks');
  try {
    await h.start(); await h.action(v => v.actions.loadMoreTasks()); await h.action(v => v.actions.selectTask(id(51)));
    h.data.tasks = h.data.tasks.filter(item => item.id !== id(1));
    h.data.tasks[0] = { ...h.data.tasks[0], version: 2, title: 'Refreshed title' };
    h.data.tasks.push(task(0), task(52));
    const wait = deferred(), count = h.requests.length;
    h.intercept(request => request.path.endsWith('/tasks') && request.after ? wait.promise : null);
    await h.refresh();
    assert.equal(h.get().model.items[0].id, id(1), 'Do not publish the refreshed head while the loaded tail is pending');
    await h.resolve(wait, json(h.page('tasks', id(50))));
    assert.equal(h.get().model.items.length, 52);
    assert.equal(h.get().model.items.some(item => item.id === id(1)), false, 'Removed rows are not merged back');
    assert.equal(h.get().model.items.find(item => item.id === id(2)).title, 'Refreshed title');
    assert.equal(h.get().model.work.some(item => item.taskId === id(1)), false);
    assert.equal(h.get().model.work.find(item => item.taskId === id(2)).taskVersion, 2);
    assert.equal(h.get().model.selected.id, id(51));
    assert.equal(h.requests.slice(count).filter(request => request.path.endsWith(`/tasks/${id(51)}`)).length, 0, 'The selected loaded tail needs no redundant detail read');
  } finally { await h.close(); }
});

test('memory version changes and deleted rows invalidate only their corresponding histories', async () => {
  const h = fixture('memory');
  try {
    await loadMemory(h);
    await h.action(v => v.value.reads.readFactHistory(id(2), 51)); await h.action(v => v.topicHistory(id(2), 51));
    h.data.facts[0] = { ...h.data.facts[0], version: 52 };
    h.data.topics = h.data.topics.filter(item => item.id !== id(1));
    await h.refresh();
    assert.equal(memoryData(h).data.histories[id(1)], undefined); assert.equal(h.get().topicHistories[id(1)], undefined);
    assert.equal(memoryData(h).data.histories[id(2)].state, 'ready'); assert.equal(h.get().topicHistories[id(2)].items.length, 50);
  } finally { await h.close(); }
});

for (const kind of ['memory', 'tasks']) test(`${kind} failed tail refresh stays stale, access loss clears, and old-scope results are rejected`, async () => {
  const h = fixture(kind);
  const items = () => kind === 'memory' ? memoryData(h).data?.facts ?? [] : h.get().model.items;
  const state = () => kind === 'memory' ? memoryData(h).state : h.get().model.readState;
  try {
    if (kind === 'memory') await loadMemory(h); else { await h.start(); await h.action(v => v.actions.loadMoreTasks()); }
    h.intercept(request => request.after ? json({}, 503) : null);
    await h.refresh(); assert.equal(state(), 'stale'); assert.equal(items().length, 51);
    h.intercept(() => null); await h.refresh(); assert.equal(state(), 'ready');
    const wait = deferred();
    h.intercept(request => request.after ? wait.promise : null);
    await h.refresh();
    h.intercept(() => null); await h.scope('scope-b');
    assert.equal(items().length, 50, 'New scope starts at the first page without old reading state');
    await h.resolve(wait, json(h.page(kind === 'memory' ? 'facts' : 'tasks', id(50))));
    assert.equal(items().length, 50, 'The obsolete loaded tail cannot re-enter the new scope');
    if (kind === 'memory') assert.deepEqual(memoryData(h).data.histories, {});
    h.session('different-parent'); await h.refresh();
    assert.equal(items().length, 0); assert.equal(h.accessLoss.length, 1);
  } finally { await h.close(); }
});

test('a parallel memory access denial is not hidden by an earlier transient refresh failure', async () => {
  const h = fixture('memory');
  try {
    await loadMemory(h);
    const wait = deferred();
    h.intercept(request => request.path.endsWith('/facts') ? json({}, 503) : request.path.endsWith('/topics') ? wait.promise : null);
    await h.refresh(); assert.equal(memoryData(h).state, 'stale');
    await h.resolve(wait, json({}, 403));
    assert.equal(h.get().value.model.access, 'revoked'); assert.equal(memoryData(h).data, null);
    assert.deepEqual(h.get().topicHistories, {}); assert.equal(h.accessLoss.length, 1);
  } finally { await h.close(); }
});

test('tasks preserve a same-version open history and invalidate it when the task changes', async () => {
  const h = fixture('tasks');
  try {
    await h.start(); await h.action(v => v.actions.selectTask(id(1))); await h.action(v => v.actions.showHistory());
    const original = h.get().model.history;
    assert.equal(original.length, 1);
    await h.refresh(); assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history, original);
    h.data.tasks[0] = { ...h.data.tasks[0], version: 2 };
    await h.refresh(); assert.equal(h.get().model.selected.version, 2); assert.deepEqual(h.get().model.history, []);
  } finally { await h.close(); }
});

test('memory first reads, explicit reload and user pagination keep their original boundaries', async () => {
  const h = fixture('memory');
  try {
    await loadMemory(h);
    assert.equal(memoryData(h).data.facts.length, 51);
    await h.action(v => v.refresh());
    assert.equal(memoryData(h).data.facts.length, 50); assert.equal(h.get().topics.length, 50);
    assert.deepEqual(memoryData(h).data.histories, {});
    await h.action(v => v.value.reads.loadMoreFacts()); assert.equal(memoryData(h).data.facts.length, 51);
  } finally { await h.close(); }
});

test('the read window follows fresh cursors through insertions and rejects a non-progressing page', async () => {
  const file = path.join(source, 'frontend/src/production/task-knowledge-read-window.ts'), module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', js)(module.exports);
  const { readLoadedIdWindow } = module.exports;
  const inserted = Array.from({ length: 60 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
  const data = [...inserted, ...Array.from({ length: 51 }, (_, index) => ({ id: id(index + 1) }))], cursors = [];
  const pages = await readLoadedIdWindow(id(51), () => true, async after => {
    cursors.push(after);
    const rest = data.filter(item => after === null || item.id > after), items = rest.slice(0, 50);
    return { items, nextAfterId: rest.length > 50 ? items.at(-1).id : null };
  });
  assert.equal(pages.length, 3, 'New insertions must not push the previous loaded tail out of the refresh');
  assert.equal(pages.at(-1).items.at(-1).id, id(51));
  assert.deepEqual(cursors, [null, inserted[49].id, id(40)]);
  await assert.rejects(readLoadedIdWindow(id(51), () => true, async () => ({ items: [{ id: id(1) }], nextAfterId: id(1) })), /Invalid task or memory page order/);
});
