import test from 'node:test';
import assert from 'node:assert/strict';
import * as summary from '../server/private-summary-work.ts';

// The parser is the versioned boundary shared by both existing worker authorizers.
const parse = (value: unknown) => {
  assert.equal(typeof (summary as Record<string, unknown>).parseSummaryBackgroundBasis, 'function');
  return (summary as unknown as { parseSummaryBackgroundBasis(value: unknown): unknown }).parseSummaryBackgroundBasis(value);
};
const workId = '00000000-0000-4000-8000-000000000001';

test('legacy scope wakes accept only canonical positive safe request numbers', () => {
  assert.deepEqual(parse('1'), { kind: 'scope', request: 1 });
  assert.deepEqual(parse(String(Number.MAX_SAFE_INTEGER)), { kind: 'scope', request: Number.MAX_SAFE_INTEGER });
  for (const value of ['', '0', '-1', '01', '1.0', '1e3', ' 1', '1 ', '9007199254740992', null, 1, {}])
    assert.equal(parse(value), null);
});

test('part wakes preserve the exact work revision step and attempt without treating work IDs as child IDs', () => {
  const basis = `summary-part:v1:${workId}:2:3:4`;
  assert.deepEqual(parse(basis), { kind: 'part', binding: { workId, sourceRevision: 2, step: 3, attempt: 4 } });
  assert.deepEqual(parse(`summary-part:v1:${workId}:1:0:0`),
    { kind: 'part', binding: { workId, sourceRevision: 1, step: 0, attempt: 0 } });
  for (const value of [basis + ':extra', basis.replace(':v1:', ':v2:'), basis.replace(':2:3:4', ':0:3:4'),
    basis.replace(':2:3:4', ':02:3:4'), basis.replace(':2:3:4', ':2:-1:4'),
    basis.replace(':2:3:4', ':2:3:9007199254740992'), basis.replace(workId, 'child'), 'summary-part:'])
    assert.equal(parse(value), null);
});

test('completion wakes retain their receipt-bound digest and reject unknown protocol forms', () => {
  const wakeId = 'a'.repeat(64);
  assert.deepEqual(parse(`summary-completion:v1:${wakeId}`), { kind: 'completion', wakeId });
  for (const value of [`summary-completion:v2:${wakeId}`, `summary-completion:v1:${wakeId}:extra`,
    `summary-completion:v1:${wakeId.toUpperCase()}`, `summary-completion:v1:${wakeId.slice(1)}`, 'summary-other:v1:1'])
    assert.equal(parse(value), null);
});
