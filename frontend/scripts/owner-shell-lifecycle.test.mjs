import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const children = ['A', 'B'].map(id => ({ id, displayName: id, ageLabel: '3 歲', accessRole: 'owner' }));

// Deterministic keyed-component/hook lifecycle harness, not a DOM or pixel test.
// It runs the shipped owners, injection ports, boundary and welcome component.
function harness() {
  let home = { caregiverName: 'parent', selectedChildId: 'A', children, connection: 'online', recordsLoad: 'ready' };
  let preferences = { enabled: true, reducedMotion: false, preferenceReady: true, epoch: 0 };
  let current, cursor, context = new Map(), changed = false, serial = 0, timerId = 0, introPending = true, introConsumed = 0;
  let instances = new Map(), seen = new Map(), layoutEffects = [], effects = [], hostNodes = [], latest;
  const timers = new Map(), animations = [], cache = new Map(), removed = [], ownerValues = new Map(), bridges = [];
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = initialize => { const index = cursor++; return current.slots[index] ??= initialize(); };
  function effect(callback, dependencies, queue) {
    const state = slot(() => ({ dependencies: undefined, cleanup: undefined }));
    if (!sameDeps(dependencies, state.dependencies)) {
      state.dependencies = dependencies;
      queue.push(() => { state.cleanup?.(); state.cleanup = callback(); });
    }
  }
  const react = {
    createContext(value) { const result = { defaultValue: value }; result.Provider = { context: result }; return result; },
    useContext(value) { return context.has(value) ? context.get(value) : value.defaultValue; },
    memo(render) { return { memo: render }; },
    useRef(value) { return slot(() => ({ current: value })); },
    useState(initial) {
      const instance = current;
      const state = slot(() => {
        const value = { value: typeof initial === 'function' ? initial() : initial };
        value.set = update => {
          if (!instance.active) return;
          const next = typeof update === 'function' ? update(value.value) : update;
          if (!Object.is(next, value.value)) { value.value = next; instance.dirty = true; changed = true; }
        };
        return value;
      });
      return [state.value, state.set];
    },
    useMemo(factory, dependencies) {
      const state = slot(() => ({ dependencies: undefined, value: undefined }));
      if (!sameDeps(dependencies, state.dependencies)) { state.dependencies = dependencies; state.value = factory(); }
      return state.value;
    },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useLayoutEffect(callback, dependencies) { effect(callback, dependencies, layoutEffects); },
    useEffect(callback, dependencies) { effect(callback, dependencies, effects); },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const native = { View: 'View', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web' },
    StyleSheet: { create: value => value, absoluteFill: {} } };
  const reanimated = { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' },
    Easing: { bezier: () => value => value }, useSharedValue: value => react.useRef({ value }).current,
    useAnimatedStyle: callback => callback(), cancelAnimation() {}, runOnJS: callback => callback,
    withTiming(value, config, callback) { animations.push({ value, config, callback }); return value; } };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    function resolve(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return native;
      if (name === 'react-native-paper') return { Text: 'Text' };
      if (name === 'react-native-reanimated') return reanimated;
      if (name === 'expo-router') return { usePathname: () => '/' };
      if (name.endsWith('/PreviewContext')) return { usePreview: () => ({ model: home }) };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard() {} };
      if (name.endsWith('/preferences')) return { useMotionPreferences: () => preferences };
      if (name === '../motion') return { ...load(path.join(root, 'src/motion/tokens.ts')), useMotionPreferences: () => preferences };
      if (name.endsWith('/FirstScreenGate')) return { useFirstScreenReady: () => true };
      if (name.endsWith('/HomeBackground')) return { HomeBackground: 'HomeBackground' };
      if (name.endsWith('/theme')) return { colors: { canvas: '#F7FCFC' }, spacing: { lg: 16 }, radius: {}, readingType: {}, workspaceType: {} };
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      const api = load(existsSync(target) ? target : existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
      if (name === './useGrowthPreview' || name === './useMemoryPreview') {
        const symbol = name.slice(2);
        return { ...api, [symbol]: (...args) => { const value = api[symbol](...args); ownerValues.set(current.id, value); return value; } };
      }
      if (name === './useOwnerProjection') return { ...api, useOwnerProjection: (...args) => {
        const value = api.useOwnerProjection(...args); bridges.push({ scopeKey: args[0], ...value }); return value;
      } };
      return api;
    }
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(resolve, module, module.exports,
      callback => { const id = ++timerId; timers.set(id, callback); return id; }, id => timers.delete(id));
    cache.set(filename, module.exports); return module.exports;
  }
  const growth = load(path.join(root, 'src/preview/GrowthWorkspaceProvider.tsx'));
  const memory = load(path.join(root, 'src/preview/MemoryReferenceWorkspaceProvider.tsx'));
  const growthPort = load(path.join(root, 'src/workspaces/GrowthWorkspace.tsx'));
  const memoryPort = load(path.join(root, 'src/workspaces/MemoryReferenceWorkspace.tsx'));
  const { MotionScopeBoundary } = load(path.join(root, 'src/motion/MotionScopeBoundary.tsx'));
  const { HomeWelcome } = load(path.join(root, 'src/components/HomeWelcome.tsx'));
  function Shell() {
    const identity = react.useRef(++serial).current;
    latest = { identity, growth: growthPort.useGrowthWorkspace(), memory: memoryPort.useMemoryReferenceWorkspace(),
      growthTools: growth.useGrowthPreviewTools(), memoryTools: memory.useMemoryReferencePreviewTools() };
    return jsx(MotionScopeBoundary, { scopeKey: `${home.caregiverName}:${home.selectedChildId}`, children:
      jsx(HomeWelcome, { scopeKey: home.selectedChildId, introductionPending: introPending,
        onIntroductionPresented() { introPending = false; introConsumed += 1; } }) });
  }
  const shell = jsx(Shell, {});
  const tree = jsx(memory.MemoryReferenceWorkspaceProvider, { children: jsx(growth.GrowthWorkspaceProvider, { children: shell }) });
  const shallowEqual = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.is(a[key], b[key]));
  function visit(element, location) {
    if (element === null || element === undefined || typeof element !== 'object') return;
    if (Array.isArray(element)) { element.forEach((item, index) => visit(item, `${location}/${item?.key ?? index}`)); return; }
    const { type, props, key } = element, address = `${location}:${key ?? ''}`;
    if (type?.context) {
      const old = context; context = new Map(context); context.set(type.context, props.value);
      visit(props.children, `${address}/provider`); context = old; return;
    }
    if (typeof type === 'function' || type?.memo) {
      let instance = instances.get(address);
      if (!instance || instance.type !== type) instance = { id: ++serial, type, slots: [], active: true, dirty: true };
      seen.set(address, instance);
      if (!type.memo || instance.dirty || !shallowEqual(props, instance.props)) {
        const parent = current, parentCursor = cursor;
        current = instance; cursor = 0; instance.dirty = false;
        instance.output = (type.memo ?? type)(props); instance.props = props;
        current = parent; cursor = parentCursor;
      }
      visit(instance.output, `${address}/render`); return;
    }
    hostNodes.push(element); visit(props.children, `${address}/host`);
  }
  function commit() {
    for (const [location, instance] of instances) if (seen.get(location) !== instance) {
      instance.active = false; removed.push(instance.type.memo?.name ?? instance.type.name);
      for (const state of instance.slots) state?.cleanup?.();
    }
    instances = seen;
    while (layoutEffects.length) layoutEffects.shift()();
    while (effects.length) effects.shift()();
  }
  function render(flush = true) {
    let rounds = 0;
    do {
      assert.ok(++rounds < 16, 'Projection publication must settle without an effect loop');
      seen = new Map(); hostNodes = []; changed = false; visit(tree, 'root');
      if (!flush) break;
      commit();
    } while (changed);
    return latest;
  }
  function finish() {
    let rounds = 0;
    while (animations.length) { assert.ok(++rounds < 10); animations.shift().callback?.(true); render(); }
    return latest;
  }
  return { render, finish, timers, removed, bridges, ownerValues,
    select(id) { home = { ...home, selectedChildId: id }; },
    mutateHome(update) { home = update(home); },
    reduce() { preferences = { ...preferences, enabled: false, reducedMotion: true }; },
    tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); return render(); },
    measure() { hostNodes.find(node => node.props.testID === 'motion-child-scope').props.onLayout({ nativeEvent: { layout: { width: 900 } } }); },
    phase() { return hostNodes.find(node => node.props.testID === 'motion-child-scope').props.dataSet; },
    introConsumed: () => introConsumed,
    owner(name) { return [...instances.values()].find(instance => instance.type.memo?.name === name); },
    unmount() { seen = new Map(); commit(); },
  };
}

