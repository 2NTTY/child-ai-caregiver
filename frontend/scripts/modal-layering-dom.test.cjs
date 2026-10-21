const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {pretendToBeVisual: true, url: 'http://localhost/'});
for (const key of ['window','document','HTMLElement','Element','Node','ShadowRoot','Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM has no layout; only the connected/hidden measurement port is synthetic.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : [];}});
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), {createRoot} = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript');
const e = React.createElement;
// Real installed Paper provider/portal context topology; safe-area geometry and icons are host ports.
const Module = require('node:module'), originalLoad = Module._load;
let PaperProvider, PaperPortal;
try {
  Module._load = function(name, ...args) {
    if (name === 'react-native') return native;
    if (name.endsWith('/SafeAreaProviderCompat')) return {__esModule: true, default: p => p.children};
    if (name.endsWith('/MaterialCommunityIcon')) return {__esModule: true, default: () => null};
    return originalLoad.call(this, name, ...args);
  };
  const paperRoot = path.dirname(req.resolve('react-native-paper'));
  PaperProvider = req(path.join(paperRoot, 'core/PaperProvider')).default;
  PaperPortal = req(path.join(paperRoot, 'components/Portal/Portal')).default;
} finally {Module._load = originalLoad;}
const paper = child => e(PaperProvider, {theme: {version: 3}}, child);
// True installed RN Web Modal/ModalPortal/ModalFocusTrap and true product guard/wrapper.
// Dialog appearance is a semantic body port; browser pixel/hit-testing is a separate gate.
function Dialog({visible, onDismiss, onClosed, children, testID, accessibilityLabel}) {
  return e(native.Modal, {visible, transparent: true, animationType: 'none', onRequestClose: onDismiss, onDismiss: onClosed, 'aria-label': accessibilityLabel},
    e('section', {'data-testid': testID}, children));
}
Dialog.Title = p => e('h2', null, p.children); Dialog.Content = Dialog.ScrollArea = Dialog.Actions = p => e('div', null, p.children);
const Group = p => e('div', null, p.children);
const Field = React.forwardRef(({multiline, accessibilityLabel, value, onChangeText, onBlur, disabled}, ref) => e(multiline ? 'textarea' : 'input', {ref, 'aria-label': accessibilityLabel, value, onChange: event => onChangeText(event.target.value), onBlur, disabled}));
const Button = React.forwardRef(({label, accessibilityLabel, onPress, disabled}, ref) => e('button', {ref, disabled, 'aria-label': accessibilityLabel, onClick: onPress}, label));
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const module = {exports: {}}; cache.set(file, module.exports);
  new Function('require','module','exports',code)(name => {
    if (name === 'react-native') return native;
    if (name === 'react-native-paper') return {Text: p => e('p', null, p.children), Portal: PaperPortal};
    if (name.endsWith('/AppDialog')) return {AppDialog: Dialog};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: p => e('div', null, p.children)};
    if (name.endsWith('/ui')) return {AppButton: Button, AppTextField: Field, SectionCard: Group, SectionHeader: () => null, AppTabPanel: Group, UnderlineTabs: () => null,
      AppSelect: ({label, value, options, onChange, disabled}) => e('select', {'aria-label': label, value, disabled, onChange: event => onChange(event.target.value)}, options.map(o => e('option', {key: o.value, value: o.value}, o.label)))};
    if (name.endsWith('/FormErrorSummary')) return {FormErrorSummary: () => null, FormFieldMessage: () => null};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 320, ref: null, onLayout() {}})};
    if (name.endsWith('/motion')) return {MotionDetail: Group, MotionDisclosure: Group, MotionList: () => null};
    if (name.endsWith('/TaskForm')) return {TaskForm: Form};
    if (name.endsWith('/TaskContent')) return {taskAssigneeLabel: () => 'Synthetic parent'};
    if (['WriteRecoveryNotice','ReadStateNotice','StatusAnnouncement','TasksCalendar','TaskDetail','TaskListRow','AppIcon','EmptyListCard'].some(symbol => name.endsWith('/' + symbol))) return new Proxy({}, {get: () => () => null});
    if (name.endsWith('/theme')) return {colors: {}, radius: {}, spacing: {}, typeScale: {}, mobileLayout: {breakpoint: 650}, mobileType: {}, readingType: {}, workspaceType: {}};
    if (name.endsWith('/PreviewNavigationGuard')) return load('src/preview/PreviewNavigationGuard.tsx');
    if (name.endsWith('/browser-history-guard')) return {guardBrowserHistory: () => () => {}};
    if (name.endsWith('/production/routes')) return {isProductionRouteConnected: () => true};
    if (name === 'expo-router') return {usePathname: () => '/tasks', useRouter: () => ({}), Link: 'a'};
    if (name === 'expo-router/react-navigation') return {useNavigation: () => ({}), usePreventRemove() {}};
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(path.join(root, file)), name);
      const found = [base, base + '.tsx', base + '.ts'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const {PreviewNavigationGuard, usePreviewLeaveGuard} = load('src/preview/PreviewNavigationGuard.tsx');
const {ManualFormDialog, FormDialog} = load('src/components/FormDialog.tsx');
let dirty = false, pending = false, mounts = 0, unmounts = 0, checks = 0;
function Form() {
  React.useEffect(() => {mounts++; return () => unmounts++;}, []);
  usePreviewLeaveGuard(dirty, pending);
  return e('input', {'aria-label': 'Synthetic draft', defaultValue: 'Synthetic unsent text'});
}
function Page() {return e(PreviewNavigationGuard, null, e(ManualFormDialog, {label: 'Manual entry', title: 'Synthetic form', scopeKey: 'child-a', recovery: e(Button, {label: 'Check original', onPress: () => checks++})}, e(Form)));}
const renderer = createRoot(document.getElementById('root'));
async function render() {await React.act(async () => renderer.render(paper(e(Page))));}
function button(label) {const value = [...document.querySelectorAll('button')].find(n => n.textContent === label); assert.ok(value, label); return value;}
async function click(label) {await React.act(async () => { const target = button(label); target.focus(); target.click(); });}
function portalOf(node) {let value = node; while (value.parentElement && value.parentElement !== document.body) value = value.parentElement; return value;}
function assertTopDialog(label) {
  const prompt = button(label), form = document.querySelector('input,textarea');
  const formPortal = portalOf(form), promptPortal = portalOf(prompt);
  assert.notEqual(formPortal, promptPortal);
  assert.ok(formPortal.compareDocumentPosition(promptPortal) & Node.DOCUMENT_POSITION_FOLLOWING, 'new prompt portal must follow the form at RNW equal z-index');
  const active = document.querySelectorAll('[role="dialog"]'); assert.equal(active.length, 1);
  assert.ok(active[0].contains(prompt)); assert.ok(active[0].contains(document.activeElement), 'only the top prompt owns focus');
}

test('dirty confirmation is mounted above an already-open form; staying retains fields and returns active focus ownership', async () => {
  await render(); await click('Manual entry'); const input = document.querySelector('input'); input.focus();
  dirty = true; await render(); await click('關閉'); assertTopDialog('繼續編輯');
  await click('繼續編輯'); assert.equal(document.querySelector('input'), input); assert.equal(input.value, 'Synthetic unsent text');
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
  assert.ok(document.querySelector('[role="dialog"]').contains(input));
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement));
  await click('關閉'); assertTopDialog('繼續編輯');
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true})));
  assert.equal(document.querySelector('input'), input); assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement));
  await click('關閉'); assertTopDialog('捨棄草稿並離開'); await click('捨棄草稿並離開');
  assert.equal(document.querySelector('input'), null); assert.equal(unmounts, 1);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0); assert.equal(document.activeElement, button('Manual entry'));
});
test('pending warning also sits above the form, never offers discard, and leaves original recovery reachable', async () => {
  dirty = false; await click('Manual entry'); pending = true; await render();
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true})));
  assertTopDialog('留在此頁查核'); assert.equal([...document.querySelectorAll('button')].some(n => n.textContent === '捨棄草稿並離開'), false);
  await click('留在此頁查核'); await click('Check original'); assert.equal(checks, 1); assert.ok(document.querySelector('input'));
  pending = false; await render(); await click('關閉');
});


