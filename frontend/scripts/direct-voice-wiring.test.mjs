import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Real presentation/adapters with controlled media ports; no microphone, browser or upload.
const jsx = (type, props) => ({ type, props });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush(h) { for (let i = 0; i < 10; i++) await Promise.resolve(); h.render(); }
function setup(platform) {
  const permissions = [], controllers = [], calls = { record: 0, stop: 0, pick: [], draft: 0, disposed: 0 };
  let pathname = '/', appStateChange;
  const attachment = () => ({ id: 'synthetic-voice', kind: 'voice', localUri: 'synthetic://voice', bytes: 100,
    fileName: 'synthetic.m4a', mimeType: 'audio/mp4', dispose: () => calls.disposed++ });
  const recorder = { uri: 'synthetic://recorder', prepareToRecordAsync: async () => {}, record() { calls.record++; }, stop: async () => { calls.stop++; } };
  const theme = { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: {}, mobileLayout: {} };
  const draft = { agentDraftScope: 'synthetic-account:child', agentAttachments: [], chatDraft: 'preserved text', actions: {},
    addAgentAttachment: value => { calls.pick.push(value); return true; }, openAgentDraft: () => calls.draft++ };
  const mocks = {
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value }, Platform: { OS: platform, select: values => values[platform] ?? values.default },
      AppState: { currentState: 'active', addEventListener(_name, callback) { appStateChange = callback; return { remove() {} }; } },
      Keyboard: { addListener: () => ({ remove() {} }) } },
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children },
    'expo-router': { usePathname: () => pathname },
    'expo-audio': { RecordingPresets: { HIGH_QUALITY: { android: {} } }, useAudioRecorder: () => recorder,
      requestRecordingPermissionsAsync() { const pending = deferred(); permissions.push(pending); return pending.promise; }, setAudioModeAsync: async () => {} },
    'expo-file-system': { File: class { exists = true; delete() {} } },
    './native-voice-file': { copyNativeVoice: async () => attachment() },
    './local-voice-capture': { createLocalVoiceCapture(_ports, onState, onReady) {
      const controller = { starts: 0, cancels: 0, pending: false,
        start() { this.starts++; this.pending = true; onState('permission'); },
        grant() { if (this.pending) { this.pending = false; calls.record++; onState('recording'); } },
        stop() { calls.stop++; onState('ready'); onReady(attachment()); },
        cancel() { this.pending = false; this.cancels++; },
        lateReady() { onReady(attachment()); },
      }; controllers.push(controller); return controller;
    } },
    '../../theme': theme,
    './LocalAudioPreview': { LocalAudioPreview: 'AudioPreview' },
    './AssistantAttachmentPicker': { AssistantAttachmentPicker: 'AudioPicker' },
    './AssistantInputDialog': { AssistantInputDialog: 'InputDialog' },
    './AssistantAttachmentPreview': { AssistantAttachmentPreview: 'AttachmentPreview' },
    './AgentInputToolbar': { AgentInputToolbar: 'InputToolbar', AgentVoiceControl: 'VoiceControl' },
    './ChatComposerInput': { ChatComposerInput: 'Input' },
    '../useInteractionDensity': { useInteractionDensity: () => false },
    '../../assistant-draft': { canPreviewAssistantDraft: () => true, photoAttachment: value => value },
    '../../preview/PreviewContext': { usePreview: () => draft },
    '../../motion': { MotionDisclosure: ({ expanded, children }) => expanded ? children : null, MotionEntrance: ({ children }) => children },
    '../photos/PhotoFilePicker': { PhotoFilePicker: ({ renderTrigger, disabled }) => renderTrigger({ disabled, reading: false, onPress() {} }) },
    '../navigation/DirectionalPressable': { DirectionalPressable: 'DirectionalPressable' },
    '../AppIcon': { AppIcon: 'Icon' },
    '../AppDialog': { AppDialog: Object.assign(({ visible, children }) => visible ? children : null,
      { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions' }) },
    '../AppScrollView': { AppScrollView: 'ScrollView' },
    '../appearance/BackgroundSurface': { BackgroundSurface: ({ children }) => children },
    './CornerCaptureSurface': { CornerCaptureSurface: 'Corner' },
  };
  const h = harness(mocks);
  h.react.useImperativeHandle = (ref, create, deps) => h.react.useLayoutEffect(() => {
    const handle = create(); if (ref) ref.current = handle;
    return () => { if (ref?.current === handle) ref.current = null; };
  }, deps);
  const capture = h.load(`src/components/agent/VoiceCapture${platform === 'web' ? '.web' : ''}.tsx`);
  mocks['./VoiceCapture'] = capture;
  const { AgentComposer } = h.load('src/components/agent/AgentComposer.tsx');
  const { MobileQuickInputDock } = h.load('src/components/agent/MobileQuickInputDock.tsx');
  const button = label => h.hosts().find(node => node.props.label === label);
  return { h, calls, controllers, permissions, attachment, button,
    composer(enabled = true) { h.render(h.jsx(AgentComposer, { enabled, compact: true, draft: draft.chatDraft, attachments: [], onChangeDraft() {},
      onPreview() { throw new Error('No send is authorized'); }, onSources() {}, onAddAttachment: draft.addAgentAttachment, onRemoveAttachment() {} })); },
    dock() { h.render(h.jsx(MobileQuickInputDock, {})); }, route(value) { pathname = value; },
    async grant() { if (platform === 'web') controllers[0].grant(); else permissions.at(-1).resolve({ granted: true }); await flush(h); },
    background() { appStateChange?.('background'); h.render(); },
  };
}

test('composer voice click starts once in place, then stops for preview and explicit draft adoption on both platforms', async () => {
  const originals = ['navigator', 'MediaRecorder', 'isSecureContext', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperties(globalThis, {
    navigator: { configurable: true, value: { mediaDevices: { getUserMedia() { throw new Error('Real microphone is forbidden'); } } } },
    MediaRecorder: { configurable: true, value: class {} }, isSecureContext: { configurable: true, value: true },
    document: { configurable: true, value: { hidden: false, addEventListener() {}, removeEventListener() {} } },
  });
  try {
    for (const platform of ['web', 'android']) {
      const s = setup(platform); s.composer();
      assert.equal(s.calls.record, 0); assert.equal(s.permissions.length, 0);
      assert.equal(s.h.node('voice-capture'), undefined, 'an ordinary composer mount stays idle');
      const voice = s.h.hosts().find(node => node.type === 'VoiceControl');
      voice.props.onPress(); voice.props.onPress(); s.h.render();
      assert.equal(platform === 'web' ? s.controllers[0].starts : s.permissions.length, 1);
      assert.equal(s.h.hosts().find(node => node.type === 'InputDialog').props.kind, null);
      assert.ok(s.button('取消錄音')); assert.equal(s.calls.pick.length, 0);
      assert.equal(s.h.hosts().find(node => node.props.accessibilityLabel === '預覽輸入').props.disabled, true);
      await s.grant(); assert.equal(s.calls.record, 1); assert.ok(s.h.node('voice-recording-time'));
      s.button('停止並試聽').props.onPress(); await flush(s.h);
      assert.ok(s.h.hosts().find(node => node.type === 'AudioPreview')); assert.equal(s.calls.pick.length, 0);
      const stops = s.calls.stop;
      s.button('加入未送出草稿').props.onPress(); await flush(s.h);
      assert.equal(s.calls.pick.length, 1); assert.equal(s.calls.disposed, 0, 'the draft receives ownership of the local audio');
      if (platform === 'android') assert.equal(s.calls.stop, stops, 'adopting a completed clip does not start another recorder stop');
      assert.equal(s.h.node('voice-capture'), undefined);
      assert.equal(s.h.hosts().find(node => node.type === 'Input').props.value, 'preserved text');
      s.h.unmount(); await flush(s.h);
    }
  } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

test('homepage voice uses the same in-place capture and cancels pending permission or route departure without adopting audio', async () => {
  const originals = ['navigator', 'MediaRecorder', 'isSecureContext', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperties(globalThis, {
    navigator: { configurable: true, value: { mediaDevices: { getUserMedia() { throw new Error('Real microphone is forbidden'); } } } },
    MediaRecorder: { configurable: true, value: class {} }, isSecureContext: { configurable: true, value: true },
    document: { configurable: true, value: { hidden: false, addEventListener() {}, removeEventListener() {} } },
  });
  try {
    for (const platform of ['web', 'android']) {
      const s = setup(platform); s.dock();
      // Use the existing voice-direction intent; native DOM menu hit testing is outside this harness.
      s.h.node('mobile-quick-camera').props.onGestureEnd(80, -80, true); s.h.render();
      assert.ok(s.h.node('voice-capture')); assert.equal(s.h.hosts().find(node => node.type === 'InputDialog').props.kind, null);
      s.button('取消錄音').props.onPress(); await s.grant();
      assert.equal(s.calls.record, 0); assert.equal(s.calls.pick.length, 0); assert.equal(s.calls.draft, 0);
      s.h.node('mobile-quick-camera').props.onGestureEnd(80, -80, true); s.h.render();
      await s.grant(); assert.equal(s.calls.record, 1);
      if (platform === 'android') {
        s.background(); await flush(s.h);
        const picker = s.h.hosts().find(node => node.type === 'AudioPicker');
        assert.ok(picker); assert.equal(picker.props.disabled, false, 'returning from a system picker keeps existing-audio selection available');
        picker.props.onPick(s.attachment()); s.h.render();
        assert.equal(s.calls.pick.length, 1); assert.equal(s.calls.draft, 1);
        assert.equal(s.h.node('voice-capture'), undefined);
        s.h.node('mobile-quick-camera').props.onGestureEnd(80, -80, true); s.h.render(); await s.grant();
      }
      const adopted = s.calls.pick.length;
      s.route('/chat'); s.dock(); await flush(s.h);
      assert.equal(s.h.node('voice-capture'), undefined); assert.equal(s.calls.pick.length, adopted);
      if (platform === 'web') { assert.ok(s.controllers[0].cancels > 0); s.controllers[0].lateReady(); assert.equal(s.calls.disposed, 1); }
      else assert.ok(s.calls.stop > 0);
      s.h.unmount();
    }
  } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});
