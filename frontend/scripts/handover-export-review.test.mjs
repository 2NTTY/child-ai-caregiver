import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HandoverOwner } from '../src/production/HandoverOwner.ts';
import { HandoverApiError, createHandoverApi } from '../../src/client/handover-api.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

test('export review pages bind child, scope and avatar absence while preserving explicit whole-file choices', async () => {
  const first = randomUUID(), second = randomUUID(), file = randomUUID(), snapshotId = randomUUID(), writes = [], queries = [];
  const selection = { childIds: [first, second], modules: ['documents', 'attachments'], period: { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' } };
  const item = { section: 'documents', childId: first, id: file, version: 3, snapshotId, snapshotVersion: 3,
    title: 'Whole October report', from: '2026-10-01', to: '2026-11-04', reason: 'crosses', defaultIncluded: false, canInclude: true };
  const usual = { ...item, id: randomUUID(), title: 'Usual report', from: '2026-11-01', reason: 'inside', defaultIncluded: true };
  let held;
  const api = { setIdentity() {}, async preview(_user, query) {
    queries.push(query);
    if (query.cursor === 'hold') return new Promise(resolve => { held = resolve; });
    return { items: query.childId === first && query.section === 'documents' && !query.cursor ? [item, usual] : [],
      scopeVersion: 'a'.repeat(64), nextCursor: query.childId === first && query.section === 'documents' && !query.cursor ? 'next' : null,
      ...(query.section === 'child_avatar' ? { avatarVersion: query.childId === first ? 8 : 0 } : {}) };
  }, async create(_user, command) { writes.push(command); return { id: command.opId, version: 1, state: 'queued', purpose: command.purpose,
    selection: command.selection, createdAt: '2026-11-04T00:00:00Z', expiresAt: '2026-11-05T00:00:00Z', bytes: null, error: null }; } };
  const owner = new HandoverOwner(api); owner.syncContext('owner', 'owner:1', true);
  owner.setReviewSelection(selection, 'scope:1');
  await owner.create(selection, 'handover'); assert.equal(writes.length, 0, 'initial previews are required');
  await owner.loadReview();
  assert.equal(queries.length, 12, 'only one page per selected child and relevant section');
  assert.ok(queries.slice(1).every(query => query.scopeVersion === 'a'.repeat(64)));
  assert.equal(owner.reviewReady(selection), true);
  owner.chooseReviewItem(item, true);
  owner.chooseReviewItem(usual, false);
  await owner.loadReview(first, 'documents');
  assert.equal(queries.at(-1).cursor, 'next');
  assert.equal(owner.getSnapshot().review.groups[0].items.length, 2);
  const review = owner.documentReview(selection);
  assert.deepEqual(review.choices, [{ section: 'documents', childId: first, id: file, version: 3, snapshotId, snapshotVersion: 3, include: true },
    { section: 'documents', childId: first, id: usual.id, version: 3, snapshotId, snapshotVersion: 3, include: false }]);
  assert.deepEqual(review.avatarVersions, [{ childId: first, version: 8 }, { childId: second, version: 0 }]);
  await owner.create(selection, 'handover', review);
  assert.deepEqual(writes[0].documentReview, review);
  const changed = { ...selection, period: null };
  owner.setReviewSelection(changed, 'scope:1');
  assert.equal(owner.reviewReady(changed), false); assert.deepEqual(owner.getSnapshot().review.choices, []);
  api.preview = async () => { throw new HandoverApiError(409, 'export_scope_changed'); };
  await owner.loadReview(); assert.equal(owner.reviewReady(changed), false);
  api.preview = () => new Promise(resolve => { held = resolve; });
  const old = owner.loadReview(); owner.syncContext('other', 'other:1', true);
  held({ items: [item], scopeVersion: 'a'.repeat(64), nextCursor: null }); await old;
  assert.equal(owner.getSnapshot().review, null, 'late identity-scoped previews are discarded');
});

test('export preview client validates authenticated POST scope and cursor bindings', async () => {
  const childId = randomUUID(), signal = new AbortController().signal, calls = [];
  let response = { items: [], scopeVersion: 'a'.repeat(64), nextCursor: null, avatarVersion: 0 };
  const api = createHandoverApi('https://example.test', async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json(response);
  });
  api.setIdentity('owner');
  const query = { childId, section: 'child_avatar', period: null };
  assert.equal((await api.preview('owner', query, signal)).avatarVersion, 0);
  assert.equal(calls[0].url, 'https://example.test/api/account/packages/preview');
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.credentials, 'include');
  assert.equal(new Headers(calls[0].init.headers).get('x-expected-user-id'), 'owner');
  assert.deepEqual(JSON.parse(calls[0].init.body), query);
  response = { ...response, nextCursor: 'same' };
  await assert.rejects(api.preview('owner', { ...query, cursor: 'same', scopeVersion: response.scopeVersion }, signal), { code: 'handover_response_invalid' });
  response = { ...response, nextCursor: null, scopeVersion: 'b'.repeat(64) };
  await assert.rejects(api.preview('owner', { ...query, scopeVersion: 'a'.repeat(64) }, signal), { code: 'handover_response_invalid' });
});

