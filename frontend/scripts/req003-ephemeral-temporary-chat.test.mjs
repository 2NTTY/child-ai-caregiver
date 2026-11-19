import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { harness as componentHarness } from './scope-transition-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTs(file) {
  const full = path.resolve(root, file);
  if (moduleCache.has(full)) return moduleCache.get(full).exports;
  const mod = { exports: {} };
  moduleCache.set(full, mod);
  const code = ts.transpileModule(readFileSync(full, 'utf8'), {
    fileName: full,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(full), name);
    if (!existsSync(target)) target += '.ts';
    return loadTs(target);
  }, mod, mod.exports);
  return mod.exports;
}

const { createTemporaryChatApi } = loadTs('src/client/temporary-chat-api.ts');
const { TemporaryChatOwner } = loadTs('frontend/src/production/TemporaryChatOwner.ts');
const { TEMPORARY_CHAT_COPY } = loadTs('src/shared/temporary-chat.ts');

const settle = () => new Promise(resolve => setImmediate(resolve));
const text = node =>
  !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);

function collectHosts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectHosts(item, out);
    return out;
  }
  out.push(node);
  collectHosts(node.props?.children, out);
  return out;
}

function uiMocks() {
  const dialog = Object.assign(({ visible, children, ...props }) => (visible ? { type: 'Dialog', props: { ...props, children } } : null), {
    Title: 'DialogTitle',
    Content: 'DialogContent',
    Actions: 'DialogActions',
    ScrollArea: 'DialogScrollArea',
  });
  const theme = {
    colors: {
      canvas: '#F7FCFC', controlSurface: '#FFFFFE', quietSurface: '#EDFAF9', ink: '#272343',
      muted: '#2D334A', softLine: '#E6E6EA', line: '#CAC9D4', controlOutline: '#737284',
      accent: '#FFD803', onAccent: '#272343', warningInk: '#5E4F0C', errorInk: '#D61F26',
      paleTeal: '#E3F6F5', sage: '#BAE8E8', paleAmber: '#FFF7D8', paleCoral: '#FEF2F2',
      selectedPressed: '#A8D0D4', statusWarmLine: '#A38B19', neutralSurface: '#F7FCFC',
      white: '#FFFFFE', deepTeal: '#272343', teal: '#272343', sidebar: '#E3F6F5',
      selectedNav: '#BAE8E8',
    },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 },
    radius: { small: 10, medium: 16, large: 22, pill: 999 },
    typeScale: { caption: 12, small: 14, body: 16, title: 20, heading: 28, hero: 34 },
    chineseFont: 'System',
    mobileLayout: { breakpoint: 650, touchTarget: 48, headerMinHeight: 64, tabMinHeight: 64 },
    mobileType: { caption: { fontSize: 12 }, itemTitle: { fontSize: 14 } },
    mobileIcons: { navigation: 22 },
  };
  const linkingCalls = [];
  const mocks = {
    'react-native': {
      View: 'View',
      Pressable: 'Pressable',
      Platform: { OS: 'web', select: v => v.web ?? v.default },
      Linking: { openURL: url => { linkingCalls.push(url); return Promise.resolve(); } },
      StyleSheet: { create: x => x, flatten: x => Object.assign({}, ...[x].flat(Infinity).filter(Boolean)) },
      useWindowDimensions: () => ({ width: 1280, height: 800 }),
    },
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-router': { usePathname: () => '/chat', useRouter: () => ({ push() {} }) },
    '../branding': { brand: { homeLabel: 'Home' } },
    '../theme': theme,
    '../motion': {
      MotionDrawerOverlay: 'MotionDrawerOverlay',
      MotionDrawerRight: 'MotionDrawerRight',
      MotionEntrance: 'MotionEntrance',
      MotionScopeBoundary: 'MotionScopeBoundary',
    },
    '../preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink', usePreviewNavigation: () => fn => fn() },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null },
    '../startup/dataReadiness': {
      combineStartupReadiness: () => 'ready',
      startupReadState: () => 'ready',
      visibleRailStartupReadiness: () => 'ready',
      visibleRailStartupRequirements: () => [],
    },
    '../production/ProductionFirstScreenGate': { useProductionSwitchReadiness: () => ({ state: 'ready', key: 'ok' }) },
    '../production/useHeaderOperationHints': { useHeaderOperationHints: () => [] },
    './ui': {
      AppButton: ({ label, onPress }) => ({ type: 'AppButton', props: { label, onPress } }),
      AppTextField: 'AppTextField',
    },
    './AppDialog': { AppDialog: dialog },
    './AppIcon': { AppIcon: 'AppIcon' },
    './AppScrollView': { AppScrollView: 'ScrollView' },
    './AgentEntryButton': { AgentEntryButton: 'AgentEntryButton' },
    './agent/MobileQuickInputDock': { MobileQuickInputDock: 'MobileQuickInputDock' },
    './navigation/RecordsNavButton': { RecordsNavButton: 'RecordsNavButton' },
    './navigation/MobileNavSelection': { MobileNavSelection: 'MobileNavSelection' },
    './navigation/app-navigation': { desktopNavigationGroups: [], navigationItems: { home: { href: '/', short: '主頁', icon: 'home' }, chat: { href: '/chat', short: '聊天', icon: 'chat' }, tasks: { href: '/tasks', short: '待辦', icon: 'tasks' }, growth: { href: '/growth', short: '成長', icon: 'growth' }, settings: { href: '/settings', short: '設定', icon: 'settings' } } },
    './RightRailContent': { RightRailContent: 'RightRailContent' },
    './ChildKeyFacts': { ChildKeyFacts: 'ChildKeyFacts' },
    './ChildPicker': { ChildPicker: ({ selectedId }) => ({ type: 'ChildPicker', props: { selectedId } }) },
    './CompactHeaderIdentity': { CompactHeaderIdentity: 'CompactHeaderIdentity' },
    './PendingReviewShortcut': { PendingReviewShortcut: 'PendingReviewShortcut' },
    './NotificationBell': { NotificationBell: 'NotificationBell' },
    './ToolbarIconButton': { ToolbarIconButton: 'ToolbarIconButton' },
    './BrandLogo': { BrandLogo: 'BrandLogo' },
    './companion/SiteCompanion': { SiteCompanion: 'SiteCompanion' },
    './chat/OfficialHelpCards': { OfficialHelpCards: ({ ids }) => ({ type: 'OfficialHelpCards', props: { ids } }) },
  };
  return { mocks, linkingCalls };
}

