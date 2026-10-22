import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Real components and decision predicates; synthetic host/animation/data ports only.
// No network, models, production writes, browser geometry, or focus claims.
const at = '2026-10-22T00:00:00Z', later = '2099-01-01T00:00:00Z';
const proposal = (id, patch = {}) => ({ id, kind: 'task_create', title: `Synthetic ${id}`, content: `Original content ${id}`, scope: 'family',
  version: 4, status: 'pending', createdAt: at, expiresAt: later, result: null,
  details: [{ label: '負責人', value: 'Synthetic caregiver' }, { label: '將保存的內容', value: `Exact change ${id}` }, { label: '原版本', value: '3' }], ...patch });
const run = (proposals = []) => ({ id: 'synthetic-run', childId: 'synthetic-child', status: 'completed', createdAt: at,
  text: 'Original synthetic reply', stopReasonLabel: null, citations: [], tools: [], proposals, retrievalMode: 'not_used', counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 } });
function setup(initial = run()) {
  const calls = [], mocks = {};
  const h = harness(mocks);
  mocks.react = { ...h.react, useId: () => h.react.useRef('synthetic-id').current };
  const theme = { colors: {}, spacing: {}, radius: {}, readingType: {}, workspaceType: {} };
  mocks['../../theme'] = theme; mocks['../theme'] = theme;
  for (const prefix of ['../', '../components/']) for (const name of ['AppIcon', 'AppStatusBadge', 'AppCheckbox', 'ReadStateNotice', 'StatusAnnouncement']) mocks[prefix + name] = { [name]: name };
  const motion = { MotionDisclosure: p => h.jsx('Disclosure', { ...p, children: p.expanded ? p.children : null }),
    MotionFeedback: p => h.jsx('Feedback', p), MotionReveal: p => h.jsx('Reveal', { children: p.children(p.value) }) };
  mocks['../../motion'] = motion; mocks['../motion'] = motion;
  mocks['../chat/ChatMessage'] = { ChatMessage: 'ChatMessage' };
  mocks['../components/chat/chat-presentation'] = { chatColors: {}, chatType: {} };
  mocks['../components/chat/locateCitationSource'] = { locateCitationSource: (...args) => calls.push(['locate', ...args]) };
  mocks['../components/AppScrollView'] = { AppScrollView: 'ScrollView' };
  mocks['../components/AppDialog'] = { AppDialog: Object.assign('Dialog', { Title: 'Title', ScrollArea: 'ScrollArea', Actions: 'Actions' }) };
  const action = name => (...args) => calls.push([name, ...args]);
  const state = { scopeKey: 'scope-a', agentModel: { online: true, readState: 'ready', busy: null, run: initial, loadedAt: at,
    sharedConfirmed: {}, pendingDecision: null, notice: null, writesBlocked: false },
    agentActions: { refresh: action('refresh'), setSharedConfirmation(id, value) { state.agentModel.sharedConfirmed[id] = value; calls.push(['shared', id, value]); }, decide: action('decide'), retryOriginal: action('retry'), openSource: action('source') },
    agentPending: { state: 'ready', entries: [], hasSnapshot: true, nextCursor: null }, readAgentPending: action('pending'), selectAgentRun: action('select'),
    agentInbox: { online: true, locked: false, state: 'idle', loadedAt: null, entries: [], selectedRunId: null },
    agentInboxActions: { refresh: action('inbox'), select: action('inbox-select'), collapse: action('inbox-collapse') },
    authorization: { online: true, receipts: { [initial.id]: { state: 'ready', items: [] } } }, authorizationActions: { readReceipts: action('receipts') } };
  const { AgentRunView } = h.load('src/components/agent/AgentRunView.tsx');
  const { AgentConversation } = h.load('src/production/AgentConversation.tsx');
  const render = (activity = false) => h.render(h.jsx(AgentRunView, { model: state.agentModel, actions: state.agentActions, activity }));
  const conversation = (visible = true) => { h.production(state); return h.render(h.jsx(AgentConversation, { visible, onDismiss: action('close'), onClosed: action('closed') })); };
  const button = label => h.hosts().find(n => n.type === 'Button' && n.props.label === label);
  const named = name => h.hosts().find(n => n.props.accessibilityLabel === name);
  const text = () => h.hosts().filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).filter(x => typeof x === 'string' || typeof x === 'number').join(' ');
  return { h, state, calls, render, conversation, button, named, text };
}

