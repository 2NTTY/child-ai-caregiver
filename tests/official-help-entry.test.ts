import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import {
  ALL_OFFICIAL_HELP_IDS,
  matchOfficialHelpForText,
  OFFICIAL_HELP,
  OFFICIAL_HELP_ENTRY_COPY,
} from '../src/shared/agent-feedback.ts';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function loadModule(entry: string, overrides: Record<string, any>, cache = new Map<string, any>()): any {
  const file = path.resolve(root, entry);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target) && existsSync(`${target}.ts`)) target += '.ts';
    else if (!existsSync(target) && existsSync(`${target}.tsx`)) target += '.tsx';
    return loadModule(target, overrides, cache);
  }, mod, mod.exports);
  return mod.exports;
}

function collectNodes(value: any, out: any[] = []): any[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    out.push(value);
    if (value.props) {
      for (const [key, propValue] of Object.entries(value.props)) {
        if (key === 'children' || key === 'footer' || key === 'emptyState' || key === 'header') {
          collectNodes(propValue, out);
        }
      }
    }
  }
  return out;
}

function collectText(value: any): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('');
  if (value && typeof value === 'object') return collectText(value.props?.children);
  return '';
}

function renderWithHooks(renderRoot: () => any) {
  const states: any[] = [];
  let cursor = 0;
  const hooks = {
    reset() { cursor = 0; },
    useState(initial: any) {
      const idx = cursor++;
      if (!(idx in states)) states[idx] = typeof initial === 'function' ? initial() : initial;
      const setter = (next: any) => {
        states[idx] = typeof next === 'function' ? next(states[idx]) : next;
      };
      return [states[idx], setter];
    },
    useRef(initial: any) {
      const idx = cursor++;
      if (!(idx in states)) states[idx] = { current: initial ?? null };
      return states[idx];
    },
    useLayoutEffect() {},
    useEffect() {},
  };
  function expand(node: any): any {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    if (!node.props) return node;
    const nextProps: Record<string, any> = { ...node.props };
    for (const key of ['children', 'footer', 'emptyState', 'header']) {
      if (node.props[key] !== undefined) nextProps[key] = expand(node.props[key]);
    }
    return { ...node, props: nextProps };
  }
  return {
    hooks,
    render() {
      cursor = 0;
      return expand(renderRoot());
    },
  };
}

test('matchOfficialHelpForText deterministically identifies emergency and medical-consult cues without swallowing real convulsions', () => {
  for (const text of [
    'BB突然抽搐同埋嘴唇發紫點算？',
    'BB發燒全身抽筋點算？',
    '小朋友呼吸困難抖唔到氣！',
    '高燒不退而且叫唔醒、意識不清',
    'Baby is having a seizure and difficulty breathing',
    '懷疑誤服清潔劑，係咪即刻打 999 去急症室？',
    '急症，BB高燒不退',
    'BB抽搐點算好',
    'BB隻腳好抽筋',
    'BB剛好抽筋',
    'BB啱啱好抽筋',
    'BB激動到抽筋，雙眼反白',
    'BB開心到抽筋，成身僵硬',
    'BB笑到抽筋，雙眼反白',
    'BB激動到抽筋',
    'BB開心到抽筋',
    '呼吸困難抖唔到氣',
    '999',
    '打999',
    '打９９９',
    'My baby has difficulty breathing, should I call 999?',
  ]) {
    const matched = matchOfficialHelpForText(text);
    assert.ok(matched.includes('emergency-hk-v1'), `must match emergency-hk-v1 for: ${text}`);
  }

  for (const text of [
    '請問退燒藥水幾多 ml 先啱？',
    '醫生開咗撲熱息痛同抗生素，點樣餵藥？',
    '想問母嬰健康院同埋安全用藥劑量問題',
    'What is the paracetamol dosage for my baby?',
  ]) {
    const matched = matchOfficialHelpForText(text);
    assert.ok(matched.includes('medical-consult-hk-v1'), `must match medical-consult-hk-v1 for: ${text}`);
  }

  const combined = matchOfficialHelpForText('BB高燒不退抽搐，可唔可以即刻餵退燒藥水？');
  assert.deepEqual(combined, ['emergency-hk-v1', 'medical-consult-hk-v1']);

  for (const ordinary of [
    '',
    '   ',
    '你好！',
    '1999年出世',
    '+852 999 12345',
    '852-999-1234',
    '電話 999 12345',
    '舒緩拉筋運動',
    '對你好抽筋運動',
    '預防肌肉抽筋運動',
    '個故仔好好笑，笑到抽筋',
    '搞笑到抽筋',
    '今日下晝飲咗 120ml 奶同埋換咗兩次片',
    '請問六個月大加固食咩蔬果好？',
  ]) {
    assert.deepEqual(matchOfficialHelpForText(ordinary), [], `ordinary text must not false-trigger urgent help: ${ordinary}`);
  }
});

