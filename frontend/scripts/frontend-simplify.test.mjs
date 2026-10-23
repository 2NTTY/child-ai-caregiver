import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DateTime } from 'luxon';
import * as historyModel from '../src/history-view-model.ts';
import * as taskModel from '../src/task-view-model.ts';
import { createTaskFixture, taskPreviewClock } from '../src/preview/task-fixture.ts';
import { navigationItems, desktopNavigationGroups } from '../src/components/navigation/app-navigation.ts';

// Shipped view functions and callbacks with synthetic host primitives, not browser pixels.
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => !tree ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : '';
function load(file, overrides = {}, suffix = '') {
  const output = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output + suffix)(name => {
    if (name in overrides) return overrides[name];
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react') return { useState: value => [value, () => {}], useRef: current => ({ current }), useLayoutEffect() {}, useEffect() {}, useId: () => 'synthetic' };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value, flatten }, useWindowDimensions: () => ({ width: 1440 }) };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/theme')) return { colors: {}, spacing: {}, radius: {}, readingType: {}, workspaceType: {}, typeScale: {}, mobileIcons: {}, mobileLayout: {}, mobileType: {} };
    if (name.endsWith('/task-view-model')) return taskModel;
    if (name === 'luxon') return { DateTime };
    if (name === './TaskContent') return load('components/tasks/TaskContent.tsx');
    return elements;
  }, module, module.exports);
  return module.exports;
}

test('desktop navigation uses two-character labels while preserving full accessible names and exact routes', () => {
  const { NavItem } = load('components/AppShell.tsx', {}, '\nexports.NavItem = NavItem;');
  assert.deepEqual(desktopNavigationGroups.map(group => group.label), ['常用', '行動', '照顧', '管理']);
  const keys = desktopNavigationGroups.flatMap(group => group.keys);
  assert.deepEqual(keys.map(key => navigationItems[key].short), ['今日', '待辦', '關注', '概況', '歷史', '檔案', '核對', '記憶', '全部功能']);
  for (const key of [...keys, 'settings']) {
    const item = navigationItems[key], tree = NavItem({ item, active: key === 'tasks' });
    assert.equal(tree.props.href, item.href);
    const link = nodes(tree).find(node => node.props?.accessibilityRole === 'link');
    assert.equal(link.props.accessibilityLabel, item.label);
    const label = nodes(link).find(node => node.type === 'Text');
    assert.equal(text(label), item.short); assert.equal([...text(label)].length, key === 'more' ? 4 : 2);
    if (key === 'tasks') assert.equal(link.props['aria-current'], 'page');
  }
});

test('header omits confirmed profile chips without changing underlying child data', () => {
  const { ChildKeyFacts } = load('components/ChildKeyFacts.tsx');
  for (const confirmed of [false, true]) {
    const child = Object.freeze({ id: 'synthetic', displayName: '合成小晴', regionLabel: '香港', allergiesLabel: '合成過敏備註', profileConfirmed: confirmed });
    const tree = ChildKeyFacts({ child, load: 'ready' });
    const facts = nodes(tree).filter(node => node.props?.fact).map(node => node.props.fact);
    assert.deepEqual(facts, []); assert.equal(text(tree).includes('已確認'), false); assert.equal(child.profileConfirmed, confirmed);
    assert.equal(child.regionLabel, '香港'); assert.equal(child.allergiesLabel, '合成過敏備註');
  }
});

