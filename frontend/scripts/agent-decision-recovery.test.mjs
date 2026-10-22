import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Actual owner, projection and API with synthetic fetch only; never real HTTP/model/storage.
const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(file), name); if (!existsSync(target)) target += '.ts'; return load(target);
  }, module, module.exports); return module.exports;
}
const { ProductAgentOwner } = load('frontend/src/production/ProductAgentOwner.ts');
const { createProductAgentApi } = load('src/client/product-agent-api.ts');
const { mayRetryOriginal, mayDecide } = load('frontend/src/agent-view-model.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childA = uuid(1), childB = uuid(2), runA = uuid(11), runB = uuid(12), proposalA = uuid(21), proposalB = uuid(22);
const scope = (childId, userId = 'parent-a', role = 'owner') => ({ key: JSON.stringify(['/api', userId, 1, childId, role]), childId, userId });
const context = (scopes = [scope(childA), scope(childB)], identityKey = '["/api","parent-a",1]') => ({ identityKey, allowedScopeKeys: scopes.map(s => s.key) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const proposal = (child = childA, patch = {}) => ({ id: child === childA ? proposalA : proposalB, childId: child, runId: child === childA ? runA : runB,
  version: 1, status: 'pending', createdAt: '2026-10-22T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', targetLabel: `Synthetic ${child}`,
  value: { kind: 'memory_fact', key: 'synthetic-fact', content: `Private synthetic content ${child}`, intendedVisibility: 'private', validUntil: null }, result: null, ...patch });
const result = (child = childA, proposals = [proposal(child)]) => ({ provenance: null, runId: child === childA ? runA : runB, status: 'completed', stopReason: null,
  text: `Synthetic reply ${child}`, citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals });
const accepted = child => proposal(child, { status: 'accepted', version: 2, result: { kind: 'memory_fact', id: uuid(90), version: 1 } });
function harness() {
  const calls = [], apis = [], denials = [], runValues = new Map([[childA, result(childA)], [childB, result(childB)]]);
  let post = async () => { throw new Error('Synthetic transport interruption'); }, get;
  const fetcher = async (url, options) => {
    const child = String(url).includes(childA) ? childA : childB;
    calls.push({ url, child, method: options.method, body: options.body, user: options.headers['x-expected-user-id'] });
    if (options.method === 'POST') return post(child, options);
    if (get) return get(child, options);
    if (String(url).endsWith('/pending')) return Response.json({ proposals: runValues.get(child).proposals.filter(p => ['pending', 'expired'].includes(p.status)), nextCursor: null });
    return Response.json({ result: runValues.get(child) });
  };
  const owner = new ProductAgentOwner('/api', true, e => denials.push(e), () => {}, () => { const api = createProductAgentApi('/api', fetcher); apis.push(api); return api; }, fetcher);
  const h = { owner, calls, apis, denials, runValues, setPost(fn) { post = fn; }, setGet(fn) { get = fn; },
    sync(child = childA, ctx = context()) { owner.syncContext(child ? scope(child) : null, true, ctx); },
    async open(child = childA) { owner.selectRun(child === childA ? runA : runB); await settle(); },
    async unknown(child = childA) { await h.open(child); owner.decide(child === childA ? proposalA : proposalB, 'accept'); await settle(); assert.ok(owner.getSnapshot().model.pendingDecision); },
    posts() { return calls.filter(c => c.method === 'POST'); } };
  h.sync(); return h;
}

test('same-scope close/navigation preserves the actual API tuple and only GET can unlock explicit original retry', async () => {
  const h = harness(); await h.unknown(); const model = h.owner.getSnapshot().model, pending = model.pendingDecision, api = h.owner.api;
  h.owner.collapseInbox(); h.owner.syncContext(scope(childA), true, context());
  assert.equal(h.owner.api, api); assert.equal(h.owner.getSnapshot().model.pendingDecision, pending);
  h.owner.decide(proposalA, 'accept'); h.owner.retryOriginal(); assert.equal(h.posts().length, 1);
  h.owner.selectRun(runB); assert.equal(h.calls.at(-1).method, 'POST');
  h.owner.selectRun(runA); await settle();
  assert.equal(h.calls.at(-1).method, 'GET'); assert.ok(h.calls.at(-1).url.endsWith(runA));
  assert.equal(h.owner.api, api); assert.equal(h.posts().length, 1); assert.equal(mayRetryOriginal(h.owner.getSnapshot().model), true);
  h.setPost(async child => Response.json({ proposal: accepted(child) })); h.owner.retryOriginal(); await settle();
  assert.equal(h.posts().length, 2); assert.deepEqual(h.posts()[1], h.posts()[0]); assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  h.owner.dispose();
});

test('A and B keep isolated unresolved capsules and restoration rereads the original run before retry', async () => {
  const h = harness(); await h.unknown(); const apiA = h.owner.api, pendingA = h.owner.getSnapshot().model.pendingDecision;
  h.sync(childB); assert.equal(h.owner.getSnapshot().model.run, null); assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  await h.unknown(childB); const apiB = h.owner.api;
  h.sync(childA); h.owner.retryOriginal(); assert.equal(h.posts().length, 2); await settle();
  assert.equal(h.owner.api, apiA); assert.equal(h.owner.getSnapshot().model.run.childId, childA);
  assert.deepEqual(h.owner.getSnapshot().model.pendingDecision.input, pendingA.input);
  assert.equal(h.calls.at(-1).method, 'GET'); assert.equal(h.calls.at(-1).child, childA);
  h.sync(childB); await settle(); assert.equal(h.owner.api, apiB); assert.equal(h.owner.getSnapshot().model.run.childId, childB);
  assert.equal(h.posts().length, 2); h.owner.dispose();
});

test('write-start capture and late success or failure after a child switch never populate the new child', async () => {
  for (const success of [true, false]) {
    const h = harness(), write = deferred(); h.setPost(() => write.promise); await h.open(); h.owner.decide(proposalA, 'accept');
    assert.ok(h.owner.getSnapshot().model.pendingDecision); const apiA = h.owner.api;
    h.sync(childB); await h.open(childB); const before = h.owner.getSnapshot().model;
    if (success) { h.runValues.set(childA, result(childA, [accepted(childA)])); write.resolve(Response.json({ proposal: accepted(childA) })); }
    else write.reject(new Error('Synthetic late failure'));
    await settle(); assert.equal(h.owner.getSnapshot().model, before); assert.equal(h.owner.getSnapshot().model.run.childId, childB);
    h.sync(childA); assert.equal(h.owner.api, apiA); assert.equal(h.posts().length, 1); await settle();
    assert.equal(h.owner.getSnapshot().model.run.childId, childA);
    assert.equal(!!h.owner.getSnapshot().model.pendingDecision, !success); assert.equal(h.posts().length, 1); h.owner.dispose();
  }
});

test('missing or failed recovery GET stays unknown and never allows a second POST', async () => {
  for (const missing of [true, false]) {
    const h = harness(); await h.unknown(); h.sync(childB);
    h.setGet(async child => missing ? Response.json({ result: result(child, []) }) : Response.json({ error: { code: 'synthetic_read_failure' } }, { status: 503 }));
    h.sync(childA); await settle(); const model = h.owner.getSnapshot().model;
    assert.ok(model.pendingDecision); assert.equal(model.pendingDecision.reviewed, false); assert.equal(mayRetryOriginal(model), false);
    h.owner.decide(proposalA, 'accept'); h.owner.retryOriginal(); assert.equal(h.posts().length, 1); h.owner.dispose();
  }
});

test('authoritative accepted, expired and newer-version GET resolve the old tuple without auto POST', async () => {
  for (const outcome of ['accepted', 'expired', 'version']) {
    const h = harness(); await h.unknown(); h.sync(childB);
    const p = outcome === 'accepted' ? accepted(childA) : proposal(childA, outcome === 'expired' ? { status: 'expired' } : { version: 2, value: { ...proposal().value, content: 'New synthetic version' } });
    h.runValues.set(childA, result(childA, [p])); h.sync(childA); await settle(); const model = h.owner.getSnapshot().model;
    assert.equal(model.pendingDecision, null); assert.equal(h.posts().length, 1); assert.equal(mayRetryOriginal(model), false);
    assert.equal(mayDecide(model, model.run.proposals[0], 'accept'), outcome === 'version'); h.owner.dispose();
  }
});

test('only contractual rejection is failed; 503 and lost transport retain the original unknown', async () => {
  for (const [status, code, rejected] of [[409, 'version_conflict', true], [400, 'sharing_confirmation_required', true], [503, 'ai_unavailable', false]]) {
    const h = harness(); h.setPost(async () => Response.json({ error: { code } }, { status })); await h.unknown();
    assert.equal(h.owner.getSnapshot().model.pendingDecision.rejected, rejected);
    assert.equal(h.owner.getSnapshot().model.notice.text, rejected ? '未接受成功' : '暫時無法確認結果');
    h.owner.retryOriginal(); assert.equal(h.posts().length, 1); h.owner.dispose();
  }
});

test('loading or unavailable scope inventory retains recovery; confirmed deletion and role changes prune it', async () => {
  const h = harness(); await h.unknown(); const apiA = h.owner.api;
  h.sync(childB, { identityKey: context().identityKey }); h.sync(null, { identityKey: context().identityKey });
  h.sync(childA); await settle(); assert.equal(h.owner.api, apiA); assert.ok(h.owner.getSnapshot().model.pendingDecision);
  h.sync(childB); h.sync(childB, context([scope(childB)])); h.sync(childA); await settle();
  assert.equal(h.owner.getSnapshot().model.pendingDecision, null); assert.notEqual(h.owner.api, apiA);
  await h.unknown(); h.sync(childB); h.sync(childB, context([scope(childB), scope(childA, 'parent-a', 'viewer')]));
  h.owner.syncContext(scope(childA, 'parent-a', 'viewer'), true, context([scope(childB), scope(childA, 'parent-a', 'viewer')]));
  assert.equal(h.owner.getSnapshot().model.pendingDecision, null); assert.equal(h.owner.getSnapshot().model.run, null); h.owner.dispose();
});

test('logout, new identity, denied scope and dispose invalidate capsules and all late writes', async () => {
  for (const boundary of ['logout', 'identity', 'denied', 'dispose']) {
    const h = harness(), write = deferred(); h.setPost(() => write.promise); await h.open(); h.owner.decide(proposalA, 'accept'); h.sync(childB);
    if (boundary === 'logout') h.owner.syncContext(null, true, { identityKey: null });
    if (boundary === 'identity') h.owner.syncContext(scope(childB, 'parent-b'), true, { identityKey: '["/api","parent-b",2]' });
    if (boundary === 'denied') h.owner.forgetChild(childA);
    if (boundary === 'dispose') h.owner.dispose();
    write.resolve(Response.json({ proposal: accepted(childA) })); await settle(); h.sync(childA); await settle();
    assert.equal(h.owner.getSnapshot().model.pendingDecision, null); assert.equal(h.owner.getSnapshot().model.run, null);
    assert.equal(h.posts().length, 1); h.owner.dispose();
  }
});

test('child-specific 403/404 only clear that child and keep another child on its original API and tuple', async () => {
  for (const status of [403, 404]) {
    const h = harness(); await h.unknown(); h.sync(childB); await h.unknown(childB); const apiB = h.owner.api, pendingB = h.owner.getSnapshot().model.pendingDecision;
    h.setGet(async child => child === childA ? Response.json({ error: { code: status === 404 ? 'not_found' : 'access_denied' } }, { status })
      : Response.json({ result: h.runValues.get(child) }));
    h.sync(childA); await settle();
    assert.equal(h.owner.getSnapshot().model.readState, 'denied'); assert.equal(h.owner.getSnapshot().model.run, null);
    assert.equal(h.owner.getSnapshot().model.pendingDecision, null); assert.equal(h.denials.length, 1);
    h.sync(childB); await settle(); assert.equal(h.owner.api, apiB);
    assert.deepEqual(h.owner.getSnapshot().model.pendingDecision.input, pendingB.input); assert.equal(mayRetryOriginal(h.owner.getSnapshot().model), true);
    assert.equal(h.posts().length, 2); h.setPost(async child => Response.json({ proposal: accepted(child) })); h.owner.retryOriginal(); await settle();
    assert.deepEqual(h.posts()[2], h.posts()[1]); h.owner.dispose();
  }
});

test('identity-level denial clears all private capsules', async () => {
  for (const [status, code] of [[401, null], [403, 'unauthorized'], [409, 'session_changed']]) {
    const h = harness(); await h.unknown(); h.sync(childB); await h.unknown(childB);
    h.setGet(async () => Response.json({ error: { code } }, { status })); h.sync(childA); await settle();
    assert.equal(h.owner.getSnapshot().model.readState, 'denied'); assert.equal(h.denials.length, 1);
    h.setGet(null); h.sync(childB); await settle(); assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
    assert.equal(h.owner.getSnapshot().model.run, null); h.owner.dispose();
  }
});

test('first HTTP 405 is a short known rejection and releases both owner and private API buffer without a fake success', async () => {
  const h = harness(); h.setPost(async () => Response.json({ error: { code: 'synthetic_read_only' } }, { status: 405 }));
  await h.open(); h.owner.decide(proposalA, 'accept'); await settle();
  let model = h.owner.getSnapshot().model; assert.equal(model.pendingDecision, null); assert.equal(model.notice.text, '未接受成功'); assert.equal(model.notice.tone, 'error');
  assert.equal(model.run.proposals[0].status, 'pending'); assert.equal(mayDecide(model, model.run.proposals[0], 'accept'), true);
  h.owner.decide(proposalA, 'accept'); await settle(); assert.equal(h.posts().length, 2, 'another explicit action is not trapped by an unknown API buffer');
  assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  h.sync(childB); h.sync(childA); await settle(); assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  assert.equal(h.posts().length, 2); h.owner.dispose();
});

test('unknown then GET then retry 405 cannot erase the earlier unknown in either owner or real API', async () => {
  const h = harness(); await h.unknown(); await h.owner.refresh(); const input = { ...h.owner.getSnapshot().model.pendingDecision.input };
  h.setPost(async () => Response.json({ error: { code: 'synthetic_read_only' } }, { status: 405 })); h.owner.retryOriginal(); await settle();
  const model = h.owner.getSnapshot().model; assert.equal(model.pendingDecision.reviewed, false); assert.equal(model.notice.text, '暫時無法確認結果');
  h.owner.retryOriginal(); h.owner.decide(proposalA, 'accept'); assert.equal(h.posts().length, 2);
  await assert.rejects(h.owner.api.decideProposal(childA, runA, proposalA, input, new AbortController().signal, 'parent-a'), error => error.code === 'check_original_run');
  assert.equal(h.posts().length, 2); h.sync(childB); h.sync(childA); await settle(); assert.equal(h.posts().length, 2);
  assert.equal(mayRetryOriginal(h.owner.getSnapshot().model), true); h.owner.retryOriginal(); await settle();
  assert.equal(h.posts().length, 3); assert.deepEqual(h.posts()[2], h.posts()[0]); h.owner.dispose();
});

test('a restored family decision requires fresh sharing consent before its exact original retry', async () => {
  const h = harness(); h.runValues.set(childA, result(childA, [proposal(childA, { value: { ...proposal().value, intendedVisibility: 'family' } })]));
  await h.open(); h.owner.setSharedConfirmation(proposalA, true); h.owner.decide(proposalA, 'accept'); await settle();
  assert.equal(h.owner.getSnapshot().model.pendingDecision.input.confirmShared, true);
  h.sync(childB); h.sync(childA); await settle(); let model = h.owner.getSnapshot().model;
  assert.equal(mayRetryOriginal(model), false); assert.deepEqual(model.sharedConfirmed, {});
  h.owner.setSharedConfirmation(proposalA, true); model = h.owner.getSnapshot().model; assert.equal(mayRetryOriginal(model), true);
  h.setPost(async child => Response.json({ proposal: { ...accepted(child), value: { ...accepted(child).value, intendedVisibility: 'family' } } }));
  h.owner.retryOriginal(); await settle(); assert.deepEqual(h.posts()[1], h.posts()[0]); h.owner.dispose();
});

test('real Care close, route remount and both reopen handlers keep the real owner tuple and issue GET only', async () => {
  const { harness: componentHarness } = await import('./scope-transition-harness.mjs');
  const dialog = Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Content: 'Content', Actions: 'Actions' });
  const mocks = {
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'react-native-paper': { Text: 'Text', Portal: 'Portal' },
    'expo-router': { usePathname: () => '/care', useRouter: () => ({ push() {} }), useLocalSearchParams: () => ({}) },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    '../theme': { spacing: {}, colors: {}, radius: {}, typeScale: {} },
    '../components/ui': { AppButton: 'Button', SectionCard: 'SectionCard', SectionHeader: 'SectionHeader' },
    '../components/AppDialog': { AppDialog: dialog }, '../components/AppScrollView': { AppScrollView: 'ScrollView' },
    '../production/CareProfileDomains': { useProductionCareProfile: () => null },
    '../production/useDomainEnvironment': {}, '../workspaces/CareWorkspace': { useCareWorkspace: () => null }, './photosScreen': {},
  };
  for (const [prefix, names] of [['../components/', ['EmptyListCard', 'ReadStateNotice', 'PageFrame']],
    ['../components/care/', ['CareRecordsView']], ['../components/agent/', ['AgentRunView']]])
    for (const name of names) mocks[prefix + name] = { [name]: name };
  const ui = componentHarness(mocks); let serial = 0;
  mocks.react = { ...ui.react, useId: () => ui.react.useRef(`recovery-ui-${++serial}`).current };
  const guard = ui.load('src/preview/PreviewNavigationGuard.tsx'), { AgentPendingReview } = ui.load('src/screens/careScreen.tsx');
  const h = harness(); await h.owner.readPending();
  const actions = { refresh: h.owner.refresh, decide: h.owner.decide, retryOriginal: h.owner.retryOriginal, setSharedConfirmation: h.owner.setSharedConfirmation, openSource() {} };
  let navigate;
  function Page() { navigate = guard.usePreviewNavigation(); return ui.jsx(AgentPendingReview, {}); }
  const render = () => {
    const snapshot = h.owner.getSnapshot(); ui.production({ scopeKey: scope(childA).key, selectedChildId: childA, online: true,
      agentModel: snapshot.model, agentPending: snapshot.pending, agentActions: actions, readAgentPending: h.owner.readPending, selectAgentRun: h.owner.selectRun });
    ui.render(ui.jsx(guard.PreviewNavigationGuard, { children: ui.jsx(Page, {}) }));
  };
  const button = label => ui.hosts().find(n => n.type === 'Button' && n.props.label === label);
  const modal = () => ui.hosts().find(n => n.props.accessibilityLabel === '助手運行結果');
  const runReads = () => h.calls.filter(c => c.method === 'GET' && c.url.endsWith(runA)).length;
  render(); await settle(); render(); assert.equal(button('查看結果').props.disabled, false);
  button('查看結果').props.onPress(); await settle(); render();
  ui.hosts().find(n => n.type === 'AgentRunView').props.actions.decide(proposalA, 'accept'); await settle(); render();
  const original = h.owner.getSnapshot().model.pendingDecision, api = h.owner.api;
  modal().props.onDismiss(); render(); assert.equal(modal().props.visible, false); assert.equal(button('留在此頁查核'), undefined);
  let left = false; navigate(() => { left = true; }); render(); assert.equal(left, true);
  ui.unmount(); render(); assert.equal(modal().props.visible, false);
  assert.equal(h.owner.getSnapshot().model.pendingDecision, original); assert.equal(h.owner.api, api); assert.equal(h.posts().length, 1);
  const read = deferred(); h.setGet(() => read.promise); const readsBefore = runReads();
  button('查看結果').props.onPress(); render(); assert.equal(runReads(), readsBefore + 1);
  h.owner.decide(proposalA, 'accept'); h.owner.retryOriginal(); assert.equal(h.posts().length, 1);
  read.resolve(Response.json({ result: result() })); await settle(); render();
  assert.equal(h.owner.getSnapshot().model.pendingDecision.reviewed, true);
  button('關閉結果').props.onPress(); render(); assert.equal(modal().props.visible, false);
  h.setGet(null); h.runValues.set(childA, result(childA, [accepted(childA)]));
  button('查看所選結果').props.onPress(); await settle(); render();
  assert.equal(runReads(), readsBefore + 2); assert.equal(h.owner.getSnapshot().model.pendingDecision, null);
  assert.equal(h.owner.getSnapshot().model.run.proposals[0].status, 'accepted'); assert.equal(h.posts().length, 1);
  ui.unmount(); h.owner.dispose();
});

async function startupRecoveryHarness(route) {
  const { harness: componentHarness } = await import('./scope-transition-harness.mjs');
  const owner = harness(); let child = childA;
  owner.setPost(async () => Response.json({ error: { code: 'synthetic_unknown' } }, { status: 503 }));
  const noop = () => {}, currentScope = () => scope(child).key;
  const ui = componentHarness({
    '../workspaces/CareWorkspace': { useCareWorkspace: () => ({ scopeKey: currentScope(), model: { list: { state: 'ready', activeQuery: '', activeKind: 'all' } }, actions: { search: noop } }) },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ scopeKey: currentScope(), model: { current: {} }, actions: { refresh: noop } }) },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null }, '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../workspaces/MemoryReferenceWorkspace': { useMemoryReferenceWorkspace: () => null },
    './TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null, useProductionTaskKnowledgeSummary: () => null, useProductionTaskKnowledgeMemory: () => null },
    './PhotoInputDomains': { useProductionPhotoInputDomains: () => null }, './usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
    './SettingsDomains': { useProductionContactDomain: () => ({ model: {}, actions: { refresh: noop } }), useProductionSettingsDomains: () => ({
      family: { actions: { refresh: noop } }, modelSettings: { model: {}, actions: { refresh: noop } },
      push: { model: {}, actions: { refresh: noop } }, telegram: { model: {}, actions: { refresh: noop } }, preferences: { refresh: noop },
    }) },
  });
  const { ProductionFirstScreenGate, useProductionSwitchReadiness } = ui.load('src/production/ProductionFirstScreenGate.tsx');
  const { ProductionStartupReadiness } = ui.load('src/production/ProductionStartupReadiness.tsx');
  const { MotionScopeBoundary } = ui.load('src/motion/MotionScopeBoundary.tsx');
  function Content() {
    const readiness = useProductionSwitchReadiness(), model = owner.owner.getSnapshot().model;
    // The real Care/Chat routes request discovery on scope entry; an unresolved decision queues it.
    ui.react.useEffect(() => { void owner.owner.readPending(); }, [child]);
    return ui.jsx(MotionScopeBoundary, { scopeKey: currentScope(), childKey: child, resetKey: context().identityKey,
      readiness: readiness.state, readinessKey: readiness.key, onRetry: readiness.retry,
      onReturn: id => { owner.sync(id); render(id); },
      children: ui.jsx('PrivateContent', { child: model.run?.childId, pending: model.pendingDecision }) });
  }
  function render(nextChild = child) {
    child = nextChild; const snapshot = owner.owner.getSnapshot();
    ui.production({ identityKey: context().identityKey, scopeKey: currentScope(), selectedChildId: child,
      recordsState: { auth: 'signedIn', online: true, children: [{ id: childA }, { id: childB }], childrenLoading: false,
        childrenError: null, childrenLoadedAt: '2026-10-22', selectedChildId: child }, controller: { reloadChildren: noop },
      chatState: { loading: false, loadedAt: '2026-10-22' }, chatController: { reloadMessages: noop },
      agentModel: snapshot.model, agentActions: { refresh: owner.owner.refresh }, agentPending: snapshot.pending, readAgentPending: owner.owner.readPending });
    ui.route(route); ui.render(ui.jsx(ProductionFirstScreenGate, { width: 1000, launch: ui.jsx('Launch'),
      children: [ui.jsx(ProductionStartupReadiness, {}, 'readiness'), ui.jsx(Content, {}, 'content')] }));
  }
  const content = () => ui.hosts().find(n => n.props.children?.type === 'PrivateContent');
  const reads = child => owner.calls.filter(c => c.method === 'GET' && c.url.endsWith(child === childA ? runA : runB)).length;
  await owner.owner.readPending(); await owner.unknown(); render(); ui.tick();
  ui.node('motion-child-scope').props.onLayout({ nativeEvent: { layout: { width: 900 } } });
  owner.sync(childB); await owner.owner.readPending(); await owner.open(childB);
  owner.owner.decide(proposalB, 'dismiss'); await settle(); render(childB); ui.finish();
  assert.equal(owner.posts().length, 2); assert.equal(JSON.parse(owner.posts()[0].body).decision, 'accept');
  assert.equal(JSON.parse(owner.posts()[1].body).decision, 'dismiss');
  return { ...owner, ui, render, content, reads, dispose() { ui.unmount(); owner.owner.dispose(); } };
}

