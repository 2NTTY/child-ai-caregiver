import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import * as values from '../src/care-view-model.ts';
import { createCareCaptureFixtures, createCareFixtures } from '../src/preview/care-fixture.ts';

const require = createRequire(import.meta.url), childId = 'preview-child-1';
const fixtures = () => values.projectCareCaptures(createCareCaptureFixtures(childId), createCareFixtures(childId), childId, 'scope');
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];
}
const component = (tree, type, label) => nodes(tree).find(node => node.type === type && (!label || node.props.label === label));
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
const byTestId = (tree, id) => nodes(tree).find(node => node.props?.testID === id);
function renderer(relative, name, width = 1024) {
  const slots = []; let cursor = 0, dirty = false, effects = [];
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useId() { return 'care-tabs'; },
    useLayoutEffect(fn, deps) { return react.useEffect(fn, deps); },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => !Object.is(value, old[index]))) effects.push(fn); slots[i] = deps; },
  };
  const dependencies = {
    'react': react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } }, 'react-native-paper': { Text: 'Text' },
    '../../care-view-model': values, '../../theme': { colors: {}, readingType: {}, workspaceType: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: {} },
    '../appearance/BackgroundSurface': { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false },
    '../useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
  };
  const filename = new URL(relative, import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename.pathname, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output + `\nmodule.exports.${name} = ${name};`)(key => dependencies[key] ?? new Proxy({}, { get: (_target, prop) => String(prop) }), module, module.exports);
  return props => {
    for (let count = 0; count < 10; count++) {
      cursor = 0; dirty = false; effects = [];
      const tree = module.exports[name](props); effects.forEach(fn => fn());
      if (!dirty) return tree;
    }
    throw new Error('Unstable component');
  };
}
function workspace(items = fixtures(), width = 1024, props = {}) {
  const calls = [], render = renderer('../src/components/care/CareReviewHistoryView.tsx', 'CareReviewWorkspace', width);
  const model = { scopeKey: 'scope', child: { id: childId }, access: 'editable', online: true, list: { state: 'ready', records: createCareFixtures(childId), activeQuery: '', activeKind: 'all', hasMore: false, hasPrevious: false, message: null }, operation: { state: 'none' }, draft: null, deletion: null,
    review: { state: 'ready', scopeKey: 'scope', items, hasMore: false, capabilities: { create: true, update: true, skip: true, confirmImportant: true } } };
  const actions = { openRecord: id => calls.push(['open', id]), search: (...args) => calls.push(['search', ...args]), loadMore: () => calls.push('next'), previousPage: () => calls.push('previous'), closePanel: () => { calls.push('close'); model.detail = null; }, confirmCapture: () => calls.push('confirm'), confirmImportantRecord: () => calls.push('important'), startCorrection: id => calls.push(id) };
  return { model, actions, calls, render: () => render({ model, actions, ...props }) };
}
const rows = tree => nodes(tree).filter(node => node.props?.testID === 'care-review-row');
const tabs = tree => component(tree, 'UnderlineTabs');
const chooseTab = (h, key) => { tabs(h.render()).props.onChange(key); return h.render(); };
const openFilters = h => { component(h.render(), 'AppButton', '篩選').props.onPress(); return h.render(); };

test('the main review tabs use one pending counter and ordinary saved content needs no confirmation', () => {
  const h = workspace(); let tree = h.render();
  assert.deepEqual(tabs(tree).props.items, [{ key: 'pending', label: '待確認', count: 2 }, { key: 'recorded', label: '已保存' }]);
  assert.equal(rows(tree).length, 2); assert.equal(component(tree, 'CareCaptureDetail'), undefined);
  assert.equal(component(tree, 'AppSelect'), undefined);
  assert.ok(rows(tree)[0].props.accessibilityLabel.includes('這筆記錄不代表機構已確認預約'));
  assert.ok(rows(tree)[1].props.accessibilityLabel.includes('原操作已過期'));
  assert.ok(nodes(tree).every(node => node.props?.accessibilityRole !== 'checkbox'));
  rows(tree)[0].props.onPress(); tree = h.render();
  assert.equal(component(tree, 'CareCaptureDetail').props.canConfirmImportant, true);
  assert.deepEqual(h.calls, ['close']);
  tree = chooseTab(h, 'recorded'); assert.equal(rows(tree).length, 0);
  assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: 2 });
  const saved = component(tree, 'CareSavedRecordsList');
  assert.equal(saved.props.model, h.model);
  for (const action of ['search', 'loadMore', 'previousPage', 'startCorrection']) assert.equal(saved.props.actions[action], h.actions[action]);
  assert.equal(component(tree, 'CareCaptureDetail'), undefined);
  assert.ok(!h.calls.includes('confirm') && !h.calls.includes('important'));
});