test('completed detail shows one concise reminder summary and keeps terminal policy under history', () => {
  const { TaskDetail } = load('components/tasks/TaskDetail.tsx');
  const fixture = createTaskFixture('synthetic', 'normal');
  const base = fixture.items.find(item => item.occurrence.state === 'completed');
  for (const state of ['completed', 'cancelled', 'needs_review', 'scheduled']) {
    const task = { ...base, occurrence: { ...base.occurrence, state } };
    const model = { ...fixture, child: { id: 'synthetic' }, selected: task, operation: { state: 'idle' }, access: 'editable', reading: false,
      scheduleContext: taskPreviewClock, history: [], historyOpen: false, work: [], reminders: [], workerEnabled: false };
    const tree = TaskDetail({ model, actions: {} });
    const disclosure = nodes(tree).find(node => node.type === 'MotionDisclosure');
    const outside = tree.props.children.filter(node => node !== disclosure);
    assert.equal(text(outside).includes('不能直接重開'), false);
    if (state === 'completed' || state === 'cancelled') {
      const summary = state === 'completed' ? '已完成，提醒已停止' : '已取消，提醒已停止';
      assert.equal(text(outside).split(summary).length - 1, 1); assert.ok(text(disclosure).includes('不能直接重開'));
    } else assert.equal(text(outside).includes('已完成，提醒已停止'), false);
  }
  const completed = { ...base, completedAt: '2026-10-15T03:39:00Z' };
  assert.equal(taskModel.taskCompletionLabel(completed, 'Asia/Hong_Kong'), '10月15日 11:39 完成');
  assert.equal(taskModel.taskStateLabels.completed, '已完成');
});

test('selected task rows keep their close hint accessible without visible tutorial copy', () => {
  const { TaskListRow } = load('components/tasks/TaskListRow.tsx', { react: { useState: () => [true, () => {}] } });
  const task = createTaskFixture('synthetic', 'normal').items[0];
  const tree = TaskListRow({ task, time: '10:00', assignee: '本人', selected: true, disabled: false, onPress() {} });
  assert.match(tree.props.accessibilityLabel, /^再次點按關閉詳情/);
  assert.equal(text(tree).includes('再次點按關閉詳情'), false);
});

test('an untouched source composer does not turn read busy into a pending write, while drafts and real writes remain protected', () => {
  let dirty = false, guard;
  const { SourceComposer } = load('components/shared-inputs/SourceComposer.tsx', {
    'react-hook-form': { useForm: () => ({ control: {}, watch: name => name === 'kind' ? 'paste' : '', handleSubmit: callback => callback, formState: { isDirty: dirty, errors: {} } }) },
    '@hookform/resolvers/zod': { zodResolver() {} },
    './source-form': { sourceComposerSchema: () => ({}), sourceComposerDefaults: {} },
    '../../preview/PreviewNavigationGuard': { usePreviewLeaveGuard: (dirty, pending) => { guard = { dirty, pending }; } },
  });
  const model = { busy: true, operation: { state: 'none' }, sources: [], access: 'editable', canChoose: false };
  SourceComposer({ model, actions: {} }); assert.deepEqual(guard, { dirty: false, pending: false });
  dirty = true; SourceComposer({ model, actions: {} }); assert.deepEqual(guard, { dirty: true, pending: false });
  for (const state of ['saving', 'unknown', 'unconfirmed', 'confirmed_unavailable']) {
    SourceComposer({ model: { ...model, operation: { state } }, actions: {} }); assert.equal(guard.pending, true);
  }
});

