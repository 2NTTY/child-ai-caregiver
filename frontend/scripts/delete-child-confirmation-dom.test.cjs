const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { url: 'https://synthetic.invalid/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) global[name] = dom.window[name];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => { throw new Error('No real network is authorized in this synthetic UI test'); };
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), e = React.createElement;
const { fixture } = require('./child-delete-owner-harness.cjs');
const filename = path.join(root, 'src/components/DeleteChildDialog.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const Dialog = Object.assign(p => p.visible ? e('div', { role: 'dialog', 'aria-label': p.accessibilityLabel }, p.children) : null,
  { Title: p => e('h2', {}, p.children), ScrollArea: p => e('div', {}, p.children), Actions: p => e('div', {}, p.children) });
const loaded = { exports: {} };
// Actual dialog + React + ProductionOwner/controller. Only visual controls and API ports are synthetic.
new Function('require', 'module', 'exports', code)(name => {
  if (name === 'react-native') return { StyleSheet: { create: x => x } };
  if (name === 'react-native-paper') return { Text: p => e('p', { id: p.nativeID, role: p.accessibilityLiveRegion ? 'status' : undefined }, p.children) };
  if (name === '../theme') return { colors: {}, spacing: {}, readingType: { tool: {} } };
  if (name === './AppDialog') return { AppDialog: Dialog };
  if (name === './AppScrollView') return { AppScrollView: p => e('div', {}, p.children) };
  if (name === './ui') return { AppButton: p => e('button', { disabled: p.disabled, onClick: p.onPress }, p.label),
    AppTextField: p => e('label', {}, p.label, e('input', { 'aria-label': p.accessibilityLabel, 'aria-describedby': p['aria-describedby'], 'aria-invalid': p['aria-invalid'],
      value: p.value, disabled: p.disabled, readOnly: !!p.disabled, autoComplete: p.autoComplete,
      onChange: event => p.onChangeText(event.target.value), onKeyDown: event => { if (event.key === 'Enter') p.onSubmitEditing?.(); } })) };
  return req(name);
}, loaded, loaded.exports);
let f;
const renderer = createRoot(document.getElementById('root'));
const input = () => document.querySelector('input[aria-label="輸入要刪除的孩子完整名字"]');
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);
async function render() { await React.act(async () => renderer.render(e(loaded.exports.DeleteChildDialog, {
  state: f.owner.getSnapshot().records, confirmationKey: f.owner.childDeletionConfirmationKey(), getConfirmationKey: f.owner.childDeletionConfirmationKey, controller: f.owner.controller,
}))); }
async function fill(value) { const node = input(); assert.ok(node); await React.act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true }));
}); }
async function click(node) { assert.ok(node); await React.act(async () => { node.click(); await f.settle(); }); }
async function reset() {
  await React.act(async () => renderer.render(null)); f?.dispose(); f = await fixture(); await render();
}
test.after(async () => { await React.act(async () => renderer.unmount()); f?.dispose(); dom.window.close(); });

test('actual owner review leaves global scope null but the DOM name input editable and wrong names disabled', async () => {
  await reset(); assert.equal(f.owner.getSnapshot().scopeKey, null); assert.equal(input().disabled, false); assert.equal(input().readOnly, false);
  assert.equal(button('確認永久刪除').disabled, true); assert.equal(input().autocomplete, 'off');
  assert.ok(document.getElementById(input().getAttribute('aria-describedby')));
  for (const wrong of ['', '小明', '合成小明 ', ' 合成小明', '永久刪除']) {
    await fill(wrong); assert.equal(button('確認永久刪除').disabled, true); await click(button('確認永久刪除'));
  }
  assert.deepEqual(f.calls.deletes, []); await fill('合成小明'); assert.equal(button('確認永久刪除').disabled, false);
  await React.act(async () => input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.deepEqual(f.calls.deletes, [], 'Typing Enter is not the irreversible action');
  await click(button('確認永久刪除')); assert.deepEqual(f.calls.deletes, ['child-a'], 'Only the in-memory synthetic API is reached');
  await render(); assert.equal(input().value, ''); assert.equal(button('確認永久刪除').disabled, true);
});

test('cancel returns the original child scope and a new child never inherits the old typed name', async () => {
  await reset(); await fill('合成小明'); await click(button('保留孩子')); await render();
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(f.state().deletion, null); assert.ok(f.owner.getSnapshot().scopeKey);
  await f.owner.controller.selectChild('child-b'); await f.settle(); f.owner.controller.reviewDeleteChild(); await render();
  assert.equal(f.owner.getSnapshot().scopeKey, null); assert.equal(input().value, ''); assert.equal(input().disabled, false);
  await fill('合成小明'); assert.equal(button('確認永久刪除').disabled, true); await fill('合成小晴'); assert.equal(button('確認永久刪除').disabled, false);
  assert.deepEqual(f.calls.deletes, []);
});

test('session generation and revoked scope clear the DOM confirmation, and prepaint revocation rejects its enabled callback', async () => {
  await reset(); await fill('合成小明'); f.owner.generation++; f.owner.sync(); await f.settle(); await render();
  assert.equal(input().value, ''); assert.equal(button('確認永久刪除').disabled, true);
  await fill('合成小明'); f.owner.handleDomainAccessError({ status: 403 });
  await click(button('確認永久刪除')); assert.deepEqual(f.calls.deletes, []);
  await render(); assert.equal(input().disabled, true); assert.equal(input().value, ''); assert.equal(button('確認永久刪除').disabled, true);
  assert.equal(f.owner.getSnapshot().scopeKey, null);
});

test('pending, busy and unknown lock confirmation; checked recovery requires a fresh exact name', async () => {
  await reset(); await fill('合成小明'); f.owner.setDomainPending('synthetic-write', true); await render();
  assert.equal(input().disabled, true); assert.equal(button('確認永久刪除').disabled, true);
  f.owner.setDomainPending('synthetic-write', false); await render(); assert.equal(input().value, '');
  await fill('合成小明'); f.patch({ busy: 'deleteChild' }); await render(); assert.equal(input().disabled, true); assert.equal(button('保留孩子').disabled, true);
  f.patch({ busy: null, deletion: { ...f.state().deletion, phase: 'unknown' } }); await render();
  assert.equal(input(), null); assert.equal(button('確認永久刪除'), undefined); assert.equal(button('保留孩子').disabled, true);
  assert.equal(f.owner.childDeletionConfirmationKey(), null); await click(button('保留孩子')); assert.equal(f.state().deletion.phase, 'unknown');
  await click(button('查核原刪除結果')); await render(); assert.equal(f.state().deletion.phase, 'checked');
  assert.equal(input(), null); assert.equal(button('確認永久刪除'), undefined); assert.equal(button('重新核對原刪除').disabled, false);
  await click(button('重新核對原刪除')); await render(); assert.equal(input().value, ''); assert.equal(input().disabled, false); assert.equal(button('確認永久刪除').disabled, true);
  assert.deepEqual(f.calls.deletes, []);
});

test('the mounted provider supplies the dedicated owner key and live getter, not the null global scope', () => {
  const provider = fs.readFileSync(path.join(root, 'src/production/ProductionProvider.tsx'), 'utf8');
  assert.match(provider, /<DeleteChildDialog state=\{value\.recordsState\} confirmationKey=\{owner\.childDeletionConfirmationKey\(\)\} getConfirmationKey=\{owner\.childDeletionConfirmationKey\} controller=\{owner\.controller\}/);
  assert.doesNotMatch(provider, /<DeleteChildDialog[^>]*scopeKey=/);
});
