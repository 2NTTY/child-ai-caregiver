import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { harness } from './scope-transition-harness.mjs';

// Actual /care composition, review workspace, saved list, proposal renderer and agent owner.
// Only route/context, host controls, motion and API transport are synthetic. No real writes/model.
const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), modules = new Map();
function loadOwner(file) {
  file = path.resolve(root, file); if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!name.startsWith('.')) return require(name);
    const target = path.resolve(path.dirname(file), name); return loadOwner(existsSync(target) ? target : target + '.ts');
  }, module, module.exports); return module.exports;
}
const { ProductAgentOwner } = loadOwner('frontend/src/production/ProductAgentOwner.ts');
const { ProductAgentApiError } = loadOwner('src/client/product-agent-api.ts');
const at = '2026-10-22T00:00:00Z', later = '2099-01-01T00:00:00Z';
const proposal = (id = 'a', patch = {}) => ({ id, runId: 'run-a', childId: 'child-a', version: 1, kind: 'memory_fact', status: 'pending', createdAt: at, expiresAt: later, result: null,
  value: { kind: 'memory_fact', key: `Synthetic ${id}`, content: `Synthetic exact content ${id}`, intendedVisibility: 'private', validUntil: null }, ...patch });
const result = proposals => ({ runId: 'run-a', status: 'completed', text: 'Long synthetic run answer must not appear in proposal details', proposals,
  citations: [], tools: [], retrievalMode: 'not_used', counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 } });
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(initial = [proposal()], { width = 1024, customBackground = false } = {}) {
  const calls = [], mocks = {}, h = harness(mocks); let run = result(initial), page = { proposals: initial, nextCursor: null }, decision, readFailure, careRecovery = null, writeBlocked = false;
  const api = { getPendingProposals: async (...args) => { calls.push(['pending', ...args]); if (readFailure) throw readFailure; return page; },
    getRun: async (...args) => { calls.push(['get', ...args]); return run; },
    decideProposal: async (...args) => { calls.push(['decide', ...args]); if (decision) return decision(...args);
      const saved = { ...run.proposals.find(p => p.id === args[2]), status: args[3].decision === 'accept' ? 'accepted' : 'dismissed', version: 2,
        result: args[3].decision === 'accept' ? { kind: 'memory_fact', id: 'saved-fact', version: 1 } : null };
      run = result(run.proposals.map(p => p.id === saved.id ? saved : p)); page = { ...page, proposals: page.proposals.filter(p => p.id !== saved.id) }; return saved; } };
  const owner = new ProductAgentOwner('/api', true, () => {}, () => {}, () => api);
  owner.syncContext({ key: 'scope-a', childId: 'child-a', userId: 'synthetic-parent' }, true, { identityKey: 'synthetic-parent' });
  let id = 0; mocks.react = { ...h.react, useId: () => h.react.useRef(`care-${++id}`).current };
  mocks['react-native'] = { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: x => x } };
  for (const name of ['../theme', '../../theme']) mocks[name] = { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: {}, readingType: {}, workspaceType: {} };
  for (const prefix of ['./', '../', '../components/']) for (const name of ['AppIcon', 'AppStatusBadge', 'AppCheckbox', 'StatusAnnouncement']) mocks[prefix + name] = { [name]: name };
  const ui = { AppButton: 'Button', SectionCard: 'SectionCard', AppTabPanel: 'TabPanel', UnderlineTabs: 'Tabs', AppSelect: 'Select', AppTextField: 'Field' };
  mocks['../ui'] = ui; mocks['../components/ui'] = ui;
  mocks['../components/PageFrame'] = { PageFrame: 'PageFrame' }; mocks['../PageFrame'] = { PageFrame: 'PageFrame' };
  mocks['../appearance/BackgroundSurface'] = { BackgroundSurface: 'Surface', useCustomBackground: () => customBackground }; mocks['./appearance/BackgroundSurface'] = { BackgroundSurface: 'Surface' };
  mocks['../OperationNotice'] = { OperationNotice: p => p.visible && p.state !== 'none' ? h.jsx('Notice', p) : null };
  mocks['../useContainerWidth'] = { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
  mocks['../FormDialog'] = { FormDialog: p => p.visible ? h.jsx('FormDialog', p) : null };
  for (const name of ['CareRecordForm', 'CareRecordDetail', 'CareRecordDelete', 'CareCaptureDetail']) mocks['./' + name] = { [name]: name };
  mocks['../../motion'] = { MotionDisclosure: p => p.expanded ? h.jsx('Disclosure', p) : null, MotionFeedback: p => h.jsx('Feedback', p), MotionReveal: p => h.jsx('Reveal', { children: p.children(p.value) }) };
  mocks['../chat/ChatMessage'] = { ChatMessage: 'ChatMessage' };
  mocks['../components/AppScrollView'] = { AppScrollView: 'ScrollView' };
  mocks['../components/AppDialog'] = { AppDialog: Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Actions: 'Actions' }) };
  mocks['expo-router'] = { usePathname: () => '/care', useLocalSearchParams: () => ({}), useRouter: () => ({ push() {} }) };
  mocks['../preview/PreviewNavigationGuard'] = { usePreviewNavigation: () => action => action(), usePreviewLeaveGuard() {} };
  mocks['../production/CareProfileDomains'] = { useProductionCareProfile: () => careRecovery };
  mocks['../production/useDomainEnvironment'] = { useDomainEnvironment: () => ({ canStartWrite: () => !writeBlocked }) };
  mocks['./photosScreen'] = { PhotoWorkspace: 'Photos' };
  const care = { scopeKey: 'scope-a', child: { id: 'child-a', name: 'Synthetic child' }, online: true, access: 'editable', operation: { state: 'none', message: '' }, draft: null, detail: null, deletion: null,
    list: { state: 'ready', hasSnapshot: true, records: [], activeQuery: '', activeKind: 'all', hasMore: false, hasPrevious: false, message: null },
    review: { state: 'ready', scopeKey: 'scope-a', items: [], hasMore: false, label: '' } };
  mocks['../workspaces/CareWorkspace'] = { useCareWorkspace: () => ({ scopeKey: 'scope-a', model: care, actions: { closePanel() {}, startCreate() { calls.push(['care-create']); } } }) };
  const CarePage = h.load('src/screens/careScreen.tsx').default;
  const render = () => { const snapshot = owner.getSnapshot(); h.production({ scopeKey: 'scope-a', selectedChildId: 'child-a', online: snapshot.model.online,
    model: { selectedChildId: 'child-a', children: [{ id: 'child-a' }] }, actions: {}, agentPending: snapshot.pending, agentModel: snapshot.model,
    agentActions: { refresh: owner.refresh, decide: owner.decide, retryOriginal: owner.retryOriginal, setSharedConfirmation: owner.setSharedConfirmation, openSource() {} },
    readAgentPending: owner.readPending, selectAgentRun: owner.selectRun }); h.render(h.jsx(CarePage, {})); };
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);
  const text = () => h.hosts().filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).filter(x => typeof x === 'string' || typeof x === 'number').join(' ');
  const tabs = () => h.hosts().find(n => n.type === 'Tabs');
  const card = (id = 'a') => h.node(`care-pending-card-run-a-${id}`);
  const dialog = () => h.hosts().find(n => n.props.accessibilityLabel === '核對事項詳情');
  return { h, owner, calls, render, card, button, text, tabs, dialog, care,
    careRecovery(value) { careRecovery = value; }, writeBlocked(value) { writeBlocked = value; }, page(value) { page = value; }, run(value) { run = value; }, decision(value) { decision = value; }, failure(value) { readFailure = value; },
    async ready() { render(); await settle(); render(); }, async open(id = 'a') { card(id).props.onPress(); await settle(); render(); },
    end() { h.unmount(); owner.dispose(); } };
}