test('login keeps recovery and validation without dead links or instruction chrome; password visibility is an input adornment', async () => {
  for (const platform of ['web', 'android']) for (const width of [320, 390, 768, 1024, 1440]) {
    let cursor = 0;
    const states = [], events = [];
    const production = { identityKey: null, auth: 'signedOut', online: true, recordsState: { busy: null, notice: '已登出，這個頁面的未提交內容已清除。' },
      account: { status: { registration: 'invite', mailConfigured: true }, gate: 'signedOut', busy: null },
      authenticate: async (...args) => events.push(['auth', ...args]), accountActions: { requestEmail: (...args) => events.push(['mail', ...args]) }, owner: { accountOwner: {} } };
    const state = initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; };
    const { default: Login } = load('screens/loginScreen.tsx', {
      react: { useState: state, useRef: current => ({ current }), useId: () => 'synthetic-login', useEffect() {} },
      'react-native': { View: 'View', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', Platform: { OS: platform }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) },
      'react-native-paper': { Text: 'Text', TextInput: { Icon: 'InputIcon' } },
      'expo-router': { useIsFocused: () => true, useRouter: () => ({ replace: path => events.push(['replace', path]) }) },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
      '../production/ProductionProvider': { useProduction: () => production },
      '../components/useContainerSize': { useContainerSize: () => ({ ref: null, size: { width: 600, height: 800 }, onLayout() {} }) },
      '../startup/FirstScreenGate': { useFirstScreenImage: () => ({ fallback: false, onLoad() {}, onError() {} }) },
    });
    const render = () => { cursor = 0; return Login(); };
    const labelled = (tree, label) => nodes(tree).find(node => node.props?.accessibilityLabel === label);
    let tree = render();
    assert.equal(labelled(tree, '返回主頁'), undefined); assert.equal(text(tree).includes('登入說明'), false);
    assert.equal(text(tree).includes('用資料陪伴成長'), false);
    assert.ok(labelled(tree, '重新要求驗證指引')); assert.ok(text(tree).includes('重寄驗證'));
    assert.equal(text(tree).includes('目前只接受獲邀電郵註冊'), false);
    assert.ok(text(tree).includes('已登出'));
    const password = labelled(tree, '密碼');
    assert.equal(password.props.right.props.icon, 'eye'); assert.equal(password.props.secureTextEntry, true); assert.equal(password.props.right.type, 'InputIcon');
    password.props.right.props.onPress(); tree = render(); assert.equal(labelled(tree, '密碼').props.secureTextEntry, false); assert.equal(labelled(tree, '密碼').props.right.props.icon, 'eye-off');
    assert.equal(labelled(tree, '密碼').props.right.props.accessibilityLabel, '隱藏密碼');
    labelled(tree, '電郵地址').props.onChangeText('synthetic@example.invalid');
    tree = render(); labelled(tree, '忘記密碼').props.onPress(); assert.deepEqual(events.pop(), ['mail', 'reset', 'synthetic@example.invalid']);
    // EMAIL_NOT_VERIFIED keeps the existing controller signed out and account gate checking, not verification.
    production.account.gate = 'checking';
    production.recordsState.notice = '電郵尚未驗證；可在本頁重新要求驗證指引。';
    tree = render(); assert.ok(text(tree).includes(production.recordsState.notice));
    const resend = labelled(tree, '重新要求驗證指引'); assert.ok(resend); assert.equal(resend.props.disabled, false);
    resend.props.onPress(); assert.deepEqual(events.pop(), ['mail', 'verification', 'synthetic@example.invalid']);
    production.recordsState.notice = null;
    labelled(tree, '註冊帳戶').props.onPress(); tree = render();
    assert.ok(text(tree).includes('目前只接受獲邀電郵註冊')); assert.ok(labelled(tree, '重新要求驗證指引')); assert.equal(labelled(tree, '忘記密碼'), undefined);
    assert.equal(labelled(tree, '密碼').props.secureTextEntry, true);
    nodes(tree).find(node => node.props?.label === '建立帳戶').props.onPress(); tree = render(); assert.ok(text(tree).includes('請填寫稱呼'));
    labelled(tree, '稱呼').props.onChangeText('合成家長'); labelled(tree, '密碼').props.onChangeText('short'); tree = render();
    labelled(tree, '密碼').props.onSubmitEditing(); tree = render(); assert.ok(text(tree).includes('至少 12 個字元')); assert.equal(events.some(event => event[0] === 'auth'), false);
    labelled(tree, '密碼').props.onChangeText('synthetic-password'); tree = render(); labelled(tree, '密碼').props.onSubmitEditing(); await Promise.resolve();
    assert.equal(events.at(-1)[0], 'auth'); assert.equal(events.at(-1)[1], 'signUp');
    tree = render(); assert.equal(labelled(tree, '密碼').props.value, '');
    production.online = false; tree = render(); assert.equal(labelled(tree, '重新要求驗證指引').props.disabled, true);
    const before = events.length; labelled(tree, '密碼').props.onSubmitEditing(); assert.equal(events.length, before);
    const tab = labelled(tree, '註冊帳戶');
    if (platform === 'web') {
      let prevented = false; tab.props.onKeyDown({ key: 'Home', preventDefault() { prevented = true; } }); tree = render();
      assert.equal(prevented, true); assert.equal(labelled(tree, '電郵登入').props.tabIndex, 0); assert.equal(labelled(tree, '註冊帳戶').props.tabIndex, -1);
    } else assert.equal(tab.props.onKeyDown, undefined, 'native tabs retain native accessibility without web keyboard handlers');
  }
});

