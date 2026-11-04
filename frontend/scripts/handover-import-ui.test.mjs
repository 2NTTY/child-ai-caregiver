import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as ownerHelpers from '../src/production/HandoverImportOwner.ts';
import { originalBackupModuleSchema } from '../../src/shared/handover-imports.ts';

// Actual shared components with synthetic account data; no browser, native picker or network.
let current, production;
const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
const hooks = { useState(initial) { const instance = current, index = instance.cursor++;
  if (!(index in instance.slots)) instance.slots[index] = initial;
  return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
  useEffect: noop, useLayoutEffect: noop, useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, get) => get() };
function load(name) {
  const module = { exports: {} }, source = readFileSync(new URL(`../src/components/account/${name}.tsx`, import.meta.url), 'utf8');
  const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' }
    : name.endsWith('/HandoverImportOwner') ? ownerHelpers : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/handover-imports') ? { originalBackupModuleSchema }
    : name.endsWith('/useProductionSharing') ? { useProductionSharing: () => ({ controller: {}, state: { identityKey: null, selected: null, shares: { items: [] }, spaces: { items: [] }, teacherClasses: { items: [] }, rosterQuery: '' } }) }
    : name.endsWith('/handover-class-targets') ? { handoverClassScope: () => null, handoverClassDestinations: () => [], handoverClassEnrolmentDestination: () => null }
    : name.endsWith('/package-import') ? { PACKAGE_IMPORT_MAX_BYTES: 268435456, pickImportPackage: async () => null }
    : name === './HandoverImportHistory' ? load('HandoverImportHistory') : name === './HandoverImportResults' ? load('HandoverImportResults')
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} }
    : new Proxy({}, { get: (_value, key) => String(key) });
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(require, module, module.exports);
  return module.exports;
}
function render(component, props, instance = { slots: [] }) { current = instance; Object.assign(instance, { component, props, cursor: 0 }); instance.tree = component(props); return instance; }
const again = view => render(view.component, view.props, view);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const control = (tree, label) => nodes(tree).find(node => node.props?.label === label);

test('growth import selector submits personal growth and removes it from family and class targets', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const state = { identityKey: 'owner:1', userId: 'owner', busy: null, pending: null, items: [], uploads: [],
    upload: { id: id(10), state: 'ready', filename: 'growth.zip', bytes: 3, preview: { integrity: 'trusted', manifestSha256: 'a'.repeat(64),
      header: { selection: { modules: ['care', 'growth'] }, source: { serverId: 'source' } },
      children: [{ id: id(2), displayName: 'Source child' }], coverage: [{ childId: id(2), section: 'growth_attention', items: 1 }] } } };
  const sent = [], controller = { clearComparison: noop, subscribe: noop, getSnapshot: () => state, create: async (...value) => sent.push(value) };
  const shared = { identityKey: 'owner:1', userId: 'owner', phase: 'ready', target: { spaceId: id(4), childId: id(5) },
    view: { spaceId: id(4), childId: id(5), childName: 'Shared child', spaceName: 'Family', role: 'caregiver', modules: ['care', 'growth'] } };
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => shared } },
    identityKey: 'owner:1', userId: 'owner', online: true, account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } },
    recordsState: { children: [{ id: id(3), displayName: 'Own child', accessRole: 'owner' }, { id: id(6), displayName: 'Class child', accessRole: 'teacher' }] } };
  const view = render(load('HandoverImportControls').HandoverImportControls);
  control(view.tree, '查看上載與匯入選擇').props.onPress(); again(view);
  control(view.tree, 'Source child').props.onChange(true); again(view);
  const destination = () => nodes(view.tree).find(node => node.type === 'AppSelect' && node.props.label.startsWith('接收「'));
  assert.equal(destination().props.options.some(option => option.value === `private:${id(6)}`), false);
  destination().props.onChange(`private:${id(3)}`); again(view);
  const growth = control(view.tree, '成長整理'); assert.ok(growth, 'personal growth must be selectable');
  assert.equal(growth.props.checked, true); assert.equal(growth.props.disabled, false);
  control(view.tree, '開始匯入').props.onPress(); await Promise.resolve();
  assert.deepEqual(sent[0][0], [{ sourceChildId: id(2), target: { childId: id(3), spaceId: null }, sections: ['care', 'growth'] }]);
  for (const spaceName of ['Family', 'Class']) {
    shared.view.spaceName = spaceName;
    destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
    assert.equal(control(view.tree, '成長整理').props.checked, false);
    assert.equal(control(view.tree, '成長整理').props.disabled, true);
    assert.match(text(view.tree), /成長整理只可匯入本人孩子/);
    control(view.tree, '開始匯入').props.onPress(); await Promise.resolve();
    assert.deepEqual(sent.at(-1)[0][0].sections, ['care']);
  }
});

