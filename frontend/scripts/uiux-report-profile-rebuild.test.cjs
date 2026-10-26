const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const test = require('node:test');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for the existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://synthetic.test'});
Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), {act} = React, {createRoot} = req('react-dom/client'), ts = req('typescript');
let width = 390, dirty = false;
const flatten = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]));
const View = ({children, style, testID, ref}) => React.createElement('div', {ref, 'data-testid': testID, 'data-style': JSON.stringify(flatten(style))}, children);
const Text = ({children, accessibilityRole, style}) => React.createElement(accessibilityRole === 'header' ? 'h2' : 'span', {'data-text-style': JSON.stringify(flatten(style))}, children);
function TextField({label, value, onChangeText, onBlur, ref, editable, disabled, nativeID, multiline, ...rest}) {
  return React.createElement('label', null, label, React.createElement(multiline ? 'textarea' : 'input', {
    'aria-label': label, id: nativeID, value, ref, onBlur, disabled: disabled || editable === false,
    'aria-invalid': rest['aria-invalid'], 'aria-describedby': rest['aria-describedby'],
    onInput: event => onChangeText(event.target.value), onChange() {},
  }));
}
const Select = ({label, value, onChange, options, disabled, ref, id, onBlur}) => React.createElement('label', null, label,
  React.createElement('select', {'aria-label': label, id, ref, value, disabled, onBlur, onChange: event => onChange(event.target.value)},
    options.map(option => React.createElement('option', {key: option.value, value: option.value}, option.label))));
const DateField = ({label, value, onChange, disabled, ref, id, error, onBlur}) => React.createElement('label', null, label,
  React.createElement('input', {'aria-label': label, id, ref, value, disabled, onBlur, 'aria-invalid': !!error, onInput: event => onChange(event.target.value), onChange() {}}), error);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const result = {exports: {}};
  const text = ts.transpileModule(fs.readFileSync(file, 'utf8'), {fileName: file, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const resolve = name => {
    if (name === 'react-native') return {View, StyleSheet: {create: value => value}};
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewLeaveGuard: value => {dirty = value;}};
    if (name.endsWith('/theme')) return {chineseFont: 'sans-serif', colors: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16, xl: 24}, readingType: {body: {fontSize: 16, lineHeight: 26}, tool: {fontSize: 14, lineHeight: 22}}};
    if (name.endsWith('/ui')) return {AppButton: ({label, disabled, onPress}) => React.createElement('button', {disabled, onClick: onPress}, label), AppTextField: TextField, AppSelect: Select};
    if (name.endsWith('/DateTimeFields')) return {AppDateField: DateField};
    if (name.endsWith('/FormErrorSummary')) return {FormErrorSummary: ({entries}) => React.createElement('div', {'data-testid': 'errors'}, entries.map(entry => entry.message).join('；')), FormFieldMessage: ({id, error}) => error ? React.createElement('span', {id}, error) : null};
    if (!name.startsWith('.')) return req(name);
    const absolute = path.resolve(path.dirname(file), name);
    return load(fs.existsSync(absolute) ? absolute : fs.existsSync(absolute + '.ts') ? absolute + '.ts' : absolute + '.tsx');
  };
  new Function('require', 'module', 'exports', text)(resolve, result, result.exports); cache.set(file, result.exports); return result.exports;
}
const {ProfileForm} = load(path.join(root, 'src/components/profile/ProfileForm.tsx'));
const {emptyProfileForm} = load(path.join(root, 'src/profile-view-model.ts'));
const find = label => [...document.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === label);
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
async function input(label, value) {
  const node = find(label); assert.ok(node, label);
  await act(async () => {node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));});
  return node;
}
async function setup(extra = {}) {
  const container = document.createElement('div'); document.body.append(container); const renderer = createRoot(container), reviews = [], edits = [];
  let props = {initialValues: {...emptyProfileForm(), source: ' 家長提供 ', reason: ' 核對原話 '}, editable: true, canReview: true, draftOnly: false, onEdit: () => edits.push('edit'), onReview: value => reviews.push(value), ...extra};
  await act(async () => renderer.render(React.createElement(ProfileForm, props)));
  return {container, reviews, edits, async render(next, key) {props = {...props, ...next}; await act(async () => renderer.render(React.createElement(ProfileForm, {...props, key})));},
    async close() {await act(async () => renderer.unmount()); container.remove();}};
}

