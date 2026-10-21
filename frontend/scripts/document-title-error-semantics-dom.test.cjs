const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const source = path.resolve(process.env.DOCUMENT_ERROR_SOURCE || path.join(__dirname, '../..'));
const root = path.join(source, 'frontend');
const req = Module.createRequire(path.join(root, 'package.json'));
// Reuse an explicitly supplied DOM runtime without adding a product dependency.
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return rn;
  return originalLoad.call(this, name, parent, isMain);
};
const paper = {
  TextInput: req('react-native-paper/lib/commonjs/components/TextInput/TextInput').default,
  Text: req('react-native-paper/lib/commonjs/components/Typography/Text').default,
  HelperText: req('react-native-paper/lib/commonjs/components/HelperText/HelperText').default,
};
const empty = () => null;
const Button = ({ label, onPress, disabled, accessibilityLabel }) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, label);
const Checkbox = ({ label, checked, disabled, onChange }) => React.createElement('input', { type: 'checkbox', 'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked) });
let networkCalls = 0;
const originalFetch = global.fetch;
global.fetch = () => { networkCalls++; throw new Error('Network forbidden'); };
function evaluate(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (!name.startsWith('.')) return req(name);
    return imports(name);
  }, module, module.exports);
  return module.exports;
}
const theme = { colors: {}, mobileLayout: { breakpoint: 600 }, spacing: {}, radius: {}, typeScale: {}, readingType: {}, mobileIcons: {}, mobileType: {}, workspaceType: {} };
const ui = evaluate(path.join(root, 'src/components/ui.tsx'), name => {
  if (name.endsWith('/theme')) return theme;
  if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
  return new Proxy({}, { get: () => empty });
});
const status = evaluate(path.join(root, 'src/components/StatusAnnouncement.tsx'), name => { throw new Error(`Unexpected status import: ${name}`); });
const errors = evaluate(path.join(root, 'src/components/FormErrorSummary.tsx'), name => {
  if (name.endsWith('/theme')) return theme;
  if (name.endsWith('/ui')) return { AppButton: Button };
  if (name.endsWith('/StatusAnnouncement')) return status;
  throw new Error(`Unexpected error-component import: ${name}`);
});
// Actual form, RHF, AppTextField, Paper TextInput/HelperText and RN Web DOM.
// Real error summary, helper, and StatusAnnouncement. Non-title controls, button/checkbox hosts, appearance, and owner remain bounded doubles.
const { DocumentCreateForm } = evaluate(path.join(root, 'src/components/preparations/DocumentCreateForm.tsx'), name => {
  if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard() {} }; // Navigation is covered by document-draft-navigation.
  if (name.endsWith('/theme')) return theme;
  if (name.endsWith('/preparation-view-model')) return { preparationPurposes: [{ key: 'appointment', label: '到診' }] };
  if (name.endsWith('/ui')) return { AppTextField: ui.AppTextField, AppSelect: empty, AppButton: Button };
  if (name.endsWith('/AppCheckbox')) return { AppCheckbox: Checkbox };
  if (name.endsWith('/DateTimeFields')) return { AppDateField: empty };
  if (name.endsWith('/family-documents')) return { documentRequestSchema: { safeParse() { throw new Error('Submission is outside this test'); } } };
  if (name.endsWith('/FormErrorSummary')) return errors;
  throw new Error(`Unexpected form import: ${name}`);
});