test('growth source history opens the existing owner and reads nested attention and topic settings literally', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const at = '2026-11-04T01:02:03Z', target = { childId: id(3), spaceId: null };
  const batch = { id: id(1), state: 'completed', targets: [{ sourceChildId: id(2), target, sections: ['growth'] }] };
  const rows = ['growth_attention', 'growth_topics'].map((resourceSection, n) => ({ id: id(10 + n), batchId: batch.id, sourceChildId: id(2),
    module: 'growth', resourceSection, sourceResourceId: id(20 + n), sourceVersion: 2, sourceSection: null, outcome: 'created', reason: null,
    recordedResource: { id: id(30 + n), version: 1 }, currentResource: null, availableResolution: null, at }));
  const values = [{ item: { topicId: 'solid_food', title: '<b>Original growth</b>', state: 'accepted', kind: 'consult', whyNow: 'Original reason',
    advice: '<script>Original advice</script>', limits: 'Original limits', note: 'Original result', lastAction: 'accept', actorUserId: 'foreign-author',
    createdAt: at, updatedAt: at, taskId: id(50), taskState: 'completed', sourceAvailable: true,
    evidence: { profileVersion: 8, facts: [{ id: id(51), version: 4 }] },
    source: { title: 'Original official source', url: 'https://source.test/guide', excerpt: 'Original source excerpt', checkedAt: at } } },
    { topicId: 'solid_food', disabled: true, actor: 'foreign-topic-author', at }];
  const histories = rows.map((row, n) => ({ format: 'yuyoufang-source-revision:1', childId: target.childId, resource: row.recordedResource,
    evidence: { module: row.resourceSection, value: values[n], source: { current: { source: { section: row.resourceSection,
      serverId: 'https://source.test', accountId: 'foreign-account', childId: id(2), resourceId: row.sourceResourceId, resourceVersion: 2 } }, previous: [] } } }));
  const calls = [], api = { setIdentity: noop, listImports: async () => ({ items: [batch], nextCursor: null }),
    importResults: async () => ({ batchId: batch.id, sourceChildId: id(2), module: 'growth', items: rows, nextCursor: null }),
    sourceHistory: async (user, query) => { calls.push([user, query]); return { items: [histories[query.module === 'growth_attention' ? 0 : 1]], nextCursor: null, complete: true }; } };
  const controller = new ownerHelpers.HandoverImportOwner(api);
  controller.syncContext('owner', 'owner:1', true); await controller.load(); controller.selectResults(batch.id, id(2), 'growth'); await controller.readResults();
  const resultView = render(load('HandoverImportResults').HandoverImportResults, { controller, batch, results: controller.getSnapshot().results, identityKey: 'owner:1', locked: false });
  const buttons = nodes(resultView.tree).filter(node => node.props?.label === '查看來源歷史'); assert.equal(buttons.length, 2);
  for (const [n, row] of rows.entries()) {
    assert.equal(ownerHelpers.canReadHandoverSourceHistory(row), true);
    buttons[n].props.onPress(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls.at(-1), ['owner', { ...target, module: row.resourceSection, resourceId: row.recordedResource.id }]);
    const view = render(load('HandoverImportHistory').HandoverImportHistory, { controller, history: controller.getSnapshot().sourceHistory, locked: false });
    for (const expected of n === 0 ? ['成長事項來源歷史', '<b>Original growth</b>', '<script>Original advice</script>', 'Original reason', 'Original limits',
      'Original result', '已接受', 'foreign-author', at, 'Original official source', 'https://source.test/guide', 'Original source excerpt', id(50), id(51), '已完成']
      : ['成長主題設定來源歷史', '已停用', 'foreign-topic-author', at]) assert.ok(text(view.tree).includes(expected), expected);
    assert.match(text(view.tree), /不代表本地.*確認/);
    assert.equal(nodes(view.tree).some(node => node.props?.href || node.props?.dangerouslySetInnerHTML || node.type === 'Markdown' || node.type === 'AppCheckbox'), false);
    assert.deepEqual(nodes(view.tree).filter(node => node.type === 'AppButton').map(node => node.props.label), ['重新讀取來源歷史', '關閉來源歷史']);
  }
  controller.closeSourceHistory(); batch.targets[0].target = { ...target, spaceId: id(4) };
  await controller.openSourceHistory(rows[0].id); assert.equal(calls.length, 2, 'growth history rejects a shared or class scope');
});

