import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { summaryPeriodLabel, summaryTime } from '../src/summary-view-model.ts';
import { summaryPeriodSchema } from '../src/components/summary/summary-form.ts';
const require = createRequire(import.meta.url);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children)), ...nodes(tree.props?.action)];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
const button = (tree, label) => nodes(tree).find(node => node.type === 'AppButton' && node.props.label === label);

// Actual component and hook state with shallow hosts. No claim about browser focus or layout.
function harness() {
  const slots = [], calls = [], effects = [], intents = [];
  let cursor = 0, dirty = false, guard = null;
  const query = { startDay: '2026-10-17', period: 'week', timeZone: 'Asia/Hong_Kong' };
  let model = { scopeKey: 'scope-a', query, page: { childId: 'child-a', period: { ...query }, generatedAt: '2026-10-23T00:00:00Z', canManage: true },
    access: 'editable', online: true, busy: false, pending: null, readFailed: false, operation: 'none', notice: '', dirty: false };
  let props = { presentation: 'overview', scopeKey: 'scope-a', childId: 'child-a', onRecord: id => calls.push(['record', id]), onTask: id => calls.push(['task', id]) };
  const actions = { refresh: () => calls.push(['refresh']), discard: () => calls.push(['discard']),
    updateQuery: value => { model = { ...model, query: value }; calls.push(['update', value]); }, setOriginalConsent() {}, retryOriginal: () => calls.push(['retry']) };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(fn, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((v, i) => !Object.is(v, previous.deps[i]))) {
      slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
    } },
  };
  const dialog = Object.assign(function AppDialog() {}, { Title: 'DialogTitle', ScrollArea: 'ScrollArea', Actions: 'DialogActions' });
  const elements = new Proxy({}, { get: (_target, key) => String(key) });
  const imports = { react, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: 'View' }, 'react-native-paper': { Text: 'Text' },
    '../components/AppDialog': { AppDialog: dialog }, '../summary-view-model': { summaryPeriodLabel, summaryTime },
    '../components/summary/summary-form': { summaryPeriodSchema }, '../components/summary/summary-styles': { summaryStyles: {} },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => (action, intent) => { intents.push(intent ?? "navigation"); guard = action; } },
    './TaskKnowledgeDomains': { useProductionTaskKnowledgeSummary: () => ({ model, actions }) } };
  const code = ts.transpileModule(readFileSync(new URL('../src/production/TaskKnowledgeSummaryContent.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(name => imports[name] ?? elements, mod, mod.exports);
  let tree;
  const render = () => { let n = 0; do { assert.ok(++n < 10); cursor = 0; dirty = false; tree = mod.exports.TaskKnowledgeSummaryContent(props); while (effects.length) effects.shift()(); } while (dirty); return tree; };
  const review = () => nodes(tree).find(node => node.type === dialog && node.props.accessibilityLabel === '完整回顧');
  render();
  return { get tree() { return tree; }, get model() { return model; }, calls, intents, render, review,
    props(value) { props = { ...props, ...value }; return render(); },
    open() { find(tree, 'ChildOverviewRecentRecords').props.onReview(); render(); },
    patch(value) { model = { ...model, ...value }; return render(); },
    scope(scopeKey, childId) { props = { ...props, scopeKey, childId }; model = { ...model, scopeKey, page: { ...model.page, childId } }; return render(); },
    dismiss() { review().props.onDismiss(); }, approve() { const fn = guard; guard = null; fn?.(); return render(); }, cancel() { guard = null; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('complete review is a dialog, not an inline report; closing/reopening preserves owner draft and applied period', () => {
  const h = harness(); assert.equal(h.review().props.visible, false);
  assert.ok(find(h.tree, 'ChildOverviewRecentRecords'));
  const topChildren = h.tree.props.children.flat(Infinity).filter(Boolean);
  assert.equal(topChildren.some(node => node.type === 'SectionCard'), false);
  h.open(); assert.equal(h.review().props.visible, true);
  const date = find(h.review(), 'AppDateField'); date.props.onChange('2026-09-01'); h.render();
  assert.equal(h.model.query.startDay, '2026-09-01'); assert.equal(h.model.page.period.startDay, '2026-10-17');
  h.dismiss(); assert.equal(h.review().props.visible, true, 'Dismiss is guarded'); h.cancel(); assert.equal(h.review().props.visible, true);
  h.dismiss(); h.approve(); assert.equal(h.review().props.visible, false); h.open();
  assert.equal(find(h.review(), 'AppDateField').props.value, '2026-09-01');
  assert.equal(h.calls.some(call => call[0] === 'refresh' || call[0] === 'discard'), false);
  assert.ok(find(h.review(), 'SummaryRecords')); h.unmount();
});

test('normal same-scope quiet refresh keeps review and original SummaryRecords position mounted', () => {
  const h = harness(); h.open(); const before = find(h.review(), 'SummaryRecords');
  h.patch({ busy: true }); assert.equal(h.review().props.visible, true);
  assert.equal(find(h.review(), 'AppDateField').props.preserveFocusWhenDisabled, true);
  assert.equal(find(h.review(), 'SummaryRecords').type, before.type);
  h.patch({ busy: false, page: { ...h.model.page, generatedAt: '2026-10-23T01:00:00Z' } }); assert.equal(h.review().props.visible, true);
  h.patch({ readFailed: true }); assert.equal(h.review().props.visible, true);
  assert.ok(button(h.review(), '重新讀取摘要')); h.unmount();
});

test('unknown original operation recovery stays visible outside and inside the review without losing exact input', () => {
  const h = harness();
  const input = { expectedVersion: 7, basisVersion: 'original-basis', period: h.model.query, reviewed: true, questions: ['Synthetic original question'], checklist: [{ text: 'Synthetic item', done: false }] };
  const pending = { reference: 'original-operation', input, appointmentLabel: 'Synthetic appointment', checked: true, confirmed: false };
  h.patch({ operation: 'unknown', pending, originalConsent: true });
  assert.ok(button(h.tree, '明確重試原到診準備保存')); h.open();
  assert.equal(h.model.pending, pending); assert.equal(h.model.pending.input, input);
  assert.ok(button(h.review(), '查原收據及更新摘要')); assert.ok(button(h.review(), '明確重試原到診準備保存'));
  h.dismiss(); h.approve(); assert.equal(h.model.pending, pending); assert.ok(button(h.tree, '明確重試原到診準備保存')); h.unmount();
});

test('scope and lost-access transitions hide review immediately and reject late scope close intent', () => {
  const h = harness(); h.open(); h.dismiss(); h.scope('scope-b', 'child-b'); assert.equal(h.review().props.visible, false);
  h.open(); h.approve(); assert.equal(h.review().props.visible, true, 'Old scope close cannot close new scope dialog');
  h.patch({ access: 'lost' }); assert.equal(h.review(), undefined); assert.equal(find(h.tree, 'SummaryRecords'), undefined);
  h.patch({ access: 'editable' }); assert.equal(h.review().props.visible, false); h.unmount();
});


test('closing read-only review retains a genuinely dirty owner; existing editable preparation still requires navigation guard before discard', () => {
  const h = harness(); h.patch({ dirty: true, query: { ...h.model.query, startDay: '2026-08-01' } });
  h.open(); assert.equal(find(h.review(), 'PreparationCard'), undefined, 'The new review contains no editable preparation form');
  h.dismiss(); assert.equal(h.intents.at(-1), 'workspace'); h.approve();
  assert.equal(h.model.dirty, true); assert.equal(h.calls.some(call => call[0] === 'discard'), false);
  h.open(); assert.equal(find(h.review(), 'AppDateField').props.value, '2026-08-01');
  h.props({ presentation: 'full', preparation: true });
  button(h.tree, '查看／人工修改共享到診準備').props.onPress(); h.render();
  const legacy = () => nodes(h.tree).find(node => node.props?.accessibilityLabel === '家庭共享到診準備');
  assert.equal(legacy().props.visible, true); legacy().props.onDismiss();
  assert.equal(h.intents.at(-1), 'navigation'); assert.equal(h.calls.some(call => call[0] === 'discard'), false);
  h.cancel(); assert.equal(legacy().props.visible, true);
  legacy().props.onDismiss(); h.approve(); assert.equal(h.calls.filter(call => call[0] === 'discard').length, 1);
  h.patch({ dirty: false }); h.unmount();
});
