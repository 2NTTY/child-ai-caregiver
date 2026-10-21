import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// True page components and the true navigation guard, with explicit synthetic data/host ports.
// Forms and run bodies are host markers here; their owner/contract tests run separately.
function ports(extra = {}) {
  const dialog = Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Content: 'Content', Actions: 'Actions' });
  const mocks = {
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'react-native-paper': { Text: 'Text', Portal: 'Portal' },
    'expo-router': { usePathname: () => '/care', useRouter: () => ({ push() {} }), useLocalSearchParams: () => ({}) },
    'expo-router/react-navigation': { useNavigation: () => ({dispatch() {}}), usePreventRemove() {} },
    '../theme': {spacing: {}, colors: {}, radius: {}, typeScale: {}},
    '../components/ui': { AppButton: 'Button', SectionCard: 'SectionCard', SectionHeader: 'SectionHeader' },
    '../ui': { AppButton: 'Button', SectionCard: 'SectionCard', SectionHeader: 'SectionHeader', OperationPill: 'OperationPill' },
    '../AppDialog': {AppDialog: dialog}, '../components/AppDialog': {AppDialog: dialog},
    '../AppScrollView': {AppScrollView: 'ScrollView'}, '../components/AppScrollView': {AppScrollView: 'ScrollView'},
    '../useContainerWidth': {useContainerWidth: () => ({width: 390, onLayout() {}})},
    './useContentListMotion': {useContentListMotion: () => false},
    './useContentDeletionFocus': {useContentDeletionFocus: () => ({rowRef() {}, start() {}, onClosed() {}})},
    '../../motion': {MotionList: 'MotionList'},
    './source-styles': {sourceStyles: {}},
    '../production/CareProfileDomains': {useProductionCareProfile: () => null},
    '../production/useDomainEnvironment': {}, '../workspaces/CareWorkspace': {useCareWorkspace: () => null},
    './photosScreen': {},
    ...extra,
  };
  for (const [prefix, names] of [['../', ['EmptyListCard','AppStatusBadge','AppCheckbox','ReadStateNotice','StatusAnnouncement','PageFrame']],
    ['./', ['SourceStatus','SourceComposer','SourceDetails','SourceRecordForm','SourceIntakeConversation']],
    ['../components/', ['EmptyListCard','ReadStateNotice','PageFrame']], ['../components/care/', ['CareRecordsView','CareSavedRecordsView']],
    ['../components/agent/', ['AgentRunView']]]) {
    for (const name of names) mocks[prefix + name] = {[name]: name, ...(name === 'SourceDetails' ? {sourceTime: x => x} : {})};
  }
  const h = harness(mocks); let id = 0;
  mocks.react = {...h.react, useId: () => h.react.useRef(`test-${++id}`).current};
  return {h, mocks};
}

test('fallback recreate opens the manual composer with its original seed; cancel and new input do not overwrite saved data', () => {
  const {h, mocks} = ports({'../../preview/PreviewNavigationGuard': {usePreviewNavigation: () => action => action()}});
  mocks['../FormDialog'] = {FormDialog: p => h.jsx('FormDialog', {...p, children: p.visible ? p.children : null}), ManualFormDialog: 'ManualFormDialog'};
  const {SourcesView} = h.load('src/components/shared-inputs/SourcesView.tsx');
  const saved = {id: 'source-a', text: 'Synthetic original', sourceLabel: 'Synthetic source', version: 1};
  let model = {scopeKey: 'child-a', childName: 'Synthetic child', accountName: 'Synthetic parent', selected: saved, items: [saved],
    operation: {state: 'none', phase: null}, access: 'editable', fresh: true, online: true, load: 'ready', canChoose: true, canCreate: true, formKey: 1};
  let recreated = 0, fresh = 0, discarded = 0;
  const actions = {recreateWithText() { recreated++; model = {...model, selected: null, composerSeed: saved}; },
    newInput() { fresh++; model = {...model, selected: null, composerSeed: null, formKey: model.formKey + 1}; },
    discardDraft(kind) {assert.equal(kind, 'composer'); discarded++; model = {...model, composerSeed: null};}};
  function Page() {return h.jsx(SourcesView, {model, actions});}
  const render = () => h.render(h.jsx(Page, {})), host = type => h.hosts().find(n => n.type === type);
  render(); assert.equal(host('SourceComposer'), undefined);
  host('SourceDetails').props.actions.recreateWithText(); render();
  assert.equal(recreated, 1); assert.equal(fresh, 0); assert.equal(host('FormDialog').props.visible, true);
  assert.equal(host('SourceComposer').props.model.composerSeed, saved);
  host('FormDialog').props.onClose(); render(); assert.equal(discarded, 1); assert.equal(host('SourceComposer'), undefined);
  h.hosts().find(n => n.type === 'Button' && n.props.label === '手動新增來源').props.onPress(); render();
  assert.equal(fresh, 1); assert.equal(host('SourceComposer').props.model.composerSeed, null);
  assert.deepEqual(model.items, [saved]); assert.equal(saved.text, 'Synthetic original');
});

