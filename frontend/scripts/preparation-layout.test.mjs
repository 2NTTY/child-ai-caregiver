import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = file => readFileSync(path.join(root, file), 'utf8');
const workspaceFile = 'src/components/preparations/PreparationWorkspace.tsx';
const previewFile = 'src/preview/PreparationPreviewTools.tsx';
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(Array.isArray(tree) ? tree : [tree.props?.children]).flatMap(nodes)];
const label = (tree, value) => nodes(tree).find(node => node.props?.label === value);
const text = tree => nodes(tree).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []).join(' ');
const reader = tree => nodes(tree).find(node => node.type?.name === 'PreparationReader');
const actions = tree => nodes(tree).find(node => node.props?.testID === 'preparation-list-actions');

// Pure composition checks do not substitute for browser measurements or visual QA.
function harness() {
  let cursor = 0;
  const slots = [], events = [];
  const workspace = { scopeKey: 'child-a', actions: { refresh() {} }, model: { child: { displayName: '甲' }, documents: [{ id: 'active-a', status: 'active' }, { id: 'archive-a', status: 'archived' }], selected: null, condition: 'ready', online: true } };
  const preview = { condition: 'ready', setCondition: value => events.push(['preview-condition', value]) };
  const dependencies = {
    react: { useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; }, useLayoutEffect() {}, useRef: value => ({ current: value }) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'web' }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } },
    'react-native-paper': { Text: 'Text' },
  };
  function compile(file) {
    const output = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    function resolve(name) {
      if (dependencies[name]) return dependencies[name];
      if (name.endsWith('/theme')) return { chineseFont: 'font', colors: {}, radius: {}, readingType: {}, spacing: { sm: 8, md: 12, lg: 16 } };
      if (name.endsWith('/workspaces/PreparationWorkspace')) return { usePreparationWorkspace: () => workspace };
      if (name === './PreparationWorkspaceProvider') return { usePreparationPreviewTools: () => preview };
      if (name.endsWith('/preparation-view-model')) return {
        preparationPurposes: [{ key: 'appointment', label: '到診準備' }, { key: 'school', label: '入學／轉校' }],
        preparationPurposeLabel: value => value === 'school' ? '入學／轉校' : '到診準備',
      };
      return new Proxy({}, { get: (_target, key) => String(key) });
    }
    new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
    return module.exports;
  }
  const main = compile(workspaceFile).PreparationWorkspace;
  const tools = compile(previewFile).PreparationPreviewTools;
  const props = { onHistory: () => events.push(['history']), onPrepareQuestion: value => events.push(['draft', value]), previewControls: { type: 'PreviewControls', props: {} } };
  return { workspace, events, props,
    render(overrides = {}) { cursor = 0; return main({ ...props, ...overrides }); },
    renderPreview() { cursor = 0; return tools(); },
  };
}

test('compact assistant actions precede documents while secondary tools and manual forms stay below', () => {
  const h = harness(), tree = h.render(), ordered = nodes(tree), content = reader(tree), footer = actions(tree);
  assert.deepEqual(content.props.documents.map(document => document.id), ['active-a']);
  assert.ok(ordered.indexOf(footer) < ordered.indexOf(content));
  assert.ok(ordered.indexOf(footer) < ordered.indexOf(h.props.previewControls));
  assert.equal(label(footer, '查看已歸檔'), undefined);
  assert.ok(ordered.indexOf(content) < ordered.indexOf(label(tree, '查看已歸檔')));
  assert.ok(ordered.indexOf(content) < ordered.indexOf(label(tree, '重新讀取準備單')));
  assert.equal(label(tree, '查看已歸檔').props.variant, 'quiet');
  assert.ok(label(footer, '用途'));
  assert.equal(label(footer, '到助手準備下一份').props.variant, 'secondary');
  assert.equal(label(footer, '到助手準備下一份').props.density, 'compact');
  const purposeField = nodes(footer).find(node => node.props?.children === label(footer, '用途'));
  assert.equal(purposeField.props.style.flexGrow, undefined);
  assert.equal(purposeField.props.style.minWidth, undefined);
  assert.equal(footer.props.style.flexDirection, 'row');
  assert.equal(footer.props.style.flexWrap, 'wrap');
  assert.equal(footer.props.style.minHeight, undefined);
  assert.equal(footer.props.style.flex, undefined);
  for (const redundant of ['準備好，打開就能用', '各自留成一份準備單', '下一次要準備甚麼？', '在助手交代用途、日期及需要。']) assert.ok(!source(workspaceFile).includes(redundant));
});

test('the relocated actions keep history navigation and the unchanged unsent purpose draft callback', () => {
  const h = harness(); let tree = h.render();
  label(tree, '查看已歸檔').props.onPress();
  label(tree, '用途').props.onChange('school');
  tree = h.render();
  label(tree, '到助手準備下一份').props.onPress();
  assert.deepEqual(h.events, [['history'], ['draft', '請幫我為甲整理一份入學／轉校。先和我確認用途、日期、已知安排及仍未確定的資料。']]);
  assert.equal(label(tree, '用途').props.value, 'school');
});

