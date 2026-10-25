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
const theme = load('src/theme.ts');
const presentation = load('src/components/chat/chat-presentation.ts');
function load(relative) {
  const filename = path.resolve(root, relative);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  const localRequire = name => name === 'react' ? {useState: value => [value, () => {}], useRef: value => ({current: value}), useEffect() {}}
    : name === 'react/jsx-runtime' ? require(name)
    : name === 'react-native' ? {Platform: {OS: 'web', select: value => value.web ?? value.default}, StyleSheet: {create: value => value}, Pressable: 'Pressable', View: 'View', Keyboard: {}}
    : name === 'react-native-paper' ? {Portal: 'Portal', Text: 'Text', MD3LightTheme: {colors: {}, fonts: {}}, configureFonts: value => value}
    : name.endsWith('/theme') ? theme
    : name.endsWith('/chat-presentation') ? presentation
    : name.endsWith('/useInteractionDensity') ? {useInteractionDensity: () => false}
    : name.endsWith('/assistant-draft') ? {canPreviewAssistantDraft: ({text}) => !!text.trim(), photoAttachment: value => value}
    : new Proxy({}, {get: (_target, key) => String(key)});
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
const {AgentComposer} = load('src/components/agent/AgentComposer.tsx');
const {AgentInputToolbar} = load('src/components/agent/AgentInputToolbar.tsx');
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)];
const idle = control => flatten(control.props.style({pressed: false, hovered: false, focused: false}));
const source = relative => readFileSync(path.join(root, relative), 'utf8');
const baseProps = {enabled: true, compact: false, draft: '', attachments: [], onChangeDraft() {}, onPreview() {}, onSources() {}, onAddAttachment() {}, onRemoveAttachment() {}};

test('composer remains a restrained two-layer panel with the existing input limits', () => {
  const panel = nodes(AgentComposer(baseProps)).find(node => node.props?.testID === 'chat-composer-panel');
  const style = flatten(panel.props.style);
  assert.equal(style.borderWidth, 1);
  assert.equal(style.borderColor, theme.colors.controlOutline);
  assert.equal(style.borderRadius, 18);
  assert.equal(style.paddingHorizontal, 8);
  assert.equal(style.paddingVertical, 4);
  assert.equal(style.backgroundColor, theme.colors.controlSurface);
  assert.equal(presentation.chatLayout.inputMinHeight, 48);
  assert.equal(presentation.chatLayout.inputMaxHeight, 168);
  assert.match(source('src/components/agent/ChatComposerInput.web.tsx'), /padding: "8px 8px 4px"/);
});

test('send circle is unoutlined yellow and hover or press affects only its own surface', () => {
  for (const compact of [false, true]) for (const enabled of [false, true]) for (const draft of ['', 'Synthetic draft']) {
    const tree = AgentComposer({...baseProps, compact, enabled, draft});
    const send = nodes(tree).find(node => node.props?.accessibilityLabel === '預覽輸入');
    const available = enabled && !!draft;
    const normal = idle(send);
    assert.equal(send.props.disabled, !available);
    assert.equal(send.props.accessibilityState.disabled, !available);
    assert.equal(normal.width, compact ? 48 : 40);
    assert.equal(normal.height, compact ? 48 : 40);
    assert.equal(normal.backgroundColor, 'transparent');
    assert.equal(normal.borderWidth, 0);
    for (const state of [{pressed: true}, {hovered: true}]) {
      assert.equal(flatten(send.props.style(state)).backgroundColor, 'transparent');
      assert.equal(flatten(send.props.style(state)).borderWidth, 0);
      const circle = flatten(send.props.children(state).props.style);
      assert.equal(circle.width, 36); assert.equal(circle.height, 36);
      assert.equal(circle.borderWidth ?? 0, 0);
      assert.equal(circle.backgroundColor, available ? theme.colors.accentPressed : theme.colors.accent);
      assert.equal(circle.opacity ?? 1, available ? 1 : .35);
    }
    const focus = flatten(send.props.style({focused: true}));
    assert.equal(focus.borderWidth, available ? 1 : 0);
    assert.equal(focus.backgroundColor, 'transparent');
  }
});

