import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { z } from 'zod';
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
const button = (tree, label) => nodes(tree).find(item => item.type === 'AppButton' && item.props.label === label
  || item.type === 'Pressable' && item.props.accessibilityLabel?.startsWith(`${label}：`));
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
let current, production, family, workspace, managementOwner, factForm;
let openedURLs = [], linkReject = false;
const hooks = {
  useState(initial) {
    const instance = current, index = instance.cursor++;
    if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [instance.slots[index], value => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value; }];
  },
  useRef: initial => ({ current: initial }), useEffect: noop, useLayoutEffect: noop, useId: () => 'synthetic-tabs',
};
function load(relative) {
  const source = readFileSync(path.join(root, relative), 'utf8');
  const module = { exports: {} };
  const imports = {
    'expo-router': { useRouter: () => ({ push: noop }) },
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, zod: { z },
    'react-hook-form': { Controller: 'Controller', useForm({ defaultValues }) {
      factForm ??= { ...defaultValues };
      return { control: {}, watch: () => factForm, handleSubmit: submit => () => submit(factForm) };
    } },
    'react-native': { StyleSheet: { create: value => value }, View: 'View', Pressable: 'Pressable', Linking: { openURL: url => { openedURLs.push(url); return linkReject ? Promise.reject(new Error('Synthetic unavailable source')) : Promise.resolve(); } } }, 'react-native-paper': { Text: 'Text' },
  };
  const require = name => imports[name]
    ?? (name.endsWith('/memory-reference-view-model') ? references : undefined)
    ?? (name.endsWith('/memory-view-model') ? memory : undefined)
    ?? (name.endsWith('/PreviewNavigationGuard') ? { usePreviewNavigation: () => action => action() } : undefined)
    ?? (name.endsWith('/MemoryReferenceWorkspace') ? { useMemoryReferenceWorkspace: () => workspace } : undefined)
    ?? (name.endsWith('/ProductionProvider') ? { useProduction: () => production } : undefined)
    ?? (name.endsWith('/SettingsDomains') ? { useProductionSettingsDomains: () => ({ family }) } : undefined)
    ?? (name.endsWith('/TaskKnowledgeDomains') ? { useProductionTaskKnowledgeMemory: () => managementOwner ?? null } : undefined)
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
  assert.ok(card, 'The actual fact renderer must exist; empty trees cannot pass');
  const instance = render(card.type, card.props);
  const sourceButton = button(instance.tree, '查看來源');
  assert.ok(sourceButton, 'The actual source disclosure callback must be rendered');
  sourceButton.props.onPress(); rerender(instance);
  assert.equal(button(instance.tree, '收起來源').props['aria-expanded'], true);
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
  assert.deepEqual(nodes(view.tree).filter(item => item.type === 'AppButton').map(item => item.props.label), ['收起版本記錄']);
});

test('imported memory retains foreign source descriptions without mapping its confirmer or references to local identities', () => {
  const source = { kind: 'imported', description: '合成資料包來源', sourceState: 'current',
    original: { kind: 'care_record', description: '合成外來照顧描述', recordId: 'foreign-care-id', version: 7 } };
  const value = fact({ source, confirmationBasis: 'imported_source', confirmedBy: self });
  setWorkspace(value, [fact({ source, confirmationBasis: 'imported_source', confirmedBy: memberId, version: 2 })]);
  const snapshot = structuredClone(workspace), view = factCard();
  assert.equal(button(view.tree, '收起來源').props.accessibilityLabel, '收起來源：匯入資料包');
  assert.match(content(view.tree), /匯入資料包：合成資料包來源/);
  assert.match(content(view.tree), /照顧記錄：合成外來照顧描述.*來源版本 7/);
  assert.deepEqual(metadata(view.tree, '確認者'), [`來源確認：${self}`]);
  button(view.tree, '查看版本記錄').props.onPress(); rerender(view);
  assert.deepEqual(metadata(view.tree, '確認者'), [`來源確認：${self}`, `來源確認：${memberId}`]);
  assert.equal(nodes(view.tree).some(item => item.props?.href || item.props?.accessibilityRole === 'link'), false);
  assert.deepEqual(workspace, snapshot);
  setWorkspace(fact({ source, confirmedBy: self }));
  assert.deepEqual(metadata(factCard().tree, '確認者'), ['你'], 'local reconfirmation stays local even when the source remains imported');
  const hidden = { ...source, original: { kind: 'private_chat', description: '合成外來私人描述' } };
  setWorkspace(fact({ source: hidden, confirmationBasis: 'imported_source', confirmedBy: self }));
  const privateView = factCard(); assert.match(content(privateView.tree), /私人聊天：合成外來私人描述/);
  assert.deepEqual(metadata(privateView.tree, '原訊息'), []); assert.equal('messageId' in hidden.original, false);
});

