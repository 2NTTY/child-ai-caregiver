import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './scope-transition-harness.mjs';

test('care and the visible chat activity label wait for pending proposals, not hidden details', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  const reads = { profile: 'ready', care: 'ready', chat: 'ready', agentPending: 'loading', photos: 'ready' };
  assert.equal(routeStartupReadiness('/care', {}, reads, true, true), 'loading');
  assert.equal(routeStartupReadiness('/chat', {}, reads, true, true), 'loading');
  assert.equal(routeStartupReadiness('/care', { view: 'photos' }, reads, true, true), 'ready');
  assert.equal(routeStartupReadiness('/care', {}, { ...reads, agentPending: 'error' }, true, true), 'error');
  assert.equal(routeStartupReadiness('/care', {}, { ...reads, agentPending: 'ready', agentInbox: 'loading' }, true, true), 'ready');
});

test('an explicit task or care deep-link waits beyond its ready list for the exact detail', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  const reads = { profile: 'ready', tasks: 'ready', care: 'ready', agentPending: 'ready', taskDetail: 'loading', careDetail: 'loading' };
  assert.equal(routeStartupReadiness('/tasks', { taskId: 'target' }, reads, true, true), 'loading');
  assert.equal(routeStartupReadiness('/care', { recordId: 'target' }, reads, true, true), 'loading');
  assert.equal(routeStartupReadiness('/tasks', {}, reads, true, true), 'ready');
  assert.equal(routeStartupReadiness('/care', {}, reads, true, true), 'ready');
});

test('a target read only accepts its exact result and exposes explicit failed reads', () => {
  const h = harness(), { targetStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  assert.equal(targetStartupReadiness('B', 'A', { id: 'A', state: 'ready' }), 'loading');
  assert.equal(targetStartupReadiness('B', undefined, { id: 'B', state: 'loading' }), 'loading');
  assert.equal(targetStartupReadiness('B', undefined, { id: 'B', state: 'error' }), 'error');
  assert.equal(targetStartupReadiness('B', 'A', { id: 'B', state: 'ready' }), 'error');
  assert.equal(targetStartupReadiness('B', 'B', { id: 'B', state: 'ready' }), 'ready');
  assert.equal(targetStartupReadiness(undefined, undefined, undefined), 'ready');
});

function gateScenario() {
  const h = harness({
    '../startup/FirstScreenGate': { FirstScreenGate: ({ children }) => children },
    '../startup/dataReadiness': { productionStartupReadiness: (...args) => h.load('src/startup/dataReadiness.ts').productionStartupReadiness(...args) },
  });
  const gate = h.load(process.env.READINESS_GATE_SOURCE || 'src/production/ProductionFirstScreenGate.tsx');
  h.production({ identityKey: 'parent', scopeKey: 'parent:B', controller: { reloadChildren() {} }, recordsState: {
    auth: 'signedIn', online: true, children: [{ id: 'B' }], childrenLoading: false, childrenError: null, childrenLoadedAt: '2026-10-10', selectedChildId: 'B',
  } });
  let visible = 'model', observed, retried = [];
  function Reporter() {
    const active = gate.useProductionVisibleSettingsSection?.();
    gate.useProductionStartupReadiness(active === 'model' ? 'loading' : 'ready', () => retried.push(active));
    observed = gate.useProductionSwitchReadiness();
    return null;
  }
  function VisibleSettings() { gate.useProductionVisibleSettingsSection?.(visible); return null; }
  const render = (path, params, section = visible) => {
    visible = section; h.route(path, params);
    h.render(h.jsx(gate.ProductionFirstScreenGate, { width: 1000, launch: null,
      children: [h.jsx(Reporter, {}, 'report'), ...(path === '/settings' ? [h.jsx(VisibleSettings, {}, 'settings')] : [])] }));
    return observed;
  };
  return { render, retried };
}

test('the actual visible settings panel overrides a stale URL section and fences old retries', () => {
  const app = gateScenario();
  const first = app.render('/settings', { section: 'account' }, 'model');
  assert.equal(first.state, 'loading', 'visible model first read cannot be skipped because the URL says account');
  const next = app.render('/settings', { section: 'account' }, 'preferences');
  assert.equal(next.state, 'ready'); assert.notEqual(next.key, first.key);
  first.retry(); assert.deepEqual(app.retried, []);
  next.retry(); assert.deepEqual(app.retried, ['preferences']);
});

test('changing only an explicit URL target changes the gate key and invalidates old retries', () => {
  for (const [path, name] of [['/tasks', 'taskId'], ['/care', 'record'], ['/care', 'recordId']]) {
    const app = gateScenario(), first = app.render(path, { [name]: 'A' });
    const next = app.render(path, { [name]: 'B' });
    assert.notEqual(next.key, first.key); first.retry(); assert.deepEqual(app.retried, []);
    next.retry(); assert.equal(app.retried.length, 1);
  }
});

test('visible pending proposals share the existing owner read and skip later background refresh', () => {
  let reported, retry, pending, pendingRetries = 0, careRetries = 0, profileRetries = 0;
  const noop = () => {}, scopeKey = 'parent:B';
  const h = harness({
    './ProductionFirstScreenGate': { useProductionStartupReadiness: (state, action) => { reported = state; retry = action; }, useProductionVisibleSettingsSection: () => undefined },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => ({ scopeKey, model: { list: { state: 'ready', activeQuery: '', activeKind: 'all' } }, actions: { search: () => careRetries++ } }) },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ scopeKey, model: { current: {} }, actions: { refresh: () => profileRetries++ } }) },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../workspaces/MemoryReferenceWorkspace': { useMemoryReferenceWorkspace: () => null },
    './TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null, useProductionTaskKnowledgeSummary: () => null, useProductionTaskKnowledgeMemory: () => null },
    './PhotoInputDomains': { useProductionPhotoInputDomains: () => null },
    './usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
    './SettingsDomains': { useProductionContactDomain: () => ({ model: {}, actions: { refresh: noop } }), useProductionSettingsDomains: () => ({
      family: { actions: { refresh: noop } }, modelSettings: { model: {}, actions: { refresh: noop } },
      push: { model: {}, actions: { refresh: noop } }, telegram: { model: {}, actions: { refresh: noop } }, preferences: { refresh: noop },
    }) },
  });
  const { ProductionStartupReadiness } = h.load('src/production/ProductionStartupReadiness.tsx');
  const render = (state, hasSnapshot = false) => {
    pending = { state, hasSnapshot, entries: [], nextCursor: null };
    h.production({ scopeKey, chatState: {}, chatController: { reloadMessages: noop }, agentPending: pending, readAgentPending: () => pendingRetries++ });
    h.route('/care'); h.render(h.jsx(ProductionStartupReadiness)); return reported;
  };
  assert.equal(render('idle'), 'loading');
  assert.equal(render('loading'), 'loading');
  assert.equal(pendingRetries, 0, 'readiness must not initiate another owner read');
  assert.equal(render('failed'), 'error'); retry(['agentPending']);
  assert.equal(pendingRetries, 1); assert.equal(careRetries, 1); assert.equal(profileRetries, 1);
  assert.equal(render('ready', true), 'ready');
  assert.equal(render('loading', true), 'ready', 'later refresh must not hold an available initial page');
  assert.equal(render('failed', true), 'ready', 'later refresh failure retains the existing local notice');
  assert.equal(render('denied', true), 'error', 'loss of authority cannot reuse a snapshot');
});

