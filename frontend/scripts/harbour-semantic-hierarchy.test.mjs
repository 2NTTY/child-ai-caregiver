import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as RNW from 'react-native-web';
import { Slot } from '@radix-ui/react-slot';
import ts from 'typescript';
import { isMoreNavigationPath } from '../src/components/navigation/app-navigation.ts';

// Extract the shipped heading props, then ask actual RNWeb to render them.
// This catches RNWeb's implicit H1 default, not only the presence of a role prop.
for (const [file, expected] of [
  ['HomeWelcome.tsx', 1], ['AppShell.tsx', 2], ['HomeAgentImportant.tsx', 2], ['HomeFocus.tsx', 2],
  ['HomeOngoing.tsx', 2], ['HomeQuickActions.tsx', 2], ['HomeGuideCallout.tsx', 2],
  ['workspace/HomeWorkspace.tsx', 2], ['HomeOverviewItems.tsx', 3],
]) test(`actual RNWeb renders the shipped ${file} heading hierarchy`, () => {
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const headings = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(tree), attr.initializer]));
      if (attributes.accessibilityRole?.text === 'header') {
        const expression = attributes['aria-level'];
        const level = expression && ts.isJsxExpression(expression) ? Number(expression.expression?.getText(tree)) : undefined;
        const html = renderToStaticMarkup(React.createElement(RNW.Text, {
          accessibilityRole: attributes.accessibilityRole.text, ...(level === undefined ? {} : { 'aria-level': level }),
        }, '照顧內容'));
        headings.push(html);
        assert.match(html, new RegExp(`^<h${expected}\\b`), `${file}: ${html}`);
        assert.ok(html.includes(`aria-level="${expected}"`));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(headings.length, `No product headings found in ${file}`);
});

test('actual RNWeb reproduces the missing-level H1 regression', () => {
  const html = renderToStaticMarkup(React.createElement(RNW.Text, { accessibilityRole: 'header' }, '常用資料'));
  assert.match(html, /^<h1\b/); assert.doesNotMatch(html, /^<h2\b/);
});

test('actual MoreNavButton through installed Slot/RNWeb announces current category versus current page', () => {
  const require = createRequire(import.meta.url);
  const file = new URL('../src/components/navigation/MoreNavButton.tsx', import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const pathname of ['/more', '/care', '/profile', '/photos', '/history', '/settings', '/', '/chat']) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return RNW;
      if (name === 'react-native-paper') return { Text: RNW.Text };
      if (name === 'expo-router') return { usePathname: () => pathname, useRouter: () => ({ push() { assert.fail('SSR must not navigate'); } }) };
      if (name.endsWith('PreviewNavigationGuard')) return { PreviewLink: ({ href, children }) => React.createElement(Slot, { href }, children), usePreviewNavigation: () => () => assert.fail('SSR must not navigate') };
      if (name.endsWith('/theme')) return { chineseFont: 'sans-serif', colors: {}, mobileType: {}, mobileLayout: { touchTarget: 48, tabMinHeight: 64 }, mobileIcons: {} };
      if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
      if (name.endsWith('/MobileNavSelection')) return { MobileNavSelection: () => null };
      if (name === './app-navigation') return { navigationItems: { more: { href: '/more', label: '全部功能', short: '全部', icon: 'dots-horizontal' } } };
      assert.fail(`Unmapped semantic dependency: ${name}`);
    }, module, module.exports);
    const html = renderToStaticMarkup(React.createElement(module.exports.MoreNavButton, { active: isMoreNavigationPath(pathname) }));
    assert.match(html, /^<a\b/); assert.match(html, /href="\/more"/); assert.match(html, /aria-label="全部功能"/);
    if (pathname === '/more') assert.match(html, /aria-current="page"/);
    else if (isMoreNavigationPath(pathname)) { assert.match(html, /aria-current="true"/); assert.doesNotMatch(html, /aria-current="page"/); }
    else assert.doesNotMatch(html, /aria-current=/);
  }
});