test('concern import selector keeps concerns on private targets and removes them from shared submissions', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const state = { identityKey: 'owner:1', userId: 'owner', busy: null, pending: null, items: [], loaded: true, uploads: [], uploadsLoaded: true,
    upload: { id: id(10), state: 'ready', filename: 'concerns.zip', bytes: 3, expiresAt: '2026-11-01T00:00:00Z', preview: {
      integrity: 'trusted', manifestSha256: 'a'.repeat(64), header: { selection: { modules: ['care', 'concerns'] }, source: { serverId: 'source' } },
      children: [{ id: id(2), displayName: 'Source child' }], coverage: [{ childId: id(2), section: 'concerns', items: 1 }] } } };
  const sent = [], controller = { clearComparison: noop, subscribe: noop, getSnapshot: () => state, create: async (...value) => sent.push(value) };
  const shared = { identityKey: 'owner:1', userId: 'owner', phase: 'ready', target: { spaceId: id(4), childId: id(5) },
    view: { spaceId: id(4), childId: id(5), childName: 'Shared child', spaceName: 'Family', role: 'caregiver', modules: ['care', 'concerns'] } };
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => shared } },
    identityKey: 'owner:1', userId: 'owner', online: true, account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } },
    recordsState: { children: [{ id: id(3), displayName: 'Own child', accessRole: 'owner' }] } };
  const view = render(load('HandoverImportControls').HandoverImportControls);
  control(view.tree, '查看上載與匯入選擇').props.onPress(); again(view);
  control(view.tree, 'Source child').props.onChange(true); again(view);
  const destination = () => nodes(view.tree).find(node => node.type === 'AppSelect' && node.props.label.startsWith('接收「'));
  destination().props.onChange(`private:${id(3)}`); again(view);
  const concern = control(view.tree, '持續關注'); assert.ok(concern, 'concerns must be offered by the existing private selector');
  assert.equal(concern.props.checked, true); assert.equal(concern.props.disabled, false);
  control(view.tree, '開始匯入').props.onPress(); await Promise.resolve();
  assert.deepEqual(sent[0][0][0].target, { childId: id(3), spaceId: null });
  assert.deepEqual([...sent[0][0][0].sections].sort(), ['care', 'concerns']);
  destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  const unavailable = control(view.tree, '持續關注');
  assert.ok(!unavailable || unavailable.props.disabled && !unavailable.props.checked, 'shared destinations cannot retain an actionable concern selection');
  control(view.tree, '開始匯入').props.onPress(); await Promise.resolve();
  assert.deepEqual(sent[1][0], [{ sourceChildId: id(2), target: { childId: id(5), spaceId: id(4) }, sections: ['care'] }]);
});

test('concern source history distinguishes head and event evidence and keeps original actions literal and read only', () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const calls = [], controller = { openSourceHistory: value => calls.push(['open', value]), closeSourceHistory: () => calls.push(['close']),
    readSourceHistory: more => calls.push(['more', more]), selectResults: noop, readResults: noop, closeResults: noop };
  const result = { id: id(10), batchId: id(1), sourceChildId: id(2), module: 'concerns', sourceResourceId: id(20), sourceVersion: 2,
    sourceSection: null, outcome: 'created', reason: null, recordedResource: { id: id(30), version: 1 }, currentResource: null, availableResolution: null,
    at: '2026-10-30T00:00:00Z' };
  assert.equal(ownerHelpers.handoverResultResourceSection(result), 'concerns', 'legacy module fallback remains bound to the concern resource');
  assert.equal(ownerHelpers.canReadHandoverSourceHistory(result), true);
  const batch = { id: id(1), state: 'completed', targets: [{ sourceChildId: id(2), target: { childId: id(3), spaceId: null }, sections: ['concerns'] }] };
  const results = { batchId: batch.id, sourceChildId: id(2), module: 'concerns', revision: 1, items: [result], loaded: true, nextCursor: null, error: null };
  const resultView = render(load('HandoverImportResults').HandoverImportResults, { controller, batch, results, identityKey: 'owner:1', locked: false });
  control(resultView.tree, '查看來源歷史').props.onPress(); assert.deepEqual(calls.pop(), ['open', result.id]);
  const evidence = (section, value) => ({ format: 'yuyoufang-source-revision:1', childId: id(3), resource: result.recordedResource,
    evidence: { module: 'concerns', value, source: { current: { source: { section, serverId: 'https://source.test', accountId: 'foreign-account',
      childId: id(2), resourceId: id(20), resourceVersion: 2 } }, previous: [] } } });
  const head = evidence('concerns', { id: id(20), title: '<b>Original concern title</b>', reason: 'Original concern reason', status: 'closed' });
  const event = evidence('concern_events', { id: id(20), kind: 'confirmed_action', title: 'Original source action', text: '<script>literal source action</script>',
    actorUserId: 'foreign-author', at: '2026-10-30T01:02:03Z' });
  assert.notEqual(ownerHelpers.handoverSourceHistoryKey(head), ownerHelpers.handoverSourceHistoryKey(event), 'source section separates identical source IDs and versions');
  const history = { resultId: result.id, query: { module: 'concerns' }, page: 1, complete: false, loaded: true, loading: false, nextCursor: 'next', items: [head, event] };
  const view = render(load('HandoverImportHistory').HandoverImportHistory, { controller, history, locked: false });
  for (const value of ['<b>Original concern title</b>', 'Original concern reason', 'Original source action', '<script>literal source action</script>', 'foreign-author', '2026-10-30T01:02:03Z'])
    assert.ok(text(view.tree).includes(value), value);
  assert.match(text(view.tree), /已結束|已關閉/); assert.match(text(view.tree), /已確認行動|確認動作/); assert.match(text(view.tree), /不代表本地.*確認/);
  const entries = nodes(view.tree).filter(node => node.type === 'View' && node.key !== undefined);
  assert.equal(entries.length, 2); assert.equal(new Set(entries.map(node => node.key)).size, 2);
  assert.equal(nodes(view.tree).some(node => node.props?.href || node.props?.dangerouslySetInnerHTML || node.type === 'Markdown' || node.type === 'AppCheckbox'), false);
  control(view.tree, '載入更多來源歷史').props.onPress(); assert.deepEqual(calls.pop(), ['more', true]);
  control(view.tree, '關閉來源歷史').props.onPress(); assert.deepEqual(calls.pop(), ['close']);
});