test('1. AppShell (wide + compact) and NativeAppShell mount TemporaryChatEntry at far top-left while keeping PendingReviewShortcut at top-right', () => {
  const { mocks } = uiMocks();
  mocks['./TemporaryChatEntry'] = { TemporaryChatEntry: p => ({ type: 'TemporaryChatEntry', props: p }) };
  mocks['../production/useProductionHome'] = {
    useProductionHome: () => ({
      model: { children: [{ id: 'child-a', displayName: '小晴' }], selectedChildId: 'child-a', profileLoad: 'ready' },
      actions: { selectChild() {} },
      notice: null,
      dismissNotice() {},
      scopeKey: 'scope-a',
      identityKey: 'parent-a',
      sharedChild: { target: null },
      setContextRailVisible() {},
    }),
  };

  const h = componentHarness(mocks);
  const { AppShell } = h.load('src/components/AppShell.tsx');
  const { NativeAppShell } = h.load('src/components/NativeAppShell.tsx');

  // Desktop wide width
  h.render(h.jsx(AppShell, { children: h.jsx('View', {}, 'body') }));
  const wideEntry = h.hosts().find(node => node.type === 'TemporaryChatEntry');
  assert.ok(wideEntry);
  assert.equal(wideEntry.props.compact, false);
  const webHeader = h.node('header-actions').props.children.flat().filter(Boolean);
  assert.equal(webHeader[0].type, 'PendingReviewShortcut');

  // Compact mobile width
  mocks['react-native'].useWindowDimensions = () => ({ width: 390, height: 800 });
  h.render(h.jsx(AppShell, { children: h.jsx('View', {}, 'body') }));
  const compactEntry = h.hosts().find(node => node.type === 'TemporaryChatEntry');
  assert.ok(compactEntry);
  assert.equal(compactEntry.props.compact, true);

  // Native shell
  h.render(h.jsx(NativeAppShell, { children: h.jsx('View', {}, 'body') }));
  const nativeEntry = h.hosts().find(node => node.type === 'TemporaryChatEntry');
  assert.ok(nativeEntry);
  assert.equal(nativeEntry.props.compact, true);
  const nativeHeader = h.node('header-actions').props.children.flat().filter(Boolean);
  assert.equal(nativeHeader[0].type, 'PendingReviewShortcut');
  h.unmount();
});