test('pending changes precede handled results and retain exact content, destination, sharing, version and decision guards', () => {
  const accepted = proposal('handled', { status: 'accepted', result: { kind: 'task', version: 2, label: 'Original receipt' } });
  const pending = proposal('pending'), s = setup(run([accepted, pending])); s.render(true);
  assert.ok(s.h.hosts().indexOf(s.h.node('agent-pending-proposals')) < s.h.hosts().indexOf(s.h.node('agent-handled-proposals')));
  assert.match(s.text(), /Exact change pending/); assert.match(s.text(), /新增待辦/); assert.match(s.text(), /確認後按家庭權限共享/);
  assert.equal(s.button('建立待辦').props.disabled, true);
  s.h.hosts().find(n => n.type === 'AppCheckbox').props.onChange(true); s.render(true);
  assert.equal(s.button('建立待辦').props.disabled, false); s.button('建立待辦').props.onPress();
  assert.deepEqual(s.calls.at(-1), ['decide', 'pending', 'accept']);
  for (const patch of [{ online: false }, { writesBlocked: true }, { busy: 'write' }, { pendingDecision: { runId: 'synthetic-run', proposalId: 'pending', input: { expectedVersion: 4, decision: 'accept' }, reviewed: false } }]) {
    const old = s.state.agentModel; s.state.agentModel = { ...old, ...patch }; s.render(true);
    assert.equal(s.button('建立待辦').props.disabled, true); assert.equal(s.button('略過').props.disabled, true); s.state.agentModel = old;
  }
  pending.expiresAt = at; s.render(true); assert.equal(s.button('建立待辦').props.disabled, true); assert.equal(s.button('略過').props.disabled, false);
  s.button('略過').props.onPress(); assert.deepEqual(s.calls.at(-1), ['decide', 'pending', 'dismiss']);
});

test('handled results start concise, expand without a modal and never treat accepted without a receipt as saved', () => {
  const s = setup(run([proposal('handled', { status: 'accepted', result: null })])); s.render(true);
  assert.match(s.text(), /不能據此確認已保存/); assert.doesNotMatch(s.text(), /Exact change handled/);
  assert.equal(s.h.hosts().some(n => n.type === 'Dialog'), false);
  s.button('查看詳情').props.onPress(); s.render(true); assert.match(s.text(), /Exact change handled/);
  s.button('收起詳情').props.onPress(); s.render(true); assert.doesNotMatch(s.text(), /Exact change handled/);
  assert.equal(s.calls.length, 0);
});

test('failed and unknown tool outcomes remain visible and completed is neutral, with original-operation recovery unchanged', () => {
  const r = run([proposal('pending')]); r.tools = [{ id: 'failed', nameLabel: 'Synthetic save', status: 'failed', savesCandidate: false }, { id: 'unknown', nameLabel: 'Synthetic check', status: 'unknown', savesCandidate: false }];
  const s = setup(r); s.render(true); assert.match(s.text(), /Synthetic save/); assert.match(s.text(), /Synthetic check/);
  assert.equal(s.h.hosts().find(n => n.type === 'AppStatusBadge' && n.props.label === '已結束').props.tone, 'neutral');
  s.button('讀取原運行並核對').props.onPress(); assert.deepEqual(s.calls.at(-1), ['refresh']);
  const original = { runId: r.id, proposalId: 'pending', input: { expectedVersion: 4, decision: 'accept', confirmShared: true }, reviewed: false, reconfirm: false };
  s.state.agentModel.pendingDecision = original; s.render(true); assert.equal(s.button('明確重試原確認').props.disabled, true);
  original.reviewed = true; s.state.agentModel.sharedConfirmed.pending = true; s.render(true);
  assert.equal(s.button('明確重試原確認').props.disabled, false); s.button('明確重試原確認').props.onPress();
  assert.deepEqual(s.calls.at(-1), ['retry']); assert.equal(s.state.agentModel.pendingDecision, original);
  original.reconfirm = true; s.render(true); assert.equal(s.button('明確重試原確認').props.disabled, true);
});

