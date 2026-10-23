import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';
import ownerHarness from './child-delete-owner-harness.cjs';

async function scenario(context) {
  const f = await ownerHarness.fixture(); context.after(() => f.dispose());
  const dialog = Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Actions: 'Actions' });
  const h = harness({ '../theme': { colors: {}, spacing: {}, readingType: { tool: {} } }, './AppDialog': { AppDialog: dialog }, './AppScrollView': { AppScrollView: 'ScrollView' }, './ui': { AppButton: 'Button', AppTextField: 'Input' } });
  let inputWrites = 0;
  const useState = h.react.useState;
  h.react.useState = initial => { const [value, setValue] = useState(initial); return [value, next => { inputWrites++; setValue(next); }]; };
  const { DeleteChildDialog } = h.load('src/components/DeleteChildDialog.tsx');
  function Page() { return h.jsx(DeleteChildDialog, { state: f.owner.getSnapshot().records,
    confirmationKey: f.owner.childDeletionConfirmationKey(), getConfirmationKey: f.owner.childDeletionConfirmationKey, controller: f.owner.controller }); }
  const render = () => h.render(h.jsx(Page, {}));
  const button = label => h.hosts().find(node => node.type === 'Button' && node.props.label === label);
  const input = () => h.hosts().find(node => node.type === 'Input');
  render();
  return { ...f, h, render, button, input, inputWrites: () => inputWrites, modal: () => h.hosts().find(node => node.type === dialog),
    patch(value, paint = true) { f.patch(value); if (paint) render(); },
    type(value) { input().props.onChangeText(value); render(); },
    rename(value, paint = true) { f.patch({ children: f.state().children.map(child => child.id === 'child-a' ? { ...child, displayName: value } : child) }); if (paint) render(); },
  };
}

test('the real owner nulls ordinary scope while the dialog accepts only the exact current child name', async context => {
  const s = await scenario(context);
  assert.equal(s.owner.getSnapshot().scopeKey, null); assert.ok(s.owner.childDeletionConfirmationKey());
  assert.equal(s.input().props.disabled, false); assert.equal(s.button('確認永久刪除').props.disabled, true);
  s.button('確認永久刪除').props.onPress(); assert.deepEqual(s.calls.deletes, []);
  for (const wrong of ['', '小明', '合成小明 ', ' 合成小明', '永久刪除']) { s.type(wrong); assert.equal(s.button('確認永久刪除').props.disabled, true); }
  s.type('合成小明'); assert.equal(s.button('確認永久刪除').props.disabled, false);
  const submit = s.button('確認永久刪除').props.onPress; submit(); submit();
  assert.equal(s.state().busy, 'deleteChild'); assert.equal(s.owner.childDeletionConfirmationKey(), null);
  s.render(); assert.equal(s.input().props.disabled, true);
  await s.settle(); assert.deepEqual(s.calls.deletes, ['child-a'], 'Only the synthetic API port is called, once');
  s.render(); assert.equal(s.input().props.value, ''); assert.equal(s.button('確認永久刪除').props.disabled, true);
  assert.equal(s.modal().props.danger, true); assert.equal(s.input().props.autoComplete, 'off');
  assert.ok(!s.input().props.onSubmitEditing, 'Enter in the name field must not delete');
});

test('same-id rename, new review, API/session generation and identity changes reset confirmation and reject old callbacks', async context => {
  for (const change of ['rename', 'review', 'generation', 'identity']) {
    const s = await scenario(context); s.type('合成小明'); const submit = s.button('確認永久刪除').props.onPress, edit = s.input().props.onChangeText;
    if (change === 'rename') { s.rename('合成小晴'); s.rename('合成小明'); }
    if (change === 'review') { s.owner.controller.reviewDeleteChild(); s.render(); }
    if (change === 'generation') { s.owner.generation++; s.owner.sync(); s.render(); }
    if (change === 'identity') {
      const user = { ...s.state().user, id: 'synthetic-other' }; s.user(user); s.patch({ user });
    }
    assert.equal(s.input()?.props.value ?? '', '', change);
    assert.ok(!s.button('確認永久刪除') || s.button('確認永久刪除').props.disabled, change);
    edit('合成小明'); submit(); await s.settle(); s.render(); assert.deepEqual(s.calls.deletes, [], change);
    if (change === 'identity') { s.owner.controller.reviewDeleteChild(); s.render(); }
    assert.equal(s.input()?.props.value ?? '', '', `Old onChange must not fill the ${change} confirmation`);
    edit('合成小明'); submit(); s.render(); await s.settle(); assert.deepEqual(s.calls.deletes, [], change);
    assert.equal(s.input()?.props.value ?? '', '', `Old callbacks remain invalid after ${change} is ready`);
  }
});