test('the saved tab and manual action share one responsive row without changing capture membership', () => {
  const items = fixtures(), before = structuredClone(items);
  for (const width of [320, 390, 1024, 1440]) {
    const action = { type: 'AppButton', props: { label: '手動新增' } };
    const h = workspace(items, width, { manualCreateAction: action });
    let tree = h.render();
    const bar = byTestId(tree, 'care-review-tabs-bar');
    assert.equal(flatten(bar.props.style).flexDirection, 'row');
    assert.equal(flatten(bar.props.style).flexWrap, undefined);
    assert.deepEqual(flatten(bar.props.children[0].props.style), { flex: 1, minWidth: 0 });
    assert.equal(bar.props.children[1].props.children, action);
    assert.equal(flatten(bar.props.children[1].props.style).flexShrink, 0);
    assert.deepEqual(tabs(tree).props.items, [{ key: 'pending', label: '待確認', count: 2 }, { key: 'recorded', label: '已保存' }]);
    assert.equal(rows(tree).length, 2);
    tree = chooseTab(h, 'recorded');
    assert.equal(tabs(tree).props.value, 'recorded');
    assert.equal(rows(tree).length, 0);
    assert.equal(component(tree, 'CareSavedRecordsList').props.model, h.model);
    assert.deepEqual(items, before);
    assert.deepEqual(h.calls, ['close']);
  }
});

test('zero or unavailable pending counts retain their read-state boundary', () => {
  const h = workspace([]); let tree = chooseTab(h, 'recorded');
  assert.ok(component(tree, 'CareSavedRecordsList'));
  assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: 0 });
  for (const state of ['loading', 'error', 'unavailable']) {
    h.model.review.state = state; tree = h.render();
    assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: undefined });
    assert.equal(tabs(tree).props.items[1].label, '已保存');
  }
});

test('the sole saved list keeps server search and cursor actions without duplicating detail or forms', () => {
  const h = workspace(), render = renderer('../src/components/care/CareSavedRecordsView.tsx', 'CareSavedRecordsBody');
  const draw = () => render({ model: h.model, actions: h.actions, inlineDetail: false });
  let tree = draw();
  assert.equal(nodes(tree).filter(node => node.type === 'Pressable').length, h.model.list.records.length);
  component(tree, 'AppTextField', '搜尋已保存記錄').props.onChangeText('合成搜尋');
  component(tree, 'AppSelect', '種類').props.onChange('sleep'); tree = draw();
  component(tree, 'AppButton', '搜尋').props.onPress();
  assert.deepEqual(h.calls, [['search', '合成搜尋', 'sleep']]);
  h.model.list.hasMore = true; h.model.list.hasPrevious = true; tree = draw();
  component(tree, 'AppButton', '下一頁').props.onPress();
  component(tree, 'AppButton', '上一頁').props.onPress();
  assert.deepEqual(h.calls.slice(1), ['next', 'previous']);
  h.model.detail = { record: h.model.list.records[0] }; tree = draw();
  assert.equal(component(tree, 'CareRecordDetail'), undefined);
  assert.equal(component(tree, 'FormDialog'), undefined);
  assert.equal(component(tree, 'AppTextField', '搜尋已保存記錄').props.value, '合成搜尋');
  for (const state of ['unknown', 'saving', 'draft', 'deletion']) {
    h.model.operation.state = ['unknown', 'saving'].includes(state) ? state : 'none';
    h.model.draft = state === 'draft' ? { key: 'draft' } : null;
    h.model.deletion = state === 'deletion' ? {} : null; tree = draw();
    assert.equal(component(tree, 'AppTextField', '搜尋已保存記錄').props.disabled, true);
    for (const label of ['搜尋', '下一頁', '上一頁']) assert.equal(component(tree, 'AppButton', label).props.disabled, true);
    assert.ok(nodes(tree).filter(node => node.type === 'Pressable').every(node => node.props.disabled));
    assert.equal(component(tree, 'CareRecordDelete'), undefined);
  }
  h.model.operation.state = 'none'; h.model.draft = null; h.model.deletion = null;
  assert.ok(render({ model: h.model, actions: h.actions }).type.toString().includes('CareRecordDetail'));
});

