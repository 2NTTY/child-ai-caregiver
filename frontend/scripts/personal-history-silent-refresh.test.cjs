const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.env.SOURCE_ROOT || path.resolve(__dirname, '../..');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://synthetic.test/history' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => { throw new Error('Real network is forbidden in this synthetic test.'); };
const req = createRequire(path.join(root, 'frontend/package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript');
const { QueryClient } = req('@tanstack/react-query');
const e = React.createElement, cache = new Map();
const View = ({ children, testID, ...props }) => e('div', { 'data-testid': testID }, children);
const Text = ({ children }) => e('p', null, children);
// Real owner, runtime, API schema validators, event subscription and browser
// observer run against a synthetic GET-only transport. DOM ports do not claim
// browser layout, native scroll, timing of animation frames or live API coverage.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const input = relative === 'frontend/src/production/usePersonalHistory.ts' && process.env.OWNER_SOURCE ? process.env.OWNER_SOURCE : filename;
  const output = ts.transpileModule(fs.readFileSync(input, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return { View, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text, ActivityIndicator: () => e('span', null, 'loading') };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: View };
    if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false }) };
    if (name.endsWith('/VoiceMessage')) return { VoiceMessage: () => null };
    if (name.endsWith('/ui')) return { AppButton: ({ label, disabled, onPress }) => e('button', { disabled, onClick: onPress }, label) };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: ({ label }) => e('span', null, label) };
    if (name.endsWith('/EmptyListCard')) return { EmptyListCard: ({ title, testID }) => e('div', { 'data-testid': testID }, title) };
    if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: () => null };
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, spacing: {}, readingType: {} };
    if (name.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), name);
      const found = [target, target + '.ts', target + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const { usePersonalHistory, PersonalHistoryProvider } = load('frontend/src/production/usePersonalHistory.ts');
const { PersonalConversationHistoryView, PersonalNotificationHistoryView } = load('frontend/src/components/history/PersonalHistoryViews.tsx');
const { useOnlineUpdates } = load('src/client/use-online-updates.ts');
const { publishOnlineRefresh } = load('src/client/online-refresh-events.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childA = uuid(1), childB = uuid(2), time = '2026-10-22T00:00:00Z';
const version = 'a'.repeat(64), messageId = uuid(20);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixtures(url, user) {
  const second = url.searchParams.has('cursor'), index = second ? 2 : 1;
  const child = url.pathname.match(/\/children\/([^/]+)/)?.[1] || childA;
  if (url.pathname.endsWith('/online/spaces')) return { workspaces: [{ id: uuid(100), storageEpoch: uuid(101) }] };
  if (url.pathname.endsWith('/online/changes')) return { workspaceId: uuid(100), storageEpoch: uuid(101), cursor: '0', accessVersion: 1, changes: [], hasMore: false };
  if (url.pathname.endsWith('/account/export')) return { section: 'notification_deliveries', scopeVersion: version, notices: [],
    items: [{ id: uuid(30 + index), channel: 'telegram', status: 'unknown', created_at: time }], nextCursor: second ? null : 'notifications_2', complete: second };
  if (url.pathname.endsWith('/library')) return { items: [{ sourceId: 'synthetic-' + index, versionId: uuid(40 + index), title: 'Synthetic source ' + index,
    publisher: 'Synthetic publisher', url: 'https://www.fhs.gov.hk/synthetic', classification: 'official_guidance', checkedAt: time, sourceUpdatedAt: null, validUntil: null }],
    nextCursor: second ? null : 'references_2', complete: second };
  if (url.pathname.endsWith('/agent/work')) return { items: [{ id: uuid(10 + index), childId: child, version: 1, goal: user + ' work ' + index,
    focus: '', questions: [], sourceMessageIds: [messageId], resources: [], pending: [], status: 'waiting', createdAt: time, updatedAt: time }],
    nextCursor: second ? null : 'work_2', complete: second };
  if (url.pathname.includes('/agent/history/messages/')) return { id: messageId, childId: child, role: 'user', version: 1, createdAt: time,
    text: 'Synthetic original message', offset: 0, nextOffset: null, totalCharacters: 26 };
  if (url.pathname.endsWith('/agent/history')) return { matches: [{ id: index === 1 ? messageId : uuid(21), kind: 'message', version: 1, createdAt: time,
    role: 'user', excerpt: 'Synthetic ' + url.searchParams.get('query') + ' history ' + index }], scanned: 100, scanLimit: 100, nextCursor: second ? null : 'history_2', complete: second };
  assert.fail('Unexpected synthetic request ' + url.pathname);
}
async function harness(initialGate = null) {
  let owner, scope = 'scope-a', user = 'synthetic-a', child = childA, gate = initialGate, view = 'notifications', mounted = true;
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container), calls = [], queryClient = new QueryClient();
  const fetcher = async (input, init = {}) => {
    assert.equal(init.method || 'GET', 'GET', 'No write or real model transport is allowed');
    const url = new URL(input, 'https://synthetic.test'), call = { url, signal: init.signal, user: init.headers['x-expected-user-id'] };
    calls.push(call);
    const normal = () => json(fixtures(url, call.user));
    return gate?.(call, normal) ?? normal();
  };
  const authority = { fetcher };
  function Owner({ currentScope, currentUser, currentChild }) {
    const value = usePersonalHistory({ owner: authority, scopeKey: currentScope, identityKey: currentUser, userId: currentUser, childId: currentChild,
      childName: 'Synthetic child', online: true, apiBaseUrl: 'https://synthetic.test/api', queryClient,
      current: () => mounted && scope === currentScope && user === currentUser, accessError() {} });
    owner = value;
    useOnlineUpdates('https://synthetic.test/api', currentUser, true, async () => {}, fetcher);
    return e(PersonalHistoryProvider, { scopeKey: currentScope, value }, view === 'notifications'
      ? e(PersonalNotificationHistoryView, { searchText: '', dateRange: { from: null, to: null } })
      : e(PersonalConversationHistoryView, { searchText: '', dateRange: { from: null, to: null }, onPrepareQuestion() {} }));
  }
  const render = () => renderer.render(e(Owner, { key: scope, currentScope: scope, currentUser: user, currentChild: child }));
  const flush = async action => React.act(async () => { action?.(); for (let i = 0; i < 5; i++) await new Promise(setImmediate); });
  await flush(render);
  return {
    container, calls, get owner() { return owner; }, flush,
    gate(fn) { gate = fn; },
    async warm() {
      await flush(() => { owner.actions.loadNotifications(); owner.actions.searchHistory(''); });
      await flush(() => { owner.actions.moreNotifications(); owner.actions.moreWork(); owner.actions.moreReferences(); owner.actions.moreHistory(); });
      await flush(() => owner.actions.readMessage(messageId));
      assert.equal(owner.notifications.data.items.length, 2); assert.equal(owner.work.data.items.length, 2);
      assert.equal(owner.references.data.catalog.length, 2); assert.equal(owner.history.data.matches.length, 2);
      assert.equal(owner.message.data?.text, 'Synthetic original message');
    },
    async focus() { await flush(() => { window.dispatchEvent(new window.Event('focus')); document.dispatchEvent(new window.Event('visibilitychange')); window.dispatchEvent(new window.Event('focus')); }); },
    async showConversation() { view = 'conversation'; await flush(render); },
    async switchScope(nextScope, nextUser = user, nextChild = childB) { scope = nextScope; user = nextUser; child = nextChild; await flush(render); },
    async close() { mounted = false; await flush(() => renderer.unmount()); queryClient.clear(); container.remove(); },
  };
}

test('a first read without a usable snapshot stays loading and a failure is never claimed empty', async () => {
  const delayed = deferred();
  const h = await harness(call => call.url.pathname.endsWith('/account/export') ? delayed.promise : undefined);
  try {
    assert.equal(h.owner.notifications.state, 'loading'); assert.equal(h.owner.notifications.data, null);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    h.gate(call => call.url.pathname.endsWith('/account/export') ? json({ error: { code: 'unavailable' } }, 503) : undefined);
    await h.flush(() => delayed.resolve(json({ error: { code: 'unavailable' } }, 503)));
    assert.equal(h.owner.notifications.state, 'error'); assert.equal(h.owner.notifications.data, null);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    h.gate(null); await h.flush(() => h.owner.actions.loadNotifications());
    assert.equal(h.owner.notifications.state, 'ready'); assert.equal(h.owner.notifications.data.items.length, 1);
  } finally { await h.close(); }
});

test('a focused same-scope refresh retains every loaded page and expanded original until the atomic batch completes', async () => {
  const h = await harness();
  try {
    await h.warm(); await h.showConversation();
    const before = h.owner, detail = h.container.querySelector('[data-testid="history-message-detail"]');
    assert.ok(detail); h.container.scrollTop = 247;
    const delayed = deferred(), initialCalls = h.calls.length;
    h.gate((call, normal) => call.url.pathname.endsWith('/online/spaces') ? delayed.promise.then(normal) : undefined);
    await h.focus();
    assert.equal(h.calls.slice(initialCalls).filter(call => call.url.pathname.endsWith('/online/spaces')).length, 1, 'Focus and visible events share the real observer in-flight lock');
    const batches = [];
    h.gate((call, normal) => {
      if (call.url.pathname.includes('/online/')) return undefined;
      const pending = deferred(); batches.push({ call, pending, normal }); return pending.promise;
    });
    await h.flush(() => delayed.resolve());
    for (const kind of ['work', 'references', 'notifications', 'history']) {
      assert.equal(h.owner[kind].state, 'ready'); assert.equal(h.owner[kind].data, before[kind].data);
    }
    assert.equal(h.owner.message.data, before.message.data); assert.equal(h.container.querySelector('[data-testid="history-message-detail"]'), detail);
    assert.equal(h.container.scrollTop, 247);
    assert.equal(batches.length, 4, 'Only one first page per collection begins');
    await h.flush(() => { for (const batch of batches.slice()) batch.pending.resolve(batch.normal()); });
    assert.equal(batches.length, 8, 'Refresh follows exactly the previously loaded two-page depth');
    assert.equal(h.owner.history.data, before.history.data, 'A first page alone cannot truncate the visible snapshot');
    await h.flush(() => { for (const batch of batches.slice(4)) batch.pending.resolve(batch.normal()); });
    for (const [kind, field] of [['work', 'items'], ['references', 'catalog'], ['notifications', 'items'], ['history', 'matches']]) {
      assert.equal(h.owner[kind].data[field].length, 2); assert.equal(h.owner[kind].state, 'ready');
    }
    assert.equal(h.owner.history.data.scanned, 200); assert.equal(h.owner.message.data, before.message.data);
    assert.equal(h.container.querySelector('[data-testid="history-message-detail"]'), detail); assert.equal(h.container.scrollTop, 247);
  } finally { await h.close(); }
});

test('authoritative empty notification and same-query history cards stay mounted during a slow refresh', async () => {
  const emptyPage = (call, normal) => {
    if (call.url.pathname.endsWith('/account/export')) return json({ ...fixtures(call.url, call.user), items: [], nextCursor: null, complete: true });
    if (call.url.pathname.endsWith('/agent/history')) return json({ ...fixtures(call.url, call.user), matches: [], nextCursor: null, complete: true });
  };
  for (const kind of ['notifications', 'history']) {
    const h = await harness(emptyPage), pending = [];
    try {
      if (kind === 'history') { await h.flush(() => h.owner.actions.searchHistory('')); await h.showConversation(); }
      const selector = `[data-testid="${kind === 'history' ? 'conversation' : 'notification'}-history-empty"]`;
      const card = h.container.querySelector(selector); assert.ok(card);
      h.gate((call, normal) => {
        if (!call.url.pathname.endsWith(kind === 'history' ? '/agent/history' : '/account/export')) return emptyPage(call, normal);
        const wait = deferred(); pending.push({ call, wait }); return wait.promise;
      });
      await h.focus();
      assert.equal(h.owner[kind].state, 'ready'); assert.equal(h.owner.busy[kind], true);
      assert.equal(h.container.querySelector(selector), card, 'A successful empty snapshot must not disappear just because a refresh is pending');
      await h.flush(() => { for (const request of pending) request.wait.resolve(emptyPage(request.call)); });
      assert.equal(h.container.querySelector(selector), card);
    } finally { await h.close(); }
  }
});

test('failed or cyclic later pages keep the complete prior snapshot stale without advancing freshness or showing false empty', async () => {
  const h = await harness();
  try {
    await h.warm(); const before = h.owner.notifications;
    h.gate(call => call.url.pathname.endsWith('/account/export') && call.url.searchParams.has('cursor') ? json({ error: { code: 'unavailable' } }, 503) : undefined);
    await h.focus();
    assert.equal(h.owner.notifications.state, 'stale'); assert.equal(h.owner.notifications.data, before.data); assert.equal(h.owner.notifications.asOf, before.asOf);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 2);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    assert.match(h.container.textContent, /最新通知狀態尚未核對/);
    const count = h.calls.length;
    h.gate(call => call.url.pathname.endsWith('/account/export') ? json({ ...fixtures(call.url, call.user), nextCursor: 'notifications_2', complete: false }) : undefined);
    await h.focus();
    assert.equal(h.owner.notifications.state, 'stale'); assert.equal(h.owner.notifications.data, before.data); assert.equal(h.owner.notifications.asOf, before.asOf);
    assert.equal(h.calls.slice(count).filter(call => call.url.pathname.endsWith('/account/export')).length, 2);
  } finally { await h.close(); }
});

