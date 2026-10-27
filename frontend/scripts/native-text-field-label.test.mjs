import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const native = { Platform: { OS: 'android', select: value => value[native.Platform.OS] ?? value.default }, StyleSheet: { create: value => value, flatten }, Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width: 390 }) };
const paper = { TextInput: 'PaperTextInput', MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value };
let states = [], cursor = 0;
const react = {
  useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], next => { states[index] = next; }]; },
  useRef: value => ({ current: value }), useLayoutEffect() {},
};
function load(file) {
  const source = readFileSync(new URL(file, root), 'utf8');
  const output = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputText)(name => name === 'react' ? react : name === 'react/jsx-runtime' ? require(name)
    : name === 'react-native' ? native : name === 'react-native-paper' ? paper : name.endsWith('/theme') ? load('src/theme.ts')
      : new Proxy({}, { get: (_target, key) => String(key) }), module, module.exports);
  return module.exports;
}
const { AppTextField } = load('src/components/ui.tsx');
const render = props => { cursor = 0; return AppTextField(props); };
const reset = os => { native.Platform.OS = os; states = []; };

test('native empty outlined fields expose their label before focus and retain callbacks, values and refs', () => {
  for (const os of ['android', 'ios']) {
    reset(os);
    const events = [], ref = { current: null }, style = { width: 240 }, outlineStyle = { borderRadius: 14 }, contentStyle = { paddingHorizontal: 20 };
    const props = { label: '搜尋已保存記錄', value: '', placeholder: '標題或內容', ref, style, outlineStyle, contentStyle,
      keyboardType: 'email-address', returnKeyType: 'search', onFocus: event => events.push(['focus', event]),
      onBlur: event => events.push(['blur', event]), onChangeText: value => events.push(['change', value]) };
    const initial = render(props);
    assert.equal(initial.type, 'PaperTextInput'); assert.equal(initial.props.label, undefined);
    assert.equal(initial.props.placeholder, props.label); assert.equal(initial.props.accessibilityLabel, props.label);
    assert.equal(initial.props.value, ''); assert.equal(initial.props.keyboardType, props.keyboardType); assert.equal(initial.props.returnKeyType, props.returnKeyType);
    assert.equal(flatten(initial.props.outlineStyle).top, 6);
    assert.equal(flatten(initial.props.style).width, 240); assert.equal(flatten(initial.props.outlineStyle).borderRadius, 14);
    assert.equal(flatten(initial.props.contentStyle).paddingHorizontal, 20);
    const instance = { focus() {} }; initial.props.ref(instance); assert.equal(ref.current, instance);
    const focusEvent = {}, blurEvent = {}; initial.props.onFocus(focusEvent);
    const focused = render(props);
    assert.equal(focused.type, initial.type); assert.equal(focused.key, initial.key);
    assert.equal(focused.props.label, props.label); assert.equal(focused.props.placeholder, props.placeholder);
    focused.props.onChangeText('query'); assert.equal(render(props).props.value, '', 'controlled input remains caller-owned');
    const filled = render({ ...props, value: 'query' }); filled.props.onBlur(blurEvent);
    assert.equal(render({ ...props, value: 'query' }).props.label, props.label);
    assert.equal(render(props).props.placeholder, props.label);
    assert.deepEqual(events, [['focus', focusEvent], ['change', 'query'], ['blur', blurEvent]]);
    assert.equal(render({ ...props, accessibilityLabel: '明確名稱' }).props.accessibilityLabel, '明確名稱');
  }
});

test('native initial values and uncontrolled edits retain floating labels after blur', () => {
  reset('android');
  assert.equal(render({ label: '名稱', value: '已保存' }).props.label, '名稱');
  reset('android');
  const props = { label: '名稱', defaultValue: '草稿' };
  assert.equal(render(props).props.label, props.label);
  const input = render(props); input.props.onFocus({}); render(props).props.onChangeText(''); render(props).props.onBlur({});
  assert.equal(render(props).props.label, undefined);
  render(props).props.onFocus({}); render(props).props.onChangeText('新草稿'); render(props).props.onBlur({});
  assert.equal(render(props).props.label, props.label); assert.equal(render(props).props.value, undefined);
});

test('web, flat, multiline and component labels retain their original Paper presentation', () => {
  for (const [os, extra] of [['web', {}], ['android', { mode: 'flat' }], ['ios', { multiline: true }], ['android', { label: { type: 'CustomLabel' } }]]) {
    reset(os);
    const props = { label: '名稱', value: '', placeholder: '輸入內容', onFocus() {}, onBlur() {}, onChangeText() {}, ...extra };
    const input = render(props);
    assert.equal(input.props.label, props.label); assert.equal(input.props.placeholder, props.placeholder);
    assert.equal(input.props.onFocus, props.onFocus); assert.equal(input.props.onBlur, props.onBlur); assert.equal(input.props.onChangeText, props.onChangeText);
    assert.equal(flatten(input.props.outlineStyle).top, undefined);
    if (extra.multiline) assert.equal(flatten(input.props.contentStyle).marginTop, 12);
  }
});
