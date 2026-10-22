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
    if (name === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'Path' };
    if (name === '../theme') return theme;
    if (name === './icons/GrowthIcon') return load('icons/GrowthIcon.tsx');
    if (name.startsWith('lucide-react-native/icons/')) return { __esModule: true, default: name };
    throw new Error(`Unmocked icon dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

test('growth navigation has its own icon while routes, names and existing task/attention icons stay unchanged', () => {
  assert.deepEqual(navigationItems.summary, { href: '/summary', label: '成長檔案與概況', short: '成長', icon: 'growth-outline' });
  assert.deepEqual(navigationItems.tasks, { href: '/tasks', label: '待辦與預約', short: '待辦', icon: 'clipboard-check-outline' });
  assert.deepEqual(navigationItems.growth, { href: '/growth', label: '關注鏈與準備單', short: '關注', icon: 'chart-bar' });
  assert.equal(new Set(['summary', 'tasks', 'growth'].map(key => navigationItems[key].icon)).size, 3);
  assert.equal(desktopNavigationGroups.flatMap(group => group.keys).filter(key => key === 'summary').length, 1);
  assert.equal(moreNavigationGroups.flatMap(group => group.items).filter(item => item.key === 'summary').length, 1);
});

test('the custom growth SVG inherits AppIcon sizing, stroke, colors and decorative accessibility', () => {
  const { AppIcon, PaperSvgIcon } = load('AppIcon.tsx');
  const defaults = AppIcon({ name: 'growth-outline' });
  assert.equal(defaults.props.children.props.size, theme.iconTokens.navigation);
  assert.equal(defaults.props.children.props.color, theme.colors.muted);
  assert.equal(PaperSvgIcon({ name: 'growth-outline', size: 24 }).props.name, 'growth-outline');
  for (const size of [20, 21, 24, 28]) for (const color of ['#272343', '#2D334A']) {
    const wrapper = AppIcon({ name: 'growth-outline', size, color });
    assert.equal(wrapper.props.testID, 'svg-icon-growth-outline');
    assert.equal(wrapper.props['aria-hidden'], true);
    assert.equal(wrapper.props.accessible, false);
    assert.equal(wrapper.props.importantForAccessibility, 'no-hide-descendants');
    assert.deepEqual(wrapper.props.style, { width: size, height: size, flexShrink: 0 });
    const icon = wrapper.props.children;
    assert.equal(icon.type.name, 'GrowthIcon');
    const svg = icon.type(icon.props);
    assert.equal(svg.type, 'Svg');
    for (const [name, expected] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
      strokeWidth: theme.iconTokens.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false })) {
      assert.equal(svg.props[name], expected, name);
    }
    assert.equal(svg.props.children.length, 4);
    assert.ok(svg.props.children.every(path => path.type === 'Path' && typeof path.props.d === 'string'));
  }
});
