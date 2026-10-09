import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relative, overrides = {}) {
  const file = new URL(`../src/${relative}`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file.pathname, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }, reportDiagnostics: true });
  assert.deepEqual(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'react/jsx-runtime' || name === 'zod') return require(name);
    throw new Error(`Unexpected work-card dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
// Render the real card and view-model text using native-control stand-ins.
// This verifies copy/priority and immutable inputs, not browser layout or device behavior.
const view = ({ children, testID }) => React.createElement('div', { 'data-testid': testID }, children);
const text = ({ children }) => React.createElement('span', null, children);
const { PersistentWorkCards } = load('components/history/PersistentWorkCards.tsx', {
  'react-native': { View: view, StyleSheet: { create: value => value } },
  'react-native-paper': { Text: text },
  '../../history-view-model': load('history-view-model.ts'),
  '../../memory-reference-view-model': load('memory-reference-view-model.ts'),
  '../../theme': { chineseFont: 'sans-serif', colors: {}, radius: {}, readingType: {}, spacing: {} },
  '../AppStatusBadge': { AppStatusBadge: ({ label }) => React.createElement('b', null, label) },
  '../ui': { AppButton: () => { throw new Error('These read-only cards require no controls'); } },
});
const event = Object.freeze({ eventId: 'synthetic-batch-event', runId: 'synthetic-original-run', state: 'completed', createdAt: '2026-10-10T02:00:00.000Z' });
const work = status => Object.freeze({ id: 'synthetic-work', childId: 'synthetic-child', version: 2,
  status, goal: 'Synthetic follow-up work', focus: '', questions: [], pending: [], resources: [], sourceMessageIds: [],
  followUp: null, latestFollowUp: event, createdAt: '2026-10-10T01:00:00.000Z', updatedAt: '2026-10-10T02:01:00.000Z' });
const render = item => renderToStaticMarkup(React.createElement(PersistentWorkCards, { items: [item], online: true }));
function assertCancelled(item) {
  const before = JSON.stringify(item), html = render(item);
  assert.ok(html.includes('此工作已取消，不再接續。'));
  assert.ok(html.includes('同批跟進事件：接續運行已完結'));
  assert.ok(html.indexOf('此工作已取消，不再接續。') < html.indexOf('同批跟進事件：'));
  assert.ok(!html.includes('最近接續：'));
  assert.ok(!html.includes('Agent 已結束工作'));
  assert.equal(JSON.stringify(item), before);
  assert.strictEqual(item.latestFollowUp, event); assert.equal(event.state, 'completed');
}

test('cancellation before another constituent completes stays primary without relabelling the original batch receipt', () => {
  // Same wire shape as the server counterexample: this work never ran, the other one completed.
  assertCancelled(work('cancelled'));
});

test('cancellation after an earlier completion preserves historical batch status and never infers timing from work dates', () => {
  const active = work('waiting'), html = render(active);
  assert.ok(html.includes('同批跟進事件：接續運行已完結'));
  assert.ok(!html.includes('此工作已取消'));
  // The contract has no per-constituent completion/cancellation timestamp. Both
  // cancellation orders deliberately have the same event shape and presentation.
  assertCancelled(work('cancelled'));
});

test('one cancelled constituent does not label the still-queued shared event as cancelled', () => {
  // The backend overlays cancelled on A's link while B keeps the event queued.
  const queuedBatch = Object.freeze({ ...event, state: 'queued' });
  const projectedLink = Object.freeze({ ...queuedBatch, state: 'cancelled' });
  for (const status of ['cancelled', 'waiting']) {
    // A new work version may also invalidate an old link without cancelling work.
    const item = Object.freeze({ ...work(status), latestFollowUp: projectedLink });
    const before = JSON.stringify(item), html = render(item);
    assert.ok(html.includes('此工作關聯接續：接續已取消'));
    assert.ok(!html.includes('同批跟進事件：接續已取消'));
    assert.equal(html.includes('此工作已取消，不再接續。'), status === 'cancelled');
    assert.equal(JSON.stringify(item), before);
    assert.equal(queuedBatch.state, 'queued'); assert.equal(projectedLink.state, 'cancelled');
  }
});
