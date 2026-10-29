import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as ownerHelpers from '../src/production/HandoverImportOwner.ts';

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
  const sourceRows = ['input_processing', 'input_linked', 'inputs_capacity'].map((reason, n) => ({ ...rows[0], id: id(60 + n), module: 'sources', resourceSection: 'private_sources',
    sourceSection: n === 1 ? 'private_source_history' : null, outcome: 'conflict', reason }));
  const sourceView = render(HandoverImportResults, { controller, batch: { ...batch, targets: [{ ...batch.targets[0], sections: ['sources'] }] },
    results: { ...results, module: 'sources', items: sourceRows }, identityKey: 'owner:1', locked: false });
  for (const label of ['私人來源', '私人來源管理歷史', '抓取或提取尚未結清', '已連結照護記錄', '接收對象的私人來源容量已滿']) assert.ok(text(sourceView.tree).includes(label), label);
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
  Object.assign(controller, { subscribe: noop, getSnapshot: () => state });
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
