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

const { ProductAgentOwner } = loadTs('frontend/src/production/ProductAgentOwner.ts');
const { AgentAuthorizationOwner } = loadTs('frontend/src/production/AgentAuthorizationOwner.ts');
const { createProductAgentApi } = loadTs('src/client/product-agent-api.ts');
const { projectAgentProposal } = loadTs('frontend/src/production/agent-projection.ts');
const { extractProposalEditableDraft, applyProposalDraftEdit, buildProposalDiff } = loadTs('frontend/src/production/proposal-draft-edit.ts');
const { summarizePendingShortcut, isConfirmablePendingEntry } = loadTs('frontend/src/components/agent/pending-review-model.ts');
const { DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY, describeOperationUndoCapability } = loadTs('src/shared/operation-undo.ts');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childA = uuid(1);
const childB = uuid(2);
const runA = uuid(11);
const propA = uuid(21);
const propB = uuid(22);
const recA = uuid(31);
const noteA = uuid(41);
const factA = uuid(51);
const at = '2026-10-22T00:00:00Z';
const later = '2099-01-01T00:00:00Z';
const settle = () => new Promise(resolve => setImmediate(resolve));

function makeCareReviseProposal(patch = {}) {
  return {
    id: propA,
    runId: runA,
    childId: childA,
    version: 1,
    status: 'pending',
    createdAt: at,
    expiresAt: later,
    targetLabel: 'Feeding · 2026-10-22',
    result: null,
    value: {
      kind: 'care_record_revise',
      recordId: recA,
      expectedVersion: 3,
      text: 'Updated 150ml feeding note',
      details: {
        kind: 'feeding',
        quantity: { rawValue: '150', unit: 'ml', precision: 'exact' },
        eventTime: { rawText: '09:30', at: '2026-10-22T09:30:00+08:00', timeZone: 'Asia/Hong_Kong', precision: 'exact' },
      },
      reason: 'Parent corrected feeding volume',
      sourceQuote: '其實係飲咗 150ml 奶',
      previousText: 'Original 120ml feeding note',
    },
    ...patch,
  };
}

function makePrivateNoteCreateProposal(patch = {}) {
  return {
    id: propB,
    runId: runA,
    childId: childA,
    version: 1,
    status: 'pending',
    createdAt: at,
    expiresAt: later,
    targetLabel: null,
    result: null,
    value: {
      kind: 'private_note_create',
      title: 'Sleep cue draft',
      text: 'Prefer dim light before nap',
      sourceQuote: '午睡前較喜歡暗燈',
    },
    ...patch,
  };
}