test('the rail has no context tab or record/background copy, while task navigation and the empty state remain', () => {
  const events = [];
  const { RightRailContent } = load('components/RightRailContent.tsx');
  const actions = { open: destination => events.push(destination) };
  const model = { children: [{ id: 'synthetic', displayName: '合成孩子' }], selectedChildId: 'synthetic' };
  const tree = RightRailContent({ model, actions, contextPath: '/growth' });
  assert.equal(nodes(tree).some(node => node.props?.accessibilityRole === 'tab' || node.type === 'AppTabs'), false);
  for (const copy of ['照顧上下文', '孩子背景', '近期記錄']) assert.equal(text(tree).includes(copy), false);
  const focus = nodes(tree).find(node => node.type === 'HomeFocus');
  assert.equal(focus.props.model, model); assert.equal(focus.props.actions, actions); assert.equal(focus.props.full, true);
  nodes(tree).find(node => node.type === 'TextLink').props.onPress(); assert.deepEqual(events, ['summary']);
  const empty = RightRailContent({ model: { ...model, selectedChildId: null }, actions });
  assert.ok(text(empty).includes('選擇孩子')); assert.equal(nodes(empty).some(node => node.type === 'HomeFocus'), false);
});

test('notification history renders saved message content without delivery diagnostics or inferred receipt', () => {
  const time = '2026-10-18T11:03:02Z';
  const item = Object.freeze({ id: 'telegram:00000000-0000-4000-8000-000000000001', messageId: 'telegram:00000000-0000-4000-8000-000000000001',
    contentVersion: 1, scope: { kind: 'account' }, sentAt: time,
    contents: [{ channel: 'telegram', title: 'Synthetic saved title', body: 'Synthetic original body', contentVersion: '1', sentAt: time }] });
  const events = [];
  const owner = { scopeKey: 'synthetic-parent:child', online: true, busy: { notifications: false },
    notifications: { state: 'ready', data: { items: [item], complete: false, nextCursor: 'synthetic-cursor' } },
    actions: { loadNotifications: () => events.push('reload'), moreNotifications: () => events.push('more') } };
  const { PersonalNotificationContent } = load('components/history/PersonalHistoryViews.tsx', { '../../history-view-model': historyModel });
  const render = () => PersonalNotificationContent({ owner, searchText: '', dateRange: { from: null, to: null } });
  let tree = render();
  assert.equal(nodes(tree).filter(node => node.props?.testID === 'personal-notification-entry').length, 1);
  const copy = text(tree);
  for (const forbidden of ['技術詳情', '投遞嘗試', '尚未確認收到', '結果待核對', '未自動重發', '渠道已接受', '已收到', '已完整載入']) assert.equal(copy.includes(forbidden), false, forbidden);
  for (const expected of ['Synthetic saved title', 'Synthetic original body', 'Telegram', '19:03', '尚有記錄未載入']) assert.ok(copy.includes(expected), expected);
  assert.equal(nodes(tree).some(node => node.type === 'AppStatusBadge'), false);
  nodes(tree).find(node => node.props?.label === '載入更多消息').props.onPress(); assert.deepEqual(events, ['more']);
  owner.notifications = { state: 'error', data: null }; tree = render();
  assert.equal(nodes(tree).some(node => node.props?.testID === 'personal-notification-entry'), false);
  nodes(tree).find(node => node.props?.label === '重新讀取消息').props.onPress(); assert.deepEqual(events, ['more', 'reload']);
});

