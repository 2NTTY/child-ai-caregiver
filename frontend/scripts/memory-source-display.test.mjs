import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import * as references from '../src/memory-reference-view-model.ts';
import * as memory from '../src/memory-view-model.ts';

// Shallow production presentation with synthetic identities; no browser, API or model calls.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsx = (type, props, key) => ({ type, props, key });
const noop = () => {};
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children)];
const content = tree => tree === null || tree === undefined || tree === false ? '' : Array.isArray(tree) ? tree.map(content).join(' ')
  : typeof tree === 'object' ? content(tree.props?.children) : String(tree);
const metadata = (tree, label) => nodes(tree).filter(item => item.props?.label === label).map(item => content(item.props.children));
const button = (tree, label) => nodes(tree).find(item => item.type === 'AppButton' && item.props.label === label);
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
let current, production, family, workspace;
const hooks = {
  useState(initial) {
    const instance = current, index = instance.cursor++;
    if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [instance.slots[index], value => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value; }];
  },
  useRef: initial => ({ current: initial }), useLayoutEffect: noop, useId: () => 'synthetic-tabs',
};
function load(relative) {
  const source = readFileSync(path.join(root, relative), 'utf8');
  const module = { exports: {} };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { StyleSheet: { create: value => value }, View: 'View' }, 'react-native-paper': { Text: 'Text' },
  };
  const require = name => imports[name]
    ?? (name.endsWith('/memory-reference-view-model') ? references : undefined)
    ?? (name.endsWith('/memory-view-model') ? memory : undefined)
    ?? (name.endsWith('/MemoryReferenceWorkspace') ? { useMemoryReferenceWorkspace: () => workspace } : undefined)
    ?? (name.endsWith('/ProductionProvider') ? { useProduction: () => production } : undefined)
    ?? (name.endsWith('/SettingsDomains') ? { useProductionSettingsDomains: () => ({ family }) } : undefined)
    ?? (name.endsWith('/TaskKnowledgeDomains') ? { useProductionTaskKnowledgeMemory: () => null } : undefined)
    ?? (name.endsWith('/useContainerWidth') ? { useContainerWidth: () => ({ width: 390, ref: null, onLayout: noop }) } : undefined)
    ?? (name.endsWith('/theme') ? { colors: {}, radius: {}, spacing: {}, readingType: {}, workspaceType: {} } : undefined)
    ?? (name.endsWith('/branding') ? { brand: { name: '育伴港' } } : undefined)
    ?? new Proxy({}, { get: (_target, key) => String(key) });
  new Function('require', 'module', 'exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText)(require, module, module.exports);
  return module.exports;
}
function render(component, props = {}, instance = { slots: [] }) {
  current = instance;
  Object.assign(instance, { component, props, cursor: 0 });
  instance.tree = component(props);
  return instance;
}
const rerender = instance => render(instance.component, instance.props, instance);
const { default: MemoryPage } = load('src/screens/memoryScreen.tsx');
const { MemoryReferenceView } = load('src/components/memory/MemoryReferenceView.tsx');
const self = 'user-self', memberId = 'user-member', formerId = 'user-former';
const display = { scopeKey: 'scope-a', childId: 'child-a', userId: self, members: [{ userId: memberId, name: '合成照顧者' }] };
const fact = patch => ({ id: 'fact-a', childId: 'child-a', key: '合成記憶', content: '合成內容',
  source: { kind: 'private_chat', description: '合成對話描述', messageId: 'cc2440f0-4d11-4004-91df-27da0c42d666' },
  status: 'confirmed', version: 3, visibility: 'private', intendedVisibility: 'private', authorSelf: false,
  confirmedBy: self, confirmedAt: '2026-10-07T10:00:00Z', validUntil: null, reason: '合成確認', applicable: true, sourceState: 'current', ...patch });