function resultScenario() {
  const {h} = ports();
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  const {AgentPendingReview} = h.load('src/screens/careScreen.tsx');
  let reads = 0, selected = [], checks = 0;
  let model = {scopeKey: 'child-a', selectedChildId: 'child-a', online: true,
    agentPending: {state: 'ready', entries: [{runId: 'run-a', proposal: {id: 'proposal-a', title: 'Synthetic proposal', status: 'pending', scope: 'family'}}]},
    agentModel: {run: null, readState: 'ready', busy: null, pendingDecision: null}, agentActions: {checkOriginal() {checks++;}},
    readAgentPending() {reads++;}, selectAgentRun(id) {selected.push(id);}};
  let navigate;
  function Page() {navigate = guard.usePreviewNavigation(); return h.jsx(AgentPendingReview, {});}
  const tree = h.jsx(guard.PreviewNavigationGuard, {children: h.jsx(Page, {})});
  const render = () => {h.production(model); h.render(tree);};
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);
  const dialog = () => h.hosts().find(n => n.props.accessibilityLabel === '助手運行結果');
  render();
  return {h, render, button, dialog, navigate(action, intent) {navigate(action, intent); render();}, get model() {return model;}, patch(next) {model = {...model, ...next}; render();},
    open() {button('查看結果').props.onPress(); render();}, counts: () => ({reads, selected, checks})};
}
test('care run is absent until selected, then the unchanged run/actions render only inside the result dialog', () => {
  const s = resultScenario(); assert.equal(s.h.hosts().some(n => n.type === 'AgentRunView'), false); s.open();
  assert.equal(s.dialog().props.visible, true); assert.deepEqual(s.counts().selected, ['run-a']);
  const run = {id: 'run-a', childId: 'child-a', status: 'unknown', proposals: [{status: 'pending'}]};
  s.patch({agentModel: {...s.model.agentModel, run}});
  const body = s.h.hosts().find(n => n.type === 'AgentRunView');
  assert.equal(body.props.model.run, run); assert.equal(body.props.actions, s.model.agentActions);
  s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false);
  assert.equal(s.h.hosts().some(n => n.type === 'AgentRunView'), false); assert.equal(s.model.agentModel.run, run);
});
test('GET loading can close without a write warning, while an original pending decision keeps recovery reachable', () => {
  const s = resultScenario(); s.open(); s.patch({agentModel: {...s.model.agentModel, busy: 'read'}});
  s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false);
  s.patch({agentModel: {...s.model.agentModel, busy: null}}); s.open();
  s.patch({agentModel: {...s.model.agentModel, pendingDecision: {opId: 'original'}, run: {id: 'run-a', childId: 'child-a', status: 'unknown', proposals: []}}});
  s.dialog().props.onDismiss(); s.render(); assert.ok(s.button('留在此頁查核')); assert.equal(s.button('捨棄草稿並離開'), undefined);
  s.button('留在此頁查核').props.onPress(); s.render();
  s.h.hosts().find(n => n.type === 'AgentRunView').props.actions.checkOriginal(); assert.equal(s.counts().checks, 1);
  assert.equal(s.model.agentModel.pendingDecision.opId, 'original');
});
test('scope replacement hides old results immediately and rejects old close callbacks', () => {
  const s = resultScenario(); s.open(); const close = s.button('關閉結果').props.onPress;
  s.patch({scopeKey: 'child-b', selectedChildId: 'child-b'}); assert.equal(s.dialog().props.visible, false);
  close(); s.render(); assert.equal(s.dialog().props.visible, false); assert.equal(s.h.hosts().some(n => n.type === 'AgentRunView'), false);
  assert.equal(s.counts().reads, 2);
});