test('the real memory editor retains its imported basis exactly and offers imported sources only for that existing basis', () => {
  const source = { kind: 'imported', description: '合成資料包來源', sourceState: 'current',
    original: { kind: 'private_chat', description: '合成外來私人描述' } };
  const basis = fact({ source, authorSelf: true, confirmationBasis: 'imported_source' }), submitted = [];
  managementOwner = { facts: [basis], topics: [], role: 'owner', sharedMode: false, busy: false, lost: false,
    value: { scopeKey: 'scope-a', model: { online: true, longTerm: { data: { histories: {} } } } },
    management: { locked: false, operation: 'idle', pending: null, busy: false, epoch: 1,
      markDirty: noop, discard: noop, submit: intent => submitted.push(intent) } };
  const { TaskKnowledgeMemoryManagement } = load('src/production/TaskKnowledgeMemoryManagement.tsx');
  const outer = render(TaskKnowledgeMemoryManagement);
  button(outer.tree, '管理記憶').props.onPress(); rerender(outer);
  button(outer.tree, '人工確認／更正／停用／刪除').props.onPress(); rerender(outer);
  const editorNode = nodes(outer.tree).find(item => item.type?.name === 'FactEditor'); assert.ok(editorNode);
  factForm = null; const editor = render(editorNode.type, editorNode.props);
  const field = name => nodes(editor.tree).find(item => item.type === 'Controller' && item.props.name === name)
    .props.render({ field: { value: factForm[name], onChange: value => { factForm[name] = value; } } });
  assert.ok(field('sourceKind').props.options.some(item => item.value === 'imported'));
  assert.equal(field('sourceDescription').props.disabled, true);
  factForm.reason = '合成本地更正';
  const confirm = () => {
    nodes(editor.tree).find(item => item.type === 'AppCheckbox' && item.props.label.startsWith('我已核對原內容')).props.onChange(true);
    rerender(editor); button(editor.tree, '確認提交這次人工操作').props.onPress();
  };
  confirm(); assert.equal(submitted.length, 1);
  assert.equal(submitted[0].input.values.source, editorNode.props.basis.source);
  assert.equal('messageId' in submitted[0].input.values.source.original, false);
  assert.equal('confirmationBasis' in submitted[0].input, false);
  field('sourceKind').props.onChange('manual'); rerender(editor);
  field('sourceDescription').props.onChangeText('合成明確本地描述'); rerender(editor);
  confirm(); assert.deepEqual(submitted[1].input.values.source, { kind: 'manual', description: '合成明確本地描述' });
  button(outer.tree, '人工新增候選事實').props.onPress(); rerender(outer);
  const createNode = nodes(outer.tree).find(item => item.type?.name === 'FactEditor'); assert.equal(createNode.props.basis, null);
  factForm = null; const create = render(createNode.type, createNode.props);
  const sourceSelect = nodes(create.tree).find(item => item.type === 'Controller' && item.props.name === 'sourceKind')
    .props.render({ field: { value: factForm.sourceKind, onChange: noop } });
  assert.equal(sourceSelect.props.options.some(item => item.value === 'imported'), false);
  managementOwner = null; factForm = null;
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

test('fact content is primary while the typed source opens only the existing full provenance disclosure', () => {
  for (const [kind, source, icon, label] of [
    ['private_chat', { kind: 'private_chat', description: 'Exact private-chat provenance', messageId: 'never-linked-id' }, 'message-text-outline', '私人聊天'],
    ['care_record', { kind: 'care_record', description: 'Exact care provenance', recordId: 'care-a', version: 3 }, 'notebook-outline', '照顧記錄'],
    ['manual', { kind: 'manual', description: 'Exact manual provenance' }, 'pencil-outline', '手動描述'],
  ]) {
    const value = fact({ source }); setWorkspace(value);
    const snapshot = structuredClone(workspace), view = factCard();
    const trigger = button(view.tree, '收起來源');
    assert.equal(trigger.type, 'Pressable'); assert.equal(trigger.props.accessibilityRole, 'button');
    assert.equal(trigger.props.accessibilityLabel, `收起來源：${label}`);
    assert.ok(nodes(trigger).some(node => node.type === 'AppIcon' && node.props.name === icon), kind);
    assert.equal(nodes(view.tree).find(node => node.type === 'Text' && node.props.children === value.content).props.style.fontSize, 18);
    assert.deepEqual(metadata(view.tree, '來源'), [memory.factSourceLabel(source)]);
    trigger.props.onPress(); rerender(view);
    assert.equal(button(view.tree, '查看來源').props['aria-expanded'], false);
    assert.deepEqual(metadata(view.tree, '來源'), []);
    assert.equal(nodes(view.tree).some(node => node.props?.href || node.props?.accessibilityRole === 'link'), false);
    assert.ok(nodes(view.tree).some(node => node.type === 'AppIcon' && node.props.name === 'lock-outline'));
    assert.equal(content(nodes(view.tree).find(node => node.type === 'Text' && node.props.accessibilityLabel === '可見範圍：本人')), '本人');
    assert.deepEqual(workspace, snapshot);
  }
});

test('optional fact validity is omitted without hiding required missing confirmation or changed-source warnings', () => {
  setWorkspace(fact({ confirmedBy: null, confirmedAt: null, validUntil: null, sourceState: 'changed', applicable: false }));
  const view = factCard();
  assert.deepEqual(metadata(view.tree, '有效至'), []);
  assert.deepEqual(metadata(view.tree, '確認者'), ['尚未確認']);
  assert.match(content(view.tree), /來源已更改/);
  setWorkspace(fact({ visibility: 'family', validUntil: '2099-01-01T00:00:00Z' }));
  const dated = factCard();
  assert.equal(metadata(dated.tree, '有效至').length, 1);
  assert.ok(nodes(dated.tree).some(node => node.type === 'AppIcon' && node.props.name === 'account-group-outline'));
  assert.equal(content(nodes(dated.tree).find(node => node.type === 'Text' && node.props.accessibilityLabel === '可見範圍：家庭共享')), '家庭共享');
});

function referenceCard(source) {
  setWorkspace(fact());
  workspace = deepFreeze({ ...workspace, model: { ...workspace.model, references: { ...workspace.model.references, data: { audience: 'internal', items: [source], hasMore: false } } } });
  const outer = render(MemoryReferenceView).tree, scoped = render(outer.type, outer.props).tree;
  const sectionNode = nodes(scoped).find(node => node.type?.name === 'ReferenceSection'); assert.ok(sectionNode);
  const section = render(sectionNode.type, sectionNode.props).tree;
  const card = nodes(section).find(node => node.type?.name === 'ReferenceCard'); assert.ok(card);
  return render(card.type, card.props);
}

test('reference links use the exact existing URL and reveal the real URL after open failure', async () => {
  const source = { sourceId: 'source-a', versionId: 'version-a', chunkId: 'chunk-a', versionHash: 'version-hash', contentHash: 'content-hash',
    title: 'Synthetic guidance', publisher: 'Synthetic publisher', url: 'https://example.test/actual-source', classification: 'official_guidance', section: '',
    sourceExcerpt: 'Exact reference excerpt', sourcePublishedAt: null, sourceUpdatedAt: null, checkedAt: '2026-10-23T01:00:00Z', fetchedAt: '2026-10-23T01:00:00Z',
    reviewState: 'reviewed', usageScope: 'internal_noncommercial', applicability: { region: '', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: [], conditions: ['Exact applicability condition'] } };
  openedURLs = []; linkReject = true;
  const view = referenceCard(source);
  assert.ok(content(view.tree).includes(source.sourceExcerpt)); assert.deepEqual(metadata(view.tree, '來源日期'), []);
  const link = button(view.tree, '閱讀來源'); assert.ok(link); link.props.onPress(); await Promise.resolve(); rerender(view);
  assert.deepEqual(openedURLs, [source.url]); assert.match(content(view.tree), /暫未能開啟來源/);
  assert.deepEqual(metadata(view.tree, '原文網址'), [source.url]);
  assert.match(content(view.tree), /限內部非商業參考/); assert.match(content(view.tree), /Exact applicability condition/);
  linkReject = false;
  const absent = referenceCard({ ...source, url: '' });
  assert.equal(button(absent.tree, '閱讀來源'), undefined);
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'caregiver://private', 'http://example.test/source',
    'not a URL', 'https://', 'https://user:password@example.test/source', ' https://example.test/source', 'https:\\example.test\\source',
    'https://example.test/line\nbreak', 'https://example.test/path with spaces']) {
    openedURLs = [];
    const blocked = referenceCard({ ...source, url });
    assert.equal(button(blocked.tree, '閱讀來源'), undefined, `${url}: no launch callback`);
    assert.match(content(blocked.tree), /來源網址未能安全開啟/);
    const disclosure = button(blocked.tree, '查看來源資料'); assert.ok(disclosure);
    disclosure.props.onPress(); rerender(blocked);
    assert.deepEqual(metadata(blocked.tree, '原文網址'), [url], 'Untrusted URL remains readable verbatim, not executable');
    assert.deepEqual(openedURLs, [], `${url}: provenance disclosure never opens an invalid URL`);
  }
});
