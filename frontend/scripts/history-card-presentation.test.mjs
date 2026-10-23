import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';
import { createTaskFixture, taskPreviewClock } from '../src/preview/task-fixture.ts';

// Actual presentation and scope effects; native hosts/dialog/focus are ports.
// Grid percentages are structural evidence, not browser pixel/keyboard coverage.
function setup() {
  let width = 1100;
  const mocks = {
    'react-native': {View: 'View', Pressable: 'Pressable', StyleSheet: {create: value => value}},
    '../../theme': {colors: {line: '#ccc', ink: '#222'}, radius: {medium: 12}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}, readingType: {}},
    '../useContainerWidth': {useContainerWidth: () => ({width, ref: null, onLayout() {}})},
    '../EmptyListCard': {EmptyListCard: 'EmptyListCard'}, '../ReadStateNotice': {ReadStateNotice: 'ReadStateNotice'},
    '../appearance/BackgroundSurface': {BackgroundSurface: 'BackgroundSurface'},
    './ProfileSummary': {ProfileRevisionSummary: 'ProfileRevisionSummary'},
  };
  const h = harness(mocks);
  mocks.react = {...h.react, Children: {toArray: value => [value].flat(Infinity).filter(Boolean)}};
  mocks['../FormDialog'] = {FormDialog: props => props.visible ? h.jsx('DetailDialog', props) : null};
  return {...h, mocks, width(value) {width = value;}};
}
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style;
const range = {from: null, to: null};

test('task history alone uses one record per row while retaining its responsive list-detail split and scroll return', () => {
  const h = setup(), fixture = createTaskFixture('synthetic-history-child', 'normal');
  h.mocks['react-native'].Platform = {OS: 'android'};
  h.mocks['../AppIcon'] = {AppIcon: 'AppIcon'};
  h.mocks['../AppStatusBadge'] = {AppStatusBadge: 'AppStatusBadge'};
  h.mocks['../StatusAnnouncement'] = {StatusAnnouncement: 'StatusAnnouncement'};
  h.mocks['../WriteRecoveryNotice'] = {WriteRecoveryNotice: 'WriteRecoveryNotice'};
  h.mocks['./TaskDetail'] = {TaskDetail: 'TaskDetail'};
  h.mocks['./TaskContent'] = {taskAssigneeLabel: () => 'Synthetic caregiver'};
  let model = {...fixture, child: {id: 'synthetic-history-child'}, access: 'editable', online: true, readState: 'ready',
    reading: false, selected: null, operation: {state: 'none'}, scheduleContext: taskPreviewClock};
  const calls = [], scrolls = [];
  const actions = {selectTask(id, mode) { calls.push([id, mode]); model = {...model, selected: model.selected?.id === id ? null : model.items.find(task => task.id === id)}; }, closePanel() { model = {...model, selected: null}; }};
  h.mocks['../../workspaces/TasksWorkspace'] = {useTasksWorkspace: () => ({scopeKey: 'parent:synthetic-history-child', model, actions})};
  const {TaskHistoryView} = h.load('src/components/tasks/TaskHistoryView.tsx');
  const render = () => h.render(h.jsx(TaskHistoryView, {searchText: '', dateRange: range, scrollRef: {current: {scrollTo: value => scrolls.push(value)}}, getScrollPosition: () => 246}));
  const records = () => h.hosts().filter(node => node.props.testID?.startsWith('task-row-'));
  for (const width of [1440, 1024, 840, 839, 390, 320]) {
    h.width(width); render();
    assert.equal(flatten(h.node('task-history-rows').props.style).flexDirection, 'column');
    assert.equal(flatten(h.node('task-history-rows').props.style).alignItems, 'stretch');
    assert.equal(records().length, 2);
    assert.equal(h.node('task-history-rows').props.children.length, 2, 'Rows are direct children, with no half-width cells');
    assert.ok(records().every(row => flatten(row.props.style({pressed: false})).borderWidth === undefined));
    const first = records()[0], id = first.props.testID.slice('task-row-'.length);
    first.props.onPress(); render();
    assert.deepEqual(calls.at(-1), [id, 'toggle']);
    assert.equal(h.hosts().find(node => node.type === 'TaskDetail').props.model.selected.id, id);
    assert.equal(h.node('task-history-list').props['aria-hidden'], width < 840);
    assert.equal(flatten(h.hosts().find(node => node.props.onLayout).props.style).flexDirection, width >= 840 ? 'row' : undefined);
    actions.closePanel(); render();
    assert.equal(h.node('task-history-list').props['aria-hidden'], false);
    if (width < 840) assert.deepEqual(scrolls.slice(-2), [{y: 0, animated: false}, {y: 246, animated: false}]);
  }
});

