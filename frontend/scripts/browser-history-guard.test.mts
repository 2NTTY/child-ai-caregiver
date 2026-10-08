import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {HistoryGuardWindow, HistoryRecoveryError} from '../src/preview/browser-history-guard.ts';
const {guardBrowserHistory} = await import(process.env.HISTORY_GUARD_MODULE ?? '../src/preview/browser-history-guard.ts');

// Deterministic native API ordering model: navigate -> currentEntry -> capture
// popstate -> Expo bubble listener. This is not a browser/Expo integration test.
function fixture(index = 1) {
  const entries = ['/chat', '/photos', '/care'].map((route, index) => ({index, key: `entry-${index}`, url: `https://synthetic.test${route}`}));
  const nav = new EventTarget() as EventTarget & {currentEntry: typeof entries[number]; traverseTo: (key: string) => {finished: Promise<unknown>}};
  nav.currentEntry = entries[index];
  const captures = new Set<EventListener>(), routed: string[] = [], requests: (() => void)[] = [], queue: (() => void)[] = [];
  const goes: number[] = [];
  let dirty = true, pending = false, error: HistoryRecoveryError | null = null;
  let content = entries[index].url;
  const pop = (event = new Event('popstate')) => {
    let stopped = false;
    event.stopImmediatePropagation = () => {stopped = true;};
    for (const capture of captures) capture(event);
    if (!stopped) { content = nav.currentEntry.url; routed.push(content); }
    return !stopped;
  };
  const move = (index: number, cancelable = true, sameDocument = true) => {
    if (!entries[index]) return;
    const event = Object.assign(new Event('navigate', {cancelable}), {navigationType: 'traverse', destination: {...entries[index], sameDocument}});
    nav.dispatchEvent(event);
    if (event.defaultPrevented) return;
    nav.currentEntry = entries[index];
    pop();
  };
  nav.traverseTo = key => {queue.push(() => move(entries.findIndex(e => e.key === key))); return {finished: Promise.resolve()};};
  const target = {navigation: nav, history: {go: (delta: number) => {goes.push(delta); queue.push(() => move(nav.currentEntry.index + delta));}},
    dispatchEvent: pop,
    addEventListener: (_: string, listener: EventListener) => captures.add(listener), removeEventListener: (_: string, listener: EventListener) => captures.delete(listener)} as unknown as HistoryGuardWindow;
  const cleanup = guardBrowserHistory(target, () => dirty || pending, action => requests.push(action), value => {error = value;});
  return {move, nav, requests, routed, cleanup, captures, entries, goes, get error() {return error;}, get content() {return content;}, set dirty(value: boolean) {dirty = value;}, set pending(value: boolean) {pending = value;},
    flush() {let count = 0; while (queue.length) {assert.ok(++count < 10, 'restoration must not loop'); queue.shift()!();}}, cancel() {requests.pop();}};
}

