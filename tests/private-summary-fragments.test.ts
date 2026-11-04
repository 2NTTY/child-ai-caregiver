import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fitSummaryFragment, validateSummaryAdvance } from '../server/private-summary-fragments.ts';
import { makeSummaryChatSource, makeSummaryCorrectionSource, summaryManifestHash, summaryLineageKey,
  summaryManifestSchema, summarySourceUnitSchema, summaryCursorSchema, summaryFragmentRangeSchema,
  type SummaryManifest, type SummarySourceUnit } from '../server/private-summary-work.ts';

const messageId = '00000000-0000-4000-8000-000000000001';
function source(text: string): Extract<SummarySourceUnit, { kind: 'chat_text' }> {
  return { kind: 'chat_text', messageId, sortKey: '0000000000000000001',
    messageHash: 'a'.repeat(64), utf16Length: text.length };
}

test('fitting a complete source preserves whitespace, identity, and accumulator without normalization', () => {
  const text = ' \r\nA😀 e\u0301 \n', unit = source(text), accumulator = 'Earlier synthetic uncertainty';
  const fragment = fitSummaryFragment({ unitIndex: 0, source: unit, sourceText: text, startUtf16: 0,
    accumulator, fits: candidate => JSON.stringify({ system: 'synthetic envelope', candidate }).length < 2000 });
  assert.deepEqual(fragment, { source: unit, range: { unitIndex: 0, startUtf16: 0, endUtf16: text.length, metadataOnly: false },
    text, sourceComplete: true, accumulator });
});

test('fragment selection fits the supplied serialized envelope instead of a raw character target', () => {
  const text = '"\\\nABCDE', unit = source(text);
  const fragment = fitSummaryFragment({ unitIndex: 2, source: unit, sourceText: text, startUtf16: 0,
    accumulator: 'prior', fits: candidate => JSON.stringify(candidate.text).length <= 7 });
  assert.ok(fragment);
  assert.equal(fragment.text, '"\\');
  assert.deepEqual(fragment.range, { unitIndex: 2, startUtf16: 0, endUtf16: 2, metadataOnly: false });
  assert.equal(fragment.sourceComplete, false);
});

test('an unfit leading Unicode scalar is not split or skipped for a later short character', () => {
  const text = '😀a';
  const fragment = fitSummaryFragment({ unitIndex: 0, source: source(text), sourceText: text, startUtf16: 0,
    accumulator: null, fits: candidate => candidate.text.length <= 1 });
  assert.equal(fragment, null);
});

test('repeated scalar-bounded fragments reconstruct emoji, ZWJ, combining, and CRLF exactly', () => {
  const text = '👨‍👩‍👧‍👦e\u0301\r\n' + 'a' + '\u0301'.repeat(100) + '\tEND', unit = source(text);
  const pieces: string[] = []; let cursor = 0;
  while (cursor < text.length) {
    const fragment = fitSummaryFragment({ unitIndex: 0, source: unit, sourceText: text, startUtf16: cursor,
      accumulator: null, fits: candidate => candidate.text.length <= 3 });
    assert.ok(fragment);
    assert.equal(fragment.range.startUtf16, cursor);
    assert.ok(fragment.range.endUtf16 > cursor);
    assert.equal(fragment.text.isWellFormed(), true);
    assert.equal(fragment.text, text.slice(cursor, fragment.range.endUtf16));
    pieces.push(fragment.text); cursor = fragment.range.endUtf16;
    assert.equal(fragment.sourceComplete, cursor === text.length);
  }
  assert.equal(pieces.join(''), text);
});

test('a validated zero-body chat source requires a fitting metadata-only fragment', () => {
  const input = { unitIndex: 3, source: source(''), sourceText: '', startUtf16: 0, accumulator: null };
  const fragment = fitSummaryFragment({ ...input, fits: candidate => candidate.range.metadataOnly });
  assert.deepEqual(fragment, { source: input.source, range: { unitIndex: 3, startUtf16: 0, endUtf16: 0, metadataOnly: true },
    text: '', sourceComplete: true, accumulator: null });
  assert.equal(fitSummaryFragment({ ...input, fits: () => false }), null);
});