test('OFFICIAL_HELP copy and chatScreen structure expose fixed help cards outside the child guard', async () => {
  assert.deepEqual(ALL_OFFICIAL_HELP_IDS, ['emergency-hk-v1', 'medical-consult-hk-v1']);
  assert.ok(OFFICIAL_HELP['emergency-hk-v1'].sources.length >= 2);
  assert.ok(OFFICIAL_HELP['medical-consult-hk-v1'].sources.length >= 1);
  assert.match(OFFICIAL_HELP_ENTRY_COPY.urgentNotice, /毋須等待 AI 搜尋或審核/);

  const screenCode = await readFile(new URL('../frontend/src/screens/chatScreen.tsx', import.meta.url), 'utf8');
  assert.match(screenCode, /matchOfficialHelpForText/);
  assert.match(screenCode, /testID="chat-official-help-panel"/);
  assert.match(screenCode, /testID="chat-official-help-urgent-notice"/);
  assert.match(screenCode, /timelineFooter = \(officialHelpPanel \|\| feedback\)/);
});

test('ChatPage real render surfaces official help on toolbar toggle and urgent draft without selected child or agent run', () => {
  let currentDraft = '';
  let currentMessages: any[] = [];
  let selectedChildId: string | null = null;
  let children: any[] = [];

  const placeholder = new Proxy({}, { get: (_t, key) => String(key) });
  const jsxNode = (type: unknown, props: unknown) => ({ type, props });

  let runnerRef: ReturnType<typeof renderWithHooks>;
  const productionState = () => ({
    model: { children, selectedChildId },
    actions: { refresh() {}, open() {} },
    scopeKey: selectedChildId ? 'scope-1' : null,
    chatState: {
      busy: null,
      loading: false,
      online: true,
      loadedAt: '2026-11-16T00:00:00.000Z',
      selectedChildId,
      messages: currentMessages,
      drafts: {},
      remoteReply: null,
      feedback: null,
      error: null,
      replyError: null,
      cancelNotice: null,
      available: true,
      loadingOlder: false,
      nextCursor: null,
      limit: 20,
      userId: 'parent-1',
    },
    chatController: { loadOlderMessages: async () => {}, cancelReply: async () => {}, reloadMessages: async () => {} },
    chatDraft: currentDraft,
    setChatDraft(next: string) { currentDraft = next; },
    agentAttachments: [],
    addAgentAttachment() {},
    removeAgentAttachment() {},
    composerFocusRequest: 0,
    sendChat: async () => {},
    requestChatReply: async () => {},
    agentRuns: {},
    agentModel: { readState: 'ready', run: null, pendingDecision: null },
    voiceUpload: {},
    fileUpload: {},
    photoUpload: {},
    agentPending: { state: 'idle', entries: [] },
    readAgentPending() {},
    authorization: { pending: false },
    chatWritesAllowed: true,
    selectAgentRun() {},
    openAgentSource() {},
    checkPhotoUpload() {},
    checkFileUpload() {},
    checkVoiceUpload() {},
  });

  const overrides: Record<string, any> = {
    react: {
      createContext: () => ({ Provider: 'Provider' }),
      useContext: () => null,
      useId: () => 'id-1',
      useState: (init: any) => runnerRef.hooks.useState(init),
      useRef: (init: any) => runnerRef.hooks.useRef(init),
      useLayoutEffect: () => runnerRef.hooks.useLayoutEffect(),
      useEffect: () => runnerRef.hooks.useEffect(),
      Fragment: 'Fragment',
    },
    'react/jsx-runtime': { jsx: jsxNode, jsxs: jsxNode, Fragment: 'Fragment' },
    'expo-router': {
      useLocalSearchParams: () => ({}),
      usePathname: () => '/chat',
      useRouter: () => ({ push() {} }),
    },
    'react-native': {
      Platform: { OS: 'web' },
      Pressable: 'Pressable',
      StyleSheet: { create: (v: unknown) => v },
      View: 'View',
      useWindowDimensions: () => ({ width: 1024, height: 800, fontScale: 1 }),
      Linking: { openURL: async () => {} },
    },
    'react-native-paper': { Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    '../components/appearance/BackgroundSurface': { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false },
    '../production/ChatFileMessage': { ChatFileMessage: 'ChatFileMessage' },
    '../production/VoiceMessage': { VoiceMessage: 'VoiceMessage' },
    '../components/ui': { AppButton: 'AppButton', SectionCard: 'SectionCard' },
    '../ui': { AppButton: 'AppButton', SectionCard: 'SectionCard' },
    '../../theme': { colors: placeholder, mobileLayout: { breakpoint: 640 }, spacing: placeholder, chineseFont: 'synthetic' },
    '../components/AppDialog': { AppDialog: Object.assign('AppDialog', { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions' }) },
    '../components/StatusAnnouncement': { StatusAnnouncement: 'StatusAnnouncement' },
    '../components/agent/AgentComposer': { AgentComposer: 'AgentComposer' },
    '../components/chat/ChatMessage': { ChatMessage: 'ChatMessage', ChatProgressIndicator: 'ChatProgressIndicator' },
    '../components/chat/ChatTimeline': { ChatTimeline: 'ChatTimeline' },
    '../components/chat/locateCitationSource': { locateCitationSource() {} },
    '../components/chat/chat-presentation': { chatColors: placeholder, chatFont: 'synthetic', chatLayout: { maxWidth: 720, wideInset: 16, compactInset: 8 }, chatType: { body: {}, meta: {}, tool: {} } },
    '../production/ProductionProvider': { useProduction: productionState },
    '../production/AgentConversation': { AgentConversation: 'AgentConversation' },
    '../production/ChatPhotoMessage': { ChatPhotoMessage: 'ChatPhotoMessage' },
    '../production/NotificationChatTarget': { NotificationChatTarget: 'NotificationChatTarget' },
    '../production/useChatExposure': { useChatExposure() {}, useChatForeground: () => true },
    '../preview/PreviewNavigationGuard': { usePreviewLeaveGuard() {}, usePreviewNavigation: () => (fn: () => void) => fn() },
    '../agent-view-model': { proposalExpired: () => false, publicAnswerSources: () => undefined },
    '../theme': { colors: placeholder, mobileLayout: { breakpoint: 640 }, spacing: placeholder, chineseFont: 'synthetic' },
  };

  // Load with real frontend OfficialHelpCards + shared agent-feedback.ts inside the TS CommonJS graph.
  const chatModule = loadModule('frontend/src/screens/chatScreen.tsx', overrides);
  const ChatPage = chatModule.default;

  // 1) No child selected, ordinary joke draft -> help panel is hidden until user clicks the toolbar entry button.
  currentDraft = '個故仔好好笑，笑到抽筋';
  runnerRef = renderWithHooks(() => jsxNode(ChatPage, {}));
  let tree = runnerRef.render();
  let nodes = collectNodes(tree);
  assert.equal(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), false, 'joke draft must not auto-open help panel');
  const helpButton = nodes.find(
    n => n.type === 'Pressable' && n.props?.accessibilityLabel === OFFICIAL_HELP_ENTRY_COPY.accessibilityLabel,
  );
  assert.ok(helpButton, 'toolbar official help toggle button must render even with no child selected');
  assert.equal(collectText(helpButton), OFFICIAL_HELP_ENTRY_COPY.buttonLabel);

  // Trigger onPress() to verify interactive manual toggle renders emergency + medical help cards without AI calls.
  helpButton.props.onPress();
  tree = runnerRef.render();
  nodes = collectNodes(tree);
  const toggledPanel = nodes.find(n => n.props?.testID === 'chat-official-help-panel');
  assert.ok(toggledPanel, 'clicking official help toggle must render panel when !child');
  assert.equal(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), false, 'manual open on ordinary draft has no urgent warning');
  const toggledText = collectText(toggledPanel);
  assert.ok(toggledText.includes(OFFICIAL_HELP['emergency-hk-v1'].title));
  assert.ok(toggledText.includes(OFFICIAL_HELP['medical-consult-hk-v1'].title));

  // Toggle back off.
  nodes.find(n => n.type === 'Pressable' && n.props?.accessibilityLabel === OFFICIAL_HELP_ENTRY_COPY.accessibilityLabel)!.props.onPress();
  tree = runnerRef.render();
  assert.equal(collectNodes(tree).some(n => n.props?.testID === 'chat-official-help-panel'), false);

  // 2) Urgent draft with accompanying danger signs ("BB激動到抽筋，雙眼反白") auto-surfaces panel & urgent notice with !child.
  currentDraft = 'BB激動到抽筋，雙眼反白';
  tree = runnerRef.render();
  nodes = collectNodes(tree);
  const urgentPanel = nodes.find(n => n.props?.testID === 'chat-official-help-panel');
  assert.ok(urgentPanel, 'urgent convulsion draft must auto-surface help panel immediately');
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), 'urgent notice must render automatically');
  const urgentBtn = nodes.find(
    n => n.type === 'Pressable' && n.props?.accessibilityLabel === OFFICIAL_HELP_ENTRY_COPY.accessibilityLabel,
  );
  assert.equal(collectText(urgentBtn), OFFICIAL_HELP_ENTRY_COPY.highlightedButtonLabel);
  assert.ok(collectText(urgentPanel).includes(OFFICIAL_HELP['emergency-hk-v1'].title));
});
