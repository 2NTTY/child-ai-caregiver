import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as handoverOwner from '../src/production/HandoverOwner.ts';
import * as handoverContract from '../../src/shared/handover.ts';
import * as handoverImportContract from '../../src/shared/handover-imports.ts';
import * as handoverImportOwner from '../src/production/HandoverImportOwner.ts';
import { createHandoverApi, HandoverApiError } from '../../src/client/handover-api.ts';
import * as classTargets from '../src/production/handover-class-targets.ts';
import * as classExport from '../src/production/handover-class-export.ts';

const require = createRequire(import.meta.url), ts = require('typescript');
const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
let current, production;
const hooks = { useState(initial) { const instance = current, index = instance.cursor++;
  if (!(index in instance.slots)) instance.slots[index] = initial;
  return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
  useEffect: noop, useLayoutEffect: noop, useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, get) => get() };
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} }, source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' }
    : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/useProductionSharing') ? { useProductionSharing: () => ({ controller: {}, state: { identityKey: null, selected: null, shares: { items: [] }, spaces: { items: [] }, teacherClasses: { items: [] }, rosterQuery: '' } }) }
    : name.endsWith('/handover-class-targets') ? classTargets
    : name.endsWith('/handover-class-export') ? classExport
    : name.endsWith('/HandoverOwner') ? handoverOwner
    : name.endsWith('/HandoverImportOwner') ? handoverImportOwner
    : name.endsWith('/handover-api') ? { HandoverApiError }
    : name.endsWith('/handover') ? handoverContract
    : name.endsWith('/handover-imports') ? handoverImportContract
    : name.endsWith('/date-time') ? load('../src/components/date-time.ts')
    : name.endsWith('/file-export') ? { useFileExportAvailable: () => true }
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} }
    : name === 'luxon' || name === 'zod' ? require(name)
    : new Proxy({}, { get: (_value, key) => String(key) });
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
  cache.set(path, module.exports); return module.exports;
}
function render(component, instance = { slots: [] }) { current = instance; instance.cursor = 0; instance.tree = component(); return instance; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const control = (view, label) => nodes(view.tree).find(node => node.props?.label === label);

// Real shared export component, contract, owner and date utilities; synthetic transport, no network or picker.
test('handover period selection preserves inclusive Hong Kong days with supported memory and document reviews', async () => {
  const id = '00000000-0000-4000-8000-000000000001', sent = [];
  const controller = new handoverOwner.HandoverOwner({ setIdentity() {}, async create(_user, command) {
    sent.push(command);
    return { id: command.opId, version: 1, purpose: command.purpose, selection: command.selection, state: 'queued',
      createdAt: '2026-11-04T00:00:00Z', expiresAt: '2026-11-05T00:00:00Z', bytes: null, error: null };
  }, async preview() { return { items: [], scopeVersion: 'a'.repeat(64), nextCursor: null }; } });
  controller.syncContext('owner', 'owner:1', true);
  production = { owner: { handoverOwner: controller }, userId: 'owner', identityKey: 'owner:1', online: true,
    recordsState: { children: [{ id, displayName: 'Own child', accessRole: 'owner' }] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const component = load('../src/components/account/HandoverControls.tsx').HandoverControls, view = render(component);
  const again = () => render(component, view);
  const open = () => { control(view, '選擇要匯出的資料').props.onPress(); again(); control(view, 'Own child').props.onChange(true); again(); };
  open(); control(view, '照護記錄').props.onChange(true); again();
  const periodToggle = control(view, '指定開始及結束日期'); assert.ok(periodToggle, 'the existing export entry must offer a date range');
  assert.equal(periodToggle.props.checked, false);
  control(view, '建立資料包').props.onPress(); await Promise.resolve(); await Promise.resolve(); again();
  assert.equal(sent[0].selection.period, null, 'all-time remains the original default');
  open();
  for (const label of ['照護記錄', '待辦', '私人聊天', '持續關注']) { control(view, label).props.onChange(true); again(); }
  control(view, '指定開始及結束日期').props.onChange(true); again();
  const from = () => control(view, '開始日期'), to = () => control(view, '結束日期');
  assert.ok(from() && to(), 'use the common date fields');
  assert.equal(control(view, '建立資料包').props.disabled, true);
  from().props.onChange('2026-02-30'); to().props.onChange('2026-11-04'); again();
  assert.equal(control(view, '建立資料包').props.disabled, true, 'invalid dates cannot broaden into all-time');
  from().props.onChange('2026-11-05'); again();
  assert.equal(control(view, '建立資料包').props.disabled, true, 'the end date must follow the start');
  from().props.onChange('2026-11-04'); again();
  control(view, '記憶與摘要').props.onChange(true); again();
  assert.equal(control(view, '指定開始及結束日期').props.checked, true, 'module changes preserve the requested period');
  assert.equal(from().props.value, '2026-11-04');
  assert.equal(handoverContract.supportsHandoverPeriodModules(['memory', 'documents']), true);
  assert.equal(control(view, '建立資料包').props.disabled, false, 'memory now supports the requested range');
  assert.doesNotMatch(text(view.tree), /所選模組未支援日期範圍/);
  assert.doesNotMatch(text(view.tree), /歷史不完整/);
  control(view, '準備單與文件').props.onChange(true); again();
  assert.equal(control(view, '建立資料包').props.disabled, true, 'supported documents still require their actual review');
  const selection = { childIds: [id], modules: ['care', 'tasks', 'chat', 'concerns', 'memory', 'documents'],
    period: { from: '2026-11-03T16:00:00.000Z', to: '2026-11-04T15:59:59.999Z' } };
  const reviewBasis = JSON.stringify(['owner:1', undefined, [[id, undefined, 'owner']]]);
  controller.setReviewSelection(selection, reviewBasis); await controller.loadReview(); again();
  assert.equal(control(view, '建立資料包').props.disabled, false);
  control(view, '建立資料包').props.onPress(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(sent[1].selection, selection);
  assert.deepEqual(sent[1].documentReview, { scopeVersion: 'a'.repeat(64), choices: [] });
  const importState = { ...controller.getSnapshot(), items: [], uploads: [], upload: { id, state: 'ready', filename: 'period.zip', bytes: 3,
    preview: { integrity: 'trusted', children: [], coverage: [], header: { source: { serverId: 'source.test' }, selection: sent[1].selection } } } };
  production.owner.handoverImportOwner = { subscribe: noop, getSnapshot: () => importState };
  production.owner.sharedChild = { subscribe: noop, getSnapshot: () => ({ phase: 'idle' }) };
  const importComponent = load('../src/components/account/HandoverImportControls.tsx').HandoverImportControls, preview = render(importComponent);
  control(preview, '查看上載與匯入選擇').props.onPress(); render(importComponent, preview);
  assert.match(text(preview.tree), /來源指定日期（香港時間）：\s*2026-11-04\s*至\s*2026-11-04/);
});

test('original document review negotiates capabilities and keeps colliding document and preparation identities through submission', async () => {
  const childId = '00000000-0000-4000-8000-000000000001', uploadId = '00000000-0000-4000-8000-000000000002';
  const manifestSha256 = 'a'.repeat(64), time = '2026-11-05T00:00:00Z', writes = [], queries = [];
  let modules, batch;
  const document = { id: childId, targetId: childId, resourceSection: 'documents', backupVersion: 3, localVersion: 8,
    state: 'local_newer', changedFields: ['request', 'currentSnapshot'] };
  const preparation = { ...document, resourceSection: 'visit_preparation', backupVersion: 5, localVersion: 9,
    changedFields: ['questions', 'appointmentTaskId'] };
  const upload = { id: uploadId, version: 2, filename: 'original-documents.zip', bytes: 3, state: 'ready', error: null, createdAt: time,
    expiresAt: '2026-11-06T00:00:00Z', preview: { integrity: 'trusted', manifestSha256, children: [{ id: childId, displayName: 'Original child' }], coverage: [],
      header: { format: 'yuyoufang-data', version: 1, packageId: uploadId, packageVersion: 1, createdAt: time, purpose: 'backup',
        source: { serverId: 'source.test', accountId: 'owner' }, selection: { childIds: [childId], modules: ['care', 'documents'], period: null } } } };
  const api = createHandoverApi('https://example.test', async (url, init) => {
    const header = new Headers(init.headers).get('x-handover-original-modules');
    if (url.endsWith('/capabilities')) {
      assert.equal(header, '1');
      if (modules === null) return new Response(null, { status: 503 });
      return Response.json({ classEnrolment: false, ...(modules === undefined ? {} : { originalModules: modules }) });
    }
    assert.equal(header, null, 'original module negotiation is limited to capabilities');
    if (url.includes('/package-uploads/')) return Response.json(upload);
    if (url.endsWith('/compare-original')) {
      const query = JSON.parse(init.body); queries.push(query);
      return Response.json({ uploadId, manifestSha256, childId, module: 'documents', items: [document, preparation], nextCursor: query.cursor ? null : 'next' });
    }
    if (url.includes('/items?')) return Response.json({ batchId: batch.id, sourceChildId: childId, module: 'documents', nextCursor: null, complete: true,
      items: [document, preparation].map((item, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 3}`, batchId: batch.id, sourceChildId: childId,
        module: 'documents', sourceResourceId: childId, sourceVersion: item.backupVersion, resourceSection: item.resourceSection, sourceSection: null,
        at: time, outcome: 'conflict', reason: index ? 'appointment_changed' : 'document_source_changed', recordedResource: null,
        currentResource: { id: childId, version: item.localVersion, deleted: false }, availableResolution: null })) });
    if (init.method === 'GET') return Response.json(batch);
    const command = JSON.parse(init.body); writes.push(command);
    batch = { id: command.opId, version: 1, uploadId, packageId: uploadId, packageVersion: 1, manifestSha256, integrity: 'trusted',
      targets: command.targets, state: 'completed', totalItems: 2, processedItems: 2, counts: { created: 0, updated: 0, skipped: 0, conflict: 2 },
      error: null, createdAt: time, updatedAt: time };
    throw Error('Synthetic lost create response');
  });
  const controller = new handoverImportOwner.HandoverImportOwner(api); controller.syncContext('owner', 'owner:1', true);
  await controller.readImportCapabilities();
  assert.deepEqual(controller.getSnapshot().originalModules, ['care', 'profile', 'tasks', 'sources']);
  await controller.openUpload(uploadId);
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => ({ phase: 'idle' }) } },
    userId: 'owner', identityKey: 'owner:1', online: true, recordsState: { children: [{ id: childId, displayName: 'Original child', accessRole: 'owner' }] },
    account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const component = load('../src/components/account/HandoverImportControls.tsx').HandoverImportControls, view = render(component);
  const again = () => render(component, view), settle = () => new Promise(resolve => setImmediate(resolve));
  control(view, '查看上載與匯入選擇').props.onPress(); again();
  assert.deepEqual(control(view, '比較資料類別').props.options.map(item => item.value), ['care']);
  await controller.compareOriginal(childId, 'documents'); assert.equal(queries.length, 0, 'old servers cannot receive a document comparison');
  modules = []; await controller.readImportCapabilities(); again();
  assert.equal(control(view, '比較資料類別'), undefined, 'an explicit empty capability disables all original modules');
  modules = null; await controller.readImportCapabilities();
  assert.deepEqual(controller.getSnapshot().originalModules, [], 'a failed refresh cannot widen a known empty capability');
  modules = ['documents', 'future_module']; await controller.readImportCapabilities(); again();
  assert.deepEqual(control(view, '比較資料類別').props.options.map(item => item.value), ['documents']);
  control(view, '比較原有資料的孩子').props.onChange(childId); control(view, '比較資料類別').props.onChange('documents'); again();
  control(view, '比較原有資料').props.onPress(); await settle(); again();
  assert.equal(controller.getSnapshot().comparison.items.length, 2);
  assert.match(text(view.tree), /文件設定/); assert.match(text(view.tree), /文件內容/);
  assert.match(text(view.tree), /到診問題/); assert.match(text(view.tree), /預約連結/);
  const checkboxes = () => nodes(view.tree).filter(node => node.props?.label === '以備份覆蓋此項');
  assert.equal(checkboxes().length, 2); checkboxes()[0].props.onChange(true); again();
  assert.equal(checkboxes()[0].props.checked, true); assert.equal(checkboxes()[1].props.checked, false);
  const itemViews = nodes(view.tree).filter(node => node.key && node.props?.children?.some?.(child => child?.props?.children?.includes?.(childId)));
  assert.ok(new Set(itemViews.map(node => node.key)).size >= 2, 'colliding source IDs have distinct React identities');
  control(view, '下一頁比較結果').props.onPress(); await settle(); again();
  assert.equal(controller.getSnapshot().comparison.items.length, 2, 'repeated pages deduplicate by section and ID');
  assert.equal(checkboxes()[0].props.checked, true); assert.equal(checkboxes()[1].props.checked, false);
  checkboxes()[1].props.onChange(true); again(); const stale = control(view, '提交所選原項還原（2 項）').props.onPress;
  await controller.compareOriginal(childId, 'documents'); stale(); await settle(); assert.equal(writes.length, 0);
  again(); checkboxes()[0].props.onChange(true); again(); checkboxes()[1].props.onChange(true); again();
  control(view, '提交所選原項還原（2 項）').props.onPress(); await settle();
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].resolutions.map(row => [row.section, row.resourceId, row.resolution.expectedVersion]),
    [['documents', childId, 8], ['visit_preparation', childId, 9]]);
  assert.equal(writes[0].restoreOriginal, true); assert.equal(writes[0].resolutionOnly, true);
  assert.equal(controller.getSnapshot().pending.checked, false); await controller.retryOriginal(); assert.equal(writes.length, 1);
  await controller.checkOriginal(); assert.equal(controller.getSnapshot().pending, null);
  assert.equal(controller.getSnapshot().items[0].id, writes[0].opId);
  controller.selectResults(batch.id, childId, 'documents'); await controller.readResults();
  const resultsComponent = load('../src/components/account/HandoverImportResults.tsx').HandoverImportResults;
  const results = render(() => resultsComponent({ controller, batch, results: controller.getSnapshot().results, history: null, identityKey: 'owner:1', locked: false }));
  assert.match(text(results.tree), /文件.*有衝突/); assert.match(text(results.tree), /到診準備.*有衝突/);
  assert.match(text(results.tree), /引用.*變更/); assert.match(text(results.tree), /預約.*變更/);
  assert.doesNotMatch(text(results.tree), /document_source_changed|appointment_changed/);
});

test('cleaned upload history is on demand, separately paged and read-only across server errors and identity changes', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, queries = [];
  const row = (n, filename, state, error = null) => ({ id: id(n), version: 3, filename, state, error, bytes: 3,
    createdAt: '2026-11-04T09:00:00Z', expiresAt: '2026-11-05T09:00:00Z' });
  const active = row(1, 'Active.zip', 'ready'), failed = row(2, 'Failed backup.zip', 'failed', 'package_hash_mismatch');
  failed.expectedArchiveSha256 = 'b'.repeat(64);
  const cancelled = row(3, 'Cancelled backup.zip', 'cancelled'), other = row(4, 'Other owner history.zip', 'expired');
  let available = false, hold = false, late, opens = 0;
  const api = createHandoverApi('https://example.test', async (input, init) => {
    const url = new URL(input), actor = new Headers(init.headers).get('x-expected-user-id');
    if (url.pathname !== '/api/account/package-uploads') { opens++; return Response.json({ ...failed, preview: null }); }
    queries.push({ actor, history: url.searchParams.get('history'), cursor: url.searchParams.get('cursor') });
    if (!url.searchParams.has('history')) return Response.json({ items: [active], nextCursor: 'active-next' });
    assert.equal(url.searchParams.get('history'), 'cleaned');
    if (!available) return Response.json({ error: { code: 'invalid_input' } }, { status: 400 });
    const response = Response.json({ items: actor === 'other' ? [other] : url.searchParams.has('cursor') ? [cancelled] : [failed],
      nextCursor: actor === 'other' || url.searchParams.has('cursor') ? null : 'history-next' });
    return hold ? new Promise(resolve => { late = () => resolve(response); }) : response;
  });
  const controller = new handoverImportOwner.HandoverImportOwner(api); controller.syncContext('owner', 'owner:1', true);
  assert.equal(typeof controller.loadCleanedUploads, 'function');
  await controller.loadUploads(); assert.equal(queries.length, 1); assert.equal(queries[0].history, null);
  assert.equal(controller.getSnapshot().cleanedUploads, null);
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => ({ phase: 'idle' }) } },
    userId: 'owner', identityKey: 'owner:1', online: true, recordsState: { children: [] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const component = load('../src/components/account/HandoverImportControls.tsx').HandoverImportControls, view = render(component);
  const again = () => render(component, view), settle = () => new Promise(resolve => setImmediate(resolve));
  assert.ok(control(view, '讀取已清理上載歷史')); assert.equal(queries.length, 1, 'rendering does not fetch history');
  control(view, '讀取已清理上載歷史').props.onPress(); await settle(); again();
  assert.match(text(view.tree), /HTTP 400/); assert.match(text(view.tree), /invalid_input/);
  assert.doesNotMatch(text(view.tree), /沒有已清理的上載紀錄/);
  assert.equal(controller.getSnapshot().cleanedUploads.loaded, false);
  available = true; control(view, '讀取已清理上載歷史').props.onPress(); await settle(); again();
  assert.match(text(view.tree), /Failed backup.zip/); assert.match(text(view.tree), /上載日期/);
  assert.match(text(view.tree), /原上載參考/); assert.match(text(view.tree), /package_hash_mismatch/);
  assert.match(text(view.tree), /選取檔案 SHA-256/); assert.match(text(view.tree), new RegExp('b'.repeat(64)));
  assert.match(text(view.tree), /尚無可核對包身份/); assert.match(text(view.tree), /不代表已核實的內容或簽章/);
  const historyRow = nodes(view.tree).find(node => node.type === 'View' && node.props?.children?.some?.(child => text(child) === failed.filename));
  assert.ok(historyRow); assert.equal(nodes(historyRow).filter(node => node.props?.onPress || node.props?.onChange).length, 0);
  await controller.openUpload(failed.id); assert.equal(opens, 0, 'a known cleaned upload cannot be reopened for import');
  assert.equal(controller.getSnapshot().upload, null); assert.match(controller.getSnapshot().notice, /已清理/);
  control(view, '載入更多已清理上載歷史').props.onPress(); await settle(); again();
  assert.deepEqual(controller.getSnapshot().cleanedUploads.items.map(item => item.id), [failed.id, cancelled.id]);
  assert.equal(controller.getSnapshot().uploadsCursor, 'active-next');
  assert.equal(queries.at(-1).cursor, 'history-next'); assert.equal(queries.at(-1).history, 'cleaned');
  hold = true; const reading = controller.loadCleanedUploads(); await settle();
  controller.syncContext('other', 'other:1', true); late(); await reading;
  assert.equal(controller.getSnapshot().cleanedUploads, null); assert.deepEqual(controller.getSnapshot().uploads, []);
  hold = false; production.userId = 'other'; production.identityKey = 'other:1';
  await controller.loadCleanedUploads(); again();
  assert.deepEqual(controller.getSnapshot().cleanedUploads.items.map(item => item.id), [other.id]);
  assert.equal(queries.at(-1).cursor, null); assert.equal(queries.at(-1).actor, 'other');
  assert.doesNotMatch(text(view.tree), /Failed backup.zip|Cancelled backup.zip/);
});
