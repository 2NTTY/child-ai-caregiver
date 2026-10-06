import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
const paperDialog = Object.assign(function PaperDialog() {}, { Title: 'Title', Content: 'Content', Actions: 'Actions', ScrollArea: 'ScrollArea', Icon: 'Icon' });
function loadAppDialog() {
  const filename = new URL('../src/components/AppDialog.tsx', import.meta.url);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return { useRef: value => ({ current: value }), useLayoutEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { Modal: 'NativeModal', View: 'View', StyleSheet: { create: value => value }, Animated: { Value: class { interpolate() { return 0; } } } };
    if (name === '../motion') return { useMotionPreferences: () => ({ enabled: false }), MotionBackdrop: 'Backdrop', motionTokens: { dialog: { distance: 16, duration: 200 } } };
    if (name === '../motion/MotionPaperScope') return { MotionPaperScope: 'PaperScope' };
    if (name === '../motion/useModalBackdrop') return { useModalBackdrop: () => ({}) };
    if (name === 'react-native-paper') return { Dialog: paperDialog };
    if (name === '../theme') return { chineseFont: '', colors: {}, radius: {}, spacing: {}, typeScale: {} };
    assert.fail(`Unexpected AppDialog dependency: ${name}`);
  }, module, module.exports);
  return module.exports.AppDialog;
}
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map(item => find(item, type)).find(Boolean) ?? null;
  return tree.type === type ? tree : find(tree.props?.children, type);
}

test('AppDialog gives the actual native modal its accessible name without changing Paper/default props', () => {
  const AppDialog = loadAppDialog(); let cancelled = 0;
  const onDismiss = () => cancelled++;
  const tree = AppDialog({ visible: true, accessibilityLabel: '確認結束關注：日常遊戲與表達', onDismiss, children: 'Confirmation content' });
  assert.equal(tree.type, 'NativeModal');
  assert.equal(tree.props.accessibilityLabel, '確認結束關注：日常遊戲與表達');
  assert.equal(tree.props.onRequestClose, onDismiss);
  assert.equal(find(tree, paperDialog).props.accessibilityLabel, undefined);
  tree.props.onRequestClose(); assert.equal(cancelled, 1);
  assert.equal(AppDialog({ visible: false, children: null }).props.accessibilityLabel, undefined);
});

test('installed RN Web ModalContent preserves the name and sends Escape to cancellation only while active', () => {
  const filename = require.resolve('react-native-web/dist/exports/Modal/ModalContent.js');
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} }, listeners = new Map(), cleanups = [];
  const document = { addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); } };
  new Function('require', 'module', 'exports', 'document', code)(name => {
    if (name === 'react') return { forwardRef: render => render, useEffect: effect => cleanups.push(effect()), useMemo: factory => factory(), createElement: (type, props, ...children) => jsx(type, { ...props, children }) };
    if (name === '../View') return { __esModule: true, default: 'NativeView' };
    if (name === '../StyleSheet') return { __esModule: true, default: { create: value => value } };
    if (name.endsWith('/canUseDom')) return { __esModule: true, default: true };
    return require(name);
  }, module, module.exports, document);
  let cancelled = 0, stopped = 0;
  const tree = module.exports.default({ active: true, transparent: true, accessibilityLabel: '確認結束關注：日常遊戲與表達', onRequestClose: () => cancelled++, children: null }, null);
  assert.equal(tree.props.role, 'dialog'); assert.equal(tree.props['aria-modal'], true);
  assert.equal(tree.props.accessibilityLabel, '確認結束關注：日常遊戲與表達');
  listeners.get('keyup')({ key: 'Enter', stopPropagation: () => stopped++ }); assert.equal(cancelled, 0);
  listeners.get('keyup')({ key: 'Escape', stopPropagation: () => stopped++ }); assert.equal(cancelled, 1); assert.equal(stopped, 1);
  cleanups.splice(0).forEach(cleanup => cleanup?.()); assert.equal(listeners.size, 0);
  module.exports.default({ active: false, onRequestClose: () => cancelled++, children: null }, null);
  listeners.get('keyup')({ key: 'Escape', stopPropagation: () => stopped++ }); assert.equal(cancelled, 1);
});