test('real owner recovery releases the real startup/MotionScope barrier without inventing a pending-list snapshot', async () => {
  for (const route of ['/care', '/chat']) {
    const app = await startupRecoveryHarness(route);
    for (const child of [childA, childB]) {
      const read = deferred(), before = app.reads(child); app.setGet(() => read.promise); app.sync(child); app.render(child); app.ui.finish();
      assert.equal(app.reads(child), before + 1); assert.equal(app.content().props['aria-hidden'], true);
      assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'loading');
      assert.equal(app.owner.getSnapshot().pending.state, 'idle'); assert.ok(!app.owner.getSnapshot().pending.hasSnapshot);
      app.owner.retryOriginal(); assert.equal(app.posts().length, 2);
      read.resolve(Response.json({ result: result(child) })); await settle(); app.render(); app.ui.finish();
      assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'ready');
      assert.equal(app.content().props['aria-hidden'], false); assert.equal(app.content().props.ref.current.inert, false);
      assert.equal(app.ui.node('motion-child-curtain'), undefined); assert.equal(app.ui.node('motion-child-recovery'), undefined);
      assert.equal(app.content().props.children.props.child, child);
      assert.equal(app.content().props.children.props.pending.input.decision, child === childA ? 'accept' : 'dismiss');
      assert.equal(app.owner.getSnapshot().pending.state, 'idle', 'the unread discovery page must not be fabricated');
      assert.ok(!app.owner.getSnapshot().pending.hasSnapshot); assert.ok(app.owner.getSnapshot().model.pendingDecision);
      assert.equal(app.posts().length, 2, 'settling the curtain never retries a mutation');
    }
    app.dispose();
  }
});

