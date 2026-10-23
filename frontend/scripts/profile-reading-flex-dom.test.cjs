const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
const React = req('react'), native = req('react-native-web'), { renderToStaticMarkup } = req('react-dom/server'), ts = req('typescript');
const file = path.join(root, 'frontend/src/components/profile/ProfileSummary.tsx');
const moduleValue = { exports: {} };
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
// Real reading component and installed RN Web CSS compiler. Card/header ports keep
// this check focused on flex sizing, not Paper presentation or browser geometry.
new Function('require', 'module', 'exports', js)(name => {
  if (name === 'react-native') return native;
  if (name === 'react-native-paper') return { Text: native.Text };
  if (name === '../ui') return {
    SectionCard: ({ children, style }) => React.createElement(native.View, { style, testID: 'reading-card' }, children),
    SectionHeader: ({ title }) => React.createElement(native.Text, null, title),
  };
  if (name.endsWith('/profile-view-model')) return { profileAgeUnitOptions: [{ value: 'years', label: '歲' }] };
  if (name.endsWith('/theme')) return { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, typeScale: { caption: 13 }, readingType: { tool: {}, meta: {} } };
  return req(name);
}, moduleValue, moduleValue.exports);
const data = { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null, region: '合成香港', language: '合成廣東話', allergies: null, specialNeeds: null, preferences: null, source: '合成測試', validUntil: null };

for (const compact of [false, true]) test(`installed RN Web keeps ${compact ? 'stacked cards content-sized' : 'desktop cards equally flexible'} without a fixed height`, () => {
  const html = renderToStaticMarkup(React.createElement(moduleValue.exports.ProfileReadingSummary, { data, compact }));
  const css = native.StyleSheet.getSheet().textContent;
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`);
  try {
    const group = dom.window.document.querySelector('[data-testid="profile-reading-groups"]');
    assert.equal(dom.window.getComputedStyle(group).flexDirection, compact ? 'column' : 'row');
    const cards = [...dom.window.document.querySelectorAll('[data-testid="reading-card"]')];
    assert.equal(cards.length, 2);
    for (const card of cards) {
      const style = dom.window.getComputedStyle(card);
      assert.equal(style.flexBasis, compact ? 'auto' : '0%', `Resolved card basis: ${style.flex}`);
      assert.equal(style.flexGrow, compact ? '0' : '1');
      assert.equal(style.flexShrink, compact ? '0' : '1');
      assert.equal(style.height, 'auto', 'Natural content height must not be replaced with a constant');
    }
  } finally { dom.window.close(); }
});
