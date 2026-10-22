import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
function loadUi(width = 1440) {
  const source = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const module = { exports: {} };
  const resolve = name => {
    if (name === 'react') return { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useLayoutEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === '../theme') return { colors: { sage: '#BAE8E8', ink: '#272343', paleTeal: '#E3F6F5' }, radius: { pill: 999 }, spacing: { sm: 8 }, mobileLayout: { breakpoint: 650 }, mobileType: {}, workspaceType: {}, typeScale: { small: 14 } };
    if (name === './appearance/BackgroundSurface') return { BackgroundSurface: 'View', useCustomBackground: () => false };
    if (name === './useInteractionDensity') return { useInteractionDensity: () => false };
    return elements;
  };
  new Function('require', 'module', 'exports', output.outputText)(resolve, module, module.exports);
  return module.exports;
}
function renderTabs(count) {
  const ui = loadUi();
  const changes = [];
  const tree = ui.UnderlineTabs({ id: 'counted-tabs', label: '事項分類', items: [{ key: 'pending', label: '待處理', count }, { key: 'completed', label: '已回報完成' }], value: 'pending', onChange: key => changes.push(key) });
  return { tree, changes };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.props?.children)];
}
const named = (tree, type) => nodes(tree).filter(node => node.type === type);

test('zero, one, larger and partial counts use a separate filled pill while the tab label stays plain', () => {
  for (const count of [0, 1, 12, '50+']) {
    const { tree } = renderTabs(count);
    const tab = named(tree, 'Pressable')[0];
    assert.equal(tab.props.accessibilityLabel, `待處理 ${count}`);
    assert.equal(named(tab, 'Text')[0].props.children, '待處理');
    assert.ok(tab.props.style({ pressed: false }).filter(Boolean).every(style => style.backgroundColor === undefined));
    const countNode = nodes(tab).find(node => node.type?.name === 'SelectionCount');
    const badge = countNode.type(countNode.props);
    assert.equal(badge.props.style.backgroundColor, '#BAE8E8');
    assert.equal(badge.props.style.borderRadius, 999);
    assert.equal(badge.props.style.borderWidth, undefined);
    assert.equal(badge.props['aria-hidden'], true);
    assert.equal(named(badge, 'Text')[0].props.children, count);
    assert.equal(named(badge, 'Text')[0].props.style.color, '#272343');
  }
});

test('tabs without a count retain the same plain label and accessible name', () => {
  const { tree } = renderTabs(undefined);
  for (const tab of named(tree, 'Pressable')) {
    assert.equal(nodes(tab).some(node => node.type?.name === 'SelectionCount'), false);
    assert.equal(named(tab, 'Text')[0].props.children, tab.props.accessibilityLabel);
    assert.equal(tab.props.style({ pressed: false }).filter(Boolean).some(style => style.flexDirection === 'row'), false);
  }
});

test('counted tabs preserve tab selection, panel relationships and keyboard navigation', () => {
  const { tree, changes } = renderTabs(1);
  const tabs = named(tree, 'Pressable');
  assert.equal(tabs[0].props.accessibilityRole, 'tab');
  assert.equal(tabs[0].props['aria-selected'], true);
  assert.equal(tabs[0].props['aria-controls'], 'counted-tabs-panel-pending');
  assert.equal(tabs[1].props.tabIndex, -1);
  let prevented = false;
  tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  tabs[1].props.onPress();
  assert.deepEqual(changes, ['completed', 'completed']);
});


test('desktop and mobile section counts share the existing number-only pill', () => {
  for (const width of [1440, 390]) for (const count of [0, 1, 12]) {
    const tree = loadUi(width).SectionHeader({ title: '待辦摘要', count });
    const badge = named(tree, 'View').find(node => node.props.style?.backgroundColor === '#E3F6F5');
    assert.ok(badge);
    assert.equal(badge.props.style.borderRadius, 999);
    assert.equal(badge.props.style.borderWidth, undefined);
    const number = named(badge, 'Text')[0];
    assert.equal(number.props.children, count);
    assert.equal(number.props.accessibilityLabel, `${count} 項`);
    const heading = named(tree, 'Text').find(node => node.props.accessibilityRole === 'header');
    assert.equal(heading.props.children, '待辦摘要');
    assert.equal(heading.props.style.filter(Boolean).some(style => style.backgroundColor), false);
    assert.equal(named(tree, 'View').filter(node => node.props.style?.backgroundColor).length, 1);
  }
});

test('section headings without counts keep their original title without a badge', () => {
  for (const width of [1440, 390]) {
    const tree = loadUi(width).SectionHeader({ title: '待辦摘要' });
    assert.equal(named(tree, 'View').some(node => node.props.style?.backgroundColor), false);
    assert.equal(named(tree, 'Text').length, 1);
    assert.equal(named(tree, 'Text')[0].props.children, '待辦摘要');
  }
});


test('tab toolbar keeps original tabs and action slots on one row with a shrinkable tab rail', () => {
  const tabs = { type: 'tabs' }, actions = { type: 'actions' };
  const tree = loadUi().TabToolbar({ children: tabs, actions, testID: 'toolbar' });
  assert.equal(tree.props.testID, 'toolbar'); assert.equal(tree.props.style.flexDirection, 'row');
  const [tabSlot, actionSlot] = tree.props.children;
  assert.equal(tabSlot.props.children, tabs); assert.equal(tabSlot.props.style.flex, 1); assert.equal(tabSlot.props.style.minWidth, 0);
  assert.equal(actionSlot.props.children, actions); assert.equal(actionSlot.props.style.flexShrink, 0);
});
