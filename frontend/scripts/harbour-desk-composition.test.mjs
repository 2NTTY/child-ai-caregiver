import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';
import { navigationItems, moreNavigationGroups, searchNavigationCatalogue } from '../src/components/navigation/app-navigation.ts';

const theme = { colors: {}, spacing: { sm: 8, md: 12, lg: 16, xl: 24 }, radius: {}, readingType: {}, mobileType: {}, chineseFont: 'sans-serif' };
const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};

test('workspace compound parts share presentation metadata and retain arbitrary action/content slots', () => {
  const h = harness({ '../../theme': theme });
  const { Workspace: W } = h.load('src/components/workspace/Workspace.tsx');
  for (const compact of [false, true]) {
    h.render(h.jsx(W.Provider, { title: '合成工作頁', compact, children: [
      h.jsx(W.Header, { children: [h.jsx(W.Heading, { description: '本頁工作用途' }), h.jsx(W.Actions, { children: h.jsx('button', { children: '原有操作' }) })] }),
      h.jsx(W.Split, { children: [h.jsx(W.Main, { testID: 'main', children: '原有內容' }), h.jsx(W.Aside, { testID: 'aside', children: '原有工具' })] }),
    ] }));
    const heading = h.hosts().find(node => node.props.accessibilityRole === 'header');
    assert.equal(text(heading), '合成工作頁'); assert.equal(heading.props['aria-level'], 1);
    assert.equal(h.hosts().filter(node => node.type === 'button').length, 1);
    assert.equal(text(h.node('main')), '原有內容'); assert.equal(text(h.node('aside')), '原有工具');
    assert.equal(flatten(h.node('aside').props.style).width, compact ? '100%' : 300);
    if (compact) assert.equal(flatten(h.node('main').props.style).flexBasis, 'auto');
  }
});

test('home composition passes the exact original model and actions to every domain projection', () => {
  const mocks = { 'react-native': { View: 'View', Pressable: 'Pressable', Platform: { OS: 'android' }, StyleSheet: { create: value => value, flatten } }, '../../theme': theme, '../AppIcon': { AppIcon: 'AppIcon' }, '../HomeGuideCallout': { HomeGuideCallout: 'HomeGuideCallout' },
    '../ui': { AppButton: 'AppButton', SectionCard: 'SectionCard' } };
  for (const name of ['HomeAgentImportant', 'HomeOngoing', 'HomeQuickActions']) mocks[`../${name}`] = { [name]: name };
  mocks['../HomeFocus'] = { HomeActionSummary: 'HomeActionSummary' };
  mocks['../../preview/PreviewNavigationGuard'] = { PreviewLink: 'PreviewLink' };
  const h = harness(mocks), { HomeWorkspace: H } = h.load('src/components/workspace/HomeWorkspace.tsx');
  const model = { profileLoad: 'ready', children: [{ id: 'synthetic' }], guideStatus: 'complete' }, calls = [];
  const actions = { open: key => calls.push(key) };
  h.render(h.jsx(H.Provider, { state: model, actions, children: [h.jsx(H.Setup, {}), h.jsx(H.Important, {}), h.jsx(H.Tasks, {}), h.jsx(H.Ongoing, {}), h.jsx(H.Capture, {}), h.jsx(H.Shortcuts, {})] }));
  for (const name of ['HomeAgentImportant', 'HomeActionSummary', 'HomeOngoing', 'HomeQuickActions']) {
    const node = h.hosts().find(item => item.type === name); assert.equal(node.props.model, model); assert.equal(node.props.actions, actions);
  }
  for (const button of h.hosts().filter(node => node.type === 'Pressable')) button.props.onPress();
  assert.deepEqual(calls, ['summary', 'photos', 'profile']);
  mocks['react-native'].Platform.OS = 'web'; h.render();
  const links = h.hosts().filter(node => node.type === 'PreviewLink');
  assert.deepEqual(links.map(node => node.props.href), ['/summary', '/photos', '/profile']);
  for (const link of links) { assert.equal(link.props.children.props.accessibilityRole, 'link'); assert.equal(link.props.children.props.onPress, undefined); assert.equal(typeof link.props.children.props.style, 'object'); }
  assert.equal(calls.length, 3, 'web navigation is handled by the original guarded link, not a duplicate action');
});

test('home setup is derived from confirmed empty children, not loading or error snapshots', () => {
  const h = harness({ '../../preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink' }, '../../theme': theme, '../HomeGuideCallout': { HomeGuideCallout: 'HomeGuideCallout' },
    '../HomeAgentImportant': {}, '../HomeOngoing': {}, '../HomeFocus': {}, '../HomeQuickActions': {}, '../AppIcon': {},
    '../ui': { AppButton: 'AppButton', SectionCard: 'SectionCard' } });
  const { HomeWorkspace: H } = h.load('src/components/workspace/HomeWorkspace.tsx');
  for (const profileLoad of ['loading', 'error', 'ready']) {
    h.render(h.jsx(H.Provider, { state: { profileLoad, children: [], guideStatus: 'complete' }, actions: { open() {} }, children: h.jsx(H.Setup, {}) }));
    assert.equal(!!h.node('home-child-setup'), profileLoad === 'ready');
  }
});