test('new searches supersede a delayed refresh and load-more cannot race the same collection', async () => {
  const h = await harness();
  try {
    await h.warm(); const pending = [], count = h.calls.length;
    h.gate((call, normal) => {
      if (!call.url.pathname.endsWith('/agent/history')) return undefined;
      const wait = deferred(); pending.push({ call, wait, normal }); return wait.promise;
    });
    await h.focus(); const old = pending[0];
    await h.flush(() => { h.owner.actions.moreHistory(); h.owner.actions.searchHistory('new'); h.owner.actions.searchHistory('new'); });
    assert.equal(pending.length, 2); assert.equal(old.call.signal.aborted, true);
    assert.equal(h.owner.message.data, null); assert.equal(h.owner.history.state, 'loading');
    await h.flush(() => pending[1].wait.resolve(pending[1].normal()));
    assert.equal(h.owner.history.data.query, 'new'); assert.equal(h.owner.history.data.matches.length, 1);
    await h.flush(() => old.wait.resolve(old.normal()));
    assert.equal(h.owner.history.data.query, 'new');
    assert.equal(h.calls.slice(count).filter(call => call.url.pathname.endsWith('/agent/history')).length, 2, 'Abandoned refresh cannot request a second page');
  } finally { await h.close(); }
});

test('one trailing invalidation is retained while busy and its latest successful result replaces removed rows', async () => {
  const h = await harness();
  try {
    await h.warm(); const pending = [], count = h.calls.length;
    h.gate((call, normal) => {
      if (!call.url.pathname.endsWith('/account/export')) return undefined;
      const wait = deferred(); pending.push({ call, wait, normal }); return wait.promise;
    });
    await h.focus(); await h.flush(() => { publishOnlineRefresh(); publishOnlineRefresh(); publishOnlineRefresh(); });
    assert.equal(pending.length, 1, 'Invalidations do not launch overlapping notification reads');
    await h.flush(() => pending[0].wait.resolve(pending[0].normal()));
    assert.equal(pending.length, 2);
    h.gate(call => call.url.pathname.endsWith('/account/export') ? json({ ...fixtures(call.url, call.user), items: [], nextCursor: null, complete: true }) : undefined);
    await h.flush(() => pending[1].wait.resolve(pending[1].normal()));
    assert.equal(h.calls.slice(count).filter(call => call.url.pathname.endsWith('/account/export')).length, 3, 'Exactly one bounded trailing batch, stopping at the actual end');
    assert.equal(h.owner.notifications.state, 'ready'); assert.equal(h.owner.notifications.data.items.length, 0);
    assert.ok(h.container.querySelector('[data-testid="notification-history-empty"]'));
  } finally { await h.close(); }
});