test('the actual agent owner clears the first page on scope change and rejects its late result', async () => {
  const requests = [];
  const h = harness({
    '../../../src/client/product-agent-api.ts': { ProductAgentApiError: class extends Error {}, createProductAgentApi() { assert.fail('Use the synthetic API'); } },
    '../agent-view-model.ts': {}, './agent-projection.ts': {},
  });
  const { ProductAgentOwner } = h.load('src/production/ProductAgentOwner.ts');
  const owner = new ProductAgentOwner('/api', true, () => assert.fail('Unexpected access loss'), () => {}, () => ({
    getPendingProposals: child => new Promise(resolve => requests.push({ child, resolve })),
  }));
  owner.syncContext({ key: 'parent:A', userId: 'parent', childId: 'A' }, true);
  const oldRead = owner.readPending(); assert.equal(owner.getSnapshot().pending.state, 'loading');
  owner.syncContext({ key: 'parent:B', userId: 'parent', childId: 'B' }, true);
  assert.equal(owner.getSnapshot().pending.state, 'idle'); assert.equal(owner.getSnapshot().pending.hasSnapshot, undefined);
  requests[0].resolve({ proposals: [], nextCursor: null }); await oldRead;
  assert.equal(owner.getSnapshot().pending.state, 'idle', 'late A cannot satisfy B readiness');
  const currentRead = owner.readPending(); assert.equal(requests[1].child, 'B');
  requests[1].resolve({ proposals: [], nextCursor: null }); await currentRead;
  assert.equal(owner.getSnapshot().pending.state, 'ready'); assert.equal(owner.getSnapshot().pending.hasSnapshot, true);
});

