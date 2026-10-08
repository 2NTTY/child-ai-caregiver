import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
const frontend = path.resolve(import.meta.dirname, '..');

// Evaluate the actual custom entry/module graph. Native Node EventTarget preserves
// at-target registration order (including capture flags); no capture-first stub.
// Navigation/history and Expo's synchronous popstate route reset remain modeled.
function runtime({server = false, native = false, early = true} = {}) {
  const target = new EventTarget(), nav = new EventTarget(), queue = [], registrations = [], requests = [], routed = [];
  const entries = ['/chat', '/photos'].map((route, index) => ({key: `entry-${index}`, index, url: `https://synthetic.test${route}`}));
  let current = entries[1], content = current.url, dirty = true, eventPhase;
  Object.defineProperty(nav, 'currentEntry', {get: () => current});
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {registrations.push({type, listener, options}); return add(type, listener, options);};
  target.removeEventListener = (type, listener, options) => {
    const index = registrations.findIndex(row => row.type === type && row.listener === listener);
    if (index >= 0) registrations.splice(index, 1);
    return remove(type, listener, options);
  };
  const move = (index, cancelable = true) => {
    const event = Object.assign(new Event('navigate', {cancelable}), {navigationType: 'traverse', destination: {...entries[index], sameDocument: true}});
    nav.dispatchEvent(event); if (event.defaultPrevented) return;
    current = entries[index]; target.dispatchEvent(new Event('popstate'));
  };
  target.navigation = nav;
  target.history = {go: delta => queue.push(() => move(current.index + delta))};
  nav.traverseTo = key => {queue.push(() => move(entries.findIndex(entry => entry.key === key))); return {finished: Promise.resolve()};};
  const root = {Event, URL, WeakMap, PopStateEvent: class extends Event {}, console};
  if (!server) root.window = target;
  if (!server && !native) root.document = {};
  const context = vm.createContext(root), modules = new Map(), imports = [];
  const router = () => {
    imports.push('expo-router/entry');
    if (server || native) return {};
    target.addEventListener('popstate', event => {
      eventPhase = event.eventPhase; content = current.url; routed.push(content);
      // Matches the observed Expo route-state replacement before the late guard.
      nav.dispatchEvent(Object.assign(new Event('navigate'), {navigationType: 'replace', destination: {...current, sameDocument: true}}));
    });
    return {};
  };
  function load(file) {
    if (file === 'expo-router/entry') return router();
    const absolute = path.isAbsolute(file) ? file : path.resolve(frontend, file);
    if (modules.has(absolute)) return modules.get(absolute);
    const exports = {}; modules.set(absolute, exports);
    const require = name => {
      if (name === 'expo-router/entry') return router();
      const modulePath = path.resolve(path.dirname(absolute), name.endsWith('.ts') ? name : name + '.ts');
      imports.push(path.basename(modulePath)); return load(modulePath);
    };
    const source = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    vm.runInContext(`(function(require, exports) {${source}\n})`, context)(require, exports);
    return exports;
  }
  if (early) load('index.js'); else router();
  const bootRegistrations = registrations.length;
  const cleanup = load('src/preview/browser-history-guard.ts').guardBrowserHistory(target, () => dirty, action => requests.push(action));
  return {move, target, nav, requests, registrations, imports, routed, cleanup, load, bootRegistrations, get content() {return content;}, get current() {return current;}, get eventPhase() {return eventPhase;},
    set dirty(value) {dirty = value;}, flush() {let count = 0; while (queue.length) {assert.ok(++count < 10); queue.shift()();}}};
}

test('real custom entry evaluates the history bridge before Expo and registers exactly one native listener', () => {
  const f = runtime();
  assert.equal(JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8')).main, 'index.js');
  assert.deepEqual(f.imports.slice(0, 2), ['browser-history-events.ts', 'expo-router/entry']);
  assert.equal(f.registrations.length, 2); assert.equal(f.registrations[0].options, true); assert.equal(f.registrations[1].options, undefined);
});
test('at-target negative control reproduces the observed late-listener failure despite capture=true', () => {
  const f = runtime({early: false}); f.move(0); f.requests.pop(); f.move(0, false); f.flush();
  assert.equal(f.content, 'https://synthetic.test/chat'); assert.equal(f.eventPhase, Event.AT_TARGET);
  assert.equal(f.requests.length, 0); assert.equal(f.registrations[1].options, true);
});
test('early entry protects second Back after cancellation and still allows explicit approval', () => {
  const f = runtime(); f.move(0); assert.equal(f.requests.length, 1); f.requests.pop();
  f.move(0, false); assert.deepEqual(f.routed, []); f.flush();
  assert.equal(f.content, 'https://synthetic.test/photos'); assert.equal(f.current.url, f.content); assert.equal(f.requests.length, 1);
  f.requests.pop()(); f.flush(); assert.equal(f.content, 'https://synthetic.test/chat'); assert.equal(f.routed.length, 1);
});
test('cleanup makes the single early listener inert and stale cleanup cannot detach a newer delegate', () => {
  const f = runtime(); f.cleanup(); assert.equal(f.registrations.length, 2);
  const {subscribeBrowserPopstate} = f.load('src/preview/browser-history-events.ts');
  let first = 0, second = 0;
  const old = subscribeBrowserPopstate(f.target, () => first++);
  const latest = subscribeBrowserPopstate(f.target, () => second++);
  old(); f.target.dispatchEvent(new Event('popstate')); assert.equal(first, 0); assert.equal(second, 1);
  latest(); f.move(0, false); assert.equal(f.content, 'https://synthetic.test/chat'); assert.equal(second, 1);
  assert.equal(f.registrations.length, 2, 'remounting never installs duplicate native listeners');
});
test('custom entry remains safe for SSR and native without a DOM', () => {
  for (const options of [{server: true}, {native: true}]) {
    const f = runtime(options);
    assert.equal(f.bootRegistrations, 0);
    // Only the deliberately direct helper setup in this harness adds a listener;
    // boot evaluation itself is a no-op and still evaluates Expo's entry once.
    assert.equal(f.registrations.length, 1);
    assert.equal(f.imports.filter(name => name === 'expo-router/entry').length, 1);
    f.cleanup(); assert.equal(f.registrations.length, 0);
  }
});
