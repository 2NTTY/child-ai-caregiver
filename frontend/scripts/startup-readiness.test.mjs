import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);

// Runs the actual components and layout effects with deterministic synthetic reads,
// timers and animation completions. This is not a browser or animation-frame test.
function harness() {
  let current, cursor = 0, changed = false, tree, hosts = [], instances = new Map(), seen = new Map(), contexts = new Map();
  let layoutEffects = [], effects = [], timerId = 0, pathname = '/', params = {}, production = {}, preference = { enabled: true, epoch: 0, reducedMotion: false };
  const timers = new Map(), animations = [], repeats = [], delays = [], cancellations = [], cache = new Map();
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const slot = make => current.slots[cursor++] ??= make();
  const effect = (fn, deps, queue) => {
    const state = slot(() => ({}));
    if (!sameDeps(state.deps, deps)) { state.deps = deps; queue.push(() => { state.cleanup?.(); state.cleanup = fn(); }); }
  };
  const react = {
    createContext(value) { const ctx = { defaultValue: value }; ctx.Provider = { context: ctx }; return ctx; },
    useContext: ctx => contexts.has(ctx) ? contexts.get(ctx) : ctx.defaultValue,
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
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => {
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
  return { load, jsx, react, render, animations, repeats, delays, cancellations, timers,
    node: id => hosts.find(x => x.props.testID === id), hosts: () => hosts,
    production(value) { production = value; }, route(value, search = {}) { pathname = value; params = search; },
    reduce() { preference = { ...preference, enabled: false, reducedMotion: true }; },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(x => x.fn()); render(); },
    finish() { let count = 0; while (animations.length) { assert.ok(++count < 20); animations.shift().callback?.(true); render(); } },
    unmount() { seen = new Map(); commit(); },
  };
}
const records = (patch = {}) => ({ auth: 'signedIn', online: true, children: [{ id: 'A' }], childrenLoading: false, childrenError: null,
  childrenLoadedAt: '2026-10-07', selectedChildId: 'A', ...patch });

function startup(h, { image = true, report = 'ready', includeReport = true, identity = 'parent:1', state = records(), path: route = '/', search = {} } = {}) {
  const { ProductionFirstScreenGate, useProductionStartupReadiness } = h.load('src/production/ProductionFirstScreenGate.tsx');
  const { useFirstScreenImage } = h.load('src/startup/FirstScreenGate.tsx');
  const Probe = startup.Probe ??= (props) => { props.reportHook(props.report); const hero = props.imageHook('home-hero');
    props.hookReact.useLayoutEffect(() => { if (props.image) hero.onLoad(); }, [props.image]); return h.jsx('ReadyContent', {}); };
  h.production({ identityKey: identity, scopeKey: state.selectedChildId ? `${identity}:${state.selectedChildId}` : null, recordsState: state }); h.route(route, search);
  return h.jsx(ProductionFirstScreenGate, { width: 1000, launch: h.jsx('Launch', {}), children: includeReport ? h.jsx(Probe, {
    image, report, reportHook: useProductionStartupReadiness, imageHook: useFirstScreenImage, hookReact: h.react,
  }) : null });
}

test('loaded artwork cannot reveal a slow child list or a slow required route read', () => {
  const h = harness(); h.render(startup(h, { state: records({ children: [], selectedChildId: null, childrenLoading: true, childrenLoadedAt: null }) }));
  assert.ok(h.node('frontend-startup-loading'));
  h.tick(); assert.ok(h.node('frontend-startup-loading'), 'the image fallback timer is not a data timeout');
  h.render(startup(h, { report: 'loading' })); assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h)); assert.ok(h.node('frontend-preview-ready')); assert.equal(h.node('frontend-startup-loading'), undefined);
});

test('errors reveal recovery without waiting for artwork and retries do not rehide it', () => {
  const h = harness(); h.render(startup(h, { image: false, report: 'error' }));
  assert.ok(h.node('frontend-preview-ready')); h.render(startup(h, { image: false, report: 'loading' }));
  assert.ok(h.node('frontend-preview-ready'));
});

test('zero children and anonymous login settle; initialization never invents a selected child', () => {
  const h = harness(); h.render(startup(h, { state: records({ children: [], selectedChildId: null }) })); assert.ok(h.node('frontend-preview-ready'));
  const login = harness(); login.render(startup(login, { identity: null, path: '/login', image: false, state: records({ auth: 'signedOut', selectedChildId: null }) }));
  login.tick(); assert.ok(login.node('frontend-preview-ready'));
});

