import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual GuideScreen, ManualFormDialog, leave guard and RecordsController.
// API and native layout hosts are synthetic ports; no network, model or real data.
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const descendants = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
async function scenario(width = 1024, empty = false) {
  const dialog = Object.assign('Dialog', { Title: 'Title', Content: 'Content', ScrollArea: 'ScrollArea', Actions: 'Actions' });
  const ui = { AppButton: 'Button', AppTextField: 'Field' };
  const mocks = {
    'react-native': { View: 'View', Pressable: 'Pressable', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    '../components/ui': ui, './ui': ui,
    '../theme': { colors: { ink: '#272343' }, spacing: {}, radius: {}, typeScale: { small: 14 }, readingType: {}, workspaceType: {} },
    '../components/PageFrame': { PageFrame: 'PageFrame' }, '../components/AppIcon': { AppIcon: 'Icon' },
    // This harness exercises direct creation controls, not the separate operation-reveal store.
    '../operation-reveal': { useOperationReveal: () => undefined },
    '../components/EmptyListCard': { EmptyListCard: 'EmptyList' },
    '../components/useContainerWidth': { useContainerWidth: () => ({ width, ref: {}, onLayout() {} }) },
    './AppDialog': { AppDialog: dialog }, '../components/AppDialog': { AppDialog: dialog },
    './AppScrollView': { AppScrollView: 'ScrollView' },
    'expo-router/react-navigation': { useNavigation: () => ({}), usePreventRemove() {} },
  };
  const h = harness(mocks); let id = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`guide-${++id}`).current };
  const { RecordsController } = h.load('../src/client/records-controller.ts');
  let user = { id: 'parent-a', name: '合成家長', email: 'qa-parent@example.invalid' };
  let children = empty ? [] : ['合成小明', '合成小晴'].map((displayName, index) => ({ id: `child-${index}`, displayName, workspaceId: 'workspace-a', accessRole: 'owner', createdAt: '2026-10-22T06:00:00Z' }));
  let failRead = false, failCreate = false, focus = 0, readCount = 0, refreshCount = 0, signOutCount = 0, selected = [], creates = [], resolveCalls = [], navigated = [];
  const pending = [];
  const controller = new RecordsController({
    getSession: async () => user,
    listChildren: async () => { readCount++; if (failRead) throw Error('synthetic read failure'); return children.slice(); },
    createChild: async (displayName, _signal, expectedUserId) => {
      creates.push({ displayName, expectedUserId }); if (failCreate) throw Error('synthetic unknown result');
      const child = { id: `created-${creates.length}`, displayName, workspaceId: 'workspace-a', accessRole: 'owner', createdAt: '2026-10-22T06:01:00Z' };
      children.push(child); return child;
    },
    signOut: async () => { signOutCount++; },
  }, true, undefined, false);
  await controller.restoreSession();
  const createChild = controller.createChild.bind(controller), reloadChildren = controller.reloadChildren.bind(controller), resolveUnknownChild = controller.resolveUnknownChild.bind(controller);
  controller.createChild = () => { const promise = createChild(); pending.push(promise); return promise; };
  controller.resolveUnknownChild = found => { resolveCalls.push(found); resolveUnknownChild(found); };
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx'), Guide = h.load('src/screens/guideScreen.tsx').default;
  let leave;
  function Page() { leave = guard.usePreviewNavigation(); return h.jsx(Guide, {}); }
  h.route('/guide');
  const render = () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const recordsState = controller.getSnapshot();
      h.production({ identityKey: user.id, model: { children: recordsState.children, selectedChildId: recordsState.selectedChildId, guideStatus: 'first_login' },
        user, online: recordsState.online, recordsState, controller,
        actions: { selectChild(childId) { selected.push(childId); pending.push(controller.selectChild(childId)); },
          open(destination) { leave(() => { navigated.push(destination); h.route(`/${destination}`); }, 'workspace'); } },
        refresh() { refreshCount++; const promise = reloadChildren(); pending.push(promise); return promise; },
        signOut() { pending.push(controller.signOut()); },
      });
      h.render(h.jsx(guard.PreviewNavigationGuard, { children: h.jsx(Page, {}) }));
      if (controller.getSnapshot() === recordsState) break;
    }
  };
  const button = (label, root) => (root ? descendants(root) : h.hosts()).find(x => x.type === 'Button' && x.props.label === label);
  const modal = () => h.node('manual-form-dialog');
  const click = (label, root) => { const node = button(label, root); assert.ok(node, label); assert.ok(!node.props.disabled && !node.props.loading, `Enabled: ${label}`); node.props.onPress(); render(); };
  const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); render(); };
  const field = () => h.hosts().find(x => x.type === 'Field');
  render();
  return { h, render, button, click, modal, field, settle, controller,
    state: controller.getSnapshot, counts: () => ({ readCount, refreshCount, signOutCount, selected, creates, resolveCalls, navigated, focus }),
    enter(value) { assert.ok(!field().props.disabled); field().props.onChangeText(value); render(); },
    failRead(value) { failRead = value; }, failCreate(value) { failCreate = value; },
    offline(value = true) { controller.setOnline(!value); render(); },
    child(name) { return h.hosts().find(x => x.type === 'Pressable' && x.props.accessibilityLabel?.startsWith(name)); },
    navigate() { leave(() => { navigated.push('chat'); h.route('/chat'); }); render(); },
    route(path) { h.route(path); render(); },
    async identity() { user = { ...user, id: 'parent-b' }; await controller.restoreSession(); render(); },
    focusTarget() { button('新增孩子').props.ref.current = { isConnected: true, matches: () => true, focus() { focus++; } }; },
    web() { mocks['react-native'].Platform.OS = 'web'; },
  };
}

