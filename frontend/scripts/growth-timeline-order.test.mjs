import assert from 'node:assert/strict';
import test from 'node:test';
import { growthConcernTimelineEntries } from '../src/growth-view-model.ts';

const event = (id, at, extra = {}) => ({ id, at, kind: 'observation', title: id, text: `Synthetic ${id}`, sourceLabel: 'Synthetic record', ...extra });
const attention = (id, updatedAt, extra = {}) => ({ id, childId: 'child-a', version: 2, state: 'accepted', updatedAt, ...extra });
const concern = (events, attentionIds = []) => ({ id: 'concern-a', childId: 'child-a', events, attentionIds, historyComplete: false });
const ids = entries => entries.map(entry => entry.kind === 'event' ? `event:${entry.event.id}` : `attention:${entry.item.id}`);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('mixed timeline uses projected event time and attention state-update time, newest first without mutating sources', () => {
  const chain = concern([
    event('old-record', '2026-10-01T11:00:00Z', { updatedAt: '2026-12-01T00:00:00Z' }),
    event('task-linked', '2026-10-03T11:00:00Z', { kind: 'confirmed_action', taskId: 'task-a', occurredAt: '2026-09-01T00:00:00Z' }),
    event('pending-record', '2026-10-02T11:00:00Z', { kind: 'pending_record' }),
  ], ['attention-a']);
  const state = attention('attention-a', '2026-10-04T11:00:00Z', { createdAt: '2026-09-01T00:00:00Z', taskId: 'task-a', taskState: 'completed' });
  const page = { items: [state] }, before = structuredClone({ chain, page });
  freeze(chain); freeze(page);
  const entries = growthConcernTimelineEntries(chain, page);
  assert.deepEqual(ids(entries), ['attention:attention-a', 'event:task-linked', 'event:pending-record', 'event:old-record']);
  assert.equal(entries[0].at, state.updatedAt);
  assert.equal(entries[1].at, chain.events[1].at, 'Task links do not replace the provided concern-event time');
  assert.equal(entries[0].item, state); assert.equal(entries[1].event, chain.events[1]);
  assert.deepEqual({ chain, page }, before);
});

test('equal instants have deterministic identity order and unknown times follow every valid time', () => {
  const events = [event('z', '2026-10-03T19:00:00+08:00'), event('a', '2026-10-03T11:00:00Z'), event('unknown-z', ''), event('unknown-a', 'not-a-date')];
  const states = [attention('known', '2026-10-03T11:00:00Z'), attention('unknown', 'invalid', { createdAt: '2099-01-01T00:00:00Z' })];
  const chain = concern(events, states.map(item => item.id));
  const expected = ['attention:known', 'event:a', 'event:z', 'attention:unknown', 'event:unknown-a', 'event:unknown-z'];
  assert.deepEqual(ids(growthConcernTimelineEntries(chain, { items: states })), expected);
  assert.deepEqual(ids(growthConcernTimelineEntries({ ...chain, events: [...events].reverse() }, { items: [...states].reverse() })), expected);
  assert.deepEqual(ids(growthConcernTimelineEntries(concern([event('first', 'invalid'), event('second', '')]), { items: [] })), ['event:first', 'event:second']);
});

test('canonical child, relation and version guards still prevent unrelated or duplicate state entries', () => {
  const state = attention('related', '2026-10-04T11:00:00Z');
  const chain = concern([event('confirmed', state.updatedAt, { kind: 'confirmed_action', attentionId: state.id, attentionVersion: state.version })], [state.id, 'proposed']);
  const page = { items: [state, attention('unrelated', '2099-01-01T00:00:00Z'), { ...state, childId: 'child-b' }, attention('proposed', '2099-01-01T00:00:00Z', { state: 'proposed' })] };
  assert.deepEqual(ids(growthConcernTimelineEntries(chain, page)), ['event:confirmed']);
  const olderVersion = { ...chain, events: [{ ...chain.events[0], attentionVersion: state.version - 1 }] };
  assert.deepEqual(ids(growthConcernTimelineEntries(olderVersion, page)), ['attention:related', 'event:confirmed']);
});

test('loading older history preserves the newest entry and partial-history metadata without truncation', () => {
  const newest = event('newest', '2026-10-04T11:00:00Z');
  const initial = concern([newest]), page = { items: [] };
  assert.deepEqual(ids(growthConcernTimelineEntries(initial, page)), ['event:newest']);
  const expanded = concern([event('older-2', '2026-10-02T11:00:00Z'), newest, event('older-1', '2026-10-01T11:00:00Z')]);
  const before = structuredClone(expanded);
  assert.deepEqual(ids(growthConcernTimelineEntries(expanded, page)), ['event:newest', 'event:older-2', 'event:older-1']);
  assert.deepEqual(expanded, before); assert.equal(expanded.historyComplete, false);
});
