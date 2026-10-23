import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual HistoryScreen, AppTabPanel and private history consumers. Native/layout,
// motion and dialog are ports; this verifies identity/effects, not browser pixels.
function setup(category, initialWidth = 1440, retainedState) {
  let width = initialWidth;
  const noop = () => {}, calls = {read: 0, close: 0, search: 0, notifications: 0};
  let owner = {scopeKey: 'parent:child-a', access: 'editable', online: true, busy: {history: false, notifications: false, message: false},
    history: {state: 'ready', data: {query: '', matches: [{id: 'message-a', role: 'assistant', excerpt: 'Synthetic excerpt', createdAt: '2026-10-20T00:00:00Z'}], complete: true, nextCursor: null, scanned: 1}},
    message: {scopeKey: 'parent:child-a', state: 'ready', data: null},
    notifications: {state: 'ready', data: {items: [{id: 'notice-a', sentAt: '2026-10-20T00:00:00Z', scope: {kind: 'account'}, contents: [{channel: 'web_push', title: 'Synthetic original', body: 'Original body unchanged', sentAt: '2026-10-20T00:00:00Z', contentVersion: 'a'.repeat(64)}]}], complete: true, nextCursor: null}},
    actions: {
      readMessage(id) { calls.read++; owner.message = {scopeKey: owner.scopeKey, state: 'ready', data: {id, content: 'Original conversation body', contentVersion: 'a'.repeat(64)}}; },
      closeMessage() { calls.close++; owner.message = {...owner.message, data: null}; },
      searchHistory() { calls.search++; }, loadNotifications() { calls.notifications++; },
    },
  };
  const theme = {colors: {}, spacing: {}, readingType: {}, typeScale: {}, radius: {}, mobileIcons: {}, mobileLayout: {}, mobileType: {}, workspaceType: {}};
  const mocks = {
    '../theme': theme, '../../theme': theme,
    'expo-router': {usePathname: () => '/history', useLocalSearchParams: () => ({category}), useRouter: () => ({setParams: noop, push: noop})},
    '../preview/PreviewNavigationGuard': {usePreviewNavigation: () => callback => callback()},
    '../components/appearance/BackgroundSurface': {BackgroundSurface: 'BackgroundSurface'}, '../appearance/BackgroundSurface': {BackgroundSurface: 'BackgroundSurface'},
    '../components/FormDialog': {FormDialog: 'FormDialog'}, '../components/DateTimeFields': {AppDateField: 'AppDateField'}, '../components/PageFrame': {PageFrame: 'PageFrame'},
    '../components/useContainerWidth': {useContainerWidth: () => ({width, ref: null, onLayout: noop})},
    '../production/usePersonalHistory': {usePersonalHistoryWorkspace: () => owner}, '../../production/usePersonalHistory': {usePersonalHistoryWorkspace: () => owner},
    '../FormDialog': {FormDialog: 'FormDialog'}, '../EmptyListCard': {EmptyListCard: 'EmptyListCard'}, '../ReadStateNotice': {ReadStateNotice: 'ReadStateNotice'},
    '../../production/VoiceMessage': {VoiceMessage: 'VoiceMessage'}, './HistoryMessageDetail': {HistoryMessageDetail: 'HistoryMessageDetail'},
    './HistoryCards': {HistoryCardGrid: 'HistoryCardGrid', HistoryEntryCard: 'HistoryEntryCard'},
    './useInteractionDensity': {useInteractionDensity: () => false}, '../motion': {MotionEntrance: 'MotionEntrance'},
    '../motion/MotionSelectionMarker': {MotionSelectionMarker: 'MotionSelectionMarker'},
  };
  for (const [path, name] of [['tasks/TaskHistoryView', 'TaskHistoryView'], ['care/CareReviewHistoryView', 'CareReviewHistoryView'], ['care/CareSavedRecordsView', 'CareSavedRecordsView'], ['preparations/PreparationWorkspace', 'PreparationHistoryView'], ['profile/ProfileHistoryView', 'ProfileHistoryView'], ['growth/GrowthHistoryView', 'GrowthHistoryView']]) mocks[`../components/${path}`] = {[name]: name};
  for (const name of ['Profile', 'Tasks', 'Care', 'Preparation', 'Growth']) mocks[`../workspaces/${name}Workspace`] = {[`use${name}Workspace`]: () => null};
  for (const [path, name] of [['AppScrollView', 'AppScrollView'], ['AppIcon', 'AppIcon'], ['AppRadioItem', 'AppRadioItem'], ['AppDialog', 'AppDialog'], ['HorizontalOverflowRail', 'HorizontalOverflowRail'], ['appearance/BackgroundSurface', 'BackgroundSurface'], ['AppStatusBadge', 'AppStatusBadge']]) mocks[`./${path}`] = {[name]: name};
  let navigation = 0;
  if (retainedState) {
    delete mocks['../components/FormDialog'];
    delete mocks['../preview/PreviewNavigationGuard'];
    const Dialog = Object.assign('Dialog', {Title: 'Title', Content: 'Content', Actions: 'Actions', ScrollArea: 'ScrollArea'});
    mocks['./AppDialog'] = mocks['../components/AppDialog'] = {AppDialog: Dialog};
    mocks['./AppScrollView'] = {AppScrollView: 'ScrollView'};
    mocks['react-native'] = {View: 'View', Platform: {OS: 'android'}, StyleSheet: {create: value => value}};
    mocks['expo-router/react-navigation'] = {useNavigation: () => ({}), usePreventRemove: noop};
  }
  const h = harness(mocks);
  let id = 0;
  if (retainedState) { h.react.useId = () => h.react.useRef(`guard-${++id}`).current; mocks.react = h.react; }
  h.react.useReducer = (reducer, arg, init) => { const [state, setState] = h.react.useState(() => init ? init(arg) : arg); return [state, action => setState(current => reducer(current, action))]; };
  const {AppTabPanel} = h.load('src/components/ui.tsx');
  mocks['../components/ui'] = {AppButton: 'Button', AppSelect: 'AppSelect', AppTextField: 'AppTextField', UnderlineTabs: 'UnderlineTabs', AppTabPanel};
  const syncProduction = () => h.production({model: {children: [{id: 'child-a'}], selectedChildId: 'child-a'}, actions: {}, scopeKey: owner.scopeKey});
  syncProduction();
  const {default: HistoryScreen} = h.load('src/screens/historyScreen.tsx');
  const guard = retainedState ? h.load('src/preview/PreviewNavigationGuard.tsx') : null;
  function RetainedOwner() {
    guard.usePreviewLeaveGuard(retainedState.dirty, retainedState.pending, 'child', undefined, true);
    const leave = guard.usePreviewNavigation();
    return h.jsx('Button', {label: 'Synthetic navigation', onPress: () => leave(() => { navigation++; })});
  }
  return {...h, calls, AppTabPanel, navigation: () => navigation, renderScreen() {
    h.render(guard ? h.jsx(guard.PreviewNavigationGuard, {children: [h.jsx(RetainedOwner, {}, 'retained-owner'), h.jsx(HistoryScreen, {}, 'history')]}) : h.jsx(HistoryScreen, {}));
  },
    width(value) { width = value; h.render(); },
    scope(value) { owner = {...owner, scopeKey: value, message: {scopeKey: value, state: 'ready', data: null}}; syncProduction(); h.render(); },
    owner: () => owner,
  };
}

