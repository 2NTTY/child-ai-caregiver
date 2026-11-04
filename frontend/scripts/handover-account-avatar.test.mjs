import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HandoverOwner } from '../src/production/HandoverOwner.ts';
import * as handoverOwner from '../src/production/HandoverOwner.ts';
import * as classExport from '../src/production/handover-class-export.ts';
import * as handover from '../../src/shared/handover.ts';
import { createHandoverApi } from '../../src/client/handover-api.ts';

test('account avatar backup uses the observed own version with no children and clears consent across sources', async () => {
  const commands = [], requests = [];
  let advertised = true;
  const api = createHandoverApi('https://example.test', async (url, init) => {
    requests.push(init);
    assert.equal(new Headers(init.headers).get('x-handover-account-backup'), '1');
    if (url.endsWith('/capabilities')) return Response.json({ classModules: ['care'], ...(advertised ? { accountAvatarBackup: true } : {}) });
    const command = JSON.parse(init.body); commands.push(command);
    return Response.json({ id: command.opId, version: 1, purpose: command.purpose, selection: command.selection, state: 'queued',
      createdAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-06T00:00:00Z', bytes: null, error: null });
  });
  const controller = new HandoverOwner(api); controller.syncContext('owner', 'owner:1', true);
  await controller.readExportCapabilities();
  assert.equal(controller.getSnapshot().accountAvatarBackup, true);
  const avatar = { key: 'owner:1', avatar: { target: { kind: 'self' }, version: 3, asset: { id: 'self-image' }, updatedAt: '2026-10-01T00:00:00Z' }, busy: false, unknown: false };
  const lane = { subscribe() {}, getSnapshot: () => avatar };
  const production = { owner: { handoverOwner: controller, avatarOwner: { self: lane } }, userId: 'owner', identityKey: 'owner:1',
    scopeKey: 'scope:1', online: true, recordsState: { children: [] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const require = createRequire(import.meta.url), ts = require('typescript');
  let instance = { cursor: 0, slots: [] };
  const jsx = (type, props, key) => ({ type, props, key });
  const hooks = { useState(initial) { const index = instance.cursor++; if (!(index in instance.slots)) instance.slots[index] = initial;
    return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
    useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe, get) => get() };
  const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' } : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/HandoverOwner') ? handoverOwner
    : name.endsWith('/useProductionSharing') ? { useProductionSharing: () => ({ controller: {}, state: { identityKey: null, selected: null,
      shares: { items: [] }, spaces: { items: [] }, teacherClasses: { items: [] } } }) }
    : name.endsWith('/handover-class-export') ? classExport : name.endsWith('/handover') ? handover
    : name.endsWith('/file-export') ? { useFileExportAvailable: () => true } : name.endsWith('/date-time') ? { hongKongTimeZone: 'Asia/Hong_Kong' }
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} } : name === 'luxon' ? require(name)
    : new Proxy({}, { get: (_target, key) => String(key) });
  const module = { exports: {} }, source = readFileSync(new URL('../src/components/account/HandoverControls.tsx', import.meta.url), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
  const render = () => { instance.cursor = 0; instance.tree = module.exports.HandoverControls(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
  const control = label => nodes(instance.tree).find(node => node.props?.label === label);
  render(); control('選擇要匯出的資料').props.onPress(); render();
  assert.equal(control('本人頭像'), undefined);
  control('本人備份').props.onPress(); render(); control('本人頭像').props.onChange(true); render();
  assert.equal(control('建立資料包').props.disabled, false);
  control('指定開始及結束日期').props.onChange(true); render();
  control('開始日期').props.onChange('2026-11-01'); control('結束日期').props.onChange('2026-11-07'); render();
  assert.match(text(instance.tree), /整張本人頭像.*指定日期以外/);
  control('用作交接').props.onPress(); render(); assert.equal(control('本人頭像'), undefined);
  control('本人備份').props.onPress(); render(); assert.equal(control('本人頭像').props.checked, false);
  control('本人頭像').props.onChange(true); render(); control('班級學生').props.onPress(); render();
  assert.equal(control('本人頭像'), undefined); assert.equal(control('建立資料包').props.disabled, true);
  control('本人孩子').props.onPress(); render(); control('本人備份').props.onPress(); render();
  advertised = false; await controller.readExportCapabilities(); render(); assert.equal(control('本人頭像'), undefined);
  advertised = true; await controller.readExportCapabilities(); render();
  control('本人頭像').props.onChange(true); render(); avatar.avatar = { ...avatar.avatar, version: 4 }; render();
  assert.equal(control('本人頭像').props.checked, false); assert.equal(control('建立資料包').props.disabled, true);
  control('本人頭像').props.onChange(true); render();
  const staleSubmit = control('建立資料包').props.onPress;
  avatar.key = 'other:1'; staleSubmit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.length, 0, 'a stale rendered callback cannot reuse another account avatar consent');
  avatar.key = 'owner:1'; render(); control('建立資料包').props.onPress(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].selection.childIds, []); assert.deepEqual(commands[0].selection.modules, []);
  assert.deepEqual(commands[0].selection.accountAvatar, { version: 4 }); assert.equal(commands[0].purpose, 'backup');
  assert.equal(commands[0].source, undefined); render(); assert.match(text(instance.tree), /本人頭像/);
  assert.ok(requests.length >= 3);
});