test('children form one left-aligned wrapping group; form is absent and account actions are separate at all target widths', async () => {
  for (const width of [320, 390, 1024, 1440]) {
    const s = await scenario(width);
    assert.equal(s.field(), undefined); assert.equal(s.modal(), undefined);
    const options = flatten(s.h.node('guide-child-options').props.style), toolbar = flatten(s.h.node('guide-child-toolbar').props.style);
    assert.equal(options.flexWrap, 'wrap'); assert.notEqual(options.justifyContent, 'space-between'); assert.notEqual(toolbar.justifyContent, 'space-between');
    assert.ok(s.button('登出', s.h.node('guide-account-actions'))); assert.equal(s.button('登出', s.h.node('production-child-setup')), undefined);
    assert.equal(s.child('合成小明').props['aria-pressed'], true); assert.equal(s.child('合成小晴').props['aria-pressed'], false);
    assert.equal(flatten(s.child('合成小明').props.style({ pressed: false })).minHeight, 44);
    assert.deepEqual(descendants(s.child('合成小明')).filter(x => x.type === 'Text').map(x => x.props.children), ['合成小明']);
    s.child('合成小晴').props.onPress(); await s.settle();
    assert.deepEqual(s.counts().selected, ['child-1']); assert.equal(s.state().selectedChildId, 'child-1');
    assert.equal(s.child('合成小晴').props['aria-pressed'], true);
  }
});