test('saved selection and record deep links use the existing workspace detail and return path', () => {
  for (const width of [320, 1024]) {
    const h = workspace(undefined, width); let tree = chooseTab(h, 'recorded');
    const record = h.model.list.records[0];
    component(tree, 'CareSavedRecordsList').props.actions.openRecord(record.id);
    assert.deepEqual(h.calls.at(-1), ['open', record.id]);
    h.model.detail = { record }; tree = h.render();
    assert.equal(component(tree, 'CareRecordDetail').props.detail, h.model.detail);
    assert.equal(byTestId(tree, 'care-review-list').props['aria-hidden'], width < 760);
    component(tree, 'CareRecordDetail').props.actions.closePanel(); tree = h.render();
    assert.equal(component(tree, 'CareRecordDetail'), undefined);
    assert.equal(byTestId(tree, 'care-review-list').props['aria-hidden'], false);
    assert.equal(tabs(tree).props.value, 'recorded');
    const linked = workspace(undefined, width, { initialRecordId: record.id });
    linked.model.detail = { record }; tree = linked.render();
    assert.equal(tabs(tree).props.value, 'recorded');
    assert.equal(component(tree, 'CareRecordDetail').props.detail, linked.model.detail);
    assert.equal(component(tree, 'CareCaptureDetail'), undefined);
  }
});

test('explicit prior-consent pending items remain discoverable and sort after important ones', () => {
  const items = values.projectCareCaptures(createCareCaptureFixtures(childId, 'prior_consent'), createCareFixtures(childId, 'prior_consent'), childId, 'scope');
  const h = workspace(items), tree = h.render();
  assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: 4 }); assert.equal(rows(tree).length, 4);
  assert.ok(rows(tree).slice(0, 2).every(row => row.props.accessibilityLabel.includes('重要')));
  assert.ok(rows(tree).slice(2).every(row => row.props.accessibilityLabel.includes('寫入前確認')));
});

test('compact source filtering is read-only and original operations guard tabs, rows and filters', () => {
  const h = workspace(); let tree = openFilters(h);
  const source = component(tree, 'AppSelect', '來源對話'); assert.equal(source.props.options.length, 6);
  const pending = fixtures().find(item => item.id.endsWith('important-appointment'));
  source.props.onChange(values.careReviewSourceKey(pending)); tree = h.render();
  assert.equal(rows(tree).length, 1); rows(tree)[0].props.onPress(); tree = h.render();
  assert.equal(component(tree, 'CareCaptureDetail').props.capture.id, pending.id);
  const selectedSource = component(tree, 'AppSelect', '來源對話').props.value;
  for (const lock of ['unknown', 'saving', 'draft', 'deletion']) {
    h.model.operation.state = ['unknown', 'saving'].includes(lock) ? lock : 'none';
    h.model.draft = lock === 'draft' ? { key: 'draft' } : null;
    h.model.deletion = lock === 'deletion' ? {} : null; tree = h.render();
    assert.equal(component(tree, 'AppSelect', '來源對話').props.disabled, true);
    const before = h.calls.length;
    component(tree, 'AppSelect', '來源對話').props.onChange('all'); tabs(tree).props.onChange('recorded'); rows(tree)[0].props.onPress();
    tree = h.render(); assert.equal(tabs(tree).props.value, 'pending');
    assert.equal(component(tree, 'AppSelect', '來源對話').props.value, selectedSource); assert.equal(h.calls.length, before);
  }
});

test('mobile selection opens the detail and Back returns without confirming or dropping the row', () => {
  const h = workspace(undefined, 390); let tree = h.render();
  rows(tree)[0].props.onPress(); tree = h.render();
  assert.equal(nodes(tree).find(node => node.props?.testID === 'care-review-list').props['aria-hidden'], true);
  assert.equal(component(tree, 'CareCaptureDetail').props.wide, false);
  component(tree, 'AppButton', '返回記錄清單').props.onPress(); tree = h.render();
  assert.equal(nodes(tree).find(node => node.props?.testID === 'care-review-list').props['aria-hidden'], false);
  assert.equal(rows(tree).length, 2); assert.equal(component(tree, 'CareCaptureDetail'), undefined);
  assert.deepEqual(h.calls, ['close', 'close']);
});

test('desktop keeps list and detail together and keeps the selected receipt after confirmation', () => {
  const h = workspace(undefined, 1200); let tree = h.render(); rows(tree)[0].props.onPress(); tree = h.render();
  assert.equal(nodes(tree).find(node => node.props?.testID === 'care-review-list').props['aria-hidden'], false);
  assert.equal(component(tree, 'CareCaptureDetail').props.wide, true);
  const selected = component(tree, 'CareCaptureDetail').props.capture;
  h.model.review.items = h.model.review.items.map(item => item.id === selected.id ? { ...item, reviewState: 'confirmed' } : item);
  tree = h.render(); assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: 1 }); assert.equal(rows(tree).length, 1);
  assert.equal(component(tree, 'CareCaptureDetail').props.capture.reviewState, 'confirmed');
});

