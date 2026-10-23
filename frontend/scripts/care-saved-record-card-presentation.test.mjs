import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual saved-list presentation with synthetic records and host ports.
// This does not claim browser layout, keyboard, focus-return or native coverage.
function setup() {
  const h = harness({
    'react-native': {View: 'View', Pressable: 'Pressable', Platform: {OS: 'android'}, StyleSheet: {create: value => value}},
    '../../theme': {colors: {line: '#CAC9D4', ink: '#272343', muted: '#2D334A', controlSurface: '#FFFFFE'}, radius: {small: 10, medium: 16}, spacing: {sm: 8, md: 12}, readingType: {body: {fontSize: 16, lineHeight: 26}, tool: {fontSize: 14, lineHeight: 22}, meta: {fontSize: 12, lineHeight: 18}}},
    '../ui': {AppButton: 'AppButton', AppSelect: 'AppSelect', AppTextField: 'AppTextField'},
    '../AppIcon': {AppIcon: 'AppIcon'},
    '../AppStatusBadge': {AppStatusBadge: 'AppStatusBadge'},
    '../ReadStateNotice': {ReadStateNotice: 'ReadStateNotice'},
    './CareReviewHistoryView': {CareWriteNotice: 'CareWriteNotice'},
    './CareRecordDetail': {CareRecordDetail: 'CareRecordDetail'},
    '../FormDialog': {FormDialog: 'FormDialog'},
    './CareRecordForm': {CareRecordForm: 'CareRecordForm'},
    './CareRecordDelete': {CareRecordDelete: 'CareRecordDelete'},
    '../history/HistoryCards': {HistoryCardGrid: 'HistoryCardGrid', HistoryEntryCard: 'HistoryEntryCard'},
  });
  const components = h.load('src/components/care/CareSavedRecordsView.tsx');
  const calls = [], actions = {openRecord: id => calls.push(id), closePanel() {}};
  return {...h, calls, renderList: model => h.render(h.jsx(components.CareSavedRecordsList, {model, actions})),
    renderHistory: model => h.render(h.jsx(components.CareSavedRecordsView, {model, actions}))};
}

function record(id = 'synthetic-record-a', text = '午飯吃了半碗飯，之後在公園玩。\n回家時精神不錯。') {
  return {id, childId: 'synthetic-child', title: '日常觀察', createdAtLabel: 'Synthetic creation time', history: [],
    current: {version: 1, confirmedAtLabel: '2026年10月23日 09:15', values: {text, kind: 'note', eventTimeRaw: '昨日午飯'}}};
}
function model(records = [record()]) {
  return {child: {id: 'synthetic-child'}, scopeKey: 'synthetic-parent:synthetic-child', access: 'editable', online: true,
    operation: {state: 'none'}, draft: null, deletion: null, detail: null,
    list: {records, state: 'ready', hasSnapshot: true, message: null, activeQuery: '', activeKind: 'all', hasPrevious: false, hasMore: false}};
}
function descendants(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(descendants);
  return [element, ...descendants(element.props?.children)];
}
const texts = element => descendants(element).filter(node => node.type === 'Text');

test('the active saved list gives original event text three readable lines and a smaller kind label', () => {
  const h = setup(), first = record(), second = record('synthetic-record-b', '睡前一起看了兩本圖畫書。');
  h.renderList(model([first, second]));
  assert.equal(h.hosts().some(node => node.type === 'HistoryCardGrid' || node.type === 'HistoryEntryCard'), false);
  for (const item of [first, second]) {
    const card = h.node(`care-saved-card-${item.id}`), content = texts(card);
    assert.equal(card.type, 'Pressable');
    const kind = content.find(node => node.props.children === item.title);
    const preview = content.find(node => node.props.children === item.current.values.text);
    assert.ok(kind.props.style.fontSize < preview.props.style.fontSize);
    assert.equal(preview.props.numberOfLines, 3);
    assert.ok(descendants(card).some(node => node.type === 'AppIcon' && node.props.name === 'clock-outline'));
    assert.ok(content.some(node => node.props.accessibilityLabel === `確認時間：${item.current.confirmedAtLabel}`));
    assert.equal(preview.props.style.fontSize, 16);
    assert.equal(preview.props.style.lineHeight, 26);
    assert.ok(content.some(node => node.props.children === `確認於 ${item.current.confirmedAtLabel}`));
    assert.equal(content.some(node => node.props.children === item.current.values.eventTimeRaw || node.props.children === item.createdAtLabel), false);
    assert.equal(card.props.accessibilityRole, 'button');
    assert.ok(card.props.accessibilityLabel.includes(item.current.values.text));
    assert.equal(card.props.style.width, undefined);
    assert.equal(card.props.style.height, undefined);
    assert.equal(card.props.style.aspectRatio, undefined);
    assert.deepEqual(card.props.style, {padding: 12, borderWidth: 1, borderColor: '#CAC9D4', backgroundColor: '#FFFFFE', gap: 8},
      'Use the original straight-edged thin frame without changing card width, height or parent layout');
    const labels = descendants(card).find(node => node.type === 'View');
    assert.equal(labels.props.style.flexWrap, 'wrap');
    card.props.onPress();
  }
  assert.deepEqual(h.calls, [first.id, second.id]);
});