test('catalogue search preserves every feature and treats input as plain metadata text', () => {
  const keys = result => result.flatMap(group => group.items.map(item => item.key));
  assert.deepEqual(keys(searchNavigationCatalogue('')), keys(moreNavigationGroups));
  assert.ok(keys(searchNavigationCatalogue('照片')).includes('photos'));
  assert.ok(keys(searchNavigationCatalogue('預約')).includes('tasks'));
  assert.ok(keys(searchNavigationCatalogue('來源')).includes('sources'));
  assert.deepEqual(keys(searchNavigationCatalogue('待辦 預約')), ['tasks']);
  assert.deepEqual(keys(searchNavigationCatalogue('<script>')), []);
  assert.equal(keys(searchNavigationCatalogue('   ')).length, Object.keys(navigationItems).length - 1);
});

test('normal navigation retains all eighteen route entry files, redirects and production owners', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const name of ['index', 'chat', 'care', 'tasks', 'growth', 'summary', 'profile', 'photos', 'sources', 'memory', 'history', 'family', 'contact', 'settings', 'guide', 'more']) assert.ok(read(`app/(dashboard)/${name}.tsx`).length > 0);
  for (const name of ['login', 'admin']) assert.ok(read(`app/${name}.tsx`).length > 0);
  assert.match(read('app/_layout.tsx'), /<ProductionProvider>/);
  assert.match(read('app/(dashboard)/_layout.tsx'), /<ProductionDomains>/);
  assert.match(read('src/screens/SummaryScreen.tsx'), /Redirect href="\/growth\?tab=preparation"/);
  assert.match(read('src/screens/GrowthScreen.tsx'), /Redirect href="\/summary\?tab=archive"/);
});

test('web shell adds keyboard escape route to content without forcing display zoom', () => {
  const shell = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(shell, /workspace-skip-link/); assert.match(shell, /role="navigation"/);
  assert.match(layout, /:focus-visible/); assert.doesNotMatch(layout, /zoom:\s*1\.[24]/);
});

test('history category rail exposes eight real choices and compact selector keeps the exact category callback', () => {
  const calls = [], onChange = value => calls.push(value);
  const h = harness({ '../../theme': theme, '../ui': {AppSelect: 'Select'},
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}} });
  const {HistoryCategoryNavigation} = h.load('src/components/history/HistoryCategoryNavigation.tsx');
  h.render(h.jsx(HistoryCategoryNavigation, {value: 'preparations', compact: false, onChange}));
  const choices = h.hosts().filter(node => node.type === 'Pressable');
  assert.equal(choices.length, 8); assert.equal(choices.filter(node => node.props['aria-pressed']).length, 1);
  for (const node of choices) { assert.equal(node.props.accessibilityRole, 'button'); node.props.onPress(); }
  assert.deepEqual(calls, ['tasks', 'preparations', 'review', 'care', 'profile', 'conversations', 'growth', 'notifications']);
  h.render(h.jsx(HistoryCategoryNavigation, {value: 'preparations', compact: true, onChange}));
  const select = h.hosts().find(node => node.type === 'Select');
  assert.equal(select.props.options.length, 8); assert.equal(select.props.value, 'preparations'); assert.equal(select.props.onChange, onChange);
});

test('family remains honestly unavailable and only routes to existing personal controls', () => {
  const native = {View: 'View', Pressable: 'Pressable', Platform: {OS: 'android'}, StyleSheet: {create: value => value, flatten}};
  const h = harness({'react-native': native, '../preview/PreviewNavigationGuard': {PreviewLink: 'PreviewLink'}, '../theme': theme, '../components/PageFrame': {PageFrame: 'PageFrame'},
    '../components/ui': {AppButton: 'Button', SectionCard: 'Card', SectionHeader: 'Header'},
    '../components/AppIcon': {AppIcon: 'Icon'}, '../components/AppStatusBadge': {AppStatusBadge: 'Badge'}});
  const calls = []; h.production({actions: {open: value => calls.push(value)}});
  const Family = h.load('src/screens/familyScreen.tsx').default; h.render(h.jsx(Family, {}));
  assert.match(text(h.node('family-availability')), /家庭協作尚未開放/);
  const actions = h.hosts().filter(node => node.type === 'Pressable'); assert.equal(actions.length, 2);
  for (const action of actions) action.props.onPress();
  assert.deepEqual(calls, ['contact', 'settings']);
  native.Platform.OS = 'web'; h.render();
  const links = h.hosts().filter(node => node.type === 'PreviewLink');
  assert.deepEqual(links.map(node => node.props.href), ['/contact', '/settings']);
  for (const link of links) { assert.equal(link.props.children.props.accessibilityRole, 'link'); assert.equal(link.props.children.props.onPress, undefined); assert.equal(typeof link.props.children.props.style, 'object'); }
  assert.equal(calls.length, 2);
  assert.doesNotMatch(actions.map(node => node.props.accessibilityLabel).join(' '), /邀請|撤銷|建立家庭/);
});


test('admin return is a guarded web link and profile management never promises destructive actions are harmless', () => {
  const admin = readFileSync(new URL('../src/screens/AdminScreen.web.tsx', import.meta.url), 'utf8');
  assert.match(admin, /headerActions={<PreviewLink href="\/"><Pressable accessibilityRole="link" accessibilityLabel="返回工作台"/);
  const profile = readFileSync(new URL('../src/components/profile/ProfileView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(profile, /不會改動上面的照顧檔案/);
  assert.match(profile, /刪除前會另外核對資料範圍/);
  const screen = readFileSync(new URL('../src/screens/profileScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /永久刪除目前孩子及其資料/);
});
