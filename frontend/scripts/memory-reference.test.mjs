import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryFixture } from '../src/preview/memory-fixture.ts';
import * as projections from '../src/memory-reference-view-model.ts';
import * as memory from '../src/memory-view-model.ts';

const require = createRequire(import.meta.url);
const scopeKey = 'server:user:child:owner';
function snapshot() {
  const { data } = createMemoryFixture('child');
  const absent = { scopeKey, state: 'unavailable', asOf: null, revision: null, data: null };
  return { scopeKey, model: { scopeKey, childId: 'child', childName: 'Test child', access: 'active', online: true,
    shortTerm: absent, references: absent, longTerm: { scopeKey, state: 'ready', revision: 'memory-r1', asOf: null, data: {
      childId: 'child', facts: data.facts, hasMoreFacts: false, summary: data.summary,
      histories: Object.fromEntries(data.facts.map(fact => [fact.id, { factVersion: fact.version, state: 'ready', items: data.factVersions[fact.id], hasMore: false }])),
    } } } };
}
function compile(relative, dependencies) {
  const filename = new URL(relative, import.meta.url);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(dependencies, module, module.exports);
  return module.exports;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const next of Object.values(value)) freeze(next); }
  return value;
}
function renderView(workspace, { tab = 'long', expanded = false, onPrepareQuestion, tabActions } = {}) {
  const buttons = [], panels = [], tabLists = [];
  const nativeElement = tag => ({ children, accessibilityRole }) => React.createElement(tag, accessibilityRole === 'header' ? { role: 'heading' } : null, children);
  const ui = {
    AppButton: props => { buttons.push(props); return React.createElement('button', null, props.label); },
    TabToolbar: ({ children, actions }) => React.createElement('div', null, children, actions),
    AppTabPanel: props => { panels.push(props); return props.active ? React.createElement('div', null, props.children) : null; },
    SectionHeader: ({ title, subtitle }) => React.createElement('header', null, title, subtitle),
    UnderlineTabs: props => { tabLists.push(props); return React.createElement('nav', null, props.items.map(item => item.label).join(' / ')); },
  };
  const api = compile('../src/components/memory/MemoryReferenceView.tsx', name => {
    if (name === 'react') return { ...React, useState: initial => React.useState(initial === 'long' ? tab : expanded && initial === false ? true : initial) };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { View: nativeElement('div'), StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: nativeElement('span') };
    if (name === 'expo-router') return { useRouter: () => ({ push() {} }) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => ({ navigate: action => action() }) };
    if (name.endsWith('/history-view-model')) return compile('../src/history-view-model.ts', require);
    if (name.endsWith('/PersistentWorkCards')) return { PersistentWorkCards: () => null };
    if (name.endsWith('/HistoryMessageDetail')) return { HistoryMessageDetail: () => null };
    if (name === '../../memory-view-model') return memory;
    if (name === '../../memory-reference-view-model') return projections;
    if (name === '../../workspaces/MemoryReferenceWorkspace') return { useMemoryReferenceWorkspace: () => workspace };
    if (name === '../../theme') return { colors: {}, spacing: {}, radius: {}, readingType: {}, workspaceType: {} };
    if (name === '../appearance/BackgroundSurface') return { BackgroundSurface: nativeElement('div') };
    if (name === '../AppStatusBadge') return { AppStatusBadge: ({ label }) => React.createElement('span', null, label) };
    if (name === '../ReadStateNotice') return { ReadStateNotice: ({ title, message }) => React.createElement('aside', null, title, message) };
    if (name === '../EmptyListCard') return { EmptyListCard: ({ title, detail }) => React.createElement('aside', { 'data-empty': 'true' }, title, detail) };
    if (name === '../ui') return ui;
    if (name === '../useContainerWidth') return { useContainerWidth: () => ({ width: 1440, ref: null, onLayout() {} }) };
    assert.fail(`Unexpected view dependency ${name}`);
  });
  return { html: renderToStaticMarkup(React.createElement(api.MemoryReferenceView, { onPrepareQuestion, tabActions })), buttons, panels, tabLists };
}