test('settings keeps eight stable sections, one readonly identity, and persistent notification forms in their own panel', () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const events = [];
    const { default: Settings } = load('screens/settingsScreen.tsx', {
      'expo-router': { useLocalSearchParams: () => ({ section: 'notifications' }) },
      '../components/useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
      '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => action() },
      '../production/ProductionFirstScreenGate': { useProductionVisibleSettingsSection: tab => events.push(tab) },
      '../production/ProductionProvider': { useProduction: () => ({ model: { children: [{ id: 'child', displayName: '合成孩子', ageLabel: '3 歲', profileConfirmed: true }] },
        actions: { selectChild: id => events.push(id), open: route => events.push(route) }, user: { name: '合成照顧者', email: 'synthetic@example.invalid' }, scopeKey: 'scope', authorization: {}, recordsState: {}, online: true }) },
      '../production/SettingsDomains': { useProductionSettingsDomains: () => ({ modelSettings: { model: {}, actions: {} } }), ProductionNotificationPreferences: 'NotificationPreferences', ProductionChannelSettings: 'Channels' },
    });
    const tree = Settings(), all = nodes(tree), nav = all.find(n => n.type === 'SettingsNavigation');
    assert.deepEqual(nav.props.items.map(item => [item.key, item.label]), [['account', '帳戶'], ['children', '孩子'], ['family', '家庭'], ['preferences', '外觀'], ['notifications', '通知'], ['assistant', '助手'], ['model', '模型'], ['privacy', '私隱']]);
    assert.equal(nav.props.compact, width < 720); assert.deepEqual(events, ['notifications']);
    const panels = all.filter(n => n.type === 'AppTabPanel'), panel = key => panels.find(n => n.props.tabKey === key);
    assert.equal(panels.length, 8); assert.equal(panel('notifications').props.active, true);
    assert.equal(nodes(panel('notifications')).filter(n => n.type === 'NotificationPreferences').length, 1);
    assert.equal(nodes(panel('notifications')).filter(n => n.type === 'Channels').length, 1);
    assert.equal(nodes(panel('preferences')).some(n => n.type === 'NotificationPreferences'), false);
    assert.ok(nodes(panel('preferences')).some(n => n.type === 'BackgroundSettings'));
    assert.equal(text(panel('account')).split('合成照顧者').length - 1, 1);
    assert.equal(text(panel('account')).split('synthetic@example.invalid').length - 1, 1);
    assert.equal(all.some(n => n.type === 'AppTextField'), false); assert.equal(text(tree).includes('P4'), false);
    const child = all.find(n => n.props?.accessibilityLabel === '查看合成孩子的檔案'); child.props.onPress();
    assert.deepEqual(events.slice(-2), ['child', 'profile']);
    assert.ok(nodes(panel('privacy')).some(n => n.type === 'AccountDataControls'));
  }
});

test('narrow task detail separates its close control from the heading instead of squeezing the label', () => {
  const fixture = createTaskFixture('synthetic', 'normal');
  for (const width of [320, 390, 768, 1024, 1440]) {
    const { TaskDetail } = load('components/tasks/TaskDetail.tsx', { 'react-native': { View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) } });
    const tree = TaskDetail({ model: { ...fixture, child: { id: 'synthetic' }, selected: fixture.items[0], operation: { state: 'idle' }, access: 'editable', reading: false, scheduleContext: taskPreviewClock, history: [], work: [], reminders: [] }, actions: {} });
    const header = nodes(tree).find(n => n.type === 'SectionHeader');
    if (width < 650) { assert.equal(header.props.action, undefined); assert.ok(nodes(tree).some(n => n.props?.label === '關閉詳情')); }
    else assert.equal(header.props.action.props.label, '關閉詳情');
  }
});

