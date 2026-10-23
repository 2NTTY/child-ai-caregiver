import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { desktopNavigationGroups, moreNavigationGroups, navigationItems } from '../src/components/navigation/app-navigation.ts';

const jsx = (type, props) => ({ type, props });
const theme = { colors: { muted: '#2D334A' }, iconTokens: { navigation: 22, strokeWidth: 1.8 } };
function load(relative) {
  const source = readFileSync(new URL('../src/components/' + relative, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View' };
    if (name === 'react-native-svg') return { __esModule: true, default: 'Svg', Rect: 'Rect', Circle: 'Circle', Path: 'Path' };
    if (name === '../theme') return theme;
    if (/^\.\/icons\/(Overview|Concern|Preparation)Icon$/.test(name)) return load(name.slice(2) + '.tsx');
    if (name.startsWith('lucide-react-native/icons/')) return { __esModule: true, default: name };
    throw new Error(`Unmocked icon dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

test('overview and concern navigation have distinct icons without changing destinations or task icons', () => {
  assert.deepEqual(navigationItems.summary, { href: '/summary', label: '概況', short: '概況', icon: 'overview-outline' });
  assert.deepEqual(navigationItems.tasks, { href: '/tasks', label: '待辦與預約', short: '待辦', icon: 'clipboard-check-outline' });
  assert.deepEqual(navigationItems.growth, { href: '/growth', label: '關注鏈與準備單', short: '關注', icon: 'concern-outline' });
  assert.equal(new Set(['summary', 'tasks', 'growth'].map(key => navigationItems[key].icon)).size, 3);
  assert.equal(desktopNavigationGroups.flatMap(group => group.keys).filter(key => key === 'summary').length, 1);
  assert.equal(moreNavigationGroups.flatMap(group => group.items).filter(item => item.key === 'summary').length, 1);
  assert.equal(desktopNavigationGroups.flatMap(group => group.keys).filter(key => key === 'growth').length, 1);
  assert.equal(moreNavigationGroups.flatMap(group => group.items).filter(item => item.key === 'growth').length, 1);
});

test('concern and preparation SVGs share the size, stroke, color and decorative accessibility contract', () => {
  const { AppIcon, PaperSvgIcon } = load('AppIcon.tsx');
  for (const [name, component, shapes] of [
    ['concern-outline', 'ConcernIcon', ['Path', 'Circle', 'Circle', 'Circle']],
    ['preparation-outline', 'PreparationIcon', ['Path', 'Path']],
  ]) {
    assert.equal(PaperSvgIcon({ name, size: 24 }).props.name, name);
    assert.equal(AppIcon({ name }).props.children.props.size, theme.iconTokens.navigation);
    for (const size of [18, 20, 21, 22, 24, 28]) for (const color of ['#272343', '#2D334A']) {
      const wrapper = AppIcon({ name, size, color });
      assert.equal(wrapper.props.testID, 'svg-icon-' + name);
      assert.equal(wrapper.props['aria-hidden'], true);
      assert.equal(wrapper.props.accessible, false);
      assert.equal(wrapper.props.importantForAccessibility, 'no-hide-descendants');
      assert.deepEqual(wrapper.props.style, { width: size, height: size, flexShrink: 0 });
      const icon = wrapper.props.children;
      assert.equal(icon.type.name, component);
      const svg = icon.type(icon.props);
      assert.equal(svg.type, 'Svg');
      for (const [key, expected] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
        strokeWidth: theme.iconTokens.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false })) {
        assert.equal(svg.props[key], expected, `${name} ${size}px ${key}`);
      }
      assert.deepEqual(svg.props.children.map(child => child.type), shapes);
    }
  }
  assert.equal(AppIcon({ name: 'chart-bar' }).props.children.type, 'lucide-react-native/icons/chart-column-increasing');
  assert.equal(AppIcon({ name: 'eye' }).props.children.type, 'lucide-react-native/icons/eye');
  assert.equal(AppIcon({ name: 'clipboard-check-outline' }).props.children.type, 'lucide-react-native/icons/clipboard-check');
});

test('preparation headings and item empty states use the bag without changing task icons', () => {
  const card = readFileSync(new URL('../src/components/summary/PreparationCard.tsx', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../src/components/summary/PreparationSheet.tsx', import.meta.url), 'utf8');
  assert.match(card, /title="到診準備單" icon="preparation-outline"/);
  assert.match(card, /icon="preparation-outline" testID="preparation-editor-checklist-empty"/);
  assert.match(sheet, /icon="preparation-outline" testID="preparation-reading-checklist-empty"/);
  assert.equal(navigationItems.tasks.icon, 'clipboard-check-outline');
});

test('the custom overview SVG inherits AppIcon sizing, stroke, colors and decorative accessibility', () => {
  const { AppIcon, PaperSvgIcon } = load('AppIcon.tsx');
  const defaults = AppIcon({ name: 'overview-outline' });
  assert.equal(defaults.props.children.props.size, theme.iconTokens.navigation);
  assert.equal(defaults.props.children.props.color, theme.colors.muted);
  assert.equal(PaperSvgIcon({ name: 'overview-outline', size: 24 }).props.name, 'overview-outline');
  for (const size of [20, 21, 24, 28]) for (const color of ['#272343', '#2D334A']) {
    const wrapper = AppIcon({ name: 'overview-outline', size, color });
    assert.equal(wrapper.props.testID, 'svg-icon-overview-outline');
    assert.equal(wrapper.props['aria-hidden'], true);
    assert.equal(wrapper.props.accessible, false);
    assert.equal(wrapper.props.importantForAccessibility, 'no-hide-descendants');
    assert.deepEqual(wrapper.props.style, { width: size, height: size, flexShrink: 0 });
    const icon = wrapper.props.children;
    assert.equal(icon.type.name, 'OverviewIcon');
    const svg = icon.type(icon.props);
    assert.equal(svg.type, 'Svg');
    for (const [name, expected] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
      strokeWidth: theme.iconTokens.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false })) {
      assert.equal(svg.props[name], expected, name);
    }
    assert.equal(svg.props.children.length, 3);
    assert.ok(svg.props.children.every(rect => rect.type === 'Rect' && rect.props.rx === 1.5));
  }
});


test('desktop overview and history use the review group label without changing routes, order or other care labels', () => {
  assert.deepEqual(desktopNavigationGroups, [
    {label: '常用', keys: ['home']}, {label: '行動', keys: ['tasks', 'growth']},
    {label: '回顧', keys: ['summary', 'history']}, {label: '管理', keys: ['care', 'memory', 'profile', 'more']},
  ]);
  assert.deepEqual(navigationItems.history, {href: '/history', label: '歷史', short: '歷史', icon: 'history'});
  assert.equal(moreNavigationGroups.find(group => group.title === '照顧資料')?.items[1].key, 'summary');
  assert.equal(navigationItems.care.short, '核對');
});