test('same-identity refresh stays open but a new identity or session epoch waits again', () => {
  const h = harness(); h.render(startup(h)); assert.ok(h.node('frontend-preview-ready'));
  h.render(startup(h, { report: 'loading' })); assert.ok(h.node('frontend-preview-ready'));
  h.render(startup(h, { identity: 'parent:2', report: 'loading' })); assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { identity: 'other-parent:1', report: 'loading' })); assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { identity: 'other-parent:1' })); assert.ok(h.node('frontend-preview-ready'));
});

test('a report for a previous route/scope cannot release a new startup', () => {
  const h = harness(); h.render(startup(h, { image: false })); assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { path: '/tasks', includeReport: false })); assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { path: '/tasks' })); assert.ok(h.node('frontend-preview-ready'));
});

test('children-list failure exposes the actual refresh control', () => {
  const h = harness(), { ProductionGate } = h.load('src/production/ProductionGate.tsx'); let calls = 0;
  h.production({ identityKey: 'parent:1', online: true, recordsState: records({ childrenLoadedAt: null, childrenError: 'Synthetic list failure' }), refresh() { calls++; } });
  h.render(h.jsx(ProductionGate, { children: 'private' })); assert.ok(h.node('production-children-error'));
  h.hosts().find(x => x.type === 'Button').props.onPress(); assert.equal(calls, 1);
});

function scope(h, child, { scopeKey = child ? `parent:${child}` : 'parent', eligible = !!child, resetKey = 'parent:/' } = {}) {
  return h.jsx(h.load('src/motion/MotionScopeBoundary.tsx').MotionScopeBoundary, { scopeKey, childKey: child, eligible, resetKey, children: h.jsx('PrivateContent', {}) });
}
const measure = h => h.node('motion-child-scope').props.onLayout({ nativeEvent: { layout: { width: 900 } } });
const phase = h => h.node('motion-child-scope').props.dataSet.motionPhase;

test('first null-to-child selection and same-child refresh/role changes never play a switch curtain', () => {
  const h = harness(); h.render(scope(h, null)); measure(h); h.render(scope(h, 'A'));
  assert.equal(phase(h), 'settled'); assert.equal(h.node('motion-child-curtain'), undefined); assert.equal(h.animations.length, 0);
  h.render(scope(h, 'A')); h.render(scope(h, 'A', { scopeKey: 'parent:A:viewer' }));
  assert.equal(phase(h), 'settled'); assert.equal(h.animations.length, 0);
});

test('real child changes conceal immediately and discard stale rapid-switch callbacks', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h);
  h.render(scope(h, 'B')); assert.equal(phase(h), 'covering'); assert.ok(h.node('motion-child-curtain'));
  assert.ok(h.hosts().some(x => x.props['aria-hidden'] === true && x.props.pointerEvents === 'none'));
  const old = h.animations[0]; h.render(scope(h, 'C')); old.callback(true); h.render(); assert.equal(phase(h), 'covering');
  h.finish(); assert.equal(phase(h), 'settled'); assert.equal(h.node('motion-child-curtain'), undefined);
});

test('revocation, identity reset and reduced motion cancel the current presentation', () => {
  for (const action of ['revoke', 'identity', 'reduce']) {
    const h = harness(); h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B')); const late = [...h.animations];
    if (action === 'revoke') h.render(scope(h, null));
    if (action === 'identity') h.render(scope(h, 'C', { resetKey: 'other-parent:/' }));
    if (action === 'reduce') { h.reduce(); h.render(); }
    late.forEach(a => a.callback?.(true)); h.render(); assert.equal(phase(h), 'settled'); assert.equal(h.node('motion-child-curtain'), undefined);
    h.unmount(); assert.equal(h.timers.size, 0);
  }
});

test('loading dots stagger without resizing, retain one accessible label, and stop on reduce/unmount', () => {
  const h = harness(), { StartupLoadingLabel } = h.load('src/startup/StartupLoadingLabel.tsx');
  h.render(h.jsx(StartupLoadingLabel, { label: '正在開啟育伴港' }));
  assert.deepEqual(h.delays, [0, 140, 280]); assert.equal(h.repeats.length, 3);
  assert.equal(h.node('startup-loading-label').props.accessibilityLabel, '正在開啟育伴港…');
  assert.ok(h.hosts().some(x => x.props.importantForAccessibility === 'no-hide-descendants'));
  for (let i = 0; i < 3; i++) assert.equal(h.node(`startup-loading-dot-${i}`).props.style[0].width, 6);
  h.reduce(); h.render(); for (let i = 0; i < 3; i++) assert.equal(h.node(`startup-loading-dot-${i}`).props.style[1].transform[0].translateY, 0);
  const cancelled = h.cancellations.length; h.unmount(); assert.equal(h.cancellations.length, cancelled + 3);
});

