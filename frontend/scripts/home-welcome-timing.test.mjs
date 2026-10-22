import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function loadAppearanceStyle(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../src/components/appearance/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name.endsWith('.css'), `Unexpected style dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

// Shipped HomeWelcome with deterministic hook, frame and timer ports; not browser pixels.
function harness({ ready = false, active = true, reducedMotion = false, timestamp, compact = false, platform = 'web' } = {}) {
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
    if (name === 'react-native') return { StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } }, View: 'View' };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'react-native-reanimated') return { __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' },
      useSharedValue: value => react.useRef({ value }).current, useAnimatedStyle: callback => callback(), cancelAnimation() {}, runOnJS: callback => callback,
      withTiming: (value, config, callback) => { animations.push({ config, callback }); return value; } };
    if (name === '../motion') return { useMotionPreferences: () => preferences, motionTokens: {} };
    if (name.endsWith('/FirstScreenGate')) return { useFirstScreenReady: () => ready };
    if (name.endsWith('/theme')) return { colors: { paper: '#fff' }, spacing: { lg: 16 }, radius: {}, readingType: {}, workspaceType: {} };
    if (name.endsWith('/HomeBackground')) return { HomeBackground: 'HomeBackground' };
    if (name.endsWith('/background-surface-style')) return loadAppearanceStyle(`background-surface-style${platform === 'web' ? '.web' : ''}.ts`);
    if (name.endsWith('/home-welcome-glass-style')) return loadAppearanceStyle(`home-welcome-glass-style${platform === 'web' ? '.web' : ''}.ts`);
    assert.fail(name);
  };
  const CurrentDate = timestamp ? class extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } } : Date;
  new Function('require', 'module', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date', code)(resolve, module, module.exports,
    callback => { const id = ++serial; frames.set(id, callback); return id; }, id => frames.delete(id),
    (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; }, id => timers.delete(id), CurrentDate);
  const render = () => { let rounds = 0; do { assert.ok(++rounds < 12); dirty = false; cursor = 0;
    tree = module.exports.HomeWelcome({ scopeKey, introductionPending: consumed === 0, onIntroductionPresented: () => consumed++, compact });
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

function textContent(node) {
  if (node === null || node === undefined) return '';
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (typeof node !== 'object') return String(node);
  return textContent(node.props?.children);
}

test('greeting subline uses the current Hong Kong date instead of the former slogan or a fixed example', () => {
  for (const [timestamp, date] of [['2026-10-21T16:05:00Z', '10月22日'], ['2026-10-22T16:05:00Z', '10月23日']]) {
    const h = harness({ timestamp });
    assert.equal(textContent(h.render()), `你好${date} · 先看重要的，再繼續日常`);
  }
});

function renderBackground(props, { platform = 'web', selected = {}, fallback = false } = {}) {
  const module = { exports: {} }, measurements = [], readiness = [];
  const startup = { fallback, onLoad() {}, onError() {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/appearance/HomeBackground.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return { useId: () => 'synthetic-image' };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { Platform: { OS: platform }, Image: 'Image', View: 'View', StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } } };
    if (name.endsWith('/BackgroundContext')) return { defaultHomeBackground: 'existing-harbour-asset', useBackground: () => ({ selected, source: 'custom-image' }) };
    if (name.endsWith('/FirstScreenGate')) return { useFirstScreenImage: (key, ready) => { readiness.push(ready); return startup; } };
    if (name.endsWith('/useContainerSize')) return { useContainerSize: enabled => { measurements.push(enabled); return { ref: {}, size: { width: 1120, height: 246.4 } }; } };
    return new Proxy({}, { get: (_, symbol) => String(symbol) });
  }, module, module.exports);
  return { tree: module.exports.HomeBackground(props), measurements, readiness, startup };
}

const flattenStyle = style => Object.assign({}, ...[style].flat().filter(Boolean));
const welcomeBackground = tree => tree.props.children.props.children[1].props.children;

test('welcome frost belongs only to an empty background plane, with unchanged artwork geometry and sharp copy', () => {
  for (const compact of [false, true]) for (const platform of ['web', 'android']) {
    const card = harness({ compact, platform }).render().props.children;
    const [glass, artwork, copy] = card.props.children;
    const background = artwork.props.children;
    assert.equal(glass.props.testID, 'home-welcome-glass');
    assert.equal(glass.props.children, undefined, 'the blur plane must not contain text, artwork or cards');
    assert.equal(glass.props.pointerEvents, 'none');
    assert.equal(glass.props['aria-hidden'], true);
    assert.deepEqual(flattenStyle(glass.props.style), { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#fff' });
    assert.equal(flattenStyle(card.props.style).backgroundColor, undefined, 'the outer card cannot obscure the glass with a solid fill');
    assert.equal(flattenStyle(card.props.style).minHeight, compact ? 152 : 176);
    assert.equal(flattenStyle(card.props.style).maxWidth, compact ? undefined : 800);
    assert.equal(artwork.props.testID, 'home-welcome-artwork');
    assert.equal(background.type, 'HomeBackground');
    assert.equal(background.props.useCustomImage, false, 'selected backgrounds remain behind, not in place of, the existing artwork');
    assert.equal(background.props.fadeStart, compact ? 0.48 : 0.64);
    assert.equal(background.props.fadeEnd, compact ? 0.68 : 0.88);
    const artworkStyle = flattenStyle(artwork.props.style);
    assert.deepEqual(Object.fromEntries(['position', 'top', 'right', 'bottom', 'left'].map(key => [key, artworkStyle[key]])), { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
    for (const node of [card, glass, artwork, copy, ...copy.props.children]) {
      assert.equal(flattenStyle(node.props.style).filter, undefined, 'foreground content must never receive filter blur');
      assert.equal(flattenStyle(node.props.style).backdropFilter, undefined, 'only the existing background CSS owns backdrop blur');
    }
    if (platform === 'web') {
      assert.deepEqual(glass.props.dataSet, { backgroundSurface: 'frosted' });
      assert.deepEqual(artwork.props.dataSet, { homeWelcomeArtwork: 'true' });
      assert.equal(artworkStyle.maskImage, `linear-gradient(to right, transparent 0%, transparent ${background.props.fadeStart * 100}%, #000 ${background.props.fadeEnd * 100}%, #000 100%)`);
      assert.equal(artworkStyle.WebkitMaskImage, artworkStyle.maskImage);
    } else {
      assert.equal(glass.props.dataSet, undefined);
      assert.equal(artwork.props.dataSet, undefined);
      assert.equal(artworkStyle.maskImage, undefined);
      assert.equal(artworkStyle.WebkitMaskImage, undefined);
    }
  }
});