test('shared attachment import selector submits authorized targets and renders supplements without history actions', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const state = { identityKey: 'owner:1', userId: 'owner', busy: null, pending: null, items: [], loaded: true, uploads: [], uploadsLoaded: true,
    upload: { id: id(10), state: 'ready', filename: 'attachments.zip', bytes: 3, expiresAt: '2026-11-01T00:00:00Z', preview: {
      integrity: 'trusted', manifestSha256: 'a'.repeat(64), header: { selection: { modules: ['attachments'] }, source: { serverId: 'source' } },
      children: [{ id: id(2), displayName: 'Source child' }], coverage: [{ childId: id(2), section: 'voices', items: 1 }] } } };
  const sent = [], controller = { clearComparison: noop, subscribe: noop, getSnapshot: () => state, create: async (...value) => sent.push(value) };
  const shared = { identityKey: 'owner:1', userId: 'owner', phase: 'ready', target: { spaceId: id(4), childId: id(5) },
    view: { spaceId: id(4), childId: id(5), childName: 'Shared child', spaceName: 'Family', role: 'caregiver', modules: ['attachments'] } };
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => shared } },
    identityKey: 'owner:1', userId: 'owner', online: true, account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } },
    recordsState: { children: [{ id: id(3), displayName: 'Own child', accessRole: 'owner' }] } };
  const view = render(load('HandoverImportControls').HandoverImportControls);
  control(view.tree, '查看上載與匯入選擇').props.onPress(); again(view);
  assert.equal(control(view.tree, 'Source child').props.disabled, false);
  control(view.tree, 'Source child').props.onChange(true); again(view);
  const destination = () => nodes(view.tree).find(node => node.type === 'AppSelect' && node.props.label.startsWith('接收「'));
  destination().props.onChange(`private:${id(3)}`); again(view);
  assert.equal(control(view.tree, '附件').props.checked, true);
  destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  assert.equal(control(view.tree, '開始匯入').props.disabled, false);
  control(view.tree, '開始匯入').props.onPress(); await Promise.resolve();
  assert.deepEqual(sent[0], [[{ sourceChildId: id(2), target: { childId: id(5), spaceId: id(4) }, sections: ['attachments'] }], false]);
  shared.view.role = 'viewer'; again(view); assert.equal(control(view.tree, '開始匯入').props.disabled, true);
  const rows = ['files','voices','photos','child_avatar'].map((resourceSection,n) => ({ id: id(20+n), batchId: id(1), sourceChildId: id(2),
    module: 'attachments', resourceSection, sourceSection: n === 1 ? 'voice_transcripts' : null, sourceResourceId: id(30+n), sourceVersion: 2,
    outcome: n === 1 ? 'skipped' : 'created', reason: n === 1 ? 'attachment_supplement_already_imported' : null,
    recordedResource: { id: id(40+n), version: 1 }, currentResource: null, availableResolution: null, at: '2026-10-30T00:00:00Z' }));
  const result = render(load('HandoverImportResults').HandoverImportResults, { controller, identityKey: 'owner:1', locked: false,
    batch: { id: id(1), state: 'completed', targets: [{ sourceChildId: id(2), target: { childId: id(5), spaceId: id(4) }, sections: ['attachments'] }] },
    results: { batchId: id(1), sourceChildId: id(2), module: 'attachments', items: rows, loaded: true, nextCursor: null, error: null } });
  for (const label of ['檔案','語音轉錄文字','照片','孩子頭像','這份附件補充資料已保存。']) assert.ok(text(result.tree).includes(label),label);
  assert.equal(nodes(result.tree).some(node => node.props?.label === '查看來源歷史'),false);
});

