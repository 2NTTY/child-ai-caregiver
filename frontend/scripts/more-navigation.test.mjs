import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';
import * as navigation from '../src/components/navigation/app-navigation.ts';

const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function setup(platform = 'web', pathname = '/more', q) {
  const events = [], params = { q }; let pending;
  const native = { Platform: { OS: platform }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value, flatten } };
  const router = { push: target => events.push(['push', target]), setParams: patch => Object.assign(params, patch) };
  const h = harness({
    'expo-router': { useLocalSearchParams: () => params, usePathname: () => pathname, useRouter: () => router },
    'react-native': native,
    '../preview/PreviewContext': { usePreview: () => ({ actions: { open: key => events.push(['open', key]) } }) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => { events.push('guard'); pending = action; }, PreviewLink: 'PreviewLink' },
    '../../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => { events.push('guard'); pending = action; }, PreviewLink: 'PreviewLink' },
    '../components/PageFrame': { PageFrame: 'PageFrame' }, '../components/ui': { AppButton: 'AppButton', AppTextField: 'AppTextField' },
    '../components/EmptyListCard': { EmptyListCard: 'EmptyListCard' }, '../components/AppIcon': { AppIcon: 'AppIcon' }, '../AppIcon': { AppIcon: 'AppIcon' },
    './MobileNavSelection': { MobileNavSelection: 'MobileNavSelection' },
    '../theme': { colors: { quietSurface: '#F3F6F4' }, spacing: { lg: 16 }, radius: {} },
    '../../theme': { colors: {}, spacing: {}, mobileLayout: { touchTarget: 48, tabMinHeight: 64 }, mobileType: {}, mobileIcons: {} },
  });
  const Screen = h.load('src/screens/moreScreen.tsx').default, { MoreNavButton } = h.load('src/components/navigation/MoreNavButton.tsx');
  return { h, events, params, render: () => h.render(h.jsx(Screen, {})),
    nav: (active = true) => h.render(h.jsx(MoreNavButton, { active })),
    approve() { const action = pending; pending = undefined; action?.(); } };
}