test('memory tabs replace duplicate introductions but keep real content headings and reading boundaries', () => {
  const value = snapshot();
  value.model.dataLabel = '查看已保存記憶及來源';
  value.model.shortTerm = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { runId: 'synthetic', messages: [{ id: 'message', role: 'user', text: 'Synthetic saved context' }] } };
  value.model.references = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { audience: 'public', items: [], catalog: [], hasMore: false } };
  for (const tab of ['short', 'long', 'references']) {
    const { html, panels, tabLists } = renderView(freeze(value), { tab, tabActions: React.createElement('button', null, '重讀') });
    assert.doesNotMatch(html, /Test child的記憶與參考|查看已保存記憶及來源|Agent 已保存的工作、待答問題及相關訊息|已保存的事實、來源及對話摘要|查看目前可查閱的公共來源目錄|查看資料出處、日期及適用範圍/);
    assert.equal((html.match(/長期記憶/g) ?? []).length, 1);
    assert.equal((html.match(/參考資料/g) ?? []).length, 1);
    assert.match(html, /<button>重讀<\/button>/);
    assert.equal(tabLists.length, 1); assert.equal(tabLists[0].label, '記憶與參考分類');
    assert.deepEqual(tabLists[0].items.map(item => item.key), ['short', 'long', 'references']);
    assert.deepEqual(panels.filter(panel => panel.active).map(panel => panel.tabKey), [tab]);
    assert.ok(panels.every(panel => panel.tabsId === tabLists[0].id));
    if (tab === 'long') {
      assert.match(html, /role="heading">已確認事實</); assert.match(html, /對話摘要|睡前觀察/);
    } else if (tab === 'short') {
      assert.match(html, /Synthetic saved context/); assert.match(html, /不代表已確認的事實/);
    } else {
      assert.match(html, /role="heading">官方指引</); assert.match(html, /role="heading">近期資訊</);
      assert.match(html, /未逐項判定適用於這位孩子；來源存在亦不代表支持某句回答/);
    }
  }
});

test('read provider passes the exact owner value and masks all scope, child and access mismatches', () => {
  const api = compile('../src/workspaces/MemoryReferenceWorkspace.tsx', name => {
    if (name === '../memory-reference-view-model') return projections;
    assert.ok(['react', 'react/jsx-runtime'].includes(name), `Forbidden owner dependency ${name}`);
    return require(name);
  });
  const seen = [];
  function Consumer() { seen.push(api.useMemoryReferenceWorkspace()); return null; }
  const first = snapshot(), second = { ...first, model: { ...first.model, longTerm: { ...first.model.longTerm, revision: 'memory-r2' } } };
  function render(value, key = scopeKey) { seen.length = 0; renderToStaticMarkup(React.createElement(api.MemoryReferenceWorkspaceProvider, { scopeKey: key, value }, React.createElement(Consumer), React.createElement(Consumer))); }
  render(first); assert.equal(seen[0], first); assert.equal(seen[1], first);
  assert.equal(seen[0].model.longTerm.data.facts, first.model.longTerm.data.facts);
  render(second); assert.equal(seen[0], second);
  for (const key of ['other-server:user:child:owner', 'server:other-user:child:owner', 'server:user:other-child:owner', 'server:user:child:viewer', '']) { render(first, key); assert.deepEqual(seen, [null, null]); }
  for (const field of ['shortTerm', 'longTerm', 'references']) { const bad = snapshot(); bad.model[field] = { ...bad.model[field], scopeKey: 'old' }; render(bad); assert.equal(seen[0], null); }
  const wrongChild = snapshot(); wrongChild.model.longTerm.data.childId = 'other-child'; render(wrongChild); assert.equal(seen[0], null);
  const revoked = snapshot(); revoked.model.access = 'revoked'; render(revoked); assert.equal(seen[0], null);
  render(null); assert.equal(seen[0], null);
});

