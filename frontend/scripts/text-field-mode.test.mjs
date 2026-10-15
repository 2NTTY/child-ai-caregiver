import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the real shared wrapper without mounting React or a browser.
const filename = new URL('../src/components/ui.tsx', import.meta.url);
const source = ts.createSourceFile('ui.tsx', readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppTextField');
assert.ok(declaration);
const output = ts.transpileModule(declaration.getText(source), { fileName: 'field.tsx', compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
} }).outputText;
const exported = {};
const defaults = { input: {}, inputOutline: { borderColor: '#000' }, multilineContent: {} };
new Function('exports', 'React', 'TextInput', 'styles', output)(exported,
  { createElement: (_type, props) => props }, 'PaperTextInput', defaults);

test('flat fields do not leak Paper outline styles into AndroidTextInput; outlined fields retain styling', () => {
  const customOutline = { borderRadius: 12 };
  const flat = exported.AppTextField({ mode: 'flat', outlineStyle: customOutline, underlineStyle: { height: 0 } });
  assert.equal(flat.mode, 'flat');
  assert.equal(flat.outlineStyle, undefined);
  assert.deepEqual(flat.underlineStyle, { height: 0 });
  const outlined = exported.AppTextField({ outlineStyle: customOutline });
  assert.equal(outlined.mode, 'outlined');
  assert.deepEqual(outlined.outlineStyle, [defaults.inputOutline, customOutline]);
});