test('2. Opening TemporaryChatEntry renders blank TemporaryChatModal with boundary disclosures and zero child, main-chat, or auto-auth UI', async () => {
  const { mocks } = uiMocks();
  const requests = [];
  const api = createTemporaryChatApi('https://example.test/api', async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        session: {
          sessionId: '11111111-1111-4111-8111-111111111111',
          generation: 1,
          createdAt: '2026-11-20T01:00:00Z',
          lastActivityAt: '2026-11-20T01:00:00Z',
          idleExpiresAt: '2026-11-20T01:15:00Z',
          hardExpiresAt: '2026-11-20T02:00:00Z',
          idleTtlMs: 900_000,
          maxLifetimeMs: 3_600_000,
        },
        messages: [],
      }),
      { status: 201 },
    );
  });

  const owner = new TemporaryChatOwner(api);
  owner.syncContext('user-1', true);

  const h = componentHarness(mocks);
  const { TemporaryChatEntry } = h.load('src/components/TemporaryChatEntry.tsx');

  function syncProd() {
    h.production({
      temporaryChat: owner.getSnapshot(),
      temporaryChatActions: {
        open: owner.open,
        setDraft: owner.setDraft,
        send: owner.send,
        exitAndClear: owner.exitAndClear,
        retryPendingRemoteCloses: owner.retryPendingRemoteCloses,
        dismissCloseNotice: owner.dismissCloseNotice,
      },
    });
  }

  syncProd();
  h.render(h.jsx(TemporaryChatEntry, {}));
  const trigger = h.node('temporary-chat-entry-button');
  assert.ok(trigger);
  assert.equal(h.node('temporary-chat-modal'), undefined);

  await trigger.props.onPress();
  await settle();
  syncProd();
  h.render(h.jsx(TemporaryChatEntry, {}));

  const modal = h.node('temporary-chat-modal');
  assert.ok(modal);
  const modalText = text(collectHosts(modal));
  assert.ok(h.node('temporary-chat-empty-state'));
  assert.match(modalText, /不載入私人記憶、孩子資料、主聊天歷史或任務/);
  assert.match(modalText, /每日服務用量上限/);
  assert.match(modalText, /外部模型及搜索供應商/);
  assert.doesNotMatch(modalText, /確認後保存|授權設定|待確認事項|小晴/);
  assert.equal(collectHosts(modal).some(node => node.type === 'AgentAuthorization' || node.type === 'ChildPicker'), false);
  assert.equal(requests.length, 1);
  assert.equal(String(requests[0].url).includes('child'), false);
  h.unmount();
  owner.dispose();
});

