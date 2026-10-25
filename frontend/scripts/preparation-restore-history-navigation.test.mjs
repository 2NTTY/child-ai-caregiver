import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

const childId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const archived = { id: documentId, childId, kind: 'preparation', purpose: 'appointment', version: 1, status: 'archived',
  archivedAt: '2026-10-07T00:00:00Z', current: { id: '10000000-0000-4000-8000-000000000002', version: 1,
    generatedAt: '2026-10-07T00:00:00Z', sourceBasis: 'synthetic', title: 'Synthetic archived preparation', summary: 'Synthetic',
    ageLabel: 'unknown', period: { from: '2026-10-01', to: '2026-10-07' }, eventDate: null, coverageNote: 'Synthetic',
    sections: [], sources: [], changes: [] }, history: [], readState: 'ready', autoRefresh: false };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Actual API classification/replay owner, Documents hook, domain lease, navigation
// guard, sidebar Link and History category callback. Host controls and HTTP are
// synthetic; this is not browser, real-service or React scheduler evidence.
function scenario(width = 1024) {
  let pathname = '/growth', params = {}, documents, navigate, writeStatus = 405, writeGate, nextId = 0;
  let local = { dirty: false, pending: false };
  const calls = [], jobs = [], leases = new Map();
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const owner = { setDomainPending(id, pending) { if (pending) leases.set(id, true); else leases.delete(id); },
    async fetcher(url, options) {
      const parsed = new URL(url, 'https://synthetic.test');
      if (options.method === 'GET') return response(parsed.pathname.endsWith('/documents')
        ? { page: { authorityVersion: 'synthetic-authority', canManage: true,
          items: parsed.searchParams.get('status') === 'active' ? [] : [archived], hasMore: false, nextCursor: null } }
        : { item: archived });
      calls.push({ url, body: JSON.parse(options.body) });
      if (writeGate) await writeGate.promise;
      if (writeStatus === 0) throw new Error('Synthetic lost response');
      return response({ error: { code: 'synthetic_read_only_preview' } }, writeStatus);
    } };
  const env = { owner, apiBaseUrl: '/api', userId: 'synthetic-parent', childId, childName: 'Synthetic', role: 'owner', online: true,
    scopeKey: 'synthetic-parent:child', current: () => true, canStartWrite: () => leases.size === 0, invalidate() {} };
  const runtime = { lost: false, live: () => true, accessError: () => false,
    read: (_key, action, signal) => action(signal),
    request(action) { const job = action(new AbortController().signal, () => true); jobs.push(job); return job; } };
  const router = { push(href) { pathname = typeof href === 'string' ? href : href.pathname; }, setParams(value) { params = { ...params, ...value }; } };
  const mocks = {
    '../theme': { colors: {}, spacing: {}, typeScale: { small: 14 }, readingType: { tool: {}, meta: {} } },
    'expo-router': { usePathname: () => pathname, useLocalSearchParams: () => params, useRouter: () => router, Link: 'Link' },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: value => value } },
    './ProductionProvider': { useProductionOwner: () => owner },
    './task-knowledge-runtime': { useTaskKnowledgeRuntime: () => runtime, useTaskKnowledgeRefresh() {} },
    '../platform/file-export': { exportBlob() { throw new Error('No export in this test'); } },
    '../components/AppDialog': { AppDialog: Object.assign('Dialog', { Title: 'Title', Content: 'Content', Actions: 'Actions' }) },
    '../components/appearance/BackgroundSurface': { BackgroundSurface: 'View' },
    '../components/DateTimeFields': { AppDateField: 'DateField' },
    '../components/FormDialog': { FormDialog: 'FormDialog' },
    '../components/PageFrame': { PageFrame: 'PageFrame' },
    '../components/workspace/Workspace': {Workspace: {Provider: 'WorkspaceProvider', Split: 'WorkspaceSplit', Main: 'WorkspaceMain', Aside: 'WorkspaceAside'}},
    '../components/history/HistoryCategoryNavigation': {HistoryCategoryNavigation: 'HistoryCategoryNavigation'},
    '../components/ui': { AppButton: 'Button', AppSelect: 'Select', AppTabPanel: 'TabPanel', AppTextField: 'TextField', UnderlineTabs: 'Tabs' },
    '../components/useContainerWidth': { useContainerWidth: () => ({ width }) },
    '../components/tasks/TaskHistoryView': { TaskHistoryView: 'TaskHistory' },
    '../components/care/CareReviewHistoryView': { CareReviewHistoryView: 'CareReviewHistory' },
    '../components/care/CareSavedRecordsView': { CareSavedRecordsView: 'CareSavedHistory' },
    '../components/preparations/PreparationWorkspace': { PreparationHistoryView: 'PreparationHistory' },
    '../components/profile/ProfileHistoryView': { ProfileHistoryView: 'ProfileHistory' },
    '../components/growth/GrowthHistoryView': { GrowthHistoryView: 'GrowthHistory' },
    '../components/history/PersonalHistoryViews': { PersonalConversationHistoryView: 'ConversationHistory', PersonalNotificationHistoryView: 'NotificationHistory' },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => ({ model: { access: 'editable', operation: { state: 'none' } }, actions: { closePanel() {} } }) },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => ({ model: { access: 'editable', list: { state: 'ready' }, operation: { state: 'none' }, review: { state: 'ready' } }, actions: { closePanel() {} } }) },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => documents.preparation },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => null },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../production/usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => h.react.useRef(`guard-${++nextId}`).current,
    useReducer(reducer, initial, init) { const [value, set] = h.react.useState(() => init ? init(initial) : initial); return [value, action => set(before => reducer(before, action))]; } };
  h.production({ scopeKey: env.scopeKey, model: { selectedChildId: childId, children: [{ id: childId }] }, actions: { prepareQuestion() {} } });
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const { useFamilyDocuments } = h.load('src/production/useFamilyDocuments.ts');
  const { default: HistoryScreen } = h.load('src/screens/historyScreen.tsx');
  function PersistentDocuments() { documents = useFamilyDocuments(env); return null; }
  function Page() {
    navigate = guard.usePreviewNavigation();
    guard.usePreviewLeaveGuard(local.dirty, local.pending);
    return [h.jsx(guard.PreviewLink, { href: '/history', children: 'History' }), pathname === '/history' ? h.jsx(HistoryScreen) : null];
  }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: [h.jsx(PersistentDocuments, {}, 'owner'), h.jsx(Page, {}, 'page')] });
  const render = () => h.render(tree);
  const picker = () => h.hosts().find(node => node.type === 'HistoryCategoryNavigation');
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const s = { calls, leases, render, button, picker, get documents() { return documents; }, get pathname() { return pathname; },
    async settle() { while (jobs.length) await jobs.shift(); render(); },
    async load() { render(); documents.refresh(); await this.settle(); documents.preparation.model.reading.ensureArchived(); await this.settle(); },
    restore() { documents.preparation.actions.restoreDocument(documentId, 1); render(); },
    status(value) { writeStatus = value; }, holdWrite() { return writeGate = deferred(); },
    history() { h.hosts().find(node => node.type === 'Link').props.onPress({ preventDefault() {} }); render(); },
    category(value) { picker().props.onChange(value); render(); },
    local(value) { local = value; render(); },
    request(intent) { let completed = false; navigate(() => { completed = true; }, intent); render(); return completed; },
  };
  render(); return s;
}