test('welcome reuses readable glass fallbacks and keeps the original fade when CSS masks are unsupported', () => {
  const css = readFileSync(new URL('../src/components/appearance/homeWelcomeGlass.css', import.meta.url), 'utf8');
  assert.match(css, /@supports \(\(mask-image: linear-gradient/);
  assert.match(css, /-webkit-mask-image: linear-gradient/);
  assert.match(css, /\[data-home-welcome-artwork="true"\] \[data-testid="home-background-css-fade"\] \{\s*display: none;/);
  assert.equal((css.match(/display: none/g) ?? []).length, 1);
  assert.doesNotMatch(css, /(?:filter|mix-blend-mode)\s*:/);
  const surface = readFileSync(new URL('../src/components/appearance/backgroundSurface.css', import.meta.url), 'utf8');
  assert.match(surface, /\[data-background-surface\] \{\s*background-color: #fffffe !important;/);
  assert.match(surface, /@supports[\s\S]*rgba\(255, 255, 254, 0\.84\)/);
  assert.match(surface, /backdrop-filter: blur\(12px\)/);
  assert.match(surface, /prefers-reduced-transparency: reduce/);
  assert.match(surface, /forced-colors: active/);
  assert.match(surface, /backdrop-filter: none/);
  assert.deepEqual(loadAppearanceStyle('home-welcome-glass-style.ts').homeWelcomeArtworkProps(0.64, 0.88), {});
  assert.deepEqual(loadAppearanceStyle('background-surface-style.ts').backgroundSurfaceProps(true), {});
});

test('installed RN Web preserves the local standard and prefixed CSS mask without applying a foreground filter', () => {
  const { View } = createRequire(import.meta.url)('react-native-web');
  const props = loadAppearanceStyle('home-welcome-glass-style.web.ts').homeWelcomeArtworkProps(0.64, 0.88);
  const html = renderToStaticMarkup(createElement(View, props));
  assert.match(html, /data-home-welcome-artwork="true"/);
  assert.match(html, /mask-image:linear-gradient\(to right, transparent 0%, transparent 64%, #000 88%, #000 100%\)/);
  assert.match(html, /-webkit-mask-image:/);
  assert.doesNotMatch(html, /(?:backdrop-)?filter:/);
});

test('welcome contains the complete height-anchored illustration without feeding zoomed measurements into styles', () => {
  for (const compact of [false, true]) for (const platform of ['web', 'android']) {
    const background = welcomeBackground(harness({ compact, platform }).render());
    assert.equal(background.type, 'HomeBackground');
    assert.equal(background.props.useCustomImage, false);
    assert.equal(background.props.containIllustration, true);
    assert.equal(background.props.webCssFade, true);
    assert.equal(background.props.wideIllustration, undefined);
    assert.equal(background.props.illustrationMinWidth, undefined);
    assert.equal(background.props.fitIllustration, undefined);
    assert.equal(background.props.fadeBottom, undefined);
    const { tree, measurements, readiness, startup } = renderBackground(background.props, { platform });
    const [frame, fade] = tree.props.children, illustration = frame.props.children;
    assert.deepEqual(measurements, [false]);
    assert.deepEqual(readiness, [true]);
    assert.equal(frame.props.testID, 'home-illustration-frame');
    assert.deepEqual(flattenStyle(frame.props.style), { position: 'absolute', right: 0, top: 0, height: '100%', aspectRatio: 1672 / 941 });
    assert.equal(illustration.props.source, 'existing-harbour-asset');
    assert.equal(illustration.props.resizeMode, 'contain');
    assert.equal(illustration.props.onLoad, startup.onLoad);
    assert.equal(illustration.props.onError, startup.onError);
    const style = flattenStyle(illustration.props.style);
    assert.equal(style.width, '100%');
    assert.equal(style.height, '100%');
    assert.equal(style.left, 0);
    assert.equal(style.right, 0);
    assert.equal(style.top, 0);
    if (platform === 'web') {
      assert.equal(fade.type, 'View');
      assert.equal(fade.props.testID, 'home-background-css-fade');
      assert.equal(flattenStyle(fade.props.style).backgroundImage,
        `linear-gradient(to right, #fff 0%, #fff ${compact ? 48 : 64}%, transparent ${compact ? 68 : 88}%, transparent 100%)`);
    } else {
      assert.equal(fade.type, 'default');
      const stops = fade.props.children[0].props.children[0].props.children;
      assert.equal(stops[1].props.offset, compact ? 0.48 : 0.64);
      assert.equal(stops[2].props.offset, compact ? 0.68 : 0.88);
      assert.equal(stops[2].props.stopOpacity, 0);
    }
  }
});

test('other backgrounds retain default cover/custom image and SVG protection; welcome fallback still settles without an image', () => {
  for (const props of [{ surface: '#fff' }, { surface: '#fff', wideIllustration: true },
    { surface: '#fff', webCssFade: true, protectFullWidth: true }, { surface: '#fff', webCssFade: true, fadeBottom: true }]) {
    const { tree } = renderBackground(props);
    const [illustration, svg] = tree.props.children;
    assert.equal(illustration.type, 'Image');
    assert.equal(illustration.props.source, 'custom-image');
    assert.equal(illustration.props.resizeMode, 'cover');
    assert.equal(svg.type, 'default');
    const stops = svg.props.children[0].props.children[0].props.children;
    assert.equal(stops[1].props.offset, 0.64);
    assert.equal(stops[2].props.offset, 0.88);
    assert.equal(stops[2].props.stopOpacity, props.protectFullWidth ? 0.94 : 0);
  }
  const { tree } = renderBackground({ surface: '#fff', useCustomImage: false, wideIllustration: true, illustrationMinWidth: 260 });
  assert.equal(tree.props.children[0].props.resizeMode, 'cover');
  assert.equal(flattenStyle(tree.props.children[0].props.style).minWidth, 260);
  const welcome = welcomeBackground(harness().render());
  const fallback = renderBackground(welcome.props, { fallback: true });
  assert.equal(fallback.tree.props.children[0], null);
  assert.deepEqual(fallback.readiness, [true]);
  assert.equal(fallback.tree.props.children[1].props.testID, 'home-background-css-fade');
});

test('desktop and mobile keep the today navigation anchor on the reading panel without a duplicate date row', () => {
  for (const component of ['HomeDashboard', 'MobileHomeDashboard']) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const jsx = (type, props) => ({ type, props });
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react') return { useRef: value => ({ current: value }), useState: value => [value, () => {}], useLayoutEffect() {} };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { Platform: { OS: 'web' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 1440 }), View: 'View' };
      if (name === '../theme') return { colors: {}, spacing: {}, readingType: {}, workspaceType: {}, mobileLayout: {}, mobileType: {} };
      if (name === '../home-agent-entry') return { homeAgentScope: () => 'synthetic-scope' };
      return new Proxy({}, { get: (_, symbol) => String(symbol) });
    }, module, module.exports);
    const tree = module.exports[component]({ model: { profileLoad: 'ready', children: [{}] }, actions: {} });
    const [greeting, panel] = tree.props.children;
    assert.equal(greeting.type, 'HomeWelcome');
    assert.equal(panel.props.testID, 'home-reading-panel');
    assert.equal(panel.props.role, 'region');
    assert.equal(panel.props.accessibilityLabel, '今日');
    assert.equal(panel.props.tabIndex, -1);
    assert.equal(panel.props.dataSet.pageSurface, 'true');
    assert.equal(panel.props.children.some(child => child?.type === 'HomeTodayHeading'), false);
    assert.equal(textContent(panel), '');
  }
});

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
