import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual settings hook with synthetic native/platform/API boundaries; not device QA.
test('native settings only writes explicit preview consent for the active bound Android handset', async () => {
  const bindingId = 'phone', calls = [];
  let current = true, generation = 1, finish;
  let preference = { bindingId, chatNotificationsEnabled: false };
  const status = { currentBindingId: bindingId, available: true, bindings: [{ id: bindingId, status: 'active', version: 1 }], deliveries: [] };
  const api = { status: async () => status, resetOnline() {}, hasPendingOnline: () => false };
  const presence = {
    read: async () => preference,
    setEnabled(enabled, id, preview) {
      calls.push(['chat', enabled, id, preview]);
      return new Promise(resolve => { finish = () => { preference = { bindingId: id, chatNotificationsEnabled: enabled, chatPreviewEnabled: preview ?? preference.chatPreviewEnabled }; resolve(preference); }; });
    },
    async setPreviewEnabled(enabled, id) { calls.push(['preview', enabled, id]); preference = { ...preference, chatPreviewEnabled: enabled }; return preference; },
  };
  const requests = { busy: false, writing: false, start: () => ({ signal: new AbortController().signal, current: () => current, finish() {} }) };
  const h = harness({
    '../../../src/client/native-push-api.ts': { createNativePushApi: () => api },
    '../platform/native-push': { nativePushPlatform: () => 'android', nativePushSupported: () => true, nativePushPermission: async () => 'granted', listenNativePush: () => () => {} },
    './NativeChatPresenceController': { nativeChatPresenceFor: () => presence },
    './useDomainEnvironment': { useDomainWriteGuard() {} },
    './SettingsDomainSupport': { useSettingsRequests: () => requests, useSettingsRefresh() {}, settingsRead: (_env, _domain, _account, read) => read() },
  });
  const env = { apiBaseUrl: 'https://synthetic.invalid', identityKey: 'parent', userId: 'parent', online: true,
    owner: { fetcher: async () => {}, getSnapshot: () => ({ sessionGeneration: generation }) }, currentIdentity: () => current, canStartWrite: () => true };
  const { useProductionPushSettings } = h.load('src/production/useProductionPushSettings.native.ts');
  let result;
  function Subject() { result = useProductionPushSettings(env); return null; }
  const render = () => h.render(h.jsx(Subject));
  const settle = async () => { await new Promise(setImmediate); render(); };
  render(); result.actions.refresh(); await settle();
  assert.equal(result.model.chatPreviewEnabled, false, 'An older response without preview consent stays generic');
  result.actions.setChatPreviewEnabled(true); assert.deepEqual(calls, [], 'Chat must be enabled first');
  result.actions.setChatNotificationsEnabled(true); result.actions.setChatNotificationsEnabled(true);
  assert.deepEqual(calls, [['chat', true, bindingId, true]], 'One explicit enable includes preview and ignores a same-turn double tap');
  finish(); await settle(); assert.equal(result.model.chatPreviewEnabled, true);
  result.actions.setChatPreviewEnabled(false); await settle(); assert.equal(result.model.chatPreviewEnabled, false);
  preference = { bindingId, chatNotificationsEnabled: true }; result.actions.refresh(); await settle();
  result.actions.setChatPreviewEnabled(true); await settle(); assert.equal(result.model.chatPreviewEnabled, true, 'Existing enabled handsets can opt in once');
  const count = calls.length;
  env.online = false; render(); result.actions.setChatPreviewEnabled(false); assert.equal(calls.length, count);
  env.online = true; status.bindings[0].status = 'revoked'; render(); result.actions.setChatPreviewEnabled(false); assert.equal(calls.length, count);
  status.bindings[0].status = 'active'; render(); result.actions.setChatNotificationsEnabled(false);
  current = false; generation++; render(); finish(); await settle(); assert.equal(result.model.chatPreviewEnabled, null, 'A late response cannot expose the previous session');
  h.unmount();
});
