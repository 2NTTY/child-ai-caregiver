import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);

// Runs the actual components and layout effects with deterministic synthetic reads,
// timers and animation completions. This is not a browser or animation-frame test.
export function harness(moduleMocks = {}) {
  let current, cursor = 0, changed = false, tree, hosts = [], instances = new Map(), seen = new Map(), contexts = new Map();
  let layoutEffects = [], effects = [], timerId = 0, pathname = '/', params = {}, production = {}, preference = { enabled: true, epoch: 0, reducedMotion: false };
  const contextValues = [];
  const timers = new Map(), animations = [], repeats = [], delays = [], cancellations = [], cache = new Map();
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const slot = make => current.slots[cursor++] ??= make();
  const effect = (fn, deps, queue) => {
    const state = slot(() => ({}));
    if (!sameDeps(state.deps, deps)) { state.deps = deps; queue.push(() => { state.cleanup?.(); state.cleanup = fn(); }); }
  };
  const react = {
    createContext(value) { const ctx = { defaultValue: value }; ctx.Provider = { context: ctx }; return ctx; },
    useContext: ctx => { const value = contexts.has(ctx) ? contexts.get(ctx) : ctx.defaultValue; contextValues.push(value); return value; },
    useRef: value => slot(() => ({ current: value })),
    useState(initial) { const instance = current, state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, update => { if (!instance.active) return; const next = typeof update === 'function' ? update(state.value) : update;
        if (!Object.is(next, state.value)) { state.value = next; changed = true; } }]; },
    useMemo(fn, deps) { const state = slot(() => ({})); if (!sameDeps(state.deps, deps)) { state.deps = deps; state.value = fn(); } return state.value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect: (fn, deps) => effect(fn, deps, effects), useLayoutEffect: (fn, deps) => effect(fn, deps, layoutEffects),
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const native = { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web' }, StyleSheet: { create: x => x, absoluteFill: {} } };
  const animated = { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' }, Easing: { bezier: () => x => x },
    useSharedValue: value => react.useRef({ value }).current, useAnimatedStyle: fn => fn(), runOnJS: fn => fn,
    cancelAnimation: value => cancellations.push(value),
    withTiming(value, config, callback) { animations.push({ value, config, callback }); return value; },
    withSequence: (...values) => values, withRepeat(...values) { repeats.push(values); return values; },
    withDelay(delay, value) { delays.push(delay); return value; } };
  function load(file) {
    file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(readFileSync(process.env.SCOPE_TEST_GATE_SOURCE && file.endsWith('/production/ProductionFirstScreenGate.tsx') ? process.env.SCOPE_TEST_GATE_SOURCE : file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => {
      if (name in moduleMocks) return moduleMocks[name];
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return native;
      if (name === 'react-native-paper') return { Text: 'Text' };
      if (name === 'react-native-reanimated') return animated;
      if (name === 'expo-router') return { usePathname: () => pathname, useGlobalSearchParams: () => params, Redirect: 'Redirect' };
      if (name.endsWith('/ProductionProvider')) return { useProduction: () => production };
      if (name.endsWith('/preferences')) return { useMotionPreferences: () => preference };
      if (name.endsWith('/theme')) return { colors: {}, spacing: {}, typeScale: { small: 14 } };
      if (name.endsWith('/ui')) return { AppButton: 'Button' };
      if (name.endsWith('/BrandLogo')) return { BrandLogo: 'Logo' };
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(file), name);
      return load(existsSync(target) ? target : existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
    }, module, module.exports, (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, id => timers.delete(id));
    return module.exports;
  }
  function visit(element, address) {
    if (element === null || element === undefined || typeof element !== 'object') return;
    if (Array.isArray(element)) { element.forEach((v, i) => visit(v, `${address}/${v?.key ?? i}`)); return; }
    const { type, props } = element;
    assert.ok(props, `Expected a synthetic JSX element at ${address}`);
    if (type?.context) { const before = contexts; contexts = new Map(contexts); contexts.set(type.context, props.value); visit(props.children, `${address}/provider`); contexts = before; return; }
    if (typeof type === 'function') {
      let instance = instances.get(address); if (!instance || instance.type !== type) instance = { type, active: true, slots: [] };
      seen.set(address, instance); const before = current, beforeCursor = cursor; current = instance; cursor = 0;
      const output = type(props); current = before; cursor = beforeCursor; visit(output, `${address}/render`); return;
    }
    hosts.push(element); if (props.ref && typeof props.ref === 'object') props.ref.current ??= {};
    visit(props.children, `${address}/host`);
  }
  function commit() {
    for (const [address, instance] of instances) if (seen.get(address) !== instance) { instance.active = false; for (const state of instance.slots) state.cleanup?.(); }
    instances = seen;
    while (layoutEffects.length) layoutEffects.shift()();
    while (effects.length) effects.shift()();
  }
  function render(next = tree, flush = true) {
    tree = next; let count = 0;
    do { assert.ok(++count < 24, 'Effects must settle'); hosts = []; changed = false; seen = new Map(); visit(tree, 'root'); if (!flush) break; commit(); } while (changed);
    return hosts;
  }
  return { load, jsx, react, render, contextValues, animations, repeats, delays, cancellations, timers,
    node: id => hosts.find(x => x.props.testID === id), hosts: () => hosts,
    production(value) { production = value; }, route(value, search = {}) { pathname = value; params = search; },
    reduce() { preference = { ...preference, enabled: false, reducedMotion: true }; },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(x => x.fn()); render(); },
    finish() { let count = 0; while (animations.length) { assert.ok(++count < 20); animations.shift().callback?.(true); render(); } },
    unmount() { seen = new Map(); commit(); },
  };
}