test('first restore 405 remains a rejection while History tabs remain read-only navigable', async () => {
  for (const width of [1024, 390]) {
    const s = scenario(width); await s.load(); s.restore(); await s.settle();
    assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.documents.operation.recovery, 'check');
    const original = structuredClone(s.documents.operation), body = structuredClone(s.calls[0].body);
    assert.equal(s.leases.size, 0); assert.equal(s.documents.preparation.model.dirty, false);
    s.history(); assert.equal(s.pathname, '/history'); assert.equal(s.picker().props.value, 'tasks');
    for (const category of ['preparations', 'review', 'conversations']) {
      s.category(category); assert.equal(s.picker().props.value, category);
      assert.equal(s.button('留在此頁'), undefined);
    }
    assert.deepEqual(s.documents.operation, original); assert.equal(s.calls.length, 1); assert.deepEqual(s.calls[0].body, body);
    s.restore(); assert.equal(s.calls.length, 1, 'Read navigation must not release the write lease or permit duplicate restore');
    assert.equal(s.request('child'), true, 'A known rejection without a draft does not trap a scope change');
    s.documents.recovery.checkOriginalOperation(); await s.settle();
    assert.equal(s.leases.size, 0); assert.equal(s.documents.operation.recovery, undefined);
    assert.equal(s.calls.length, 1, 'Explicit read settles the rejected attempt without replay');
  }
});

test('unknown restore followed by 405 retains the exact original and scope guards without trapping History', async () => {
  const s = scenario(); await s.load(); s.status(0); s.restore(); await s.settle();
  const body = structuredClone(s.calls[0].body);
  assert.equal(s.documents.operation.state, 'unknown');
  s.documents.recovery.checkOriginalOperation(); await s.settle();
  s.status(405); s.documents.recovery.retryOriginalOperation(); await s.settle();
  assert.equal(s.documents.operation.state, 'unknown'); assert.equal(s.documents.operation.reference, body.opId);
  s.history(); s.category('preparations'); assert.equal(s.picker().props.value, 'preparations');
  assert.equal(s.button('留在此頁'), undefined); s.restore();
  assert.equal(s.leases.size, 1); assert.deepEqual(s.calls.map(call => call.body), [body, body]);
  for (const intent of ['child', 'navigation']) {
    assert.equal(s.request(intent), false); assert.ok(s.button('留在此頁')); assert.equal(s.button('捨棄並離開'), undefined);
    s.button('留在此頁').props.onPress(); s.render();
  }
  assert.equal(s.documents.operation.state, 'unknown'); assert.equal(s.documents.operation.reference, body.opId);
});

test('retained in-flight restore survives read navigation and still cannot be submitted twice', async () => {
  const s = scenario(); await s.load(); const gate = s.holdWrite(); s.restore();
  const original = structuredClone(s.calls[0].body);
  assert.equal(s.documents.operation.state, 'saving'); s.history(); s.category('care');
  assert.equal(s.picker().props.value, 'care'); s.restore(); assert.equal(s.calls.length, 1); assert.equal(s.leases.size, 1);
  assert.equal(s.request('child'), false); s.button('留在此頁').props.onPress(); s.render();
  gate.resolve(); await s.settle();
  assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.documents.operation.reference, original.opId);
  assert.deepEqual(s.calls.map(call => call.body), [original]);
});

test('History workspace navigation still protects local dirty drafts and non-retained in-flight writes', async () => {
  const s = scenario(); await s.load(); s.history(); s.local({ dirty: true, pending: false }); s.category('preparations');
  assert.equal(s.picker().props.value, 'tasks'); assert.ok(s.button('捨棄並離開'));
  s.button('繼續編輯').props.onPress(); s.render(); assert.equal(s.picker().props.value, 'tasks');
  s.local({ dirty: true, pending: true }); s.category('preparations');
  assert.equal(s.picker().props.value, 'tasks'); assert.ok(s.button('留在此頁')); assert.equal(s.button('捨棄並離開'), undefined);
  assert.equal(s.calls.length, 0);
});
