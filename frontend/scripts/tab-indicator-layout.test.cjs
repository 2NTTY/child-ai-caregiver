const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'ShadowRoot']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
const observers = [];
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.nodes = new Set(); observers.push(this); }
  observe(node) { this.nodes.add(node); }
  unobserve(node) { this.nodes.delete(node); }
  disconnect() { this.nodes.clear(); }
};
const React = require('react'), {createRoot} = require('react-dom/client'), RN = require('react-native-web'), ts = require('typescript');
const e = React.createElement, Empty = () => null;
const Surface = React.forwardRef(({children}, ref) => e('div', {ref}, children));
const geometry = new Map();
// jsdom has no layout engine. Supply explicit layout coordinates, separately from
// scaled screen rectangles, while exercising the installed RN Web onLayout path.
for (const [property, field] of [['offsetLeft', 'x'], ['offsetWidth', 'width'], ['offsetHeight', 'height']]) {
  Object.defineProperty(HTMLElement.prototype, property, {configurable: true, get() {return geometry.get(this.id)?.[field] ?? (field === 'height' ? 46 : 0);}});
}
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {configurable: true, get() {return this.parentElement;}});
const theme = {colors: {}, radius: {}, workspaceType: {}, mobileType: {}, mobileIcons: {}, mobileLayout: {breakpoint: 650}, typeScale: {}, spacing: {sm: 8, md: 12}};
let lastMarker, lastRail;
function load(relative, extra = {}) {
  const filename = path.resolve(__dirname, '..', relative), module = {exports: {}};
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (Object.hasOwn(extra, name)) return extra[name];
    if (name === 'react-native') return RN;
    if (name === 'react-native-paper') return {Text: ({children}) => e('span', null, children)};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/MotionSelectionMarker')) return {MotionSelectionMarker: props => {lastMarker = props; return null;}};
    if (name.endsWith('/HorizontalOverflowRail')) return {HorizontalOverflowRail: props => {lastRail = props; return e(Surface, null, props.children);}};
    if (name.endsWith('/useInteractionDensity')) return {useInteractionDensity: () => false};
    if (!name.startsWith('.')) return require(name);
    return new Proxy({}, {get: () => Empty});
  }, module, module.exports);
  return module.exports;
}
const {UnderlineTabs} = load('src/components/ui.tsx');
const flush = async action => React.act(async () => {action?.(); await new Promise(resolve => setTimeout(resolve, 5));});
async function setup(t) {
  geometry.clear(); geometry.set('review-tab-pending', {x: 0, width: 58}); geometry.set('review-tab-saved', {x: 70, width: 58});
  const host = document.body.appendChild(document.createElement('main')), root = createRoot(host), changes = [];
  let props = {id: 'review', value: 'saved', items: [{key: 'pending', label: '待確認'}, {key: 'saved', label: '已保存'}], onChange: key => changes.push(key)};
  const update = next => {props = {...props, ...next}; root.render(e(UnderlineTabs, props));};
  const render = next => flush(() => update(next));
  const resize = async (...keys) => flush(() => {
    const targets = keys.map(key => host.querySelector(`#review-tab-${key}`));
    for (const observer of observers) {const entries = targets.filter(node => observer.nodes.has(node)).map(target => ({target})); if (entries.length) observer.callback(entries);}
  });
  t.after(async () => {await flush(() => root.unmount()); host.remove();});
  await render(); await resize('pending', 'saved');
  return {host, render, update, resize, changes, tab: key => host.querySelector(`#review-tab-${key}`)};
}

test('a preceding count appearing refreshes the unchanged-width selected tab position', async t => {
  const h = await setup(t); assert.equal(lastMarker.x, 70);
  geometry.set('review-tab-pending', {x: 0, width: 94}); geometry.set('review-tab-saved', {x: 106, width: 58});
  await h.render({items: [{key: 'pending', label: '待確認', count: 1}, {key: 'saved', label: '已保存'}]});
  await h.resize('pending'); // The selected tab moved but did not resize.
  assert.equal(lastMarker.x, 106); assert.equal(lastMarker.width, 58);
  assert.deepEqual(lastRail.revealTarget, {key: 'saved', x: 106, width: 58});
  assert.equal(h.tab('saved').getAttribute('aria-selected'), 'true'); assert.equal(h.tab('saved').tabIndex, 0);
});

test('font or sibling resize remeasures every tab and late layout events cannot restore old coordinates', async t => {
  const h = await setup(t);
  geometry.set('review-tab-pending', {x: 0, width: 118}); geometry.set('review-tab-saved', {x: 130, width: 58});
  await h.resize('pending');
  assert.equal(lastMarker.x, 130);
  await flush(() => h.tab('saved').__reactLayoutHandler({nativeEvent: {layout: {x: 70, width: 58}}}));
  assert.equal(lastMarker.x, 130);
  geometry.set('review-tab-pending', {x: 0, width: 58}); geometry.set('review-tab-saved', {x: 70, width: 58});
  await h.resize('pending'); assert.equal(lastMarker.x, 70);
});

