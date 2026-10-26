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

test('normal mounted overview reads the report inline, without a second navigation or modal', () => {
  const h = harness(); assert.equal(h.review(), undefined); assert.equal(find(h.tree, 'ChildOverviewRecentRecords'), undefined);
  assert.ok(find(h.tree, 'SummaryRecords')); assert.ok(nodes(h.tree).some(node => node.props?.testID === 'production-summary-brief'));
  const date = find(h.tree, 'AppDateField'); date.props.onChange('2026-09-01'); h.render();
  assert.equal(h.model.query.startDay, '2026-09-01'); assert.equal(h.model.page.period.startDay, '2026-10-17');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'update'); h.unmount();
});
test('same-scope quiet reads keep report and field focus-preservation contract; failures keep a real read retry', () => {
  const h = harness(); const before = find(h.tree, 'SummaryRecords');
  h.patch({busy: true}); assert.equal(find(h.tree, 'SummaryRecords').type, before.type);
  assert.equal(find(h.tree, 'AppDateField').props.preserveFocusWhenDisabled, true);
  h.patch({busy: false, readFailed: true}); button(h.tree, '重新讀取摘要').props.onPress(); assert.deepEqual(h.calls, [['refresh']]); h.unmount();
});
test('unknown recovery remains ahead of the inline brief and uses exact original consent and owner action', () => {
  const h = harness(); const input = {expectedVersion: 7, basisVersion: 'original-basis', period: h.model.query, reviewed: true, questions: ['保留問題'], checklist: [{text:'帶齊記錄',done:false}]};
  const pending = {reference:'original-operation',input,appointmentLabel:'下週諮詢',checked:true,confirmed:false};
  h.patch({operation:'unknown',pending,originalConsent:false}); assert.equal(button(h.tree,'明確重試原到診準備保存').props.disabled,true);
  h.patch({originalConsent:true}); button(h.tree,'明確重試原到診準備保存').props.onPress(); assert.deepEqual(h.calls,[['retry']]);
  assert.equal(h.model.pending,pending); assert.equal(h.model.pending.input,input);
  const children=h.tree.props.children.flat(Infinity).filter(Boolean); assert.equal(children[0].type,'SectionCard'); assert.equal(children[1].props.testID,'production-summary-brief');
  h.patch({pending:{...pending,confirmed:true}}); assert.equal(button(h.tree,'明確重試原到診準備保存'),undefined); h.unmount();
});
test('scope mismatch and lost access reveal no report; a new valid child uses only the new owner page', () => {
  const h=harness(); h.props({childId:'another-child'}); assert.equal(find(h.tree,'SummaryRecords'),undefined);
  h.scope('scope-b','child-b'); assert.equal(find(h.tree,'SummaryRecords').props.page.childId,'child-b');
  h.patch({access:'lost'}); assert.equal(find(h.tree,'SummaryRecords'),undefined); assert.equal(h.review(),undefined); h.unmount();
});
test('legacy editable preparation still requires the original guard before discard; inline report is not a new draft owner', () => {
  const h=harness(); h.patch({dirty:true,query:{...h.model.query,startDay:'2026-08-01'}});
  assert.equal(h.calls.some(call=>call[0]==='discard'),false); h.props({presentation:'full',preparation:true});
  button(h.tree,'查看／人工修改共享到診準備').props.onPress(); h.render();
  const legacy=()=>nodes(h.tree).find(node=>node.props?.accessibilityLabel==='家庭共享到診準備');
  assert.equal(legacy().props.visible,true); legacy().props.onDismiss(); assert.equal(h.intents.at(-1),'navigation'); h.cancel(); assert.equal(legacy().props.visible,true);
  legacy().props.onDismiss(); h.approve(); assert.equal(h.calls.filter(call=>call[0]==='discard').length,1);
  h.patch({dirty:false}); h.unmount();
});
