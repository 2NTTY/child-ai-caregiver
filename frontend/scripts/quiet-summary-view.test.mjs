import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { summaryPeriodSchema } from '../src/components/summary/summary-form.ts';
import { summaryPeriodLabel, summaryTime } from '../src/summary-view-model.ts';

// Shallow production composition with synthetic input; no API, model or browser access.
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
const query = { startDay: '2026-10-07', period: 'day', timeZone: 'Asia/Hong_Kong' };
const page = { period: query, generatedAt: '2026-10-07T08:00:00Z', canManage: true };
function render(patch = {}) {
  let reads = 0;
  const owner = { model: { childName: 'Synthetic child', scopeKey: 'scope', page, query, online: true, busy: false, pending: null,
    access: 'editable', readFailed: false, dirty: false, notice: '', operation: 'none', ...patch }, actions: { refresh() { reads++; } } };
  const source = readFileSync(new URL('../src/production/TaskKnowledgeSummaryContent.tsx', import.meta.url), 'utf8');
  const module = { exports: {} };
  const imports = {
    react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View' }, 'react-native-paper': { Text: 'Text' },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => action() },
    './TaskKnowledgeDomains': { useProductionTaskKnowledgeSummary: () => owner },
    '../components/summary/summary-styles': { summaryStyles: {} },
    '../components/summary/summary-form': { summaryPeriodSchema },
    '../summary-view-model': { summaryPeriodLabel, summaryTime },
  };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => imports[name] ?? elements, module, module.exports);
  return { tree: module.exports.TaskKnowledgeSummaryContent({ onRecord() {}, onTask() {} }), reads: () => reads };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.action)];
const buttons = tree => nodes(tree).filter(node => node.type === 'AppButton');

test('ordinary summary refresh retains the report without loading text, while period application remains explicit', () => {
  for (const busy of [false, true]) {
    const view = render({ busy });
    assert.equal(buttons(view.tree).some(node => node.props.label === '重新讀取摘要'), false);
    assert.equal(nodes(view.tree).some(node => node.type === 'ReadStateNotice'), false);
    assert.equal(nodes(view.tree).filter(node => node.type === 'SummaryRecords')[0].props.page, page);
    const apply = buttons(view.tree).find(node => node.props.label === '套用期間');
    assert.equal(apply.props.disabled, busy);
    if (!busy) { apply.props.onPress(); assert.equal(view.reads(), 1); }
  }
});

test('summary first read delegates delayed loading and failed reads retain one real recovery action', () => {
  const loading = render({ busy: true, page: null });
  assert.equal(nodes(loading.tree).find(node => node.type === 'ReadStateNotice').props.state, 'loading');
  const failed = render({ readFailed: true, notice: '未能更新，請重試。' });
  const retry = buttons(failed.tree).filter(node => node.props.label === '重新讀取摘要');
  assert.equal(retry.length, 1); assert.equal(retry[0].props.disabled, false);
  retry[0].props.onPress(); assert.equal(failed.reads(), 1);
  assert.equal(nodes(failed.tree).filter(node => node.type === 'Text' && String(node.props.children).includes('未能')).length, 1);
  assert.equal(nodes(failed.tree).find(node => node.type === 'SummaryRecords').props.page, page);
});
