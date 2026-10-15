import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const frontend = path.resolve(import.meta.dirname, '..');
// Execute the actual post-login effects with the RN global shape, without a
// browser or a fake window event API. This does not claim native rendering.
function harness() {
  const effects = [], cleanups = [], cache = new Map();
  const react = { useRef: value => ({ current: value }), useEffect: effect => effects.push(effect) };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', output)(name => {
      if (name === 'react') return react;
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(existsSync(target) ? target : `${target}.ts`);
    }, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  return { load: relative => load(path.resolve(frontend, relative)),
    mount: () => { for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    unmount: () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); } };
}

test('post-login refresh effects support native globals and release their listeners', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  const app = harness();
  try {
    let settings = 0, tasks = 0;
    app.load('src/production/SettingsDomainSupport.ts').useSettingsRefresh(
      { online: true, identityKey: 'parent', scopeKey: 'child' }, () => settings++, true, true);
    app.load('src/production/task-knowledge-runtime.ts').useTaskKnowledgeRefresh(() => tasks++, true);
    app.mount();
    assert.equal(settings, 1); assert.equal(tasks, 1);
    const refresh = app.load('../src/client/online-refresh-events.ts');
    refresh.publishOnlineRefresh();
    assert.equal(settings, 2); assert.equal(tasks, 2);
    app.unmount(); refresh.publishOnlineRefresh();
    assert.equal(settings, 2); assert.equal(tasks, 2);
  } finally {
    app.unmount();
    if (before) Object.defineProperty(globalThis, 'window', before); else delete globalThis.window;
  }
});

test('browser refresh preserves the existing event and cleanup contract', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  try {
    const refresh = harness().load('../src/client/online-refresh-events.ts');
    let calls = 0;
    const stop = refresh.subscribeOnlineRefresh(() => calls++);
    window.dispatchEvent(new Event(refresh.ONLINE_REFRESH_EVENT));
    refresh.publishOnlineRefresh();
    assert.equal(calls, 2);
    stop(); refresh.publishOnlineRefresh(); assert.equal(calls, 2);
  } finally {
    if (before) Object.defineProperty(globalThis, 'window', before); else delete globalThis.window;
  }
});