test('every web catalogue destination remains a guarded href with readable descriptions and one page scroll owner', () => {
  const s = setup(); s.render();
  const keys = navigation.moreNavigationGroups.flatMap(group => group.items.map(item => item.key));
  const links = s.h.hosts().filter(node => node.type === 'PreviewLink');
  assert.equal(links.length, keys.length);
  for (const [index, key] of keys.entries()) {
    const control = s.h.node(`feature-${key}`);
    assert.deepEqual(links[index].props.href, key === 'photos' ? { pathname: '/care', params: { view: 'photos' } } : navigation.navigationItems[key].href);
    assert.equal(control.props.accessibilityRole, 'link'); assert.equal(control.props.onPress, undefined);
    assert.equal(control.props.accessibilityLabel, navigation.navigationItems[key].label);
    assert.ok(control.props.accessibilityHint); assert.ok(text(control).includes(control.props.accessibilityHint));
    assert.equal(typeof control.props.style, 'object'); assert.equal(flatten(control.props.style).minHeight, 80);
  }
  const source = readFileSync(new URL('../src/screens/moreScreen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AppMenuList|ScrollView|useContainerWidth|useWindowDimensions|maxHeight/);
  assert.equal(s.h.hosts().filter(node => node.type === 'PageFrame').length, 1);
  assert.deepEqual(s.events, []);
});

test('native catalogue retains original actions and guarded photo/history aliases without automatic navigation', () => {
  const s = setup('android'); s.render();
  assert.equal(s.h.hosts().filter(node => node.type === 'PreviewLink').length, 0);
  assert.equal(s.h.node('feature-care').props.accessibilityRole, 'button');
  s.h.node('feature-photos').props.onPress(); assert.deepEqual(s.events, ['guard']); s.approve();
  assert.deepEqual(s.events.at(-1), ['push', { pathname: '/care', params: { view: 'photos' } }]);
  s.h.node('feature-home').props.onPress(); s.approve(); assert.deepEqual(s.events.at(-1), ['push', '/']);
  s.h.node('feature-history').props.onPress(); s.approve(); assert.deepEqual(s.events.at(-1), ['push', '/history']);
  s.h.node('feature-summary').props.onPress(); assert.deepEqual(s.events.at(-1), ['open', 'summary']);
});

test('URL search, restored query arrays, empty state and clear stay derived from public navigation metadata', () => {
  const s = setup('web', '/more', ['預約', 'ignored']); s.render();
  assert.equal(s.h.hosts().filter(node => node.type === 'PreviewLink').length, 1);
  assert.ok(s.h.node('feature-tasks'));
  const field = () => s.h.hosts().find(node => node.type === 'AppTextField');
  assert.equal(field().props.value, '預約'); field().props.onChangeText('<script>'); s.render();
  assert.equal(s.params.q, '<script>'); assert.equal(s.h.hosts().filter(node => node.type === 'PreviewLink').length, 0);
  assert.ok(s.h.hosts().some(node => node.type === 'EmptyListCard'));
  s.h.hosts().find(node => node.props.label === '顯示全部功能').props.onPress(); s.render();
  assert.equal(s.params.q, undefined); assert.equal(s.h.hosts().filter(node => node.type === 'PreviewLink').length, 15);
  assert.deepEqual(s.events, []);
});

test('press feedback is owned by its stable catalogue row, not shared across all destinations', () => {
  const s = setup(); s.render();
  s.h.node('feature-tasks').props.onPressIn(); s.render();
  assert.equal(flatten(s.h.node('feature-tasks').props.style).backgroundColor, '#F3F6F4');
  assert.equal(flatten(s.h.node('feature-home').props.style).backgroundColor, undefined);
  // The product state selects a second flat style only for the active row.
  assert.equal(s.h.node('feature-tasks').props.style.minHeight, 80);
  s.h.node('feature-tasks').props.onPressOut(); s.render();
  assert.deepEqual(s.events, []);
});

test('mobile All features has a direct web link and guarded native tap, without a required drag or duplicate push', () => {
  const web = setup(); web.nav();
  const link = web.h.hosts().find(node => node.type === 'PreviewLink'), control = web.h.node('more-navigation');
  assert.equal(link.props.href, '/more'); assert.equal(control.props.accessibilityRole, 'link'); assert.equal(control.props.accessibilityLabel, '全部功能');
  assert.equal(text(control), '全部'); assert.equal(control.props['aria-current'], 'page');
  assert.equal(control.props.onPress, undefined); assert.equal(control.props.onGestureEnd, undefined);
  const native = setup('android', '/profile'); native.nav(); native.h.node('more-navigation').props.onPress();
  assert.equal(native.h.node('more-navigation').props['aria-current'], true, 'a selected category is current but not the /more page');
  assert.deepEqual(native.events, ['guard']); native.approve(); assert.deepEqual(native.events.at(-1), ['push', '/more']);
  const current = setup('android'); current.nav(); current.h.node('more-navigation').props.onPress(); assert.deepEqual(current.events, []);
});

test('ordinary feature parity and unavailable-family copy are truthful across primary and catalogue navigation', () => {
  const keys = navigation.moreNavigationGroups.flatMap(group => group.items.map(item => item.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), Object.keys(navigation.navigationItems).filter(key => key !== 'more').sort());
  assert.match(navigation.moreNavigationGroups.flatMap(group => group.items).find(item => item.key === 'family').detail, /尚未開放/);
  for (const key of keys) assert.equal(navigation.isMoreNavigationPath(navigation.navigationItems[key].href), !['home', 'chat', 'tasks', 'growth'].includes(key));
  assert.equal(navigation.isMoreNavigationPath('/more'), true); assert.equal(navigation.isMoreNavigationPath('/admin'), false);
  const layout = readFileSync(new URL('../app/(dashboard)/_layout.tsx', import.meta.url), 'utf8');
  assert.deepEqual([...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map(match => match[1]), ['index', 'chat', 'tasks', 'growth', 'more']);
  assert.match(layout, /\["care", "history", "memory", "photos"/);
});