test('split review reserves the list basis while narrow panels use natural content height', () => {
  for (const width of [760, 960, 989, 990, 1024, 1200, 1440]) {
    const h = workspace(undefined, width); let tree = h.render();
    const initial = flatten(byTestId(tree, 'care-review-list').props.style);
    assert.equal(initial.flex, undefined); assert.equal(initial.flexBasis, undefined);
    rows(tree)[0].props.onPress(); tree = h.render();
    const list = flatten(byTestId(tree, 'care-review-list').props.style);
    const detail = flatten(byTestId(tree, 'care-review-detail-panel').props.style);
    assert.equal(list.flex, undefined); assert.equal(list.flexBasis, '32%');
    assert.equal(list.flexGrow, 0); assert.equal(list.flexShrink, 0); assert.equal(list.minWidth, 0);
    assert.equal(detail.flex, undefined); assert.equal(detail.flexBasis, 0);
    assert.equal(detail.flexGrow, 1); assert.equal(detail.minWidth, 0);
    assert.equal(component(tree, 'CareCaptureDetail').props.wide, width * .68 - 33 >= 640);
  }
  for (const width of [320, 390, 759]) {
    const h = workspace(undefined, width); rows(h.render())[0].props.onPress(); const tree = h.render();
    const detail = flatten(byTestId(tree, 'care-review-detail-panel').props.style);
    assert.equal(detail.flex, undefined); assert.equal(detail.flexGrow, undefined); assert.equal(detail.flexBasis, undefined);
    assert.equal(detail.height, undefined); assert.equal(detail.minHeight, undefined);
    assert.equal(byTestId(tree, 'care-review-list').props['aria-hidden'], true);
    assert.equal(component(tree, 'CareCaptureDetail').props.wide, false);
  }
});

test('original and interpretation only share flex space in a horizontal comparison', () => {
  const render = renderer('../src/components/care/CareCaptureDetail.tsx', 'CareCaptureDetail');
  const capture = fixtures().find(item => item.reviewRequirement === 'required' && item.writeState === 'saved');
  for (const wide of [false, true, false]) {
    const tree = render({ capture, wide, canEdit: true, canConfirmImportant: true, onCorrection() {}, onConfirmImportant() {}, onOpenRecord() {} });
    const comparison = flatten(byTestId(tree, 'care-capture-comparison').props.style);
    assert.equal(comparison.flexDirection, wide ? 'row' : 'column');
    assert.equal(comparison.gap, 16);
    for (const id of ['care-capture-original-column', 'care-capture-interpretation-column']) {
      const style = flatten(byTestId(tree, id).props.style);
      assert.equal(style.flex, undefined); assert.equal(style.width, undefined);
      assert.equal(style.height, undefined); assert.equal(style.minHeight, undefined); assert.equal(style.minWidth, 0);
      assert.equal(style.flexGrow, wide ? 1 : undefined); assert.equal(style.flexBasis, wide ? 0 : undefined);
    }
    assert.ok(nodes(tree).some(node => node.props?.children === capture.originalText));
    assert.ok(component(tree, 'CareValueSummary'));
    assert.ok(component(tree, 'AppButton', '確認重要內容正確（預覽）'));
    assert.ok(component(tree, 'AppButton', '來源與版本資料'));
  }
});

test('multi-chat pager replaces ten items while retaining the selected source', () => {
  const base = fixtures().find(item => item.reviewRequirement === 'optional');
  const items = Array.from({ length: 13 }, (_, i) => ({ ...base, id: `page-${i}` }));
  const h = workspace(items, 1024, { history: true, initialStatus: 'written' }); let tree = openFilters(h);
  const selectedSource = values.careReviewSourceKey(base);
  component(tree, 'AppSelect', '來源對話').props.onChange(selectedSource); tree = h.render();
  const first = rows(tree).map(node => node.key);
  assert.equal(first.length, 10); component(tree, 'AppButton', '下一頁').props.onPress(); tree = h.render();
  const second = rows(tree).map(node => node.key);
  assert.equal(second.length, 3); assert.equal(second.some(key => first.includes(key)), false);
  assert.equal(component(tree, 'AppSelect', '來源對話').props.value, selectedSource);
  component(tree, 'AppButton', '上一頁').props.onPress(); tree = h.render();
  assert.deepEqual(rows(tree).map(node => node.key), first);
});