for (const category of ['notifications', 'conversations']) test(`${category} reader survives both responsive directions without closing or re-reading; scope/filter still clear selection`, () => {
  for (const initialWidth of [1440, 390]) {
    const h = setup(category, initialWidth);
    const dialog = () => h.hosts().find(node => node.type === 'FormDialog');
    const panel = () => h.hosts().find(node => node.type === 'MotionEntrance');
    const card = () => h.node(category === 'notifications' ? 'personal-notification-entry' : 'history-message-message-a');
    h.renderScreen(); card().props.onPress(); h.render(); assert.equal(dialog().props.visible, true);
    const openedRead = h.owner().message.data;
    for (const width of [1440, 1024, 390, 320, 390, 1024, 1440]) {
      h.width(width); h.tick();
      assert.equal(dialog().props.visible, true, `Reader remains open at ${width}`);
      assert.equal(h.owner().message.data, openedRead, 'Width-only change does not clear or substitute the selected original');
      assert.deepEqual(h.calls, {read: category === 'conversations' ? 1 : 0, close: 0, search: 0, notifications: 0});
      assert.equal(panel().props.nativeID, `history-categories-panel-${category}`);
      assert.equal(panel().props.role, width < 680 ? undefined : 'tabpanel');
      assert.equal(panel().props['aria-labelledby'], width < 680 ? undefined : `history-categories-tab-${category}`);
      assert.equal(panel().props.tabIndex, width < 680 ? undefined : 0);
      assert.equal(h.hosts().some(node => node.type === 'UnderlineTabs'), width >= 680);
      assert.equal(h.hosts().some(node => node.type === 'AppSelect'), width < 680);
    }
    const search = () => h.hosts().find(node => node.type === 'AppTextField');
    search().props.onChangeText('no-match'); h.render(); assert.equal(dialog().props.visible, false, 'Changing filters still dismisses the original');
    search().props.onChangeText(''); h.render(); assert.equal(dialog().props.visible, false, 'Clearing filters does not resurrect a dismissed reader');
    card().props.onPress(); h.render(); assert.equal(dialog().props.visible, true);
    h.scope('other-parent:child-a'); assert.equal(dialog().props.visible, false);
    h.scope('parent:child-a'); assert.equal(dialog().props.visible, false, 'Returning to a prior scope does not reopen private content');
  }
});