test('composed /care uses real pending cards inside the pending panel, never the empty saved review or a second run list', async () => {
  const s = setup(); await s.ready(); assert.equal(s.care.review.items.length, 0); assert.ok(s.card());
  assert.equal(s.tabs().props.items[0].count, '1'); assert.match(s.text(), /Synthetic exact content a/); assert.doesNotMatch(s.text(), /暫無待確認記錄|助手待確認事項/);
  assert.equal(s.button('查看結果'), undefined); assert.equal(s.button('查看所選結果'), undefined);
  assert.equal(s.h.hosts().filter(n => n.props.testID === 'care-agent-pending').length, 1);
  assert.doesNotMatch(s.text(), /只限你本人|已載入/); assert.match(s.text(), /本人/);
  assert.equal(s.h.node('care-pending-grid').props.style.flexWrap, 'wrap'); assert.equal(s.card().props.style({ pressed: false })[0].maxWidth, 420);
  s.tabs().props.onChange('recorded'); s.render(); assert.equal(s.card(), undefined); assert.equal(s.h.node('care-agent-pending'), undefined); assert.match(s.text(), /暫無已保存記錄/);
  s.tabs().props.onChange('pending'); await s.ready(); assert.ok(s.card()); assert.equal(s.h.hosts().filter(n => n.props.testID === 'care-agent-pending').length, 1); s.end();
});