function reporterScenario() {
  const scopeKey = 'parent:B', calls = [], action = name => (...args) => calls.push([name, ...args]);
  const care = { scopeKey, model: { access: 'editable', online: true, list: { state: 'ready', activeQuery: '', activeKind: 'all' }, detail: null }, actions: { search: action('care'), openRecord: action('careDetail') } };
  const tasks = { scopeKey, model: { access: 'editable', online: true, readState: 'ready', selected: null }, actions: { selectTask: action('taskDetail') }, recovery: { reloadCurrent: action('tasks') } };
  const settings = {
    family: { readState: 'ready', actions: { refresh: action('family') } }, modelSettings: { model: { busy: 'read' }, actions: { refresh: action('model') } },
    push: { model: { readState: 'loading' }, actions: { refresh: action('push') } }, telegram: { model: { readState: 'loading' }, actions: { refresh: action('telegram') } },
    preferences: { busy: true, refresh: action('preferences') },
  };
  let state, retry, activeSection = 'account';
  const h = harness({
    './ProductionFirstScreenGate': { useProductionStartupReadiness: (value, action) => { state = value; retry = action; }, useProductionVisibleSettingsSection: () => activeSection },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => care },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ scopeKey, model: { current: {} }, actions: { refresh: action('profile') } }) },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => tasks }, '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../workspaces/MemoryReferenceWorkspace': { useMemoryReferenceWorkspace: () => null },
    './TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null, useProductionTaskKnowledgeSummary: () => null, useProductionTaskKnowledgeMemory: () => null },
    './PhotoInputDomains': { useProductionPhotoInputDomains: () => null }, './usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
    './SettingsDomains': { useProductionContactDomain: () => ({ model: {}, actions: { refresh() {} } }), useProductionSettingsDomains: () => settings },
  });
  const { ProductionStartupReadiness } = h.load('src/production/ProductionStartupReadiness.tsx');
  h.production({ scopeKey, chatState: {}, chatController: { reloadMessages() {} }, agentPending: { state: 'ready', hasSnapshot: true }, readAgentPending: action('agentPending') });
  return { care, tasks, settings, calls, retry: () => retry(), render(path, params = {}, section = activeSection) {
    activeSection = section; h.route(path, params); h.render(h.jsx(ProductionStartupReadiness)); return state;
  } };
}

test('the real reporter waits for exact scoped details and retries the same normalized URL target', () => {
  const app = reporterScenario();
  app.tasks.model.detailRead = { id: 'target', state: 'loading' };
  assert.equal(app.render('/tasks', { taskId: ['target', 'ignored'] }), 'loading');
  app.tasks.model.detailRead.state = 'error'; assert.equal(app.render('/tasks', { taskId: ['target', 'ignored'] }), 'error');
  app.retry(); assert.deepEqual(app.calls, [['profile'], ['tasks'], ['taskDetail', 'target']]); app.calls.length = 0;
  app.tasks.model.selected = { id: 'target' }; assert.equal(app.render('/tasks', { taskId: 'target' }), 'ready');
  app.tasks.scopeKey = 'parent:A'; assert.equal(app.render('/tasks', { taskId: 'target' }), 'loading');
  app.care.model.detailRead = { id: 'fallback', state: 'loading' };
  assert.equal(app.render('/care', { recordId: ['ignored'], record: 'fallback' }), 'loading');
  app.care.model.detailRead.state = 'error'; assert.equal(app.render('/care', { recordId: ['ignored'], record: 'fallback' }), 'error');
  app.retry(); assert.deepEqual(app.calls, [['profile'], ['care', '', 'all'], ['agentPending'], ['careDetail', 'fallback']]);
  app.care.model.detail = { record: { id: 'fallback' } };
  assert.equal(app.render('/care', { recordId: ['ignored'], record: 'fallback' }), 'ready');
  assert.equal(app.render('/care', { recordId: 'different', record: 'fallback' }), 'loading');
});

test('the real reporter waits only for the active settings panel and retries its existing owners', () => {
  const app = reporterScenario(), query = { section: 'account' };
  assert.equal(app.render('/settings', query, 'model'), 'loading'); app.retry();
  assert.deepEqual(app.calls, [['profile'], ['model']]); app.calls.length = 0;
  assert.equal(app.render('/settings', query, 'notifications'), 'loading'); app.retry();
  assert.deepEqual(app.calls, [['profile'], ['push'], ['telegram']]); app.calls.length = 0;
  assert.equal(app.render('/settings', query, 'preferences'), 'loading'); app.retry();
  assert.deepEqual(app.calls, [['profile'], ['preferences']]);
  assert.equal(app.render('/settings', query, 'account'), 'ready', 'hidden pending panels cannot delay the visible account panel');
});