test('four tools stay transparent at rest with unchanged 40 or 48 pixel hit targets', () => {
  for (const compact of [false, true]) for (const disabled of [false, true]) {
    const toolbar = AgentInputToolbar({compact, disabled, onFiles() {}, onVoice() {}, onPickPhoto() {}, onPhotoError() {}});
    assert.equal(toolbar.props.style.gap, 0);
    const children = toolbar.props.children;
    const photo = children[0].props.renderTrigger({disabled, reading: false, onPress() {}});
    const controls = [photo, ...children.slice(1)].map(child => child.type(child.props));
    controls.push(nodes(AgentComposer({...baseProps, compact, enabled: !disabled})).find(node => node.props?.testID === 'composer-suggestions-toggle'));
    for (const control of controls) {
      const style = idle(control);
      assert.equal(style.backgroundColor, 'transparent'); assert.equal(style.borderWidth, 0);
      assert.equal(style.width, compact ? 48 : 40); assert.equal(style.height, compact ? 48 : 40);
      assert.equal(control.props.disabled, disabled);
      const focus = flatten(control.props.style({focused: true}));
      assert.equal(focus.borderWidth, disabled ? 0 : 1);
      const pressed = flatten(control.props.style({pressed: true}));
      assert.equal(pressed.opacity ?? 1, disabled ? .5 : 1);
    }
  }
});

test('input keeps its autosize and IME guards on a stable textarea', () => {
  const web = source('src/components/agent/ChatComposerInput.web.tsx');
  assert.match(web, /useLayoutEffect\(\(\) => \{ if \(input.current\) fitInput\(input.current, maxHeight\); \}, \[props.value, maxHeight\]\)/);
  assert.match(web, /event.shiftKey \|\| composing.current \|\| event.nativeEvent.isComposing \|\| event.nativeEvent.keyCode === 229/);
  assert.match(web, /if \(!props.disabled && \(props.canSubmit \?\? !!props.value.trim\(\)\)\) props.onSubmit\(\)/);
  assert.doesNotMatch(web, /<textarea[^>]*\bkey=/);
});


test('short viewport keeps every control, draft, attachment and hint in a wrapping bounded layout', () => {
  const attachments = [{id: 'synthetic-file', kind: 'file', fileName: '公園清單.txt', bytes: 80, mimeType: 'text/plain'}];
  const onChangeDraft = () => {}, onRemoveAttachment = () => {};
  const tree = AgentComposer({...baseProps, viewportLayout: 'short', compact: true, draft: 'Synthetic multiline\n'.repeat(12), attachments, inputHint: '按送出會保存原檔，並交給已選模型。', onChangeDraft, onRemoveAttachment});
  const all = nodes(tree), root = all.find(n => n.props?.testID === 'chat-composer'), entry = all.find(n => n.props?.testID === 'composer-entry-layout');
  assert.equal(flatten(root.props.style).marginTop, 0);
  assert.equal(flatten(entry.props.style).flexDirection, 'row'); assert.equal(flatten(entry.props.style).flexWrap, 'wrap');
  const input = all.find(n => n.type === 'ChatComposerInput'); assert.equal(input.props.maxHeight, 72); assert.equal(input.props.onChangeText, onChangeDraft);
  const preview = all.find(n => n.type === 'AssistantAttachmentPreview'); assert.equal(preview.props.attachments, attachments); assert.equal(preview.props.onRemove, onRemoveAttachment);
  const context = all.find(n => n.props?.testID === 'composer-attachment-context'); assert.equal(context.type, 'AppScrollView'); assert.equal(flatten(context.props.style).maxHeight, 64); assert.equal(context.props.keyboardShouldPersistTaps, 'handled');
  assert.ok(nodes(context).some(n => n.type === 'Text' && n.props.children === '按送出會保存原檔，並交給已選模型。'));
  assert.ok(all.some(n => n.type === 'AgentInputToolbar')); assert.ok(all.some(n => n.type === 'AgentVoiceControl'));
  const send = all.find(n => n.props?.accessibilityLabel === '預覽輸入'); assert.equal(idle(send).width, 48); assert.equal(idle(send).height, 48);
});
