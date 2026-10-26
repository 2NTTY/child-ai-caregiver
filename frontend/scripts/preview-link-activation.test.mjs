import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(process.env.PREVIEW_LINK_SOURCE || new URL('../src/preview/PreviewNavigationGuard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function evaluate(code, dependencies) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unmapped test dependency: ${name}`); return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
function setup({ platform = 'web', pathname = '/care', href = '/more', blocked = false } = {}) {
  const calls = [], approvals = [];
  const native = { Platform: { OS: platform, select: values => values[platform] ?? values.default }, StyleSheet: { create: value => value } };
  const guard = { request(action, intent) { calls.push(['guard', intent]); if (!blocked) approvals.push(action); } };
  const product = evaluate(compiled, {
    react: { ...React, useContext: () => guard }, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': native, 'react-native-paper': {}, 'expo-router/react-navigation': {},
    'expo-router': { Link: 'Link', usePathname: () => pathname, useRouter: () => ({ push: target => calls.push(['push', target]) }) },
    '../components/AppDialog': {}, '../components/ui': {}, '../theme': { colors: {}, typeScale: {} },
    '../production/routes': { isProductionRouteConnected: path => path !== '/login' }, './browser-history-guard': {},
  });
  const element = product.PreviewLink({ href, children: React.createElement('a', null, '全部功能') });
  // Execute the installed Expo 57.0.22 caller as well, not a parallel event-policy
  // implementation. Slots/hosts are ports; this is not native browser tab opening.
  const hooks = evaluate(readFileSync(require.resolve('expo-router/build/link/useLinkToPathProps'), 'utf8'), {
    'react-native': native, '../domComponents/emitDomEvent': { emitDomLinkEvent: () => false },
    '../fork/getPathFromState-forks': { appendBaseUrl: href => href }, '../matchers': { stripGroupSegmentsFromPath: href => href },
    '../global-state/routing': { linkTo: (...args) => calls.push(['expo-linkTo', ...args]) }, '../utils/url': { shouldLinkExternally: () => false },
  });
  const { BaseExpoRouterLink } = evaluate(readFileSync(require.resolve('expo-router/build/link/BaseExpoRouterLink'), 'utf8'), {
    'react/jsx-runtime': require('react/jsx-runtime'), react: { ...React, useMemo: fn => fn() }, 'react-native': native,
    './href': { resolveHref: value => value }, './useLinkHooks': { useInteropClassName: props => props.style, useHrefAttrs: () => ({}) },
    './useLinkToPathProps': hooks, '../Prefetch': {}, '../ui/Slot': { Slot: 'Slot' },
  });
  const installed = BaseExpoRouterLink(element.props);
  return { calls, activate: event => installed.props[platform === 'web' ? 'onClick' : 'onPress'](event),
    approve() { approvals.shift()?.(); }, product };
}
function event(patch = {}) {
  return { button: 0, currentTarget: { target: '' }, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...patch };
}

test('the real PreviewLink plus installed Expo handler leaves modifier and non-primary activation to the browser', () => {
  for (const patch of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { currentTarget: { target: '_blank' } }]) {
    const h = setup(), click = event(patch); h.activate(click);
    assert.equal(click.defaultPrevented, false, JSON.stringify(patch)); assert.deepEqual(h.calls, []); h.approve(); assert.deepEqual(h.calls, []);
  }
});

test('plain and keyboard-generated primary clicks wait for the original guard and push once after approval', () => {
  for (const patch of [{}, { detail: 0 }, { currentTarget: { target: '_self' } }]) {
    const h = setup(), click = event(patch); h.activate(click);
    assert.equal(click.defaultPrevented, true); assert.deepEqual(h.calls, [['guard', 'workspace']]);
    h.approve(); assert.deepEqual(h.calls, [['guard', 'workspace'], ['push', '/more']]);
  }
});

test('pending denial, pre-prevented events and same-page activation never bypass the guard or double route', () => {
  const blocked = setup({ blocked: true }), click = event(); blocked.activate(click); blocked.approve();
  assert.equal(click.defaultPrevented, true); assert.deepEqual(blocked.calls, [['guard', 'workspace']]);
  const prevented = setup(); prevented.activate(event({ defaultPrevented: true })); assert.deepEqual(prevented.calls, []);
  const same = setup({ pathname: '/more' }), current = event(); same.activate(current); assert.equal(current.defaultPrevented, true); assert.deepEqual(same.calls, []);
  const external = setup({ href: '/login' }); external.activate(event()); assert.deepEqual(external.calls, [['guard', 'navigation']]);
});

test('native activation keeps the same guard and original pending state is never cleared by workspace navigation', () => {
  const h = setup({ platform: 'android' }), press = event(); delete press.button;
  h.activate(press); assert.equal(press.defaultPrevented, true); assert.deepEqual(h.calls, [['guard', 'workspace']]);
  h.approve(); assert.deepEqual(h.calls, [['guard', 'workspace'], ['push', '/more']]);
  const pending = Object.freeze({ dirty: true, pending: true, scope: 'child', retainedInWorkspace: true });
  const selected = h.product.navigationStates([['operation', pending], ['local', { dirty: true, pending: false, scope: 'child' }]], 'workspace');
  assert.equal(selected[0].pending, false); assert.equal(pending.pending, true); assert.equal(selected[1].dirty, true);
  assert.equal(h.product.navigationStates([['operation', pending]], 'child')[0].pending, true);
});