test('3. Multi-turn temporary chat renders public citations + official help cards and stays isolated from child selection switches', async () => {
  const { mocks, linkingCalls } = uiMocks();
  const requests = [];
  const api = createTemporaryChatApi('https://example.test/api', async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    if (String(url).endsWith('/sessions')) {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: '22222222-2222-4222-8222-222222222222',
            generation: 1,
            createdAt: '2026-11-20T01:00:00Z',
            lastActivityAt: '2026-11-20T01:00:00Z',
            idleExpiresAt: '2026-11-20T01:15:00Z',
            hardExpiresAt: '2026-11-20T02:00:00Z',
            idleTtlMs: 900_000,
            maxLifetimeMs: 3_600_000,
          },
          messages: [],
        }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({
        session: {
          sessionId: '22222222-2222-4222-8222-222222222222',
          generation: 2,
          createdAt: '2026-11-20T01:00:00Z',
          lastActivityAt: '2026-11-20T01:01:00Z',
          idleExpiresAt: '2026-11-20T01:16:00Z',
          hardExpiresAt: '2026-11-20T02:00:00Z',
          idleTtlMs: 900_000,
          maxLifetimeMs: 3_600_000,
        },
        userMessage: { id: 'u1', role: 'user', text: '發燒飲水建議 [1]', createdAt: '2026-11-20T01:01:00Z' },
        modelMessage: {
          id: 'm1',
          role: 'model',
          text: '請鼓勵少量多次飲水。',
          createdAt: '2026-11-20T01:01:00Z',
          citations: [
            {
              id: 'cite-1',
              title: '兒童發燒護理',
              publisher: '衞生署',
              url: 'https://www.fhs.gov.hk/tc_chi/fever.html',
              classification: 'official_guidance',
              sourceDate: '2026-01-01',
              checkedAt: '2026-02-01',
              excerpt: '少量多次補充水分。',
              acquisition: 'library',
            },
          ],
          helpCards: ['medical-consult-hk-v1'],
        },
      }),
      { status: 200 },
    );
  });

  const owner = new TemporaryChatOwner(api);
  owner.syncContext('user-1', true);
  await owner.open();
  owner.setDraft('BB 退燒藥水幾多劑量');

  const h = componentHarness(mocks);
  const { TemporaryChatEntry } = h.load('src/components/TemporaryChatEntry.tsx');
  const syncProd = () =>
    h.production({
      temporaryChat: owner.getSnapshot(),
      temporaryChatActions: {
        open: owner.open,
        setDraft: owner.setDraft,
        send: owner.send,
        exitAndClear: owner.exitAndClear,
        retryPendingRemoteCloses: owner.retryPendingRemoteCloses,
        dismissCloseNotice: owner.dismissCloseNotice,
      },
    });
  syncProd();
  h.render(h.jsx(TemporaryChatEntry, {}));

  // Draft medical cue shows immediate official help card
  assert.ok(h.node('temporary-chat-draft-help'));

  await owner.send();
  // Calling syncContext with same userId after main app switches child does not wipe temporary session
  owner.syncContext('user-1', true);
  syncProd();
  h.render(h.jsx(TemporaryChatEntry, {}));

  const citation = h.node('temporary-chat-citation-cite-1');
  assert.ok(citation);
  const linkBtn = collectHosts(citation).find(n => n.type === 'Pressable');
  linkBtn.props.onPress();
  assert.deepEqual(linkingCalls, ['https://www.fhs.gov.hk/tc_chi/fever.html']);
  assert.equal(requests.every(req => !JSON.stringify(req).includes('childId')), true);
  assert.equal(owner.getSnapshot().messages.length, 2);
  h.unmount();
  owner.dispose();
});