test('shared import components label resources, read literal source histories and retain private target limits', () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const calls = [], controller = { openSourceHistory: value => calls.push(['open', value]), closeSourceHistory: () => calls.push(['close']),
    readSourceHistory: more => calls.push(['more', more]), resolveResults: (mode, ids) => calls.push(['resolve', mode, ids]), selectResults: noop, readResults: noop, closeResults: noop,
    openDocumentContent: key => calls.push(['document', key]), readDocumentContent: () => calls.push(['document-more']), closeDocumentContent: () => calls.push(['document-close']) };
  const rows = ['memory_facts', 'memory_topics', 'instructions', 'summary_history'].map((resourceSection, n) => ({ id: id(n + 10), batchId: id(1), sourceChildId: id(2),
    module: 'memory', resourceSection, sourceResourceId: id(n + 20), sourceVersion: 1, sourceSection: null, outcome: 'created', reason: null,
    recordedResource: { id: id(n + 30), version: 1 }, currentResource: null, availableResolution: null, at: '2026-10-30T00:00:00Z' }));
  Object.assign(rows[3], { outcome: 'conflict', reason: 'target_deleted', currentResource: { id: id(33), version: 0, deleted: true }, availableResolution: 'restore_deleted' });
  const batch = { id: id(1), state: 'completed', targets: [{ sourceChildId: id(2), target: { childId: id(3), spaceId: null }, sections: ['memory'] }] };
  const results = { batchId: batch.id, sourceChildId: id(2), module: 'memory', revision: 1, items: rows, loaded: true, nextCursor: null, error: null };
  const { HandoverImportResults } = load('HandoverImportResults');
  const resultView = render(HandoverImportResults, { controller, batch, results, identityKey: 'owner:1', locked: false });
  for (const label of ['記憶事實', '記憶話題', '私人交代', '摘要歷史']) assert.ok(text(resultView.tree).includes(label), label);
  const historyButtons = nodes(resultView.tree).filter(node => node.props?.label === '查看來源歷史'); assert.equal(historyButtons.length, 3);
  historyButtons[0].props.onPress(); assert.deepEqual(calls.pop(), ['open', rows[0].id]);
  control(resultView.tree, '選取此已刪項目作明確恢復').props.onChange(true); again(resultView);
  control(resultView.tree, '恢復所選已刪項目（1 項）').props.onPress(); assert.deepEqual(calls.pop(), ['resolve', 'restore_deleted', [rows[3].id]]);
  const sourceRows = ['input_processing', 'input_linked', 'inputs_capacity', 'input_source_unavailable'].map((reason, n) => ({ ...rows[0], id: id(60 + n), module: 'sources', resourceSection: 'private_sources',
    sourceSection: n === 1 ? 'private_source_history' : null, outcome: 'conflict', reason }));
  const sourceView = render(HandoverImportResults, { controller, batch: { ...batch, targets: [{ ...batch.targets[0], sections: ['sources'] }] },
    results: { ...results, module: 'sources', items: sourceRows }, identityKey: 'owner:1', locked: false });
  for (const label of ['私人來源', '私人來源管理歷史', '抓取或提取尚未結清', '已連結照護記錄', '接收對象的私人來源容量已滿', '原官方來源已無法核對，已保留目前資料。']) assert.ok(text(sourceView.tree).includes(label), label);
  control(sourceView.tree, '查看來源歷史').props.onPress(); assert.deepEqual(calls.pop(), ['open', sourceRows[0].id]);
  const documentRows = ['documents', 'visit_preparation'].map((resourceSection, i) => ({ ...rows[0], id: id(70 + i), module: 'documents', resourceSection }));
  const documentsView = render(HandoverImportResults, { controller, batch: { ...batch, targets: [{ ...batch.targets[0], sections: ['documents'] }] },
    results: { ...results, module: 'documents', items: documentRows }, identityKey: 'owner:1', locked: false });
  assert.equal(nodes(documentsView.tree).filter(node => node.props?.label === '查看來源歷史').length, 2);
  const { HandoverImportHistory } = load('HandoverImportHistory');
  for (const [module, value, expected] of [['memory_facts', { key: 'Original key', content: 'Original fact' }, 'Original fact'],
    ['memory_topics', { title: 'Original title', note: 'Original topic note' }, 'Original topic note'],
    ['summary_history', { text: '<img src=x onerror=alert(1)>', coveredMessageIds: ['foreign-message'], lastCoveredMessageId: 'foreign-message' }, '<img src=x onerror=alert(1)>'],
    ['private_sources', { version: 4, previousVersion: 3, reason: 'Original management reason', changedAt: '2026-10-30T00:00:00Z',
      management: { intention: 'Original intention', purpose: 'answer_reference', enabled: true, modelExcerpt: '<b>Original excerpt</b>' } }, '<b>Original excerpt</b>'],
    ['visit_preparation', { questions: ['Original question'], checklist: [{ text: 'Original checklist', done: true }], reviewed: true,
      reviewedBasis: 'foreign-basis', appointmentTaskId: id(80), updatedAt: '2026-10-30T00:00:00Z', updatedBy: 'foreign-author' }, 'Original question'],
    ['documents', { documentId: id(30), snapshotId: id(81), snapshotVersion: 1, generatedAt: '2026-10-30T00:00:00Z', invalidated: false }, id(81)]]) {
    const history = { resultId: rows[0].id, query: { module }, page: 1, complete: false, loaded: true, loading: false, nextCursor: 'next',
      items: [{ resource: { id: id(30), version: 1 }, evidence: { module, value, source: { current: { source: {
        serverId: 'https://source.test', accountId: 'foreign-account', childId: id(2), resourceId: id(20), resourceVersion: 2 } }, previous: [] } } }] };
    const view = render(HandoverImportHistory, { controller, history, locked: false });
    assert.ok(text(view.tree).includes(expected)); assert.ok(text(view.tree).includes('foreign-account')); assert.ok(text(view.tree).includes('來源版本'));
    assert.equal(nodes(view.tree).some(node => node.props?.href || node.props?.dangerouslySetInnerHTML || node.type === 'Markdown'), false);
    if (module === 'summary_history') assert.match(text(view.tree), /外來摘要歷史/);
    if (module === 'private_sources') {
      for (const label of ['管理歷史，不是正文修訂', '原摘錄不代表本地授權', 'Original intention', '回答參考', '已啟用', 'Original management reason', '2026-10-30T00:00:00Z']) assert.ok(text(view.tree).includes(label), label);
      assert.match(text(view.tree), /3\s+→\s+4/);
    }
    if (module === 'visit_preparation') {
      for (const label of ['Original checklist', '原核對狀態', 'foreign-author', '不代表本地已核對']) assert.ok(text(view.tree).includes(label), label);
      assert.equal(nodes(view.tree).some(node => node.type === 'AppCheckbox'), false);
    }
    if (module === 'documents') {
      const key = ownerHelpers.handoverSourceHistoryKey(history.items[0]);
      control(view.tree, '閱讀原文件正文').props.onPress(); assert.deepEqual(calls.pop(), ['document', key]);
      history.documentContent = { key, documentId: id(30), snapshotId: id(81), snapshotVersion: 1, documentVersion: 12, authorityVersion: 'current', text: 'PARTIAL_JSON_MUST_NOT_RENDER',
        totalCharacters: 8000, nextOffset: 4000, loading: false, complete: false, invalidated: false, snapshot: null, error: null };
      again(view); assert.equal(text(view.tree).includes('PARTIAL_JSON_MUST_NOT_RENDER'), false);
      control(view.tree, '繼續讀取原文件正文').props.onPress(); assert.deepEqual(calls.pop(), ['document-more']);
      history.documentContent = { ...history.documentContent, text: '', nextOffset: null, complete: true,
        snapshot: { title: 'Original document title', summary: '<b>Plain original summary</b>', ageLabel: '', period: { from: '2026-10-01', to: '2026-10-31' },
          coverageNote: 'Original coverage', changes: [], sources: [{ id: 'external', label: 'Foreign source', text: 'Foreign text' }],
          sections: [{ id: 's', title: 'Original section', items: [{ id: 'i', text: '<script>literal original item</script>', checked: true }] }] } };
      again(view); for (const label of ['Original document title', '<b>Plain original summary</b>', '<script>literal original item</script>']) assert.ok(text(view.tree).includes(label), label);
      assert.equal(nodes(view.tree).some(node => node.props?.href || node.props?.dangerouslySetInnerHTML || node.type === 'Markdown'), false);
      control(view.tree, '關閉原文件正文').props.onPress(); assert.deepEqual(calls.pop(), ['document-close']);
      history.documentContent = null; value.invalidated = true; again(view);
      assert.equal(control(view.tree, '閱讀原文件正文'), undefined); assert.match(text(view.tree), /此來源修訂已失效/);
    }
    control(view.tree, '載入更多來源歷史').props.onPress(); assert.deepEqual(calls.pop(), ['more', true]);
  }
  const state = { identityKey: 'owner:1', userId: 'owner', busy: null, pending: null, items: [], loaded: true, uploads: [], uploadsLoaded: true,
    upload: { id: id(50), state: 'ready', filename: 'memory.zip', bytes: 3, expiresAt: '2026-11-01T00:00:00Z', preview: { manifestSha256: 'a'.repeat(64),
      header: { selection: { modules: ['memory'] }, source: { serverId: 'https://source.test' } }, children: [{ id: id(2), displayName: 'Source child' }],
      coverage: [{ childId: id(2), section: 'instructions', items: 1 }] } } };
  Object.assign(controller, { clearComparison: noop, subscribe: noop, getSnapshot: () => state });
  production = { owner: { handoverImportOwner: controller, sharedChild: { subscribe: noop, getSnapshot: () => ({ identityKey: 'owner:1', userId: 'owner', phase: 'ready',
    target: { spaceId: id(4), childId: id(5) }, view: { spaceId: id(4), childId: id(5), childName: 'Shared child', spaceName: 'Family', role: 'caregiver', modules: ['memory', 'documents'] } }) } },
    identityKey: 'owner:1', userId: 'owner', online: true, account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } },
    recordsState: { children: [{ id: id(3), displayName: 'Own child', accessRole: 'owner' }] } };
  const { HandoverImportControls } = load('HandoverImportControls'); const view = render(HandoverImportControls);
  control(view.tree, '查看上載與匯入選擇').props.onPress(); again(view);
  const child = control(view.tree, 'Source child'); assert.equal(child.props.disabled, false); child.props.onChange(true); again(view);
  const destination = () => nodes(view.tree).find(node => node.type === 'AppSelect' && node.props.label.startsWith('接收「'));
  destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  assert.equal(control(view.tree, '記憶與摘要').props.disabled, true); assert.equal(control(view.tree, '開始匯入').props.disabled, true);
  assert.match(text(view.tree), /私人交代或摘要歷史/);
  state.upload.preview.coverage[0].items = 0; destination().props.onChange(`private:${id(3)}`); again(view);
  control(view.tree, '記憶與摘要').props.onChange(true); again(view); destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  assert.equal(control(view.tree, '記憶與摘要').props.disabled, false); assert.equal(control(view.tree, '記憶與摘要').props.checked, true);
  state.upload.preview.header.selection.modules = ['sources']; state.upload.preview.integrity = 'trusted';
  state.upload.preview.coverage = [{ childId: id(2), section: 'private_sources', items: 1 }, { childId: id(2), section: 'private_source_history', items: 1 }];
  again(view); control(view.tree, 'Source child').props.onChange(true); again(view);
  destination().props.onChange(`private:${id(3)}`); again(view);
  assert.equal(control(view.tree, '私人來源').props.disabled, false); assert.equal(control(view.tree, '私人來源').props.checked, true);
  assert.equal(control(view.tree, '開始匯入').props.disabled, false);
  destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  assert.equal(control(view.tree, '私人來源').props.disabled, true); assert.equal(control(view.tree, '私人來源').props.checked, false);
  assert.equal(control(view.tree, '開始匯入').props.disabled, true); assert.match(text(view.tree), /私人來源只可匯入本人孩子/);
  state.upload.preview.header.selection.modules = ['documents']; state.upload.preview.coverage = [{ childId: id(2), section: 'documents', items: 1 }];
  again(view); control(view.tree, 'Source child').props.onChange(true); again(view); destination().props.onChange(`shared:${id(4)}:${id(5)}`); again(view);
  assert.equal(control(view.tree, '文件與準備單').props.checked, true); assert.equal(control(view.tree, '開始匯入').props.disabled, false);
});

