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
let bridgeEnvironment, childBridgeEntries = 0;
const View = React.forwardRef(({ children, testID, tabIndex }, ref) => e('div', { ref, tabIndex, 'data-testid': testID }, children));
const Pressable = React.forwardRef(({ children, testID, accessibilityLabel, disabled, onPress, onFocus, onBlur }, ref) => e('button', { ref, 'data-testid': testID, 'aria-label': accessibilityLabel, disabled, onClick: onPress, onFocus, onBlur }, children));
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
    if (filename.endsWith('/TaskKnowledgeDomains.tsx')) {
      if (name === './useDomainEnvironment') return { useDomainEnvironment: () => bridgeEnvironment };
      if (name === './task-knowledge-tasks') return { useTaskKnowledgeTasks: env => { childBridgeEntries++; return { scopeKey: env.scopeKey, model: {} }; } };
      if (name === './task-knowledge-summary') return { useTaskKnowledgeSummary: env => ({ scopeKey: env.scopeKey }) };
      if (name === './task-knowledge-memory') return { useTaskKnowledgeMemory: () => ({ value: null }) };
      if (name === './task-knowledge-growth') return { useTaskKnowledgeGrowth: env => ({ scopeKey: env.scopeKey, model: { scopeKey: env.scopeKey, page: null }, actions: { refresh() {} } }) };
      if (name === './useFamilyDocuments') return { useFamilyDocuments: () => ({ archive: { authorityVersion: null }, preparation: null, refresh() {} }) };
    }

    if (name === 'react-native') return { View, Pressable, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text, ActivityIndicator: () => e('span', null, 'loading') };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: View };
    if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false }) };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1000, ref: React.useRef(null), onLayout() {} }) };
    if (name.endsWith('/FormDialog')) return { FormDialog: ({visible, children, title, onClose}) => visible ? e('section', {role: 'dialog', 'aria-label': title}, e('button', {onClick: onClose}, 'Close detail'), children) : null };
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
const { PersonalConversationHistoryView, PersonalNotificationHistoryView, PersonalNotificationContent } = load('frontend/src/components/history/PersonalHistoryViews.tsx');
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
  if (url.pathname.endsWith('/account/messages')) return { schemaVersion: 1, userId: user, scopeVersion: version, asOf: time,
    coverage: { kind: 'recorded_provider_acceptances', historical: 'unknown', excluded: ['authentication_email', 'unconfirmed_or_unsaved_sends'], pagination: 'live' },
    items: [{ messageId: 'telegram:' + uuid(30 + index), contentVersion: 1, scope: { kind: 'account' }, sentAt: time,
      contents: [{ channel: 'telegram', contentVersion: '1', title: null, body: 'Synthetic saved message ' + index, sentAt: time }] }],
    nextCursor: second ? null : 'notifications_2', complete: second };
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
  let owner, scope = 'scope-a', user = 'synthetic-a', child = childA, gate = initialGate, view = 'notifications', searchText = '', mounted = true;
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
    return e(PersonalHistoryProvider, { scopeKey: currentScope, value }, view === 'recent' ? e(PersonalNotificationContent, {owner: value, recent: true}) : view === 'notifications'
      ? e(PersonalNotificationHistoryView, { searchText, dateRange: { from: null, to: null } })
      : e(PersonalConversationHistoryView, { searchText, dateRange: { from: null, to: null }, onPrepareQuestion() {} }));
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
    async showConversation(open = false) { view = 'conversation'; await flush(render); if (open) await flush(() => container.querySelector('[data-testid="history-message-' + messageId + '"]').click()); },
    async showRecent() { view = 'recent'; await flush(render); },
    async filter(value) { searchText = value; await flush(render); },
    async switchScope(nextScope, nextUser = user, nextChild = childB) { scope = nextScope; user = nextUser; child = nextChild; await flush(render); },
    async close() { mounted = false; await flush(() => renderer.unmount()); queryClient.clear(); container.remove(); },
  };
}

