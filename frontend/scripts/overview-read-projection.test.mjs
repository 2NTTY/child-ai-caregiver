import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DateTime, Settings } from 'luxon';
import { overviewConcerns, overviewRecords, overviewRecordTime } from '../src/overview-read-projection.ts';
import { summaryQueryDefaults } from '../src/components/summary/summary-form.ts';

const now = Date.parse('2026-10-23T06:00:00Z'), scope = 'account:child:owner', childId = 'child';
const record = (id, at, precision = 'exact') => ({ id, text: `Synthetic ${id}`, eventTime: { at, precision, timeZone: 'Asia/Hong_Kong' } });
const period = { startDay: '2026-10-17', period: 'week', timeZone: 'Asia/Hong_Kong' };
const summary = records => ({ scopeKey: scope, online: true, access: 'editable', readFailed: false, busy: false,
  query: { ...period, startDay: '2030-01-01' }, page: { childId, period, endDayExclusive: '2026-10-24', records }, pending: null });
const concern = (id, events = [], extra = {}) => ({ id, childId, status: 'following', archivedAt: null, events, ...extra });
const event = (id, at, kind = 'observation') => ({ id, at, kind, text: `Synthetic ${id}` });
const growth = items => ({ scopeKey: scope, childId, online: true, access: 'editable', load: 'ready', refreshPending: false, pending: null, page: { concerns: { state: 'ready', items } } });

test('recent records use applied period, known past event instants and exact canonical references', () => {
  const rows = [record('future', '2026-10-23T07:00:00Z'), record('unknown', null), record('bad', 'bad'),
    record('unknown-precision', '2026-10-23T05:00:00Z', 'unknown'), record('before', '2026-10-16T15:59:59Z'),
    record('first', '2026-10-16T16:00:00Z'), record('a', '2026-10-23T05:00:00Z'), record('b', '2026-10-23T04:00:00Z', 'approximate'), record('c', '2026-10-22T04:00:00Z')];
  const model = summary(rows), reading = overviewRecords(model, scope, childId, now);
  assert.equal(reading.periodLabel, '2026-10-17 – 2026-10-23');
  assert.deepEqual(reading.records.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(reading.records[0], rows[6]); assert.equal(reading.omitted, true);
  assert.equal(model.query.startDay, '2030-01-01'); assert.equal(model.page.records, rows);
  assert.ok(overviewRecordTime(rows[7], 'Asia/Hong_Kong').full.startsWith('約 '));
  assert.deepEqual(overviewRecords(summary([rows[4], rows[5]]), scope, childId, now).records.map(x => x.id), ['first']);
});

test('record projection denies cross-scope, cross-child, lost access and bad time zones; stale is not empty-ready', () => {
  const model = summary([record('a', '2026-10-23T05:00:00Z')]);
  for (const next of [{ ...model, scopeKey: 'other' }, { ...model, access: 'lost' }, { ...model, page: { ...model.page, childId: 'other' } },
    { ...model, page: { ...model.page, period: { ...period, timeZone: 'invalid-zone' } } }]) assert.deepEqual(overviewRecords(next, scope, childId, now).records, []);
  assert.equal(overviewRecords(null, scope, childId, now).state, 'loading');
  assert.equal(overviewRecords({ ...model, page: null, readFailed: true }, scope, childId, now).state, 'error');
  for (const next of [{ ...model, online: false }, { ...model, readFailed: true }]) {
    const reading = overviewRecords(next, scope, childId, now); assert.equal(reading.state, 'stale'); assert.equal(reading.records[0], model.page.records[0]);
  }
  assert.equal(overviewRecords({ ...model, busy: true }, scope, childId, now).state, 'ready');
  const future = { ...model, page: { ...model.page, period: { ...period, startDay: '2030-01-01' }, endDayExclusive: '2030-01-08' } };
  assert.deepEqual(overviewRecords(future, scope, childId, now).records, []);
  assert.equal(overviewRecords(future, scope, childId, now).periodLabel, '2030-01-01 – 2030-01-07');
});

test('concerns use following same-child authority and only latest past observation, never proposals', () => {
  const items = [concern('a', [event('old', '2026-10-20T00:00:00Z'), event('latest', '2026-10-22T00:00:00Z'), event('proposal', '2026-10-23T00:00:00Z', 'agent_proposal'), event('future', '2028-01-01T00:00:00Z')]),
    concern('b', [event('b', '2026-10-21T00:00:00Z')]), concern('c'), concern('proposed', [], { status: 'proposed' }),
    concern('archived', [], { archivedAt: '2026-10-22T00:00:00Z' }), concern('other', [], { childId: 'other' })];
  const reading = overviewConcerns(growth(items), scope, childId, now);
  assert.deepEqual(reading.items.map(x => x.concern.id), ['a', 'b']); assert.equal(reading.items[0].observation.id, 'latest');
  assert.equal(reading.items[0].concern, items[0]); assert.equal(reading.items[0].observation, items[0].events[1]);
  assert.equal(overviewConcerns(growth([items[2]]), scope, childId, now).items[0].observation, null);
});

test('concern states and pending recovery preserve provenance without exposing denied retained payloads', () => {
  const model = growth([concern('a')]);
  for (const next of [{ ...model, scopeKey: 'other' }, { ...model, childId: 'other' }, { ...model, access: 'lost' },
    { ...model, page: { concerns: { state: 'unavailable', items: model.page.concerns.items } } }]) assert.deepEqual(overviewConcerns(next, scope, childId, now).items, []);
  assert.equal(overviewConcerns({ ...model, load: 'error' }, scope, childId, now).state, 'stale');
  assert.equal(overviewConcerns({ ...model, online: false }, scope, childId, now).state, 'stale');
  assert.equal(overviewConcerns({ ...model, page: null, load: 'error' }, scope, childId, now).state, 'error');
  assert.equal(overviewConcerns({ ...model, pending: {}, page: { concerns: { state: 'unavailable', items: [] } } }, scope, childId, now).pending, true);
});

test('first query defaults to seven local calendar days including today across Hong Kong midnight and rollovers', () => {
  const savedNow = Settings.now;
  try {
    for (const [instant, start, end] of [['2026-10-23T06:00:00Z', '2026-10-17', '2026-10-24'], ['2026-10-22T15:59:59Z', '2026-10-16', '2026-10-23'], ['2026-10-22T16:00:00Z', '2026-10-17', '2026-10-24'], ['2027-01-01T00:00:00Z', '2026-12-26', '2027-01-02'], ['2024-03-01T00:00:00Z', '2024-02-24', '2024-03-02']]) {
      Settings.now = () => Date.parse(instant);
      const query = summaryQueryDefaults(); assert.deepEqual(query, { startDay: start, period: 'week', timeZone: 'Asia/Hong_Kong' });
      const exclusive = DateTime.fromISO(query.startDay, { zone: query.timeZone }).plus({ days: 7 });
      assert.equal(exclusive.toISODate(), end); assert.equal(exclusive.minus({ days: 1 }).toISODate(), DateTime.fromISO(instant).setZone(query.timeZone).toISODate());
    }
  } finally { Settings.now = savedNow; }
  const owner = readFileSync(new URL('../src/production/task-knowledge-summary.ts', import.meta.url), 'utf8');
  assert.match(owner, /useState\(summaryQueryDefaults\)/);
  assert.equal((owner.match(/summaryQueryDefaults/g) ?? []).length, 2, 'Only import and first lazy initializer; no reset of an applied or draft query');
});
