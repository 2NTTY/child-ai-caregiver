import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The committed manifest is exact for this candidate, not a minimum pass count.
function manifest(text) {
  const entries = JSON.parse(text);
  assert.ok(Array.isArray(entries) && entries.length > 0, 'Require a nonempty suite manifest');
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'Invalid suite entry');
    assert.deepEqual(Object.keys(entry).sort(), ['cases', 'path'], 'Unexpected manifest fields');
    assert.match(entry.path, /^tests\/[A-Za-z0-9_-]+\.test\.ts$/, 'Unexpected test path');
    assert.ok(Number.isSafeInteger(entry.cases) && entry.cases > 0, 'Require a positive exact case count');
    assert.ok(!seen.has(entry.path), 'Duplicate test file');
    seen.add(entry.path);
  }
  return entries;
}

function checkTotals(output, expected) {
  assert.ok(Number.isSafeInteger(expected) && expected > 0, 'Invalid expected case count');
  const entries = [...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) ([0-9]+)$/gm)]
    .map(([, name, count]) => [name, Number(count)]);
  assert.equal(entries.length, 6, 'Require exactly one complete TAP summary');
  const totals = Object.fromEntries(entries);
  assert.equal(Object.keys(totals).length, 6, 'Require every TAP counter');
  assert.equal(totals.tests, expected, 'Run every declared regression case in this file');
  assert.equal(totals.pass, totals.tests);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(totals[name], 0, name);
  return totals;
}

const [command, path, count, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Unexpected arguments');
if (command === 'list') {
  assert.equal(count, undefined, 'Unexpected manifest arguments');
  for (const entry of manifest(readFileSync(path, 'utf8'))) console.log(`${entry.path}\t${entry.cases}`);
} else {
  assert.equal(command, 'check', 'Expected list or check');
  assert.match(count ?? '', /^[1-9][0-9]*$/, 'Require an exact case count');
  console.log('PASS complete-test-totals ' + JSON.stringify(checkTotals(readFileSync(path, 'utf8'), Number(count))));
}
