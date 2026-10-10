import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SERVICE_POLICY_VERSION } from '../../src/shared/account-service.ts';

// Render the real gate with native controls stubbed. This checks presentation and
// admission props, not browser geometry, focus, animation, or network behaviour.
const require = createRequire(import.meta.url);
const filename = new URL('../src/components/account/AccountCallbackGate.tsx', import.meta.url);
const source = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function render(gate, { online = true, busy = null, root = false } = {}) {
  const buttons = [], views = [];
  const calls = { status: 0, signOut: 0 };
  const state = {
    identityKey: 'synthetic:parent-a:1', online, user: { email: 'synthetic@example.invalid' },
    account: { gate, busy, notice: null, callback: null, deletion: { phase: 'idle' },
      status: { policyVersion: SERVICE_POLICY_VERSION, notice: 'Synthetic consent notice', mailConfigured: true } },
    owner: { accountOwner: { loadStatus: () => { calls.status++; } } },
    signOut: () => { calls.signOut++; },
  };
  const native = ({ children, ...props }) => {
    views.push(props);
    return React.createElement('div', { 'data-testid': props.testID, 'aria-hidden': props['aria-hidden'],
      'aria-busy': props['aria-busy'], inert: props.inert }, children);
  };
  const api = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (name === 'react' || name === 'react/jsx-runtime' || name === 'zod') return require(name);
    if (name === 'react-native') return { View: native, Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: ({ children }) => React.createElement('span', null, children) };
    if (name === 'expo-router') return { usePathname: () => '/', useRouter: () => ({ replace() {} }) };
    if (name === 'react-hook-form' || name === '@hookform/resolvers/zod') return {};
    if (name === '../../production/ProductionProvider') return { useProduction: () => state };
    if (name === '../../production/AccountServiceOwner') return { parseAccountCallback: () => null };
    if (name === '../../../../src/shared/account-service') return { SERVICE_POLICY_VERSION };
    if (name === '../../theme') return { chineseFont: 'sans-serif', colors: {}, spacing: {}, typeScale: {} };
    if (name === '../../branding') return { brand: { name: '育有方' } };
    if (name === '../../startup/StartupLoadingLabel') return { StartupLoadingLabel: ({ label }) => React.createElement('span', null, `${label}…`) };
    if (name === '../BrandLogo') return { BrandLogo: () => React.createElement('span', { 'data-logo': true }) };
    if (name === '../AppScrollView') return { AppScrollView: native };
    if (name === '../AppCheckbox') return { AppCheckbox: ({ label }) => React.createElement('span', null, label) };
    if (name === '../ui') return { AppButton: props => { buttons.push(props); return React.createElement('button', { disabled: props.disabled || props.loading }, props.label); } };
    assert.fail(`Unexpected gate dependency: ${name}`);
  }, api, api.exports);
  const element = root ? React.createElement(api.exports.AccountCallbackGate, null, React.createElement('span', null, 'Synthetic private route'))
    : React.createElement(api.exports.AccountAccessPanel);
  return { html: renderToStaticMarkup(element), buttons, views, calls };
}

test('normal admission checking keeps the branded loading screen without account recovery actions', () => {
  for (const busy of ['status', null]) {
    const result = render('checking', { busy });
    assert.match(result.html, /production-account-loading/);
    assert.match(result.html, /正在開啟育有方/);
    assert.match(result.html, /aria-busy="true"/);
    assert.doesNotMatch(result.html, /確認帳戶服務|重新確認帳戶|登出本人帳戶|暫時未能/);
    assert.equal(result.buttons.length, 0);
    assert.deepEqual(result.calls, { status: 0, signOut: 0 });
  }
});

test('real failure keeps owner-backed retry and sign-out; offline checking is not an endless loader', () => {
  const failed = render('error');
  assert.match(failed.html, /暫時未能確認帳戶服務/);
  assert.doesNotMatch(failed.html, /production-account-loading/);
  failed.buttons.find(button => button.label === '重新確認帳戶').onPress();
  failed.buttons.find(button => button.label === '登出本人帳戶').onPress();
  assert.deepEqual(failed.calls, { status: 1, signOut: 1 });
  const offline = render('checking', { online: false });
  assert.match(offline.html, /目前離線/);
  assert.doesNotMatch(offline.html, /production-account-loading/);
  assert.ok(offline.buttons.every(button => button.disabled));
  const retrying = render('error', { busy: 'status' });
  assert.equal(retrying.buttons.find(button => button.label === '重新確認帳戶').loading, true);
});

test('verification and consent remain distinct required actions', () => {
  const verification = render('verification');
  assert.match(verification.html, /請先完成電郵驗證/);
  assert.ok(verification.buttons.some(button => button.label === '重新要求驗證指引'));
  const consent = render('consent');
  assert.match(consent.html, /開始前，了解資料的使用方式/);
  assert.equal(consent.buttons.find(button => button.label === '同意並繼續').disabled, true);
});

test('the root guard continues hiding, disabling and excluding private routes until ready', () => {
  for (const gate of ['checking', 'error', 'verification', 'consent']) {
    const blocked = render(gate, { busy: gate === 'checking' ? 'status' : null, root: true });
    const route = blocked.views.find(view => view.pointerEvents !== undefined);
    assert.equal(route.pointerEvents, 'none');
    assert.equal(route['aria-hidden'], true);
    assert.equal(route.inert, true);
    assert.equal(route.accessibilityElementsHidden, true);
    assert.equal(route.importantForAccessibility, 'no-hide-descendants');
    if (gate === 'checking') assert.equal(blocked.buttons.length, 0);
  }
  const ready = render('ready', { root: true });
  const route = ready.views.find(view => view.pointerEvents !== undefined);
  assert.equal(route.pointerEvents, 'auto');
  assert.equal(route['aria-hidden'], false);
  assert.equal(route.inert, false);
  assert.doesNotMatch(ready.html, /production-account-loading|production-account-gate/);
});