test('history row density is opt-in and preserves button identity, status, focus and disabled semantics', () => {
  const h = setup();
  h.mocks['../../theme'].colors.teal = '#126b67';
  h.mocks['../AppIcon'] = {AppIcon: 'AppIcon'};
  h.mocks['../AppStatusBadge'] = {AppStatusBadge: 'AppStatusBadge'};
  const {TaskListRow} = h.load('src/components/tasks/TaskListRow.tsx');
  const task = createTaskFixture('synthetic-history-child', 'normal').items.find(task => task.occurrence.state === 'completed');
  let count = 0;
  const props = {task, time: 'Synthetic completion time', assignee: 'Synthetic caregiver', selected: false, disabled: false, onPress() {count++;}};
  const render = patch => h.render(h.jsx(TaskListRow, {...props, ...patch}));
  const row = () => h.node(`task-row-${task.id}`), style = () => flatten(row().props.style({pressed: false}));
  render({}); assert.equal(style().paddingVertical, 16); assert.equal(style().minHeight, 80);
  render({history: true}); assert.equal(style().paddingVertical, 12); assert.equal(style().minHeight, 48);
  assert.equal(style().borderBottomWidth, 1); assert.equal(style().borderWidth, undefined); assert.equal(style().backgroundColor, undefined);
  assert.equal(row().props.accessibilityRole, 'button'); assert.match(row().props.accessibilityLabel, /Synthetic completion time.*Synthetic caregiver.*已完成/);
  row().props.onPress(); assert.equal(count, 1);
  row().props.onFocus(); h.render(); assert.equal(style().borderLeftColor, '#126b67');
  render({history: true, disabled: true}); assert.equal(row().props.disabled, true); assert.equal(row().props['aria-disabled'], true); assert.equal(row().props.accessibilityState.disabled, true);
});

test('history grid holds equal percentage columns including the last item and narrows to one column', () => {
  const h = setup(), {HistoryCardGrid} = h.load('src/components/history/HistoryCards.tsx');
  for (const [width, expected] of [[1440, '50%'], [1024, '50%'], [720, '50%'], [719, '100%'], [390, '100%'], [320, '100%']]) {
    h.width(width); h.render(h.jsx(HistoryCardGrid, {testID: 'grid', children: [1,2,3].map(id => h.jsx('OriginalCard', {testID: `original-${id}`}, id))}));
    const cells = h.hosts().filter(node => flatten(node.props.style)?.paddingHorizontal === 8 && flatten(node.props.style)?.flexShrink === 0);
    assert.equal(cells.length, 3); assert.ok(cells.every(node => flatten(node.props.style).width === expected));
    assert.ok(cells.every(node => flatten(node.props.style).flexGrow === 0), 'The last item cannot stretch');
    assert.equal(h.hosts().filter(node => node.type === 'OriginalCard').length, 3, 'No domain card is replaced or duplicated');
  }
});