test('mounted Home unknown and failed recovery use H3 beneath actual SectionHeader H2, including the rail', () => {
  const require = createRequire(import.meta.url), cache = new Map();
  const theme = { colors: {}, radius: {}, readingType: {}, spacing: {}, workspaceType: {}, mobileIcons: {}, mobileType: {}, mobileLayout: { breakpoint: 650 } };
  const uiSource = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  const uiTree = ts.createSourceFile('ui.tsx', uiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const headerSource = uiTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SectionHeader').getText(uiTree);
  const headerCode = ts.transpileModule(headerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const headerModule = { exports: {} };
  // Evaluate the shipped SectionHeader function, not a replacement heading.
  new Function('require', 'module', 'exports', 'View', 'Text', 'useWindowDimensions', 'AppIcon', 'styles', ...Object.keys(theme), headerCode)(
    require, headerModule, headerModule.exports, RNW.View, RNW.Text, () => ({ width: 390 }), () => null, {}, ...Object.values(theme));
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    let source = readFileSync(file, 'utf8');
    if (file.endsWith('OperationNotice.tsx') && process.env.HARBOUR_OPERATION_BASELINE) source = readFileSync(process.env.HARBOUR_OPERATION_BASELINE, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return RNW;
      if (name === 'react-native-paper') return { Text: RNW.Text, ActivityIndicator: () => null };
      if (name.endsWith('/theme')) return theme;
      if (name.endsWith('/ui')) return { SectionHeader: headerModule.exports.SectionHeader, SectionCard: RNW.View,
        AppButton: ({ label }) => React.createElement(RNW.Text, null, label), TextLink: ({ label }) => React.createElement(RNW.Text, null, label) };
      if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
      if (name.endsWith('/HomeBackground')) return { HomeBackground: RNW.View };
      if (name.endsWith('/BackgroundSurface')) return { BackgroundSurface: RNW.View };
      if (name.endsWith('/SummaryDisclosure')) return { SummaryDisclosure: ({ children }) => children };
      if (name.endsWith('/FirstScreenGate')) return { useFirstScreenReady: () => true };
      if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false }) };
      assert.ok(name.startsWith('.'), `Unmapped mounted semantic dependency ${name}`);
      const resolved = path.resolve(path.dirname(file), name);
      return load(existsSync(resolved) ? resolved : existsSync(`${resolved}.ts`) ? `${resolved}.ts` : `${resolved}.tsx`);
    }, module, module.exports);
    return module.exports;
  }
  const component = (file, symbol) => load(fileURLToPath(new URL(`../src/components/${file}.tsx`, import.meta.url)))[symbol];
  const Welcome = component('HomeWelcome', 'HomeWelcome'), Important = component('HomeAgentImportant', 'HomeAgentImportant'), Focus = component('HomeFocus', 'HomeFocus');
  for (const state of ['unknown', 'failed']) for (const rail of [false, true]) {
    const model = { children: [{ id: 'child', displayName: '小晴' }], selectedChildId: 'child', connection: 'online',
      operation: { state, title: '核對這次操作', detail: '請沿原操作查看結果' },
      overview: { childId: 'child', agentImportant: { state: 'ready', items: [], loadedAt: null }, attention: { state: 'ready', items: [] } } };
    const actions = { refresh: () => assert.fail('SSR must not refresh'), reviewOperation: () => assert.fail('SSR must not write'), open: () => assert.fail('SSR must not navigate') };
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(Welcome, { introductionPending: false, scopeKey: 'home' }),
      React.createElement(rail ? Focus : Important, { model, actions, full: rail })));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${state}/${rail}: only the actual page welcome is H1`);
    assert.match(html, new RegExp(`<h2\\b[^>]*>.*?${rail ? '待辦與提醒' : '你的操作狀態'}</h2>`));
    assert.match(html, /<h3\b[^>]*>核對這次操作<\/h3>/);
    assert.ok(html.includes(state === 'unknown' ? '查核這次結果' : '查看原操作'));
  }
});

test('the shipped root HTML declares Traditional Chinese without removing viewport or scroll reset', () => {
  const require = createRequire(import.meta.url), module = { exports: {} };
  const installedHtml = { exports: {} };
  new Function('require', 'module', 'exports', readFileSync(require.resolve('expo-router/build/static/html'), 'utf8'))(
    name => name === 'react' || name === 'react/jsx-runtime' ? require(name) : {}, installedHtml, installedHtml.exports);
  const code = ts.transpileModule(readFileSync(new URL('../app/+html.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === 'expo-router/html'
    ? { ScrollViewStyleReset: installedHtml.exports.ScrollViewStyleReset } : require(name), module, module.exports);
  const html = renderToStaticMarkup(React.createElement(module.exports.default, null, React.createElement('div', { id: 'root' })));
  assert.match(html, /<html lang="zh-Hant">/); assert.match(html, /name="viewport"/);
  assert.match(html, /id="expo-reset"/); assert.match(html, /<body><div id="root"><\/div><\/body>/);
});
