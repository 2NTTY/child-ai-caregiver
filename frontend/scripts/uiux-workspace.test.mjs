import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
let width = 1440;
const cache = new Map();
const host = tag => ({ children, accessibilityLabel, accessibilityRole, role, ...props }) => React.createElement(tag, {
  role: role ?? accessibilityRole, 'aria-label': accessibilityLabel,
  ...(props['aria-current'] ? { 'aria-current': props['aria-current'] } : {}),
  ...(props['aria-level'] ? { 'aria-level': props['aria-level'] } : {}),
  ...(props.testID ? { 'data-testid': props.testID } : {}),
}, typeof children === 'function' ? children({}) : children);
const native = { Platform: { OS: 'web', select: x => x.web ?? x.default }, StyleSheet: { create: x => x, flatten: x => x }, View: host('div'), Pressable: host('span'), useWindowDimensions: () => ({ width }) };
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = { exports: {} }; cache.set(absolute, mod);
  const output = ts.transpileModule(readFileSync(absolute, 'utf8'), { fileName: absolute, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(output.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, file);
  new Function('require', 'module', 'exports', output.outputText)(name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === 'react-native-paper') return { Text: host('span'), MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: x => x };
    if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: host('div') };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
    if (name.endsWith('/PreviewNavigationGuard')) return { PreviewLink: ({ href, children }) => React.createElement('a', { href: typeof href === 'string' ? href : `${href.pathname}?view=${href.params.view}` }, children) };
    if (name.endsWith('/PageFrame')) return { PageFrame: host('main') };
    if (name.endsWith('/ui')) return { AppTextField: host('input') };
    if (name.endsWith('/EmptyListCard')) return { EmptyListCard: ({ title }) => React.createElement('p', {}, title) };
    if (!name.startsWith('.')) return require(name);
    const resolved = path.resolve(path.dirname(absolute), name);
    try { return load(`${resolved}.ts`); } catch (error) { if (error.code !== 'ENOENT') throw error; return load(`${resolved}.tsx`); }
  }, mod, mod.exports);
  return mod.exports;
}
const { workspaceGroups, workspaceForPath } = load('src/components/workspace/workspace-navigation.ts');
const { navigationItems } = load('src/components/navigation/app-navigation.ts');
const { WorkspaceNavigation } = load('src/components/workspace/WorkspaceNavigation.tsx');
const { Workspace } = load('src/components/workspace/Workspace.tsx');
const More = load('src/screens/moreScreen.tsx');

test('all 16 dashboard routes have exactly one workspace destination, including direct deep links', () => {
  const paths = workspaceGroups.flatMap(group => group.items.map(key => navigationItems[key].href));
  const files = readdirSync(path.join(root, 'app/(dashboard)')).filter(file => file.endsWith('.tsx') && file !== '_layout.tsx');
  const routes = files.map(file => file === 'index.tsx' ? '/' : `/${file.slice(0, -4)}`);
  assert.equal(paths.length, 16); assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual([...paths].sort(), [...routes].sort());
  for (const route of routes) assert.ok(workspaceForPath(route).items.some(key => navigationItems[key].href === route));
});
test('real React compound navigation renders current page and every group destination', () => {
  for (const route of Object.values(navigationItems).map(item => item.href)) {
    const html = renderToStaticMarkup(React.createElement(WorkspaceNavigation.Root, { pathname: route }, React.createElement(WorkspaceNavigation.Primary), React.createElement(WorkspaceNavigation.Local)));
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.ok(html.includes(`href="${route}"`), route);
    assert.ok(html.includes('主要工作區')); assert.ok(html.includes('role="navigation"'));
    for (const group of workspaceGroups) assert.ok(html.includes(`href="${navigationItems[group.home].href}"`));
  }
});
test('workspace slots retain heading, actions and content at four widths without fetching data', () => {
  for (width of [320, 390, 1024, 1440]) {
    const html = renderToStaticMarkup(React.createElement(Workspace.Root, { title: '合成工作台' },
      React.createElement(Workspace.Header, null, React.createElement(Workspace.Heading, { description: '合成資料' }), React.createElement(Workspace.Actions, null, React.createElement('button', {}, '原操作'))),
      React.createElement(Workspace.Body, null, '原有功能')));
    assert.ok(html.includes('合成工作台')); assert.ok(html.includes('aria-level="1"'));
    assert.ok(html.includes('原操作')); assert.ok(html.includes('原有功能'));
  }
});
test('feature directory preserves destinations at every width and filters by real labels/detail', () => {
  for (width of [320, 390, 1024, 1440]) {
    const html = renderToStaticMarkup(React.createElement(More.default));
    assert.equal((html.match(/<a href=/g) ?? []).length, 15);
    assert.ok(html.includes('href="/care?view=photos"')); assert.ok(html.includes('href="/history"'));
    assert.ok(html.includes('尋找功能'));
  }
  assert.deepEqual(More.filterFeatureGroups('準備單').flatMap(group => group.items.map(item => item.key)), ['growth']);
  assert.deepEqual(More.filterFeatureGroups('不存在的功能').flatMap(group => group.items), []);
  assert.equal(More.filterFeatureGroups('  ').flatMap(group => group.items).length, 15);
});
test('tokens meet normal-text contrast and do not depend on forced page zoom or remote font loads', () => {
  const { colors } = load('src/theme.ts');
  const luminance = hex => { const v = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return v[0] * .2126 + v[1] * .7152 + v[2] * .0722; };
  for (const [fg, bg] of [['ink', 'canvas'], ['muted', 'white'], ['teal', 'white'], ['white', 'teal'], ['onAccent', 'accent'], ['warningInk', 'paleAmber'], ['errorInk', 'paleCoral']]) {
    const a = luminance(colors[fg]), b = luminance(colors[bg]); assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${fg}/${bg}`);
  }
  const layout = readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  assert.equal(/zoom:\s*1\.[24]/.test(layout), false); assert.ok(layout.includes(':focus-visible'));
  assert.equal(/fonts.googleapis.com/.test(readFileSync(path.join(root, 'src/theme.ts'), 'utf8')), false);
});