test('4. Normal exit synchronously wipes local messages & draft, drops late in-flight reply, and shows remote confirmation', async () => {
  const { mocks } = uiMocks();
  let aborted = false;
  let resolveSlowSend;
  const api = createTemporaryChatApi('https://example.test/api', async (url, init) => {
    if (String(url).endsWith('/sessions')) {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: '33333333-3333-4333-8333-333333333333',
            generation: 1,
            createdAt: '2026-11-20T01:00:00Z',
            lastActivityAt: '2026-11-20T01:00:00Z',
            idleExpiresAt: '2026-11-20T01:15:00Z',
            hardExpiresAt: '2026-11-20T02:00:00Z',
            idleTtlMs: 900_000,
            maxLifetimeMs: 3_600_000,
          },
          messages: [],
        }),
        { status: 201 },
      );
    }
    if (String(url).endsWith('/messages')) {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return await new Promise(resolve => {
        resolveSlowSend = resolve;
      });
    }
    return new Response(
      JSON.stringify({
        receipt: {
          sessionId: '33333333-3333-4333-8333-333333333333',
          status: 'cleared',
          clearedAt: '2026-11-20T01:02:00Z',
          scope: 'application_controlled_only',
          cancelledInFlight: true,
          generation: 2,
        },
      }),
      { status: 200 },
    );
  });

  const owner = new TemporaryChatOwner(api);
  owner.syncContext('user-1', true);
  await owner.open();
  owner.setDraft('在途臨時問題');
  const sendPromise = owner.send();
  await settle();

  const exitPromise = owner.exitAndClear('user_exit');
  // Synchronously wiped before server close resolves
  assert.equal(owner.getSnapshot().open, false);
  assert.deepEqual(owner.getSnapshot().messages, []);
  assert.equal(owner.getSnapshot().draft, '');
  assert.equal(aborted, true);

  await exitPromise;
  assert.equal(owner.getSnapshot().closeState, 'remote_confirmed');
  assert.equal(owner.getSnapshot().closeNotice, TEMPORARY_CHAT_COPY.localAndRemoteClearedNotice);

  // Late response resolves after exit -> must be discarded completely
  resolveSlowSend(
    new Response(
      JSON.stringify({
        session: { sessionId: '33333333-3333-4333-8333-333333333333', generation: 2 },
        userMessage: { id: 'u-late', role: 'user', text: 'late', createdAt: '2026-11-20T01:02:00Z' },
        modelMessage: { id: 'm-late', role: 'model', text: 'late reply', createdAt: '2026-11-20T01:02:00Z' },
      }),
      { status: 200 },
    ),
  );
  await sendPromise;
  assert.equal(owner.getSnapshot().open, false);
  assert.deepEqual(owner.getSnapshot().messages, []);

  const h = componentHarness(mocks);
  const { TemporaryChatEntry } = h.load('src/components/TemporaryChatEntry.tsx');
  h.production({
    temporaryChat: owner.getSnapshot(),
    temporaryChatActions: {
      open: owner.open,
      setDraft: owner.setDraft,
      send: owner.send,
      exitAndClear: owner.exitAndClear,
      retryPendingRemoteCloses: owner.retryPendingRemoteCloses,
      dismissCloseNotice: owner.dismissCloseNotice,
    },
  });
  h.render(h.jsx(TemporaryChatEntry, {}));
  assert.ok(h.node('temporary-chat-close-confirmed-notice'));
  assert.equal(h.node('temporary-chat-close-pending-notice'), undefined);
  h.unmount();
  owner.dispose();
});

test('5. Offline/disconnected exit clears locally immediately, surfaces honest remote-pending notice, and converges on reconnect', async () => {
  const { mocks } = uiMocks();
  let closeAttempts = 0;
  const api = createTemporaryChatApi('https://example.test/api', async url => {
    if (String(url).endsWith('/sessions')) {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: '44444444-4444-4444-8444-444444444444',
            generation: 1,
            createdAt: '2026-11-20T01:00:00Z',
            lastActivityAt: '2026-11-20T01:00:00Z',
            idleExpiresAt: '2026-11-20T01:15:00Z',
            hardExpiresAt: '2026-11-20T02:00:00Z',
            idleTtlMs: 900_000,
            maxLifetimeMs: 3_600_000,
          },
          messages: [],
        }),
        { status: 201 },
      );
    }
    closeAttempts += 1;
    return new Response(
      JSON.stringify({
        receipt: {
          sessionId: '44444444-4444-4444-8444-444444444444',
          status: 'already_cleared',
          clearedAt: '2026-11-20T01:05:00Z',
          scope: 'application_controlled_only',
          cancelledInFlight: false,
          generation: 1,
        },
      }),
      { status: 200 },
    );
  });

  const owner = new TemporaryChatOwner(api);
  owner.syncContext('user-1', true);
  await owner.open();
  owner.setDraft('斷網前輸入文字');

  // Network drops -> user exits -> zero false "remote cleared" claim
  owner.syncContext('user-1', false);
  await owner.exitAndClear('user_exit');
  assert.equal(closeAttempts, 0);
  assert.equal(owner.getSnapshot().open, false);
  assert.equal(owner.getSnapshot().draft, '');
  assert.equal(owner.getSnapshot().closeState, 'local_cleared_remote_pending');
  assert.equal(owner.getSnapshot().pendingRemoteCloseCount, 1);

  const h = componentHarness(mocks);
  const { TemporaryChatEntry } = h.load('src/components/TemporaryChatEntry.tsx');
  const renderEntry = () => {
    h.production({
      temporaryChat: owner.getSnapshot(),
      temporaryChatActions: {
        open: owner.open,
        setDraft: owner.setDraft,
        send: owner.send,
        exitAndClear: owner.exitAndClear,
        retryPendingRemoteCloses: owner.retryPendingRemoteCloses,
        dismissCloseNotice: owner.dismissCloseNotice,
      },
    });
    h.render(h.jsx(TemporaryChatEntry, {}));
  };
  renderEntry();
  const pendingNode = h.node('temporary-chat-close-pending-notice');
  assert.ok(pendingNode);
  assert.match(text(pendingNode), /本機臨時對話已立即清除，但尚未收到伺服器確認清除/);
  assert.ok(h.node('temporary-chat-retry-close-button'));

  // Reconnect triggers automatic remote close reconciliation
  owner.syncContext('user-1', true);
  await settle();
  await settle();
  assert.equal(closeAttempts, 1);
  assert.equal(owner.getSnapshot().closeState, 'remote_confirmed');
  assert.equal(owner.getSnapshot().pendingRemoteCloseCount, 0);
  renderEntry();
  assert.ok(h.node('temporary-chat-close-confirmed-notice'));
  assert.equal(h.node('temporary-chat-retry-close-button'), undefined);
  h.unmount();
  owner.dispose();
});

