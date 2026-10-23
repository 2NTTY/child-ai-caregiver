import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentAuthorizationOwner } from '../src/production/AgentAuthorizationOwner.ts';

// Real owner and API validators with a synthetic GET-only transport. No live
// family data, model, browser geometry or transactional server snapshot is tested.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childId = uuid(1), scope = { key: 'synthetic-a', userId: 'synthetic-user', childId };
const at = '2026-10-23T00:00:00Z';
const note = (n: number, version = 1) => ({ id: uuid(n), childId, version, title: `Synthetic ${n}`, text: `Synthetic v${version}`,
  sourceMessageId: uuid(9), provenance: 'user_statement' as const, createdAt: at, updatedAt: at });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: ReturnType<typeof note>[], nextAfterId: string | null = null) => json({ notes: { items, nextAfterId } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() {
  const calls: { query: string | null; after: string | null; signal: AbortSignal }[] = [], losses: boolean[] = [];
  let response: (url: URL) => Promise<Response> | Response = () => page([note(20)], uuid(30));
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, 'GET', 'Writes and real models are forbidden in this test');
    assert.equal((init?.headers as Record<string, string>)['x-expected-user-id'], scope.userId);
    const url = new URL(String(input), 'https://synthetic.test');
    assert.match(url.pathname, /\/agent\/notes$/);
    calls.push({ query: url.searchParams.get('query'), after: url.searchParams.get('afterId'), signal: init!.signal! });
    return response(url);
  };
  const owner = new AgentAuthorizationOwner('/api', true, identity => losses.push(identity), () => assert.fail('Unexpected write'), fetcher);
  owner.syncContext(scope, true);
  return { owner, calls, losses, respond: (next: typeof response) => { response = next; } };
}