function uiMocks({ pathname = '/', withCare = true } = {}) {
  const pushed = [];
  const dialog = Object.assign('Dialog', { Title: 'Title', Content: 'Content', ScrollArea: 'ScrollArea', Actions: 'Actions' });
  const mocks = {
    'react-native': { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: x => x, flatten: x => Object.assign({}, ...[x].flat(Infinity).filter(Boolean)) }, useWindowDimensions: () => ({ width: 1280 }) },
    'react-native-paper': { Text: 'Text', Portal: 'Portal' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-router': { usePathname: () => pathname, useRouter: () => ({ push: target => pushed.push(target) }), useLocalSearchParams: () => ({}) },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => fn => fn(), usePreviewLeaveGuard() {} },
    './preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink', usePreviewNavigation: () => fn => fn(), usePreviewLeaveGuard() {} },
    '../preview/PreviewNavigationGuard.tsx': { usePreviewNavigation: () => fn => fn(), usePreviewLeaveGuard() {} },
    '../components/ui': { AppButton: 'Button', AppTextField: 'AppTextField', SectionCard: 'SectionCard', SectionHeader: 'SectionHeader', TextLink: 'TextLink' },
    '../ui': { AppButton: 'Button', AppTextField: 'AppTextField', SectionCard: 'SectionCard', SectionHeader: 'SectionHeader', TextLink: 'TextLink' },
    '../AppIcon': { AppIcon: 'AppIcon' },
    '../components/AppIcon': { AppIcon: 'AppIcon' },
    '../AppStatusBadge': { AppStatusBadge: 'AppStatusBadge' },
    '../components/AppStatusBadge': { AppStatusBadge: 'AppStatusBadge' },
    '../AppCheckbox': { AppCheckbox: 'AppCheckbox' },
    '../components/AppCheckbox': { AppCheckbox: 'AppCheckbox' },
    '../AppRadioItem': { AppRadioItem: 'AppRadioItem' },
    '../components/AppRadioItem': { AppRadioItem: 'AppRadioItem' },
    '../EmptyListCard': { EmptyListCard: 'EmptyListCard' },
    '../components/EmptyListCard': { EmptyListCard: 'EmptyListCard' },
    '../ReadStateNotice': { ReadStateNotice: 'ReadStateNotice' },
    '../components/ReadStateNotice': { ReadStateNotice: 'ReadStateNotice' },
    '../StatusAnnouncement': { StatusAnnouncement: 'StatusAnnouncement' },
    '../components/StatusAnnouncement': { StatusAnnouncement: 'StatusAnnouncement' },
    '../AppDialog': { AppDialog: dialog },
    '../components/AppDialog': { AppDialog: dialog },
    './AppDialog': { AppDialog: dialog },
    './AppScrollView': { AppScrollView: 'ScrollView' },
    '../AppScrollView': { AppScrollView: 'ScrollView' },
    './AppIcon': { AppIcon: 'AppIcon' },
    './BrandLogo': { BrandLogo: 'BrandLogo' },
    '../branding': { brand: { homeLabel: '主頁' } },
    './ui': { AppButton: 'Button', AppTextField: 'AppTextField' },
    './ToolbarIconButton': { ToolbarIconButton: 'ToolbarIconButton' },
    './NotificationBell': { NotificationBell: 'NotificationBell' },
    './companion/SiteCompanion': { SiteCompanion: 'SiteCompanion' },
    './AgentEntryButton': { AgentEntryButton: 'AgentEntryButton' },
    './RightRailContent': { RightRailContent: 'RightRailContent' },
    './ChildKeyFacts': { ChildKeyFacts: 'ChildKeyFacts' },
    './ChildPicker': { ChildPicker: 'ChildPicker' },
    './CompactHeaderIdentity': { CompactHeaderIdentity: 'CompactHeaderIdentity' },
    './agent/MobileQuickInputDock': { MobileQuickInputDock: 'MobileQuickInputDock' },
    './navigation/RecordsNavButton': { RecordsNavButton: 'RecordsNavButton' },
    './navigation/MobileNavSelection': { MobileNavSelection: 'MobileNavSelection' },
    './navigation/app-navigation': { desktopNavigationGroups: [], navigationItems: { settings: { href: '/settings', label: '設定', short: '設定', icon: 'cog-outline' } } },
    './usePersonalHistory': { usePersonalHistoryWorkspace: () => null },
    '../components/history/PersistentWorkCards': { PersistentWorkCards: 'PersistentWorkCards' },
    '../components/chat/ChatAction': { ChatAction: 'Button' },
    '../chat/ChatAction': { ChatAction: 'Button' },
    '../components/chat/ChatMessage': { ChatMessage: 'ChatMessage' },
    '../chat/ChatMessage': { ChatMessage: 'ChatMessage' },
    '../components/chat/locateCitationSource': { locateCitationSource() {} },
    '../components/chat/chat-presentation': { chatColors: {}, chatFont: 'synthetic', chatType: {} },
    '../components/PageFrame': { PageFrame: 'PageFrame' },
    '../components/care/CareRecordsView': { CareRecordsView: 'CareRecordsView' },
    '../production/CareProfileDomains': { useProductionCareProfile: () => null },
    '../production/useDomainEnvironment': { useDomainEnvironment: () => ({ canStartWrite: () => true }) },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => null },
    './photosScreen': { PhotoWorkspace: 'PhotoWorkspace' },
    './ProactiveSettings': { ProactiveSettings: 'ProactiveSettings' },
    './routes': { isProductionRouteConnected: () => true },
    '../motion': {
      MotionDisclosure: p => ({ type: 'Disclosure', props: p, key: null }),
      MotionFeedback: p => ({ type: 'Feedback', props: p, key: null }),
      MotionReveal: p => p.children(p.value),
      MotionDrawerOverlay: 'MotionDrawerOverlay',
      MotionDrawerRight: 'MotionDrawerRight',
      MotionEntrance: 'MotionEntrance',
      MotionScopeBoundary: 'MotionScopeBoundary',
    },
    '../../motion': {
      MotionDisclosure: p => p.expanded ? { type: 'Disclosure', props: p, key: null } : null,
      MotionFeedback: p => ({ type: 'Feedback', props: p, key: null }),
      MotionReveal: p => p.children(p.value),
    },
    '../theme': { chineseFont: 'synthetic', colors: { ink: '#111', teal: '#222', paleTeal: '#eef', white: '#fff', muted: '#555', line: '#ccc', softLine: '#eee', quietSurface: '#f7f7f7', controlSurface: '#fff', accent: '#ff0', onAccent: '#111', coral: '#d00', errorInk: '#d00', warningInk: '#740', paleAmber: '#ffd', paleCoral: '#fdd' }, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, radius: { small: 8, medium: 12, large: 16, pill: 999 }, readingType: {}, workspaceType: {}, typeScale: { caption: 12, small: 14, body: 16, title: 20 }, mobileIcons: {}, mobileLayout: {}, mobileType: {} },
    '../../theme': { chineseFont: 'synthetic', colors: { ink: '#111', teal: '#222', deepTeal: '#123', paleTeal: '#eef', white: '#fff', muted: '#555', line: '#ccc', softLine: '#eee', quietSurface: '#f7f7f7', controlSurface: '#fff', errorInk: '#d00', warningInk: '#740', paleAmber: '#ffd', paleCoral: '#fdd', amber: '#a81', coral: '#d00' }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: { small: 8, medium: 12, large: 16 }, readingType: {}, workspaceType: {} },
  };
  if (!withCare) delete mocks['../components/agent/AgentRunView'];
  return { mocks, pushed };
}