test('profile cards open their exact revision, never current, and clear selection across access and identity changes', () => {
  const h = setup(), {ProfileHistoryView} = h.load('src/components/profile/ProfileHistoryView.tsx');
  const revision = version => ({version, reason: `Historical reason ${version}`, confirmedAtLabel: 'Synthetic date', confirmedByLabel: 'Synthetic', data: {source: `source-${version}`}});
  let scopeKey = 'parent-a:child-a', model = {access: 'editable', child: {id: 'child-a', name: 'Synthetic'}, online: true,
    current: {version: 4}, history: [revision(3), revision(2)], historyOpen: true, operation: {state: 'none'}};
  const render = () => h.render(h.jsx(ProfileHistoryView, {scopeKey, model, actions: {}}));
  render(); assert.equal(h.hosts().some(node => node.type === 'DetailDialog'), false);
  h.node('profile-history-version-2').props.onPress(); render();
  const detail = () => h.hosts().find(node => node.type === 'ProfileRevisionSummary');
  assert.equal(detail().props.revision, model.history[1]); assert.equal(detail().props.revision.version, 2);
  model = {...model, current: {version: 9}}; render(); assert.equal(detail().props.revision.version, 2);
  scopeKey = 'parent-b:child-a'; render(); assert.equal(detail(), undefined);
  scopeKey = 'parent-a:child-a'; render(); assert.equal(detail(), undefined, 'Returning to an old scope must not reopen its selection');
  h.node('profile-history-version-3').props.onPress(); render(); assert.equal(detail().props.revision.version, 3);
  const selectedRevision = model.history[0];
  model = {...model, history: [], reading: true}; render(); assert.equal(detail(), undefined, 'Missing history has no verifiable selected revision');
  model = {...model, history: [selectedRevision], reading: false}; render(); assert.equal(detail(), undefined, 'A missing version reappearing must not reopen without another click');
  h.node('profile-history-version-3').props.onPress(); render();
  model = {...model, reading: true}; render(); assert.equal(detail().props.revision, selectedRevision, 'Loading with a retained snapshot keeps the exact open revision');
  model = {...model, reading: false, history: [revision(7)]}; render(); assert.equal(detail(), undefined, 'Unavailable version does not fall back to the newest');
  h.node('profile-history-version-7').props.onPress(); render(); model = {...model, access: 'lost'}; render(); assert.equal(detail(), undefined);
  model = {...model, access: 'editable'}; render(); assert.equal(detail(), undefined);
});

test('one logical notification previews one genuine channel; detail preserves all channel texts and nullable titles', () => {
  const h = setup(); h.mocks['../../production/usePersonalHistory'] = {usePersonalHistoryWorkspace: () => null};
  h.mocks['../../production/VoiceMessage'] = {VoiceMessage: 'VoiceMessage'};
  const {PersonalNotificationContent} = h.load('src/components/history/PersonalHistoryViews.tsx');
  const content = (channel, title, body) => ({channel, title, body, contentVersion: 'v1', sentAt: '2026-10-22T00:00:00Z'});
  const item = {id: 'logical-message', scope: {kind: 'account'}, sentAt: '2026-10-22T00:00:00Z', contents: [
    content('telegram', null, 'Original Telegram body'), content('web_push', 'Original browser title', 'Different browser body'), content('native_push', 'Original Android title', 'Different Android body')]};
  let owner = {scopeKey: 'parent-a', access: 'editable', online: true, busy: {}, actions: {}, notifications: {state: 'ready', data: {items: [item], complete: true}}}, searchText = '', recent = false;
  const render = () => h.render(h.jsx(PersonalNotificationContent, {owner, searchText, recent, dateRange: range}));
  const texts = () => h.hosts().filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity).join(' ');
  render(); const cards = () => h.hosts().filter(node => node.props.testID === 'personal-notification-entry');
  assert.equal(cards().length, 1); assert.equal(cards()[0].type, 'Pressable'); assert.match(texts(), /Original Telegram body/);
  assert.doesNotMatch(texts(), /Different browser body|Original browser title|Different Android body/);
  assert.equal(h.hosts().some(node => node.props.label === '查看'), false);
  cards()[0].props.onPress(); render(); assert.match(texts(), /Different browser body/); assert.match(texts(), /Different Android body/);
  assert.equal(h.hosts().filter(node => node.type === 'DetailDialog').length, 1);
  searchText = 'browser'; render(); assert.equal(h.node('notification-history-detail'), undefined);
  assert.equal(cards().length, 1, 'Search can match a non-preview channel without inventing a common body');
  searchText = ''; render(); assert.equal(h.node('notification-history-detail'), undefined);
  cards()[0].props.onPress(); render();
  owner = {...owner, notifications: {state: 'ready', data: {...owner.notifications.data, items: []}}}; render(); assert.equal(h.node('notification-history-detail'), undefined);
  owner = {...owner, notifications: {state: 'ready', data: {...owner.notifications.data, items: [item]}}}; render(); assert.equal(h.node('notification-history-detail'), undefined, 'Reappearing message does not reopen an invalidated selection');
  cards()[0].props.onPress(); render();
  owner = {...owner, notifications: {state: 'ready', data: {...owner.notifications.data, items: [{...item, contents: item.contents.map(value => ({...value, contentVersion: 'v2'}))}]}}};
  render(); assert.equal(h.node('notification-history-detail'), undefined, 'Do not substitute a different content version');
  cards()[0].props.onPress(); render(); owner = {...owner, scopeKey: 'parent-b'}; render(); assert.equal(h.node('notification-history-detail'), undefined);
  owner = {...owner, scopeKey: 'parent-a'}; render(); assert.equal(h.node('notification-history-detail'), undefined);
  recent = true; render(); assert.equal(cards()[0].type, 'BackgroundSurface'); assert.match(texts(), /Different browser body/);
  assert.equal(h.hosts().some(node => node.type === 'DetailDialog'), false, 'Bell keeps compact rendering and never adds a nested detail modal');
});