// Real RHF + Zod + React DOM, with host controls as ports; not Paper/browser layout evidence.
test('editor composes three semantic groups and preserves approximate raw values through review without saving', async () => {
  const h = await setup();
  try {
    assert.equal(document.querySelectorAll('[data-testid^="profile-editor-section-"]').length, 3);
    assert.ok(h.container.textContent.includes('年齡暫時未知')); assert.equal(find('出生日期（YYYY-MM-DD）'), undefined);
    await input('年齡資料', 'approximate');
    const original = await input('約數年齡原值', ' 約三個半 '); original.focus();
    await input('約數年齡截至日期（YYYY-MM-DD）', '2026-10-25');
    assert.equal(find('約數年齡原值'), original, 'Composition must not remount fields per edit');
    assert.equal(document.activeElement, original); assert.equal(dirty, true);
    await act(async () => button('預覽家庭共享內容').click());
    assert.equal(h.reviews.length, 1); assert.equal(h.reviews[0].ageRaw, ' 約三個半 '); assert.equal(h.reviews[0].ageAsOf, '2026-10-25');
    assert.equal(h.reviews[0].source, ' 家長提供 '); assert.ok(h.edits.length >= 3);
  } finally {await h.close();}
});

test('invalid required evidence focuses the first visible field and disabled/conflict inputs cannot review', async () => {
  const h = await setup({initialValues: emptyProfileForm()});
  try {
    await act(async () => button('預覽家庭共享內容').click());
    assert.equal(h.reviews.length, 0); assert.equal(document.activeElement, find('資料來源（由你描述）'));
    assert.ok(document.querySelector('[data-testid="errors"]').textContent.length > 0);
    await h.render({editable: false, canReview: false});
    assert.ok([...document.querySelectorAll('input,textarea,select')].every(node => node.disabled));
    assert.equal(button('預覽家庭共享內容').disabled, true);
  } finally {await h.close();}
});

test('keyed child reset discards the old editor values while unknown stays unknown', async () => {
  const h = await setup();
  try {
    await input('過敏資料（可空）', '上一位孩子的合成文字'); assert.equal(dirty, true);
    await h.render({initialValues: {...emptyProfileForm(), source: '新的來源', reason: '新的核對'}}, 'child-b');
    assert.equal(find('過敏資料（可空）').value, ''); assert.equal(dirty, false);
    assert.ok(h.container.textContent.includes('留空不代表「沒有」'));
    await act(async () => button('預覽家庭共享內容').click());
    assert.equal(h.reviews.at(-1).ageKind, 'unknown'); assert.equal(h.reviews.at(-1).allergies, '');
  } finally {await h.close();}
});

for (const viewport of [320, 390, 1024, 1440]) test(`editor ${viewport}px composition keeps mobile field pairs content-sized and text at 16px`, async () => {
  width = viewport;
  const h = await setup();
  try {
    const pairs = [...document.querySelectorAll('[data-style]')].filter(node => {
      const value = JSON.parse(node.dataset.style); return value.gap === 16 && value.minWidth === 0 && node.children.length === 2 && node.children[0].querySelector('input');
    });
    assert.ok(pairs.length >= 1);
    const interpretation = document.querySelector('[data-testid="profile-age-interpretation"]');
    for (const text of interpretation.querySelectorAll('[data-text-style]')) assert.equal(JSON.parse(text.dataset.textStyle).fontSize, 16);
    for (const pair of pairs) {
      const style = JSON.parse(pair.dataset.style);
      assert.equal(style.flexDirection, viewport >= 640 ? 'row' : undefined);
      const item = JSON.parse(pair.children[0].dataset.style);
      assert.equal(item.flex, viewport >= 640 ? 1 : undefined);
      assert.equal(item.height, undefined); assert.equal(item.minWidth, 0);
    }
  } finally {await h.close();}
});

test.after(() => dom.window.close());
