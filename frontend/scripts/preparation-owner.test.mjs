import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initialHome = () => ({ caregiverName: 'preview-parent', selectedChildId: 'preview-child-1', connection: 'online', recordsLoad: 'ready', children: [
  { id: 'preview-child-1', displayName: '甲', ageLabel: '未提供', regionLabel: '香港', allergiesLabel: null, profileConfirmed: true, accessRole: 'owner' },
  { id: 'preview-child-2', displayName: '乙', ageLabel: '未提供', regionLabel: '香港', allergiesLabel: null, profileConfirmed: true, accessRole: 'caregiver' },
] });

// A small deterministic hook harness tests owner transitions, not browser rendering.
function harness() {
  let home = initialHome(), cursor = 0, changed = false;
  const slots = [], effects = [], cache = new Map();
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext() {},
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(result, slots[index])) { slots[index] = result; changed = true; } }];
    },
    useLayoutEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, key) => !Object.is(value, previous[key]))) effects.push(callback);
      slots[index] = dependencies;
    },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    function resolve(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === './PreviewContext') return { usePreview: () => ({ model: home }) };
      if (name === 'luxon') return require(name);
      const source = path.resolve(path.dirname(filename), name);
      return load(source.endsWith('.ts') ? source : existsSync(`${source}.ts`) ? `${source}.ts` : `${source}.tsx`);
    }
    new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  const { PreparationWorkspaceProvider } = load(path.join(root, 'src/preview/PreparationWorkspaceProvider.tsx'));
  let previewTools;
  function render(flush = true) {
    cursor = 0; changed = false;
    let tree = PreparationWorkspaceProvider({ children: 'child' });
    if (flush) {
      let rounds = 0;
      while (effects.length || changed) {
        if (++rounds > 8) throw new Error('Owner did not settle');
        while (effects.length) effects.shift()();
        if (changed) { cursor = 0; changed = false; tree = PreparationWorkspaceProvider({ children: 'child' }); }
      }
    }
    previewTools = tree.props.value;
    return tree.props.children.props.value;
  }
  return { render, setCondition: condition => previewTools.setCondition(condition), home: () => home, setHome: value => { home = value; } };
}

test('the single owner keeps checked and archived documents across entry and child switches', () => {
  const h = harness(); let workspace = h.render(), id = workspace.model.documents[0].id;
  workspace.actions.selectDocument(id); workspace = h.render();
  workspace.actions.checkItem(id, 1, 'checklist', 'check-0', true); workspace = h.render();
  assert.equal(workspace.model.selected.revision.number, 2);
  workspace.actions.archiveDocument(id, 2); workspace = h.render();
  assert.equal(workspace.model.selected.status, 'archived');
  assert.equal(workspace.model.justArchivedId, id);
  const snapshot = workspace.model.selected.revision;
  workspace.actions.closeDocument(); workspace = h.render();
  assert.equal(workspace.model.justArchivedId, null);
  assert.equal(workspace.model.documents.find(document => document.id === id).revision, snapshot);
  h.setHome({ ...h.home(), selectedChildId: 'preview-child-2' }); workspace = h.render(false);
  assert.ok(workspace.model.documents.every(document => document.childId === 'preview-child-2'));
  assert.equal(workspace.model.selected, null);
  h.render(); h.setHome({ ...h.home(), selectedChildId: 'preview-child-1' }); workspace = h.render();
  const archived = workspace.model.documents.find(document => document.id === id);
  assert.equal(archived.status, 'archived'); assert.equal(archived.revision, snapshot);
});

test('an old child callback cannot archive after the selected scope changes', () => {
  const h = harness(); let workspace = h.render(), id = workspace.model.documents[0].id;
  workspace.actions.selectDocument(id); const oldActions = h.render().actions;
  h.setHome({ ...h.home(), selectedChildId: 'preview-child-2' }); h.render(false);
  oldActions.archiveDocument(id, 1); h.render();
  h.setHome({ ...h.home(), selectedChildId: 'preview-child-1' }); workspace = h.render();
  assert.equal(workspace.model.documents.find(document => document.id === id).status, 'active');
  assert.equal(workspace.model.justArchivedId, null);
});

test('identity and role changes mask old data in render before the reset effect', () => {
  for (const mutate of [home => ({ ...home, caregiverName: 'other-person' }), home => ({ ...home, children: home.children.map(child => ({ ...child, accessRole: 'viewer' })) })]) {
    const h = harness(); let workspace = h.render(), id = workspace.model.documents[0].id;
    workspace.actions.selectDocument(id); workspace = h.render();
    workspace.actions.checkItem(id, 1, 'checklist', 'check-0', true); workspace = h.render();
    const oldActions = workspace.actions;
    h.setHome(mutate(h.home())); assert.equal(h.render(false), null);
    oldActions.archiveDocument(id, 2); workspace = h.render();
    assert.equal(workspace.model.selected, null);
    assert.equal(workspace.model.documents[0].revision.number, 1);
    assert.equal(workspace.model.documents[0].status, 'active');
  }
});

test('revoked source masks active and archived detail immediately and rejects prior controls', () => {
  const h = harness(); let workspace = h.render(), id = workspace.model.documents[0].id;
  workspace.actions.selectDocument(id); workspace = h.render(); const oldActions = workspace.actions;
  h.setCondition('private_revoked'); workspace = h.render(false);
  assert.ok(workspace.model.documents.every(document => !document.revision && !document.sources.length));
  assert.equal(workspace.model.selected.revision, null);
  oldActions.archiveDocument(id, 1); workspace = h.render();
  assert.equal(workspace.model.selected.status, 'active');
  assert.equal(workspace.model.justArchivedId, null);
});

test('reading a historical selection never announces a new archive operation', () => {
  const h = harness(); let workspace = h.render();
  workspace.actions.selectDocument(workspace.model.documents.find(document => document.status === 'archived').id);
  workspace = h.render();
  assert.equal(workspace.model.selected.status, 'archived');
  assert.equal(workspace.model.justArchivedId, null);
});