test('A -> B -> A preserves the shell/boundary, masks before effects and cleans keyed owners', () => {
  const h = harness(); let value = h.render(); h.measure();
  const shell = value.identity, firstActions = value.growth.actions;
  const firstPublish = h.bridges.filter(item => item.value?.workspace).at(-1).publish;
  const firstProjection = h.bridges.filter(item => item.value?.workspace).at(-1).value;
  const ownerModel = h.ownerValues.get(h.owner('GrowthOwner').id).model;
  assert.equal(value.growth.model, ownerModel, 'The bridge must retain the original model reference');
  assert.equal(value.memory.model.longTerm.data.facts, h.ownerValues.get(h.owner('MemoryReadOwner').id).factsPage.items);
  firstActions.refresh(); h.render(); assert.ok(h.timers.size > 0);
  const oldTimers = [...h.timers.entries()];
  h.select('B'); value = h.render(false);
  assert.equal(value.growth, null); assert.equal(value.memory, null); assert.equal(value.identity, shell);
  firstActions.refresh(); firstPublish(firstProjection);
  value = h.render(); assert.equal(value.growth.model.childId, 'B'); assert.equal(value.memory.model.childId, 'B');
  for (const [id, callback] of oldTimers) { assert.ok(!h.timers.has(id), 'The old scope must cancel its timers'); callback(); }
  value = h.render(); assert.equal(value.growth.model.childId, 'B'); assert.equal(value.growth.model.busy, false);
  assert.equal(h.phase().motionPhase, 'covering'); assert.equal(h.phase().motionScopeGeneration, '1');
  assert.ok(h.removed.includes('GrowthOwner')); assert.ok(h.removed.includes('MemoryReadOwner'));
  h.finish(); assert.equal(h.phase().motionPhase, 'settled');
  h.select('A'); assert.equal(h.render(false).growth, null); h.render();
  firstPublish(firstProjection); firstActions.markDirty('old-A-draft'); firstActions.refresh();
  value = h.render(); assert.equal(value.identity, shell); assert.equal(value.growth.model.childId, 'A');
  assert.equal(value.growth.model.dirty, false); assert.equal(value.growth.model.busy, false);
  assert.equal(h.phase().motionScopeGeneration, '2'); h.finish();
  assert.equal(h.removed.filter(name => name === 'Shell' || name === 'MotionScopeBoundary').length, 0);
});

