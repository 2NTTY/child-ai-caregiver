import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Shipped HomeWelcome with deterministic hook, frame and timer ports; not browser pixels.
function harness({ ready = false, active = true, reducedMotion = false } = {}) {
  let cursor = 0, dirty = false, now = 0, serial = 0, tree, consumed = 0;
  let scopeKey = 'Synthetic Parent', pathname = '/', preferences = { preferenceReady: true, active, reducedMotion, enabled: active && !reducedMotion, epoch: 0 };
  const slots = [], effects = [], frames = new Map(), timers = new Map(), animations = [];
  const slot = create => slots[cursor++] ??= create();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef: current => slot(() => ({ current })),
    useState: initial => { const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, value => { const next = typeof value === 'function' ? value(state.value) : value; if (next !== state.value) { state.value = next; dirty = true; } }]; },
    useCallback: (fn, deps) => { const state = slot(() => ({})); if (!same(state.deps, deps)) { state.fn = fn; state.deps = deps; } return state.fn; },
    useLayoutEffect: (fn, deps) => { const state = slot(() => ({})); if (!same(state.deps, deps)) { state.deps = deps; effects.push(() => { state.cleanup?.(); state.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/HomeWelcome.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const resolve = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'expo-router') return { usePathname: () => pathname };
    if (name === 'react-native') return { StyleSheet: { create: value => value }, View: 'View' };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'react-native-reanimated') return { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' },
      useSharedValue: value => react.useRef({ value }).current, useAnimatedStyle: callback => callback(), cancelAnimation() {}, runOnJS: callback => callback,
      withTiming: (value, config, callback) => { animations.push({ config, callback }); return value; } };
    if (name === '../motion') return { useMotionPreferences: () => preferences, motionTokens: {} };
    if (name.endsWith('/FirstScreenGate')) return { useFirstScreenReady: () => ready };
    if (name.endsWith('/theme')) return { colors: {}, spacing: { lg: 16 }, radius: {}, readingType: {}, workspaceType: {} };
    if (name.endsWith('/HomeBackground')) return { HomeBackground: 'HomeBackground' };
    assert.fail(name);
  };
  new Function('require', 'module', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', code)(resolve, module, module.exports,
    callback => { const id = ++serial; frames.set(id, callback); return id; }, id => frames.delete(id),
    (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; }, id => timers.delete(id));
  const render = () => { let rounds = 0; do { assert.ok(++rounds < 12); dirty = false; cursor = 0;
    tree = module.exports.HomeWelcome({ scopeKey, introductionPending: consumed === 0, onIntroductionPresented: () => consumed++ });
    while (effects.length) effects.shift()();
  } while (dirty); return tree; };
  return { render, frames, timers, animations, consumed: () => consumed, phase: () => tree?.props.dataSet.introPhase ?? 'absent',
    ready: value => { ready = value; return render(); }, scope: value => { scopeKey = value; return render(); }, path: value => { pathname = value; return render(); },
    preferences: update => { preferences = { ...preferences, ...update }; preferences.enabled = preferences.active && preferences.preferenceReady && !preferences.reducedMotion; return render(); },
    frame: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); return render(); },
    advance: duration => { now += duration; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); } return render(); },
    finish: () => { for (const animation of animations.splice(0)) animation.callback?.(true); return render(); },
    unmount: () => slots.forEach(state => state.cleanup?.()),
  };
}

test('startup scope and layout changes do not consume the greeting while loading; visible paint gets the full reading time', () => {
  const h = harness(); h.render(); h.advance(15000); h.scope('api:synthetic:child-a:owner'); h.preferences({ epoch: 1 });
  assert.equal(h.phase(), 'waiting'); assert.equal(h.consumed(), 0); assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
  h.ready(true); assert.equal(h.consumed(), 0); h.frame(); assert.equal(h.consumed(), 0); h.frame();
  assert.equal(h.phase(), 'reading'); assert.equal(h.consumed(), 1);
  h.advance(2999); assert.equal(h.phase(), 'reading'); h.advance(1); assert.equal(h.phase(), 'collapsing');
  assert.equal(h.animations[0].config.duration, 360); h.finish(); assert.equal(h.phase(), 'absent');
});

test('initial background and loading hide/show wait without consuming or confusing inactive with reduced motion', () => {
  const h = harness({ ready: true, active: false }); h.render(); h.advance(4000);
  assert.equal(h.consumed(), 0); assert.equal(h.phase(), 'waiting'); assert.equal(h.frames.size, 0);
  h.preferences({ active: true, epoch: 1 }); h.frame(); h.preferences({ active: false, epoch: 2 }); h.frame();
  assert.equal(h.consumed(), 0); assert.equal(h.frames.size, 0);
  h.preferences({ active: true, epoch: 3 }); h.frame(); h.frame(); assert.equal(h.phase(), 'reading'); assert.equal(h.consumed(), 1);
});

test('after presentation route, child and visibility/layout interruptions settle without replay', () => {
  for (const interrupt of [h => h.path('/tasks'), h => h.scope('child-b'), h => h.preferences({ epoch: 1 }), h => h.preferences({ active: false })]) {
    const h = harness({ ready: true }); h.render(); h.frame(); h.frame(); interrupt(h);
    assert.equal(h.phase(), 'absent'); assert.equal(h.timers.size, 0);
    h.path('/'); h.scope('child-a'); h.preferences({ active: true }); h.frame(); h.advance(5000);
    assert.equal(h.phase(), 'absent'); assert.equal(h.consumed(), 1);
  }
});

test('reduced motion goes to its final state without a reading timer or animation and unmount cancels waiting frames', () => {
  const reduced = harness({ ready: true, reducedMotion: true }); reduced.render();
  assert.equal(reduced.phase(), 'absent'); assert.equal(reduced.consumed(), 1); assert.equal(reduced.timers.size, 0); assert.equal(reduced.animations.length, 0);
  const h = harness({ ready: true }); h.render(); h.unmount(); assert.equal(h.frames.size, 0); assert.equal(h.consumed(), 0);
});

test('motion preferences sample initial Web visibility and native AppState before any event', () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/motion/preferences.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [platform, document, appState, expected] of [['web', { hidden: true }, 'active', false], ['web', { hidden: false }, 'active', true], ['web', undefined, 'active', false], ['android', undefined, 'background', false], ['android', undefined, 'active', true]]) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', code)(name => {
      if (name === 'react') return { createContext: () => ({ Provider: 'Provider' }), useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: current => ({ current }), useEffect() {}, useCallback: fn => fn };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === 'react-native') return { Platform: { OS: platform }, AppState: { currentState: appState }, useWindowDimensions: () => ({ width: 800, height: 600 }) };
      if (name === './lifecycle') return {};
      if (name === './preferencePolicy') return { resolveReducedMotion: () => false };
      assert.fail(name);
    }, module, module.exports, document);
    assert.equal(module.exports.MotionProvider({ children: null }).props.value.active, expected, `${platform}:${appState}:${document?.hidden}`);
  }
});