test('summarizePendingShortcut matches /care count and attention states across offline, failed, denied, expired and shared-child scopes', () => {
  const validEntry = { runId: runA, proposal: projectAgentProposal(makeCareReviseProposal()) };
  const expiredEntry = { runId: runA, proposal: projectAgentProposal(makeCareReviseProposal({ id: propB, status: 'expired' })) };
  const invalidatedEntry = { runId: runA, proposal: projectAgentProposal(makePrivateNoteCreateProposal({ contentState: 'invalidated' })) };

  assert.equal(isConfirmablePendingEntry(validEntry), true);
  assert.equal(isConfirmablePendingEntry(expiredEntry), false);
  assert.equal(isConfirmablePendingEntry(invalidatedEntry), false);

  const readyOne = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'ready', hasSnapshot: true, entries: [validEntry, expiredEntry, invalidatedEntry], nextCursor: null },
    pendingDecision: null,
    readState: 'ready',
  });
  assert.equal(readyOne.visible, true);
  assert.equal(readyOne.confirmableCount, 1);
  assert.equal(readyOne.loadedCountLabel, '1');
  assert.equal(readyOne.badgeText, '1');
  assert.equal(readyOne.accessibilityLabel, '開啟待確認草稿，已載入 1 項');

  const readyMore = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'ready', hasSnapshot: true, entries: [expiredEntry], nextCursor: 'cursor-1' },
    pendingDecision: null,
    readState: 'ready',
  });
  assert.equal(readyMore.loadedCountLabel, '0+');
  assert.equal(readyMore.badgeText, '0+');

  const quietRefreshing = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'loading', hasSnapshot: true, entries: [validEntry], nextCursor: null },
    pendingDecision: null,
    readState: 'ready',
  });
  assert.equal(quietRefreshing.loadedCountLabel, '1');
  assert.equal(quietRefreshing.badgeText, '1');

  const unknownDecision = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'ready', hasSnapshot: true, entries: [], nextCursor: null },
    pendingDecision: { runId: runA, proposalId: propA, input: { expectedVersion: 1, decision: 'accept', confirmShared: true }, reviewed: false, reconfirm: false },
    readState: 'ready',
  });
  assert.equal(unknownDecision.badgeText, '!');
  assert.match(unknownDecision.accessibilityLabel, /未確認操作結果待查核/);

  const offline = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: false,
    pending: { state: 'ready', hasSnapshot: true, entries: [validEntry], nextCursor: null },
    pendingDecision: null,
    readState: 'ready',
  });
  assert.equal(offline.loadedCountLabel, undefined);
  assert.equal(offline.badgeText, undefined);
  assert.match(offline.accessibilityLabel, /數量尚未核對/);

  const denied = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'denied', entries: [], nextCursor: null },
    pendingDecision: null,
    readState: 'denied',
  });
  assert.equal(denied.denied, true);
  assert.equal(denied.badgeText, undefined);

  const hiddenSignedOut = summarizePendingShortcut({
    scopeKey: null,
    online: true,
    pending: { state: 'ready', entries: [validEntry], nextCursor: null },
    pendingDecision: null,
    readState: 'ready',
  });
  assert.equal(hiddenSignedOut.visible, false);

  const hiddenShared = summarizePendingShortcut({
    scopeKey: 'scope-a',
    online: true,
    pending: { state: 'ready', entries: [validEntry], nextCursor: null },
    pendingDecision: null,
    readState: 'ready',
    sharedChildActive: true,
  });
  assert.equal(hiddenShared.visible, false);
});

test('PendingReviewShortcut and /care AgentPendingReview share the single ProductAgentOwner so decisions synchronize immediately', async () => {
  let currentProposals = [makeCareReviseProposal()];
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (String(url).endsWith('/pending')) {
      return Response.json({
        proposals: currentProposals.filter(p => p.status === 'pending' || p.status === 'expired'),
        nextCursor: null,
      });
    }
    if (String(url).endsWith('/decide') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      const updated = {
        ...currentProposals[0],
        version: body.expectedVersion + 1,
        status: body.decision === 'accept' ? 'accepted' : 'dismissed',
        result: body.decision === 'accept' ? { kind: 'care_record', id: recA, version: 4 } : null,
      };
      currentProposals = [updated];
      return Response.json({ proposal: updated });
    }
    return Response.json({
      result: {
        provenance: null,
        runId: runA,
        status: 'completed',
        stopReason: null,
        text: 'Prepared care revise draft',
        citations: [],
        retrievalMode: 'not_used',
        tools: [],
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
        proposals: currentProposals,
      },
    });
  };

  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => createProductAgentApi('/api', fetcher), fetcher);
  owner.syncContext({ key: 'scope-a', childId: childA, userId: 'parent-a' }, true, { identityKey: 'parent-a' });
  await owner.readPending();

  const { mocks, pushed } = uiMocks({ pathname: '/care' });
  const h = componentHarness(mocks);
  let idSeq = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`id-${++idSeq}`).current };
  const { PendingReviewShortcut } = h.load('src/components/PendingReviewShortcut.tsx');
  const { AgentPendingReview } = h.load('src/screens/careScreen.tsx');

  function BothSurfaces() {
    return h.jsx('View', {
      children: [
        h.jsx(PendingReviewShortcut, {}),
        h.jsx(AgentPendingReview, {}),
      ],
    });
  }
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);

  const render = () => {
    const snap = owner.getSnapshot();
    h.production({
      scopeKey: 'scope-a',
      selectedChildId: childA,
      online: snap.model.online,
      sharedChild: { target: null },
      agentPending: snap.pending,
      agentModel: snap.model,
      agentActions: {
        refresh: owner.refresh,
        setSharedConfirmation: owner.setSharedConfirmation,
        decide: owner.decide,
        retryOriginal: owner.retryOriginal,
        editProposal: owner.editProposal,
        openSource() {},
      },
      readAgentPending: owner.readPending,
      selectAgentRun: owner.selectRun,
    });
    h.render(h.jsx(BothSurfaces, {}));
  };

  render();
  assert.equal(h.node('header-pending-badge').props.children.props.children, '1');
  assert.ok(h.node(`care-pending-card-${runA}-${propA}`));
  assert.equal(h.node(`shortcut-pending-card-${runA}-${propA}`), undefined, 'shortcut dialog is initially closed');

  h.hosts().find(n => n.type === 'ToolbarIconButton').props.onPress();
  await settle();
  render();

  const shortcutCard = h.node(`shortcut-pending-card-${runA}-${propA}`);
  assert.ok(shortcutCard);
  shortcutCard.props.onPress();
  await settle();
  render();

  assert.equal(button('確認資料').props.disabled, true, 'family proposal requires explicit shared confirmation inside shortcut too');
  h.hosts().find(n => n.type === 'AppCheckbox').props.onChange(true);
  render();
  assert.equal(button('確認資料').props.disabled, false);

  button('確認資料').props.onPress();
  await settle();
  render();

  assert.equal(calls.filter(c => c.url.endsWith('/decide')).length, 1);
  assert.equal(h.node('header-pending-badge'), undefined, 'badge clears after shortcut decision');
  assert.equal(h.node(`care-pending-card-${runA}-${propA}`), undefined, '/care drops confirmed card simultaneously');
  assert.ok(h.hosts().some(n => n.type === 'EmptyListCard' && n.props.title === '暫無可確認事項'));

  button('前往核對頁').props.onPress();
  assert.deepEqual(pushed, ['/care']);
  h.unmount();
  owner.dispose();
});