test('selected documents and write recovery retain their existing composition and disabled boundaries', () => {
  const h = harness();
  h.workspace.model.selected = { id: 'active-a', status: 'active' };
  h.workspace.model.operation = { state: 'unknown', reference: 'original-operation' };
  const tree = h.render(), recovery = nodes(tree).find(node => node.type === 'WriteRecoveryNotice');
  assert.equal(actions(tree), undefined);
  assert.ok(nodes(tree).indexOf(recovery) < nodes(tree).indexOf(reader(tree)));
  assert.equal(recovery.props.operation, h.workspace.model.operation);
  assert.equal(reader(tree).props.onPrepareQuestion, h.props.onPrepareQuestion);
  h.workspace.model.selected = null;
  h.workspace.model.online = false;
  assert.equal(label(h.render(), '到助手準備下一份').props.disabled, true);
  h.workspace.model.online = true;
  h.workspace.model.condition = 'lost';
  assert.equal(label(h.render(), '到助手準備下一份').props.disabled, true);
  h.workspace.model.condition = 'ready';
  assert.equal(label(h.render({ onPrepareQuestion: undefined }), '到助手準備下一份').props.disabled, true);
});

test('normal preview detail stays inside the existing accessible disclosure', () => {
  const h = harness(); let tree = h.renderPreview();
  assert.equal(label(tree, '合成準備單示例'), undefined);
  assert.equal(label(tree, '準備單預覽狀態'), undefined);
  assert.equal(label(tree, '預覽來源與限制').props.expanded, false);
  label(tree, '預覽來源與限制').props.onPress();
  tree = h.renderPreview();
  assert.equal(label(tree, '預覽來源與限制').props.expanded, true);
  assert.ok(label(tree, '合成準備單示例'));
  assert.ok(text(tree).includes('清單及歸檔只保留在本次預覽'));
  assert.ok(label(tree, '準備單預覽狀態'));
  label(tree, '預覽來源與限制').props.onPress();
  assert.equal(label(h.renderPreview(), '合成準備單示例'), undefined);
});

test('document evidence, actionable warnings, archive guards and responsive reader remain present', () => {
  const content = source(workspaceFile), detail = content.slice(content.indexOf('function PreparationDocumentDetail'), content.indexOf('type ReadingProps'));
  assert.ok(detail.indexOf('revision?.sections.map') < detail.indexOf('label="來源與版本"'));
  assert.ok(detail.indexOf('label="來源與版本"') < detail.indexOf('label="使用完畢，歸檔"'));
  for (const retained of ['canChangePreparation(document, workspace.model.scope) && !pending', 'disabled={!canArchive}', 'archiveAsked && canArchive', 'workspace.actions.archiveDocument(document.id, document.version)', 'workspace.actions.checkItem(document.id, document.version, section.id, item.id, value)', 'document.sources.map', 'state.detail', '目前離線', '目前為唯讀', 'workspace.model.archiveNotice']) assert.ok(detail.includes(retained), retained);
  for (const retained of ['來源權限已改變', '來源已失效', '來源狀態未知', '來源已有更新', '暫時未能取得準備單', '孩子權限已失效', 'wide = layout.width >= 840', '!selected || wide', 'anchor.current?.scope === workspace.scopeKey']) assert.ok(content.includes(retained), retained);
});


test('empty, one and multiple document lists preserve assistant-first order and the original manual permission gate', () => {
  const h = harness();
  Object.assign(h.workspace.actions, { createDocument() {}, markDraft() {}, discardDraft() {} });
  h.workspace.model.scope = { role: 'owner' };
  for (const count of [0, 1, 7]) {
    h.workspace.model.documents = Array.from({ length: count }, (_, i) => ({ id: `active-${i}`, status: 'active' }));
    for (const condition of ['ready', 'read_only', 'refresh_failed']) {
      h.workspace.model.condition = condition;
      const tree = h.render(), ordered = nodes(tree), assistant = label(tree, '到助手準備下一份');
      const manual = label(tree, '手動建立準備單'), content = reader(tree);
      assert.equal(content.props.documents.length, count);
      assert.ok(ordered.indexOf(assistant) < ordered.indexOf(content));
      assert.ok(ordered.indexOf(content) < ordered.indexOf(manual));
      assert.equal(manual.props.scopeKey, h.workspace.scopeKey);
    }
  }
  h.workspace.model.scope.role = 'viewer';
  assert.equal(label(h.render(), '手動建立準備單'), undefined);
  assert.ok(label(h.render(), '到助手準備下一份'), 'Read-only readers may discuss without mutating documents');
});