test('scope changes, revocation and export-version invalidation never retain private snapshots or accept late results', async () => {
  const h = await harness();
  try {
    await h.warm(); const pending = [];
    h.gate((call, normal) => {
      if (!call.url.pathname.endsWith('/account/export')) return undefined;
      const wait = deferred(); pending.push({ call, wait, normal }); return wait.promise;
    });
    await h.focus(); const old = pending[0];
    await h.switchScope('scope-b', 'synthetic-b');
    assert.equal(old.call.signal.aborted, true); assert.equal(h.owner.notifications.data, null);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 0);
    await h.flush(() => old.wait.resolve(old.normal())); assert.equal(h.owner.notifications.data, null);
    h.gate(null);
    await h.flush(() => { for (const request of pending.slice(1)) request.wait.resolve(request.normal()); });
    assert.equal(h.owner.scopeKey, 'scope-b'); assert.equal(h.owner.notifications.state, 'ready');
    h.gate(call => call.url.pathname.endsWith('/account/export') ? json({ error: { code: 'export_scope_changed' } }, 409) : undefined);
    await h.focus(); assert.equal(h.owner.notifications.state, 'error'); assert.equal(h.owner.notifications.data, null);
    h.gate(null); await h.flush(() => h.owner.actions.loadNotifications()); assert.equal(h.owner.notifications.state, 'ready');
    h.gate(call => call.url.pathname.endsWith('/account/export') ? json({ error: { code: 'unauthorized' } }, 403) : undefined);
    await h.focus(); assert.equal(h.owner.access, 'revoked');
    for (const kind of ['work', 'history', 'message', 'references', 'notifications']) assert.equal(h.owner[kind].data, null);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 0);
  } finally { await h.close(); }
});
