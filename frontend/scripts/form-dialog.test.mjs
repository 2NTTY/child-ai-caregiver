import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

function scenario() {
  let openRequest, requestKey = 0, disabled = false;
  let scope = 'child-a', dirty = false, pending = false, discards = 0, checks = 0, mounts = 0, closes = 0, focus = 0;
  const dialog = Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Content: 'Content', Actions: 'Actions' });
  const mocks = {
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: x => x } },
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children },
    './AppDialog': { AppDialog: dialog }, '../components/AppDialog': { AppDialog: dialog },
    './AppScrollView': { AppScrollView: 'ScrollView' },
    'expo-router/react-navigation': { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} },
    'expo-router': { usePathname: () => '/growth', useRouter: () => ({ push() {} }), Link: 'Link' },
  };
  const h = harness(mocks); let id = 0;
  mocks.react = { ...h.react, useId: () => h.react.useRef(`id-${++id}`).current };
  const { ManualFormDialog } = h.load('src/components/FormDialog.tsx');
  const guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  function Owner() { guard.usePreviewLeaveGuard(dirty, pending, 'child', undefined, true); return null; }
  function Form() {
    const latest = h.react.useRef(dirty); latest.current = dirty;
    h.react.useEffect(() => { mounts++; return () => { if (latest.current && !pending) { discards++; dirty = false; } }; }, []);
    guard.usePreviewLeaveGuard(dirty);
    return h.jsx('Field', { value: 'Synthetic unsent text' });
  }
  function Page() { return h.jsx(ManualFormDialog, { scopeKey: scope, openRequest, disabled, label: '手動建立', title: '建立資料', onClose() { closes++; },
    recovery: h.jsx('Button', { label: '查核原操作', onPress() { checks++; } }), children: h.jsx(Form, {}) }); }
  const tree = h.jsx(guard.PreviewNavigationGuard, { children: [h.jsx(Owner, {}, 'owner'), h.jsx(Page, {}, 'page')] });
  const render = () => h.render(tree), button = label => h.hosts().find(x => x.type === 'Button' && x.props.label === label);
  const modal = () => h.node('manual-form-dialog');
  render();
  return { h, render, button, modal, counts: () => ({ mounts, discards, closes, checks, focus }),
    disabled(value) { disabled = value; render(); },
    request(requestScope = scope) { openRequest = { key: ++requestKey, scopeKey: requestScope, consume() { openRequest = undefined; } }; render(); },
    open() { button('手動建立').props.ref.current = { isConnected: true, matches() { return true; }, focus() { focus++; } }; button('手動建立').props.onPress(); render(); },
    edit() { dirty = true; render(); }, pending(value) { pending = value; render(); },
    scope(value) { scope = value; dirty = false; render(); }, web() { mocks['react-native'].Platform.OS = 'web'; },
  };
}