test('PendingReviewShortcut closes on scope change, locks controls while writing, and switches back cleanly via 返回待確認清單', async () => {
  let currentScope = 'scope-a';
  const readCalls = [];
  let resolveWrite;
  const fetcher = async (url, init) => {
    readCalls.push(`${init?.method ?? 'GET'}:${url}`);
    if (String(url).endsWith('/pending')) {
      return Response.json({ proposals: [makePrivateNoteCreateProposal()], nextCursor: null });
    }
    if (String(url).endsWith('/edit')) {
      return new Promise(resolve => { resolveWrite = resolve; });
    }
    return Response.json({
      result: {
        provenance: null,
        runId: runA,
        status: 'completed',
        stopReason: null,
        text: 'Prepared private note draft',
        citations: [],
        retrievalMode: 'not_used',
        tools: [],
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
        proposals: [makePrivateNoteCreateProposal()],
      },
    });
  };

  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => createProductAgentApi('/api', fetcher), fetcher);
  owner.syncContext({ key: 'scope-a', childId: childA, userId: 'parent-a' }, true, { identityKey: 'parent-a' });

  const { mocks } = uiMocks({ pathname: '/tasks' });
  const h = componentHarness(mocks);
  let idSeq = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`sc-${++idSeq}`).current };
  const { PendingReviewShortcut } = h.load('src/components/PendingReviewShortcut.tsx');
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);

  const render = () => {
    const snap = owner.getSnapshot();
    h.production({
      scopeKey: currentScope,
      selectedChildId: currentScope === 'scope-a' ? childA : childB,
      online: true,
      sharedChild: { target: null },
      agentPending: snap.pending,
      agentModel: snap.model,
      agentActions: {
        refresh: owner.refresh,
        setSharedConfirmation: owner.setSharedConfirmation,
        decide: owner.decide,
        retryOriginal: owner.retryOriginal,
        editProposal: owner.editProposal,
        openSource() {},
      },
      readAgentPending: owner.readPending,
      selectAgentRun: owner.selectRun,
    });
    h.render(h.jsx(PendingReviewShortcut, {}));
  };

  render();
  assert.equal(owner.getSnapshot().pending.state, 'idle');
  h.hosts().find(n => n.type === 'ToolbarIconButton').props.onPress();
  await settle();
  render();
  assert.ok(readCalls.some(c => c.includes('/pending')), 'cold open triggers authoritative pending read');

  h.node(`shortcut-pending-card-${runA}-${propB}`).props.onPress();
  await settle();
  render();
  assert.ok(button('返回待確認清單'));

  const editPromise = owner.editProposal(propB, { title: 'Updated note title', content: 'Updated note body' });
  render();
  assert.equal(button('關閉').props.disabled, true);
  assert.equal(button('前往核對頁').props.disabled, true);
  assert.equal(button('返回待確認清單').props.disabled, true);

  resolveWrite(Response.json({ proposal: { ...makePrivateNoteCreateProposal(), version: 2, value: { kind: 'private_note_create', title: 'Updated note title', text: 'Updated note body', sourceQuote: '午睡前較喜歡暗燈' } } }));
  assert.equal(await editPromise, true);
  render();
  assert.equal(button('關閉').props.disabled, false);

  button('返回待確認清單').props.onPress();
  render();
  assert.ok(h.node(`shortcut-pending-card-${runA}-${propB}`));

  currentScope = 'scope-b';
  owner.syncContext({ key: 'scope-b', childId: childB, userId: 'parent-a' }, true, { identityKey: 'parent-a' });
  render();
  assert.equal(h.hosts().find(n => n.props?.accessibilityLabel === '待確認草稿快捷入口').props.visible, false, 'switching child closes shortcut dialog cleanly');

  h.unmount();
  owner.dispose();
});