test('Web rail animation uses portal layout width under CSS zoom and retains focus and close callbacks', () => {
  for (const viewport of [320, 390, 768, 1024, 1440]) for (const zoom of [1, 1.2, 1.4]) {
    let focus, closed = 0;
    const { DrawerContents } = load('motion/MotionDrawerOverlay.web.tsx', {
      react: { useState: init => [typeof init === 'function' ? init() : init, () => {}], useRef: current => ({ current }), useLayoutEffect() {} },
      './useDrawerFocus.web': { useDrawerFocus: (...args) => { focus = args; } },
      'react-dom': { createPortal() {} },
    }, '\nexports.DrawerContents = DrawerContents;');
    const props = { host: { clientWidth: viewport / zoom }, open: true, scopeKey: 'synthetic', label: '照顧資訊', onRequestClose: () => closed++ };
    const tree = DrawerContents(props), drawer = nodes(tree).find(n => n.type === 'MotionDrawerRight');
    assert.equal(drawer.props.width, Math.min(props.host.clientWidth * .92, 370)); assert.ok(drawer.props.width * zoom <= viewport);
    assert.equal(focus[0], props); assert.equal(drawer.props.role, 'dialog'); assert.equal(drawer.props['aria-modal'], true);
    drawer.props.onBackdropPress(); assert.equal(closed, 1);
  }
});


test('expanded task arrangement history formats original timestamps to minutes using each preserved occurrence zone', () => {
  const { TaskDetail } = load('components/tasks/TaskDetail.tsx');
  const fixture = createTaskFixture('synthetic', 'normal'), original = fixture.items[0];
  const stamp = '2026-10-21T16:05:37Z';
  const task = {...original, occurrence: {...original.occurrence, dueAt: stamp, timeZone: 'Asia/Hong_Kong'}};
  const revisionTask = {...task, occurrence: {...task.occurrence, timeZone: 'America/New_York'}};
  const model = {...fixture, child: {id: 'synthetic'}, selected: task, operation: {state: 'idle'}, access: 'editable', reading: false,
    scheduleContext: taskPreviewClock, historyOpen: true, history: [{task: revisionTask, at: stamp, action: 'create', actorUserId: 'synthetic', basisVersion: 1, note: ''}],
    eligibleAssignees: [], work: [], reminders: [], workerEnabled: false};
  const copy = text(TaskDetail({model, actions: {}}));
  assert.match(copy, /原始安排時間： 2026年10月22日 00:05/);
  assert.match(copy, /記錄時間： 2026年10月21日 12:05/);
  assert.doesNotMatch(copy, /T16:05:37Z|香港時間|Asia\/Hong_Kong|America\/New_York/);
  assert.equal(task.occurrence.dueAt, stamp); assert.equal(revisionTask.occurrence.timeZone, 'America/New_York');
});