test('facts and history retain original IDs, versions and provenance without status-based short/long inference', () => {
  const value = snapshot(), data = value.model.longTerm.data;
  const facts = projections.visibleMemoryFacts(value.model);
  assert.deepEqual(facts.map(fact => fact.status), ['candidate', 'confirmed', 'confirmed', 'inactive']);
  assert.ok(facts.every((fact, index) => fact === data.facts[index]));
  assert.equal(value.model.shortTerm.state, 'unavailable'); assert.equal(value.model.shortTerm.data, null);
  const fact = facts.find(fact => fact.id.endsWith('-private'));
  const versions = projections.visibleMemoryHistory(value.model, fact);
  assert.equal(versions[0], data.histories[fact.id].items[0]);
  assert.notEqual(versions[0].confirmedBy, versions[1].confirmedBy);
  assert.deepEqual(projections.visibleMemoryHistory(value.model, { ...fact, version: 9 }), []);
  data.histories[fact.id].items.push({ ...fact, childId: 'other-child' }, { ...fact, id: 'other-fact' }, { ...fact, version: 99 });
  assert.equal(projections.visibleMemoryHistory(value.model, fact).length, 2);
  data.facts.push({ ...fact, childId: 'other-child' }); assert.equal(projections.visibleMemoryFacts(value.model).length, 4);
});

test('public knowledge is fail-closed for internal or missing use scope and never gains invented dates', () => {
  const publicSource = { sourceId: 'canonical-source', versionId: 'original-v3', chunkId: 'original-chunk', usageScope: 'public_noncommercial' };
  const internal = { ...publicSource, sourceId: 'internal-source', usageScope: 'internal_noncommercial' };
  const unknown = { ...publicSource, sourceId: 'unknown-source', usageScope: undefined };
  const read = { scopeKey, state: 'ready', revision: 'knowledge-r1', asOf: null, data: { audience: 'public', items: [publicSource, internal, unknown], hasMore: false } };
  const visible = projections.visibleKnowledgeReferences(read);
  assert.deepEqual(visible, [publicSource]); assert.equal(visible[0], publicSource);
  assert.deepEqual(projections.visibleKnowledgeReferences({ ...read, data: { ...read.data, audience: 'internal' } }), [publicSource, internal]);
  assert.deepEqual(projections.visibleKnowledgeReferences({ ...read, state: 'unavailable', data: null }), []);
  assert.equal(projections.memoryDateLabel(null), '未提供');
  assert.equal(projections.memoryDateLabel('2026-09'), '2026-09');
  assert.equal(projections.memoryDateLabel('九月下旬，發布日期待核對'), '九月下旬，發布日期待核對');
});