test('extractProposalEditableDraft, applyProposalDraftEdit and buildProposalDiff handle all 8 editable kinds and preserve immutable metadata', () => {
  const editableCases = [
    {
      value: {
        kind: 'care_record_create',
        text: 'Original note',
        details: { kind: 'note', quantity: null, eventTime: { rawText: '', at: null, timeZone: 'Asia/Hong_Kong', precision: 'unknown' } },
        sourceQuote: 'keep quote',
      },
      edit: { content: '  Edited note  ' },
      assertResult: next => {
        assert.equal(next.text, 'Edited note');
        assert.equal(next.sourceQuote, 'keep quote');
        assert.equal(next.details.kind, 'note');
      },
    },
    {
      value: makeCareReviseProposal().value,
      edit: { content: 'Edited 160ml', reason: 'Confirmed bottle measurement' },
      assertResult: next => {
        assert.equal(next.recordId, recA);
        assert.equal(next.expectedVersion, 3);
        assert.equal(next.previousText, 'Original 120ml feeding note');
        assert.equal(next.sourceQuote, '其實係飲咗 150ml 奶');
        assert.equal(next.text, 'Edited 160ml');
        assert.equal(next.reason, 'Confirmed bottle measurement');
      },
    },
    {
      value: makePrivateNoteCreateProposal().value,
      edit: { title: 'Edited title', content: 'Edited body' },
      assertResult: next => {
        assert.equal(next.title, 'Edited title');
        assert.equal(next.text, 'Edited body');
        assert.equal(next.sourceQuote, '午睡前較喜歡暗燈');
      },
    },
    {
      value: { kind: 'private_note_revise', noteId: noteA, expectedVersion: 2, title: 'Old title', text: 'Old body', sourceQuote: 'keep quote', previousTitle: 'Orig title', previousText: 'Orig body' },
      edit: { title: 'New title', content: 'New body' },
      assertResult: next => {
        assert.equal(next.noteId, noteA);
        assert.equal(next.expectedVersion, 2);
        assert.equal(next.previousTitle, 'Orig title');
        assert.equal(next.previousText, 'Orig body');
        assert.equal(next.title, 'New title');
        assert.equal(next.text, 'New body');
      },
    },
    {
      value: { kind: 'task_create', values: { title: 'Check fever', details: 'Before bed', kind: 'ordinary', assigneeUserId: 'parent-a', dueAt: later, timeZone: 'Asia/Hong_Kong' } },
      edit: { title: 'Check temp again', content: '' },
      assertResult: next => {
        assert.equal(next.values.title, 'Check temp again');
        assert.equal(next.values.details, '');
        assert.equal(next.values.dueAt, later);
      },
    },
    {
      value: { kind: 'memory_fact', key: 'Allergy', content: 'No peanut', intendedVisibility: 'private', validUntil: null },
      edit: { title: 'Food allergy', content: 'Avoid peanuts' },
      assertResult: next => {
        assert.equal(next.key, 'Food allergy');
        assert.equal(next.content, 'Avoid peanuts');
        assert.equal(next.intendedVisibility, 'private');
      },
    },
    {
      value: { kind: 'memory_fact_revise', factId: factA, expectedVersion: 4, key: 'Nap time', content: '13:30 daily', validUntil: null, sourceMessageId: uuid(88), reason: 'Routine shifted' },
      edit: { title: 'Nap window', content: '14:00 daily', reason: 'Updated routine' },
      assertResult: next => {
        assert.equal(next.factId, factA);
        assert.equal(next.expectedVersion, 4);
        assert.equal(next.sourceMessageId, uuid(88));
        assert.equal(next.content, '14:00 daily');
      },
    },
    {
      value: { kind: 'concern_create', values: { title: 'Appetite', reason: 'Less milk', observation: 'Left 50ml', observedAt: at, links: { recordId: null, taskId: null, attentionId: null }, followUpAt: null } },
      edit: { title: 'Milk intake', content: 'Left 40ml twice', reason: 'Follow up needed' },
      assertResult: next => {
        assert.equal(next.values.observedAt, at);
        assert.equal(next.values.title, 'Milk intake');
        assert.equal(next.values.observation, 'Left 40ml twice');
        assert.equal(next.values.reason, 'Follow up needed');
      },
    },
  ];

  for (const item of editableCases) {
    const draft = extractProposalEditableDraft(item.value);
    assert.ok(draft, `${item.value.kind} must expose inline editable metadata`);
    assert.equal(applyProposalDraftEdit(item.value, { title: draft.title, content: draft.content, reason: draft.reason }), null, `${item.value.kind}: no-op edit must return null`);
    const updated = applyProposalDraftEdit(item.value, item.edit);
    assert.ok(updated);
    item.assertResult(updated);
    const diff = buildProposalDiff({ id: propA, runId: runA, childId: childA, version: 1, status: 'pending', createdAt: at, expiresAt: later, targetLabel: 'Target A', result: null, value: updated });
    if (item.value.kind !== 'memory_fact') assert.ok(diff, `${item.value.kind}: buildProposalDiff should produce readable before/after summary`);
  }

  assert.equal(applyProposalDraftEdit(makePrivateNoteCreateProposal().value, { title: '   ', content: 'Valid' }), null);
  assert.equal(applyProposalDraftEdit(makeCareReviseProposal().value, { content: 'Valid', reason: '' }), null);

  for (const structuralKind of [
    { kind: 'memory_fact_deactivate', factId: factA, expectedVersion: 1, reason: 'Outdated' },
    { kind: 'task_change', taskId: uuid(77), change: { action: 'cancel', expectedVersion: 1, confirm: true, note: 'Done' } },
    { kind: 'concern_change', concernId: uuid(78), change: { action: 'archive', expectedVersion: 1, authorityVersion: 'v1', confirm: true } },
    { kind: 'family_document_change', documentId: uuid(79), change: { action: 'patch', expectedVersion: 1, authorityVersion: 'v1', edits: [{ op: 'set_metadata', title: 'Doc' }] } },
    { kind: 'private_source_create', input: { kind: 'personal_source', sourceLabel: 'Doc', sourceUrl: null, sourceDateText: null, sourceNotes: '', text: 'Body' }, management: { intention: '', purpose: 'answer_reference', nature: 'unspecified', timeScope: 'unspecified', validityText: '', enabled: false, modelExcerpt: null } },
    { kind: 'private_source_change', inputId: uuid(80), change: { expectedVersion: 1, management: { intention: '', purpose: 'answer_reference', nature: 'unspecified', timeScope: 'unspecified', validityText: '', enabled: false, modelExcerpt: null } } },
  ]) {
    assert.equal(extractProposalEditableDraft(structuralKind), undefined, `${structuralKind.kind} stays non-editable`);
  }

  assert.equal(
    buildProposalDiff(makeCareReviseProposal({ contentState: 'invalidated' })),
    null,
    'invalidated proposals omit diff so stale candidate text is not exposed',
  );
});

