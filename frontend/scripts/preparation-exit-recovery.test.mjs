import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

const childId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const archived = { id: documentId, childId, kind: 'preparation', purpose: 'appointment', version: 1, status: 'active',
  archivedAt: null, current: { id: '10000000-0000-4000-8000-000000000002', version: 1,
    generatedAt: '2026-10-07T00:00:00Z', sourceBasis: 'synthetic', title: 'Synthetic archived preparation', summary: 'Synthetic',
    ageLabel: 'unknown', period: { from: '2026-10-01', to: '2026-10-07' }, eventDate: null, coverageNote: 'Synthetic',
    sections: [{ id: 'checks', title: 'Synthetic checklist', kind: 'checklist', domain: null, items: [{ id: 'water', text: 'Synthetic water', checked: false, sourceIds: [] }] }], sources: [], changes: [] }, history: [], readState: 'ready', autoRefresh: false };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Actual API classification/replay owner, Documents hook, domain lease, navigation
// guard, sidebar Link and History category callback. Host controls and HTTP are
// synthetic; this is not browser, real-service or React scheduler evidence.
function scenario(width = 1024) {
  let pathname = '/growth', params = { tab: 'preparation' }, documents, navigate, writeStatus = 405, writeGate, nextId = 0;
  let local = { dirty: false, pending: false }, formVisible = false, readStatus = 200, readGate;
  const calls = [], jobs = [], leases = new Map();
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const owner = { setDomainPending(id, pending) { if (pending) leases.set(id, true); else leases.delete(id); },
    async fetcher(url, options) {
      const parsed = new URL(url, 'https://synthetic.test');
      if (options.method === 'GET' && readGate) await readGate.promise;
      if (options.method === 'GET' && readStatus !== 200) return response({}, readStatus);
      if (options.method === 'GET') return response(parsed.pathname.endsWith('/documents')
        ? { page: { authorityVersion: 'synthetic-authority', canManage: true,
          items: parsed.searchParams.get('status') === 'active' ? [archived] : [], hasMore: false, nextCursor: null } }
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
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => ({ scopeKey: env.scopeKey, model: {}, actions: {} }) },
    '../production/TaskKnowledgeGrowthCandidates': { TaskKnowledgeGrowthCandidates: 'Candidates', GrowthSuggestionSettings: 'Settings' },
    '../components/growth/GrowthView': { GrowthView: 'GrowthView' },
    '../DateTimeFields': { AppDateField: 'DateField' }, '../AppCheckbox': { AppCheckbox: 'Checkbox' },
    '../FormErrorSummary': { FormErrorSummary: 'ErrorSummary', FormFieldMessage: 'FieldMessage' },
    '../ui': { AppButton: 'Button', AppSelect: 'Select', AppTextField: 'TextField' },
    '../../theme': { colors: {}, spacing: {}, readingType: {}, typeScale: {} },
    '../production/usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
  };
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => h.react.useRef(`guard-${++nextId}`).current,
    useReducer(reducer, initial, init) { const [value, set] = h.react.useState(() => init ? init(initial) : initial); return [value, action => set(before => reducer(before, action))]; } };
  mocks['react-hook-form'] = {
    useForm: ({ defaultValues }) => {
      const state = h.react.useRef({ ...defaultValues });
      return { control: state, reset: h.react.useCallback(values => { state.current = { ...values }; }, []),
        watch: name => state.current[name], setError() {}, setFocus() {}, formState: { errors: {} }, handleSubmit: callback => () => callback(state.current) };
    },
    Controller: ({ name, control, render }) => render({ field: { value: control.current[name], onChange: value => { control.current[name] = value; }, onBlur() {}, ref: null } }),
  };
  h.production({ scopeKey: env.scopeKey, model: { selectedChildId: childId, children: [{ id: childId }] }, actions: { prepareQuestion() {} } });
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const { useFamilyDocuments } = h.load('src/production/useFamilyDocuments.ts');
  const { DocumentCreateForm } = h.load('src/components/preparations/DocumentCreateForm.tsx');
  mocks['./OperationNotice'] = { OperationNotice: 'OperationNotice' };
  const { WriteRecoveryNotice } = h.load('src/components/WriteRecoveryNotice.tsx');
  const { GrowthScreen } = h.load('src/screens/GrowthScreen.tsx');
  const { default: HistoryScreen } = h.load('src/screens/historyScreen.tsx');
  function PersistentDocuments() { documents = useFamilyDocuments(env); return null; }
  function Page() {
    navigate = guard.usePreviewNavigation();
    guard.usePreviewLeaveGuard(local.dirty, local.pending);
    return [h.jsx(guard.PreviewLink, { href: '/history', children: 'History' }), pathname === '/history' ? h.jsx(HistoryScreen) : h.jsx(GrowthScreen),
      h.jsx(WriteRecoveryNotice, { operation: documents.operation, recovery: documents.recovery, plainLanguage: true, showReference: false }),
      formVisible && pathname === '/growth' && params.tab === 'preparation' ? h.jsx(DocumentCreateForm, { owner: documents, kind: 'preparation' }, 'form') : null];
  }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: [h.jsx(PersistentDocuments, {}, 'owner'), h.jsx(Page, {}, 'page')] });
  const render = () => h.render(tree);
  const picker = () => h.hosts().find(node => node.type === (width < 680 ? 'Select' : 'Tabs'));
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const s = { calls, leases, render, button, picker, get documents() { return documents; }, get pathname() { return pathname; },
    async settle() { while (jobs.length) await jobs.shift(); render(); },
    async load() { render(); documents.refresh(); await this.settle(); documents.preparation.model.reading.ensureArchived(); await this.settle(); },
    restore() { documents.preparation.actions.checkItem(documentId, 1, 'checks', 'water', true); render(); },
    tab(value) { h.hosts().find(node => node.type === 'GrowthView').props.onTabChange(value); render(); },
    get tabValue() { return h.hosts().find(node => node.type === 'GrowthView')?.props.tab; },
    select() { documents.preparation.actions.selectDocument(documentId); render(); },
    close() { documents.preparation.actions.closeDocument(); render(); },
    status(value) { writeStatus = value; }, readStatus(value) { readStatus = value; }, holdRead() { return readGate = deferred(); },
    form() { formVisible = true; render(); },
    edit() { h.hosts().find(node => node.type === 'TextField').props.onChangeText('Synthetic draft'); render(); },
    create() { const formId = h.hosts().find(node => node.type === 'TextField').props.nativeID.replace(/-title$/, '');
      documents.createDocument({ kind: 'preparation', purpose: 'outing', title: 'Synthetic draft', eventDate: null, period: { from: '2026-10-01', to: '2026-10-07' } }, formId); render(); },
    get titleField() { return h.hosts().find(node => node.type === 'TextField'); },
    get notice() { return h.hosts().find(node => node.type === 'OperationNotice'); }, get nodes() { return h.hosts(); }, holdWrite() { return writeGate = deferred(); },
    history() { h.hosts().find(node => node.type === 'Link').props.onPress({ preventDefault() {} }); render(); },
    category(value) { picker().props.onChange(value); render(); },
    local(value) { local = value; render(); },
    request(intent) { let completed = false; navigate(() => { completed = true; }, intent); render(); return completed; },
  };
  render(); return s;
}