test('same-run cards bind an exact target, omit long run/other proposals, and return focus to the clicked composite key', async () => {
  const s = setup([proposal('a'), proposal('b')]); await s.ready(); let focus = '';
  for (const id of ['a', 'b']) s.card(id).props.ref({ isConnected: true, matches: () => true, focus() { focus = id; } });
  await s.open('b'); assert.ok(s.h.node('agent-proposal-b')); assert.equal(s.h.node('agent-proposal-a'), undefined);
  assert.equal(s.h.hosts().some(n => n.type === 'ChatMessage'), false); assert.doesNotMatch(s.text(), /Long synthetic run answer/);
  assert.equal(s.h.hosts().some(n => n.type === 'AppStatusBadge' && n.props.label === '已結束'), false); assert.equal(s.button('更新'), undefined);
  assert.doesNotMatch(s.h.hosts().find(n => n.type === 'StatusAnnouncement').props.message, /已結束/);
  s.button('關閉結果').props.onPress(); s.render(); s.dialog().props.onClosed(); assert.equal(focus, 'b');
  await s.open('a'); assert.ok(s.h.node('agent-proposal-a')); assert.equal(s.h.node('agent-proposal-b'), undefined);
  s.button('關閉結果').props.onPress(); s.render(); s.dialog().props.onClosed(); assert.equal(focus, 'a'); s.end();
});

test('missing, older-version and wrong-kind/scope selected proposals cannot fall back to a sibling or run body', async () => {
  for (const patch of [null, { version: 0 }, { value: { kind: 'memory_fact', key: 'Changed', content: 'Changed', intendedVisibility: 'family', validUntil: null } },
    { targetVisibility: 'private', value: { kind: 'memory_fact_deactivate', factId: 'fact', expectedVersion: 1, reason: 'Synthetic mismatch' } }]) {
    const s = setup([proposal('a'), proposal('b')]); await s.ready(); s.run(result([...(patch ? [proposal('a', patch)] : []), proposal('b')])); await s.open();
    assert.equal(s.h.node('agent-proposal-a'), undefined); assert.equal(s.h.node('agent-proposal-b'), undefined); assert.match(s.text(), /不會改為展示另一項/);
    assert.equal(s.h.hosts().some(n => n.type === 'ChatMessage'), false); s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false); s.end();
  }
});

test('accepted and dismissed use true owner receipts; a 405 stays failed without success or duplicate POST', async () => {
  for (const action of ['確認資料', '略過']) {
    const s = setup(); await s.ready(); await s.open(); s.button(action).props.onPress(); await settle(); s.render();
    assert.equal(s.owner.getSnapshot().model.run.proposals[0].status, action === '確認資料' ? 'accepted' : 'dismissed');
    assert.equal(s.owner.getSnapshot().model.pendingDecision, null); assert.equal(s.card(), undefined); assert.match(s.text(), /Server 已確認/);
    assert.equal(s.calls.filter(c => c[0] === 'decide').length, 1); s.end();
  }
  const s = setup(); s.decision(async () => { throw new ProductAgentApiError(405); }); await s.ready(); await s.open(); s.button('確認資料').props.onPress(); await settle(); s.render();
  assert.match(s.text(), /未接受成功/); assert.doesNotMatch(s.text(), /Server 已確認接受/); assert.ok(s.card()); assert.equal(s.owner.getSnapshot().model.pendingDecision, null); s.end();
});