test('backup comparison and committed module summary are explicit read-only controls in the shared import panel',async()=>{
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const batch={id:id(1),state:'completed',targets:[],counts:{created:99,updated:0,skipped:0,conflict:0},processedItems:4,totalItems:4,updatedAt:'2026-11-05T00:00:00Z'};
  const state={identityKey:'owner:1',userId:'owner',busy:null,pending:null,items:[batch],uploads:[],
    upload:{id:id(2),version:3,state:'ready',filename:'backup.zip',bytes:3,expiresAt:'2026-11-06T00:00:00Z',preview:{integrity:'missing_proof',manifestSha256:'a'.repeat(64),
      header:{purpose:'backup',source:{accountId:'owner',serverId:'source'},selection:{modules:['care','tasks'],childIds:[id(3)]}},children:[{id:id(3),displayName:'Original child'}],coverage:[]}},
    summary:{batchId:batch.id,status:'ready',value:{modules:[{module:'care',created:2,updated:0,skipped:1,conflict:0}]}},comparison:null};
  const calls=[],controller={subscribe:noop,getSnapshot:()=>state,readSummary:async batchId=>calls.push(['summary',batchId]),
    compareOriginal:async(...args)=>calls.push(['compare',...args]),clearComparison:()=>{state.comparison=null;calls.push(['clear']);}};
  production={owner:{handoverImportOwner:controller,sharedChild:{subscribe:noop,getSnapshot:()=>({})}},identityKey:'owner:1',userId:'owner',online:true,
    account:{gate:'ready',busy:null,deletion:{phase:'idle'}},recordsState:{children:[{id:id(3),displayName:'Original child',accessRole:'owner'},{id:id(4),displayName:'Other child',accessRole:'owner'}]}};
  const view=render(load('HandoverImportControls').HandoverImportControls);
  control(view.tree,'查看分模組結果').props.onPress();assert.deepEqual(calls.at(-1),['summary',batch.id]);
  assert.match(text(view.tree),/照護記錄.*建立\s+2.*略過\s+1/);
  control(view.tree,'查看上載與匯入選擇').props.onPress();again(view);
  assert.equal(calls.some(call=>call[0]==='compare'),false);
  control(view.tree,'Original child').props.onChange(true);again(view);
  nodes(view.tree).find(node=>node.type==='AppSelect'&&node.props.label.startsWith('接收「')).props.onChange(`private:${id(3)}`);again(view);
  control(view.tree,'待辦').props.onChange(false);again(view);
  const child=control(view.tree,'比較原有資料的孩子'),module=control(view.tree,'比較資料類別');
  assert.deepEqual(child.props.options.filter(option=>option.value).map(option=>option.value),[id(3)]);
  child.props.onChange(id(3));again(view);control(view.tree,'比較資料類別').props.onChange('care');again(view);
  control(view.tree,'比較原有資料').props.onPress();assert.deepEqual(calls.at(-1),['compare',id(3),'care']);
  assert.equal(control(view.tree,'待辦').props.checked,false,'Comparison preserves manual copy-import choices');
  state.comparison={query:{uploadId:id(2),childId:id(3),module:'care'},items:[{id:id(8),state:'deleted',backupVersion:1,localVersion:2,changedFields:['text']}],loaded:true,nextCursor:'next',error:null};again(view);
  assert.match(text(view.tree),/目前已刪除/);assert.match(text(view.tree),/沒有還原或改寫/);
  control(view.tree,'下一頁比較結果').props.onPress();assert.deepEqual(calls.at(-1),['compare',id(3),'care',true]);
  assert.equal(nodes(view.tree).some(node=>node.props?.label==='恢復原有資料'),false);
  control(view.tree,'比較資料類別').props.onChange('tasks');again(view);assert.equal(state.comparison,null);
  for(const [status,modules,expected] of [['ready',null,/舊批次未有分模組統計/],['unauthorized',null,/沒有權限查閱/],['unavailable',null,/未能查閱/]]){
    state.summary={batchId:batch.id,status,value:status==='ready'?{modules}:null};again(view);assert.match(text(view.tree),expected);
  }
});