function setWorkspace(value, history = []) {
  const read = data => ({ scopeKey: 'scope-a', state: 'ready', revision: '1', asOf: null, data });
  workspace = deepFreeze({ scopeKey: 'scope-a', model: { scopeKey: 'scope-a', childId: 'child-a', childName: '合成孩子', access: 'active', online: true,
    longTerm: read({ childId: 'child-a', facts: [value], summary: null, hasMoreFacts: false,
      histories: { [value.id]: { factVersion: value.version, state: 'ready', items: history, hasMore: false } } }),
    shortTerm: read({ runId: 'run-a', messages: [] }), references: read({ audience: 'public', items: [], hasMore: false }),
  } });
}
function factCard(confirmerDisplay = display) {
  const outer = render(MemoryReferenceView, { confirmerDisplay }).tree;
  const scoped = render(outer.type, outer.props).tree;
  const card = nodes(scoped).find(item => item.type?.name === 'FactCard');
  const instance = render(card.type, card.props);
  button(instance.tree, '查看來源').props.onPress(); rerender(instance);
  return instance;
}
function setPage() {
  production = { auth: 'signedIn', userId: self, scopeKey: 'scope-a', online: true, actions: { prepareQuestion: noop },
    model: { selectedChildId: 'child-a', children: [{ id: 'child-a' }, { id: 'child-b' }] },
    recordsState: { children: [{ id: 'child-a', workspaceId: 'family-a' }, { id: 'child-b', workspaceId: 'family-b' }] } };
  const families = [{ id: 'family-b', members: [{ userId: memberId, name: '另一家庭名稱' }, { userId: formerId, name: '不可跨家庭借用' }] },
    { id: 'family-a', members: display.members }];
  family = { model: { families, family: families[0], selfUserId: self, loadState: 'ready' } };
}
const pageDisplay = () => nodes(render(MemoryPage).tree).find(item => item.type === 'MemoryReferenceView')?.props.confirmerDisplay;

test('confirmation labels use authenticated identity and named members, with concise missing-name and null fallbacks', () => {
  assert.equal(references.memoryConfirmerLabel(self, display), '你');
  assert.equal(references.memoryConfirmerLabel(memberId, display), '合成照顧者');
  assert.equal(references.memoryConfirmerLabel(formerId, display), '名稱未提供');
  assert.equal(references.memoryConfirmerLabel('missing', display), '名稱未提供');
  assert.equal(references.memoryConfirmerLabel(memberId, { ...display, members: [{ userId: memberId, name: '  ' }] }), '名稱未提供');
  assert.equal(references.memoryConfirmerLabel(memberId, { ...display, members: [{ userId: memberId }] }), '名稱未提供');
  assert.equal(references.memoryConfirmerLabel(null, display), '尚未確認');
  assert.equal(references.memoryConfirmerLabel(self), '名稱未提供');
});

test('memory screen resolves only the selected child family, regardless of the family management selection', () => {
  setPage();
  assert.equal(pageDisplay().members, family.model.families[1].members);
  assert.equal(references.memoryConfirmerLabel(memberId, pageDisplay()), '合成照顧者');
  assert.equal(references.memoryConfirmerLabel(formerId, pageDisplay()), '名稱未提供');
  production.model.selectedChildId = 'child-b'; production.scopeKey = 'scope-b';
  assert.equal(pageDisplay().childId, 'child-b');
  assert.equal(pageDisplay().scopeKey, 'scope-b');
  assert.equal(references.memoryConfirmerLabel(memberId, pageDisplay()), '另一家庭名稱');
  production.recordsState.children[1].workspaceId = 'family-missing';
  assert.deepEqual(pageDisplay().members, []);
});