test('an already exhausted nonempty source does not manufacture a zero-length progress fragment', () => {
  assert.equal(fitSummaryFragment({ unitIndex: 0, source: source('x'), sourceText: 'x', startUtf16: 1,
    accumulator: null, fits: () => true }), null);
});

test('invalid offsets, malformed Unicode, and source length mismatches fail before fitting', () => {
  const valid = { unitIndex: 0, source: source('😀a'), sourceText: '😀a', startUtf16: 0, accumulator: null };
  for (const bad of [{ startUtf16: 1 }, { startUtf16: -1 }, { startUtf16: 4 }, { startUtf16: 0.5 },
    { unitIndex: -1 }, { sourceText: '\uD800' }, { sourceText: 'ab' }]) {
    let calls = 0;
    assert.throws(() => fitSummaryFragment({ ...valid, ...bad, fits: () => { calls++; return true; } }));
    assert.equal(calls, 0);
  }
});

test('fitting failures propagate and selection does not mutate the supplied source', () => {
  const unit = Object.freeze(source('abcdef')), error = new Error('synthetic native counter failure');
  const input = { unitIndex: 0, source: unit, sourceText: 'abcdef', startUtf16: 0, accumulator: null };
  assert.throws(() => fitSummaryFragment({ ...input, fits: () => { throw error; } }), cause => cause === error);
  const fragment = fitSummaryFragment({ ...input, fits: candidate => candidate.text.length <= 2 });
  assert.equal(fragment?.text, 'ab');
  assert.deepEqual(unit, source('abcdef'));
});

const childId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const dependency = { kind: 'fact' as const, id: '00000000-0000-4000-8000-000000000004', version: 1, validUntil: null };
const message = { id: messageId, childId, authorUserId: 'synthetic-owner', role: 'user' as const,
  text: '  source 😀\r\n', inReplyTo: null, createdAt: '2026-11-04T00:00:00.000Z' };
function manifest(text = 'abc'): SummaryManifest {
  return { format: 'private-summary-manifest/v1', kind: 'fresh_message', mode: 'private', coveredMessageIds: [messageId],
    appendAfterSortKey: null, repairOf: null, sourceBasis: 'b'.repeat(64), sourceCoverageComplete: true,
    dependencies: [], units: [source(text)] };
}

test('the source builder hashes the complete validated chat identity, not only its body', () => {
  const original = makeSummaryChatSource(message, '0000000000000000001');
  assert.equal(original.sourceText, message.text);
  assert.equal(original.source.kind, 'chat_text');
  assert.equal(original.source.utf16Length, message.text.length);
  assert.equal(original.source.messageHash, '33b8e3760108122b3f46e3c40fb717ad7d2fda38441b333184dc5cfeb5429c4b');
  for (const changed of [{ role: 'model' }, { inReplyTo: secondId }, { childId: secondId }, { authorUserId: 'other-owner' },
    { file: { id: secondId, version: 1, bytes: 1, sha256: 'c'.repeat(64), mimeType: 'text/plain' } }]) {
    assert.notEqual(makeSummaryChatSource({ ...message, ...changed }, '0000000000000000001').source.messageHash,
      original.source.messageHash);
  }
  assert.throws(() => makeSummaryChatSource(message, 'not-a-sort-key'));
});

test('the source builder retains every legal 10000-code-point message and rejects invalid originals', () => {
  for (const text of ['😀'.repeat(10000), '"'.repeat(10000), '\u0001'.repeat(10000)]) {
    const built = makeSummaryChatSource({ ...message, text }, '0000000000000000001');
    assert.equal(built.sourceText, text);
    assert.equal(built.source.utf16Length, text.length);
  }
  for (const text of ['x'.repeat(10001), '\uD800', '\0', '']) {
    assert.throws(() => makeSummaryChatSource({ ...message, text }, '0000000000000000001'));
  }
  const attached = makeSummaryChatSource({ ...message, text: '', file: {
    id: secondId, version: 1, bytes: 1, sha256: 'c'.repeat(64), mimeType: 'text/plain',
  } }, '0000000000000000001');
  assert.equal(attached.source.utf16Length, 0);
  assert.equal(attached.sourceText, '');
});