test('metadata-only default inclusion can be excluded and restored without an include override', async () => {
  const childId = randomUUID(), selection = { childIds: [childId], modules: ['documents'], period: null };
  const item = { section: 'documents', childId, id: randomUUID(), version: 2, snapshotId: null, snapshotVersion: null,
    title: 'Document index only', from: null, to: null, reason: 'metadata_only', defaultIncluded: true, canInclude: false };
  const owner = new HandoverOwner({ setIdentity() {}, async preview(_user, query) {
    return { items: query.section === 'documents' ? [item] : [], scopeVersion: 'a'.repeat(64), nextCursor: null };
  } });
  owner.syncContext('owner', 'owner:1', true); owner.setReviewSelection(selection); await owner.loadReview();
  owner.chooseReviewItem(item, false);
  assert.equal(owner.documentReview(selection).choices[0].include, false);
  owner.chooseReviewItem(item, true);
  assert.deepEqual(owner.documentReview(selection).choices, [], 'restoring the default never explicitly requests an unreadable original');
});

test('shared export checklist shows literal complete dates and requires loaded first pages before submission', () => {
  const require = createRequire(import.meta.url), ts = require('typescript'), id = randomUUID(), sent = [];
  let instance, reviewReady = false;
  const state = { userId: 'owner', identityKey: 'owner:1', busy: null, pending: null, items: [], review: null, reviewBusy: false };
  const controller = { subscribe() {}, getSnapshot: () => state, reviewMatches: () => true, reviewReady: () => reviewReady,
    documentReview: () => ({ scopeVersion: 'a'.repeat(64), choices: [] }), create: (...args) => sent.push(args), chooseReviewItem: (...args) => sent.push(args) };
  const production = { owner: { handoverOwner: controller }, userId: 'owner', identityKey: 'owner:1', scopeKey: 'scope:1', online: true,
    recordsState: { children: [{ id, displayName: 'Own child', accessRole: 'owner' }] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const jsx = (type, props, key) => ({ type, props, key });
  const hooks = { useState(initial) { const index = instance.cursor++; if (!(index in instance.slots)) instance.slots[index] = initial;
    return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
    useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe, get) => get() };
  const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' } : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/handover') ? { HANDOVER_MODULES: ['documents', 'attachments'], supportsHandoverPeriodModules: () => true }
    : name.endsWith('/file-export') ? { useFileExportAvailable: () => true } : name.endsWith('/date-time') ? { hongKongTimeZone: 'Asia/Hong_Kong' }
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} } : name === 'luxon' ? require(name)
    : new Proxy({}, { get: (_target, key) => String(key) });
  const module = { exports: {} }, source = readFileSync(new URL('../src/components/account/HandoverControls.tsx', import.meta.url), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
  instance = { cursor: 0, slots: [] };
  const render = () => { instance.cursor = 0; instance.tree = module.exports.HandoverControls(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
  const control = label => nodes(instance.tree).find(node => node.props?.label === label);
  render(); control('選擇要匯出的資料').props.onPress(); render(); control('Own child').props.onChange(true); render();
  control('準備單與文件').props.onChange(true); render(); assert.equal(control('建立資料包').props.disabled, true);
  const item = { section: 'documents', childId: id, id: randomUUID(), version: 2, snapshotId: randomUUID(), snapshotVersion: 2,
    title: 'Original whole file', from: '2026-10-01', to: '2026-11-04', reason: 'crosses', defaultIncluded: false, canInclude: true };
  state.review = { choices: [], groups: [{ childId: id, section: 'documents', items: [item], loaded: true, nextCursor: 'next' }] };
  reviewReady = true; render();
  assert.match(text(instance.tree), /涵蓋日期\s*：\s*2026-10-01\s*至\s*2026-11-04/);
  assert.match(text(instance.tree), /不改其他記錄、待辦或所選日期/); assert.ok(control('載入更多文件'));
  assert.equal(control(item.title).props.checked, false); control(item.title).props.onChange(true);
  assert.deepEqual(sent[0], [item, true]); assert.equal(control('建立資料包').props.disabled, false);
  control('建立資料包').props.onPress(); assert.equal(sent[1][2].scopeVersion, 'a'.repeat(64));
  const metadata = { ...item, title: 'Index only', defaultIncluded: true, canInclude: false, reason: 'metadata_only' };
  state.review.groups[0].items = [metadata]; render();
  assert.equal(control(metadata.title).props.disabled, false, 'default metadata remains reversible in the checklist');
});