test('account clearing and invalid selected children cannot retain names from the previous identity or family', () => {
  setPage(); production.userId = 'new-user'; production.scopeKey = 'new-account-scope';
  assert.deepEqual(pageDisplay().members, []);
  assert.equal(references.memoryConfirmerLabel(self, pageDisplay()), '名稱未提供');
  production.auth = 'signedOut'; assert.equal(pageDisplay(), undefined);
  production.auth = 'signedIn'; production.userId = null; assert.equal(pageDisplay(), undefined);
  setPage(); family.model.loadState = 'lost'; assert.deepEqual(pageDisplay().members, []);
  setPage(); family.model.families = []; assert.deepEqual(pageDisplay().members, []);
  setPage(); production.scopeKey = ''; assert.equal(pageDisplay(), undefined);
  setPage(); production.recordsState.children = []; assert.equal(pageDisplay(), undefined);
  setPage(); production.model.selectedChildId = null; assert.equal(pageDisplay(), undefined);
});

test('the reference view rejects identity-scope and child mismatches before rendering confirmer names', () => {
  setWorkspace(fact({ confirmedBy: memberId }));
  assert.deepEqual(metadata(factCard().tree, '確認者'), ['合成照顧者']);
  for (const patch of [{ scopeKey: 'old-account-scope' }, { childId: 'child-b' }]) {
    assert.deepEqual(metadata(factCard({ ...display, ...patch }).tree, '確認者'), ['名稱未提供']);
  }
  workspace = null;
  assert.equal(render(MemoryReferenceView, { confirmerDisplay: display }).tree.type, 'ReadStateNotice');
});

test('current and historical confirmations share labels without using authorSelf or mutating source identities', () => {
  const currentFact = fact({ version: 4, authorSelf: false, confirmedBy: self });
  const history = [fact({ version: 3, authorSelf: false, confirmedBy: self }), fact({ version: 2, authorSelf: true, confirmedBy: memberId }), fact({ version: 1, authorSelf: true, confirmedBy: formerId }),
    fact({ version: 0, confirmedBy: null })];
  setWorkspace(currentFact, history); const original = structuredClone(workspace);
  const view = factCard(); button(view.tree, '查看版本記錄').props.onPress(); rerender(view);
  assert.deepEqual(metadata(view.tree, '確認者'), ['你', '你', '合成照顧者', '名稱未提供', '尚未確認']);
  assert.deepEqual(workspace, original);
  assert.equal(currentFact.confirmedBy, self); assert.equal(history[1].confirmedBy, memberId);
  assert.equal(currentFact.source.messageId, 'cc2440f0-4d11-4004-91df-27da0c42d666');
});

test('private-chat sources preserve kind and description without raw message UUIDs or misleading navigation', () => {
  const value = fact(); setWorkspace(value, [fact({ version: 2 })]);
  const view = factCard(); button(view.tree, '查看版本記錄').props.onPress(); rerender(view);
  assert.match(content(view.tree), /私人聊天：合成對話描述/);
  assert.doesNotMatch(content(view.tree), /cc2440f0|user-self|暫未支援/);
  assert.deepEqual(metadata(view.tree, '原訊息'), []);
  assert.equal(nodes(view.tree).some(item => item.props?.href || item.props?.accessibilityRole === 'link' || /Link/.test(item.type?.name ?? item.type)), false);
  assert.deepEqual(nodes(view.tree).filter(item => item.type === 'AppButton').map(item => item.props.label), ['收起來源', '收起版本記錄']);
});

test('empty source descriptions reuse the existing short placeholder and care-record information stays intact', () => {
  assert.equal(memory.factSourceLabel({ kind: 'private_chat', description: '' }), '私人聊天：未提供');
  assert.equal(memory.factSourceLabel({ kind: 'manual', description: '  ' }), '手動描述：未提供');
  const value = fact({ source: { kind: 'care_record', description: '合成照顧描述', recordId: 'care-record-a', version: 4 } });
  setWorkspace(value); const view = factCard();
  assert.match(content(view.tree), /照顧記錄：合成照顧描述 · 來源版本 4/);
  assert.match(metadata(view.tree, '原記錄')[0], /care-record-a.*版本.*4/);
  assert.equal(value.source.recordId, 'care-record-a');
});