test('original restore panel defaults to no selections and previews overwrite and deleted categories separately',()=>{
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const rows=[{id:id(3),targetId:id(13),state:'different',backupVersion:1,localVersion:2,changedFields:['text','details','future_private_key','__proto__']},
    {id:id(4),targetId:id(14),state:'deleted',backupVersion:1,localVersion:3,changedFields:[]},
    {id:id(5),state:'local_newer',backupVersion:1,localVersion:4,changedFields:[]}];
  const state={identityKey:'owner:1',userId:'owner',busy:null,pending:null,items:[],uploads:[],
    upload:{id:id(1),version:3,state:'ready',filename:'backup.zip',bytes:3,expiresAt:'2026-11-06T00:00:00Z',preview:{integrity:'trusted',manifestSha256:'a'.repeat(64),
      header:{purpose:'backup',source:{accountId:'owner',serverId:'source'},selection:{modules:['care'],childIds:[id(2)]}},children:[{id:id(2),displayName:'Original child'}],coverage:[]}},comparison:null};
  const calls=[],controller={subscribe:noop,getSnapshot:()=>state,clearComparison:()=>{state.comparison=null;},compareOriginal:async()=>{},
    selectComparison:(key,checked)=>{calls.push(['select',key,checked]);state.comparison.selected=checked?[...state.comparison.selected,key]:state.comparison.selected.filter(id=>id!==key);},
    selectReadComparison:(mode,checked)=>{calls.push(['all',mode,checked]);state.comparison.selected=rows.filter(row=>ownerHelpers.originalComparisonResolution(row)===mode).map(row=>row.id);},restoreComparison:()=>calls.push(['submit'])};
  production={owner:{handoverImportOwner:controller,sharedChild:{subscribe:noop,getSnapshot:()=>({})}},identityKey:'owner:1',userId:'owner',online:true,
    account:{gate:'ready',busy:null,deletion:{phase:'idle'}},recordsState:{children:[{id:id(2),displayName:'Original child',accessRole:'owner'}]}};
  const view=render(load('HandoverImportControls').HandoverImportControls);
  assert.deepEqual(control(view.tree,'比較資料類別').props.options.map(row=>row.value),originalBackupModuleSchema.options.filter(module=>module==='care'));
  assert.equal(load('HandoverImportControls').comparisonFields('sources',['sourceLabel','text','management','fetchState','extraction','recordId','unrecognized']),
    '來源名稱、來源原文、用途與摘錄設定、抓取狀態、提取狀態、已連結照護記錄、其他欄位');
  control(view.tree,'比較原有資料的孩子').props.onChange(id(2));again(view);
  state.comparison={query:{uploadId:id(1),childId:id(2),module:'care',includeRestoreTarget:true},items:rows,selected:[],loaded:true,nextCursor:'next',error:null};again(view);
  assert.equal(control(view.tree,'提交所選原項還原（0 項）').props.disabled,true);
  assert.equal(control(view.tree,'以備份覆蓋此項').props.checked,false);assert.equal(control(view.tree,'恢復此已刪項目').props.checked,false);
  assert.equal(nodes(view.tree).filter(node=>node.type==='AppCheckbox'&&node.props.label==='以備份覆蓋此項').length,1,'Missing target cannot be offered for restore');
  assert.match(text(view.tree),/尚未讀取的下一頁不包括/);
  assert.match(text(view.tree),/有變更的欄位：.*記錄內容、時間／數量、其他欄位/);assert.equal(text(view.tree).includes('future_private_key'),false);assert.equal(text(view.tree).includes('__proto__'),false);
  control(view.tree,'以備份覆蓋此項').props.onChange(true);again(view);
  control(view.tree,'恢復此已刪項目').props.onChange(true);again(view);
  assert.match(text(view.tree),/準備提交：覆蓋\s+1\s+項.*恢復已刪\s+1/);
  assert.match(text(view.tree),/原刪除紀錄保留/);
  assert.equal(control(view.tree,'提交所選原項還原（2 項）').props.disabled,false);
  control(view.tree,'提交所選原項還原（2 項）').props.onPress();assert.deepEqual(calls.at(-1),['submit']);
  control(view.tree,'選取已讀覆蓋項目（1 項）').props.onChange(true);assert.deepEqual(calls.at(-1),['all','replace_current',true]);
});