test('ProductAgentOwner.editProposal updates version across run & pending discovery, clears sharedConfirmed and surfaces 409 conflicts safely', async () => {
  const proposal = makeCareReviseProposal();
  let mode = 'ok';
  const apiCalls = [];
  const fetcher = async (url, init) => {
    apiCalls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/pending')) return Response.json({ proposals: [proposal], nextCursor: null });
    if (String(url).endsWith('/edit')) {
      if (mode === 'conflict') return Response.json({ error: { code: 'version_conflict' } }, { status: 409 });
      if (mode === 'offline_err') throw new Error('Synthetic failure');
      const body = JSON.parse(init.body);
      return Response.json({
        proposal: { ...proposal, version: body.expectedVersion + 1, value: body.value },
      });
    }
    return Response.json({
      result: {
        provenance: null,
        runId: runA,
        status: 'completed',
        stopReason: null,
        text: 'Prepared revise',
        citations: [],
        retrievalMode: 'not_used',
        tools: [],
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
        proposals: [proposal],
      },
    });
  };

  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => createProductAgentApi('/api', fetcher), fetcher);
  owner.syncContext({ key: 'scope-a', childId: childA, userId: 'parent-a' }, true, { identityKey: 'parent-a' });
  await owner.readPending();
  owner.selectRun(runA);
  await settle();
  owner.setSharedConfirmation(propA, true);
  assert.equal(owner.getSnapshot().model.sharedConfirmed[propA], true);

  const ok = await owner.editProposal(propA, { content: 'Edited 180ml feeding', reason: 'Double checked scale' });
  assert.equal(ok, true);
  const afterOk = owner.getSnapshot();
  assert.equal(afterOk.model.run.proposals[0].version, 2);
  assert.equal(afterOk.model.run.proposals[0].content, 'Edited 180ml feeding');
  assert.equal(afterOk.pending.entries[0].proposal.version, 2);
  assert.equal(afterOk.pending.entries[0].proposal.content, 'Edited 180ml feeding');
  assert.deepEqual(afterOk.model.sharedConfirmed, {});
  assert.match(afterOk.model.notice.text, /草稿已更新至版本 2/);

  mode = 'conflict';
  const conflictOk = await owner.editProposal(propA, { content: 'Another edit', reason: 'Conflict reason' });
  assert.equal(conflictOk, false);
  assert.equal(owner.getSnapshot().model.run.proposals[0].version, 2);
  assert.match(owner.getSnapshot().model.notice.text, /草稿或原資料版本已變更/);

  mode = 'offline_err';
  const errOk = await owner.editProposal(propA, { content: 'Network edit', reason: 'Err reason' });
  assert.equal(errOk, false);
  assert.equal(owner.getSnapshot().model.run.proposals[0].version, 2);
  assert.match(owner.getSnapshot().model.notice.text, /未能更新草稿/);
  owner.dispose();
});

test('AgentRunView shows readable before/after diff, locks confirm during inline edit, saves v+1 draft and displays factual undo capabilities', async () => {
  const initialProposal = makeCareReviseProposal();
  let serverProposal = initialProposal;
  const fetcher = async (url, init) => {
    if (String(url).endsWith('/edit')) {
      const body = JSON.parse(init.body);
      serverProposal = { ...initialProposal, version: body.expectedVersion + 1, value: body.value };
      return Response.json({ proposal: serverProposal });
    }
    if (String(url).endsWith('/decide')) {
      const body = JSON.parse(init.body);
      serverProposal = { ...serverProposal, version: body.expectedVersion + 1, status: 'accepted', result: { kind: 'care_record', id: recA, version: 4 } };
      return Response.json({ proposal: serverProposal });
    }
    return Response.json({
      result: {
        provenance: null,
        runId: runA,
        status: 'completed',
        stopReason: null,
        text: 'Care revise ready',
        citations: [],
        retrievalMode: 'not_used',
        tools: [],
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
        proposals: [serverProposal],
      },
    });
  };

  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => createProductAgentApi('/api', fetcher), fetcher);
  owner.syncContext({ key: 'scope-a', childId: childA, userId: 'parent-a' }, true, { identityKey: 'parent-a' });
  owner.selectRun(runA);
  await settle();

  const { mocks } = uiMocks({ pathname: '/care' });
  const h = componentHarness(mocks);
  let idSeq = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`run-${++idSeq}`).current };
  const { AgentRunView } = h.load('src/components/agent/AgentRunView.tsx');
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);

  const render = () => {
    const model = owner.getSnapshot().model;
    h.render(h.jsx(AgentRunView, {
      model,
      actions: {
        refresh: owner.refresh,
        setSharedConfirmation: owner.setSharedConfirmation,
        decide: owner.decide,
        retryOriginal: owner.retryOriginal,
        editProposal: owner.editProposal,
        openSource() {},
      },
    }));
  };
  const allText = () => h.hosts().filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).join(' ');

  render();
  assert.ok(h.node(`agent-proposal-diff-${propA}`));
  assert.match(allText(), /Original 120ml feeding note/);
  assert.match(allText(), /Updated 150ml feeding note/);
  assert.match(allText(), /草稿版本：版本 1/);
  assert.equal(h.node(`agent-draft-cancel-note-${propA}`).props.children, DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY);

  h.hosts().find(n => n.type === 'AppCheckbox').props.onChange(true);
  render();
  assert.equal(button('確認資料').props.disabled, false);

  button('修改草稿').props.onPress();
  render();
  assert.ok(h.node(`agent-proposal-editor-${propA}`));
  assert.equal(button('確認資料').props.disabled, true, 'confirm stays locked while inline editor is open');
  assert.equal(button('略過').props.disabled, true);
  assert.equal(button('保存草稿修改').props.disabled, true, 'unchanged draft cannot submit no-op edit');

  const fields = h.hosts().filter(n => n.type === 'AppTextField');
  const contentField = fields.find(f => f.props.label === '建議照護記錄內容');
  contentField.props.onChangeText('   ');
  render();
  assert.match(allText(), /請輸入建議照護記錄內容/);
  assert.equal(button('保存草稿修改').props.disabled, true);

  h.hosts().filter(n => n.type === 'AppTextField').find(f => f.props.label === '建議照護記錄內容').props.onChangeText('Final 175ml feeding note');
  render();
  assert.equal(button('保存草稿修改').props.disabled, false);
  button('保存草稿修改').props.onPress();
  await settle();
  render();

  assert.equal(h.node(`agent-proposal-editor-${propA}`), undefined);
  assert.match(allText(), /Final 175ml feeding note/);
  assert.match(allText(), /草稿版本：版本 2/);
  assert.equal(button('確認資料').props.disabled, true, 'fresh sharing consent required after editing draft version');

  h.hosts().find(n => n.type === 'AppCheckbox').props.onChange(true);
  render();
  button('確認資料').props.onPress();
  await settle();
  render();

  button('查看詳情').props.onPress();
  render();
  const careUndo = describeOperationUndoCapability('care_record');
  assert.ok(allText().includes(careUndo.label));
  assert.ok(allText().includes(careUndo.limitation));

  owner.dispose();
});

