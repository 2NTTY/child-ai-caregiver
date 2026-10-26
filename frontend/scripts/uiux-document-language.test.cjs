const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

test('actual Expo document declares Traditional Chinese before hydration and preserves native scrolling and zoom', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/+html.tsx'), 'utf8');
  const moduleResult = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  // Expo's static renderer supplies this official reset; inspect its mount, not its package transform.
  const reset = () => React.createElement('style', { id: 'expo-reset' }, 'body{margin:0}');
  new Function('require', 'module', 'exports', code)(name => name === 'expo-router/html'
    ? { ScrollViewStyleReset: reset } : require(name), moduleResult, moduleResult.exports);
  const html = renderToStaticMarkup(React.createElement(moduleResult.exports.default, null,
    React.createElement('div', { id: 'root' }, '照顧工作台')));
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<meta charSet="utf-8"\/>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
  assert.match(html, /<style id="expo-reset">/);
  assert.match(html, /<body><div id="root">照顧工作台<\/div><\/body>/);
  assert.match(source, /import \{ ScrollViewStyleReset \} from "expo-router\/html"/);
});
