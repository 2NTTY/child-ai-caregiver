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
  mocks['react-native'] = { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
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
    agentPending: { state: 'ready', entries: [], hasSnapshot: true, nextCursor: null }, readAgentPending: action('pending'), selectAgentRun(id) {
      calls.push(['select', id]); state.agentModel = { ...state.agentModel, readState: 'loading', busy: 'read', sharedConfirmed: {} };
    },
    agentInbox: { online: true, locked: false, state: 'idle', loadedAt: null, entries: [], selectedRunId: null },
    agentInboxActions: { refresh: action('inbox'), select(id) {
      calls.push(['inbox-select', id]); state.agentInbox.selectedRunId = id;
      state.agentModel = { ...state.agentModel, readState: 'loading', busy: 'read', sharedConfirmed: {} };
    }, collapse() {
      calls.push(['inbox-collapse']); state.agentModel = { ...state.agentModel, run: null, readState: 'idle', sharedConfirmed: {}, notice: null };
      state.agentInbox.selectedRunId = null;
    } },
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

test('whole pending cards show original change text and open only the selected item after the original run read', () => {
  const a = proposal('first'), b = proposal('second'), s = setup(run([a, b]));
  s.state.agentModel = { ...s.state.agentModel, readState: 'idle', run: null };
  s.state.agentPending.entries = [a, b].map(proposal => ({ runId: 'synthetic-run', proposal }));
  s.conversation();
  const card = s.h.node('activity-card-proposal-synthetic-run-second');
  assert.equal(card.type, 'Pressable'); assert.equal(card.props.accessibilityRole, 'button'); assert.equal(card.props.disabled, false);
  assert.match(card.props.accessibilityLabel, /Original content second/);
  assert.equal(s.button('核對原運行與候選'), undefined); assert.equal(s.button('建立待辦'), undefined);
  const descendants = element => !element || typeof element !== 'object' ? [] : Array.isArray(element) ? element.flatMap(descendants) : [element, ...descendants(element.props?.children)];
  assert.equal(descendants(card.props.children).some(node => ['Button', 'Pressable', 'AppCheckbox'].includes(node.type)), false);
  card.props.onFocus(); s.conversation();
  assert.ok(s.h.node('activity-card-proposal-synthetic-run-second').props.style({ pressed: false }).some(style => style?.borderWidth === 2));
  s.h.node('activity-card-proposal-synthetic-run-second').props.onPress(); s.conversation();
  assert.deepEqual(s.calls.at(-1), ['select', 'synthetic-run']);
  assert.equal(s.state.agentModel.readState, 'loading'); assert.equal(s.h.node('agent-proposal-first'), undefined); assert.equal(s.h.node('agent-proposal-second'), undefined);
  s.state.agentModel = { ...s.state.agentModel, readState: 'ready', busy: null, run: run([a, b]) }; s.conversation();
  assert.equal(s.h.node('agent-proposal-first'), undefined); assert.ok(s.h.node('agent-proposal-second'));
  assert.equal(s.h.node('agent-activity-detail').props.accessibilityLabel, '活動詳情：Synthetic second');
  assert.equal(s.button('建立待辦').props.disabled, true, 'fresh owner confirmation is still required');
  assert.deepEqual(s.state.agentModel.sharedConfirmed, {});
  s.button('返回活動').props.onPress(); s.conversation();
  assert.deepEqual(s.calls.at(-1), ['inbox-collapse']); assert.ok(s.h.node('activity-card-proposal-synthetic-run-second'));
  assert.equal(s.h.node('agent-activity-detail'), undefined);
  assert.equal(s.calls.some(call => call[0] === 'decide' || call[0] === 'retry'), false);
});

test('selected activity version, run, kind and scope mismatches never expose another confirmation and a newer version is explicit', () => {
  const p = proposal('target'), other = proposal('other'), s = setup();
  s.state.agentModel = { ...s.state.agentModel, readState: 'idle', run: null };
  s.state.agentPending.entries = [{ runId: 'synthetic-run', proposal: p }]; s.conversation();
  s.h.node('activity-card-proposal-synthetic-run-target').props.onPress();
  const ready = projected => { s.state.agentModel = { ...s.state.agentModel, readState: 'ready', busy: null, run: projected }; s.conversation(); };
  ready(run([other, { ...p, version: 5, content: 'Exact new version content' }]));
  assert.match(s.text(), /內容已更新/); assert.match(s.text(), /Exact new version content/); assert.equal(s.h.node('agent-proposal-other'), undefined);
  assert.equal(s.button('建立待辦').props.disabled, true); assert.deepEqual(s.state.agentModel.sharedConfirmed, {});
  const mismatches = [run([other]), run([{ ...p, version: 3 }]), run([{ ...p, scope: 'private' }]), run([{ ...p, kind: 'memory_fact' }]), { ...run([p]), id: 'different-run' }];
  for (const snapshot of mismatches) {
    ready(snapshot); assert.match(s.text(), /未能核對你點選的事項/); assert.equal(s.button('建立待辦'), undefined); assert.equal(s.button('確認資料'), undefined);
    assert.equal(s.state.agentModel.run, snapshot, 'display targeting does not rewrite or invalidate the authoritative run');
  }
  s.named('重新檢查這項活動').props.onPress(); assert.deepEqual(s.calls.at(-1), ['refresh']);
  s.state.scopeKey = 'scope-b'; s.state.agentModel = { ...s.state.agentModel, readState: 'idle', run: null }; s.state.agentPending.entries = [];
  s.conversation(); assert.equal(s.h.node('agent-activity-detail'), undefined); assert.doesNotMatch(s.text(), /Exact new version content|Synthetic target/);
});

test('whole-card mutation gates remain while unknown results can return to the activity list', () => {
  const p = proposal('guarded'), s = setup();
  s.state.agentModel = { ...s.state.agentModel, readState: 'idle', run: null };
  s.state.agentPending.entries = [{ runId: 'synthetic-run', proposal: p }];
  for (const patch of [{ online: false }, { busy: 'read' }, { writesBlocked: true }]) {
    const original = s.state.agentModel; s.state.agentModel = { ...original, ...patch }; s.conversation();
    const card = s.h.node('activity-card-proposal-synthetic-run-guarded'); assert.equal(card.props.disabled, true);
    const count = s.calls.length; card.props.onPress(); assert.equal(s.calls.length, count); s.state.agentModel = original;
  }
  s.conversation(); s.h.node('activity-card-proposal-synthetic-run-guarded').props.onPress();
  const pending = { runId: 'synthetic-run', proposalId: p.id, input: { expectedVersion: 4, decision: 'accept', confirmShared: true }, reviewed: false, reconfirm: false };
  s.state.agentModel = { ...s.state.agentModel, readState: 'ready', busy: null, run: run([p]), pendingDecision: pending }; s.state.agentInbox.locked = true;
  s.conversation(); assert.equal(s.button('返回活動').props.disabled, false);
  assert.equal(s.button('再次接受'), undefined); assert.equal(s.button('建立待辦').props.disabled, true);
  const count = s.calls.length; s.button('返回活動').props.onPress(); s.conversation();
  assert.equal(s.calls.length, count); assert.equal(s.state.agentModel.pendingDecision, pending);
  assert.ok(s.h.node('agent-activity-list')); assert.equal(s.h.node('agent-activity-detail'), undefined);
  s.button('查看待確認結果').props.onPress(); s.conversation(); assert.deepEqual(s.calls.at(-1), ['select', 'synthetic-run']);
  s.state.agentModel.readState = 'denied'; s.conversation(); assert.doesNotMatch(s.text(), /Original content guarded/);
  assert.equal(s.button('返回活動').props.disabled, true);
});

test('closing clears only local card targeting so external different-run and same-run chat entries reopen normally', () => {
  const a = proposal('first'), b = proposal('second'), s = setup();
  s.state.agentModel = { ...s.state.agentModel, readState: 'idle', run: null };
  s.state.agentPending.entries = [{ runId: 'synthetic-run', proposal: a }]; s.conversation();
  s.h.node('activity-card-proposal-synthetic-run-first').props.onPress();
  s.state.agentModel = { ...s.state.agentModel, readState: 'ready', busy: null, run: run([a, b]) }; s.conversation();
  assert.ok(s.h.node('agent-proposal-first')); assert.equal(s.h.node('agent-proposal-second'), undefined);
  const authoritativeRun = s.state.agentModel.run, callsBeforeClose = s.calls.length;
  s.conversation(false); assert.equal(s.state.agentModel.run, authoritativeRun); assert.equal(s.calls.length, callsBeforeClose);
  s.conversation(); assert.ok(s.h.node('agent-proposal-first')); assert.ok(s.h.node('agent-proposal-second'), 'same-run entry is no longer filtered to the old card');
  s.conversation(false); s.state.agentModel.run = { ...run([b]), id: 'external-run' }; s.conversation();
  assert.ok(s.h.node('agent-proposal-second')); assert.doesNotMatch(s.text(), /未能核對你點選的事項/);
  assert.equal(s.h.node('agent-activity-detail').props.accessibilityLabel, '活動詳情');
});

test('list previews preserve actual task cancellation and source deactivation verbs without internal save boilerplate', () => {
  const s = setup(); const { projectAgentProposal } = s.h.load('src/production/agent-projection.ts');
  const { proposalPrimaryText, proposalContextLabel } = s.h.load('src/components/agent/proposal-presentation.ts');
  const common = { id: 'change', version: 4, status: 'pending', createdAt: at, expiresAt: later, targetLabel: 'Exact original target', result: null };
  for (const action of ['cancel', 'complete', 'reschedule', 'resolve']) {
    const p = projectAgentProposal({ ...common, value: { kind: 'task_change', taskId: 'original-task', change: { action, expectedVersion: 3, note: '',
      dueAt: later, timeZone: 'Asia/Hong_Kong', assigneeUserId: 'Exact new assignee', outcome: 'cancelled' } } });
    assert.ok(proposalPrimaryText(p).includes(p.details.find(detail => detail.label === '操作').value));
    s.state.agentModel.run = run([p]); s.render(true); assert.ok(s.text().includes(p.details.find(detail => detail.label === '操作').value));
  }
  const p = projectAgentProposal({ ...common, value: { kind: 'private_source_change', inputId: 'original-source', change: { expectedVersion: 3,
    management: { intention: 'Exact original intention', purpose: 'answer_reference', nature: 'personal', timeScope: 'current', validityText: '', enabled: false, modelExcerpt: null } } } });
  assert.match(proposalContextLabel(p), /停用原來源/); s.state.agentModel.run = run([p]); s.render(true);
  assert.match(s.text(), /停用原來源/); assert.match(s.text(), /未授權；不讀來源正文/); assert.doesNotMatch(s.text(), /尚未執行/);
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
  s.state.agentModel.pendingDecision = original; s.render(true); assert.equal(s.button('再次接受'), undefined);
  assert.match(s.text(), /暫時無法確認結果/); assert.doesNotMatch(s.text(), /原決定|原核對版本|原候選事項|所有新決定/);
  assert.equal(s.h.hosts().filter(n => n.type === 'Text' && n.props.children === '暫時無法確認結果').length, 1);
  s.button('重新確認').props.onPress(); assert.deepEqual(s.calls.at(-1), ['refresh']);
  original.reviewed = true; s.state.agentModel.sharedConfirmed.pending = true; s.render(true);
  assert.equal(s.button('再次接受').props.disabled, false); s.button('再次接受').props.onPress();
  assert.deepEqual(s.calls.at(-1), ['retry']); assert.equal(s.state.agentModel.pendingDecision, original);
  original.reconfirm = true; s.render(true); assert.equal(s.button('再次接受'), undefined); assert.match(s.text(), /未接受成功/);
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

test('activity has one title and close action, returns through the original owner and preserves discovery pagination', () => {
  const p = proposal('pending'), s = setup(run([p]));
  s.state.agentPending.entries = [{ runId: 'synthetic-run', proposal: p }, { runId: 'older-run', proposal: proposal('older') }];
  s.state.agentPending.nextCursor = 'synthetic-next'; s.conversation();
  assert.deepEqual(s.h.hosts().filter(n => n.type === 'Title').map(n => n.props.children), ['活動']);
  assert.equal(s.button('助手設定'), undefined); assert.equal(s.button('重新讀取聊天'), undefined);
  assert.equal(s.h.hosts().filter(n => n.props.accessibilityLabel === '核對待確認事項：Synthetic pending').length, 0);
  assert.equal(s.h.node('agent-activity-list'), undefined, 'discovery cards are a list, not mixed into the open detail');
  s.button('返回活動').props.onPress(); s.conversation(); assert.deepEqual(s.calls.at(-1), ['inbox-collapse']);
  s.button('讀取下一頁候選').props.onPress(); assert.deepEqual(s.calls.at(-1), ['pending', true]);
  s.button('關閉').props.onPress(); assert.deepEqual(s.calls.at(-1), ['close']);
  s.state.agentPending.entries[0] = { runId: 'synthetic-run', proposal: { ...p, version: 5 } }; s.conversation();
  assert.ok(s.h.node('activity-card-proposal-synthetic-run-pending'), 'the discovered newer item remains reachable');
  s.h.node('activity-card-proposal-older-run-older').props.onPress(); assert.deepEqual(s.calls.at(-1), ['select', 'older-run']);
});

test('receipt read failures, offline evidence and stale pending recovery remain explicit without empty success panels', () => {
  const s = setup(); s.conversation(); assert.equal(s.h.node('agent-operation-receipts'), undefined);
  delete s.state.authorization.receipts['synthetic-run']; s.conversation(false); assert.equal(s.calls.length, 0);
  s.conversation(); assert.deepEqual(s.calls.at(-1), ['receipts', 'synthetic-run']);
  s.state.authorization.receipts['synthetic-run'] = { state: 'failed', items: [] }; s.conversation();
  assert.match(s.text(), /暫時無法確認是否已保存/); s.button('重新檢查').props.onPress(); assert.deepEqual(s.calls.at(-1), ['receipts', 'synthetic-run', true]);
  s.state.agentPending = { state: 'failed', hasSnapshot: true, entries: [{ runId: 'older', proposal: proposal('stale') }], nextCursor: 'more' }; s.conversation();
  s.button('返回活動').props.onPress(); s.conversation();
  assert.match(s.text(), /上次讀取/); assert.ok(s.button('讀取下一頁候選')); s.button('重新讀取待確認候選').props.onPress(); assert.deepEqual(s.calls.at(-1), ['pending']);
  s.state.agentModel.pendingDecision = { runId: 'synthetic-run', proposalId: 'stale', input: { expectedVersion: 4, decision: 'dismiss' } }; s.conversation();
  assert.equal(s.button('重新讀取待確認候選').props.disabled, true); assert.equal(s.button('讀取下一頁候選').props.disabled, true);
  s.state.authorization.online = false; s.state.authorization.receipts['synthetic-run'] = { state: 'ready', items: [] };
  s.state.agentModel = { ...s.state.agentModel, run: run(), readState: 'ready' }; s.conversation();
  assert.equal(s.h.node('agent-activity-detail'), undefined, 'new owner snapshots do not reopen a list the user returned to');
  s.conversation(false); s.conversation(); assert.match(s.text(), /操作收據尚未重新核對/);
});

test('direct receipts retain destination and delivery limits, private-source snapshots and background recovery stay reachable', () => {
  const s = setup(); const item = { id: 'receipt', kind: 'save_private_note', state: 'saved', resource: { kind: 'private_note', id: 'note-id', version: 3 }, notification: 'authorized_for_due_event', channels: ['telegram'], createdAt: at };
  s.state.authorization.receipts['synthetic-run'] = { state: 'ready', items: [item] };
  s.state.agentModel.run.privateSourceCitations = [{ citationId: 'private', label: 'Synthetic private source', version: 7, excerpt: 'Exact authorized excerpt' }];
  s.conversation(); assert.match(s.text(), /只供本人查看/); assert.match(s.text(), /不表示已發送或送達/); assert.doesNotMatch(s.text(), /note-id|Exact authorized excerpt/);
  s.button('查看保存詳情').props.onPress(); s.conversation(); assert.match(s.text(), /note-id/);
  s.button('私人來源 1 · Synthetic private source').props.onPress(); s.conversation(); assert.match(s.text(), /Exact authorized excerpt/);
  s.button('返回活動').props.onPress(); s.state.agentInbox.state = 'failed'; s.conversation(); assert.match(s.text(), /未能載入其他活動/);
  s.button('重新載入活動記錄').props.onPress(); assert.deepEqual(s.calls.at(-1), ['inbox']);
  s.state.agentModel.readState = 'denied'; s.state.agentPending.state = 'denied'; s.conversation();
  assert.doesNotMatch(s.text(), /Exact authorized excerpt|note-id|Exact change/);
});


test('twenty identically titled background runs keep a human date-time and a distinguishable accessible selection', () => {
  const s = setup();
  s.state.agentModel.readState = 'idle';
  s.state.agentInbox = { online: true, locked: false, state: 'ready', loadedAt: at, selectedRunId: 'background-3',
    entries: Array.from({ length: 20 }, (_, i) => ({ runId: `background-${i}`, label: '已保存背景運行', createdAt: `2026-10-22T00:${String(i).padStart(2, '0')}:00Z` })) };
  s.conversation();
  const controls = s.h.hosts().filter(n => n.type === 'Pressable' && n.props.testID?.startsWith('activity-card-run-'));
  assert.equal(controls.length, 20); assert.equal(new Set(controls.map(n => n.props.accessibilityLabel)).size, 20);
  assert.ok(controls.every(n => /活動結果；.*08:\d{2}$/.test(n.props.accessibilityLabel)));
  assert.match(s.text(), /08:00/); assert.match(s.text(), /08:19/); assert.doesNotMatch(s.text(), /運行建立|香港時間|GMT|UTC|08:00:00/);
  assert.equal(s.h.hosts().filter(n => n.props['aria-current'] === 'true').length, 1);
  controls[3].props.onPress(); assert.deepEqual(s.calls.at(-1), ['inbox-select', 'background-3']);
});

test('activity title, loaded pending count and original wrapped refresh share one compact header', () => {
  const s = setup(run([proposal('pending')])); s.conversation();
  const header = s.h.node('agent-activity-header');
  assert.ok(header); assert.equal(header.props.style[1].flexWrap, 'nowrap');
  assert.equal(s.h.hosts().filter(n => n.type === 'Title').length, 1);
  assert.equal(s.h.hosts().find(n => n.type === 'Title').props.children, '活動');
  assert.equal(s.h.node('agent-activity-count').props.children, '1 項待確認');
  assert.equal(s.h.node('agent-run-summary'), undefined, 'the same count is not repeated below the header');
  s.named('更新活動結果').props.onPress(); assert.deepEqual(s.calls.at(-1), ['refresh']);
  s.state.agentPending.nextCursor = 'synthetic-more'; s.conversation();
  assert.equal(s.h.node('agent-activity-count').props.children, '1+ 項待確認');
  assert.match(s.h.node('agent-activity-count').props.accessibilityLabel, /仍有更多待讀取/);
  for (const state of ['loading', 'failed', 'denied']) {
    s.state.agentPending.state = state; s.conversation();
    assert.equal(s.h.node('agent-activity-count').props.children, '待確認未核對');
  }
  s.state.agentPending.state = 'ready';
  s.state.agentModel.online = false; s.conversation();
  assert.equal(s.h.node('agent-activity-count').props.children, '待確認未核對');
  assert.equal(s.named('更新活動結果').props.disabled, true);
  s.state.agentModel.online = true; s.state.agentModel.readState = 'idle'; s.conversation();
  assert.equal(s.h.hosts().filter(n => n.type === 'Title').length, 1);
  s.named('更新待確認活動').props.onPress(); assert.deepEqual(s.calls.at(-1), ['pending']);
});

test('private fact keeps source and scope labels visible, merges only the exact scope duplicate and defers only technical version', () => {
  const p = proposal('fact', { kind: 'memory_fact', scope: 'private', details: [
    { label: '來源', value: 'Exact original source' }, { label: '接受後可見範圍', value: '只限你本人' }, { label: '有效至', value: '未設定' },
  ] });
  const s = setup(run([p])); s.render(true);
  assert.match(s.text(), /本人/); assert.doesNotMatch(s.text(), /只限你本人/); assert.match(s.text(), /Exact original source/); assert.doesNotMatch(s.text(), /候選版本|尚未執行|保存確認事實/);
  assert.equal(s.h.hosts().filter(n => n.type === 'Text' && n.props.children === '接受後可見範圍').length, 1);
  assert.ok(s.h.hosts().some(n => n.type === 'Text' && n.props.children === '來源'));
  assert.doesNotMatch(s.text(), /有效至|未設定/); assert.match(s.text(), /確認期限.*2099/);
  assert.equal(s.h.hosts().filter(n => n.type === 'AppCheckbox').length, 0);
  const snapshot = structuredClone(p); s.named('查看其他詳情：Synthetic fact').props.onPress(); s.render(true);
  assert.match(s.text(), /Exact original source/); assert.match(s.text(), /候選版本 4/); assert.deepEqual(p, snapshot);
  s.named('收起其他詳情：Synthetic fact').props.onPress(); s.render(true);
  p.details[1].value = 'Synthetic differing visibility'; p.details.push({ label: 'Unrecognised safety term', value: 'Exact new condition' });
  s.render(true); assert.match(s.text(), /Synthetic differing visibility/); assert.match(s.text(), /Exact new condition/);
  const { proposalDetailIcon } = s.h.load('src/components/agent/proposal-presentation.ts');
  for (const label of ['constructor', 'toString', '__proto__']) {
    assert.equal(proposalDetailIcon(label), 'information-outline');
    p.details.push({ label, value: `Exact unknown ${label}` });
  }
  s.render(true);
  for (const label of ['constructor', 'toString', '__proto__']) assert.ok(s.text().includes(`Exact unknown ${label}`));
  p.expiresAt = 'not-a-date'; s.render(true);
  assert.match(s.text(), /時間資料無效/); assert.match(s.text(), /候選已過期/); assert.equal(s.button('確認資料').props.disabled, true);
});

test('all ten projected proposal kinds retain complete changes and mandatory scope, target, time and authorization text', () => {
  const s = setup(); const { projectAgentProposal } = s.h.load('src/production/agent-projection.ts');
  const management = { intention: 'Synthetic purpose', purpose: 'answer_reference', nature: 'personal', timeScope: 'current',
    validityText: 'Exact validity condition', enabled: true, modelExcerpt: 'Exact authorized model excerpt' };
  const input = { sourceUrl: 'https://example.test/synthetic-source', text: 'Exact complete source text\nSecond source paragraph' };
  const links = { recordId: null, taskId: null, attentionId: null };
  const fixtures = [
    { value: { kind: 'task_create', values: { title: 'Synthetic task', details: 'Exact task body', kind: 'ordinary',
      assigneeUserId: 'Exact assignee', dueAt: at, timeZone: 'Asia/Hong_Kong' } }, visible: ['Exact task body', 'Exact assignee', at, 'Asia/Hong_Kong'] },
    { value: { kind: 'task_change', taskId: 'Exact original task', change: { action: 'reschedule', expectedVersion: 3, note: 'Exact change note',
      assigneeUserId: 'Exact new assignee', dueAt: later, timeZone: 'Asia/Hong_Kong' } }, visible: ['Exact original task', 'Exact change note', 'Exact new assignee', later] },
    { value: { kind: 'memory_fact', key: 'Synthetic fact', content: 'Exact fact body', intendedVisibility: 'private', validUntil: null }, visible: ['Exact fact body'] },
    { value: { kind: 'memory_fact_revise', factId: 'original-fact', expectedVersion: 3, key: 'Exact revised name', content: 'Exact revised fact',
      sourceMessageId: 'Original source message', validUntil: later, reason: 'Exact revision reason' }, visible: ['Exact revised name', 'Exact revised fact', 'Exact revision reason', later] },
    { value: { kind: 'memory_fact_deactivate', factId: 'original-fact', expectedVersion: 3, reason: 'Exact deactivation reason' }, visible: ['Exact deactivation reason', '不代表永久刪除'] },
    { value: { kind: 'private_source_create', management, input }, visible: [input.text, input.sourceUrl, management.modelExcerpt, management.validityText, '只供本人，不建立家庭事實'] },
    { value: { kind: 'private_source_change', inputId: 'original-source', change: { expectedVersion: 3, management, content: input } }, visible: [input.text, management.modelExcerpt, '修改正文會撤回原模型授權'] },
    { value: { kind: 'concern_create', values: { title: 'Synthetic concern', reason: 'Exact reason', observation: 'Exact shared observation',
      observedAt: at, followUpAt: later, links } }, visible: ['Exact shared observation', at, later, '觀察不是診斷', '不自動外發'] },
    { value: { kind: 'concern_change', concernId: 'original-concern', change: { action: 'append', expectedVersion: 3,
      text: 'Exact appended observation', observedAt: at, links } }, visible: ['Exact appended observation', at, '不會自動外發通知'] },
    { value: { kind: 'family_document_change', documentId: 'original-document', change: { expectedVersion: 3, edits: [
      { op: 'set_metadata', title: 'Exact updated document title', summary: 'Exact updated summary' },
      { op: 'upsert_item', sectionId: 'Exact section', itemId: 'Exact item', text: 'Exact complete replacement\nSecond replacement paragraph', sourceIds: ['Exact source ref'] },
    ] } }, visible: ['Exact updated document title', 'Exact updated summary', 'Exact section', 'Exact item', 'Exact complete replacement\nSecond replacement paragraph', 'Exact source ref', '不建立新事實'] },
  ];
  for (const fixture of fixtures) {
    const p = projectAgentProposal({ id: fixture.value.kind, version: 4, status: 'pending', createdAt: at, expiresAt: later,
      targetVisibility: 'private', targetLabel: 'Exact original target', contentState: 'ready', result: null, value: fixture.value });
    const original = structuredClone(p); s.state.agentModel.run.proposals = [p]; s.render(true);
    for (const required of fixture.visible) assert.ok(s.text().includes(required), `${p.kind}: visible ${required}`);
    assert.match(s.text(), /確認期限/); assert.doesNotMatch(s.text(), /候選版本/);
    assert.ok(s.text().includes(p.scope === 'family' ? '確認後按家庭權限共享' : '本人'));
    const check = s.h.hosts().find(n => n.type === 'AppCheckbox');
    assert.equal(!!check, p.scope === 'family', p.kind);
    if (check) { assert.match(check.props.label, /明確同意寫入家庭共享資料/); assert.equal(check.props.disabled, false); }
    s.named('查看其他詳情：' + p.title).props.onPress(); s.render(true);
    for (const detail of p.details) {
      if (p.kind === 'memory_fact' && detail.label === '有效至' && detail.value === '未設定') {
        assert.ok(!s.text().includes('未設定'), 'the exact optional new-fact placeholder is omitted even in disclosure');
      } else if (detail.label === '接受後可見範圍' && detail.value === '只限你本人' && p.kind === 'memory_fact') assert.ok(s.text().includes('本人'));
      else assert.ok(s.text().includes(detail.value), `${p.kind}: preserved ${detail.label}`);
    }
    assert.deepEqual(p, original, 'presentation never changes the confirmation payload or snapshot');
  }
});

test('unknown receipts only reread original receipts, while recovery preserves its original decision and lock', () => {
  const p = proposal('pending'), s = setup(run([p]));
  const original = { runId: 'synthetic-run', proposalId: p.id, input: { expectedVersion: 4, decision: 'accept', confirmShared: true }, reviewed: false, reconfirm: false };
  s.state.agentModel.pendingDecision = original; s.state.authorization.receipts['synthetic-run'] = { state: 'failed', items: [] }; s.conversation();
  assert.match(s.text(), /暫時無法確認是否已保存/); assert.equal(s.button('建立待辦').props.disabled, true);
  s.named('重新檢查本次操作是否已保存').props.onPress(); assert.deepEqual(s.calls.at(-1), ['receipts', 'synthetic-run', true]);
  assert.equal(s.state.agentModel.pendingDecision, original); assert.equal(s.button('再次接受'), undefined);
  s.named('重新確認').props.onPress(); assert.deepEqual(s.calls.at(-1), ['refresh']);
  assert.equal(s.state.agentModel.pendingDecision, original); assert.equal(s.calls.filter(call => call[0] === 'decide' || call[0] === 'retry').length, 0);
  s.state.authorization.online = false; s.conversation(); assert.equal(s.named('重新檢查本次操作是否已保存').props.disabled, true);
  s.state.authorization.online = true; s.state.authorization.receipts['synthetic-run'].state = 'loading'; s.conversation();
  assert.equal(s.named('重新檢查本次操作是否已保存').props.disabled, true);
});


test('only the exact new-fact unset validity placeholder is omitted, never real expiry or unknown fields', () => {
  const p = proposal('validity', { kind: 'memory_fact', scope: 'private', details: [{ label: '有效至', value: '未設定' }] });
  const s = setup(run([p]));
  const { proposalDetailGroups } = s.h.load('src/components/agent/proposal-presentation.ts');
  const before = structuredClone(p);
  assert.deepEqual(proposalDetailGroups(p), { visible: [], supporting: [] });
  assert.deepEqual(p, before, 'presentation never mutates projected facts or candidate expiry');
  for (const detail of [
    { label: '有效至', value: later }, { label: '有效至', value: '未設期限' },
    { label: '有效至', value: '未設定 ' }, { label: '未知有效至', value: '未設定' },
    { label: '確認期限', value: '未設定' },
  ]) assert.deepEqual(proposalDetailGroups({ ...p, details: [detail] }).visible, [detail]);
  for (const kind of ['memory_fact_revise', 'memory_fact_deactivate', 'task_create', 'task_change', 'private_source_create', 'private_source_change', 'concern_create', 'concern_change', 'family_document_change']) {
    assert.deepEqual(proposalDetailGroups({ ...p, kind }).visible, p.details, `${kind} does not inherit the new-fact placeholder rule`);
  }
  p.expiresAt = '2020-01-01T00:00:00Z'; s.render(true);
  assert.doesNotMatch(s.text(), /有效至|未設定/);
  assert.match(s.text(), /確認期限.*2020/); assert.match(s.text(), /候選已過期/);
  assert.equal(s.button('確認資料').props.disabled, true);
});

test('opening an unresolved activity rereads once, including reconnect, but ordinary rerenders never poll or POST', () => {
  const p = proposal('pending'), s = setup(run([p]));
  const pending = { runId: 'synthetic-run', proposalId: p.id, input: { expectedVersion: 4, decision: 'accept', confirmShared: true }, reviewed: true, reconfirm: false };
  s.state.agentModel.pendingDecision = pending;
  const reads = () => s.calls.filter(call => call[0] === 'refresh').length;
  s.conversation(); assert.equal(reads(), 1); s.conversation(); assert.equal(reads(), 1);
  s.conversation(false); assert.equal(reads(), 1); s.conversation(); assert.equal(reads(), 2);
  s.conversation(); assert.equal(reads(), 2);
  s.state.agentModel.online = false; s.conversation(false); s.conversation(); assert.equal(reads(), 2);
  s.state.agentModel.online = true; s.conversation(); assert.equal(reads(), 3);
  assert.equal(s.calls.filter(call => call[0] === 'decide' || call[0] === 'retry').length, 0);
  assert.equal(s.state.agentModel.pendingDecision, pending);
});