test('AgentConversation direct receipts display truthful resource undo capabilities vs limitations', () => {
  const { mocks } = uiMocks({ pathname: '/chat', withCare: false });
  const h = componentHarness(mocks);
  let idSeq = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`conv-${++idSeq}`).current };
  const { AgentConversation } = h.load('src/production/AgentConversation.tsx');

  h.production({
    scopeKey: 'scope-a',
    agentModel: {
      online: true,
      readState: 'ready',
      busy: null,
      writesBlocked: false,
      pendingDecision: null,
      sharedConfirmed: {},
      notice: null,
      loadedAt: at,
      run: {
        id: runA,
        childId: childA,
        status: 'completed',
        createdAt: at,
        text: 'Saved both',
        stopReasonLabel: null,
        stopReasonDetail: null,
        counts: { modelCalls: 1, toolCalls: 2, queryEmbeddings: 0 },
        retrievalMode: 'not_used',
        tools: [],
        proposals: [],
        citations: [],
      },
    },
    agentActions: { refresh() {}, setSharedConfirmation() {}, decide() {}, retryOriginal() {}, openSource() {} },
    agentInboxActions: { refresh() {}, select() {}, collapse() {} },
    agentPending: { state: 'ready', entries: [], hasSnapshot: true, nextCursor: null },
    readAgentPending() {},
    selectAgentRun() {},
    authorization: {
      online: true,
      receipts: {
        [runA]: {
          state: 'ready',
          items: [
            { id: 'r1', runId: runA, kind: 'save_record', resource: { kind: 'care_record', id: recA, version: 1 }, state: 'saved', notification: 'not_authorized', channels: [], createdAt: at },
            { id: 'r2', runId: runA, kind: 'save_private_note', resource: { kind: 'private_note', id: noteA, version: 1 }, state: 'saved', notification: 'not_authorized', channels: [], createdAt: at },
          ],
        },
      },
    },
    authorizationActions: { readReceipts() {} },
  });

  h.render(h.jsx(AgentConversation, { visible: true, entry: 'detail', onDismiss() {}, onOpenSettings() {}, onReloadChat() {}, reloadDisabled: false }));
  const r1Undo = h.node('agent-receipt-undo-r1');
  const r2Undo = h.node('agent-receipt-undo-r2');
  assert.ok(r1Undo);
  assert.ok(r2Undo);
  assert.match(r1Undo.props.children.join(''), /無歷史一鍵撤銷（可更正）/);
  assert.match(r2Undo.props.children.join(''), /可刪除原私人備註/);
  h.unmount();
});

test('AgentAuthorizationOwner & AgentAuthorization manage executionMode selection, dirty state, save submission and unknown recovery', async () => {
  let serverPolicy = {
    version: 1,
    effective: true,
    executionMode: 'confirm_first',
    recordKinds: ['feeding'],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
  };
  let putShouldFail = false;
  const requests = [];
  const fetcher = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), method, body });
    if (String(url).includes('/agent/policy') && method === 'POST') {
      if (putShouldFail) throw new Error('Synthetic transport drop');
      serverPolicy = {
        version: body.expectedVersion + 1,
        effective: true,
        executionMode: body.executionMode,
        recordKinds: body.recordKinds,
        allowPrivateNotes: body.allowPrivateNotes,
        allowSelfTasks: body.allowSelfTasks,
        allowRecordCorrections: body.allowRecordCorrections,
        reminderConsentVersion: body.reminderConsentVersion,
        reminderBindings: body.reminderBindings,
      };
      return Response.json({ policy: serverPolicy });
    }
    return Response.json({ policy: serverPolicy });
  };

  const authOwner = new AgentAuthorizationOwner('/api', true, () => {}, () => {}, fetcher);
  authOwner.syncContext({ key: 'scope-a', userId: 'parent-a', childId: childA }, true);
  await authOwner.readPolicy();
  assert.equal(authOwner.getSnapshot().draft.executionMode, 'confirm_first');

  const { mocks } = uiMocks({ pathname: '/settings' });
  const h = componentHarness(mocks);
  const { AgentAuthorization } = h.load('src/production/AgentAuthorization.tsx');
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);

  const render = () => {
    const auth = authOwner.getSnapshot();
    h.production({
      scopeKey: 'scope-a',
      authorization: auth,
      owner: { authorizationOwner: authOwner },
      authorizationActions: {
        readPolicy: authOwner.readPolicy,
        readContact: authOwner.readContact,
        readNotes: authOwner.readNotes,
        setDraft: authOwner.setDraft,
        setSharedConfirmation: authOwner.setSharedConfirmation,
        setQuery: authOwner.setQuery,
        save: authOwner.savePolicy,
        deleteNote: authOwner.deleteNote,
        retryOriginal: authOwner.retryOriginal,
        readReceipts: authOwner.readReceipts,
      },
    });
    h.render(h.jsx(AgentAuthorization, { active: true }));
  };

  render();
  const modeSelector = h.node('agent-execution-mode-selector');
  assert.ok(modeSelector);
  const radios = h.hosts().filter(n => n.type === 'AppRadioItem');
  assert.equal(radios.find(r => r.props.value === 'confirm_first').props.checked, true);
  assert.equal(radios.find(r => r.props.value === 'auto_authorized').props.checked, false);

  radios.find(r => r.props.value === 'auto_authorized').props.onPress();
  render();
  assert.equal(h.hosts().filter(n => n.type === 'AppRadioItem').find(r => r.props.value === 'auto_authorized').props.checked, true);
  assert.equal(button('確認保存授權').props.disabled, true, 'shared scope still requires explicit shared confirmation checkbox');

  h.hosts().find(n => n.type === 'AppCheckbox' && String(n.props.label).includes('明確同意')).props.onChange(true);
  render();
  assert.equal(button('確認保存授權').props.disabled, false);

  putShouldFail = true;
  button('確認保存授權').props.onPress();
  await settle();
  render();
  const pendingText = h.hosts().filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).join(' ');
  assert.match(pendingText, /原設定：\s*授權內自動保存/);

  putShouldFail = false;
  await authOwner.readPolicy();
  render();
  h.hosts().find(n => n.type === 'AppCheckbox' && String(n.props.label).includes('明確同意')).props.onChange(true);
  render();
  button('明確重試原操作').props.onPress();
  await settle();
  render();

  const lastPut = requests.filter(r => r.method === 'POST').at(-1);
  assert.equal(lastPut.body.executionMode, 'auto_authorized');
  assert.equal(authOwner.getSnapshot().policy.executionMode, 'auto_authorized');
  assert.equal(authOwner.getSnapshot().policy.version, 2);

  // Legacy policy without executionMode infers auto_authorized when ordinary auto permissions exist.
  serverPolicy = {
    version: 3,
    effective: true,
    recordKinds: ['sleep'],
    allowPrivateNotes: false,
    allowSelfTasks: false,
    allowRecordCorrections: false,
    reminderConsentVersion: null,
    reminderBindings: [],
  };
  await authOwner.readPolicy();
  assert.equal(authOwner.getSnapshot().draft.executionMode, 'auto_authorized');
  h.unmount();
  authOwner.dispose();
});