test('6. Expired 410 session blocks resume & offers restart, and sign-out / user switch clears state immediately', async () => {
  const { mocks } = uiMocks();
  let createCount = 0;
  let closeReason = null;
  const api = createTemporaryChatApi('https://example.test/api', async (url, init) => {
    if (String(url).endsWith('/sessions')) {
      createCount += 1;
      return new Response(
        JSON.stringify({
          session: {
            sessionId: `55555555-5555-4555-8555-${String(createCount).padStart(12, '0')}`,
            generation: 1,
            createdAt: '2026-11-20T01:00:00Z',
            lastActivityAt: '2026-11-20T01:00:00Z',
            idleExpiresAt: '2026-11-20T01:15:00Z',
            hardExpiresAt: '2026-11-20T02:00:00Z',
            idleTtlMs: 900_000,
            maxLifetimeMs: 3_600_000,
          },
          messages: [],
        }),
        { status: 201 },
      );
    }
    if (String(url).endsWith('/messages')) {
      return new Response(
        JSON.stringify({
          error: { code: 'temporary_session_expired', message: TEMPORARY_CHAT_COPY.sessionExpiredNotice },
        }),
        { status: 410 },
      );
    }
    closeReason = JSON.parse(init.body).reason;
    return new Response(
      JSON.stringify({
        receipt: {
          sessionId: `55555555-5555-4555-8555-${String(createCount).padStart(12, '0')}`,
          status: 'cleared',
          clearedAt: '2026-11-20T01:20:00Z',
          scope: 'application_controlled_only',
          cancelledInFlight: false,
          generation: 2,
        },
      }),
      { status: 200 },
    );
  });

  const owner = new TemporaryChatOwner(api);
  owner.syncContext('user-a', true);
  await owner.open();
  owner.setDraft('過期後續接');
  await owner.send();

  assert.equal(owner.getSnapshot().phase, 'expired');
  assert.equal(owner.getSnapshot().session, null);
  assert.equal(owner.getSnapshot().error, TEMPORARY_CHAT_COPY.sessionExpiredNotice);

  const h = componentHarness(mocks);
  const { TemporaryChatEntry } = h.load('src/components/TemporaryChatEntry.tsx');
  h.production({
    temporaryChat: owner.getSnapshot(),
    temporaryChatActions: {
      open: owner.open,
      setDraft: owner.setDraft,
      send: owner.send,
      exitAndClear: owner.exitAndClear,
      retryPendingRemoteCloses: owner.retryPendingRemoteCloses,
      dismissCloseNotice: owner.dismissCloseNotice,
    },
  });
  h.render(h.jsx(TemporaryChatEntry, {}));
  const restartBtn = h.node('temporary-chat-restart-button');
  assert.ok(restartBtn);
  await restartBtn.props.onPress();
  await settle();
  assert.equal(createCount, 2);
  assert.equal(owner.getSnapshot().phase, 'ready');

  // User sign-out / switch clears active temporary session + notices cleanly
  owner.syncContext(null, true);
  await settle();
  assert.equal(closeReason, 'sign_out');
  assert.equal(owner.getSnapshot().available, false);
  assert.equal(owner.getSnapshot().open, false);
  assert.deepEqual(owner.getSnapshot().messages, []);
  assert.equal(owner.getSnapshot().closeNotice, null);
  h.unmount();
  owner.dispose();
});