test('a missing closed concern invalidates its modal selection but a retained same-version refresh does not', () => {
  const h = setup();
  h.mocks['react-native'].useWindowDimensions = () => ({width: 1000});
  h.mocks['../../theme'].mobileLayout = {breakpoint: 650, touchTarget: 48};
  h.mocks['../useInteractionDensity'] = {useInteractionDensity: () => false};
  h.mocks['./growth-styles'] = {growthStyles: {}};
  for (const [path, name] of [['../AppIcon', 'AppIcon'], ['./GrowthConcernTimeline', 'GrowthConcernTimeline'], ['./GrowthOperationRecovery', 'GrowthOperationRecovery'], ['../StatusAnnouncement', 'StatusAnnouncement']]) h.mocks[path] = {[name]: name};
  const concern = {id: 'concern-a', childId: 'child-a', title: 'Synthetic concern', reason: 'Original reason', status: 'closed', version: 3, archivedAt: '2026-10-01T00:00:00Z'};
  let workspace = {scopeKey: 'parent:child-a', actions: {}, model: {childId: 'child-a', access: 'editable', online: true, load: 'ready', operation: 'none', notice: '', page: {canManage: false, concerns: {state: 'ready', items: [concern]}}}};
  h.mocks['../../workspaces/GrowthWorkspace'] = {useGrowthWorkspace: () => workspace};
  const {GrowthHistoryView} = h.load('src/components/growth/GrowthHistoryView.tsx');
  const render = () => h.render(h.jsx(GrowthHistoryView, {searchText: '', dateRange: range, onTask() {}}));
  const timeline = () => h.hosts().find(node => node.type === 'GrowthConcernTimeline');
  render(); h.node('growth-history-concern-a').props.onPress(); render(); assert.equal(timeline().props.concern, concern);
  workspace.model = {...workspace.model, load: 'loading'}; render(); assert.equal(timeline().props.concern, concern);
  workspace.model = {...workspace.model, load: 'ready', page: {...workspace.model.page, concerns: {state: 'ready', items: []}}}; render(); assert.equal(timeline(), undefined);
  workspace.model = {...workspace.model, page: {...workspace.model.page, concerns: {state: 'ready', items: [concern]}}}; render(); assert.equal(timeline(), undefined, 'A formerly missing concern does not reopen without a click');
});