test('correction sources preserve canonical JSON exactly and bind the declared dependency', () => {
  const built = makeSummaryCorrectionSource(dependency, { z: 2, a: '  new\n' });
  assert.equal(built.sourceText, '{"a":"  new\\n","z":2}');
  assert.deepEqual(built.source.dependency, dependency);
  assert.equal(built.source.valueHash, 'bb21f80a70d3f10f3294bec97c3d9a59394a44b08d70db6c49a0b9ffa385ded4');
  assert.deepEqual(makeSummaryCorrectionSource(dependency, { a: '  new\n', z: 2 }), built);
  assert.notEqual(makeSummaryCorrectionSource(dependency, { a: 'changed', z: 2 }).source.valueHash, built.source.valueHash);
  assert.throws(() => makeSummaryCorrectionSource({ ...dependency, version: -1 }, { a: 1 }));
  assert.throws(() => makeSummaryCorrectionSource(dependency, { a: undefined }));
});

test('manifest validation binds ordered complete message IDs and correction dependencies', () => {
  const fresh = manifest();
  assert.equal(summaryManifestSchema.safeParse(fresh).success, true);
  const correction = makeSummaryCorrectionSource(dependency, { current: 'new' }).source;
  const repair: SummaryManifest = { ...fresh, kind: 'repair_batch', coveredMessageIds: [messageId, secondId], repairOf: secondId,
    dependencies: [dependency], units: [source('abc'), { ...source('def'), messageId: secondId, sortKey: '0000000000000000002' }, correction] };
  assert.equal(summaryManifestSchema.safeParse(repair).success, true);
  for (const bad of [
    { ...fresh, extra: true }, { ...fresh, coveredMessageIds: [messageId, secondId] },
    { ...fresh, coveredMessageIds: [secondId] }, { ...fresh, units: [] },
    { ...repair, coveredMessageIds: [messageId, messageId] },
    { ...repair, units: [correction, ...repair.units.slice(0, 2)] },
    { ...repair, units: [repair.units[1], repair.units[0], correction] },
    { ...repair, dependencies: [] }, { ...repair, dependencies: [{ ...dependency, version: 2 }] },
    { ...repair, dependencies: [dependency, dependency] },
  ]) assert.equal(summaryManifestSchema.safeParse(bad).success, false);
});

test('manifest capacity preserves the existing complete 50-message repair contract', () => {
  const units = Array.from({ length: 50 }, (_, index) => ({ ...source('x'),
    messageId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sortKey: String(index + 1).padStart(19, '0') }));
  const repair = { ...manifest(), kind: 'repair_batch', coveredMessageIds: units.map(unit => unit.messageId), repairOf: secondId, units };
  assert.equal(summaryManifestSchema.safeParse(repair).success, true);
  const extra = { ...source('x'), messageId: '00000000-0000-4000-8000-000000000051', sortKey: '0000000000000000051' };
  assert.equal(summaryManifestSchema.safeParse({ ...repair, coveredMessageIds: [...repair.coveredMessageIds, extra.messageId],
    units: [...units, extra] }).success, false);
});

test('range and cursor schemas reject unsafe counts and impossible metadata-only ranges', () => {
  assert.equal(summaryCursorSchema.safeParse({ unitIndex: 0, offsetUtf16: 0 }).success, true);
  assert.equal(summarySourceUnitSchema.safeParse(source('x')).success, true);
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.equal(summaryCursorSchema.safeParse({ unitIndex: value, offsetUtf16: 0 }).success, false);
    assert.equal(summarySourceUnitSchema.safeParse({ ...source('x'), utf16Length: value }).success, false);
  }
  assert.equal(summaryFragmentRangeSchema.safeParse({ unitIndex: 0, startUtf16: 0, endUtf16: 0, metadataOnly: true }).success, true);
  for (const range of [
    { unitIndex: 0, startUtf16: 0, endUtf16: 0, metadataOnly: false },
    { unitIndex: 0, startUtf16: 1, endUtf16: 2, metadataOnly: true },
    { unitIndex: 0, startUtf16: 2, endUtf16: 1, metadataOnly: false },
  ]) assert.equal(summaryFragmentRangeSchema.safeParse(range).success, false);
});