test('live owner permissions, selected child, identity, pending and account gates reject stale edits/submits before repaint', async context => {
  for (const change of ['rename', 'permission', 'selection', 'offline', 'busy', 'loading', 'identity', 'generation', 'denied', 'pending', 'account']) {
    const s = await scenario(context); s.type('合成小明'); const submit = s.button('確認永久刪除').props.onPress, edit = s.input().props.onChangeText;
    const writes = s.inputWrites(), key = s.owner.childDeletionConfirmationKey();
    if (change === 'rename') s.rename('合成小晴', false);
    if (change === 'permission') s.patch({ children: s.state().children.map(child => ({ ...child, accessRole: 'viewer' })) }, false);
    if (change === 'selection') s.patch({ selectedChildId: 'child-b' }, false);
    if (change === 'offline') s.owner.controller.setOnline(false);
    if (change === 'busy') s.patch({ busy: 'saveRecord' }, false);
    if (change === 'loading') s.patch({ childrenLoading: true }, false);
    if (change === 'identity') s.patch({ user: { ...s.state().user, id: 'synthetic-other' } }, false);
    if (change === 'generation') { s.owner.generation++; s.owner.sync(); }
    if (change === 'denied') s.owner.handleDomainAccessError({ status: 403 });
    if (change === 'pending') s.owner.setDomainPending('synthetic-write', true);
    if (change === 'account') s.owner.accountOwner.update({ gate: 'consent' });
    assert.notEqual(s.owner.childDeletionConfirmationKey(), key, change);
    edit('合成小明'); assert.equal(s.inputWrites(), writes, `Stale ${change} input must be rejected before any setter runs`);
    submit(); await s.settle(); assert.deepEqual(s.calls.deletes, [], change);
  }
});

test('unknown keeps the original recovery locked; checked offers only re-review and never reuses the name', async context => {
  const s = await scenario(context); s.type('合成小明');
  s.patch({ deletion: { ...s.state().deletion, phase: 'unknown' } });
  assert.equal(s.owner.getSnapshot().scopeKey, null); assert.equal(s.owner.childDeletionConfirmationKey(), null);
  assert.equal(s.input(), undefined); assert.equal(s.button('確認永久刪除'), undefined); assert.equal(s.button('保留孩子').props.disabled, true);
  s.modal().props.onDismiss(); assert.equal(s.state().deletion.phase, 'unknown');
  s.button('查核原刪除結果').props.onPress(); await s.settle(); s.render();
  assert.equal(s.state().deletion.phase, 'checked'); assert.equal(s.input(), undefined); assert.equal(s.button('確認永久刪除'), undefined);
  assert.equal(s.button('重新核對原刪除').props.disabled, false);
  s.button('重新核對原刪除').props.onPress(); s.render();
  assert.equal(s.state().deletion.phase, 'confirm'); assert.equal(s.input().props.value, ''); assert.equal(s.button('確認永久刪除').props.disabled, true);
  assert.deepEqual(s.calls.deletes, []);
});

test('cancel restores ordinary scope, permits switching child, and stale or unmounted callbacks never delete', async context => {
  const s = await scenario(context); s.type('合成小明'); const submit = s.button('確認永久刪除').props.onPress;
  s.button('保留孩子').props.onPress(); s.render(); submit();
  assert.equal(s.state().deletion, null); assert.ok(s.owner.getSnapshot().scopeKey); assert.equal(s.owner.childDeletionConfirmationKey(), null);
  await s.owner.controller.selectChild('child-b'); await s.settle(); s.owner.controller.reviewDeleteChild(); s.render();
  assert.equal(s.input().props.value, ''); s.type('合成小明'); assert.equal(s.button('確認永久刪除').props.disabled, true);
  s.type('合成小晴'); assert.equal(s.button('確認永久刪除').props.disabled, false);
  const stale = s.button('確認永久刪除').props.onPress; s.h.unmount(); stale(); await s.settle(); assert.deepEqual(s.calls.deletes, []);
});

test('the owner rejects all existing pending surfaces without reopening ordinary child scope', async context => {
  for (const change of ['accountUnknown', 'voiceUnknown', 'fileUnknown', 'chatBusy', 'saving', 'replying', 'save_unknown', 'checked', 'agentPending', 'authorizationPending']) {
    const s = await scenario(context);
    if (change === 'accountUnknown') s.owner.accountOwner.update({ deletion: { phase: 'unknown' } });
    if (change === 'voiceUnknown') s.owner.voiceOwner.state = { ...s.owner.voiceOwner.getSnapshot(), unknown: true };
    if (change === 'fileUnknown') s.owner.fileOwner.state = { ...s.owner.fileOwner.getSnapshot(), unknown: true };
    if (change === 'chatBusy') s.owner.chatController.update({ busy: 'save' });
    if (['saving', 'replying', 'save_unknown', 'checked'].includes(change)) {
      assert.equal(s.owner.chatController.getSnapshot().selectedChildId, null, 'The real deletion barrier hides chat selection');
      s.owner.chatController.update({ drafts: { 'child-a': { text: 'Synthetic unresolved write', phase: change } } });
    }
    if (change === 'agentPending') s.owner.agentOwner.update({ model: { ...s.owner.agentOwner.getSnapshot().model, pendingDecision: {} } });
    if (change === 'authorizationPending') s.owner.authorizationOwner.update({ pending: {} });
    assert.equal(s.owner.childDeletionConfirmationKey(), null, change); assert.equal(s.owner.getSnapshot().scopeKey, null, change);
  }
});
