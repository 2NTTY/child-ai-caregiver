import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual care renderers and proposal mappings; synthetic host ports only.
// No API, model, browser-layout or native accessibility claims.
function setup() {
  const h = harness({
    'react-native': { View: 'View', Platform: { OS: 'android' }, StyleSheet: { create: value => value } },
    '../../theme': { colors: {}, spacing: {}, readingType: { body: { fontSize: 16 }, meta: { fontSize: 12 }, tool: { fontSize: 14 } }, workspaceType: {} },
    '../../motion': { MotionDisclosure: 'MotionDisclosure', MotionReveal: 'MotionReveal' },
    '../AppIcon': { AppIcon: 'AppIcon' }, '../AppStatusBadge': { AppStatusBadge: 'AppStatusBadge' },
    '../ui': { AppButton: 'AppButton', AppSelectionTrigger: 'AppSelectionTrigger', SectionHeader: 'SectionHeader' },
  });
  return { h, ...h.load('src/components/care/CareRecordDetail.tsx') };
}
const values = { kind: 'note', text: 'Exact original care content\nSecond paragraph', source: 'Exact original source description',
  quantityRaw: '半', quantityUnit: '碗', quantityPrecision: 'approximate', eventTimeRaw: '昨日午飯後', reason: 'Exact correction reason' };
const text = h => h.hosts().filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity).join('');

test('care content leads concise purpose-specific metadata without manufacturing source navigation', () => {
  const { h, CareValueSummary } = setup(), snapshot = structuredClone(values);
  h.render(h.jsx(CareValueSummary, { values }));
  const texts = h.hosts().filter(node => node.type === 'Text');
  assert.ok(texts.length >= 5); assert.equal(texts[0].props.children, values.text);
  assert.equal(texts[0].props.style.fontSize, 16);
  for (const name of ['notebook-outline', 'file-document-outline', 'ruler', 'calendar-clock-outline']) {
    assert.ok(h.hosts().some(node => node.type === 'AppIcon' && node.props.name === name), name);
  }
  assert.ok(texts.some(node => node.props.accessibilityLabel === `資料來源：${values.source}`));
  assert.ok(texts.some(node => node.props.accessibilityLabel === `事件時間原文：${values.eventTimeRaw}`));
  assert.match(text(h), /半 碗（約數）/); assert.match(text(h), /Exact correction reason/);
  assert.equal(h.hosts().some(node => node.type === 'Pressable' || node.props.href || node.props.onPress), false);
  assert.deepEqual(values, snapshot);
});

test('care omits absent optional quantity but preserves missing source and event-time warnings and raw precision', () => {
  const { h, CareValueSummary, CareRevisionContent } = setup();
  const missing = { ...values, source: '', quantityRaw: '', eventTimeRaw: '', reason: '' };
  h.render(h.jsx(CareValueSummary, { values: missing, hideEmptyQuantity: true }));
  assert.equal(h.hosts().some(node => node.type === 'AppIcon' && node.props.name === 'ruler'), false);
  assert.match(text(h), /來源未提供/); assert.match(text(h), /事件時間未提供/);
  const revision = { version: 4, values: missing, eventTimePrecision: 'unknown', confirmedByLabel: 'Synthetic confirmer', confirmedAtLabel: 'Synthetic confirmation time' };
  h.render(h.jsx(CareRevisionContent, { revision }));
  assert.match(text(h), /數量未提供/, 'Confirmation and version comparison preserve an explicit cleared quantity');
  assert.match(text(h), /時間精度：未知/); assert.match(text(h), /Synthetic confirmer/); assert.match(text(h), /Synthetic confirmation time/);
  assert.match(text(h), /版本：4/);
  h.render(h.jsx(CareValueSummary, { values: { ...values, quantityPrecision: 'exact' } }));
  assert.match(text(h), /半 碗（精確）/);
});

test('long care metadata values can shrink inside the icon row without truncating source or event text', () => {
  const { h, CareValueSummary } = setup();
  const source = 'https://example.test/' + 'ExactUnbrokenSource'.repeat(25), eventTimeRaw = 'Exact event-time words '.repeat(25);
  h.render(h.jsx(CareValueSummary, { values: { ...values, source, eventTimeRaw } }));
  for (const value of [source, eventTimeRaw]) {
    const node = h.hosts().find(node => node.type === 'Text' && node.props.children === value);
    assert.ok(node, 'The real complete metadata value is rendered');
    const style = Object.assign({}, ...node.props.style.flat(Infinity));
    assert.equal(style.flexShrink, 1); assert.equal(style.minWidth, 0);
    assert.equal(node.props.numberOfLines, undefined); assert.equal(node.props.selectable, true);
  }
});

test('proposal icons are exact-schema semantics, not guessed source types or a repeated fallback information icon', () => {
  const { h } = setup(), { proposalDetailIcon } = h.load('src/components/agent/proposal-presentation.ts');
  assert.equal(proposalDetailIcon('確認期限'), 'calendar-clock-outline');
  assert.equal(proposalDetailIcon('來源', '你在這次聊天提供的內容，需由你核對'), 'message-text-outline');
  assert.equal(proposalDetailIcon('來源', '這次聊天 is merely free-form source text'), 'file-document-outline');
  assert.equal(proposalDetailIcon('接受後可見範圍', '本人'), 'lock-outline');
  assert.equal(proposalDetailIcon('接受後可見範圍', '家庭共享；目前只限你查看，確認後按家庭權限共享。'), 'account-group-outline');
  for (const label of ['Unknown safety constraint', 'constructor', 'toString', '__proto__']) assert.equal(proposalDetailIcon(label), null);
});