test('a first read without a usable snapshot stays loading and a failure is never claimed empty', async () => {
  const delayed = deferred();
  const h = await harness(call => call.url.pathname.endsWith('/account/messages') ? delayed.promise : undefined);
  try {
    assert.equal(h.owner.notifications.state, 'loading'); assert.equal(h.owner.notifications.data, null);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ error: { code: 'unavailable' } }, 503) : undefined);
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
    await h.warm(); await h.showConversation(true);
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
    if (call.url.pathname.endsWith('/account/messages')) return json({ ...fixtures(call.url, call.user), items: [], nextCursor: null, complete: true });
    if (call.url.pathname.endsWith('/agent/history')) return json({ ...fixtures(call.url, call.user), matches: [], nextCursor: null, complete: true });
  };
  for (const kind of ['notifications', 'history']) {
    const h = await harness(emptyPage), pending = [];
    try {
      if (kind === 'history') { await h.flush(() => h.owner.actions.searchHistory('')); await h.showConversation(); }
      const selector = `[data-testid="${kind === 'history' ? 'conversation' : 'notification'}-history-empty"]`;
      const card = h.container.querySelector(selector); assert.ok(card);
      h.gate((call, normal) => {
        if (!call.url.pathname.endsWith(kind === 'history' ? '/agent/history' : '/account/messages')) return emptyPage(call, normal);
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
    h.gate(call => call.url.pathname.endsWith('/account/messages') && call.url.searchParams.has('cursor') ? json({ error: { code: 'unavailable' } }, 503) : undefined);
    await h.focus();
    assert.equal(h.owner.notifications.state, 'stale'); assert.equal(h.owner.notifications.data, before.data); assert.equal(h.owner.notifications.asOf, before.asOf);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 2);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    assert.match(h.container.textContent, /目前顯示較早的消息/);
    const count = h.calls.length;
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ ...fixtures(call.url, call.user), nextCursor: 'notifications_2', complete: false }) : undefined);
    await h.focus();
    assert.equal(h.owner.notifications.state, 'stale'); assert.equal(h.owner.notifications.data, before.data); assert.equal(h.owner.notifications.asOf, before.asOf);
    assert.equal(h.calls.slice(count).filter(call => call.url.pathname.endsWith('/account/messages')).length, 2);
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
      if (!call.url.pathname.endsWith('/account/messages')) return undefined;
      const wait = deferred(); pending.push({ call, wait, normal }); return wait.promise;
    });
    await h.focus(); await h.flush(() => { publishOnlineRefresh(); publishOnlineRefresh(); publishOnlineRefresh(); });
    assert.equal(pending.length, 1, 'Invalidations do not launch overlapping notification reads');
    await h.flush(() => pending[0].wait.resolve(pending[0].normal()));
    assert.equal(pending.length, 2);
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ ...fixtures(call.url, call.user), items: [], nextCursor: null, complete: true }) : undefined);
    await h.flush(() => pending[1].wait.resolve(pending[1].normal()));
    assert.equal(h.calls.slice(count).filter(call => call.url.pathname.endsWith('/account/messages')).length, 3, 'Exactly one bounded trailing batch, stopping at the actual end');
    assert.equal(h.owner.notifications.state, 'ready'); assert.equal(h.owner.notifications.data.items.length, 0);
    assert.ok(h.container.querySelector('[data-testid="notification-history-empty"]'));
  } finally { await h.close(); }
});

test('scope changes, revocation and message-authority invalidation never retain private snapshots or accept late results', async () => {
  const h = await harness();
  try {
    await h.warm(); const pending = [];
    h.gate((call, normal) => {
      if (!call.url.pathname.endsWith('/account/messages')) return undefined;
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
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ error: { code: 'messages_scope_changed' } }, 409) : undefined);
    await h.focus(); assert.equal(h.owner.notifications.state, 'error'); assert.equal(h.owner.notifications.data, null);
    h.gate(null); await h.flush(() => h.owner.actions.loadNotifications()); assert.equal(h.owner.notifications.state, 'ready');
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ error: { code: 'unauthorized' } }, 403) : undefined);
    await h.focus(); assert.equal(h.owner.access, 'revoked');
    for (const kind of ['work', 'history', 'message', 'references', 'notifications']) assert.equal(h.owner[kind].data, null);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 0);
  } finally { await h.close(); }
});

test('missing message route is unavailable, not an empty inbox or loss of the other personal domains', async () => {
  const h = await harness(call => call.url.pathname.endsWith('/account/messages') ? json({ error: { code: 'not_found' } }, 404) : undefined);
  try {
    assert.equal(h.owner.notificationUnavailable, true); assert.equal(h.owner.notifications.state, 'unavailable');
    assert.equal(h.owner.access, 'active'); assert.ok(h.owner.work.data); assert.ok(h.owner.references.data);
    assert.equal(h.container.querySelector('[data-testid="notification-history-empty"]'), null);
    assert.match(h.container.textContent, /消息內容暫未提供/);
    h.gate(null); await h.flush(() => h.owner.actions.loadNotifications());
    assert.equal(h.owner.notificationUnavailable, false); assert.equal(h.owner.notifications.state, 'ready');
  } finally { await h.close(); }
});

