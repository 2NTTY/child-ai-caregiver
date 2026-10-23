const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
Object.defineProperty(document.documentElement, 'clientWidth', {value: 1440});
Object.defineProperty(document.documentElement, 'clientHeight', {value: 900});
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected && !this.closest('[hidden]') ? [{}] : [];}});
const React = req('react'), e = React.createElement, {createRoot} = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {return originalLoad.call(this, name === 'react-native' ? 'react-native-web' : name, parent, isMain);};
let width = 1440, guardAllows = true, refusal = false, api, sourceState, sourceActions, networkCalls = 0;
const Empty = () => null;
const View = React.forwardRef(({children, padded, enabled, ...props}, ref) => e(rn.View, {...props, ref}, children));
const Button = React.forwardRef(({label, accessibilityLabel, onPress, disabled, expanded}, ref) => e('button', {ref, onClick: onPress, disabled, 'aria-label': accessibilityLabel ?? label, 'aria-expanded': expanded}, label));
const Text = ({children}) => e('span', null, children);
const Input = React.forwardRef(({label, accessibilityLabel, nativeID, value, onChangeText, onBlur, disabled}, ref) => e('input', {ref, id: nativeID, 'aria-label': accessibilityLabel ?? label, value, onInput: event => onChangeText?.(event.target.value), onChange() {}, onBlur, disabled}));
const Dialog = Object.assign(function Dialog({visible, onDismiss, onClosed, children, accessibilityLabel, testID}) {
  return e(rn.Modal, {visible, transparent: true, animationType: 'none', onRequestClose: onDismiss, onDismiss: onClosed}, e('section', {'data-testid': testID, 'aria-label': accessibilityLabel}, children));
}, Object.fromEntries(['Title', 'Content', 'Actions', 'ScrollArea'].map(key => [key, ({children}) => e('div', null, children)])));
const Scroll = React.forwardRef(({children}, ref) => e('div', {ref, 'data-reader-scroll': true, style: {overflow: 'auto', maxHeight: '600px'}}, children));
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return {Text, HelperText: Text};
    if (name.endsWith('/theme')) return {chineseFont: 'sans-serif', colors: {}, radius: {}, readingType: {}, workspaceType: {}, typeScale: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
    if (name.endsWith('/ui')) return {AppButton: Button, AppTextField: Input, AppSelect: Empty, AppTabPanel: View, UnderlineTabs: Empty, AppSelectionTrigger: Button, SectionHeader: ({action}) => e('header', null, action), SectionCard: View};
    if (name.endsWith('/AppIcon')) return {AppIcon: Empty};
    if (name.endsWith('/AppStatusBadge')) return {AppStatusBadge: Empty};
    if (name.endsWith('/ReadStateNotice')) return {ReadStateNotice: View};
    if (name.endsWith('/OperationNotice')) return {OperationNotice: ({visible, message, referenceLabel, children}) => visible ? e(View, null, e('span', null, message, referenceLabel), children) : null};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/BackgroundSurface')) return {BackgroundSurface: View, useCustomBackground: () => false};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => callback => {if (guardAllows) callback();}, usePreviewLeaveGuard: Empty};
    if (name.endsWith('/AppDialog')) return {AppDialog: Dialog};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: Scroll};
    if (name.endsWith('/StatusAnnouncement')) return {StatusAnnouncement: Empty};
    if (name.endsWith('/AppCheckbox')) return {AppCheckbox: ({label, checked, onChange, disabled}) => e('input', {type: 'checkbox', 'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked)})};
    if (name.endsWith('/motion')) return {MotionReveal: ({children, value}) => children(value), MotionDisclosure: ({children, expanded}) => expanded ? children : null};
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const {CareSavedRecordsView} = load('src/components/care/CareSavedRecordsView.tsx');
const {CareReviewHistoryView} = load('src/components/care/CareReviewHistoryView.tsx');
const {useCarePreview} = load('src/preview/useCarePreview.ts');
const app = createRoot(document.getElementById('root'));
const byLabel = label => [...document.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === label) ?? null;
const dialog = () => document.querySelector('[data-testid="manual-form-dialog"]');
const scroll = () => document.querySelector('[data-reader-scroll]');
const countModals = () => [...document.querySelectorAll('[aria-modal="true"]')].length;
const rows = mode => [...document.querySelectorAll(mode === 'saved' ? '[data-testid^="care-history-card-"]' : '[data-testid="care-review-row"]')];
const list = mode => document.querySelector(`[data-testid="${mode === 'saved' ? 'care-history-list' : 'care-review-list'}"]`);
const originalFetch = global.fetch;
global.fetch = () => {networkCalls++; throw new Error('No transport is allowed.');};
function Host({mode, scope = 'synthetic:child-a'}) {
  const owner = useCarePreview({id: scope.endsWith('b') ? 'preview-child-2' : 'preview-child-1', name: 'Synthetic child', accessRole: 'owner'}, true, false, undefined, undefined, scope, 'history');
  api = owner; sourceState = owner.model; sourceActions = owner.actions;
  const [projection, setProjection] = React.useState(null);
  const model = projection ? projection(owner.model) : owner.model;
  const actions = {...owner.actions, closePanel() {if (!refusal) owner.actions.closePanel();}};
  api.setProjection = transform => setProjection(() => transform);
  return e(mode === 'saved' ? CareSavedRecordsView : CareReviewHistoryView, {model, actions});
}
async function setup(mode) {
  refusal = false; guardAllows = true; width = 1440;
  await React.act(async () => app.render(null));
  await React.act(async () => app.render(e(Host, {mode})));
  return {card: rows(mode)[1] ?? rows(mode)[0], list: list(mode)};
}
async function click(target) {assert.ok(target); await React.act(async () => {target.focus(); target.click();});}
async function close() {await click(dialog().querySelector('button[aria-label^="關閉"]'));}
let stopped = false;
function register(name, run) {test(name, async t => {if (stopped) {t.skip('Stopped after first failure.'); return;} try {await run();} catch(error) {stopped = true; throw error;}});}
for (const mode of ['saved', 'review']) register(`${mode}: same list/card/width/scroll, true modal focus, close and reopen`, async () => {
  const before = await setup(mode); before.list.scrollTop = 640; const style = before.list.getAttribute('style');
  await click(before.card); assert.ok(dialog()); assert.equal(countModals(), 1); assert.ok(dialog().contains(document.activeElement));
  assert.equal(list(mode), before.list); assert.ok(before.card.isConnected); assert.equal(before.list.getAttribute('style'), style); assert.equal(before.list.scrollTop, 640);
  const reader = scroll(); reader.scrollTop = 260;
  await React.act(async () => api.setProjection(model => ({...model, list: {...model.list, state: 'loading', hasSnapshot: true}})));
  assert.equal(scroll(), reader); assert.equal(reader.scrollTop, 260, 'Quiet refresh retains the reader scroll host');
  await React.act(async () => api.setProjection(null));
  for (const nextWidth of [390, 320, 1024]) {width = nextWidth; await React.act(async () => app.render(e(Host, {mode}))); assert.equal(list(mode), before.list); assert.equal(before.list.scrollTop, 640);}
  await close(); assert.equal(dialog(), null); assert.equal(document.activeElement, before.card); assert.equal(before.list.scrollTop, 640);
  const next = rows(mode).find(node => node !== before.card); await click(next); assert.ok(dialog()); assert.notEqual(scroll(), reader); assert.equal(scroll().scrollTop, 0); await close(); assert.equal(document.activeElement, next);
});
register('modal Escape restores the clicked card, and a hidden original card falls back to its retained list', async () => {
  const before = await setup('saved'); await click(before.card);
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true})));
  assert.equal(dialog(), null); assert.equal(document.activeElement, before.card);
  await click(before.card); before.card.hidden = true; await close();
  assert.equal(dialog(), null); assert.equal(document.activeElement, before.list);
});
register('saved: correction and deletion replace reader inside exactly one modal; refusal and guards preserve the owner draft', async () => {
  const before = await setup('saved'); await click(before.card); const host = dialog();
  await click(byLabel('更正這筆記錄')); assert.ok(sourceState.draft); let originalDraft = sourceState.draft;
  assert.equal(dialog(), host); assert.equal(countModals(), 1); assert.ok(byLabel('記錄原文草稿'));
  const input = byLabel('記錄原文草稿');
  await React.act(async () => {input.value = 'Synthetic unsaved edit'; input.dispatchEvent(new window.Event('input', {bubbles: true}));});
  width = 390; await React.act(async () => app.render(e(Host, {mode: 'saved'})));
  assert.equal(byLabel('記錄原文草稿'), input); assert.equal(input.value, 'Synthetic unsaved edit'); originalDraft = sourceState.draft;
  guardAllows = false; await close(); assert.equal(sourceState.draft, originalDraft); assert.ok(dialog());
  guardAllows = true; refusal = true; await close(); assert.equal(sourceState.draft, originalDraft); assert.ok(dialog());
  refusal = false; await close(); assert.equal(sourceState.draft, null); assert.equal(dialog(), null); assert.equal(document.activeElement, before.card);
  await click(before.card); await click(byLabel('永久刪除此記錄及歷史')); assert.ok(sourceState.deletion); assert.equal(countModals(), 1); assert.equal(byLabel('記錄原文草稿'), null);
  await click(byLabel('取消刪除記錄')); assert.equal(sourceState.deletion, null); assert.equal(dialog(), null); assert.equal(document.activeElement, before.card);
});
register('saved: same-record history/version refresh keeps scroll; owner refusal/unknown cannot dismiss or change original opId', async () => {
  const before = await setup('saved'); await click(before.card); const reader = scroll(); reader.scrollTop = 321;
  await click(byLabel('更正歷史')); assert.equal(scroll(), reader); assert.equal(reader.scrollTop, 321);
  await React.act(async () => api.setProjection(model => ({...model, detail: {...model.detail, record: {...model.detail.record, current: {...model.detail.record.current, version: model.detail.record.current.version + 1}}}})));
  assert.equal(scroll(), reader); assert.equal(reader.scrollTop, 321);
  refusal = true; await close(); assert.ok(dialog()); assert.ok(sourceState.detail);
  await React.act(async () => api.setProjection(model => ({...model, operation: {state: 'unknown', reference: 'original-operation', message: 'Synthetic pending'}})));
  await close(); assert.ok(dialog()); assert.equal(scroll(), reader); assert.match(document.body.textContent, /original-operation/);
  refusal = false; await React.act(async () => api.setProjection(null)); await close(); assert.equal(document.activeElement, before.card);
});
register('review: adjusting a capture retains one modal and its owner draft, then returns to that capture before closing to its card', async () => {
  await setup('review'); await React.act(async () => api.changeCondition('prior_consent'));
  let card;
  for (const candidate of rows('review')) {await click(candidate); if (byLabel('先調整內容')) {card = candidate; break;} await close();}
  assert.ok(card); const host = dialog(); const captureId = sourceState.review.items.find(item => document.body.textContent.includes(item.originalText))?.id;
  await click(byLabel('先調整內容')); assert.ok(sourceState.draft?.captureSnapshot); const snapshot = sourceState.draft.captureSnapshot;
  assert.equal(dialog(), host); assert.equal(countModals(), 1);
  const draftKey = sourceState.draft.key, field = byLabel('記錄原文草稿');
  await React.act(async () => {field.value = 'Synthetic capture edit'; field.dispatchEvent(new window.Event('input', {bubbles: true}));});
  await React.act(async () => api.invalidateCaptureSource());
  assert.equal(sourceState.draft.key, draftKey); assert.equal(byLabel('記錄原文草稿'), field); assert.equal(field.value, 'Synthetic capture edit');
  assert.equal(sourceState.review.items.find(item => item.id === snapshot.id).sourceState, 'changed');
  await close(); assert.equal(sourceState.draft, null); assert.ok(dialog()); assert.equal(countModals(), 1); assert.match(dialog().textContent, new RegExp(snapshot.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await close(); assert.equal(dialog(), null); assert.equal(document.activeElement, card);
});
register('a real pending/unknown synthetic operation keeps the same draft, modal and original reference', async () => {
  const before = await setup('saved'); await click(before.card); await click(byLabel('更正這筆記錄'));
  await React.act(async () => api.setOutcome('unknown'));
  await React.act(async () => api.actions.reviewDraft({...sourceState.draft.initialValues, text: 'Synthetic reviewed correction', reason: 'Synthetic correction reason'}));
  await React.act(async () => api.actions.submitReviewed());
  assert.equal(sourceState.operation.state, 'saving'); const reference = sourceState.operation.reference, draftKey = sourceState.draft.key;
  await close(); assert.equal(sourceState.draft.key, draftKey); assert.equal(sourceState.operation.reference, reference); assert.ok(dialog());
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 410)));
  assert.equal(sourceState.operation.state, 'unknown'); await close();
  assert.equal(sourceState.operation.reference, reference); assert.equal(sourceState.draft.key, draftKey); assert.ok(dialog()); assert.equal(countModals(), 1);
});
register('scope/access invalidation removes the old reader without transport', async () => {
  await setup('saved'); await click(rows('saved')[0]);
  await React.act(async () => api.changeCondition('access_lost')); assert.equal(dialog(), null); assert.equal(rows('saved').length, 0);
  await setup('review'); await click(rows('review')[0]); await React.act(async () => app.render(e(Host, {mode: 'review', scope: 'synthetic:child-b'})));
  assert.equal(dialog(), null); assert.equal(networkCalls, 0);
});
test.after(async () => {await React.act(async () => app.unmount()); global.fetch = originalFetch; Module._load = originalLoad; dom.window.close();});