test('activity defers duplicate reply, Care keeps it, empty sources are omitted locally and original citations and phases survive', () => {
  const r = run(), s = setup(r); s.render(true); assert.equal(s.h.node('agent-answer'), undefined);
  s.button('查看原回覆').props.onPress(); s.render(true);
  let answer = s.h.node('agent-answer'); assert.equal(answer.props.message.sources, undefined); assert.equal(answer.props.message.text, r.text);
  r.status = 'unknown'; s.render(true); assert.equal(s.h.node('agent-answer').props.message.phase, 'unknown');
  r.status = 'running'; s.render(false); assert.equal(s.h.node('agent-answer').props.message.phase, 'thinking');
  r.citations = [{ id: 'source', title: 'Original source snapshot' }]; s.render(false); answer = s.h.node('agent-answer');
  assert.equal(answer.props.message.sources, r.citations); answer.props.onOpenSource('source'); assert.deepEqual(s.calls.at(-1), ['source', 'source']);
  r.citations = []; r.retrievalMode = 'keyword_degraded'; s.render(true); assert.match(s.text(), /檢索已降級/);
  assert.doesNotMatch(s.text(), /結果讀取時間|運行建立|AI 調用|知識查詢|本次沒有可核對的來源/);
});

test('activity has one title and close action, deduplicates only the current authoritative proposal and preserves pending pagination', () => {
  const p = proposal('pending'), s = setup(run([p]));
  s.state.agentPending.entries = [{ runId: 'synthetic-run', proposal: p }, { runId: 'older-run', proposal: proposal('older') }];
  s.state.agentPending.nextCursor = 'synthetic-next'; s.conversation();
  assert.deepEqual(s.h.hosts().filter(n => n.type === 'Title').map(n => n.props.children), ['活動']);
  assert.equal(s.button('助手設定'), undefined); assert.equal(s.button('重新讀取聊天'), undefined);
  assert.equal(s.h.hosts().filter(n => n.props.accessibilityLabel === '核對待確認事項：Synthetic pending').length, 0);
  s.named('核對待確認事項：Synthetic older').props.onPress(); assert.deepEqual(s.calls.at(-1), ['select', 'older-run']);
  s.button('讀取下一頁候選').props.onPress(); assert.deepEqual(s.calls.at(-1), ['pending', true]);
  s.button('關閉').props.onPress(); assert.deepEqual(s.calls.at(-1), ['close']);
  s.state.agentPending.entries[0] = { runId: 'synthetic-run', proposal: { ...p, version: 5 } }; s.conversation();
  assert.ok(s.named('核對待確認事項：Synthetic pending'), 'a newer discovery cannot be suppressed by an older run');
});