test('HTTP 200 with another recipient or authority never appends to previously read messages', async () => {
  for (const change of [{ userId: 'another-synthetic-user' }, { scopeVersion: 'b'.repeat(64) }]) {
    const h = await harness();
    try {
      assert.ok(h.owner.notifications.data.items.length);
      h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ ...fixtures(call.url, call.user), ...change }) : undefined);
      await h.flush(() => h.owner.actions.moreNotifications());
      assert.equal(h.owner.notifications.state, 'error'); assert.equal(h.owner.notifications.data, null);
      assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 0);
    } finally { await h.close(); }
  }
});


test('the endpoint identity_changed error clears all existing personal snapshots', async () => {
  const h = await harness();
  try {
    await h.warm();
    h.gate(call => call.url.pathname.endsWith('/account/messages') ? json({ error: { code: 'identity_changed' } }, 409) : undefined);
    await h.focus(); assert.equal(h.owner.access, 'revoked');
    for (const kind of ['work', 'history', 'message', 'references', 'notifications']) assert.equal(h.owner[kind].data, null);
    assert.equal(h.container.querySelectorAll('[data-testid="personal-notification-entry"]').length, 0);
  } finally { await h.close(); }
});


test('the actual host mounts one account-only message owner without child reads and replaces it cleanly when a child is selected', async () => {
  const { ProductionTaskKnowledgeDomains } = load('frontend/src/production/TaskKnowledgeDomains.tsx');
  const { usePersonalHistoryWorkspace } = load('frontend/src/production/usePersonalHistory.ts');
  const { PersonalNotificationContent } = load('frontend/src/components/history/PersonalHistoryViews.tsx');
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container), queryClient = new QueryClient();
  const calls = []; let currentOwner, gate, active = true;
  const authority = { getSnapshot: () => ({ scopeKey: bridgeEnvironment.scopeKey, identityKey: bridgeEnvironment.identityKey }), fetcher: async (input, init = {}) => {
    assert.equal(init.method || 'GET', 'GET'); const url = new URL(input, 'https://synthetic.test');
    const call = { url, signal: init.signal, user: init.headers['x-expected-user-id'] }; calls.push(call);
    return gate?.(call) ?? json(fixtures(url, call.user));
  } };
  const environment = (childId, user = 'synthetic-account') => {
    const scopeKey = childId ? `${user}:${childId}` : '', identityKey = user;
    return { owner: authority, scopeKey, identityKey, userId: user, childId, childName: 'Synthetic child', online: true, apiBaseUrl: 'https://synthetic.test/api', queryClient,
      current: () => active && bridgeEnvironment.scopeKey === scopeKey && bridgeEnvironment.identityKey === identityKey,
      currentIdentity: () => active && bridgeEnvironment.identityKey === identityKey, accessError() {} };
  };
  function Consumers() {
    currentOwner = usePersonalHistoryWorkspace();
    return e(React.Fragment, null, e(PersonalNotificationContent, { owner: currentOwner }), e(PersonalNotificationContent, { owner: currentOwner, recent: true }));
  }
  const render = () => renderer.render(e(ProductionTaskKnowledgeDomains, null, e(Consumers)));
  const flush = async action => React.act(async () => { action?.(); for (let i = 0; i < 6; i++) await new Promise(setImmediate); });
  const messages = () => calls.filter(call => call.url.pathname.endsWith('/account/messages'));
  childBridgeEntries = 0; bridgeEnvironment = environment(null);
  try {
    await flush(render); assert.equal(currentOwner.notifications.state, 'ready'); assert.equal(messages().length, 1, 'history and bell share one initial read');
    assert.equal(childBridgeEntries, 0); assert.equal(calls.length, 1, 'no work, references or conversation prefetch without a child');
    const wait = deferred(); gate = call => call.url.pathname.endsWith('/account/messages') ? wait.promise : undefined;
    await flush(() => currentOwner.actions.loadNotifications()); const accountRefresh = messages().at(-1);
    bridgeEnvironment = environment(childA); gate = null; await flush(render);
    assert.equal(accountRefresh.signal.aborted, true); assert.equal(currentOwner.scopeKey, bridgeEnvironment.scopeKey); assert.ok(childBridgeEntries > 0);
    assert.equal(messages().length, 3, 'one account refresh and exactly one child-owner first read');
    await flush(() => wait.resolve(json(fixtures(accountRefresh.url, accountRefresh.user)))); assert.equal(currentOwner.scopeKey, bridgeEnvironment.scopeKey);
    const next = deferred(); gate = call => call.url.pathname.endsWith('/account/messages') ? next.promise : undefined;
    bridgeEnvironment = environment(null); await flush(render);
    assert.equal(currentOwner.notifications.data, null, 'returning to account mode never revives its obsolete snapshot');
    assert.equal(currentOwner.notifications.state, 'loading'); assert.equal(messages().length, 4);
    await flush(() => next.resolve(json(fixtures(messages().at(-1).url, 'synthetic-account')))); assert.equal(currentOwner.notifications.state, 'ready');
    const oldIdentity = deferred(); gate = call => call.url.pathname.endsWith('/account/messages') ? oldIdentity.promise : undefined;
    await flush(() => currentOwner.actions.loadNotifications()); const oldRead = messages().at(-1);
    bridgeEnvironment = environment(null, 'synthetic-other-account'); await flush(render);
    assert.equal(oldRead.signal.aborted, true); assert.equal(currentOwner.notifications.data, null);
    gate = null; await flush(() => oldIdentity.resolve(json(fixtures(oldRead.url, oldRead.user))));
    assert.equal(currentOwner.notifications.data, null, 'another identity cannot receive the late previous recipient page');
  } finally { active = false; await flush(() => renderer.unmount()); queryClient.clear(); container.remove(); }
});