test('AppTabPanel retains its default tab semantics and inactive protection for other callers', () => {
  const h = setup('notifications');
  const props = {tabsId: 'original-tabs', tabKey: 'one', active: true, children: h.jsx('Content', {})};
  h.render(h.jsx(h.AppTabPanel, props)); let panel = h.hosts().find(node => node.type === 'MotionEntrance');
  assert.equal(panel.props.role, 'tabpanel'); assert.equal(panel.props['aria-labelledby'], 'original-tabs-tab-one'); assert.equal(panel.props.tabIndex, 0); assert.equal(panel.props.ref.current.inert, false);
  h.render(h.jsx(h.AppTabPanel, {...props, active: false})); panel = h.hosts().find(node => node.type === 'MotionEntrance');
  assert.equal(panel.props.role, 'tabpanel'); assert.equal(panel.props['aria-hidden'], true); assert.equal(panel.props.tabIndex, -1); assert.equal(panel.props.pointerEvents, 'none'); assert.equal(panel.props.ref.current.inert, true);
});

test('date filter drafts survive responsive changes but are discarded on scope changes without reads', () => {
  const h = setup('notifications', 390);
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const dateDialog = () => h.hosts().find(node => node.type === 'FormDialog' && node.props.title === '日期篩選');
  const field = label => h.hosts().find(node => node.type === 'AppDateField' && node.props.label === label);
  h.renderScreen(); button('日期篩選').props.onPress(); h.render();
  field('開始日期（可不填）').props.onChange('2026-10-01'); h.render();
  for (const width of [320, 1024, 1440, 390]) {
    h.width(width);
    assert.equal(dateDialog().props.visible, true);
    assert.equal(field('開始日期（可不填）').props.value, '2026-10-01');
    assert.equal(h.hosts().some(node => node.props.testID === 'history-applied-dates'), false);
  }
  assert.deepEqual(h.calls, {read: 0, close: 0, search: 0, notifications: 0});
  h.scope('other-parent:child-a');
  assert.equal(dateDialog().props.visible, false);
  h.scope('parent:child-a'); button('日期篩選').props.onPress(); h.render();
  assert.equal(field('開始日期（可不填）').props.value, '');
  dateDialog().props.onClose(); h.render();
  assert.equal(dateDialog().props.visible, false);
});


for (const state of ['clean', 'dirty', 'pending', 'unknown']) test(`actual filter dialog dismisses locally with a ${state} retained owner; navigation remains guarded`, () => {
  for (const action of ['close', 'escape', 'apply']) {
    const retained = {dirty: state === 'dirty', pending: state === 'pending' || state === 'unknown', operation: state, draft: 'Synthetic retained draft'};
    const before = {...retained}, h = setup('notifications', 390, retained);
    const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
    const modal = () => h.node('manual-form-dialog');
    const field = label => h.hosts().find(node => node.type === 'AppDateField' && node.props.label === label);
    h.renderScreen(); button('日期篩選').props.onPress(); h.render();
    field('開始日期（可不填）').props.onChange('2026-10-01'); h.render();
    if (action === 'close') button('關閉').props.onPress();
    else if (action === 'escape') modal().props.onDismiss(); // RN Modal's Escape/backdrop port.
    else button('套用日期').props.onPress();
    h.render();
    assert.equal(modal().props.visible, false, `${state}/${action} closes the disposable filter`);
    assert.equal(h.node('leave-preview-dialog'), undefined);
    assert.deepEqual(retained, before, 'Unrelated drafts and original operations remain untouched');
    assert.equal(!!h.node('history-applied-dates'), action === 'apply');
    button(action === 'apply' ? '日期已篩選' : '日期篩選').props.onPress(); h.render();
    assert.equal(field('開始日期（可不填）').props.value, action === 'apply' ? '2026-10-01' : '');
    button('關閉').props.onPress(); h.render();
    button('Synthetic navigation').props.onPress(); h.render();
    assert.equal(h.navigation(), state === 'clean' ? 1 : 0);
    assert.equal(!!h.node('leave-preview-dialog'), state !== 'clean');
    assert.equal(!!button('捨棄並離開'), state === 'dirty');
    assert.equal(!!button('留在此頁'), state === 'pending' || state === 'unknown');
    assert.deepEqual(retained, before);
  }
});
