import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
function harness() {
  const state = []; let cursor = 0, values;
  const react = {useRef: value => {const index = cursor++; return state[index] ??= {current: value};}, useState: initial => {const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], next => {state[index] = typeof next === 'function' ? next(state[index]) : next;}];}, useEffect() {}, useLayoutEffect() {}};
  const form = {useForm: ({defaultValues}) => {values ??= structuredClone(defaultValues); return {control: {}, handleSubmit: callback => () => callback(values), setFocus() {}, setValue(name, value) {values[name] = value;}};}, useWatch: () => values, useFormState: () => ({isDirty: true, errors: {}}), useFieldArray: ({name}) => ({fields: values[name].map((item, index) => ({...item, id: `${name}-${index}`})), append() {}, remove() {}}), Controller: 'Controller'};
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
    const module = {exports: {}};
    function resolve(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime' || name === 'zod' || name === 'luxon') return require(name);
      if (name === 'react-native') return {Platform: {OS: 'web'}, View: 'View', StyleSheet: {create: value => value}};
      if (name === 'react-native-paper') return {Text: 'Text', HelperText: 'HelperText'};
      if (name === 'react-hook-form') return form;
      if (name === '@hookform/resolvers/zod') return {zodResolver: () => undefined};
      if (name.endsWith('/summary-form')) return load('src/components/summary/summary-form.ts');
      if (name.endsWith('/summary-view-model') || name.endsWith('/summary-view-model.ts')) return load('src/summary-view-model.ts');
      if (name.endsWith('/summary-styles')) return {summaryStyles: {hidden: {display: 'none'}}};
      if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewLeaveGuard() {}};
      return new Proxy({}, {get: (_object, name) => String(name)});
    }
    new Function('require', 'module', 'exports', output + (relative.endsWith('PreparationCard.tsx') ? '\nexports.PreparationForm = PreparationForm;' : ''))(resolve, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  const {PreparationForm} = load('src/components/summary/PreparationCard.tsx');
  const {PreparationSheet} = load('src/components/summary/PreparationSheet.tsx');
  return {render(props) {cursor = 0; return PreparationForm(props);}, sheet: PreparationSheet, values: () => values};
}
function nodes(tree) {if (!tree || typeof tree !== 'object') return []; const children = Array.isArray(tree) ? tree : tree.props?.children; return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];}
const find = (tree, predicate) => nodes(tree).find(predicate);
const label = (tree, value) => find(tree, node => node.props?.label === value);
const period = {startDay: '2026-10-05', period: 'week', timeZone: 'Asia/Hong_Kong'};
const base = {scopeKey: 'child-a', childName: 'A', online: true, access: 'editable', readFailed: false, busy: false, pending: null, dirty: false, operation: 'none', formEpoch: 1, confirmationEpoch: 1,
  page: {canManage: true, period, basisVersion: 'original', appointments: [], records: [], missing: {unknownEventTime: 0}, preparation: {version: 1, appointmentTaskId: null, questions: ['原問題'], checklist: [{text: '原準備', done: false}], reviewed: false, reviewedBasis: null}, reviewCurrent: false}};
function props(model = structuredClone(base)) {let discarded = 0, saved = 0; return {model, actions: {markDirty() {}, discard() {discarded++;}, save() {saved++;}}, counts: () => ({discarded, saved})};}

test('preparation opens as a sheet, explicit modify opens the existing mounted editor', () => {
  const h = harness(), p = props(); const initial = h.render(p);
  const editor = find(initial, node => node.props?.testID === 'preparation-editor');
  assert.equal(flatten(editor.props.style).display, 'none');
  assert.equal(editor.props['aria-hidden'], true);
  const sheet = find(initial, node => node.type === 'PreparationSheet');
  assert.ok(sheet); sheet.props.onEdit();
  const changed = h.render(p), visible = find(changed, node => node.props?.testID === 'preparation-editor');
  assert.equal(visible.props['aria-hidden'], false);
  assert.equal(find(changed, node => node.type === 'PreparationSheet'), undefined);
  assert.deepEqual(p.counts(), {discarded: 0, saved: 0});
});

test('returning to the sheet preserves raw draft and does not discard, save or reset its basis', () => {
  const h = harness(), p = props(); let tree = h.render(p);
  find(tree, node => node.type === 'PreparationSheet').props.onEdit();
  h.values().questions[0].text = '  未保存問題  '; p.model.dirty = true;
  tree = h.render(p); label(tree, '返回準備單（保留草稿）').props.onPress();
  tree = h.render(p); const sheet = find(tree, node => node.type === 'PreparationSheet');
  assert.equal(sheet.props.values.questions[0].text, '  未保存問題  ');
  assert.deepEqual(p.counts(), {discarded: 0, saved: 0});
  assert.equal(flatten(find(tree, node => node.props?.testID === 'preparation-editor').props.style).display, 'none');
});

test('unknown and changed-basis preparation keeps recovery visible and submission unavailable', () => {
  const h = harness(), p = props(); h.render(p);
  p.model.dirty = true; p.model.pending = {reference: 'original-request', confirmed: false}; p.model.readFailed = true; p.model.operation = 'unknown'; p.model.page.basisVersion = 'new-source';
  const tree = h.render(p);
  assert.ok(label(tree, '原保存結果未知 · 先查核'));
  assert.equal(label(tree, '確認保存家庭共享到診準備').props.disabled, true);
  assert.equal(label(tree, '放棄草稿並載入已保存準備').props.disabled, true);
  assert.equal(find(tree, node => node.type === 'PreparationSheet').props.editable, false);
  assert.equal(p.model.pending.reference, 'original-request');
  assert.deepEqual(p.counts(), {discarded: 0, saved: 0});
});

test('sheet uses existing questions and sources, states missing appointment explicitly, and blocks Agent while dirty', () => {
  const h = harness(), p = props(); h.render(p);
  const sheet = h.sheet({model: p.model, values: h.values(), editable: true, onEdit() {}, onAgent() {}});
  const plain = nodes(sheet).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []).join(' ');
  assert.ok(plain.includes('尚未指定預約'));
  assert.ok(plain.includes('原問題'));
  assert.ok(plain.includes('目前沒有可展示的觀察來源'));
  assert.equal(label(sheet, '請 Agent 整理／更新').props.disabled, false);
  const dirty = h.sheet({model: {...p.model, dirty: true}, values: h.values(), editable: true, onEdit() {}, onAgent() {}});
  assert.equal(label(dirty, '請 Agent 整理／更新').props.disabled, true);
  assert.equal(nodes(sheet).some(node => ['Controller', 'AppTextField', 'AppSelect', 'AppCheckbox'].includes(node.type)), false);
});

test('Summary reuses the unsent assistant intent and leaves explicit save/discard controllers intact', () => {
  const screen = readFileSync(path.join(root, 'src/screens/LegacySummaryRecovery.tsx'), 'utf8');
  const source = readFileSync(path.join(root, 'src/components/summary/PreparationCard.tsx'), 'utf8');
  assert.ok(screen.includes('actions.prepareQuestion('));
  assert.ok(!screen.includes('setChatDraft('));
  assert.ok(source.includes('<PreparationForm key={model.formEpoch}'));
  assert.ok(source.includes('onPress={actions.discard}'));
  assert.ok(source.includes('actions.save(input,'));
});
