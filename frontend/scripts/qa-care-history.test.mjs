import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const jsx = (type, props) => ({ type, props });
const theme = new Proxy({}, { get: () => new Proxy({}, { get: () => 1 }) });
const mocks = {
  react: { useRef: () => ({ current: null }), useState: value => [value, () => {}], useEffect() {} },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', Platform: { OS: 'web' }, StyleSheet: { create: value => value, hairlineWidth: 1 } },
  'react-native-paper': { Text: 'Text' }, '../../care-view-model': { careKindOptions: [] }, '../../theme': theme,
  '../../motion': { MotionDisclosure: 'Disclosure', MotionReveal: 'Reveal' }, '../AppStatusBadge': { AppStatusBadge: 'Badge' },
  '../ui': { AppButton: 'Button', AppSelectionTrigger: 'Trigger', SectionHeader: 'Header' },
};
const source = readFileSync(new URL('../src/components/care/CareRecordDetail.tsx', import.meta.url), 'utf8');
const exports = {}, compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function('require', 'exports', compiled)(name => { assert.ok(mocks[name], name); return mocks[name]; }, exports);
const text = tree => tree === null || tree === undefined || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
function render(detailOverrides = {}, online = true) {
  const calls = [], actions = { showHistory() { calls.push('initial'); }, loadOlderHistory() { calls.push('more'); } };
  const tree = exports.CareRecordDetail({ detail: { record: { id: 'record', childId: 'child', title: 'Synthetic', current: { values: {}, version: 2 } },
    historyOpen: true, historyLoading: false, history: [], hasMoreHistory: false, ...detailOverrides }, actions, canEdit: false, online });
  const buttons = [];
  function find(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(find); if (node.type === 'Button') buttons.push(node.props); find(node.props?.children); }
  find(tree); return { output: text(tree), buttons, calls };
}
test('loading correction history never claims a first or oldest confirmed version', () => {
  const { output } = render({ historyLoading: true }); assert.match(output, /正在讀取更正歷史/); assert.doesNotMatch(output, /目前只有第一個|已到最早/);
});
test('only successfully read first-version history confirms there are no earlier versions', () => {
  const { output } = render({ historyState: 'ready', record: { id: 'record', childId: 'child', title: 'Synthetic', current: { values: {}, version: 1 } } });
  assert.match(output, /目前只有第一個/); assert.match(output, /已到最早/);
});
test('unread or empty version-two history stays unconfirmed and offers a fresh read', () => {
  for (const historyState of [undefined, 'unread', 'ready']) {
    const view = render({ historyState }); assert.doesNotMatch(view.output, /目前只有第一個|已到最早/);
    view.buttons.find(button => button.label === '讀取更正歷史').onPress(); assert.deepEqual(view.calls, ['initial']);
  }
});
test('failed initial or older-page history stays unknown and retries the same page', () => {
  for (const historyRetryMore of [false, true]) {
    const view = render({ historyState: 'error', historyRetryMore });
    assert.match(view.output, /未能讀取更正歷史/); assert.doesNotMatch(view.output, /目前只有第一個|已到最早/);
    view.buttons.find(button => button.label === '重試讀取歷史').onPress(); assert.deepEqual(view.calls, [historyRetryMore ? 'more' : 'initial']);
    assert.equal(render({ historyState: 'error', historyRetryMore }, false).buttons.find(button => button.label === '重試讀取歷史').disabled, true);
  }
});

// Execute the actual request owner function with synthetic API ports; no browser or family data.
const ownerSource = readFileSync(new URL('../src/production/CareProfileDomains.tsx', import.meta.url), 'utf8');
const historyFunction = ownerSource.slice(ownerSource.indexOf('  async function careHistory('), ownerSource.indexOf('  async function profileHistory('));
function historyOwner(detail, history) {
  const careRef = { current: { detail, list: { message: null } } }, historyGeneration = { current: 0 }, careHistoryCursor = { current: 1 };
  const deps = { careRef, historyGeneration, careHistoryCursor, current: () => true, envRef: { current: { online: true } }, controller: () => new AbortController(),
    setCare: update => { careRef.current = update(careRef.current); }, read: (_key, control, action) => action(control.signal),
    careKey: ['synthetic'], childId: 'child', userId: 'user', api: { history }, careRevisionView: value => value, accessError: () => false, released() {} };
  const compiled = ts.transpileModule('const { '+Object.keys(deps).join(',')+' } = deps;\n'+historyFunction+'\nexports.load = careHistory;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = {}; new Function('deps', 'exports', compiled)(deps, module); return { load: module.load, state: () => careRef.current };
}
for (const failure of ['HTTP', 'parse']) test(`${failure} history failure sets the actual owner error state and a successful retry clears it`, async () => {
  let fail = true; const owner = historyOwner({ record: { id: 'record', current: { version: 2 } }, historyLoading: false, history: [], hasMoreHistory: false }, async () => {
    if (fail) throw new Error(failure); return { revisions: [], nextBeforeVersion: null };
  });
  await owner.load(false); assert.equal(owner.state().detail.historyState, 'error'); assert.equal(owner.state().detail.historyLoading, false);
  assert.equal(owner.state().detail.historyRetryMore, false); assert.equal(owner.state().detail.history.length, 0); assert.equal(owner.state().list.message, null);
  fail = false; await owner.load(false); assert.equal(owner.state().detail.historyState, 'ready'); assert.equal(owner.state().detail.historyRetryMore, false);
});
test('older-page failure preserves loaded revisions and the original retry cursor', async () => {
  const revision = { version: 1 }; const owner = historyOwner({ record: { id: 'record', current: { version: 3 } }, historyState: 'ready', historyLoading: false, history: [revision], hasMoreHistory: true }, async (_child, _record, before) => {
    assert.equal(before, 1); throw new Error('HTTP');
  });
  await owner.load(true); assert.equal(owner.state().detail.historyState, 'error'); assert.equal(owner.state().detail.historyRetryMore, true);
  assert.deepEqual(owner.state().detail.history, [revision]);
});
