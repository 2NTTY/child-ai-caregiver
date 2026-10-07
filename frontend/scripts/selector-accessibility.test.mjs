import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from '@xmldom/xmldom';
import ts from 'typescript';

// Exercise the installed Paper and RN Web DOM renderers; no browser, network or model calls.
const require = createRequire(import.meta.url), rn = require('react-native-web');
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  return name === 'react-native' ? rn : originalLoad.call(this, name, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });
const paperPart = name => require(`react-native-paper/lib/commonjs/${name}`);
const nativeRadioItem = paperPart('components/RadioButton/RadioButtonItem').default;
const theme = paperPart('styles/themes/v3/LightTheme').MD3LightTheme;
const transparent = ({ children }) => React.createElement(React.Fragment, null, children);
const dialog = Object.assign(transparent, { Title: transparent, ScrollArea: transparent, Actions: transparent });
const paper = {
  RadioButton: { Item: nativeRadioItem }, Text: paperPart('components/Typography/Text').default,
  TouchableRipple: paperPart('components/TouchableRipple/TouchableRipple').default,
  useTheme: () => theme, MD3LightTheme: theme, configureFonts: paperPart('styles/fonts').default,
  Portal: transparent, Button: ({ children }) => React.createElement(rn.Text, null, children), TextInput: rn.TextInput,
};
const root = path.resolve(import.meta.dirname, '..'), cache = new Map();
const stateUpdates = [];
const ownerReact = { ...React, useState: () => [true, value => stateUpdates.push(value)],
  useRef: value => ({ current: value }), useLayoutEffect: () => {} };
const overrides = {
  './AppDialog': { AppDialog: dialog }, './AppScrollView': { AppScrollView: rn.ScrollView },
  './AppIcon': { AppIcon: () => null }, './useInteractionDensity': { useInteractionDensity: () => false },
  '../motion': { MotionEntrance: transparent }, '../motion/MotionSelectionMarker': { MotionSelectionMarker: () => null },
  './HorizontalOverflowRail': { HorizontalOverflowRail: transparent }, './AppStatusBadge': { AppStatusBadge: () => null },
};
function load(entry, native = false) {
  const file = path.resolve(root, entry), key = `${file}:${native}`;
  if (cache.has(key)) return cache.get(key).exports;
  const module = { exports: {} }; cache.set(key, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return { ...rn, useWindowDimensions: () => ({ width: 1024, height: 768 }),
      ...(native ? { Platform: { ...rn.Platform, OS: 'android' } } : {}) };
    if (name === 'react-native-paper') return paper;
    if (name === 'react' && /\/(ui|ChildPicker)\.tsx$/.test(file)) return ownerReact;
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('.')) return require(name);
    const target = path.resolve(path.dirname(file), name);
    return load(target + (name.endsWith('theme') ? '.ts' : '.tsx'), native);
  }, module, module.exports);
  return module.exports;
}
const { AppRadioItem } = load('src/components/AppRadioItem.tsx');
const { ChildPicker } = load('src/components/ChildPicker.tsx');
const { AppSelect } = load('src/components/ui.tsx');
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : !value || typeof value !== 'object' ? [] : [value, ...nodes(value.props?.children)];
const dom = element => new DOMParser().parseFromString(`<main>${renderToStaticMarkup(element)}</main>`, 'text/html');
const elements = root => Array.from(root.getElementsByTagName('*'));
const radiosIn = root => elements(root).filter(node => node.getAttribute('role') === 'radio');
function verifyRadios(element, checked, labels) {
  const radios = radiosIn(dom(element));
  assert.equal(radios.length, checked.length, 'one radio per option');
  assert.deepEqual(radios.map(node => node.getAttribute('aria-checked')), checked.map(String));
  assert.deepEqual(radios.map(node => node.getAttribute('aria-label')), labels);
  assert.equal(radios.flatMap(elements).filter(node => node.getAttribute('role') === 'radio' || node.getAttribute('tabindex') === '0').length, 0, 'no nested interactive controls');
  assert.deepEqual(radios.map(node => node.getAttribute('tabindex')), checked.map(() => '0'));
}
const children = [{ id: 'a', displayName: 'Synthetic child A', ageLabel: '3 歲' }, { id: 'b', displayName: 'Synthetic child B', ageLabel: '4 歲' }];
const options = [{ value: 'observation', label: '觀察' }, { value: 'milestone', label: '里程碑' }];