const observations = [];
const kinds = ['preparation', 'growth_report'];
const field = scope => scope.querySelector('input:not([type="checkbox"])');
function snapshot(scope, kind, stage) {
  const input = field(scope), errorId = `${input.id}-error`, error = document.getElementById(errorId);
  const describedBy = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const announcement = scope.querySelector('[data-testid="status-announcement"]');
  const result = { kind, stage, fieldId: input.id, errorId, value: input.value,
    ariaInvalid: input.getAttribute('aria-invalid'), ariaDescribedby: input.getAttribute('aria-describedby'),
    errorAssociated: describedBy.includes(errorId), errorInOwnScope: !!error && scope.contains(error),
    errorText: error?.textContent ?? null, inputOuterHTML: input.outerHTML, errorOuterHTML: error?.outerHTML ?? null,
    announcement: { role: announcement?.getAttribute('role') ?? null, ariaLive: announcement?.getAttribute('aria-live') ?? null, text: announcement?.textContent ?? null },
    summaryText: scope.querySelector('[data-testid="form-error-summary"]')?.textContent ?? null };
  observations.push(result);
  return result;
}
function assertClean(scope) {
  const input = field(scope);
  assert.notEqual(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.getAttribute('aria-describedby'), null, 'No missing or stale helper ID may remain');
  assert.equal(document.getElementById(`${input.id}-error`), null);
}
function assertError(scope, kind, stage, message) {
  const result = snapshot(scope, kind, stage);
  assert.equal(result.errorText, message, 'The actual local title validation must have happened');
  assert.equal(result.announcement.role, 'alert');
  assert.equal(result.announcement.ariaLive, 'assertive');
  assert.ok(result.announcement.text.includes(`文件名稱：${message}`), 'Keep the existing programmatic global error announcement');
  assert.ok(result.summaryText.includes(`文件名稱：${message}`));
  assert.deepEqual({ invalid: result.ariaInvalid, describedBy: result.ariaDescribedby, errorAssociated: result.errorAssociated },
    { invalid: 'true', describedBy: result.errorId, errorAssociated: true },
    'The actual input must expose invalid state and describe its existing local error helper');
  assert.equal(result.errorInOwnScope, true, 'The helper must belong to the same form instance');
  assert.equal([...document.querySelectorAll('[id]')].filter(node => node.id === result.errorId).length, 1);
}
async function typeTitle(scope, value) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field(scope), value);
    field(scope).dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit(scope, kind) {
  const consent = scope.querySelector('input[type="checkbox"]');
  if (!consent.checked) await React.act(async () => consent.click());
  const label = kind === 'preparation' ? '整理這份準備單' : '整理這份成長報告';
  const button = [...scope.querySelectorAll('button')].find(element => element.textContent === label);
  assert.ok(button && !button.disabled, 'Synthetic consent should enable only local validation');
  await React.act(async () => button.click());
  // RHF 7.88 schedules a second error focus in a timer; settle it before the next user action.
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 0)));
}
for (const kind of kinds) {
  test(`${kind} title associates local errors and clears them after recovery or reset`, async () => {
    const peerKind = kinds.find(value => value !== kind);
    let writes = 0;
    const owner = () => ({ authorityVersion: 'synthetic-v1', locked: false, dirty: false, epoch: 0,
      createDocument() { writes++; throw new Error('Write forbidden'); }, markDraft() {}, discardDraft() {} });
    const owners = { [kind]: owner(), [peerKind]: owner() };
    const rootNode = createRoot(document.getElementById('root'));
    const render = async () => React.act(async () => rootNode.render(React.createElement('div', null,
      kinds.map(value => React.createElement('section', { key: value, 'data-kind': value }, React.createElement(DocumentCreateForm, { owner: owners[value], kind: value }))))));
    try {
      await render();
      const scope = document.querySelector(`[data-kind="${kind}"]`), peer = document.querySelector(`[data-kind="${peerKind}"]`);
      const titleId = field(scope).id, peerId = field(peer).id;
      assert.notEqual(titleId, peerId, 'Each mounted form needs its own title/error IDs');
      assert.equal(field(scope).getAttribute('aria-label'), '文件名稱');
      assert.equal(field(scope).value, '');
      assertClean(scope); assertClean(peer);
      snapshot(scope, kind, 'initial');

      await submit(scope, kind);
      assertClean(peer);
      assertError(scope, kind, 'required', '請填寫文件名稱。');
      await submit(peer, peerKind);
      assertError(peer, peerKind, 'peer-required', '請填寫文件名稱。');
      assert.equal(field(scope).getAttribute('aria-describedby'), `${titleId}-error`);
      assert.equal(field(peer).getAttribute('aria-describedby'), `${peerId}-error`);

      const tooLong = `  ${'合'.repeat(159)}  `;
      await typeTitle(scope, tooLong);
      assert.equal(field(scope).value, tooLong, 'Keep the raw draft while revalidating');
      assertError(scope, kind, 'length', '最多 160 字。');
      const valid = '  家庭文件  ';
      await typeTitle(scope, valid);
      assert.equal(field(scope).value, valid, 'Recovery must not trim the raw draft');
      assertClean(scope);
      assert.equal(field(scope).getAttribute('aria-invalid'), 'false');
      assert.equal(scope.querySelector('button[aria-label="修正文件名稱"]'), null);
      snapshot(scope, kind, 'valid');
      assertError(peer, peerKind, 'peer-after-recovery', '請填寫文件名稱。');

      await typeTitle(scope, '');
      assertError(scope, kind, 'required-again', '請填寫文件名稱。');
      owners[kind] = { ...owners[kind], epoch: 1 };
      await render();
      assert.equal(field(scope).id, titleId, 'Owner reset must retain the mounted title ID');
      assert.equal(field(scope).value, '');
      assertClean(scope);
      assert.equal(field(scope).getAttribute('aria-invalid'), 'false');
      snapshot(scope, kind, 'reset');
      assertError(peer, peerKind, 'peer-after-reset', '請填寫文件名稱。');
      assert.equal(writes, 0); assert.equal(networkCalls, 0);
    } finally { await React.act(async () => rootNode.unmount()); }
  });
}
test.after(() => {
  if (process.env.DOCUMENT_ERROR_EVIDENCE) fs.writeFileSync(process.env.DOCUMENT_ERROR_EVIDENCE, JSON.stringify({ observations, networkCalls,
    boundary: 'Real form/RHF/AppTextField/Paper TextInput/HelperText/FormErrorSummary/StatusAnnouncement/RNWeb DOM. Synthetic owners and non-title controls isolated. No browser AX, screen-reader, visual, API or successful full-form submission claim.' }, null, 2) + '\n');
  Module._load = originalLoad; global.fetch = originalFetch; dom.window.close();
});
