import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import * as navigation from '../src/components/navigation/app-navigation.ts';

const require = createRequire(import.meta.url);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function harness(width, pathname = '/more', platform = 'web') {
  const events = []; let pending;
  const leave = action => { events.push('guard'); pending = action; };
  const dependencies = {
    react: { useState: value => [value, () => {}] },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { usePathname: () => pathname, useRouter: () => ({ push: target => events.push(['push', target]) }) },
    'react-native': { Platform: { OS: platform }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value, flatten: value => value }, useWindowDimensions: () => ({ width }) },
    'react-native-paper': { Text: 'Text' },
  };
  function load(relative) {
    const result = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputText)(name => {
      if (dependencies[name]) return dependencies[name];
      if (name.endsWith('/app-navigation')) return navigation;
      if (name.endsWith('/PreviewContext')) return { usePreview: () => ({ actions: { open: key => events.push(['open', key]) } }) };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => leave, PreviewLink: 'PreviewLink' };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
      if (name.endsWith('/theme')) return { colors: {}, spacing: { lg: 16 }, radius: {}, mobileLayout: {}, mobileIcons: {}, mobileType: {} };
      return new Proxy({}, { get: (_target, key) => String(key) });
    }, module, module.exports);
    return module.exports;
  }
  return { events, approve() { const action = pending; pending = null; action?.(); },
    more: () => load('../src/screens/moreScreen.tsx').default(),
    records: () => load('../src/components/navigation/RecordsNavButton.tsx').RecordsNavButton({ active: true, scopeKey: 'parent:child' }) };
}

test('More keeps all guarded link destinations at mobile and desktop sizes', () => {
  for (const platform of ['web', 'android']) for (const width of [320, 390, 768, 1024, 1440]) {
    const h = harness(width, '/more', platform), tree = h.more(), all = nodes(tree), desktop = platform === 'web' && width >= 900;
    assert.equal(tree.props.title, '全部功能');
    assert.equal(tree.props.description, undefined);
    assert.deepEqual(all.filter(node => node.props?.accessibilityRole === 'header').map(node => node.props.children), navigation.moreNavigationGroups.map(group => group.title));
    assert.equal(all.some(node => ['返回記錄', '返回核對'].includes(node.props?.label)), false);
    assert.ok(all.some(node => node.props?.testID === (desktop ? 'more-desktop-catalogue' : 'more-mobile-list')));
    assert.equal(all.filter(node => node.type === 'AppMenuList').length, 0);
    const expectedLinks = navigation.moreNavigationGroups.flatMap(group => group.items).length;
    assert.equal(all.filter(node => node.type === 'WorkspaceLink').length, expectedLinks);
    assert.deepEqual(h.events, []);
  }
});

test('the existing Records control returns from More through the guard without state-reset actions', () => {
  const h = harness(390);
  h.records().props.onPress();
  assert.deepEqual(h.events, ['guard']);
  h.approve();
  assert.deepEqual(h.events, ['guard', ['push', '/care']]);
  const alreadyOnRecords = harness(390, '/care');
  alreadyOnRecords.records().props.onPress();
  assert.deepEqual(alreadyOnRecords.events, []);
});

test('All features uses one destination name and includes every existing ordinary feature without admin or duplicate destinations', () => {
  const keys = navigation.moreNavigationGroups.flatMap(group => group.items.map(item => item.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), Object.keys(navigation.navigationItems).filter(key => key !== 'more').sort());
  for (const width of [320, 390, 768, 1024, 1440]) {
    const h = harness(width), tree = h.more(), all = nodes(tree);
    const links = all.filter(node => node.type === 'WorkspaceLink');
    for (const [index, key] of keys.entries()) {
      assert.deepEqual(links[index].props.href, key === 'photos' ? { pathname: '/care', params: { view: 'photos' } } : navigation.navigationItems[key].href);
      assert.equal(links[index].props.label, navigation.navigationItems[key].label);
    }
    const recordButton = h.records();
    assert.ok(recordButton.props.label.includes('全部功能')); assert.ok(recordButton.props.hint.includes('全部功能'));
    recordButton.props.onExpand();
    // Already on /more: no duplicate push.
    assert.equal(h.events.at(-1)?.[1] === '/more', false);
  }
});


test('Desktop management puts Profile below Memory while keeping Review naming and mobile entry order', () => {
  assert.deepEqual(navigation.navigationItems.care, { href: '/care', label: '核對', short: '核對', icon: 'notebook-outline' });
  const desktopKeys = navigation.desktopNavigationGroups.flatMap(group => group.keys);
  assert.equal(desktopKeys.filter(key => key === 'care').length, 1);
  assert.equal(desktopKeys[desktopKeys.indexOf('memory') - 1], 'care');
  assert.deepEqual(navigation.desktopNavigationGroups.find(group => group.label === '管理').keys, ['care', 'memory', 'profile', 'more']);
  const layout = readFileSync(new URL('../app/(dashboard)/_layout.tsx', import.meta.url), 'utf8');
  assert.deepEqual([...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map(match => match[1]), ['index', 'chat', 'tasks', 'growth', 'care']);
  const screen = readFileSync(new URL('../src/screens/careScreen.tsx', import.meta.url), 'utf8');
  assert.equal([...screen.matchAll(/<PageFrame[^>]*title="核對"/g)].length, 2);
  for (const platform of ['web', 'android']) {
    const control = harness(390, '/care', platform).records();
    assert.equal(control.props.label, '核對，向上拖曳開啟全部功能');
    assert.equal(control.props.hint, '點按開啟核對；按方向鍵上亦可開啟全部功能');
    const text = nodes(control).filter(node => node.type === 'Text').map(node => node.props.children);
    assert.ok(text.includes('核對'));
    assert.ok(text.includes('上拉更多'));
    assert.equal(control.props.testID, 'records-navigation');
  }
});
