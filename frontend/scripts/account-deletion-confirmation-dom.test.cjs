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
const filename = path.join(root, 'src/components/account/AccountDataControls.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let snapshot, actions;
const loaded = { exports: {} };
// Actual component, React, RHF and Zod. Only visual controls and production boundary are synthetic.
new Function('require', 'module', 'exports', code)(name => {
  if (name.endsWith('/ProductionProvider')) return { useProduction: () => snapshot };
  if (name.endsWith('/file-export')) return { exportText() { throw new Error('Not part of this test'); } };
  if (name === 'react-native') return { StyleSheet: { create: x => x }, View: p => e('div', {}, p.children) };
  if (name === 'react-native-paper') return { Text: p => e('p', { role: p.accessibilityLiveRegion ? 'status' : undefined }, p.children) };
  if (name.endsWith('/theme')) return { colors: {}, spacing: {}, readingType: { tool: {} } };
  if (name.endsWith('/ui')) return { AppButton: p => e('button', { disabled: p.disabled || p.loading, onClick: p.onPress }, p.label),
    AppTextField: p => e('label', {}, p.label, e('input', { ref: p.ref, 'aria-label': p.accessibilityLabel, type: p.secureTextEntry ? 'password' : 'text',
      value: p.value, disabled: p.disabled, autoComplete: p.autoComplete, onChange: event => p.onChangeText(event.target.value) })) };
  return req(name);
}, loaded, loaded.exports);
const renderer = createRoot(document.getElementById('root'));
const input = name => document.querySelector(`input[aria-label="${name}"]`);
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);
const passwordInput = () => input('帳戶刪除身份驗證密碼');
const final = () => button('確認永久刪除帳戶');
async function render() { await React.act(async () => { renderer.render(e(loaded.exports.AccountDataControls)); }); }
async function fill(node, value) { assert.ok(node); await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); }); }
async function click(node) { assert.ok(node); await React.act(async () => { node.click(); }); }
async function reset() {
  await React.act(async () => renderer.render(null));
  actions = { verify: [], execute: [], cancel: 0 };
  snapshot = { identityKey: 'synthetic-a:1', online: true, canPrepareAccountDeletion: true, account: { busy: null, status: null, notice: null,
    deletion: { phase: 'prepared', childCount: 2, message: null }, download: { phase: 'idle', parts: 0 }, deletionVerification: { available: true, expiresAtMs: null } },
    accountActions: { verifyDeletionIdentity: async secret => { actions.verify.push(secret); }, executeDeletion: async text => { actions.execute.push(text); },
      cancelPreparedDeletion: async () => { actions.cancel++; }, clearDownload() {}, downloadNextPart() {}, prepareDeletion() {} } };
  await render();
}

test('real form requires verified identity plus exact confirmation and clears the password immediately on the auth handoff', async () => {
  await reset(); assert.equal(passwordInput().type, 'password'); assert.equal(passwordInput().autocomplete, 'off'); assert.equal(final().disabled, true);
  await fill(passwordInput(), 'Synthetic secret'); await fill(input('帳戶刪除確認文字'), '永久刪除我的帳戶'); assert.equal(final().disabled, true);
  await click(final()); assert.equal(actions.execute.length, 0);
  await click(button('驗證目前密碼')); assert.deepEqual(actions.verify, ['Synthetic secret']); assert.equal(passwordInput().value, ''); assert.equal(final().disabled, true);
  snapshot.account = { ...snapshot.account, deletionVerification: { available: true, expiresAtMs: Date.now() + 60000 } }; await render();
  assert.equal(passwordInput().value, ''); assert.equal(passwordInput().disabled, true); assert.equal(final().disabled, false);
  await fill(input('帳戶刪除確認文字'), '永久刪除我的帳戶 '); assert.equal(final().disabled, true);
  await fill(input('帳戶刪除確認文字'), '永久刪除我的帳戶'); await click(final());
  assert.deepEqual(actions.execute, ['永久刪除我的帳戶']); assert.equal(passwordInput().value, ''); assert.equal(input('帳戶刪除確認文字').value, '');
});

test('failed verification, cancel, identity switch and offline transitions never retain the password or open final deletion', async () => {
  await reset(); await fill(passwordInput(), 'Synthetic wrong secret'); await click(button('驗證目前密碼'));
  snapshot.account = { ...snapshot.account, deletion: { ...snapshot.account.deletion, message: '未能確認密碼。尚未刪除帳戶。' } }; await render();
  assert.equal(passwordInput().value, ''); assert.equal(final().disabled, true);
  await fill(passwordInput(), 'Synthetic secret'); snapshot.account.busy = 'verify'; await render();
  assert.equal(button('取消這次退出確認').disabled, false); await click(button('取消這次退出確認')); assert.equal(actions.cancel, 1); assert.equal(passwordInput().value, '');
  snapshot.account.busy = null; await render(); await fill(passwordInput(), 'Synthetic secret'); snapshot.identityKey = 'synthetic-b:1'; await render(); assert.equal(passwordInput().value, '');
  await fill(passwordInput(), 'Synthetic secret'); snapshot.online = false; await render(); assert.equal(passwordInput().value, ''); assert.equal(final().disabled, true);
});

test('unsupported providers have no pretend password form and expired verification cannot enable final deletion', async () => {
  await reset(); snapshot.account.deletionVerification = { available: false, expiresAtMs: null }; await render();
  assert.equal(passwordInput(), null); assert.match(document.body.textContent, /尚未接通安全的重新驗證/); assert.equal(final().disabled, true);
  snapshot.account.deletionVerification = { available: true, expiresAtMs: Date.now() - 1 }; await render();
  await fill(input('帳戶刪除確認文字'), '永久刪除我的帳戶'); assert.equal(final().disabled, true); await click(final()); assert.equal(actions.execute.length, 0);
  await React.act(async () => renderer.render(null));
});