test('manifest hashes change with source evidence while lineage stays tied to the original work source', () => {
  const original = manifest(), changed = { ...original, units: [{ ...source('abc'), messageHash: 'd'.repeat(64) }] };
  const scope = { ownerUserId: 'synthetic-owner', childId, workspaceId: secondId, storageEpoch: messageId };
  assert.notEqual(summaryManifestHash(original), summaryManifestHash(changed));
  assert.equal(summaryManifestHash(original), summaryManifestHash({ ...original, units: [{ utf16Length: 3,
    messageHash: 'a'.repeat(64), sortKey: '0000000000000000001', messageId, kind: 'chat_text' }] }));
  assert.equal(summaryLineageKey(scope, original), summaryLineageKey(scope, changed));
  for (const change of [{ ownerUserId: 'another-owner' }, { childId: messageId }, { workspaceId: messageId }, { storageEpoch: secondId }]) {
    assert.notEqual(summaryLineageKey({ ...scope, ...change }, original), summaryLineageKey(scope, original));
  }
  const repair: SummaryManifest = { ...original, kind: 'repair_batch', repairOf: messageId };
  assert.notEqual(summaryLineageKey(scope, repair), summaryLineageKey(scope, original));
});

test('structural advance rejects gaps and replay, and moves to the next unit only at its end', () => {
  const bound = manifest('abcd');
  assert.deepEqual(validateSummaryAdvance({ manifest: bound, prior: { unitIndex: 0, offsetUtf16: 0 },
    range: { unitIndex: 0, startUtf16: 0, endUtf16: 2, metadataOnly: false } }), { unitIndex: 0, offsetUtf16: 2 });
  assert.deepEqual(validateSummaryAdvance({ manifest: bound, prior: { unitIndex: 0, offsetUtf16: 2 },
    range: { unitIndex: 0, startUtf16: 2, endUtf16: 4, metadataOnly: false } }), { unitIndex: 1, offsetUtf16: 0 });
  for (const range of [
    { unitIndex: 0, startUtf16: 1, endUtf16: 4, metadataOnly: false },
    { unitIndex: 0, startUtf16: 0, endUtf16: 2, metadataOnly: false },
    { unitIndex: 0, startUtf16: 2, endUtf16: 5, metadataOnly: false },
    { unitIndex: 1, startUtf16: 2, endUtf16: 4, metadataOnly: false },
  ]) assert.throws(() => validateSummaryAdvance({ manifest: bound, prior: { unitIndex: 0, offsetUtf16: 2 }, range }));
});

test('structural metadata-only advance happens once and cannot cover a nonempty message', () => {
  const range = { unitIndex: 0, startUtf16: 0, endUtf16: 0, metadataOnly: true };
  assert.deepEqual(validateSummaryAdvance({ manifest: manifest(''), prior: { unitIndex: 0, offsetUtf16: 0 }, range }),
    { unitIndex: 1, offsetUtf16: 0 });
  assert.throws(() => validateSummaryAdvance({ manifest: manifest(''), prior: { unitIndex: 1, offsetUtf16: 0 }, range }));
  assert.throws(() => validateSummaryAdvance({ manifest: manifest('x'), prior: { unitIndex: 0, offsetUtf16: 0 }, range }));
});

test('pure source and manifest modules load without the Firestore chat, memory, or run stores', () => {
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '--eval', `
    import { mock } from 'node:test';
    for (const path of ['./server/firestore-agent-runs.ts', './server/firestore-chat.ts', './server/firestore-memory.ts']) {
      mock.module(path, { namedExports: {} });
    }
    await import('./server/chat-message-schema.ts');
    await import('./server/private-summary-work.ts');
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  assert.equal(child.status, 0, child.stderr);
});
