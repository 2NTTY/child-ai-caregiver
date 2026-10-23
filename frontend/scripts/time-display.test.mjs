import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {DateTime} from 'luxon';

// Evaluate shipped presentation formatters without a device timezone or network dependency.
function formatter(file, symbol) {
  const code = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  new Function('require','exports',code)(name => name === 'luxon' ? {DateTime} : name === 'react-native' ? {StyleSheet: {create: x => x}} : name.endsWith('/theme') ? {colors: {}, spacing: {}, readingType: {}} : {}, exports);
  return exports[symbol];
}
for (const [file, name] of [['agent-view-model.ts','agentTime'], ['channel-view-model.ts','channelTime'], ['memory-reference-view-model.ts','memoryDateLabel'], ['summary-view-model.ts','summaryTime']]) {
  test(name + ' retains Hong Kong cross-day conversion while omitting seconds and the zone suffix', () => {
    const format = formatter(file, name), date = '2026-10-21T16:05:37.000Z';
    const text = format(date); assert.match(text, /22\/10\/2026/); assert.match(text, /00:05/);
    assert.doesNotMatch(text, /:37|香港|Asia\/Hong_Kong|GMT|UTC/); assert.equal(date, '2026-10-21T16:05:37.000Z');
  });
}
test('task and summary displays retain the original explicit scheduling timezone, not the device zone', () => {
  const task = formatter('components/tasks/TaskContent.tsx', 'taskDisplayTime');
  assert.equal(task('2026-10-21T16:05:37Z','Asia/Hong_Kong'), '2026年10月22日 00:05');
  assert.equal(task('2026-10-21T16:05:37Z','America/New_York'), '2026年10月21日 12:05');
  assert.equal(task('invalid', 'Asia/Hong_Kong'), '時間待核對');
  assert.match(formatter('summary-view-model.ts','summaryTime')('2026-10-21T16:05:37Z','America/New_York'), /21\/10\/2026.*12:05/);
});

test('photo labels keep Hong Kong conversion and never expose raw ISO timestamps', () => {
  const format = formatter('photo-view-model.ts', 'photoTime');
  assert.equal(format('2026-10-21T16:05:37.000Z'), '2026年10月22日 00:05');
  assert.equal(format('invalid'), '時間未能核對');
  const projection = readFileSync(new URL('../src/production/PhotoInputDomains.tsx', import.meta.url), 'utf8');
  assert.match(projection, /createdAtLabel: photoTime\(photo.createdAt\)/);
});