test('recent messages consume the same owner, show at most five saved messages and never invent unread counts', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: String(i), scope: { kind: 'account' }, sentAt: '2026-10-18T11:03:02Z',
    contents: [{ channel: 'telegram', title: null, body: 'Saved body ' + i, contentVersion: '1', sentAt: '2026-10-18T11:03:02Z' }] }));
  const owner = { scopeKey: 'synthetic-scope', online: true, notifications: { state: 'ready', data: { items, complete: false } }, busy: { notifications: false }, actions: {} };
  const { PersonalNotificationContent } = load('components/history/PersonalHistoryViews.tsx', { '../../history-view-model': historyModel });
  const recent = PersonalNotificationContent({ owner, recent: true });
  assert.equal(nodes(recent).filter(node => node.props?.testID === 'personal-notification-entry').length, 5);
  assert.equal(text(recent).includes('Saved body 5'), false); assert.equal(text(recent).includes('未讀'), false);
  const navigated = [];
  const { NotificationBell } = load('components/NotificationBell.tsx', {
    react: { useState: () => [true, () => {}], useRef: current => ({ current }), useEffect() {} },
    'expo-router': { useRouter: () => ({ push: path => navigated.push(path) }) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => action() },
    '../production/usePersonalHistory': { usePersonalHistoryWorkspace: () => owner },
    './AppDialog': { AppDialog: { Title: 'Title', Content: 'Content', Actions: 'Actions' } },
  });
  const bell = NotificationBell();
  assert.ok(text(bell).includes('最近消息')); assert.equal(text(bell).includes('操作提示'), false);
  assert.equal(nodes(bell).find(node => node.type === 'PersonalNotificationContent').props.owner, owner);
  assert.equal(nodes(bell).some(node => /Badge|OperationNotice/.test(String(node.type))), false);
  nodes(bell).find(node => node.props?.label === '查看消息歷史').props.onPress(); assert.deepEqual(navigated, ['/history?category=notifications']);
});

test('header maps only explicit operation types to static textual lights and preserves original callbacks', () => {
  const { headerOperationHints } = load('header-operation-hints.ts');
  const called = [];
  const states = ['none', 'saved', 'saving', 'needs_confirmation', 'unknown', 'conflict', 'failed', 'confirmed_unread'];
  const hints = headerOperationHints(states.map(state => ({ id: state, page: '合成頁面', state, onReview: () => called.push(state) })));
  assert.equal(hints.length, 6); assert.deepEqual(hints.map(hint => hint.tone), ['info', 'warning', 'warning', 'warning', 'error', 'warning']);
  assert.equal(headerOperationHints([{ id: 'no-action', page: '合成', state: 'failed' }]).length, 0);
  const { HeaderOperationHint } = load('components/HeaderOperationHint.tsx');
  for (const hint of hints) {
    const tree = HeaderOperationHint({ hint }); assert.match(tree.props.accessibilityLabel, /合成頁面.*前往處理/);
    assert.ok(text(tree).includes(hint.status)); tree.props.onPress();
  }
  assert.deepEqual(called, states.slice(2));
});


test('an account without a child can open message history but not the other child history sections', () => {
  let category = 'notifications';
  const personal = { scopeKey: 'synthetic-account-message-scope', messageOnly: true };
  const filters = load('components/history/history-filters.ts');
  const { default: HistoryScreen } = load('screens/historyScreen.tsx', {
    'expo-router': { usePathname: () => '/history', useLocalSearchParams: () => ({ category }) },
    '../production/ProductionProvider': { useProduction: () => ({ model: { children: [], selectedChildId: null }, actions: {}, scopeKey: null }) },
    '../production/usePersonalHistory': { usePersonalHistoryWorkspace: () => personal },
    '../components/history/history-filters': filters,
  });
  let tree = HistoryScreen(); assert.equal(tree.props.scope, personal.scopeKey); assert.equal(tree.props.initialCategory, 'notifications');
  for (const section of ['conversations', 'care', 'profile', 'tasks']) {
    category = section; tree = HistoryScreen(); assert.ok(text(tree).includes('先選擇孩子')); assert.equal(tree.props.scope, undefined);
  }
  assert.equal(historyModel.personalHistoryScopeMatches(personal.scopeKey, { ...personal, childId: '', access: 'active' }), true);
  assert.equal(historyModel.personalHistoryScopeMatches('other-account', { ...personal, childId: '', access: 'active' }), false);
  assert.equal(historyModel.personalHistoryScopeMatches(personal.scopeKey, { scopeKey: personal.scopeKey, childId: '', access: 'active' }), false);
});
