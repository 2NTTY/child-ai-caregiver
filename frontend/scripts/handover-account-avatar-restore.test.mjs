import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as importOwner from '../src/production/HandoverImportOwner.ts';
import * as importContract from '../../src/shared/handover-imports.ts';
import * as classTargets from '../src/production/handover-class-targets.ts';
import { createHandoverApi } from '../../src/client/handover-api.ts';

test('shared account avatar restore verifies a zero-child backup and follows the original batch through unknown and conflict', async () => {
  const uploadId = randomUUID(), manifestSha256 = 'a'.repeat(64), commands = [], time = '2026-11-05T00:00:00Z';
  let advertised = true, comparisonState = 'different', localVersion = 5, unknown = true, batch, heldComparison, hold = false, rejectVersion = false;
  let summaryResult = { outcome: 'conflict', reason: 'version_conflict', backupVersion: 2, localVersion: 6, assetId: null };
  let upload = { id: uploadId, version: 2, filename: 'own-avatar.zip', bytes: 3, state: 'ready', error: null, createdAt: time, expiresAt: '2026-11-06T00:00:00Z',
    preview: { integrity: 'missing_proof', manifestSha256, children: [], coverage: [], header: { format: 'yuyoufang-data', version: 2,
      packageId: randomUUID(), packageVersion: 1, createdAt: time, purpose: 'backup', source: { serverId: 'source.test', accountId: 'owner' },
      selection: { childIds: [], modules: [], period: null, accountAvatar: { version: 2 } } } } };
  const api = createHandoverApi('https://example.test', async (url, init) => {
    assert.equal(new Headers(init.headers).get('x-handover-account-backup'), '1');
    if (url.endsWith('/capabilities')) return Response.json({ classEnrolment: false, ...(advertised ? { accountAvatarRestore: true } : {}) });
    if (url.includes('/package-uploads/')) return Response.json(upload);
    if (url.endsWith('/compare-account-avatar')) {
      assert.deepEqual(JSON.parse(init.body), { uploadId, expectedUploadVersion: upload.version });
      const response = Response.json({ uploadId, manifestSha256, backupVersion: 2, localVersion, state: comparisonState });
      return hold ? new Promise(resolve => { heldComparison = () => resolve(response); }) : response;
    }
    if (url.endsWith('/summary')) return Response.json({ batchId: batch.id, state: 'completed', processedItems: 1, totalItems: 1,
      modules: [], accountAvatar: { result: summaryResult } });
    if (init.method === 'GET') return batch && url.endsWith('/' + batch.id) ? Response.json(batch) : Response.json({}, { status: 404 });
    const command = JSON.parse(init.body); commands.push(command);
    if (rejectVersion) return Response.json({ error: { code: 'version_conflict' } }, { status: 409 });
    batch = { id: command.opId, version: 1, uploadId, packageId: upload.preview.header.packageId, packageVersion: 1, manifestSha256,
      integrity: 'missing_proof', targets: [], state: 'queued', processedItems: 0, totalItems: 1,
      counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null, createdAt: time, updatedAt: time };
    if (unknown) { unknown = false; throw new TypeError('Synthetic lost response'); }
    return Response.json(batch);
  });
  const controller = new importOwner.HandoverImportOwner(api); controller.syncContext('owner', 'owner:1', true);
  await controller.readImportCapabilities(); assert.equal(controller.getSnapshot().accountAvatarRestoreEnabled, true);
  await controller.openUpload(uploadId);
  const production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe() {}, getSnapshot: () => ({ phase: 'idle' }) } },
    userId: 'owner', identityKey: 'owner:1', online: true, recordsState: { children: [] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const require = createRequire(import.meta.url), ts = require('typescript'), jsx = (type, props, key) => ({ type, props, key });
  const instance = { cursor: 0, slots: [] };
  const slot = initial => { const index = instance.cursor++; if (!(index in instance.slots)) instance.slots[index] = initial; return index; };
  const hooks = { useState(initial) { const index = slot(initial); return [instance.slots[index], next => {
    instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
    useRef(initial) { return instance.slots[slot({ current: initial })]; }, useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe, get) => get() };
  const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' } : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/HandoverImportOwner') ? importOwner : name.endsWith('/handover-imports') ? importContract
    : name.endsWith('/handover-class-targets') ? classTargets
    : name.endsWith('/useProductionSharing') ? { useProductionSharing: () => ({ controller: {}, state: { identityKey: null, selected: null,
      shares: { items: [] }, spaces: { items: [] }, teacherClasses: { items: [] } } }) }
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} } : new Proxy({}, { get: (_target, key) => String(key) });
  const module = { exports: {} }, source = readFileSync(new URL('../src/components/account/HandoverImportControls.tsx', import.meta.url), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
  const render = () => { instance.cursor = 0; instance.tree = module.exports.HandoverImportControls(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
  const control = label => nodes(instance.tree).find(node => node.props?.label === label);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  render(); control('查看上載與匯入選擇').props.onPress(); render();
  assert.ok(control('比較本人頭像')); assert.equal(control('以備份還原本人頭像'), undefined);
  advertised = false; await controller.readImportCapabilities(); render(); assert.equal(control('比較本人頭像'), undefined);
  advertised = true; await controller.readImportCapabilities(); render();
  control('比較本人頭像').props.onPress(); await settle(); render();
  assert.match(text(instance.tree), /備份版本\s*2.*目前版本\s*5/); assert.equal(commands.length, 0, 'comparison cannot write the avatar');
  const stale = control('以備份還原本人頭像').props.onPress;
  upload = { ...upload, version: 3 }; await controller.openUpload(uploadId); stale(); await settle();
  assert.equal(commands.length, 0, 'a stale comparison cannot restore a changed upload'); render();
  control('比較本人頭像').props.onPress(); await settle(); render(); control('以備份還原本人頭像').props.onPress(); await settle();
  assert.equal(commands.length, 1); assert.equal(controller.getSnapshot().pending.checked, false);
  assert.deepEqual(commands[0].accountAvatar, { expectedVersion: 5, mode: 'replace_current' });
  assert.deepEqual(commands[0].targets, []); assert.deepEqual(commands[0].resolutions, []);
  assert.equal(commands[0].restoreOriginal, true); assert.equal(commands[0].resolutionOnly, true);
  assert.equal(commands[0].acceptedManifestSha256, manifestSha256);
  await controller.retryOriginal(); assert.equal(commands.length, 1, 'unknown must check the original operation first');
  render(); control('查回原匯入請求').props.onPress(); await settle(); assert.equal(controller.getSnapshot().pending, null);
  assert.equal(controller.getSnapshot().items[0].id, commands[0].opId);
  await controller.readSummary(batch.id); render(); assert.match(text(instance.tree), /本人頭像.*衝突/);
  summaryResult = { ...summaryResult, outcome: 'skipped', reason: 'unchanged' }; await controller.readSummary(batch.id); render();
  assert.match(text(instance.tree), /本人頭像.*略過/);
  summaryResult = null; await controller.readSummary(batch.id); render(); assert.match(text(instance.tree), /本人頭像.*尚未/);
  await controller.openUpload(uploadId); comparisonState = 'deleted'; await controller.compareAccountAvatar(); render();
  control('恢復已刪除的本人頭像').props.onPress(); await settle(); assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].accountAvatar, { expectedVersion: 5, mode: 'restore_deleted' });
  await controller.openUpload(uploadId);
  for (const state of ['empty_backup', 'unchanged']) {
    comparisonState = state; await controller.compareAccountAvatar(); render();
    assert.equal(control('以備份還原本人頭像'), undefined); assert.equal(control('恢復已刪除的本人頭像'), undefined);
  }
  comparisonState = 'missing'; localVersion = 0; await controller.compareAccountAvatar(); render();
  assert.ok(control('以備份還原本人頭像'), 'an empty current account can receive the verified backup image');
  comparisonState = 'different'; localVersion = 6; rejectVersion = true;
  await controller.compareAccountAvatar(); render(); control('以備份還原本人頭像').props.onPress(); await settle();
  assert.equal(controller.getSnapshot().pending.rejected, true); assert.equal(controller.getSnapshot().accountAvatarComparison, null);
  await controller.checkOriginal(); assert.equal(controller.getSnapshot().pending, null);
  assert.equal(commands.length, 3, 'a refused version with no original batch requires a fresh comparison, never a blind retry');
  for (const patch of [{ integrity: 'untrusted_signer' }, { header: { ...upload.preview.header, source: { serverId: 'other.test', accountId: 'other' } } }]) {
    const original = upload; upload = { ...upload, preview: { ...upload.preview, ...patch } }; await controller.openUpload(uploadId); render();
    assert.equal(control('比較本人頭像'), undefined); upload = original;
  }
  await controller.openUpload(uploadId); hold = true; comparisonState = 'different'; const reading = controller.compareAccountAvatar();
  controller.syncContext('other', 'other:1', true); heldComparison(); await reading;
  assert.equal(controller.getSnapshot().accountAvatarComparison, null); assert.equal(controller.getSnapshot().accountAvatarRestoreEnabled, false);
});