test('child picker DOM exposes one named radio per child and follows the selected child', () => {
  for (const selectedId of ['a', 'b']) verifyRadios(ChildPicker({ children, selectedId, onSelect() {} }),
    children.map(child => child.id === selectedId), children.map(child => `${child.displayName} · ${child.ageLabel}`));
});

test('record-kind AppSelect exposes one radio per option with actual checked state', () => {
  for (const value of ['observation', 'milestone']) verifyRadios(AppSelect({ label: '記錄類型', value, options, onChange() {} }),
    options.map(option => option.value === value), options.map(option => `記錄類型選項：${option.label}`));
});

test('counted AppSelect keeps its existing single-radio semantics', () => {
  verifyRadios(AppSelect({ label: '章節', value: 'observation', options: options.map(item => ({ ...item, count: 2 })), onChange() {} }),
    [true, false], ['章節選項：觀察，2 項', '章節選項：里程碑，2 項']);
});

test('child and record-kind selection retain the original value and close callback', () => {
  const selected = [], changes = [], open = [];
  const childTree = ChildPicker({ children, selectedId: 'a', onSelect: id => selected.push(id), onOpenChange: value => open.push(value) });
  const childOption = nodes(childTree).find(node => node.type === AppRadioItem && node.props.value === 'b');
  childOption.props.onPress();
  assert.deepEqual(selected, ['b']); assert.deepEqual(open, [false]);
  const selectTree = AppSelect({ label: '記錄類型', value: 'observation', options, onChange: value => changes.push(value) });
  nodes(selectTree).find(node => node.type === AppRadioItem && node.props.value === 'milestone').props.onPress();
  assert.deepEqual(changes, ['milestone']); assert.equal(stateUpdates.at(-1), false);
});

test('Space activates once, prevents page scrolling, ignores repeats and respects disabled state', () => {
  let pressed = 0, prevented = 0;
  const item = AppRadioItem({ label: 'Synthetic', value: 'a', checked: true, onPress: () => pressed++ });
  const event = (key, repeat = false) => ({ nativeEvent: { key, repeat }, preventDefault: () => prevented++ });
  item.props.onKeyDown(event(' ')); item.props.onKeyDown(event(' ', true)); item.props.onKeyDown(event('Enter'));
  assert.equal(pressed, 1); assert.equal(prevented, 2);
  item.props.onKeyDown(event('Spacebar')); assert.equal(pressed, 2);
  const disabled = AppRadioItem({ label: 'Synthetic', value: 'a', checked: true, disabled: true, onPress: () => pressed++ });
  disabled.props.onKeyDown(event(' ')); assert.equal(pressed, 2);
  const [radio] = radiosIn(dom(disabled));
  assert.equal(radio.getAttribute('aria-disabled'), 'true'); assert.equal(radio.getAttribute('aria-checked'), 'true'); assert.equal(radio.getAttribute('tabindex'), '-1');
});

test('Enter remains handled exactly once by the installed RN Web press responder', () => {
  const PressResponder = require('react-native-web/dist/cjs/modules/usePressEvents/PressResponder');
  let pressed = 0, keyup;
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener: (_type, handler) => { keyup = handler; }, removeEventListener() {} };
  const item = AppRadioItem({ label: 'Synthetic', value: 'a', checked: true, onPress: () => pressed++ });
  const responder = new PressResponder({ onPress: item.props.onPress, disabled: false });
  const target = { tagName: 'DIV', getAttribute: name => name === 'role' ? 'radio' : null };
  const event = { key: 'Enter', target, currentTarget: target, nativeEvent: { type: 'keydown' }, persist() {}, preventDefault() {}, stopPropagation() {} };
  try {
    responder.getEventHandlers().onKeyDown(event); item.props.onKeyDown(event);
    assert.equal(pressed, 0); keyup(event); assert.equal(pressed, 1);
  } finally { responder.reset(); globalThis.document = previousDocument; }
});

test('native platforms retain the original Paper item and checked status', () => {
  const NativeItem = load('src/components/AppRadioItem.tsx', true).AppRadioItem;
  const onPress = () => {}, item = NativeItem({ label: 'Synthetic', value: 'a', checked: true, onPress });
  assert.equal(item.type, nativeRadioItem); assert.equal(item.props.status, 'checked'); assert.equal(item.props.onPress, onPress);
});
