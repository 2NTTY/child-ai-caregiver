import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const tokens = {chatColors: {hover: 'hover', secondary: 'secondary', send: 'yellow', onSend: 'on-yellow', outline: 'outline', surface: 'surface'}, chatLayout: {controlSize: 40, compactControlSize: 48, maxWidth: 800, composerOverlap: 32}, chatType: {}};
const deps = {
  react: {useState: value => [value, () => {}], useRef: value => ({current: value}), useEffect() {}},
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': {Platform: {OS: 'web'}, Keyboard: {}, Pressable: 'Pressable', View: 'View', StyleSheet: {create: value => value}},
  'react-native-paper': {Portal: 'Portal', Text: 'Text'},
};
function load(filename) {
  const source = readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}, reportDiagnostics: true});
  assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = {exports: {}};
  new Function('require', 'module', 'exports', result.outputText)(name => deps[name]
    ?? (name.endsWith('/chat-presentation') ? tokens : undefined)
    ?? (name.endsWith('/theme') ? {colors: {}, mobileLayout: {touchTarget: 48}, radius: {}, spacing: {}} : undefined)
    ?? (name.endsWith('/useInteractionDensity') ? {useInteractionDensity: () => false} : undefined)
    ?? (name.endsWith('/assistant-draft') ? {canPreviewAssistantDraft: ({text}) => !!text.trim(), photoAttachment: value => value} : undefined)
    ?? new Proxy({}, {get: (_target, key) => String(key)}), module, module.exports);
  return module.exports;
}
const current = load(path.join(root, 'src/components/agent/AgentComposer.tsx'));
const old = load(fileURLToPath(new URL('./baseline/AgentComposer.tsx', import.meta.url)));
const toolbar = load(path.join(root, 'src/components/agent/AgentInputToolbar.tsx'));
const oldToolbar = load(fileURLToPath(new URL('./baseline/AgentInputToolbar.tsx', import.meta.url)));
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)];
const normalize = value => {
  if (typeof value === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['style', '_owner', '_store'].includes(key)).map(([key, next]) => [key, key === 'type' && typeof next === 'function' ? next.name : normalize(next)]));
};
const idle = control => flatten(control.props.style({pressed: false, hovered: false, focused: false}));
const checks = [];
for (const compact of [false, true]) for (const enabled of [false, true]) for (const draft of ['', 'Hello']) {
  const props = {compact, enabled, draft, attachments: [], onChangeDraft() {}, onPreview() {}, onSources() {}, onAddAttachment() {}, onRemoveAttachment() {}};
  const tree = current.AgentComposer(props);
  assert.deepEqual(normalize(tree), normalize(old.AgentComposer(props)), 'Non-style composer structure and handlers remain unchanged');
  const all = nodes(tree), controls = all.filter(node => node.type === 'Pressable').slice(0, 2);
  for (const control of controls) {
    assert.equal(idle(control).backgroundColor, 'transparent');
    assert.equal(idle(control).borderWidth, 0);
    assert.equal(idle(control).width, compact ? 48 : 40);
    assert.equal(idle(control).height, compact ? 48 : 40);
    for (const state of ['hovered', 'focused']) assert.equal(flatten(control.props.style({pressed: false, [state]: true})).backgroundColor, control.props.disabled ? 'transparent' : 'hover');
  }
  const panel = all.find(node => node.props?.testID === 'chat-composer-panel');
  assert.equal(flatten(panel.props.style).borderWidth, 1);
  const send = controls[1];
  assert.equal(send.props.disabled, !enabled || !draft);
  const circle = flatten(send.props.children.props.style);
  assert.equal(circle.backgroundColor, 'yellow'); assert.equal(circle.width, 32); assert.equal(circle.height, 32);
  assert.equal(circle.borderWidth, 1); assert.equal(circle.opacity, send.props.disabled ? .35 : undefined);
  checks.push(`Composer compact=${compact}, enabled=${enabled}, draft=${!!draft}: transparent controls, original target/panel/send/handlers`);
}
for (const compact of [false, true]) for (const disabled of [false, true]) {
  let files = 0, voice = 0, camera = 0;
  const props = {compact, disabled, onFiles() {files++;}, onVoice() {voice++;}, onPickPhoto() {}, onPhotoError() {}};
  const tree = toolbar.AgentInputToolbar(props);
  assert.deepEqual(normalize(tree), normalize(oldToolbar.AgentInputToolbar(props)), 'Toolbar wiring remains unchanged');
  const children = tree.props.children;
  const cameraElement = children[0].props.renderTrigger({disabled, reading: false, onPress() {camera++;}, unavailableReason: undefined});
  const controls = [cameraElement, ...children.slice(1)].map(element => element.type(element.props));
  for (const control of controls) {
    assert.equal(idle(control).backgroundColor, 'transparent'); assert.equal(idle(control).borderWidth, 0);
    assert.equal(idle(control).width, compact ? 48 : 40); assert.equal(idle(control).height, compact ? 48 : 40);
    assert.equal(control.props.disabled, disabled); assert.equal(control.props.accessibilityState.disabled, disabled);
    for (const state of ['pressed', 'hovered', 'focused']) assert.equal(flatten(control.props.style({pressed: false, [state]: true})).backgroundColor, disabled ? 'transparent' : 'hover');
    if (!disabled) control.props.onPress();
  }
  assert.deepEqual([camera, files, voice], disabled ? [0, 0, 0] : [1, 1, 1]);
  checks.push(`Toolbar compact=${compact}, disabled=${disabled}: transparent controls, hover/focus/press, original target and callbacks`);
}
const result = {passed: true, cases: checks.length, checks, limits: ['Mocked component and source-invariant checks only', 'No browser, full build, Git, publication, real media permissions or native-device tests']};
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