test('older pending remains in the same total and has an explicit route beyond the recent window', () => {
  const original = fixtures().find(item => item.reviewRequirement === 'optional');
  const old = { ...fixtures()[0], id: 'older-required', sourceContext: { ...original.sourceContext, occurredAt: '2000-01-01T00:00:00Z' } };
  const items = [...Array.from({ length: 100 }, (_, i) => ({ ...original, id: `recent-${i}` })), old];
  let opened = 0; const h = workspace(items, 1200, { onOlderPending: () => opened++ }); let tree = h.render();
  assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: 1 }); assert.equal(rows(tree).length, 0);
  component(tree, 'AppButton', '查看較早待確認').props.onPress(); assert.equal(opened, 1);
  const history = workspace(items, 1200, { history: true, olderOnly: true, initialStatus: 'pending' });
  assert.equal(rows(history.render()).length, 1); assert.equal(rows(history.render())[0].key, old.id);
  h.model.review.state = 'error'; tree = h.render(); assert.deepEqual(tabs(tree).props.items[0], { key: 'pending', label: '待確認', count: undefined });
  assert.equal(rows(tree).length, 0); assert.equal(component(tree, 'CareCaptureDetail'), undefined);
});

test('the Records page removes entry-hub buttons without removing its correction workspace', () => {
  const render = renderer('../src/components/care/CareRecordsView.tsx', 'CareRecordsView');
  const tree = render({ model: { child: { name: 'Test child' }, access: 'editable', online: true, operation: { state: 'none' } }, actions: {}, onReviewHistory() {}, onPhotos() {}, onMore() {}, onHistory() {} });
  assert.equal(tree.props.title, '核對');
  assert.equal(component(tree, 'AppButton'), undefined); assert.ok(component(tree, 'CareReviewWorkspace'));
});

test('multi-chat detail retains original, Agent interpretation and update-before comparison', () => {
  const render = renderer('../src/components/care/CareCaptureDetail.tsx', 'CareCaptureDetail');
  const item = fixtures().find(item => item.id.endsWith('sleep-written'));
  const tree = render({ capture: item, wide: true, canEdit: true, onCorrection() {}, onOpenRecord() {} });
  const summaries = nodes(tree).filter(node => node.type === 'CareValueSummary');
  assert.equal(summaries[0].props.values, item.basis.history.find(revision => revision.version === 2).values);
  assert.equal(summaries[1].props.values, item.proposedValues);
  assert.ok(component(tree, 'AppButton', '理解有誤，修正記錄'));
  const expired = render({ capture: fixtures().find(item => item.operationValidity?.state === 'expired'), onConfirm() {}, confirmLabel: "Confirm expired proposal", canConfirm: true, onSkip() {}, canSkip: true });
  assert.equal(component(expired, 'AppButton', '略過，不寫入'), undefined);
  assert.equal(component(expired, 'AppButton', 'Confirm expired proposal'), undefined);
});

test('multi-chat unrelated domains and missing source dates cannot inherit Care ownership or fabricated chronology', () => {
  const original = fixtures().find(item => item.writeState === 'saved');
  for (const targetDomain of ['long_term_fact', 'task']) {
    const foreign = { ...original, targetDomain };
    const projected = values.projectCareCaptures([foreign], createCareFixtures(childId), childId, 'scope')[0];
    assert.equal(projected.savedRecord, null); assert.equal(projected.basis, null);
    assert.equal(values.careCaptureReadiness({ ...foreign, writeState: 'not_saved', reviewState: 'pending' }, { childId, access: 'editable', capabilities: { create: true, update: true } }).allowed, false);
    assert.equal(values.careImportantReviewReadiness(foreign, { childId, scopeKey: 'scope', expectedScopeKey: 'scope', access: 'editable', capabilities: { confirmImportant: true } }).allowed, false);
  }
  const missing = { ...original, id: 'unknown-date', sourceContext: undefined, createdAtLabel: '2099 年' };
  assert.equal(values.careReviewChronological([missing, original]).at(-1).id, missing.id);
  assert.equal(values.careReviewSourceGroups([missing])[0].dateLabel, '未提供對話日期');
  const old = { ...original, id: 'old-important', sourceContext: { ...original.sourceContext, occurredAt: '2000-01-01T00:00:00Z' } };
  const window = values.careReviewWindow(values.careReviewChronological([...Array.from({ length: 100 }, (_, i) => ({ ...original, id: `recent-${i}`, reviewState: 'not_required', reviewRequirement: 'optional' })), old]));
  assert.equal(window.recent.length, 100); assert.equal(window.olderPendingCount, 1); assert.equal(window.older[0].id, old.id);
});
