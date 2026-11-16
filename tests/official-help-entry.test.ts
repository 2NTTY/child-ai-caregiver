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
import { ChatApiError, type ChatApi } from '../src/client/chat-api.ts';
import { ChatController } from '../src/client/chat-controller.ts';

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
    'BB笑到抽筋，之後冇晒反應',
    'BB笑到抽筋，之後無反應',
    'BB笑到抽筋，成個人軟晒唔郁',
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
  assert.match(screenCode, /testID="chat-official-help-dock"/);
  assert.match(screenCode, /timelineFooter = feedback \?/);
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
      ScrollView: 'ScrollView',
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

  // 3) Laugh-idiom prefix followed by unresponsiveness ("BB笑到抽筋，之後冇晒反應") must also auto-surface emergency help!
  for (const urgentPostLaugh of ['BB笑到抽筋，之後冇晒反應', 'BB笑到抽筋，之後無反應']) {
    currentDraft = urgentPostLaugh;
    tree = runnerRef.render();
    nodes = collectNodes(tree);
    assert.ok(
      nodes.some(n => n.props?.testID === 'chat-official-help-panel'),
      `Laugh idiom + unresponsiveness must auto-surface help panel: ${urgentPostLaugh}`,
    );
    assert.ok(
      nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'),
      `Laugh idiom + unresponsiveness must auto-surface urgent notice: ${urgentPostLaugh}`,
    );
  }
});