test('startup only depends on the current route, and any required error remains reachable', () => {
  const h = harness(), { routeStartupReadiness, productionStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  const home = { profile: 'ready', care: 'ready', tasks: 'ready', growth: 'ready', photos: 'loading', model: 'loading' };
  assert.equal(routeStartupReadiness('/', {}, home), 'ready');
  for (const key of ['profile', 'care', 'tasks', 'growth']) assert.equal(routeStartupReadiness('/', {}, { ...home, [key]: 'loading' }), 'loading');
  assert.equal(routeStartupReadiness('/', {}, { ...home, growth: 'loading', tasks: 'error' }), 'error');
  assert.equal(routeStartupReadiness('/chat', {}, { chat: 'ready', profile: 'loading' }), 'ready');
  assert.equal(routeStartupReadiness('/summary', { tab: 'preparation' }, { documents: 'ready', profile: 'loading' }), 'ready');
  assert.equal(routeStartupReadiness('/history', {}, { tasks: 'ready', documents: 'loading' }), 'ready');
  assert.equal(routeStartupReadiness('/history', { category: 'care' }, { care: 'error', tasks: 'loading' }), 'error');
  assert.equal(routeStartupReadiness('/settings', {}, {}), 'ready');
  assert.equal(productionStartupReadiness(records({ selectedChildId: null }), null, 'ready'), 'loading');
  assert.equal(productionStartupReadiness(records(), null, 'ready'), 'error');
  assert.equal(productionStartupReadiness(records({ auth: 'unavailable' }), null, 'loading'), 'error');
  assert.equal(productionStartupReadiness(records({ online: false }), null, 'loading'), 'error');
});


test('no-child onboarding skips child reads but still waits for identity-scoped pages', () => {
  const h = harness(), { routeStartupReadiness, productionStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  const none = records({ children: [], selectedChildId: null });
  assert.equal(routeStartupReadiness('/', {}, {}, false), 'ready');
  for (const [pathname, params, key] of [['/family', {}, 'family'], ['/settings', { section: 'model' }, 'model'],
    ['/settings', { section: 'notifications' }, 'push'], ['/settings', { section: 'preferences' }, 'preferences']]) {
    const pending = routeStartupReadiness(pathname, params, {}, false);
    assert.equal(pending, 'loading', `${pathname} must not treat an unread identity owner as empty`);
    assert.equal(productionStartupReadiness(none, null, pending), 'loading');
    assert.equal(productionStartupReadiness(none, null, routeStartupReadiness(pathname, params, { [key]: 'error' }, false)), 'error');
  }
});

test('preferences deep links wait for their existing read, then expose success or retry', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  const params = { section: 'preferences' };
  assert.equal(routeStartupReadiness('/settings', params, { preferences: 'loading' }), 'loading');
  assert.equal(routeStartupReadiness('/settings', params, { preferences: 'ready' }), 'ready');
  assert.equal(routeStartupReadiness('/settings', params, { preferences: 'error' }), 'error');
  h.render(startup(h, { state: records({ children: [], selectedChildId: null }), report: 'loading' }));
  assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { state: records({ children: [], selectedChildId: null }), report: 'error' }));
  assert.ok(h.node('frontend-preview-ready'));
});


test('care photo deep links wait only for the photo consumer', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  assert.equal(routeStartupReadiness('/care', { view: 'photos' }, { care: 'ready', photos: 'loading' }), 'loading');
  assert.equal(routeStartupReadiness('/care', { view: 'photos' }, { care: 'loading', photos: 'ready' }), 'ready');
  assert.equal(routeStartupReadiness('/care', { view: 'photos' }, { care: 'loading', photos: 'error' }), 'error');
  assert.equal(routeStartupReadiness('/care', {}, { care: 'ready', photos: 'loading' }), 'ready');
});

test('growth archive deep links wait for both the visible page authority and document archive', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, { growth: 'ready', documents: 'loading' }), 'loading');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, { growth: 'loading', documents: 'ready' }), 'loading');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, { growth: 'ready', documents: 'ready' }), 'ready');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, { growth: 'loading', documents: 'error' }), 'error');
  assert.equal(routeStartupReadiness('/growth', {}, { growth: 'ready', documents: 'loading' }), 'ready');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, {}, false), 'ready');
});

test('an earlier care-view report cannot reveal a pending photo-view startup', () => {
  const h = harness();
  h.render(startup(h, { path: '/care', state: records({ childrenLoading: true }) }));
  assert.ok(h.node('frontend-startup-loading'));
  h.render(startup(h, { path: '/care', search: { view: 'photos' }, includeReport: false }));
  assert.ok(h.node('frontend-startup-loading'), 'changing view invalidates the previous route report');
  h.render(startup(h, { path: '/care', search: { view: 'photos' }, report: 'ready' }));
  assert.ok(h.node('frontend-preview-ready'));
});