test('read-only result modal preserves pending decisions across workspace navigation but still guards a child change', () => {
  const s = resultScenario(); s.open();
  const pendingDecision = {opId: 'original', decision: 'accept'};
  s.patch({agentModel: {...s.model.agentModel, pendingDecision}});
  let navigated = 0; s.navigate(() => navigated++, 'workspace'); assert.equal(navigated, 1);
  assert.equal(s.button('留在此頁查核'), undefined); assert.equal(s.model.agentModel.pendingDecision, pendingDecision);
  s.navigate(() => navigated++, 'child'); assert.equal(navigated, 1); assert.ok(s.button('留在此頁查核'));
  assert.equal(s.button('捨棄草稿並離開'), undefined);
});
test('denied and idle selected runs never claim an active read or expose another run body', () => {
  const s = resultScenario(); s.open();
  const copy = () => s.h.hosts().filter(n => n.type === 'Text').map(n => n.props.children).flat().join(' ');
  s.patch({agentModel: {...s.model.agentModel, readState: 'denied'}});
  assert.match(copy(), /沒有權限查看所選結果/); assert.doesNotMatch(copy(), /正在核對所選原提案/);
  s.patch({agentModel: {...s.model.agentModel, readState: 'idle'}});
  assert.match(copy(), /所選結果尚未讀取/); assert.equal(s.h.hosts().some(n => n.type === 'AgentRunView'), false);
});

function syntheticIntakeScenario() {
  const {h, mocks} = ports({'../../preview/PreviewNavigationGuard': {usePreviewLeaveGuard() {}}});
  mocks['../ui'] = {...mocks['../ui'], AppSelect: 'Select', AppTextField: 'Field'};
  mocks['../FormDialog'] = {FormDialog: p => h.jsx('FormDialog', {...p, children: p.visible ? p.children : null})};
  const {SourceIntakeEditor} = h.load('src/components/shared-inputs/SourceIntakeEditor.tsx');
  const initial = {purpose: 'answer_reference', nature: 'unspecified', timeScope: 'unspecified', validityText: ''};
  let model = {scopeKey: 'child-a', selected: {id: 'source-a', canManage: true}, formKey: 1, fresh: true, access: 'editable',
    intake: {mode: 'synthetic', selected: {stage: 'review', proposalOrigin: 'assisted', proposal: initial}}}, checks = 0, confirmations = 0;
  const patch = update => {model = {...model, intake: {...model.intake, selected: {...model.intake.selected, ...update}}};};
  const actions = {intake: {editProposal(proposal) {patch({proposal});}, confirmProposal() {confirmations++; patch({stage: 'connection_unknown'});}, checkConnection() {checks++;}}};
  function Page() {return h.jsx(SourceIntakeEditor, {model, actions});}
  const render = () => h.render(h.jsx(Page, {})); const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);
  render(); return {h, initial, render, button, get model() {return model;}, counts: () => ({checks, confirmations}),
    modal: () => h.hosts().find(n => n.type === 'FormDialog')};
}
test('synthetic source manual editing is modal-only and approved close restores only the proposal editing basis', () => {
  const s = syntheticIntakeScenario(); assert.equal(s.h.hosts().some(n => n.type === 'Select'), false);
  s.button('修改整理建議').props.onPress(); s.render(); assert.equal(s.modal().props.visible, true);
  s.h.hosts().find(n => n.type === 'Select' && n.props.label === '建議用途').props.onChange('track_topic'); s.render();
  assert.equal(s.model.intake.selected.proposal.purpose, 'track_topic');
  s.modal().props.onClose(); s.render(); assert.equal(s.modal().props.visible, false);
  assert.equal(s.model.intake.selected.proposal, s.initial); assert.equal(s.model.selected.id, 'source-a');
  assert.equal(s.model.intake.selected.stage, 'review'); assert.equal(s.counts().confirmations, 0);
});
test('synthetic source unknown confirmation keeps its original lookup control inside the open editor', () => {
  const s = syntheticIntakeScenario(); s.button('修改整理建議').props.onPress(); s.render();
  s.button('確認這個用途（預覽）').props.onPress(); s.render();
  assert.equal(s.modal().props.visible, true); assert.equal(s.model.intake.selected.stage, 'connection_unknown');
  s.button('查核原次接入結果（預覽）').props.onPress(); assert.equal(s.counts().checks, 1); assert.equal(s.counts().confirmations, 1);
});
