import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as importOwner from '../src/production/HandoverImportOwner.ts';
import * as importContract from '../../src/shared/handover-imports.ts';
import * as classTargets from '../src/production/handover-class-targets.ts';
import { createHandoverApi } from '../../src/client/handover-api.ts';

test('original growth form negotiates two resource sections and submits only verified unblocked current identities', async () => {
  const childId = randomUUID(), uploadId = randomUUID(), at = '2026-11-08T04:00:00Z', manifestSha256 = 'c'.repeat(64);
  const commands = [], queries = [], headers = [];
  let supported = false, responseRows, hold, held;
  const attention = { id: randomUUID(), resourceSection: 'growth_attention', backupVersion: 2, localVersion: 4, state: 'local_newer',
    changedFields: ['note', 'state'], growth: { topicId: 'toddler_play', at, blocked: null } };
  attention.targetId = attention.id;
  const topic = { ...attention, id: randomUUID(), resourceSection: 'growth_topics', changedFields: ['disabled'], growth: { topicId: 'school_vision', at, blocked: null } };
  topic.targetId = topic.id;
  const blocked = { ...attention, id: randomUUID(), state: 'unavailable', growth: { topicId: 'solid_food', at, blocked: 'growth_terminal_state' } };
  blocked.targetId = blocked.id;
  const disabled = { ...topic, id: randomUUID(), state: 'unavailable', growth: { topicId: 'school_vision', at, blocked: 'growth_topic_disabled' } };
  disabled.targetId = disabled.id;
  responseRows = [attention, topic, blocked, disabled, { ...attention, id: randomUUID(), targetId: undefined, localVersion: null, state: 'unavailable' }];
  const upload = { id: uploadId, version: 3, filename: 'own-growth.zip', bytes: 3, state: 'ready', error: null, createdAt: at, expiresAt: '2026-11-09T00:00:00Z',
    preview: { integrity: 'trusted', manifestSha256, children: [{ id: childId, displayName: '原孩子' }],
      coverage: [{ section: 'growth_attention', childId, items: 4 }, { section: 'growth_topics', childId, items: 2 }],
      header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1, createdAt: at, purpose: 'backup',
        source: { serverId: 'source.test', accountId: 'owner' }, selection: { childIds: [childId], modules: ['growth'], period: null } } } };
  const api = createHandoverApi('https://example.test', async (url, init) => {
    if (url.endsWith('/capabilities')) { headers.push(new Headers(init.headers)); return Response.json({ classEnrolment: false, originalModules: supported ? ['growth'] : [] }); }
    if (url.includes('/package-uploads/')) return Response.json(upload);
    if (url.endsWith('/compare-original')) {
      queries.push(JSON.parse(init.body));
      const response = () => Response.json({ uploadId, manifestSha256, childId, module: 'growth', items: responseRows, nextCursor: null });
      return hold ? new Promise(resolve => { held = () => resolve(response()); }) : response();
    }
    const command = JSON.parse(init.body); commands.push(command);
    return Response.json({ id: command.opId, version: 1, uploadId, packageId: upload.preview.header.packageId, packageVersion: 1, manifestSha256,
      integrity: 'trusted', targets: command.targets, state: 'queued', processedItems: 0, totalItems: 2,
      counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null, createdAt: at, updatedAt: at });
  });
  const controller = new importOwner.HandoverImportOwner(api); controller.syncContext('owner', 'owner:1', true);
  await controller.readImportCapabilities(); await controller.openUpload(uploadId);
  assert.ok(headers[0].get('x-handover-original-features').split(',').includes('growth'));
  await controller.compareOriginal(childId, 'growth'); assert.equal(queries.length, 0);
  const production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe() {}, getSnapshot: () => ({ phase: 'idle' }) } },
    userId: 'owner', identityKey: 'owner:1', online: true, recordsState: { children: [{ id: childId, displayName: '原孩子', accessRole: 'owner' }] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const require = createRequire(import.meta.url), ts = require('typescript'), jsx = (type, props, key) => ({ type, props, key });
  const instance = { cursor: 0, slots: [] }, cache = new Map();
  const slot = initial => { const index = instance.cursor++; if (!(index in instance.slots)) instance.slots[index] = initial; return index; };
  const hooks = { useState(initial) { const index = slot(initial); return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
    useRef(initial) { return instance.slots[slot({ current: initial })]; }, useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe, get) => get() };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} }, source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
      : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
      : name === 'react-native-paper' ? { Text: 'Text' } : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
      : name.endsWith('/HandoverImportOwner') ? importOwner : name.endsWith('/handover-imports') ? importContract
      : name.endsWith('/HandoverImportHistory') ? load('../src/components/account/HandoverImportHistory.tsx')
      : name.endsWith('/handover-class-targets') ? classTargets : name.endsWith('/date-time') ? { hongKongTimeZone: 'Asia/Hong_Kong', dateTimeParts: () => null }
      : name.endsWith('/useProductionSharing') ? { useProductionSharing: () => ({ controller: {}, state: { identityKey: null, selected: null, shares: { items: [] }, spaces: { items: [] }, teacherClasses: { items: [] } } }) }
      : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} } : new Proxy({}, { get: (_target, key) => String(key) });
    new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
    cache.set(path, module.exports); return module.exports;
  }
  const component = load('../src/components/account/HandoverImportControls.tsx').HandoverImportControls;
  const render = () => { instance.cursor = 0; instance.tree = component(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
  const controls = label => nodes(instance.tree).filter(node => node.props?.label === label), control = label => controls(label)[0], settle = () => new Promise(resolve => setImmediate(resolve));
  render(); control('查看上載與匯入選擇').props.onPress(); render();
  assert.equal(control('比較資料類別')?.props.options.some(option => option.value === 'growth') ?? false, false);
  supported = true; await controller.readImportCapabilities(); render();
  control('比較原有資料的孩子').props.onChange(childId); control('比較資料類別').props.onChange('growth'); render();
  control('比較原有資料').props.onPress(); await settle(); render();
  assert.equal(queries[0].module, 'growth');
  assert.match(text(instance.tree), /幼兒遊戲與溝通/); assert.match(text(instance.tree), /學童視力關注/);
  assert.match(text(instance.tree), /事項建立於/); assert.match(text(instance.tree), /主題設定更新於/);
  assert.match(text(instance.tree), /2026/); assert.doesNotMatch(text(instance.tree), /2026-11-08T04:00:00Z|備份時間/);
  assert.match(text(instance.tree), /補充內容/); assert.match(text(instance.tree), /主題停用設定/);
  assert.match(text(instance.tree), /這項成長事項已有處理結果，會保留目前狀態/); assert.match(text(instance.tree), /停用/);
  assert.equal(controls('以備份覆蓋此項').length, 2);
  controller.selectReadComparison('replace_current', true);
  for (const row of [blocked, disabled]) controller.selectComparison(row, true);
  assert.equal(controller.getSnapshot().comparison.selected.length, 2);
  assert.equal(importOwner.originalComparisonResolution({ ...blocked, state: 'different' }), null);
  assert.equal(importOwner.originalComparisonResolution({ ...attention, targetId: randomUUID() }), null);
  assert.equal(importOwner.originalComparisonResolution({ ...attention, localVersion: 0 }), null);
  render(); control('提交所選原項還原（2 項）').props.onPress(); await settle();
  assert.equal(commands.length, 1); assert.equal(commands[0].restoreOriginal, true);
  assert.deepEqual(commands[0].resolutions.map(row => [row.section, row.resourceId, row.resolution]), [
    ['growth_attention', attention.id, { mode: 'replace_current', targetId: attention.id, expectedVersion: 4 }],
    ['growth_topics', topic.id, { mode: 'replace_current', targetId: topic.id, expectedVersion: 4 }],
  ]);
  await controller.openUpload(uploadId); await controller.compareOriginal(childId, 'growth'); controller.selectReadComparison('replace_current', true);
  const observed = controller.getSnapshot().comparison;
  supported = false; await controller.readImportCapabilities(); assert.equal(controller.getSnapshot().comparison, null);
  await controller.restoreComparison(observed); assert.equal(commands.length, 1);
  supported = true; await controller.readImportCapabilities();
  responseRows = [{ ...attention, targetId: randomUUID() }]; await controller.compareOriginal(childId, 'growth');
  assert.ok(controller.getSnapshot().comparison.error, 'A mismatched original target ID rejects the comparison');
  responseRows = [attention, topic]; hold = true; const late = controller.compareOriginal(childId, 'growth');
  controller.clearComparison(); held(); await late; assert.equal(controller.getSnapshot().comparison, null);
});
