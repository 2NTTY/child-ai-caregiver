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
function render(loading) {
  return text(exports.CareRecordDetail({ detail: { record: { id: 'record', childId: 'child', title: 'Synthetic', current: { values: {}, version: 2 } },
    historyOpen: true, historyLoading: loading, history: [], hasMoreHistory: false }, actions: {}, canEdit: false, online: true }));
}
test('loading correction history never claims a first or oldest confirmed version', () => {
  const output = render(true); assert.match(output, /正在讀取更正歷史/); assert.doesNotMatch(output, /目前只有第一個|已到最早/);
});
test('settled empty correction history retains the truthful empty state', () => {
  const output = render(false); assert.match(output, /目前只有第一個/); assert.match(output, /已到最早/);
});