test('all long-term disclosures remain read-only and clarification only hands an unsent question to the existing draft route', () => {
  const value = freeze(snapshot()), before = JSON.stringify(value), questions = [];
  const { html, buttons } = renderView(value, { expanded: true, onPrepareQuestion: question => questions.push(question) });
  assert.match(html, /長期記憶/); assert.match(html, /睡前觀察/); assert.match(html, /對話摘要/);
  assert.match(html, /確認者/); assert.match(html, /確認時間/); assert.match(html, /版本 1/);
  assert.doesNotMatch(html, /對話話題|核對及管理/);
  assert.doesNotMatch(html, /<button>(新增候選|更正內容|核對及確認|刪除話題|停用|刪除)<\/button>/);
  assert.ok(buttons.every(button => !/^(新增|更正|停用|刪除|確認|重新核對及確認)/.test(button.label)));
  assert.equal(questions.length, 0);
  const clarify = buttons.find(button => button.label === '請 Agent 核對'); assert.ok(clarify); clarify.onPress();
  assert.equal(questions.length, 1); assert.match(questions[0], /先與我釐清疑問/); assert.match(questions[0], /不要直接更改記憶/);
  assert.equal(JSON.stringify(value), before);
  const screen = fs.readFileSync(new URL('../src/screens/memoryScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /onPrepareQuestion=\{actions\.prepareQuestion\}/);
  const draftRoute = fs.readFileSync(new URL('../src/production/ProductionProvider.tsx', import.meta.url), 'utf8');
  const prepareQuestion = draftRoute.match(/prepareQuestion\(question\) \{([\s\S]*?)\n    \},/)?.[1];
  assert.ok(prepareQuestion, 'The current production draft action must remain present');
  assert.match(prepareQuestion, /if \(!currentScope\(\)\) return;/);
  assert.match(prepareQuestion, /if \(chatDraft\?\.text\.trim\(\)\) setLocalNotice/);
  assert.match(prepareQuestion, /else owner\.chatController\.setText\(question\)/);
  assert.match(prepareQuestion, /openAgentDraft\(true\)/);
  assert.doesNotMatch(prepareQuestion, /sendMessage|\.submit\(|\.send\(/);
});

test('missing read ports, denied access and summary-null have honest visible states', () => {
  const value = snapshot();
  const short = renderView(value, { tab: 'short' }).html;
  assert.match(short, /目前工作脈絡暫未提供/); assert.doesNotMatch(short, /週末照顧安排|睡前觀察/);
  const references = renderView(value, { tab: 'references' }).html;
  assert.equal((references.match(/參考來源暫未提供/g) ?? []).length, 1);
  assert.doesNotMatch(references, /暫無可顯示來源|官方指引|近期資訊/);
  assert.doesNotMatch(references, /已接通|即時新聞|共有 0|已驗證/);
  value.model.longTerm.data.summary = null;
  assert.match(renderView(value).html, /目前沒有可用摘要/);
  assert.doesNotMatch(renderView(value).html, /已清空|已遺忘/);
  assert.doesNotMatch(renderView(null).html, /睡前觀察|本人觀察筆記/);
  const hidden = { ...value, model: { ...value.model, longTerm: { scopeKey, state: 'loading', revision: null, asOf: null, data: null } } };
  assert.doesNotMatch(renderView(hidden, { expanded: true }).html, /睡前觀察|本人觀察筆記/);
});

test('one scoped production memory owner and an independent preview owner keep consumers read-only', () => {
  const owner = fs.readFileSync(new URL('../src/preview/MemoryReferenceWorkspaceProvider.tsx', import.meta.url), 'utf8');
  assert.equal((owner.match(/useMemoryPreview\(/g) ?? []).length, 1);
  assert.match(owner, /facts: owner\.factsPage\.items/); assert.match(owner, /summary: owner\.data\.summary/);
  assert.doesNotMatch(owner, /useSourcesPreview|setData\(|beginFact|beginTopic|\.submit\(/);
  const layout = fs.readFileSync(new URL('../app/(dashboard)/_layout.tsx', import.meta.url), 'utf8');
  assert.equal((layout.match(/<ProductionDomains>/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /preview\/MemoryReferenceWorkspaceProvider/);
  const domains = fs.readFileSync(new URL('../src/production/ProductionDomains.tsx', import.meta.url), 'utf8');
  assert.equal((domains.match(/<ProductionTaskKnowledgeDomains>/g) ?? []).length, 1);
  const connected = fs.readFileSync(new URL('../src/production/TaskKnowledgeDomains.tsx', import.meta.url), 'utf8');
  assert.equal((connected.match(/useTaskKnowledgeMemory\(env, history\)/g) ?? []).length, 1);
  assert.equal((connected.match(/<MemoryReferenceWorkspaceProvider\s/g) ?? []).length, 1);
  assert.match(connected, /snapshot\.scopeKey === env\.scopeKey \? snapshot : null/);
  assert.match(connected, /<MemoryReferenceWorkspaceProvider scopeKey=\{env\.scopeKey\} value=\{current\?\.memory\.value \?\? null\}>/);
  for (const filename of ['../src/screens/memoryScreen.tsx', '../src/components/memory/MemoryReferenceView.tsx', '../src/workspaces/MemoryReferenceWorkspace.tsx']) {
    const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /useMemoryPreview|useSourcesPreview|MemoryEditorPanel|MemoryTopicList|beginFact|beginTopic|applyMemoryPreviewWrite|\.submit\(/);
  }
  const view = fs.readFileSync(new URL('../src/components/memory/MemoryReferenceView.tsx', import.meta.url), 'utf8');
  assert.match(view, /usePreviewNavigation/);
  assert.doesNotMatch(view, /preview\/(?:MemoryReferenceWorkspaceProvider|useMemoryPreview|useSourcesPreview)/);
  assert.equal((connected.match(/usePersonalHistory\(env\)/g) ?? []).length, 1);
  assert.match(view, /current\.current !== workspace/);
});

test('authorized reference cards display original source metadata while excluded sources stay hidden', () => {
  const value = snapshot();
  const source = { sourceId: 'test-only-source', versionId: 'test-version-7', chunkId: 'test-chunk-2', versionHash: 'test-version-hash', contentHash: 'test-content-hash',
    title: 'Unit-test source title', publisher: 'Unit-test publisher', url: 'https://example.invalid/unit-test-only', classification: 'official_guidance',
    section: 'Unit-test section', sourceExcerpt: 'Unit-test excerpt, not a real recommendation', sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: '2026-09',
    validUntil: null, fetchedAt: '2026-09-28T01:00:00Z', checkedAt: '2026-09-28T02:00:00Z', lastSuccessfulCheckAt: null, usageScope: 'public_noncommercial', reviewState: 'reviewed',
    applicability: { region: 'HK', ageBasis: 'actual', minAgeMonths: 12, maxAgeMonths: 24, maxAgeMonthsExclusive: true, topics: ['test-only'], conditions: ['Unit-test condition'] } };
  value.model.references = { scopeKey, state: 'ready', revision: 'knowledge-r7', asOf: null, data: { audience: 'public', hasMore: false,
    items: [source, { ...source, sourceId: 'restricted', title: 'Internal source must stay hidden', usageScope: 'internal_noncommercial' }] } };
  const { html, buttons } = renderView(freeze(value), { tab: 'references', expanded: true });
  for (const text of [source.title, source.publisher, source.sourceExcerpt, source.versionId, source.chunkId, source.sourceId, source.versionHash, source.contentHash, '來源日期：2026-09', '發布時間：未提供', '最近成功取得：未提供', '不含上限']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Internal source must stay hidden|已驗證|可靠度/);
  assert.ok(buttons.every(button => /來源|版本/.test(button.label)));
});

test('an explicitly supplied run context is displayed verbatim without expanding from long-term facts', () => {
  const value = snapshot();
  const message = { id: 'same-owner-message', role: 'user', text: 'Unit-test supplied run context' };
  value.model.shortTerm = { scopeKey, state: 'ready', revision: 'run-revision-1', asOf: null, data: { runId: 'same-owner-run', messages: [message] } };
  const { html } = renderView(freeze(value), { tab: 'short' });
  assert.match(html, /Unit-test supplied run context/); assert.doesNotMatch(html, /睡前觀察|週末照顧安排/);
  assert.equal(value.model.shortTerm.data.messages[0], message);
});

test('successful empty lists are cards, while stale and offline memory snapshots never claim absence', () => {
  const value = snapshot();
  value.model.longTerm.data.facts = [];
  value.model.longTerm.data.summary = null;
  value.model.shortTerm = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { runId: 'synthetic', messages: [] } };
  value.model.references = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { audience: 'public', items: [], hasMore: true } };
  for (const tab of ['long', 'short', 'references']) assert.match(renderView(value, { tab }).html, /data-empty="true"/);
  assert.match(renderView(value, { tab: 'references' }).html, /仍有來源未載入/);
  for (const state of ['stale', 'loading', 'error', 'unavailable']) {
    const copy = structuredClone(value);
    for (const key of ['longTerm', 'shortTerm', 'references']) copy.model[key] = state === 'stale' ? { ...copy.model[key], state } : { scopeKey, state, revision: null, data: null, asOf: null };
    for (const tab of ['long', 'short', 'references']) assert.doesNotMatch(renderView(copy, { tab }).html, /data-empty="true"/);
  }
  value.model.online = false;
  for (const tab of ['long', 'short', 'references']) assert.doesNotMatch(renderView(value, { tab }).html, /data-empty="true"/);
});

test('A07 work-only context is not empty and catalog emptiness is online-ready only', () => {
  const value = snapshot();
  value.model.shortTerm = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { runId: null, messages: [], works: [{ id: 'synthetic-work', version: 1, sourceMessageIds: [] }], hasMoreWorks: false } };
  assert.doesNotMatch(renderView(value, { tab: 'short' }).html, /data-empty="true"/);
  value.model.shortTerm.data.works = [];
  assert.match(renderView(value, { tab: 'short' }).html, /data-empty="true"/);
  value.model.references = { scopeKey, state: 'ready', revision: '1', asOf: null, data: { audience: 'public', items: [], catalog: [], hasMore: true } };
  assert.match(renderView(value, { tab: 'references' }).html, /仍有來源未載入/);
  for (const state of ['stale', 'error', 'unavailable']) {
    value.model.references.state = state;
    assert.doesNotMatch(renderView(value, { tab: 'references' }).html, /data-empty="true"/);
  }
  value.model.references.state = 'ready'; value.model.online = false;
  assert.doesNotMatch(renderView(value, { tab: 'references' }).html, /data-empty="true"/);
});