test('B-P5 decided dock placement, turn-state retention, cross-child isolation, unconsciousness priority, and mobile viewport non-occlusion', async () => {
  // 1. Unconsciousness cues prioritize over joke idioms; ordinary medication queries stay in medical-consult-hk-v1 without emergency escalation.
  assert.deepEqual(matchOfficialHelpForText('笑到暈低，之後失去意識'), ['emergency-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('BB笑到抽筋，之後冇晒反應'), ['emergency-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('BB笑到抽筋，之後意識喪失'), ['emergency-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('笑到暈低，跟住知覺喪失'), ['emergency-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('笑到抽筋，反應全無'), ['emergency-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('退燒藥每次食 5ml？'), ['medical-consult-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('Administer thirteen drops'), ['medical-consult-hk-v1']);
  assert.deepEqual(matchOfficialHelpForText('Take one tablet at bedtime.'), ['medical-consult-hk-v1']);

  const jsxNode = (type: unknown, props: unknown) => ({ type, props });
  const children = [{ id: 'child-1', name: 'A' }, { id: 'child-2', name: 'B' }];
  let selectedChildId: string | null = 'child-1';
  let scopeKey: string | null = 'scope-child-1';
  let chatSelectedChildId: string | null = 'child-1';
  let currentDraft = '';
  let currentMessages: any[] = [];
  let currentDrafts: Record<string, any> = {};
  let currentReplyError: string | null = null;
  let currentFeedback: any = null;
  let currentRuns: Record<string, any> = {};
  let viewport = { width: 1024, height: 800, fontScale: 1 };
  let runnerRef: any = null;
  const effectDeps: Array<{ deps?: unknown[]; clean?: boolean }> = [];
  let effectIdx = 0;

  const placeholder: Record<string, unknown> = {};
  const productionState = () => ({
    model: { children, selectedChildId },
    actions: { refresh() {}, open() {} },
    scopeKey,
    chatState: {
      busy: null,
      loading: false,
      online: true,
      loadedAt: '2026-11-16T00:00:00.000Z',
      selectedChildId: chatSelectedChildId,
      messages: currentMessages,
      drafts: currentDrafts,
      remoteReply: null,
      feedback: currentFeedback,
      error: null,
      replyError: currentReplyError,
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
    composerFocusRequest: 0,
    sendChat: async () => {},
    requestChatReply: async () => {},
    agentRuns: currentRuns,
    agentModel: { readState: 'ready', run: null, pendingDecision: null },
    voiceUpload: {},
    fileUpload: {},
    photoUpload: {},
    agentPending: { state: 'idle', entries: [] },
    authorization: { pending: false },
    chatWritesAllowed: true,
    readAgentPending() {},
  });

  const overrides: Record<string, any> = {
    react: {
      createContext: () => ({ Provider: 'Provider' }),
      useContext: () => null,
      useId: () => 'id-2',
      useState: (init: any) => runnerRef.hooks.useState(init),
      useRef: (init: any) => runnerRef.hooks.useRef(init),
      useLayoutEffect: () => runnerRef.hooks.useLayoutEffect(),
      useEffect: (fn: () => void, deps?: unknown[]) => {
        const idx = effectIdx++;
        const prev = effectDeps[idx];
        const changed = !prev || !deps || deps.length !== (prev.deps?.length ?? 0)
          || deps.some((v, i) => !Object.is(v, prev.deps?.[i]));
        effectDeps[idx] = { deps };
        if (changed) fn();
      },
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
      ScrollView: 'ScrollView',
      StyleSheet: { create: (v: unknown) => v },
      View: 'View',
      useWindowDimensions: () => viewport,
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
  const ChatPage = loadModule('frontend/src/screens/chatScreen.tsx', overrides).default;
  const rerender = () => {
    effectIdx = 0;
    return runnerRef.render();
  };

  // Case A: Stopped / failed AI reply must retain urgent help panel instead of dropping it just because a model message has inReplyTo.
  currentMessages = [
    { id: 'u1', role: 'user', text: 'BB發燒抽筋冇反應' },
    { id: 'm1', role: 'model', inReplyTo: 'u1', text: '這次回覆未完成：已停止。', agentRunId: 'run-stopped-1' },
  ];
  currentRuns = { 'run-stopped-1': { status: 'stopped', stopReasonLabel: '已停止' } };
  currentDrafts = { 'child-1': { phase: 'reply_failed', savedUserMessageId: 'u1', notice: '回覆失敗' } };
  currentReplyError = '回覆未能完成';
  runnerRef = renderWithHooks(() => jsxNode(ChatPage, {}));
  let nodes = collectNodes(rerender());
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), 'Stopped/failed turn must retain official help panel');
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), 'Stopped/failed emergency turn must retain urgent notice');

  // Case B: Decided dock placement (outside ChatTimeline footer, directly above AgentComposer inside chat-reading-panel).
  const timeline = nodes.find(n => n.type === 'ChatTimeline');
  assert.ok(timeline, 'ChatTimeline must render');
  const footerNodes = collectNodes(timeline.props?.footer);
  assert.equal(footerNodes.some(n => n.props?.testID === 'chat-official-help-panel'), false, 'officialHelpPanel must not live inside scrollable ChatTimeline footer');
  const readingPanel = nodes.find(n => n.props?.testID === 'chat-reading-panel');
  assert.ok(readingPanel, 'chat-reading-panel must render');
  const directDockOrChildren = collectNodes(readingPanel);
  const helpIdx = directDockOrChildren.findIndex(n => n.props?.testID === 'chat-official-help-panel');
  const timelineIdx = directDockOrChildren.findIndex(n => n.type === 'ChatTimeline');
  const composerIdx = directDockOrChildren.findIndex(n => n.type === 'AgentComposer');
  assert.ok(timelineIdx >= 0 && helpIdx > timelineIdx && composerIdx > helpIdx, 'chat-official-help-panel must sit after ChatTimeline and above AgentComposer');

  // Case C: Routine medication draft surfaces medical-consult-hk-v1 WITHOUT urgent emergency notice.
  currentMessages = [];
  currentRuns = {};
  currentDrafts = {};
  currentReplyError = null;
  currentDraft = '退燒藥每次食 5ml？';
  nodes = collectNodes(rerender());
  const helpPanel = nodes.find(n => n.props?.testID === 'chat-official-help-panel');
  assert.ok(helpPanel, 'Medication query should show official help panel');
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-consult-notice'), 'Medication query must show non-urgent medical consult notice');
  assert.ok(collectText(helpPanel).includes(OFFICIAL_HELP['medical-consult-hk-v1'].title), 'Medication query must show medical-consult card');
  assert.equal(collectText(helpPanel).includes(OFFICIAL_HELP['emergency-hk-v1'].title), false, 'Ordinary medication query must NOT escalate to emergency card');
  assert.equal(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), false, 'Ordinary medication query must NOT show urgent emergency alert');

  // Case D: Cross-child mismatch must NOT leak previous child's messages/feedback, and switching child/scope resets manual helpOpen.
  currentDraft = '';
  const toggleBtn = nodes.find(n => n.props?.accessibilityLabel === OFFICIAL_HELP_ENTRY_COPY.accessibilityLabel);
  assert.ok(toggleBtn);
  toggleBtn.props.onPress();
  nodes = collectNodes(rerender());
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), 'Manual toggle opens help panel for child-1');

  selectedChildId = 'child-2';
  scopeKey = 'scope-child-2';
  chatSelectedChildId = 'child-1'; // stale chatState from child-1!
  currentMessages = [{ id: 'u-old', role: 'user', text: 'BB發燒抽筋冇反應' }];
  currentFeedback = { cards: ['emergency-hk-v1'] };
  nodes = collectNodes(rerender());
  assert.equal(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), false, 'Child switch must reset manual helpOpen and must not leak child-1 messages or feedback');

  // Case E: Mobile narrow + zoomed fontScale dock stays height-bounded while AgentComposer remains unobstructed.
  viewport = { width: 360, height: 640, fontScale: 2 };
  selectedChildId = 'child-1';
  scopeKey = 'scope-child-1';
  chatSelectedChildId = 'child-1';
  currentFeedback = null;
  currentMessages = [{ id: 'u2', role: 'user', text: 'BB失去意識點算' }];
  nodes = collectNodes(rerender());
  const dockNode = nodes.find(n => n.props?.testID === 'chat-official-help-dock');
  assert.ok(dockNode, 'Mobile help dock must render bounded container chat-official-help-dock');
  const flatDockStyle = Object.assign({}, ...(Array.isArray(dockNode.props?.style) ? dockNode.props.style : [dockNode.props?.style]).filter(Boolean));
  assert.ok(typeof flatDockStyle.maxHeight === 'number' && flatDockStyle.maxHeight > 0 && flatDockStyle.maxHeight <= 240, 'Dock maxHeight must stay bounded on compact mobile viewport');
  assert.ok(nodes.some(n => n.type === 'AgentComposer'), 'AgentComposer must remain rendered below dock under mobile zoomed fontScale');

  // Case F (H1 + H2): 'BB笑到抽筋，之後意識喪失' in stopped turn AND Server SSE help card retained when busy=null after reply failure.
  currentMessages = [
    { id: 'u3', role: 'user', text: 'BB笑到抽筋，之後意識喪失' },
    { id: 'm3', role: 'model', inReplyTo: 'u3', text: '這次回覆未完成：已停止。', agentRunId: 'run-stopped-3' },
  ];
  currentRuns = { 'run-stopped-3': { status: 'stopped', stopReasonLabel: '已停止' } };
  nodes = collectNodes(rerender());
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), 'H1: 意識喪失 in stopped turn must surface urgent notice');

  // H2 UI: Generic user text without keywords, busy=null, but retained feedback.cards=['emergency-hk-v1'] from Server SSE.
  currentMessages = [{ id: 'u4', role: 'user', text: '幫我睇下呢張相應該點處理？' }];
  currentRuns = {};
  currentFeedback = { runId: 'run-sse-1', messageId: 'u4', phase: 'help', card: 'emergency-hk-v1', cards: ['emergency-hk-v1'] };
  currentDrafts = { 'child-1': { phase: 'reply_failed', savedUserMessageId: 'u4', notice: '回覆失敗' } };
  nodes = collectNodes(rerender());
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), 'H2 UI: retained Server SSE help card must render panel even when busy=null');
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), 'H2 UI: retained Server SSE emergency card must render urgent notice when busy=null');

  // H2 Controller + UI E2E: ChatController.requestReply emits SSE help card, then fails -> feedback.cards is retained when busy=null, then cleared after completed reply reloads.
  let storedMessages: any[] = [{ id: 'u-sse', childId: 'child-1', authorUserId: 'parent-1', role: 'user', text: '幫我睇下呢張相應該點處理？', createdAt: '2026-11-16T00:00:00.000Z' }];
  const mockApi: ChatApi = {
    getSession: async () => ({ id: 'parent-1', email: 'p@example.com' } as any),
    getStatus: async () => true,
    getUsage: async () => ({ remaining: 10, limit: 20, scope: 'user' }) as any,
    listMessages: async () => ({ childId: 'child-1', messages: storedMessages, nextCursor: null, limit: 20 }),
    saveMessage: async () => { throw new Error('unused'); },
    getOriginalReply: async () => null,
    requestReply: async (_c, messageId, _sig, _u, onProgress) => {
      onProgress?.({ runId: 'run-sse-ctrl', messageId, phase: 'help', card: 'emergency-hk-v1' });
      throw new ChatApiError(503, undefined, 'ai_unavailable');
    },
    getReplyState: async () => 'stopped',
    cancelReply: async () => false,
  };
  const controller = new ChatController(mockApi, true);
  controller.syncContext('parent-1', true, 'child-1');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await controller.requestReply('u-sse');
  const failedSnap = controller.getSnapshot();
  assert.equal(failedSnap.busy, null, 'H2 Controller: busy must return to null after failed reply');
  assert.deepEqual(failedSnap.feedback?.cards, ['emergency-hk-v1'], 'H2 Controller: SSE help card must be retained in feedback after failed/stopped reply');

  // Feed real controller snapshot into ChatPage
  currentMessages = failedSnap.messages;
  currentFeedback = failedSnap.feedback;
  currentDrafts = failedSnap.drafts;
  currentReplyError = failedSnap.replyError;
  nodes = collectNodes(rerender());
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-panel'), 'H2 Controller->UI: retained SSE help card renders panel');
  assert.ok(nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'), 'H2 Controller->UI: retained SSE emergency card renders urgent notice');

  // Once a completed model reply is loaded via reloadMessages(), retained feedback is cleared.
  storedMessages = [
    ...storedMessages,
    { id: 'm-sse-done', childId: 'child-1', authorUserId: null, role: 'model', inReplyTo: 'u-sse', text: '已完成回覆。', createdAt: '2026-11-16T00:01:00.000Z' },
  ];
  await controller.reloadMessages();
  assert.equal(controller.getSnapshot().feedback, null, 'H2 Controller: reloadMessages clears retained feedback once completed reply exists');
  controller.dispose();
});