test('unknown remains reachable when discovery loses its card; close/remount/recovery only reads the original tuple', async () => {
  const s = setup(); s.decision(async () => { throw new Error('Synthetic transport loss'); }); await s.ready(); await s.open(); s.button('確認資料').props.onPress(); await settle(); s.render();
  const original = s.owner.getSnapshot().model.pendingDecision; assert.ok(original); assert.ok(s.button('重新確認'));
  const recoveryGets = s.calls.filter(c => c[0] === 'get').length; s.button('重新確認').props.onPress(); await settle(); s.render();
  assert.equal(s.calls.filter(c => c[0] === 'get').length, recoveryGets + 1); assert.equal(s.calls.filter(c => c[0] === 'decide').length, 1);
  const reviewed = s.owner.getSnapshot().model.pendingDecision; assert.equal(reviewed.reviewed, true); assert.deepEqual(reviewed.input, original.input);
  // Simulate a safe discovery snapshot that no longer contains this unknown operation.
  s.owner.snapshot = { ...s.owner.getSnapshot(), pending: { state: 'ready', hasSnapshot: true, entries: [], nextCursor: null } }; s.render();
  s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false); assert.ok(s.button('查核原決定'));
  s.h.unmount(); s.render(); assert.equal(s.owner.getSnapshot().model.pendingDecision, reviewed); assert.doesNotMatch(s.text(), /暫無可確認事項/);
  const before = s.calls.filter(c => c[0] === 'get').length; s.button('查核原決定').props.onPress(); await settle(); s.render();
  assert.equal(s.calls.filter(c => c[0] === 'get').length, before + 1); assert.equal(s.calls.filter(c => c[0] === 'decide').length, 1);
  assert.equal(s.owner.getSnapshot().model.pendingDecision.proposalId, original.proposalId); s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false); s.end();
});

test('unread/loading/error/partial/expired are honest and only confirmable loaded proposals count', async () => {
  const s = setup(); s.render(); assert.equal(s.tabs().props.items[0].count, undefined); assert.doesNotMatch(s.text(), /暫無可確認事項/); await settle(); s.render();
  s.failure(new Error('Synthetic failed page')); await s.owner.readPending(); s.render(); assert.equal(s.tabs().props.items[0].count, undefined); assert.ok(s.card()); assert.match(s.text(), /數量尚未核對/);
  s.failure(null); s.page({ proposals: [proposal('expired', { status: 'expired' }), proposal('elapsed', { expiresAt: at })], nextCursor: 'more' }); await s.owner.readPending(); s.render();
  assert.equal(s.tabs().props.items[0].count, '0+'); assert.match(s.text(), /只計已載入可確認項；還有更多/); assert.equal((s.text().match(/還有更多/g) ?? []).length, 1);
  assert.equal(s.card('expired'), undefined); assert.equal(s.card('elapsed'), undefined); assert.ok(s.button('載入較早待確認事項'));
  assert.equal(s.owner.getSnapshot().pending.entries.length, 2, 'expired proposals remain in the owner, never disguised as pending cards');
  s.page({ proposals: [proposal('a')], nextCursor: 'more' }); await s.owner.readPending(); s.render();
  assert.equal(s.tabs().props.items[0].count, '1+'); assert.ok(s.card()); assert.match(s.text(), /只計已載入可確認項；還有更多/);
  assert.doesNotMatch(s.tabs().props.items[0].count, /已載入/); assert.doesNotMatch(s.text(), /全量|總數/); s.end();
});


test('unknown original GET remains reachable under a write-only gate while every new decision stays blocked', async () => {
  const s = setup(); s.decision(async () => { throw new Error('Synthetic transport loss'); }); await s.ready(); await s.open(); s.button('確認資料').props.onPress(); await settle(); s.render();
  const original = s.owner.getSnapshot().model.pendingDecision; s.button('關閉結果').props.onPress(); s.render();
  s.owner.setWritesBlocked(true); s.owner.snapshot = { ...s.owner.getSnapshot(), pending: { state: 'ready', hasSnapshot: true, entries: [], nextCursor: null } }; s.render();
  assert.equal(s.button('查核原決定').props.disabled, false); const gets = s.calls.filter(c => c[0] === 'get').length;
  s.button('查核原決定').props.onPress(); await settle(); s.render(); assert.equal(s.calls.filter(c => c[0] === 'get').length, gets + 1);
  assert.deepEqual(s.owner.getSnapshot().model.pendingDecision.input, original.input);
  assert.equal(s.button('確認資料').props.disabled, true); assert.equal(s.button('略過').props.disabled, true);
  s.owner.decide(original.proposalId, 'accept'); s.owner.retryOriginal(); assert.equal(s.calls.filter(c => c[0] === 'decide').length, 1);
  s.button('關閉結果').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false); s.end();
});