// Actual document owner/API/guard/form/Growth callback; hooks/RHF hosts and transport are synthetic.
// No browser/native-device/React scheduler or real-service acceptance is claimed.
test('known rejected checklist without a draft allows tabs, list, sidebar and child exit without resending', async () => {
  const s = scenario(); await s.load(); s.select(); assert.ok(s.documents.notice);
  s.restore(); await s.settle();
  assert.equal(s.documents.dirty, false); assert.equal(s.leases.size, 0);
  assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.documents.notice, '');
  assert.equal(s.documents.operation.message, '未能儲存，請重新載入。');
  assert.equal(s.notice.props.referenceLabel, undefined); assert.ok(s.documents.operation.reference);
  assert.ok(s.button('重新載入')); s.close(); assert.equal(s.documents.preparation.model.selected, null);
  s.tab('concerns'); assert.equal(s.tabValue, 'concerns'); assert.equal(s.button('留在此頁'), undefined);
  assert.equal(s.request('child'), true); s.history(); assert.equal(s.pathname, '/history');
  s.documents.recovery.reloadCurrent(); await s.settle();
  assert.equal(s.documents.operation.reference, null); assert.equal(s.calls.length, 1);
});

for (const target of ['tab', 'sidebar']) test(`rejected real form draft offers stay/discard and then executes the requested ${target}`, async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); s.create(); await s.settle();
  assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.documents.dirty, true);
  assert.equal(s.documents.retainedDraftId, null); assert.equal(s.documents.operation.message, '未能儲存，草稿已保留。');
  assert.equal(s.button('放棄未提交草稿').props.disabled, false);
  const navigate = () => target === 'tab' ? s.tab('concerns') : s.history();
  navigate(); assert.ok(s.button('捨棄並離開')); s.button('繼續編輯').props.onPress(); s.render();
  assert.equal(s.pathname, '/growth'); assert.equal(s.tabValue, 'preparation'); assert.equal(s.documents.dirty, true);
  assert.equal(s.titleField.props.disabled, false, 'Continuing must allow actual editing');
  s.titleField.props.onChangeText('Edited after rejection'); s.render(); assert.equal(s.titleField.props.value, 'Edited after rejection');
  const epoch = s.documents.epoch;
  navigate(); s.button('捨棄並離開').props.onPress(); s.render();
  assert.equal(target === 'tab' ? s.tabValue : s.pathname, target === 'tab' ? 'concerns' : '/history');
  assert.equal(s.documents.dirty, false); assert.equal(s.documents.operation.state, 'none');
  assert.equal(s.documents.operation.reference, null); assert.equal(s.documents.epoch, epoch + 1);
  assert.equal(s.leases.size, 0); assert.equal(s.calls.length, 1);
});

