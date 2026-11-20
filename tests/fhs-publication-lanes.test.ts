import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { observationHash } from '../server/knowledge-observation.ts';

const { selectPublicationLane, runPublicationLane } = await import(new URL('../scripts/fhs-publication-lanes.mjs', import.meta.url).href);
const { classifyLaneOperation } = await import(new URL('../scripts/fhs-lane-operations.mjs', import.meta.url).href);

const a = { sourceId: 'pdf-first', sha256: 'a'.repeat(64), pages: 2 };
const b = { sourceId: 'pdf-second', sha256: 'b'.repeat(64), pages: 3 };
const c = { sourceId: 'resource-third', sha256: 'c'.repeat(64), pages: 5 };
const manifest = { schemaVersion: 1, lanes: [{ id: 'C1', sources: [a, b] }, { id: 'C2', sources: [c] }, { id: 'C3', sources: [] }] };
const originals = new Map([a, b, c].map(s => [s.sourceId, s]));
const fingerprint = 'd'.repeat(64);

test('a paid lane can reuse only the recorded observation for the frozen PDF and a matching committed edition', () => {
  const pin = { ...a, url: 'https://www.fhs.gov.hk/original.pdf' };
  const item = { url: pin.url, title: 'Original', text: '', sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
    extraction: { format: 'text_pdf' as const, complete: true, contentHash: a.sha256, totalPages: a.pages } };
  const check = { status: 'ok', items: [item] };
  const hash = observationHash(item);
  const saved = { result: { status: 'published', published: true, observationHash: hash }, receipt: { state: 'committed', observationHash: hash },
    prepared: { versionHash: a.sha256, review: { decision: 'approve_candidate' } } };
  const active = { enabled: true, current: true, observationHash: hash, versionId: 'edition', versionHash: a.sha256 };
  assert.equal(classifyLaneOperation(pin, check, null, null, []).state, 'ready');
  assert.equal(classifyLaneOperation(pin, { ...check, items: [{ ...item, extraction: { ...item.extraction, contentHash: b.sha256 } }] }, null, null, []).state, 'held');
  assert.equal(classifyLaneOperation(pin, check, saved, active, []).state, 'published');
  assert.equal(classifyLaneOperation(pin, check, saved, { ...active, versionHash: b.sha256 }, []).state, 'reconciliation_required');
  assert.equal(classifyLaneOperation(pin, check, null, null, [{ state: 'reserved' }]).state, 'reconciliation_required');
  assert.equal(classifyLaneOperation(pin, null, null, null, [{ state: 'settled' }]).state, 'reconciliation_required');
});

test('a lane accepts only its frozen originals and rejects overlapping ownership before selecting one source', () => {
  assert.deepEqual(selectPublicationLane(manifest, originals, 'C1').map((s: typeof a) => s.sourceId), [a.sourceId, b.sourceId]);
  assert.throws(() => selectPublicationLane(manifest, originals, 'C1', ''), /lane_source/);
  assert.throws(() => selectPublicationLane(manifest, originals, 'C1', c.sourceId), /lane_source/);
  assert.throws(() => selectPublicationLane({ ...manifest, lanes: [...manifest.lanes.slice(0, 2), { id: 'C3', sources: [b] }] }, originals, 'C1'), /lane_manifest/);
  assert.throws(() => selectPublicationLane(manifest, new Map([...originals, [b.sourceId, { ...b, pages: 4 }]]), 'C1'), /lane_manifest/);
});

test('a restarted lane reads the committed receipt, resumes the exact deferred operation, and stops at daily refusal', async () => {
  const calls: unknown[][] = [];
  const port = {
    async inspect(source: typeof a) { return source === a
      ? { state: 'published', operationFingerprint: 'e'.repeat(64) }
      : { state: 'ready', operationFingerprint: fingerprint, started: true }; },
    async prepare() { throw Error('Unexpected preparation'); },
    async dispatch(...args: unknown[]) { calls.push(args); return 4; },
    report() {},
  };
  assert.equal(await runPublicationLane([a, b, c], 'run', port), 4);
  assert.deepEqual(calls, [[b, fingerprint, true]]);
});

test('a stopped child is reconciled by its original receipt before independent work continues', async () => {
  const dispatched: string[] = [];
  const port = {
    async inspect(source: typeof a) {
      return { state: dispatched.includes(source.sourceId) ? (source === a ? 'held' : 'published') : 'ready',
        operationFingerprint: fingerprint, started: false };
    },
    async prepare() { throw Error('Unexpected preparation'); },
    async dispatch(source: typeof a) { dispatched.push(source.sourceId); return source === a ? 2 : 0; },
    report() {},
  };
  assert.equal(await runPublicationLane([a,b], 'run', port), 0);
  assert.deepEqual(dispatched, [a.sourceId, b.sourceId]);
});

test('status and preparation never dispatch, and an unknown receipt stops a paid run without retrying it', async () => {
  const calls: string[] = [];
  const port = {
    async inspect(source: typeof a) { return source === a ? { state: 'unregistered' } : { state: 'reconciliation_required' }; },
    async prepare(source: typeof a) { calls.push(source.sourceId); return { state: 'ready', operationFingerprint: fingerprint, started: false }; },
    async dispatch() { throw Error('Unexpected provider dispatch'); },
    report() {},
  };
  assert.equal(await runPublicationLane([a, b], 'status', port), 0);
  assert.deepEqual(calls, []);
  assert.equal(await runPublicationLane([a], 'prepare', port), 0);
  assert.deepEqual(calls, [a.sourceId]);
  assert.equal(await runPublicationLane([b, a], 'run', port), 2);
  assert.deepEqual(calls, [a.sourceId]);
});

test('the installed batch rejects a foreign source and the original catalogue skips every frozen lane', () => {
  const root = new URL('../', import.meta.url);
  for (const id of ['', 'pdf-836e9d989e83046a43059df7']) {
    const invalid = spawnSync(process.execPath, ['scripts/fhs-catalog-batch.mjs', '--lane', 'C1', 'run', id], { cwd: root, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /fhs_lane_source/u);
  }
  const stub = `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    cp.spawnSync = (_node, [script, ...args]) => { if (!script.endsWith('fhs-initial-campaign.mjs')) throw Error('Unexpected child');
      console.log(JSON.stringify(args)); return {status:0}; }; syncBuiltinESMExports();`;
  const sequence = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(stub), 'scripts/fhs-catalog-batch.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(sequence.status, 0, sequence.stderr);
  const dispatched = sequence.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line)[1]);
  const { lanes } = JSON.parse(readFileSync(new URL('knowledge/fhs-initial-publication-lanes.json', root), 'utf8'));
  assert.ok(dispatched.includes('pdf-c79a394b580ec9e870d63319'));
  for (const { sources } of lanes) for (const { sourceId } of sources) assert.ok(!dispatched.includes(sourceId), sourceId);
});