test('missing event text retains the original title without inventing a summary or event date', () => {
  const h = setup();
  for (const missing of ['', undefined, null]) {
    const item = record(); item.current.values.text = missing; item.current.confirmedAtLabel = null;
    h.renderList(model([item]));
    const card = h.node(`care-saved-card-${item.id}`), content = texts(card).map(node => node.props.children);
    assert.deepEqual(content, [item.title, '確認時間未知']);
    assert.equal(card.props.accessibilityLabel, `查看${item.title}`);
  }
});

test('the accessible name uses at most 100 original Unicode code points while visible and reader text stay complete', () => {
  const h = setup(), prefix = `${'合'.repeat(99)}🦊`, body = `${prefix}${'成'.repeat(9900)}`;
  const item = record('synthetic-long-record', body), base = model([item]);
  h.renderList(base);
  const card = h.node(`care-saved-card-${item.id}`);
  assert.equal(card.props.accessibilityLabel, `查看${prefix}…`);
  assert.equal(Array.from(card.props.accessibilityLabel).length, 103, 'The prefix never splits a surrogate pair');
  assert.equal(texts(card).find(node => node.props.numberOfLines === 3).props.children, body);
  const detail = {record: item, history: []}; h.renderHistory({...base, detail});
  assert.equal(h.hosts().find(node => node.type === 'CareRecordDetail').props.detail.record.current.values.text, body);
  item.current.values.text = prefix; h.renderList(base);
  assert.equal(h.node(`care-saved-card-${item.id}`).props.accessibilityLabel, `查看${prefix}`, 'Exactly 100 code points need no ellipsis');
});

test('saved and corrected status plus existing read, draft, deletion and operation locks are preserved', () => {
  const h = setup(), item = record(), base = model([item]);
  const card = () => h.node(`care-saved-card-${item.id}`);
  for (const [version, label] of [[1, '已保存'], [2, '已更正']]) {
    item.current.version = version; h.renderList(base);
    const badge = descendants(card()).find(node => node.type === 'AppStatusBadge');
    assert.equal(badge.props.label, label); assert.equal(badge.props.tone, 'success');
  }
  for (const patch of [{operation: {state: 'saving'}}, {operation: {state: 'unknown'}}, {draft: {key: 'synthetic-draft'}}, {deletion: {recordId: item.id}},
    {list: {...base.list, state: 'loading'}}, {list: {...base.list, state: 'loading_more'}}]) {
    h.renderList({...base, ...patch}); assert.equal(card().props.disabled, true);
  }
  for (const patch of [{access: 'read_only'}, {online: false}, {}]) {
    h.renderList({...base, ...patch}); assert.equal(card().props.disabled, false);
  }
  h.renderList({...base, access: 'lost'}); assert.equal(card(), undefined);
  assert.equal(h.hosts().find(node => node.type === 'ReadStateNotice').props.state, 'unavailable');
});

test('history keeps its original grid, title, text preview, version metadata and reader contract', () => {
  const h = setup(), item = record(), base = model([item]); item.current.version = 2;
  h.renderHistory(base);
  assert.equal(h.node(`care-saved-card-${item.id}`), undefined);
  assert.equal(h.node('care-history-cards').type, 'HistoryCardGrid');
  const card = h.node(`care-history-card-${item.id}`), content = texts(card);
  assert.equal(card.type, 'HistoryEntryCard');
  assert.equal(card.props.accessibilityLabel, `查看${item.title}`);
  assert.equal(content[0].props.children, item.title); assert.equal(content[0].props.numberOfLines, 2);
  assert.equal(content[1].props.children, item.current.values.text); assert.equal(content[1].props.numberOfLines, 3);
  assert.deepEqual(content[2].props.children, [item.current.confirmedAtLabel, ' · 版本 ', 2]);
  card.props.onPress(); assert.deepEqual(h.calls, [item.id]);
  h.renderHistory({...base, list: {...base.list, state: 'loading'}});
  assert.equal(h.node(`care-history-card-${item.id}`).props.preserveFocusWhenDisabled, true);
  const detail = {record: item, history: []}; h.renderHistory({...base, detail});
  const reader = h.hosts().find(node => node.type === 'CareRecordDetail');
  assert.equal(reader.props.detail, detail); assert.equal(typeof reader.props.onReturnToList, 'function');
  assert.equal(reader.props.canEdit, true);
  h.renderList({...base, detail});
  assert.ok(h.node(`care-saved-card-${item.id}`));
  assert.equal(h.hosts().some(node => node.type === 'CareRecordDetail'), false, 'Active-page detail remains owned by its existing workspace');
});