test('failed reload does not turn a known rejection into unknown or remove the discard action', async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); s.create(); await s.settle();
  s.readStatus(503); s.documents.recovery.reloadCurrent(); await s.settle();
  assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.leases.size, 0);
  s.tab('concerns'); assert.ok(s.button('捨棄並離開')); s.button('捨棄並離開').props.onPress(); s.render();
  assert.equal(s.tabValue, 'concerns'); assert.equal(s.documents.dirty, false); assert.equal(s.calls.length, 1);
});

test('discard during a rejected request reload cannot resurrect that request when GET completes', async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); s.create(); await s.settle();
  const gate = s.holdRead(); s.documents.recovery.reloadCurrent(); s.render();
  s.button('放棄未提交草稿').props.onPress(); s.render();
  assert.equal(s.documents.operation.state, 'none'); assert.equal(s.documents.dirty, false);
  gate.resolve(); await s.settle();
  assert.equal(s.documents.operation.state, 'none'); assert.equal(s.documents.operation.reference, null);
  assert.equal(s.leases.size, 0); assert.equal(s.calls.length, 1);
});

test('unknown create retains exact request across workspace exit, later 405 and rejected discard attempts', async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); s.status(0); s.create(); await s.settle();
  const original = structuredClone(s.calls[0].body), epoch = s.documents.epoch;
  assert.equal(s.documents.operation.state, 'unknown'); assert.ok(s.documents.retainedDraftId);
  s.documents.discardDraft(); s.render(); assert.equal(s.documents.dirty, true); assert.equal(s.documents.epoch, epoch);
  assert.equal(s.request('child'), false); assert.equal(s.button('捨棄並離開'), undefined);
  assert.ok(s.nodes.some(node => node.props.children === '儲存結果未確認'));
  s.button('留在此頁').props.onPress(); s.render();
  s.tab('concerns'); assert.equal(s.tabValue, 'concerns'); assert.equal(s.leases.size, 1);
  assert.equal(s.documents.operation.reference, original.opId);
  s.documents.recovery.checkOriginalOperation(); await s.settle(); s.status(405);
  s.documents.recovery.retryOriginalOperation(); await s.settle();
  assert.equal(s.documents.operation.state, 'unknown'); assert.equal(s.documents.operation.reference, original.opId);
  assert.deepEqual(s.calls.map(call => call.body), [original, original]);
});

test('in-flight create has saving copy, remains retained and cannot be discarded or posted twice', async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); const gate = s.holdWrite(); s.create();
  const original = structuredClone(s.calls[0].body);
  assert.equal(s.documents.operation.state, 'saving'); assert.equal(s.request('child'), false);
  assert.ok(s.nodes.some(node => node.props.children === '正在儲存')); assert.equal(s.button('捨棄並離開'), undefined);
  s.button('留在此頁').props.onPress(); s.render(); s.documents.discardDraft(); s.render();
  assert.equal(s.documents.dirty, true); s.tab('concerns'); assert.equal(s.tabValue, 'concerns');
  assert.equal(s.calls.length, 1); gate.resolve(); await s.settle();
  assert.equal(s.documents.operation.state, 'failed'); assert.equal(s.documents.operation.reference, original.opId);
  assert.equal(s.leases.size, 0);
});


test('submitted draft restores every field after late rejection and remount, survives reload, and edits independently of frozen payload', async () => {
  const s = scenario(); await s.load(); s.form(); s.edit(); const gate = s.holdWrite(); s.create();
  const original = structuredClone(s.calls[0].body), retained = structuredClone(s.documents.createDraft);
  s.tab('concerns'); assert.equal(s.titleField, undefined); gate.resolve(); await s.settle();
  s.tab('preparation'); assert.equal(s.titleField.props.value, 'Synthetic draft');
  assert.equal(s.titleField.props.disabled, false); assert.equal(s.documents.createDraft.authorityVersion, retained.authorityVersion);
  assert.equal(s.nodes.find(node => node.type === 'Select' && node.props.label === '用途').props.value, 'outing');
  assert.equal(s.nodes.find(node => node.type === 'DateField' && node.props.label === '來源期間開始日').props.value, '2026-10-01');
  assert.equal(s.nodes.find(node => node.type === 'DateField' && node.props.label === '來源期間結束日').props.value, '2026-10-07');
  s.titleField.props.onChangeText('Edited after return'); s.render();
  assert.deepEqual(s.calls[0].body, original); assert.equal(s.documents.createDraft.request.title, 'Synthetic draft');
  s.documents.recovery.reloadCurrent(); await s.settle();
  assert.equal(s.titleField.props.value, 'Edited after return'); assert.equal(s.titleField.props.disabled, false);
  assert.equal(s.documents.createDraft.request.title, 'Synthetic draft'); assert.equal(s.documents.operation.reference, null);
  s.tab('concerns'); s.button('捨棄並離開').props.onPress(); s.render();
  assert.equal(s.documents.createDraft, null); assert.equal(s.documents.dirty, false); assert.equal(s.calls.length, 1);
});