test('unknown read recovery never bypasses a care draft, deletion or care recovery gate', async () => {
  const s = setup(); s.decision(async () => { throw new Error('Synthetic transport loss'); }); await s.ready(); await s.open(); s.button('確認資料').props.onPress(); await settle(); s.render();
  s.button('關閉結果').props.onPress(); s.render(); s.owner.setWritesBlocked(true);
  s.owner.snapshot = { ...s.owner.getSnapshot(), pending: { state: 'ready', hasSnapshot: true, entries: [], nextCursor: null } }; s.render();
  const before = s.calls.filter(c => c[0] === 'get').length;
  for (const gate of ['draft', 'deletion', 'recovery']) {
    s.care.draft = gate === 'draft' ? { key: 'synthetic-care-draft', mode: 'create' } : null;
    s.care.deletion = gate === 'deletion' ? { recordId: 'synthetic-record' } : null;
    s.careRecovery(gate === 'recovery' ? { pending: true } : null); s.render();
    assert.equal(s.button('查核原決定').props.disabled, true, gate);
    s.button('查核原決定').props.onPress(); s.render(); assert.equal(s.dialog().props.visible, false, gate);
    assert.equal(s.calls.filter(c => c[0] === 'get').length, before); assert.equal(s.calls.filter(c => c[0] === 'decide').length, 1);
  }
  s.care.draft = null; s.care.deletion = null; s.careRecovery(null); s.render(); assert.equal(s.button('查核原決定').props.disabled, false);
  s.end();
});


test('proposal-only details keep abnormal read and run recovery without unrelated run metadata', async () => {
  const s = setup(); s.run({ ...result([proposal()]), tools: [{ name: 'unrelated-tool', status: 'failed' }], retrievalMode: 'keyword_degraded' });
  await s.ready(); await s.open(); assert.ok(s.h.node('agent-proposal-a')); assert.equal(s.h.node('agent-run-problems'), undefined);
  assert.equal(s.button('更新'), undefined); assert.equal(s.button('讀取原運行並核對'), undefined); assert.doesNotMatch(s.text(), /檢索已降級/);
  for (const status of ['running', 'unknown', 'stopped']) {
    s.run({ ...result([proposal()]), status }); await s.owner.refresh(); s.render();
    assert.ok(s.button(status === 'unknown' ? '讀取原運行並核對' : '更新'), status);
    assert.equal(s.h.hosts().some(n => n.type === 'AppStatusBadge' && n.props.label === '已結束'), false);
    if (status === 'unknown') assert.match(s.text(), /本次運行結果未知/);
    if (status === 'running') assert.match(s.text(), /仍在處理/);
  }
  s.owner.snapshot = { ...s.owner.getSnapshot(), model: { ...s.owner.getSnapshot().model, readState: 'failed' } }; s.render();
  assert.ok(s.button('重試讀取結果')); assert.match(s.text(), /未能讀取運行結果/); s.end();
});

test('narrow Care toolbar alone reclaims the custom-background inset and keeps the manual action guarded and touch-sized', async () => {
  const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  for (const [width, customBackground, inset, gap] of [[203, true, -16, 4], [203, false, undefined, 4], [1024, true, undefined, 8]]) {
    const s = setup([proposal()], { width, customBackground }); await s.ready();
    const bar = flatten(s.h.node('care-review-tabs-bar').props.style);
    assert.equal(bar.flexDirection, 'row'); assert.equal(bar.gap, gap); assert.equal(bar.marginHorizontal, inset);
    assert.equal(flatten(s.h.node('care-review-list').props.style).marginHorizontal, undefined);
    const manual = s.h.node('care-manual-create'); assert.ok(manual.props.ref);
    assert.equal(manual.props.accessibilityLabel, '手動新增共享記錄'); assert.equal(manual.props.disabled, false);
    assert.equal(flatten(manual.props.style({ pressed: false })).minHeight, 48);
    assert.equal(flatten(manual.props.style({ pressed: false })).paddingHorizontal, 4);
    manual.props.onPress(); assert.equal(s.calls.filter(call => call[0] === 'care-create').length, 1);
    s.care.online = false; s.render(); assert.equal(s.h.node('care-manual-create').props.disabled, true);
    s.care.online = true; s.writeBlocked(true); s.render(); assert.equal(s.h.node('care-manual-create').props.disabled, true);
    s.writeBlocked(false); s.careRecovery({ pending: true }); s.render(); assert.equal(s.h.node('care-manual-create').props.disabled, true);
    s.careRecovery(null); s.care.access = 'readonly'; s.render(); assert.equal(s.h.node('care-manual-create'), undefined);
    assert.equal(flatten(s.h.node('care-review-tabs-bar').props.style).marginHorizontal, undefined); s.end();
  }
});
