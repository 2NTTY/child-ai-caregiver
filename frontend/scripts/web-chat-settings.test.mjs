import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual Web settings hook with synthetic browser/API ports; no OS prompt or push is sent.
test('Home Screen settings require explicit content selection before permission and leave worker active on reread and unmount', async () => {
  const calls = [], binding = { id: 'installation', version: 2, status: 'active', provider: 'apple', label: 'My iPhone' };
  const subscription = { endpoint: 'https://web.push.apple.com/synthetic' };
  let current = true, generation = 1, preference = { bindingId: binding.id, presenceVersion: 0, chatNotificationsEnabled: false, chatPreviewEnabled: false };
  let installed = false, failPreference = false, localMode = 'off';
  const modes = ['off', 'generic', 'preview'];
  const status = { available: true, publicKey: 'synthetic', workerEnabled: true, bindings: [], deliveries: [], testsRemaining: 3, nextTestAt: null };
  const api = { async status() { calls.push('read'); return status; }, resetOnline() {}, hasPendingOnline: () => false,
    async register() { calls.push('register'); installed = true; status.bindings = [binding]; return binding; } };
  const presence = { bind() {}, read: async () => preference,
    async setEnabled(enabled, preview, actual) { calls.push(['consent', enabled, preview, actual]); if (failPreference) throw new Error('Synthetic unknown write'); preference = { ...preference, chatNotificationsEnabled: enabled, chatPreviewEnabled: preview ?? preference.chatPreviewEnabled }; return preference; },
    async setPreviewEnabled(preview, actual) { calls.push(['preview', preview, actual]); preference = { ...preference, chatPreviewEnabled: preview }; return preference; } };
  const requests = { busy: false, writing: false, start: () => ({ signal: new AbortController().signal, current: () => current, finish() {} }) };
  const h = harness({
    '../../../src/client/web-push-api.ts': { createWebPushApi: (_base, _fetcher, options) => { assert.deepEqual(options, { version: 2 }); return api; } },
    '../../../src/client/push-browser.ts': { pushHomeScreen: () => true, pushNeedsHomeScreen: () => false, pushPermission: () => 'granted', pushBrowserSupported: () => true,
      ownedBrowserBinding: async () => installed ? binding : null, browserPushSubscription: async () => subscription,
      requestPushPermission: () => { calls.push('permission'); return Promise.resolve('granted'); },
      subscribePushBrowser: async () => { calls.push('subscribe'); return { subscription, epoch: 'epoch' }; },
      checkPushBrowserUser: async () => 'epoch',
      setPushBrowserChatPreference: async (_binding, mode, restrictOnly) => { localMode = restrictOnly ? modes[Math.min(modes.indexOf(localMode), modes.indexOf(mode))] : mode; return 'epoch'; },
      activatePushBrowser: async () => calls.push('activate'), suspendPushBrowser: async () => calls.push('suspend') },
    './WebChatPresenceController': { webChatPresenceFor: () => presence },
    './useDomainEnvironment': { useDomainWriteGuard() {} },
    './SettingsDomainSupport': { useSettingsRequests: () => requests, useSettingsRefresh() {}, settingsRead: (_env, _domain, _account, read) => read(), settingsFailure: () => ({ status: 0 }), settingsAccessError: () => false },
  });
  const env = { apiBaseUrl: 'https://synthetic.invalid', identityKey: 'parent', userId: 'parent', online: true,
    owner: { fetcher: async () => {}, getSnapshot: () => ({ sessionGeneration: generation }) }, currentIdentity: () => current, canStartWrite: () => true, invalidate() {} };
  const { useProductionPushSettings } = h.load('src/production/useProductionPushSettings.ts');
  let result;
  function Subject() { result = useProductionPushSettings(env); return null; }
  const render = () => h.render(h.jsx(Subject));
  const settle = async () => { await new Promise(setImmediate); render(); };
  render(); result.actions.refresh(); await settle();
  result.actions.stageEnable('My iPhone'); render(); result.actions.confirmReview(true); render(); result.actions.submit();
  assert.deepEqual(calls, ['read'], 'A confirmed registration without a content selection cannot request OS permission');
  result.actions.setChatNotificationMode('generic'); render(); assert.equal(result.model.review.confirmed, false);
  result.actions.confirmReview(true); render(); result.actions.submit();
  assert.equal(calls.at(-1), 'permission', 'The OS request begins synchronously in the explicit confirm gesture');
  await settle();
  assert.deepEqual(calls.slice(1, 6), ['permission', 'subscribe', 'register', 'activate', ['consent', true, false, subscription]]);
  assert.equal(result.model.chatNotificationsEnabled, true); assert.equal(result.model.chatPreviewEnabled, false);
  result.actions.setChatPreviewEnabled(true); await settle(); assert.equal(result.model.chatPreviewEnabled, true);
  result.actions.setChatNotificationsEnabled(false); await settle(); assert.equal(result.model.chatNotificationsEnabled, false);
  result.actions.setChatNotificationsEnabled(true); await settle(); assert.equal(localMode, 'preview');
  failPreference = true; result.actions.setChatNotificationsEnabled(false); await settle(); assert.equal(localMode, 'off');
  result.actions.refresh(); await settle();
  assert.equal(localMode, 'off', 'An unknown disable and subsequent server reread cannot silently loosen the local restriction');
  current = false; generation++; render(); assert.equal(result.model.chatNotificationsEnabled, null);
  h.unmount(); assert.equal(calls.includes('suspend'), false, 'Routine reads and unmount never suspend the installed worker');
});