test('failed restored GET allows return to the prior child or original-run GET retry, never blocked discovery or POST', async () => {
  for (const mode of ['retry', 'return']) {
    const app = await startupRecoveryHarness('/care');
    app.setGet(async () => Response.json({ error: { code: 'synthetic_failure' } }, { status: 503 })); app.sync(childA); await settle(); app.render(childA); app.ui.finish();
    assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'error');
    assert.ok(app.ui.node('motion-child-recovery')); assert.equal(app.content().props['aria-hidden'], true);
    assert.equal(app.owner.getSnapshot().pending.state, 'idle'); assert.equal(app.owner.getSnapshot().model.pendingDecision.reviewed, false);
    const target = mode === 'retry' ? childA : childB, before = app.reads(target); app.setGet(null);
    app.ui.hosts().find(n => n.type === 'Button' && n.props.label === (mode === 'retry' ? '重新載入' : '返回上一位孩子')).props.onPress();
    await settle(); app.render(); app.ui.finish();
    assert.equal(app.reads(target), before + 1); assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'ready');
    assert.equal(app.content().props['aria-hidden'], false); assert.equal(app.content().props.children.props.child, target);
    assert.ok(app.owner.getSnapshot().model.pendingDecision); assert.equal(app.posts().length, 2);
    if (mode === 'return') { app.sync(childA); app.render(childA); await settle(); app.render(); app.ui.finish();
      assert.equal(app.owner.getSnapshot().model.pendingDecision.input.decision, 'accept'); assert.equal(app.posts().length, 2); }
    app.dispose();
  }
});