test('Memory scenario and revocation only replace Memory owner and preserve Growth data and shell', () => {
  const h = harness(); let value = h.render(); h.measure();
  const shell = value.identity, growthOwner = h.owner('GrowthOwner').id;
  const concern = value.growth.model.page.concerns.items[0];
  value.growth.actions.archiveConcern(concern.id, concern.version, value.growth.model.page.authorityVersion); h.render();
  value = h.tick(); h.finish(); const page = value.growth.model.page;
  assert.equal(page.concerns.items[0].status, 'closed');
  const oldMemoryReads = value.memory.reads;
  value.memoryTools.setSourceChanged(true); assert.equal(h.render(false).memory, null); value = h.render();
  assert.equal(value.growth.model.page, page); assert.equal(h.owner('GrowthOwner').id, growthOwner); assert.equal(value.identity, shell);
  value.memoryTools.setExpired(true); h.render(); value = h.render();
  value.memoryTools.setRevoked(true); value = h.render(false); assert.equal(value.memory, null);
  oldMemoryReads.loadMoreFacts(); value = h.render();
  assert.equal(value.memory, null); assert.equal(value.growth.model.page, page); assert.equal(value.identity, shell);
  value.memoryTools.setRevoked(false); value = h.render();
  assert.ok(value.memory); assert.equal(value.growth.model.page, page); assert.equal(h.owner('GrowthOwner').id, growthOwner);
});

test('authority changes and removing a child synchronously mask data and reject old publishers', () => {
  for (const mutate of [home => ({ ...home, caregiverName: 'other-parent' }),
    home => ({ ...home, children: home.children.map(child => ({ ...child, accessRole: 'viewer' })) }),
    home => ({ ...home, selectedChildId: null })]) {
    const h = harness(); const before = h.render();
    const oldBridges = h.bridges.filter(item => item.value);
    h.mutateHome(mutate); let value = h.render(false);
    assert.equal(value.growth, null); assert.equal(value.memory, null);
    for (const bridge of oldBridges) { assert.equal(bridge.isCurrent(), false); bridge.publish(bridge.value); }
    before.growth.actions.markDirty('stale'); value = h.render();
    assert.equal(value.identity, before.identity);
    assert.ok(value.growth === null || value.growth.model.dirty === false);
    h.unmount(); for (const bridge of h.bridges) assert.equal(bridge.isCurrent(), false);
  }
});

test('reduced motion settles immediately and the session welcome is not replayed on child changes', () => {
  const h = harness(); h.render(); h.measure(); h.tick(); h.finish();
  assert.equal(h.introConsumed(), 1);
  h.reduce(); h.render(); h.select('B'); h.render();
  assert.equal(h.phase().motionPhase, 'settled'); assert.equal(h.phase().motionScopeGeneration, '1');
  assert.equal(h.introConsumed(), 1); assert.ok(!h.removed.includes('HomeWelcome'));
});

test('sidebar presses keep text opaque while route entrances remain continuously visible', () => {
  const source = readFileSync(path.join(root, 'src/components/AppShell.tsx'), 'utf8');
  const nav = source.slice(source.indexOf('function NavItem('), source.indexOf('export function PreviewToolbar'));
  assert.match(nav, /pressed && styles\.navPressed/); assert.doesNotMatch(nav, /pressed && styles\.pressed/);
  assert.match(source, /navPressed: \{ backgroundColor: colors\.selectedNav \}/);
  const entrance = readFileSync(path.join(root, 'src/motion/MotionEntrance.tsx'), 'utf8');
  assert.match(entrance, /keepVisible = preset === "route"/); assert.match(entrance, /opacity: keepVisible \? 1 : progress\.value/);
});