test('controlled form explicitly returns to its previously disabled trigger after both modal traps release', async () => {
  let created = 0, discarded = 0;
  function ControlledPage() {
    const [open, setOpen] = React.useState(false), trigger = React.useRef(null);
    return e(PreviewNavigationGuard, null, e('div', null,
      e(Button, {ref: trigger, label: 'Controlled create', disabled: open, onPress() {created++; setOpen(true);}}),
      e(FormDialog, {visible: open, scopeKey: 'child-a', formKey: created, title: 'Controlled form', returnFocusRef: trigger,
        onClose() {discarded++; setOpen(false);}}, e(Form))));
  }
  await React.act(async () => renderer.render(paper(e(ControlledPage))));
  dirty = true; await click('Controlled create'); assert.equal(button('Controlled create').disabled, true);
  await click('關閉'); assertTopDialog('捨棄草稿並離開'); await click('捨棄草稿並離開');
  assert.equal(discarded, 1); assert.equal(button('Controlled create').disabled, false);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal(document.activeElement, button('Controlled create'));
  await React.act(async () => renderer.render(null));
});


// Exercise the shipped ProductionContext and hook without constructing a live owner/transport.
const productionSource = ts.transpileModule(fs.readFileSync(path.join(root, 'src/production/ProductionProvider.tsx'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const productionModule = {exports: {}};
new Function('require','module','exports',productionSource + '\nexports.testContext = ProductionContext;')(name => name === 'react' ? React : {}, productionModule, productionModule.exports);
const productionValue = {identityKey: 'synthetic-user-a', scopeKey: 'synthetic-child-a'};
function ProductionProbe() {assert.equal(productionModule.exports.useProduction(), productionValue); return null;}
const SourceComposer = load('src/components/shared-inputs/SourceComposer.tsx').SourceComposer;
test('real source composer local RHF draft survives stay and preserves production/guard contexts through the modal', async () => {
  let open = false, closes = 0, lookups = 0;
  const model = {sources: [], childName: 'Synthetic child', accountName: 'Synthetic parent', busy: false, canChoose: true, access: 'editable', fresh: true, canCreate: true, operation: {state: 'none'}};
  function SourcePage() {
    const trigger = React.useRef(null);
    return e(PreviewNavigationGuard, null, e(productionModule.exports.testContext.Provider, {value: productionValue},
      e(Button, {ref: trigger, label: 'Open source', onPress() {open = true; renderSource();}}),
      e(FormDialog, {visible: open, scopeKey: productionValue.scopeKey, title: 'Source form', returnFocusRef: trigger,
        onClose() {closes++; open = false; renderSource();}, recovery: e(Button, {label: 'Lookup source original', onPress() {lookups++;}})},
        e(ProductionProbe), e(SourceComposer, {model, actions: {create() {throw new Error('No write expected');}}}))));
  }
  async function renderSource() {await React.act(async () => renderer.render(paper(e(SourcePage))));}
  await renderSource(); await click('Open source');
  const input = document.querySelector('textarea[aria-label="來源原文"]'); assert.ok(input);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Synthetic unsent source');
    input.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
  await click('關閉'); assertTopDialog('繼續編輯'); await click('繼續編輯');
  assert.equal(closes, 0); assert.equal(input.value, 'Synthetic unsent source');
  model.operation = {state: 'unknown'}; await renderSource(); await click('關閉'); assertTopDialog('留在此頁查核');
  assert.equal([...document.querySelectorAll('button')].some(n => n.textContent === '捨棄草稿並離開'), false);
  await click('留在此頁查核'); await click('Lookup source original'); assert.equal(lookups, 1); assert.equal(input.value, 'Synthetic unsent source');
  model.operation = {state: 'none'}; await renderSource(); await click('關閉'); await click('捨棄草稿並離開');
  assert.equal(closes, 1); assert.equal(document.querySelector('textarea'), null); assert.equal(document.activeElement, button('Open source'));
  await click('Open source'); assert.equal(document.querySelector('textarea[aria-label="來源原文"]').value, '');
  await React.act(async () => renderer.render(null));
});

test('real TasksView returns once to its stable heading across a read beginning after approved close', async () => {
  const TasksView = load('src/components/tasks/TasksView.tsx').TasksView;
  const model = {child: {id: 'synthetic-child', displayName: 'Synthetic child'}, access: 'editable', online: true, readState: 'ready', reading: false, loadingMoreTasks: false,
    items: [], eligibleAssignees: [], histories: {}, reminders: [], work: [], selected: null, draft: null, hasMoreTasks: false,
    scheduleContext: {now: '2026-10-21T00:00:00Z', timeZone: 'Asia/Hong_Kong'}, operation: {state: 'idle', message: ''}};
  const actions = {closePanel() {model.draft = null; draw();}, startCreate() {model.draft = {key: 'draft-a', mode: 'create'}; draw();}};
  function TaskPage() {usePreviewLeaveGuard(!!model.draft); return e(TasksView, {model, actions, onAgent() {}, onHistory() {}});}
  async function draw() {await React.act(async () => renderer.render(paper(e(PreviewNavigationGuard, null, e(TaskPage)))));}
  dirty = false; await draw(); await click('手動新增'); assert.equal(button('手動新增').disabled, true);
  await click('關閉'); assertTopDialog('捨棄草稿並離開'); await click('捨棄草稿並離開');
  assert.equal(model.draft, null); assert.equal(button('手動新增').disabled, false);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  // Chrome blurs a focused button when a later read disables it; JSDOM needs this transition port.
  // The product close has already completed before the read begins, matching the real browser trace.
  model.reading = true; await draw();
  if (document.activeElement === button('手動新增') && button('手動新增').disabled) { document.body.tabIndex = -1; document.body.focus(); }
  assert.equal(document.activeElement.getAttribute('aria-label'), '待辦', 'a read beginning after close must not remove the logical return focus');
  const stableHeading = document.activeElement;
  model.reading = false; await draw(); assert.equal(document.activeElement, stableHeading);
  button('手動新增').focus(); model.reading = true; await draw(); model.reading = false; await draw();
  assert.notEqual(document.activeElement, stableHeading, 'later reads must never replay the close focus after the user moves it');
  await click('手動新增'); await click('關閉'); await click('捨棄草稿並離開');
  assert.equal(document.activeElement, stableHeading, 'a stable-page close uses the same logical return point');
  await click('手動新增'); model.reading = true; await draw(); await click('關閉'); await click('捨棄草稿並離開');
  assert.equal(button('手動新增').disabled, true);
  assert.equal(document.activeElement.getAttribute('aria-label'), '待辦', 'an in-flight read must use the stable page heading, not BODY or a disabled button');
  const heading = document.activeElement; model.reading = false; await draw(); assert.equal(document.activeElement, heading, 'settling a later read must not steal focus again');
  await React.act(async () => renderer.render(null));
});


test('a retained narrow detail uses its visible fallback instead of the hidden list after closing', async () => {
  let open = false;
  function DetailPage() {
    const list = React.useRef(null), detail = React.useRef(null);
    return e(PreviewNavigationGuard, null, e('div', {ref: list, tabIndex: -1, 'aria-hidden': true}, 'Hidden list'),
      e('section', {ref: detail, tabIndex: -1, 'aria-label': 'Selected record'},
        e(Button, {label: 'Edit selected record', disabled: open, onPress() {open = true; draw();}})),
      e(FormDialog, {visible: open, scopeKey: 'child-a', title: 'Record', returnFocusRef: list, fallbackFocusRef: detail,
        onClose() {open = false; draw();}}, e(Form)));
  }
  async function draw() {await React.act(async () => renderer.render(paper(e(DetailPage))));}
  dirty = true; await draw(); await click('Edit selected record'); await click('關閉'); await click('捨棄草稿並離開');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Selected record');
  const source = fs.readFileSync(path.join(root, 'src/components/care/CareReviewHistoryView.tsx'), 'utf8');
  assert.match(source, /fallbackFocusRef=\{showPanel \? panelRef : listRef\}/);
  await React.act(async () => renderer.render(null));
});


test('a create trigger remounted after closing remains the explicit return target', async () => {
  let open = false;
  function RemountedPage() {
    const trigger = React.useRef(null), fallback = React.useRef(null);
    return e(PreviewNavigationGuard, null, e('section', {ref: fallback, tabIndex: -1, 'aria-label': 'Record list'}),
      !open ? e(Button, {ref: trigger, label: 'Create shared record', onPress() {open = true; draw();}}) : null,
      e(FormDialog, {visible: open, scopeKey: 'child-a', title: 'Record', returnFocusRef: trigger, fallbackFocusRef: fallback,
        onClose() {open = false; draw();}}, e(Form)));
  }
  async function draw() {await React.act(async () => renderer.render(paper(e(RemountedPage))));}
  dirty = true; await draw(); await click('Create shared record'); assert.equal([...document.querySelectorAll('button')].some(n => n.textContent === 'Create shared record'), false);
  await click('關閉'); await click('捨棄草稿並離開'); assert.equal(document.activeElement, button('Create shared record'));
  const screen = fs.readFileSync(path.join(root, 'src/screens/careScreen.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src/components/care/CareRecordsView.tsx'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'src/components/care/CareReviewHistoryView.tsx'), 'utf8');
  assert.match(screen, /CareRecordsView manualCreateFocusRef=\{manualCreateTrigger\}/); assert.match(screen, /AppButton ref=\{manualCreateTrigger\} label="手動新增共享記錄"/);
  assert.match(page, /CareReviewWorkspace manualCreateFocusRef=\{manualCreateFocusRef\}/);
  assert.match(view, /returnFocusRef=\{returnToCreate.current && manualCreateFocusRef \? manualCreateFocusRef : listRef\}/);
  await React.act(async () => renderer.unmount());
});
