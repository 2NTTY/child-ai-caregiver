import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual HistoryScreen, AppTabPanel and private history consumers. Native/layout,
// motion and dialog are ports; this verifies identity/effects, not browser pixels.
function setup(category, initialWidth = 1440) {
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
    '../components/DateTimeFields': {AppDateField: 'AppDateField'}, '../components/PageFrame': {PageFrame: 'PageFrame'},
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
  const h = harness(mocks);
  h.react.useReducer = (reducer, arg, init) => { const [state, setState] = h.react.useState(() => init ? init(arg) : arg); return [state, action => setState(current => reducer(current, action))]; };
  const {AppTabPanel} = h.load('src/components/ui.tsx');
  mocks['../components/ui'] = {AppButton: 'Button', AppSelect: 'AppSelect', AppTextField: 'AppTextField', UnderlineTabs: 'UnderlineTabs', AppTabPanel};
  const syncProduction = () => h.production({model: {children: [{id: 'child-a'}], selectedChildId: 'child-a'}, actions: {}, scopeKey: owner.scopeKey});
  syncProduction();
  const {default: HistoryScreen} = h.load('src/screens/historyScreen.tsx');
  return {...h, calls, AppTabPanel, renderScreen() { h.render(h.jsx(HistoryScreen, {})); },
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
