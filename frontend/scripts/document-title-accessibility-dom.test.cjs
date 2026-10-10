const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const source = path.resolve(process.env.DOCUMENT_TITLE_SOURCE || path.join(__dirname, '../..'));
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
const errors = evaluate(path.join(root, 'src/components/FormErrorSummary.tsx'), name => {
  if (name.endsWith('/theme')) return theme;
  if (name.endsWith('/ui')) return { AppButton: Button };
  if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: empty };
  throw new Error(`Unexpected error-component import: ${name}`);
});
// Actual form, RHF, AppTextField, Paper TextInput/HelperText and RN Web DOM.
// Non-title controls and appearance/live-region dependencies are bounded doubles.
const { DocumentCreateForm } = evaluate(path.join(root, 'src/components/preparations/DocumentCreateForm.tsx'), name => {
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
const input = () => document.querySelector('input:not([type="checkbox"])');
function nameSources(element) {
  const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
  const labels = [...(element.labels || [])].map(label => label.textContent).join(' ').trim();
  // Exact title-field name sources, not a general accessible-name implementation.
  return labelledBy || element.getAttribute('aria-label') || labels || element.getAttribute('title') || element.getAttribute('placeholder') || '';
}
async function typeTitle(value) {
  const field = input();
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit(kind) {
  const consent = document.querySelector('input[type="checkbox"]');
  if (!consent.checked) await React.act(async () => consent.click());
  const label = kind === 'preparation' ? '整理這份準備單' : '整理這份成長報告';
  const button = [...document.querySelectorAll('button')].find(element => element.textContent === label);
  assert.ok(button); assert.equal(button.disabled, false);
  await React.act(async () => button.click());
}
for (const kind of ['preparation', 'growth_report']) {
  test(`${kind} title keeps its visible name, validation and raw input`, async () => {
    let edits = 0, writes = 0;
    let owner = { authorityVersion: 'synthetic-v1', locked: false, dirty: false, epoch: 0, createDocument() { writes++; throw new Error('Write forbidden'); }, markDraft() { edits++; }, discardDraft() {} };
    const rootNode = createRoot(document.getElementById('root'));
    const render = async () => React.act(async () => rootNode.render(React.createElement(DocumentCreateForm, { owner, kind })));
    try {
      await render();
      assert.ok(document.body.textContent.includes('文件名稱'));
      assert.equal(nameSources(input()), '文件名稱');
      assert.equal(input().getAttribute('aria-label'), '文件名稱');
      assert.equal(input().value, '');
      await submit(kind);
      const errorId = `${input().id}-error`;
      assert.equal(document.getElementById(errorId)?.textContent, '請填寫文件名稱。');
      assert.equal(nameSources(input()), '文件名稱');
      const raw = `  ${'合'.repeat(159)}  `;
      await typeTitle(raw);
      assert.equal(input().value, raw, 'Do not trim or replace the draft');
      await submit(kind);
      assert.equal(document.getElementById(errorId)?.textContent, '最多 160 字。');
      assert.equal(nameSources(input()), '文件名稱');
      const focusButton = document.querySelector('button[aria-label="修正文件名稱"]');
      assert.ok(focusButton);
      await React.act(async () => focusButton.click());
      assert.equal(document.activeElement, input(), 'Keep the existing title-field ref');
      owner = { ...owner, locked: true, operation: { state: 'failed' } };
      await render();
      // Paper disabled maps through editable=false to RN Web readOnly.
      assert.equal(input().readOnly, true);
      assert.equal(input().value, raw);
      assert.equal(nameSources(input()), '文件名稱');
      assert.equal(document.getElementById(errorId)?.textContent, '最多 160 字。');
      assert.ok(edits > 0); assert.equal(writes, 0); assert.equal(networkCalls, 0);
      observations.push({ kind, ariaLabel: input().getAttribute('aria-label'), nameSourcesResult: nameSources(input()), requiredError: '請填寫文件名稱。', observedAriaInvalid: input().getAttribute('aria-invalid'), lengthError: document.getElementById(errorId).textContent, rawInputPreserved: input().value === raw, errorFocusPreserved: true, lockedReadOnly: input().readOnly, writes, networkCalls });
    } finally { await React.act(async () => rootNode.unmount()); }
  });
}
test.after(() => {
  if (process.env.DOCUMENT_TITLE_EVIDENCE) fs.writeFileSync(process.env.DOCUMENT_TITLE_EVIDENCE, JSON.stringify({ observations, networkCalls, boundary: 'DOM-level focused checks with synthetic owner; no browser, screen-reader, visual, API or full-form submission claim.' }, null, 2) + '\n');
  Module._load = originalLoad; global.fetch = originalFetch; dom.window.close();
});
