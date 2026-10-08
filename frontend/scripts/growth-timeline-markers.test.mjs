import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
const require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({type, props, key});
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const module = {exports: {}};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const resolve = name => {
    if (name === 'zod') return require('zod');
    if (name === '../../src/shared/concerns.ts') return load('../src/shared/concerns.ts');
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'Fragment'};
    if (name === 'react-native') return {View: 'View', Pressable: 'Pressable', StyleSheet: {create: value => value}, Platform: {OS: 'web', select: values => values.web}};
    if (name === 'react-native-paper') return {Text: 'Text', MD3LightTheme: {colors: {}}, configureFonts: value => value};
    if (name.endsWith('/growth-view-model')) return {growthConcernTimelineEntries: (_concern, page) => page.entries, growthConcernFollowUpLabel: load('src/growth-view-model.ts').growthConcernFollowUpLabel, growthStateLabels: {dismissed: '已關閉'}, growthTime: value => value};
    if (name.endsWith('/task-view-model')) return {taskStateLabels: {}};
    if (name.endsWith('/ui')) return {AppButton: 'AppButton', SectionHeader: 'SectionHeader'};
    for (const component of ['AppStatusBadge', 'AppIcon', 'GrowthArchiveConcernButton']) {
      if (name.endsWith(`/${component}`)) return {[component]: component};
    }
    assert.ok(['/theme', '/growth-styles'].some(suffix => name.endsWith(suffix)), `Unexpected timeline dependency: ${name}`);
    return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
  };
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  cache.set(filename, module.exports);
  return module.exports;
}
const {GrowthConcernTimeline} = load('src/components/growth/GrowthConcernTimeline.tsx');
const {growthStyles: styles} = load('src/components/growth/growth-styles.ts');
const event = (index, kind = 'observation', text = 'Observation') => ({kind: 'event', event: {id: `event-${index}`, kind, at: '2026-10-05', title: `Event ${index}`, text, sourceLabel: 'Record'}});
const attention = {kind: 'attention_state', item: {id: 'attention', version: 1, updatedAt: '2026-10-05', state: 'dismissed', title: 'Prior result', sourceAvailable: true}};
function render(entries, extra = {}) {
  return GrowthConcernTimeline({concern: {id: 'concern', status: 'following', title: 'Concern', reason: 'Reason', historyComplete: true}, page: {entries, authorityVersion: 'authority'}, onTask() {}, ...extra});
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const markerNodes = tree => nodes(tree, node => node.props?.testID?.startsWith('growth-timeline-'));
const flatten = value => Object.assign({}, ...(Array.isArray(value) ? value.filter(Boolean) : [value]));

test('empty and single-entry timelines have no dangling connector', () => {
  assert.equal(markerNodes(render([])).length, 0);
  const followUp = render([], {concern: {id: 'concern', status: 'following', followUp: {at: '2026-10-05T12:00:00Z', state: 'pending'}}});
  assert.ok(nodes(followUp, node => node.type === 'Text').some(node => typeof node.props.children === 'string' && /^站內跟進：.+ · 已安排$/u.test(node.props.children)));
  for (const entry of [event(0), attention]) {
    const markers = markerNodes(render([entry]));
    assert.deepEqual(markers.map(node => node.props.testID), ['growth-timeline-dot-0']);
  }
});

test('mixed events start below the first dot and stop above the last dot', () => {
  const markers = markerNodes(render([event(0), attention, event(2, 'pending_record')]));
  const ids = markers.map(node => node.props.testID);
  assert.ok(!ids.includes('growth-timeline-line-before-0'));
  assert.ok(!ids.includes('growth-timeline-line-after-2'));
  assert.equal(ids.filter(id => id.includes('-line-')).length, 4);
  assert.equal(ids.filter(id => id.includes('-dot-')).length, 3);
  assert.equal(flatten(markers.find(node => node.props.testID === 'growth-timeline-dot-2').props.style).backgroundColor, styles.timelinePending.backgroundColor);
  assert.ok(markers.every(node => node.props.pointerEvents === 'none'));
});

test('connector styles stop at dot edges and follow each row natural height', () => {
  const dot = styles.timelineDot, line = styles.timelineLine;
  assert.equal(styles.timelineEvent.borderLeftWidth, undefined);
  assert.equal(styles.timelineLineBefore.top + styles.timelineLineBefore.height, dot.top);
  assert.equal(styles.timelineLineAfter.top, dot.top + dot.height);
  assert.equal(styles.timelineLineAfter.bottom, 0);
  assert.equal(styles.timelineLineAfter.height, undefined);
  assert.equal(dot.left + dot.width / 2, line.left + line.width / 2);
  assert.ok(dot.zIndex > line.zIndex);
});

test('multiline descriptions remain intrinsic without fixed row or connector heights', () => {
  const text = 'A multiline observation.\n'.repeat(20), tree = render([event(0, 'observation', text), event(1)]);
  assert.ok(nodes(tree, node => node.type === 'Text').some(node => node.props.children === text));
  assert.equal(styles.timelineEvent.height, undefined);
  assert.equal(styles.timelineEvent.maxHeight, undefined);
  const trailing = markerNodes(tree).find(node => node.props.testID === 'growth-timeline-line-after-0');
  assert.equal(flatten(trailing.props.style).bottom, 0);
  assert.equal(flatten(trailing.props.style).height, undefined);
});

test('archive confirmation keeps its original scope, authority and callback', () => {
  const onArchive = () => {}, tree = render([event(0)], {scopeKey: 'scope', onArchive, archiveDisabled: true});
  const button = nodes(tree, node => node.type === 'GrowthArchiveConcernButton')[0];
  assert.equal(button.props.scopeKey, 'scope');
  assert.equal(button.props.authorityVersion, 'authority');
  assert.equal(button.props.onConfirm, onArchive);
  assert.equal(button.props.disabled, true);
});