test('new-child input uses the existing modal and actual controller; success clears only the confirmed name', async () => {
  const s = await scenario(); s.click('新增孩子');
  assert.equal(s.modal().props.visible, true); assert.equal(s.field().props.accessibilityLabel, '孩子稱呼'); assert.equal(s.field().props.maxLength, 80);
  assert.equal(s.h.hosts().find(x => x.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
  assert.equal(s.button('建立孩子').props.disabled, true);
  s.enter('合成新孩子'); s.click('建立孩子');
  assert.equal(s.button('建立孩子').props.loading, true); assert.equal(s.child('合成小晴').props.disabled, true);
  await s.settle(); assert.deepEqual(s.counts().creates, [{ displayName: '合成新孩子', expectedUserId: 'parent-a' }]);
  assert.equal(s.state().childName, ''); assert.equal(s.state().selectedChildId, 'created-1'); assert.ok(s.child('合成新孩子'));
});

test('dirty close and Escape share the original guard; discard returns focus only after modal close', async () => {
  const s = await scenario(); s.focusTarget(); s.click('新增孩子'); s.enter('合成草稿');
  s.modal().props.onDismiss(); s.render(); assert.ok(s.button('捨棄並離開')); s.click('繼續編輯');
  assert.equal(s.field().props.value, '合成草稿'); s.click('關閉'); s.click('捨棄並離開');
  assert.equal(s.state().childName, ''); assert.equal(s.modal().props.visible, false); assert.equal(s.field(), undefined);
  assert.equal(s.counts().focus, 0); s.web(); s.modal().props.onClosed(); assert.equal(s.counts().focus, 1);
  s.click('新增孩子'); assert.equal(s.field().props.value, ''); assert.equal(s.counts().creates.length, 0);
});

test('unknown creation cannot close or change its name; check and retry are reachable inside the modal and preserve original input', async () => {
  const s = await scenario(); s.failCreate(true); s.click('新增孩子'); s.enter('合成原稱呼'); s.click('建立孩子'); await s.settle();
  assert.equal(s.state().childOutcome, 'unknown'); assert.equal(s.field().props.disabled, true); assert.equal(s.child('合成小晴').props.disabled, true);
  s.click('關閉'); assert.ok(s.button('留在此頁')); assert.equal(s.button('捨棄並離開'), undefined); s.click('留在此頁');
  assert.ok(s.button('查核原建立操作', s.modal())); s.click('查核原建立操作', s.modal()); await s.settle();
  assert.equal(s.state().childOutcome, 'checked'); assert.equal(s.state().childName, '合成原稱呼'); assert.equal(s.counts().creates.length, 1);
  assert.ok(s.button('重試原建立操作', s.modal())); s.failCreate(false); s.click('重試原建立操作', s.modal()); await s.settle();
  assert.deepEqual(s.counts().resolveCalls, [false]); assert.deepEqual(s.counts().creates.map(x => x.displayName), ['合成原稱呼', '合成原稱呼']);
  assert.equal(s.state().childOutcome, 'draft'); assert.equal(s.state().childName, '');
});

test('refresh, visible error retry and offline gates retain their real owner callbacks', async () => {
  const s = await scenario(320, true); assert.ok(s.h.hosts().find(x => x.type === 'EmptyList'));
  s.failRead(true); await s.controller.reloadChildren(); await s.settle(); assert.ok(s.state().childrenError); assert.ok(s.button('重試讀取孩子'));
  assert.equal(s.h.hosts().find(x => x.type === 'EmptyList'), undefined);
  s.failRead(false); s.click('重試讀取孩子'); await s.settle(); assert.equal(s.state().childrenError, null); assert.equal(s.counts().refreshCount, 1);
  s.offline(); assert.equal(s.button('重新整理'), undefined); assert.equal(s.button('登出').props.disabled, true);
  s.click('新增孩子'); s.enter('合成離線草稿'); assert.equal(s.button('建立孩子').props.disabled, true); assert.equal(s.counts().creates.length, 0);
});

test('approved route leave clears the draft without resurrecting the modal on return; identity changes hide old input', async () => {
  const s = await scenario(); s.click('新增孩子'); s.enter('合成草稿'); s.navigate();
  assert.ok(s.button('捨棄並離開')); assert.deepEqual(s.counts().navigated, []); s.click('繼續編輯'); assert.equal(s.field().props.value, '合成草稿');
  s.navigate(); s.click('捨棄並離開'); assert.equal(s.state().childName, ''); s.route('/guide'); assert.equal(s.field(), undefined); assert.equal(s.modal(), undefined);
  s.click('新增孩子'); s.enter('合成舊身份'); await s.identity(); assert.equal(s.field(), undefined); assert.equal(s.state().childName, '');
});

test('independent account sign-out and unchanged three-step guide retain their callbacks', async () => {
  const s = await scenario(); s.click('下一步'); assert.ok(s.button('開啟核對')); s.click('下一步'); assert.ok(s.button('前往設定'));
  assert.equal(s.button('下一步').props.disabled, true); s.click('上一步'); assert.ok(s.button('開啟核對'));
  s.click('登出'); await s.settle(); assert.equal(s.counts().signOutCount, 1); assert.equal(s.state().auth, 'signedOut');
});