test('receipt read failures, offline evidence and stale pending recovery remain explicit without empty success panels', () => {
  const s = setup(); s.conversation(); assert.equal(s.h.node('agent-operation-receipts'), undefined);
  delete s.state.authorization.receipts['synthetic-run']; s.conversation(false); assert.equal(s.calls.length, 0);
  s.conversation(); assert.deepEqual(s.calls.at(-1), ['receipts', 'synthetic-run']);
  s.state.authorization.receipts['synthetic-run'] = { state: 'failed', items: [] }; s.conversation();
  assert.match(s.text(), /不能推斷已保存/); s.button('重試讀取收據').props.onPress(); assert.deepEqual(s.calls.at(-1), ['receipts', 'synthetic-run', true]);
  s.state.agentPending = { state: 'failed', hasSnapshot: true, entries: [{ runId: 'older', proposal: proposal('stale') }], nextCursor: 'more' }; s.conversation();
  assert.match(s.text(), /上次讀取/); assert.ok(s.button('讀取下一頁候選')); s.button('重新讀取待確認候選').props.onPress(); assert.deepEqual(s.calls.at(-1), ['pending']);
  s.state.agentModel.pendingDecision = { runId: 'synthetic-run', proposalId: 'stale', input: { expectedVersion: 4, decision: 'dismiss' } }; s.conversation();
  assert.equal(s.button('重新讀取待確認候選').props.disabled, true); assert.equal(s.button('讀取下一頁候選').props.disabled, true);
  s.state.authorization.online = false; s.state.authorization.receipts['synthetic-run'] = { state: 'ready', items: [] }; s.conversation(); assert.match(s.text(), /操作收據尚未重新核對/);
});

test('direct receipts retain destination and delivery limits, private-source snapshots and background recovery stay reachable', () => {
  const s = setup(); const item = { id: 'receipt', kind: 'save_private_note', state: 'saved', resource: { kind: 'private_note', id: 'note-id', version: 3 }, notification: 'authorized_for_due_event', channels: ['telegram'], createdAt: at };
  s.state.authorization.receipts['synthetic-run'] = { state: 'ready', items: [item] };
  s.state.agentModel.run.privateSourceCitations = [{ citationId: 'private', label: 'Synthetic private source', version: 7, excerpt: 'Exact authorized excerpt' }];
  s.conversation(); assert.match(s.text(), /只供本人查看/); assert.match(s.text(), /不表示已發送或送達/); assert.doesNotMatch(s.text(), /note-id|Exact authorized excerpt/);
  s.button('查看保存詳情').props.onPress(); s.conversation(); assert.match(s.text(), /note-id/);
  s.button('私人來源 1 · Synthetic private source').props.onPress(); s.conversation(); assert.match(s.text(), /Exact authorized excerpt/);
  s.state.agentInbox.state = 'failed'; s.conversation(); assert.match(s.text(), /未能讀取私人背景結果/);
  s.button('重試讀取私人背景結果').props.onPress(); assert.deepEqual(s.calls.at(-1), ['inbox']);
  s.state.agentModel.readState = 'denied'; s.state.agentPending.state = 'denied'; s.conversation();
  assert.doesNotMatch(s.text(), /Exact authorized excerpt|note-id|Exact change/);
});


test('twenty identically titled background runs keep a human date-time and a distinguishable accessible selection', () => {
  const s = setup();
  s.state.agentInbox = { online: true, locked: false, state: 'ready', loadedAt: at, selectedRunId: 'background-3',
    entries: Array.from({ length: 20 }, (_, i) => ({ runId: `background-${i}`, label: '已保存背景運行', createdAt: `2026-10-22T00:${String(i).padStart(2, '0')}:00Z` })) };
  s.conversation(); s.button('私人背景結果').props.onPress(); s.conversation();
  const controls = s.h.hosts().filter(n => n.type === 'Button' && n.props.label === '查看結果');
  assert.equal(controls.length, 20); assert.equal(new Set(controls.map(n => n.props.accessibilityLabel)).size, 20);
  assert.ok(controls.every(n => /已保存背景運行，.*08:\d{2}$/.test(n.props.accessibilityLabel)));
  assert.match(s.text(), /08:00/); assert.match(s.text(), /08:19/); assert.doesNotMatch(s.text(), /運行建立|香港時間|GMT|UTC|08:00:00/);
  controls[3].props.onPress(); assert.deepEqual(s.calls.at(-1), ['inbox-select', 'background-3']);
  assert.equal(s.h.hosts().filter(n => n.props['aria-selected'] === true).length, 1);
});