test('commit measurement uses physical parent offsets, not scaled screen rectangles or tab order', async t => {
  const h = await setup(t);
  geometry.set('review-tab-pending', {x: 82, width: 94}); geometry.set('review-tab-saved', {x: 12, width: 58});
  h.tab('saved').getBoundingClientRect = () => ({left: 438.8, width: 81.2});
  await h.render({label: 'RTL layout with scaled ancestor'});
  assert.equal(lastMarker.x, 12); assert.equal(lastMarker.width, 58);
  await flush(() => h.tab('saved').dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Home', bubbles: true, cancelable: true})));
  assert.deepEqual(h.changes, ['pending']); assert.equal(document.activeElement, h.tab('pending'));
  assert.equal(h.tab('pending').getAttribute('aria-controls'), 'review-panel-pending');
});

test('rapid selection keeps the latest tab and reveal target without changing activation callbacks', async t => {
  const h = await setup(t);
  const changes = [];
  await h.render({onChange: key => {changes.push(key); h.update({value: key});}});
  // Keep each user activation in its own React commit, without waiting for a marker animation.
  await flush(() => h.tab('pending').click());
  await flush(() => h.tab('saved').click());
  await flush(() => h.tab('pending').click());
  assert.deepEqual(changes, ['pending', 'saved', 'pending']);
  assert.equal(lastMarker.selectionKey, 'review:pending'); assert.equal(lastMarker.x, 0);
  assert.equal(lastRail.revealTarget.key, 'pending');
  assert.equal(h.tab('pending').getAttribute('aria-selected'), 'true'); assert.equal(h.tab('pending').tabIndex, 0);
  assert.equal(h.tab('saved').getAttribute('aria-selected'), 'false'); assert.equal(h.tab('saved').tabIndex, -1);
});

test('selection marker keeps short timing, cancels rapid reversals, and snaps reduced-motion or geometry changes', async t => {
  const preferences = {enabled: true, epoch: 0}, shared = [], scheduled = [];
  const motion = {
    __esModule: true, default: {View: RN.View}, ReduceMotion: {System: 'system'},
    useSharedValue(initial) {
      const ref = React.useRef(null);
      if (!ref.current) {
        const state = {current: initial, pending: null};
        Object.defineProperty(state, 'value', {get() {return state.current;}, set(next) {
          if (next && typeof next === 'object') {state.pending = {...next, from: state.current}; scheduled.push(state.pending);}
          else {state.current = next; state.pending = null;}
        }});
        ref.current = state; shared.push(state);
      }
      return ref.current;
    },
    cancelAnimation(state) {state.pending = null;},
    useAnimatedStyle: calculate => calculate(),
    withTiming: (target, config) => ({target, config}),
  };
  const tokens = load('src/motion/tokens.ts', {'react-native-reanimated': {Easing: {bezier: (...values) => values}}});
  const {MotionSelectionMarker} = load('src/motion/MotionSelectionMarker.tsx', {
    'react-native-reanimated': motion,
    './preferences': {useMotionPreferences: () => preferences},
    './tokens': tokens,
    './viewProps': load('src/motion/viewProps.ts'),
  });
  const host = document.body.appendChild(document.createElement('main')), root = createRoot(host);
  const render = props => flush(() => root.render(e(MotionSelectionMarker, props)));
  const finish = () => {for (const state of shared) if (state.pending) {state.current = state.pending.target; state.pending = null;}};
  t.after(async () => {await flush(() => root.unmount()); assert.ok(shared.every(state => state.pending === null)); host.remove();});
  await render({selectionKey: 'pending', x: 0, width: 94}); assert.equal(scheduled.length, 0);
  await render({selectionKey: 'saved', x: 106, width: 58});
  assert.deepEqual(shared.map(state => state.pending.target), [106, 58]);
  assert.deepEqual(scheduled[0].config, {duration: 180, easing: tokens.motionTokens.ease, reduceMotion: 'system'});
  shared[0].current = 53;
  await render({selectionKey: 'pending', x: 0, width: 94}); assert.equal(shared[0].pending.from, 53);
  await render({selectionKey: 'saved', x: 106, width: 58}); finish();
  assert.deepEqual(shared.map(state => state.current), [106, 58]);
  const beforeResize = scheduled.length;
  await render({selectionKey: 'saved', x: 130, width: 58});
  assert.equal(scheduled.length, beforeResize); assert.deepEqual(shared.map(state => state.current), [130, 58]);
  await render({selectionKey: 'pending', x: 0, width: 94}); assert.ok(shared[0].pending);
  preferences.enabled = false; preferences.epoch++;
  await render({selectionKey: 'saved', x: 106, width: 58});
  assert.ok(shared.every(state => state.pending === null)); assert.deepEqual(shared.map(state => state.current), [106, 58]);
  const marker = host.querySelector('[data-motion-kind="selection"]'); assert.equal(marker.getAttribute('aria-hidden'), 'true');
});

test('native tabs still use their layout event and do not read web offsets', async t => {
  const {UnderlineTabs: NativeTabs} = load('src/components/ui.tsx', {'react-native': {...RN, Platform: {OS: 'android'}}});
  const host = document.body.appendChild(document.createElement('main')), root = createRoot(host);
  t.after(async () => {await flush(() => root.unmount()); host.remove();});
  await flush(() => root.render(e(NativeTabs, {id: 'native', value: 'saved', items: [{key: 'saved', label: '已保存'}], onChange() {}})));
  await flush(() => host.querySelector('[role="tab"]').__reactLayoutHandler({nativeEvent: {layout: {x: 137, width: 75}}}));
  assert.equal(lastMarker.x, 137); assert.equal(lastMarker.width, 75);
});