test('H2-R: resolved stopped/unknown replies and catch-recovered unfinished saves preserve Server SSE help cards while genuine completion, new turns, and child switches clear them', async () => {
  const { handleProductAgentRequest } = await import('../server/product-agent-api.ts');
  const { createChatApi } = await import('../src/client/chat-api.ts');

  const jsxNode = (type: unknown, props: unknown) => ({ type, props });
  const children = [{ id: 'child-1', name: 'A' }, { id: 'child-2', name: 'B' }];
  let selectedChildId: string | null = 'child-1';
  let scopeKey: string | null = 'scope-child-1';
  let snapshotRef: ReturnType<ChatController['getSnapshot']> | null = null;
  let currentDraft = '';
  let runnerRef: ReturnType<typeof renderWithHooks>;
  const effectDeps: Array<{ deps?: unknown[] }> = [];
  let effectIdx = 0;

  const placeholder: Record<string, unknown> = {};
  const productionState = () => ({
    model: { children, selectedChildId },
    actions: { refresh() {}, open() {} },
    scopeKey,
    chatState: snapshotRef,
    chatController: { loadOlderMessages: async () => {}, cancelReply: async () => {}, reloadMessages: async () => {} },
    chatDraft: currentDraft,
    setChatDraft(next: string) { currentDraft = next; },
    agentAttachments: [],
    composerFocusRequest: 0,
    sendChat: async () => {},
    requestChatReply: async () => {},
    agentRuns: {},
    agentModel: { readState: 'ready', run: null, pendingDecision: null },
    voiceUpload: {},
    fileUpload: {},
    photoUpload: {},
    agentPending: { state: 'idle', entries: [] },
    authorization: { pending: false },
    chatWritesAllowed: true,
    readAgentPending() {},
  });

  const overrides: Record<string, any> = {
    react: {
      createContext: () => ({ Provider: 'Provider' }),
      useContext: () => null,
      useId: () => 'id-h2r',
      useState: (init: any) => runnerRef.hooks.useState(init),
      useRef: (init: any) => runnerRef.hooks.useRef(init),
      useLayoutEffect: () => runnerRef.hooks.useLayoutEffect(),
      useEffect: (fn: () => void, deps?: unknown[]) => {
        const idx = effectIdx++;
        const prev = effectDeps[idx];
        const changed = !prev || !deps || deps.length !== (prev.deps?.length ?? 0)
          || deps.some((v, i) => !Object.is(v, prev.deps?.[i]));
        effectDeps[idx] = { deps };
        if (changed) fn();
      },
      Fragment: 'Fragment',
    },
    'react/jsx-runtime': { jsx: jsxNode, jsxs: jsxNode, Fragment: 'Fragment' },
    'expo-router': { useLocalSearchParams: () => ({}), usePathname: () => '/chat', useRouter: () => ({ push() {} }) },
    'react-native': {
      Platform: { OS: 'web' }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: (v: unknown) => v }, View: 'View',
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), Linking: { openURL: async () => {} },
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
  const ChatPage = loadModule('frontend/src/screens/chatScreen.tsx', overrides).default;
  const renderFreshUi = (snap: ReturnType<ChatController['getSnapshot']>, child: string = 'child-1') => {
    selectedChildId = child;
    scopeKey = `scope-${child}`;
    snapshotRef = snap;
    effectDeps.length = 0;
    effectIdx = 0;
    runnerRef = renderWithHooks(() => jsxNode(ChatPage, {}));
    const nodes = collectNodes(runnerRef.render());
    return {
      panel: nodes.some(n => n.props?.testID === 'chat-official-help-panel'),
      urgent: nodes.some(n => n.props?.testID === 'chat-official-help-urgent-notice'),
    };
  };

  // 1) Real handleProductAgentRequest SSE stream -> createChatApi -> ChatController -> fresh ChatPage for both stopped & unknown (even with stopReason: null).
  const sseChild = '11111111-1111-4111-8111-111111111111';
  const sseRunId = '22222222-2222-4222-8222-222222222222';
  for (const scenario of [
    { name: 'SSE resolved stopped', status: 'stopped' as const, stopReason: 'delivery_review_incomplete', text: '' },
    { name: 'SSE resolved unknown with null stopReason', status: 'unknown' as const, stopReason: null, text: '' },
  ]) {
    const msgId = scenario.status === 'stopped' ? '33333333-3333-4333-8333-333333333331' : '33333333-3333-4333-8333-333333333332';
    const userMsg = { id: msgId, childId: sseChild, authorUserId: 'parent-1', role: 'user' as const, text: '幫我睇下呢張相應該點處理？', createdAt: '2026-11-17T00:00:00.000Z', inReplyTo: null };
    const messages: any[] = [userMsg];
    let recordedReplyState: any = null;
    const options = {
      isCurrentUser: async () => true,
      agent: {
        reply: async (_u: string, _c: string, _m: string, _ok: unknown, _s: unknown, publish?: (e: any) => void) => {
          publish?.({ runId: sseRunId, messageId: msgId, phase: 'help', card: 'emergency-hk-v1' });
          recordedReplyState = { messageId: msgId, runId: sseRunId, status: scenario.status, stopReason: scenario.stopReason };
          return { runId: sseRunId, status: scenario.status, stopReason: scenario.stopReason, text: scenario.text, proposals: [], tools: [], counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 } };
        },
      },
      store: {
        replyState: async () => recordedReplyState,
        confirmationQuestions: async () => [],
        bindConfirmationQuestion: async () => {},
        get: async () => ({ runId: sseRunId, status: scenario.status, stopReason: scenario.stopReason }),
      },
      chat: {
        listForUser: async () => ({ messages, limit: 100 }),
        createModelMessageForUser: async (_u: string, cid: string, inReplyTo: string, text: string) => {
          const saved = { id: '44444444-4444-4444-8444-444444444444', childId: cid, authorUserId: null, role: 'model' as const, inReplyTo, text, createdAt: '2026-11-17T00:00:01.000Z' };
          messages.push(saved);
          return saved;
        },
      },
    } as any;
    const chatApi = createChatApi(
      'https://synthetic.invalid',
      async () => ({ id: 'parent-1', email: 'p@example.test', name: 'Parent' }),
      async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages, limit: 100 }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/ai/status')) return new Response(JSON.stringify({ available: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/ai/usage')) return new Response(JSON.stringify({ day: '2026-11-17', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
        return handleProductAgentRequest(new Request(url, { method: init?.method ?? 'GET', headers, body: init?.body }), 'parent-1', options);
      },
    );
    const ctrl = new ChatController(chatApi, true);
    ctrl.syncContext('parent-1', true, sseChild);
    await new Promise(r => setTimeout(r, 15));
    await ctrl.requestReply(msgId);
    const snap = ctrl.getSnapshot();
    assert.deepEqual(snap.feedback?.cards, ['emergency-hk-v1'], `${scenario.name}: Controller must retain SSE emergency card`);
    selectedChildId = sseChild;
    snapshotRef = snap;
    children.splice(0, children.length, { id: sseChild, name: 'SSE Child' }, { id: 'child-2', name: 'B' });
    const ui = renderFreshUi(snap, sseChild);
    assert.deepEqual(ui, { panel: true, urgent: true }, `${scenario.name}: default-closed ChatPage must show emergency panel & urgent notice`);
    ctrl.dispose();
  }
  children.splice(0, children.length, { id: 'child-1', name: 'A' }, { id: 'child-2', name: 'B' });

  // 2) Paired controls with unprefixed text where status comes from getOriginalReply/getReplyState, catch-recovered unfinished save, genuine completed, new turn, and child switch.
  for (const mode of ['resolved_unknown', 'catch_recovered_stopped', 'completed'] as const) {
    const msgs: any[] = [{ id: 'u-ctrl', childId: 'child-1', authorUserId: 'parent-1', role: 'user', text: '幫我睇下呢張相應該點處理？', createdAt: '2026-11-17T00:00:00.000Z', inReplyTo: null }];
    const runStatus = mode === 'completed' ? 'completed' : mode === 'resolved_unknown' ? 'unknown' : 'stopped';
    let replyStarted = false;
    const api: ChatApi = {
      getSession: async () => ({ id: 'parent-1', email: 'p@example.test', name: 'Parent' } as any),
      getStatus: async () => true,
      getUsage: async () => ({ day: '2026-11-17', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
      listMessages: async cid => ({ messages: msgs.filter(m => m.childId === cid), limit: 100 }),
      saveMessage: async (cid, text) => {
        const next = { id: 'u-new-turn', childId: cid, authorUserId: 'parent-1', role: 'user', text, createdAt: '2026-11-17T00:05:00.000Z', inReplyTo: null };
        msgs.push(next);
        return next as any;
      },
      getOriginalReply: async (_c, mid) => replyStarted && mid === 'u-ctrl' ? { messageId: 'u-ctrl', runId: 'run-ctrl', status: runStatus, stopReason: null } : null,
      getReplyState: async () => runStatus,
      requestReply: async (_c, mid, _sig, _u, onProgress) => {
        if (mid === 'u-new-turn') {
          const ok = { id: 'm-new', childId: 'child-1', authorUserId: null, role: 'model', inReplyTo: mid, text: '收到，有需要隨時再講。', createdAt: '2026-11-17T00:05:01.000Z' };
          msgs.push(ok);
          return ok as any;
        }
        replyStarted = true;
        onProgress?.({ runId: 'run-ctrl', messageId: mid, phase: 'help', card: 'emergency-hk-v1' });
        const replyMsg = {
          id: 'm-ctrl', childId: 'child-1', authorUserId: null, role: 'model', inReplyTo: mid,
          text: mode === 'catch_recovered_stopped' ? '這次回覆未完成：已停止。' : '初步觀察已完成整理。',
          agentRunId: 'run-ctrl', createdAt: '2026-11-17T00:00:02.000Z',
        };
        msgs.push(replyMsg);
        if (mode === 'catch_recovered_stopped') throw new ChatApiError(503, 'ai_unavailable');
        return replyMsg as any;
      },
    };
    const ctrl = new ChatController(api, true);
    ctrl.syncContext('parent-1', true, 'child-1');
    await new Promise(r => setTimeout(r, 15));
    await ctrl.requestReply('u-ctrl');
    const snap = ctrl.getSnapshot();
    if (mode === 'completed') {
      assert.equal(snap.feedback, null, 'completed reply must clear SSE feedback');
      assert.deepEqual(renderFreshUi(snap, 'child-1'), { panel: false, urgent: false }, 'completed control closes panel');
    } else {
      assert.deepEqual(snap.feedback?.cards, ['emergency-hk-v1'], `${mode} must keep SSE help card`);
      assert.deepEqual(renderFreshUi(snap, 'child-1'), { panel: true, urgent: true }, `${mode} keeps emergency UI visible`);

      // Child switch clears feedback inside ChatController and ChatPage must never leak child-1 feedback to child-2.
      const beforeChildSwitch = ctrl.getSnapshot();
      assert.deepEqual(renderFreshUi(beforeChildSwitch, 'child-2'), { panel: false, urgent: false }, `${mode}: child-2 must never see child-1 feedback`);
      ctrl.syncContext('parent-1', true, 'child-2');
      await new Promise(r => setTimeout(r, 10));
      assert.equal(ctrl.getSnapshot().feedback, null, `${mode}: syncContext child switch must clear feedback`);
      ctrl.syncContext('parent-1', true, 'child-1');
      await new Promise(r => setTimeout(r, 10));

      // Sending a new non-urgent user turn supersedes and clears previous feedback cleanly.
      ctrl.setText('今日飲咗120ml奶');
      await ctrl.send();
      assert.equal(ctrl.getSnapshot().feedback, null, `${mode}: new turn must clear superseded feedback`);
      assert.deepEqual(renderFreshUi(ctrl.getSnapshot(), 'child-1'), { panel: false, urgent: false }, `${mode}: new turn closes panel`);
    }
    ctrl.dispose();
  }
});
