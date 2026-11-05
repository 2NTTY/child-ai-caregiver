import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as growth from '../../src/shared/growth.ts';
import * as model from '../src/growth-view-model.ts';

// Execute the actual candidate and form with explicit shallow React/RHF/UI collaborators.
// This checks displayed evidence semantics, not mounted lifecycle, DOM or accessibility.
const jsx = (type, props) => ({ type, props });
let selectedId;
const mocks = {
  react: { useEffect() {}, useState: value => [value === null ? selectedId : value, () => {}] },
  'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', Linking: {} }, 'react-native-paper': { Text: 'Text' },
  'react-hook-form': { Controller: 'Controller', useForm: ({ defaultValues }) => ({ control: {}, watch: () => defaultValues, handleSubmit: callback => callback, reset() {} }) },
  '../../../src/shared/growth': growth, '../growth-view-model': model,
  '../components/AppCheckbox': {}, '../components/AppDialog': { AppDialog: Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Actions: 'Actions' }) },
  '../components/AppScrollView': { AppScrollView: 'ScrollView' }, '../components/DateTimeFields': {},
  '../components/ui': { AppButton: 'Button', SectionCard: 'Card', SectionHeader: 'Header' },
  '../components/summary/SummaryDisclosure': { SummaryDisclosure: 'Disclosure' }, '../components/FormDialog': {},
  '../components/growth/GrowthOperationRecovery': {}, '../components/growth/growth-styles': { growthStyles: {} },
  '../components/growth/useGrowthFormDraftGuard': { useGrowthFormDraftGuard: () => ({ edited() {}, submitted() {} }) },
  '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => callback => callback() },
};
const source = readFileSync(new URL('../src/production/TaskKnowledgeGrowthCandidates.tsx', import.meta.url), 'utf8');
const output = {};
new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(
  name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, output);
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { return tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree); }
function detail(profileVersion) {
  const item = { id: 'synthetic', childId: 'synthetic-child', topicId: 'solid_food', version: 3, state: 'inapplicable', kind: 'observe',
    title: 'Saved candidate', whyNow: 'Saved reason', advice: 'Saved advice', limits: 'Saved limit', updatedAt: '2026-11-05T00:00:00Z',
    evidence: { profileVersion, facts: [] }, source: { title: 'Saved source', section: 'One', excerpt: 'Saved excerpt', url: 'https://example.test/source',
      versionId: 'source-version-7', checkedAt: '2026-11-05T00:00:00Z' }, sourceAvailable: false, taskId: null };
  const value = { scopeKey: 'synthetic', access: 'readonly', epoch: 1, resetCounts: {}, page: { items: [item], topics: [], authorityVersion: 'synthetic:1' } };
  selectedId = item.id;
  const root = output.TaskKnowledgeGrowthCandidates({ model: value, actions: {}, onTask() {} });
  const form = nodes(root).find(node => node.type?.name === 'AttentionForm'); assert.ok(form);
  selectedId = null;
  return text(form.type(form.props));
}
test('withheld or unavailable profile evidence is not displayed as a verified version zero', () => {
  const value = detail(0);
  assert.doesNotMatch(value, /孩子檔案版本\s*0/u);
  assert.match(value, /孩子檔案依據未提供或不再適用/u);
  assert.match(value, /來源版本 source-version-7/u);
  assert.match(value, /Saved excerpt/u);
});
test('positive saved profile evidence keeps its exact version and source-unavailable warning', () => {
  const value = detail(4);
  assert.match(value, /孩子檔案版本 4/u);
  assert.doesNotMatch(value, /孩子檔案依據未提供或不再適用/u);
  assert.match(value, /原來源或依據已改變／不可用/u);
});