test('conversation cards open a standalone original reader and retain segmented readMessages authority', async () => {
  const h = await harness();
  try {
    h.gate((call) => {
      if (!call.url.pathname.includes('/agent/history/messages/')) return;
      const offset = Number(call.url.searchParams.get('offset') || 0);
      return json({...fixtures(call.url, call.user), offset, text: offset === 0 ? 'A'.repeat(4000) : offset === 4000 ? 'B'.repeat(4000) : 'C',
        nextOffset: offset === 0 ? 4000 : offset === 4000 ? 8000 : null, totalCharacters: 8001});
    });
    await h.flush(() => h.owner.actions.searchHistory('')); await h.showConversation();
    assert.equal(h.container.querySelector('[role="dialog"]'), null);
    const card = h.container.querySelector(`[data-testid="history-message-${messageId}"]`); assert.equal(card.tagName, 'BUTTON');
    assert.equal(card.querySelector('button'), null, 'The card itself is the single reading target');
    await h.flush(() => card.click());
    assert.equal(h.container.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(h.owner.message.data.text.length, 4000); assert.equal(h.owner.message.data.nextOffset, 4000);
    const more = () => [...h.container.querySelectorAll('button')].find(button => button.textContent === '繼續讀取原文');
    await h.flush(() => more().click()); assert.equal(h.owner.message.data.text, 'A'.repeat(4000) + 'B'.repeat(4000));
    await h.flush(() => more().click()); assert.equal(h.owner.message.data.text.length, 8001); assert.equal(more(), undefined);
    assert.match(h.container.querySelector('[role="dialog"]').textContent, /這則原文已完整讀取/);
    await h.showRecent(); assert.equal(h.owner.message.state, 'unavailable', 'Leaving this reader closes only its opened original');
    assert.equal(h.container.querySelector('[role="dialog"]'), null, 'Bell does not inherit the original-reader modal');
  } finally { await h.close(); }
});

test('changing conversation filters or child while an original read is pending aborts it and late private text never reappears', async () => {
  for (const transition of ['filter', 'child']) {
    const h = await harness(), pending = deferred(); let original;
    try {
      await h.flush(() => h.owner.actions.searchHistory('')); await h.showConversation();
      h.gate((call, normal) => {
        if (!call.url.pathname.includes('/agent/history/messages/')) return;
        original = {call, normal}; return pending.promise;
      });
      await h.flush(() => h.container.querySelector(`[data-testid="history-message-${messageId}"]`).click());
      assert.ok(h.container.querySelector('[role="dialog"]')); assert.equal(h.owner.message.state, 'loading');
      if (transition === 'filter') await h.filter('different query'); else await h.switchScope('scope-b', 'synthetic-b', childB);
      assert.equal(original.call.signal.aborted, true); assert.equal(h.container.querySelector('[role="dialog"]'), null);
      await h.flush(() => pending.resolve(original.normal()));
      assert.equal(h.owner.message.data, null); assert.doesNotMatch(h.container.textContent, /Synthetic original message/);
      if (transition === 'filter') { await h.filter(''); assert.equal(h.container.querySelector('[role="dialog"]'), null); }
    } finally { await h.close(); }
  }
});
