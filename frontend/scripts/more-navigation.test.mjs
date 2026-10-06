import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import * as navigation from '../src/components/navigation/app-navigation.ts';

const require = createRequire(import.meta.url);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function harness(width, pathname = '/more') {
  const events = []; let pending;
  const leave = action => { events.push('guard'); pending = action; };
  const dependencies = {
    react: { useState: value => [value, () => {}] },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { usePathname: () => pathname, useRouter: () => ({ push: target => events.push(['push', target]) }) },
    'react-native': { Platform: { OS: 'web' }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value, flatten: value => value }, useWindowDimensions: () => ({ width }) },
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

test('More keeps mobile lists and desktop links without a redundant return-to-records button', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const h = harness(width), tree = h.more(), all = nodes(tree), desktop = width >= 900;
    assert.equal(all.some(node => node.props?.label === '返回記錄'), false);
    assert.ok(all.some(node => node.props?.testID === (desktop ? 'more-desktop-catalogue' : 'more-mobile-list')));
    assert.equal(all.filter(node => node.type === 'AppMenuList').length, desktop ? 0 : navigation.moreNavigationGroups.length);
    const expectedLinks = navigation.moreNavigationGroups.flatMap(group => group.items).length;
    assert.equal(all.filter(node => node.type === 'PreviewLink').length, desktop ? expectedLinks : 0);
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