test('Back, Escape cancellation, non-cancellable Back restores before router and asks again', () => {
  const f = fixture(); f.move(0); assert.equal(f.requests.length, 1); f.cancel();
  f.move(0, false); assert.deepEqual(f.routed, []); f.flush();
  assert.equal(f.nav.currentEntry.index, 1); assert.equal(f.requests.length, 1);
  f.cancel(); f.move(0, false); f.flush(); assert.equal(f.nav.currentEntry.index, 1);
  f.requests.pop()!(); f.flush(); assert.equal(f.nav.currentEntry.index, 0); assert.equal(f.routed.length, 1);
});
test('Forward cancellation and approval use same guard and preserve history entries', () => {
  const f = fixture(); f.move(2, false); f.flush(); f.cancel(); assert.equal(f.nav.currentEntry.index, 1);
  f.move(2, false); f.flush(); f.requests.pop()!(); f.flush();
  assert.equal(f.nav.currentEntry.index, 2); assert.equal(f.entries.length, 3); assert.equal(f.routed.length, 1);
});
test('pending remains guarded; clean traversal and cleanup are not trapped', () => {
  const f = fixture(); f.dirty = false; f.pending = true; f.move(0, false); f.flush();
  assert.equal(f.nav.currentEntry.index, 1); assert.equal(f.requests.length, 1); f.cancel();
  f.pending = false; f.move(0, false); assert.equal(f.routed.length, 1);
  f.cleanup(); assert.equal(f.captures.size, 0); f.move(1); assert.equal(f.routed.length, 2);
});
test('rapid opposite traversal restores absolute origin and only latest intent can be approved', () => {
  const f = fixture(); f.move(0); const stale = f.requests.pop()!;
  f.move(0, false); f.move(2, false); f.flush();
  assert.equal(f.nav.currentEntry.index, 1); assert.deepEqual(f.routed, []);
  stale(); f.flush(); assert.equal(f.nav.currentEntry.index, 1);
  f.requests.pop()!(); f.flush(); assert.equal(f.nav.currentEntry.index, 2);
});
test('cross-document traversals are not restored and invalidate stale approval', () => {
  const f = fixture(); f.move(0); const stale = f.requests.pop()!;
  f.move(2, false, false); stale(); f.flush(); assert.equal(f.nav.currentEntry.index, 2); assert.equal(f.routed.length, 1);
});
test('same-route/hash movement and unknown entries do not enter restoration', () => {
  const f = fixture(); f.entries[0].url = 'https://synthetic.test/photos#section';
  f.move(0, false); assert.equal(f.requests.length, 0); assert.equal(f.routed.length, 1);
  f.entries[2].key = ''; f.move(2, false); f.flush(); assert.equal(f.requests.length, 0); assert.equal(f.nav.currentEntry.index, 2);
});
test('rejected and thrown restorations expose a persistent recovery error without losing mounted content', async () => {
  for (const thrown of [false, true]) {
    const f = fixture(); let restores = 0; const workingRestore = f.nav.traverseTo;
    f.nav.traverseTo = () => {restores++; if (thrown) throw new Error('Synthetic failure'); return {finished: Promise.reject(new Error('Synthetic failure'))};};
    f.move(0, false); await Promise.resolve(); f.flush();
    assert.equal(restores, 1); assert.equal(f.nav.currentEntry.url, 'https://synthetic.test/chat');
    assert.equal(f.content, 'https://synthetic.test/photos', 'the dirty page remains mounted');
    assert.ok(f.error, 'URL/content mismatch is an actionable error, not normal completion');
    assert.equal(f.requests.length, 0); assert.deepEqual(f.routed, []);
    f.nav.traverseTo = workingRestore; f.error.retry(); f.flush();
    assert.equal(f.nav.currentEntry.url, f.content); assert.equal(f.error, null);
    assert.equal(f.requests.length, 1, 'successful manual recovery uses the original leave confirmation');
  }
});
test('only explicit approved leave releases the held committed entry after recovery failure', async () => {
  const f = fixture();
  f.nav.traverseTo = () => ({finished: Promise.reject(new Error('Synthetic failure'))});
  f.move(0, false); await Promise.resolve(); assert.ok(f.error);
  const original = globalThis.PopStateEvent;
  globalThis.PopStateEvent = class extends Event { constructor(type: string) {super(type);} } as typeof PopStateEvent;
  try { f.error.leave(); } finally {globalThis.PopStateEvent = original;}
  assert.equal(f.content, f.nav.currentEntry.url); assert.equal(f.content, 'https://synthetic.test/chat');
  assert.equal(f.error, null); assert.equal(f.routed.length, 1);
});
test('cleanup during restoration invalidates rejected callbacks and leaves no capture listener', async () => {
  const f = fixture(); let reject!: (reason: Error) => void;
  f.nav.traverseTo = () => ({finished: new Promise((_, r) => {reject = r;})});
  f.move(0, false); f.cleanup(); reject(new Error('Synthetic abort')); await Promise.resolve();
  assert.equal(f.captures.size, 0); assert.equal(f.error, null); assert.equal(f.requests.length, 0);
  assert.equal(f.content, 'https://synthetic.test/photos', 'cleanup does not synthesize a route reset or discard the owner');
  // The guard has unmounted: later native events are untouched, not silently swallowed.
  f.move(1); assert.equal(f.content, f.nav.currentEntry.url);
});
test('new cross-document intent invalidates stale recovery actions and late AbortError', async () => {
  const f = fixture(); let reject!: (reason: Error) => void;
  f.nav.traverseTo = () => ({finished: new Promise((_, r) => {reject = r;})});
  f.move(0, false); f.move(2, false, false); reject(new DOMException('New navigation', 'AbortError')); await Promise.resolve();
  assert.equal(f.error, null); assert.equal(f.content, f.nav.currentEntry.url); assert.equal(f.nav.currentEntry.index, 2);
});
test('new same-document intent invalidates old failure controls and publishes its own failure', async () => {
  const f = fixture(); let restores = 0;
  f.nav.traverseTo = () => {restores++; return {finished: Promise.reject(new Error('Synthetic failure'))};};
  f.move(0, false); await Promise.resolve(); const stale = f.error!;
  f.move(2, false); await Promise.resolve(); assert.ok(f.error); assert.notEqual(f.error, stale);
  stale.retry(); stale.leave(); assert.equal(restores, 2); assert.deepEqual(f.routed, []);
  assert.equal(f.nav.currentEntry.url, 'https://synthetic.test/care'); assert.equal(f.content, 'https://synthetic.test/photos');
});

test('returning to the source entry after failure clears error without confirmation or history.go(0)', async () => {
  for (const cancelable of [true, false]) for (const destination of [0, 2]) {
    const f = fixture(), workingRestore = f.nav.traverseTo;
    f.nav.traverseTo = () => ({finished: Promise.reject(new Error('Synthetic failure'))});
    f.move(destination, false); await Promise.resolve(); assert.ok(f.error);
    f.nav.traverseTo = workingRestore; f.move(1, cancelable); f.flush();
    assert.equal(f.nav.currentEntry.url, f.content); assert.equal(f.content, 'https://synthetic.test/photos');
    assert.equal(f.error, null); assert.equal(f.requests.length, 0); assert.deepEqual(f.goes, []);
    assert.deepEqual(f.routed, [], 'the original mounted draft never resets');
  }
});