test('manual form is absent from the reading page, then scrolls with its original recovery inside the dialog', () => {
  const s = scenario(); assert.equal(s.counts().mounts, 0); assert.equal(s.modal(), undefined);
  assert.equal(s.button('手動建立').props.accessibilityLabel, '手動建立：建立資料');
  s.open(); assert.equal(s.counts().mounts, 1); assert.equal(s.modal().props.visible, true);
  assert.equal(s.modal().props.accessibilityLabel, '建立資料');
  assert.equal(s.h.hosts().find(x => x.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
  s.button('查核原操作').props.onPress(); assert.equal(s.counts().checks, 1);
});
test('Escape/backdrop and close button share the draft guard; staying preserves the mounted form', () => {
  const s = scenario(); s.open(); s.edit(); s.modal().props.onDismiss(); s.render();
  assert.ok(s.button('捨棄草稿並離開')); s.button('繼續編輯').props.onPress(); s.render();
  assert.equal(s.counts().mounts, 1); assert.equal(s.counts().discards, 0); assert.equal(s.modal().props.visible, true);
  s.button('關閉').props.onPress(); s.render(); s.button('捨棄草稿並離開').props.onPress(); s.render();
  assert.equal(s.counts().discards, 1); assert.equal(s.counts().closes, 1); assert.equal(s.modal().props.visible, false);
  assert.equal(s.h.hosts().some(x => x.type === 'Field'), false);
});
test('unknown cannot be discarded and recovery remains available inside the still-mounted form', () => {
  const s = scenario(); s.open(); s.edit(); s.pending(true); s.modal().props.onDismiss(); s.render();
  assert.ok(s.button('留在此頁查核')); assert.equal(s.button('捨棄草稿並離開'), undefined);
  s.button('留在此頁查核').props.onPress(); s.render(); s.button('查核原操作').props.onPress();
  assert.equal(s.counts().checks, 1); assert.equal(s.counts().closes, 0); assert.equal(s.counts().discards, 0);
});
test('approval rechecks pending and never closes a newly started original write', () => {
  const s = scenario(); s.open(); s.edit(); s.button('關閉').props.onPress(); s.render();
  s.pending(true); s.button('捨棄草稿並離開').props.onPress(); s.render();
  assert.ok(s.button('留在此頁查核')); assert.equal(s.counts().closes, 0);
});
test('scope changes hide the previous form and reject a stale approved close callback', () => {
  const s = scenario(); s.open(); s.edit(); s.button('關閉').props.onPress(); s.render();
  s.scope('child-b'); assert.equal(s.modal().props.visible, false);
  s.button('捨棄草稿並離開').props.onPress(); s.render(); assert.equal(s.counts().closes, 0);
});
test('focus returns only after the modal releases its trap and only within the same scope', () => {
  const s = scenario(); s.open(); s.web(); s.button('關閉').props.onPress(); s.render();
  assert.equal(s.counts().focus, 0); s.modal().props.onClosed(); assert.equal(s.counts().focus, 1);
  s.open(); s.button('關閉').props.onPress(); s.render(); s.scope('child-b'); s.modal().props.onClosed();
  assert.equal(s.counts().focus, 1);
});

test('an approved close callback cannot mutate an unmounted form owner', () => {
  const s = scenario(); s.open(); s.edit(); s.button('關閉').props.onPress(); s.render();
  const approve = s.button('捨棄草稿並離開').props.onPress; s.h.unmount(); approve();
  assert.equal(s.counts().closes, 0);
});


test('a controlled form replacement in the same child rejects approval for the previous draft generation', () => {
  const dialog = Object.assign('Dialog', {Title: 'Title', ScrollArea: 'ScrollArea', Content: 'Content', Actions: 'Actions'});
  const mocks = {'react-native': {Platform: {OS: 'android'}, StyleSheet: {create: x => x}},
    'react-native-paper': {Text: 'Text', Portal: 'Portal'}, './AppDialog': {AppDialog: dialog}, '../components/AppDialog': {AppDialog: dialog},
    './AppScrollView': {AppScrollView: 'ScrollView'}, 'expo-router/react-navigation': {useNavigation: () => ({}), usePreventRemove() {}}};
  const h = harness(mocks); let id = 0, key = 'draft-a', closes = 0;
  mocks.react = {...h.react, useId: () => h.react.useRef(`controlled-${++id}`).current};
  const {FormDialog} = h.load('src/components/FormDialog.tsx'), guard = h.load('src/preview/PreviewNavigationGuard.tsx');
  function Page() {guard.usePreviewLeaveGuard(true); return h.jsx(FormDialog, {visible: true, scopeKey: 'child-a', formKey: key, title: 'Edit', onClose() {closes++;}});}
  const tree = h.jsx(guard.PreviewNavigationGuard, {children: h.jsx(Page, {})}); const render = () => h.render(tree);
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);
  render(); button('關閉').props.onPress(); render(); key = 'draft-b'; render();
  button('捨棄草稿並離開').props.onPress(); render(); assert.equal(closes, 0);
});


test('a one-shot header reveal opens only the current original form and retains all close protections', () => {
  const s = scenario(); s.request('old-child'); assert.equal(s.modal(), undefined);
  s.request(); assert.equal(s.modal().props.visible, true); assert.equal(s.counts().mounts, 1);
  assert.equal(s.counts().checks, 0, 'reveal never checks, retries or submits an operation');
  s.edit(); s.pending(true); s.button('關閉').props.onPress(); s.render();
  assert.ok(s.button('留在此頁查核')); assert.equal(s.button('捨棄草稿並離開'), undefined);
  s.scope('child-b'); assert.equal(s.modal()?.props.visible ?? false, false);
  s.request('child-a'); assert.equal(s.modal()?.props.visible ?? false, false);
});

test('consuming the header reveal does not reopen a form after its guarded close', () => {
  const s = scenario(); s.request(); s.button('關閉').props.onPress(); s.render();
  assert.equal(s.modal().props.visible, false); s.render(); assert.equal(s.modal().props.visible, false);
  s.request(); assert.equal(s.modal().props.visible, true); assert.equal(s.counts().checks, 0);
});


test('a disabled original form consumes a reveal instead of opening later when the blocker clears', () => {
  const s = scenario(); s.disabled(true); s.request(); assert.equal(s.modal(), undefined);
  s.disabled(false); assert.equal(s.modal(), undefined); s.render(); assert.equal(s.modal(), undefined);
  s.request(); assert.equal(s.modal().props.visible, true);
});