test('denied restored GET stays concealed and clears only its child while another original recovery can settle', async () => {
  for (const status of [403, 404]) {
    const app = await startupRecoveryHarness('/chat');
    app.setGet(async () => Response.json({ error: { code: status === 404 ? 'not_found' : 'access_denied' } }, { status }));
    app.sync(childA); await settle(); app.render(childA); app.ui.finish();
    assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'error');
    assert.ok(app.ui.node('motion-child-recovery')); assert.equal(app.content().props['aria-hidden'], true);
    assert.equal(app.owner.getSnapshot().model.run, null); assert.equal(app.owner.getSnapshot().model.pendingDecision, null);
    app.setGet(null); app.sync(childB); app.render(childB); await settle(); app.render(); app.ui.finish();
    assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'ready');
    assert.equal(app.content().props['aria-hidden'], false); assert.equal(app.content().props.children.props.child, childB);
    assert.equal(app.owner.getSnapshot().model.pendingDecision.input.decision, 'dismiss'); assert.equal(app.posts().length, 2);
    app.dispose();
  }
});

test('late original GET and stale startup retry cannot release or refetch a newer child scope', async () => {
  const app = await startupRecoveryHarness('/care'), readA = deferred(), readB = deferred();
  app.setGet(() => readA.promise); app.sync(childA); app.render(childA); app.ui.finish(); app.ui.tick();
  const staleRetry = app.ui.hosts().find(n => n.type === 'Button' && n.props.label === '重新載入'); assert.ok(staleRetry);
  app.setGet(() => readB.promise); app.sync(childB); app.render(childB); app.ui.finish(); const bReads = app.reads(childB);
  readA.resolve(Response.json({ result: result(childA, [accepted(childA)]) })); await settle(); app.render(); app.ui.finish(); staleRetry.props.onPress();
  assert.equal(app.reads(childB), bReads); assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'loading');
  assert.equal(app.content().props['aria-hidden'], true); assert.equal(app.owner.getSnapshot().model.run.childId, childB);
  assert.equal(app.owner.getSnapshot().model.pendingDecision.input.decision, 'dismiss');
  readB.resolve(Response.json({ result: result(childB) })); await settle(); app.render(); app.ui.finish();
  assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'ready'); assert.equal(app.content().props['aria-hidden'], false);
  assert.equal(app.content().props.children.props.child, childB); assert.equal(app.posts().length, 2); app.dispose();
});

test('authoritative terminal or newer-version recovery returns readiness to actual queued discovery without a second mutation', async () => {
  for (const outcome of ['accepted', 'expired', 'version']) {
    const app = await startupRecoveryHarness('/care');
    const p = outcome === 'accepted' ? accepted(childA) : proposal(childA, outcome === 'expired' ? { status: 'expired' } : { version: 2 });
    app.runValues.set(childA, result(childA, [p])); app.sync(childA); app.render(childA); await settle(); app.render(); app.ui.finish();
    assert.equal(app.owner.getSnapshot().model.pendingDecision, null);
    assert.equal(app.owner.getSnapshot().pending.state, 'ready'); assert.equal(app.owner.getSnapshot().pending.hasSnapshot, true);
    assert.ok(app.calls.some(c => c.method === 'GET' && c.child === childA && c.url.endsWith('/pending')));
    assert.equal(app.ui.node('motion-child-scope').props.dataSet.motionData, 'ready'); assert.equal(app.content().props['aria-hidden'], false);
    assert.equal(app.posts().length, 2); app.dispose();
  }
});