test('same-query refresh retains the loaded range until all fresh live pages are ready, then replaces it', async () => {
  const s = setup(); s.owner.setQuery('saved'); await s.owner.readNotes();
  s.respond(() => page([note(31), note(32)], uuid(40))); await s.owner.readNotes(true);
  s.owner.setQuery('unsent search draft');
  const snapshot = s.owner.getSnapshot(), first = deferred<Response>(), second = deferred<Response>();
  s.respond(url => url.searchParams.has('afterId') ? second.promise : first.promise);
  const refresh = s.owner.readNotes(false, true);
  assert.equal(s.owner.getSnapshot().notes, snapshot.notes); assert.equal(s.owner.getSnapshot().notesState, 'ready');
  assert.equal(s.owner.getSnapshot().nextAfterId, uuid(40)); assert.equal(s.owner.mayDelete(uuid(20)), false);
  first.resolve(page([note(20, 2)], uuid(35)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.calls.at(-1)!.after, uuid(35)); assert.equal(s.owner.getSnapshot().notes, snapshot.notes);
  second.resolve(page([note(36)], uuid(45))); await refresh;
  assert.deepEqual(s.owner.getSnapshot().notes.map(value => [value.id, value.version]), [[uuid(20), 2], [uuid(36), 1]]);
  assert.equal(s.owner.getSnapshot().nextAfterId, uuid(45)); assert.equal(s.owner.getSnapshot().queryDraft, 'unsent search draft');
  assert.equal(s.calls.at(-1)!.query, 'saved'); assert.equal(s.owner.mayDelete(uuid(20)), true);
  s.owner.setWritesBlocked(true); assert.equal(s.owner.mayDelete(uuid(20)), false);
});

test('front insertions extend refresh through the old scanned range instead of dropping its displaced tail', async () => {
  for (const complete of [false, true]) {
    const s = setup();
    let values = Array.from({ length: complete ? 40 : 60 }, (_, index) => note(index + 21));
    const response = (url: URL) => {
      const after = url.searchParams.get('afterId');
      const remaining = values.filter(value => after === null || value.id > after), items = remaining.slice(0, 20);
      return page(items, remaining.length > 20 ? items.at(-1)!.id : null);
    };
    s.respond(response); await s.owner.readNotes(); await s.owner.readNotes(true);
    const prior = s.owner.getSnapshot().notes, start = s.calls.length;
    assert.equal(prior.length, 40); assert.equal(prior.at(-1)!.id, uuid(60));
    values = [...Array.from({ length: 20 }, (_, index) => note(index + 1)), ...values];
    const third = deferred<Response>();
    s.respond(url => url.searchParams.get('afterId') === uuid(40) ? third.promise : response(url));
    const refresh = s.owner.readNotes(false, true); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(s.calls.slice(start).map(call => call.after), [null, uuid(20), uuid(40)]);
    assert.equal(s.owner.getSnapshot().notes, prior); assert.equal(s.owner.mayDelete(uuid(60)), false);
    third.resolve(page(values.filter(value => value.id > uuid(40)).slice(0, 20), complete ? null : uuid(60))); await refresh;
    assert.equal(s.owner.getSnapshot().notesState, 'ready'); assert.equal(s.owner.getSnapshot().notes.length, 60);
    assert.equal(s.owner.getSnapshot().notes.at(-1)!.id, uuid(60)); assert.equal(s.owner.mayDelete(uuid(60)), true);
    assert.equal(s.owner.getSnapshot().nextAfterId, complete ? null : uuid(60));
    assert.equal(s.calls.length, start + 3, 'A partial range stops at its old scanned boundary, not the whole collection');
  }
});

test('empty matching pages still advance the scanned boundary and do not finish a quiet refresh early', async () => {
  const s = setup(); s.owner.setQuery('filtered');
  s.respond(() => page([note(20)], uuid(100))); await s.owner.readNotes();
  s.respond(() => page([], uuid(300))); await s.owner.readNotes(true);
  const prior = s.owner.getSnapshot().notes, start = s.calls.length, last = deferred<Response>();
  s.respond(url => {
    const after = url.searchParams.get('afterId');
    if (after === null) return page([note(20, 2)], uuid(100));
    if (after === uuid(100)) return page([], uuid(200));
    assert.equal(after, uuid(200)); return last.promise;
  });
  const refresh = s.owner.readNotes(false, true); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(s.calls.slice(start).map(call => call.after), [null, uuid(100), uuid(200)]);
  assert.equal(s.owner.getSnapshot().notes, prior); assert.equal(s.owner.getSnapshot().nextAfterId, uuid(300));
  last.resolve(page([], uuid(300))); await refresh;
  assert.deepEqual(s.owner.getSnapshot().notes.map(value => value.version), [2]);
  assert.equal(s.owner.getSnapshot().nextAfterId, uuid(300)); assert.equal(s.calls.length, start + 3);
});

test('a final requested page must advance its scan cursor, including empty pages and load-more reads', async () => {
  for (const more of [false, true]) for (const invalidCursor of [uuid(30), uuid(25)]) {
    const s = setup(); await s.owner.readNotes();
    if (!more) { s.respond(() => page([note(31)])); await s.owner.readNotes(true); }
    const prior = s.owner.getSnapshot(), start = s.calls.length;
    s.respond(url => url.searchParams.has('afterId') ? page([], invalidCursor) : page([note(20, 2)], uuid(30)));
    await s.owner.readNotes(more, !more);
    assert.equal(s.calls.length, start + (more ? 1 : 2), 'Invalid cursor is rejected when received, without another request');
    assert.equal(s.owner.getSnapshot().notesState, 'failed'); assert.equal(s.owner.getSnapshot().notes, prior.notes);
    assert.equal(s.owner.getSnapshot().nextAfterId, prior.nextAfterId); assert.equal(s.owner.mayDelete(uuid(20)), false);
  }
});

test('ordinary refresh failure retains stale notes and disables deletion; retry rechecks the loaded range', async () => {
  const s = setup(); await s.owner.readNotes(); s.respond(() => page([note(31)])); await s.owner.readNotes(true);
  const prior = s.owner.getSnapshot().notes;
  s.respond(() => json({ error: { code: 'unavailable' } }, 503)); await s.owner.readNotes(false, true);
  assert.equal(s.owner.getSnapshot().notesState, 'failed'); assert.equal(s.owner.getSnapshot().notes, prior);
  assert.equal(s.owner.mayDelete(uuid(20)), false); assert.match(s.owner.getSnapshot().notice!, /上次讀取/);
  const count = s.calls.length; await s.owner.readNotes(true); assert.equal(s.calls.length, count);
  s.respond(url => page([note(url.searchParams.has('afterId') ? 31 : 20, 2)], url.searchParams.has('afterId') ? null : uuid(30)));
  await s.owner.readNotes(); assert.equal(s.calls.length, count + 2);
  assert.equal(s.owner.getSnapshot().notesState, 'ready'); assert.equal(s.owner.getSnapshot().notes.length, 2);
});

test('access loss and session change clear snapshots instead of retaining private stale notes', async () => {
  for (const [status, code, identity] of [[401, 'unauthorized', true], [403, 'not_found', false], [404, 'not_found', false], [409, 'session_changed', true]] as const) {
    const s = setup(); await s.owner.readNotes();
    s.respond(() => json({ error: { code } }, status)); await s.owner.readNotes(false, true);
    assert.equal(s.owner.getSnapshot().notesState, 'denied'); assert.deepEqual(s.owner.getSnapshot().notes, []);
    assert.equal(s.owner.getSnapshot().nextAfterId, null); assert.deepEqual(s.losses, [identity]);
    assert.equal(s.owner.mayDelete(uuid(20)), false);
  }
});

test('scope changes, logout and offline abort reject late synthetic responses', async () => {
  for (const change of ['child', 'identity', 'logout', 'offline']) {
    const s = setup(); await s.owner.readNotes(); const pending = deferred<Response>(); s.respond(() => pending.promise);
    const refresh = s.owner.readNotes(false, true);
    if (change === 'offline') s.owner.syncContext(scope, false);
    else if (change === 'logout') s.owner.syncContext(null, true);
    else s.owner.syncContext({ ...scope, key: change, ...(change === 'child' ? { childId: uuid(2) } : { userId: 'synthetic-other' }) }, true);
    assert.equal(s.calls.at(-1)!.signal.aborted, true);
    pending.resolve(page([note(20, 9)])); await refresh;
    assert.equal(s.owner.mayDelete(uuid(20)), false);
    assert.deepEqual(s.owner.getSnapshot().notes.map(value => value.version), change === 'offline' ? [1] : []);
  }
});

test('first reads and changed queries remain loading, while a known empty background read stays ready', async () => {
  const s = setup(), initial = deferred<Response>(); s.respond(() => initial.promise);
  const reading = s.owner.readNotes(); assert.equal(s.owner.getSnapshot().notesState, 'loading');
  initial.resolve(page([])); await reading;
  const background = deferred<Response>(); s.respond(() => background.promise);
  const refresh = s.owner.readNotes(false, true); assert.equal(s.owner.getSnapshot().notesState, 'ready');
  background.resolve(page([])); await refresh;
  s.owner.setQuery('changed'); const changed = deferred<Response>(); s.respond(() => changed.promise);
  const search = s.owner.readNotes(); assert.equal(s.owner.getSnapshot().notesState, 'loading');
  changed.resolve(page([])); await search; assert.equal(s.owner.getSnapshot().query, 'changed');
});