test('AppShell and NativeAppShell both place PendingReviewShortcut inside header-actions before NotificationBell', () => {
  const { mocks } = uiMocks({ pathname: '/' });
  mocks['./PendingReviewShortcut'] = { PendingReviewShortcut: 'PendingReviewShortcut' };
  mocks['./AppScrollView'] = { AppScrollView: 'ScrollView' };
  mocks['./ChildPicker'] = { ChildPicker: () => null };
  mocks['../workspaces/TasksWorkspace'] = { useTasksWorkspace: () => null };
  mocks['../startup/dataReadiness'] = {
    combineStartupReadiness: () => 'ready',
    startupReadState: () => 'ready',
    visibleRailStartupReadiness: () => 'ready',
    visibleRailStartupRequirements: () => [],
  };
  mocks['../production/ProductionFirstScreenGate'] = { useProductionSwitchReadiness: () => ({ state: 'ready', key: 'ok' }) };
  mocks['../production/useProductionHome'] = {
    useProductionHome: () => ({
      model: { children: [{ id: childA, displayName: 'A' }], selectedChildId: childA, profileLoad: 'ready' },
      actions: { selectChild() {} },
      notice: null,
      dismissNotice() {},
      scopeKey: 'scope-a',
      identityKey: 'parent-a',
      sharedChild: { target: null },
      setContextRailVisible() {},
    }),
  };
  mocks['../production/useHeaderOperationHints'] = { useHeaderOperationHints: () => [] };
  const h = componentHarness(mocks);
  const { AppShell } = h.load('src/components/AppShell.tsx');
  const { NativeAppShell } = h.load('src/components/NativeAppShell.tsx');

  h.render(h.jsx(AppShell, { children: h.jsx('View', {}, 'child') }));
  const webHeaderChildren = h.node('header-actions').props.children.flat().filter(Boolean);
  assert.equal(webHeaderChildren[0].type, 'PendingReviewShortcut');
  assert.equal(webHeaderChildren[1].type, 'NotificationBell');

  h.render(h.jsx(NativeAppShell, { children: h.jsx('View', {}, 'child') }));
  const nativeHeaderChildren = h.node('header-actions').props.children.flat().filter(Boolean);
  assert.equal(nativeHeaderChildren[0].type, 'PendingReviewShortcut');
  assert.equal(nativeHeaderChildren[1].type, 'NotificationBell');
  h.unmount();
});

test('PendingReviewShortcut exposes pagination and honest retry when pending reads fail or have more pages', async () => {
  let failNext = true;
  let pageCount = 0;
  const fetcher = async url => {
    if (String(url).includes('/pending')) {
      if (failNext) throw new Error('Synthetic pending outage');
      pageCount++;
      if (!String(url).includes('cursor=')) {
        return Response.json({ proposals: [makePrivateNoteCreateProposal()], nextCursor: 'page-2' });
      }
      return Response.json({ proposals: [makeCareReviseProposal()], nextCursor: null });
    }
    return Response.json({ result: { provenance: null, runId: runA, status: 'completed', stopReason: null, text: '', citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] } });
  };
  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => createProductAgentApi('/api', fetcher), fetcher);
  owner.syncContext({ key: 'scope-a', childId: childA, userId: 'parent-a' }, true, { identityKey: 'parent-a' });

  const { mocks } = uiMocks({ pathname: '/tasks' });
  const h = componentHarness(mocks);
  let idSeq = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`pg-${++idSeq}`).current };
  const { PendingReviewShortcut } = h.load('src/components/PendingReviewShortcut.tsx');
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);

  const render = () => {
    const snap = owner.getSnapshot();
    h.production({
      scopeKey: 'scope-a',
      selectedChildId: childA,
      online: true,
      sharedChild: { target: null },
      agentPending: snap.pending,
      agentModel: snap.model,
      agentActions: { refresh: owner.refresh, setSharedConfirmation() {}, decide() {}, retryOriginal() {}, openSource() {} },
      readAgentPending: owner.readPending,
      selectAgentRun: owner.selectRun,
    });
    h.render(h.jsx(PendingReviewShortcut, {}));
  };

  render();
  h.hosts().find(n => n.type === 'ToolbarIconButton').props.onPress();
  await settle();
  render();
  assert.ok(button('重試讀取待確認事項'));

  failNext = false;
  button('重試讀取待確認事項').props.onPress();
  await settle();
  render();
  assert.equal(pageCount, 1);
  assert.equal(h.node('header-pending-badge').props.children.props.children, '1+');
  assert.ok(h.node('shortcut-pending-more'));
  assert.ok(button('載入較早待確認事項'));

  button('載入較早待確認事項').props.onPress();
  await settle();
  render();
  assert.equal(pageCount, 2);
  assert.equal(h.node('header-pending-badge').props.children.props.children, '2');
  assert.equal(button('載入較早待確認事項'), undefined);
  h.unmount();
  owner.dispose();
});

