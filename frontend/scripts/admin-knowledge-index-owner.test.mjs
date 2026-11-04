import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminOwner } from '../src/production/AdminOwner.ts';

test('index batch owner bounds reviewed selections and preserves unknown commands through explicit recovery and identity changes', async () => {
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const hash = 'a'.repeat(64), at = '2026-11-05T01:00:00.000Z', requests = [];
  const versions = Array.from({ length: 53 }, (_, i) => ({ id: uuid(i + 1), sourceId: 'synthetic-source', hash,
    state: i === 52 ? 'draft' : 'reviewed', publishedAt: null, searchReady: false }));
  let versionRead = async url => Response.json(url.searchParams.get('cursor') === uuid(40)
    ? { items: versions.slice(40), nextVersionId: null } : url.searchParams.has('cursor')
    ? { items: versions.slice(20, 40), nextVersionId: uuid(40) } : { items: versions.slice(0, 20), nextVersionId: uuid(20) });
  const historicalBatch = { id: uuid(900), state: 'failed', controlVersion: 1, createdAt: at, updatedAt: at,
    targets: [{ versionId: uuid(1), versionHash: hash, state: 'failed', bucketsCompleted: 0, error: 'synthetic_failure' }] };
  let batch = null, postReply = 'unknown', failPage = false;
  const owner = new AdminOwner('https://synthetic.invalid', async (input, options) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body, method: options.method });
    assert.equal(options.headers['x-expected-user-id'], owner.getSnapshot().userId);
    if (url.pathname.endsWith('/session')) return Response.json({ administrator: true });
    if (url.pathname.endsWith('/knowledge-versions')) {
      if (failPage) return Response.json({ error: { code: 'unavailable' } }, { status: 503 });
      return versionRead(url);
    }
    if (url.pathname.endsWith('/knowledge-index-batches') && options.method === 'GET')
      return Response.json({ items: [historicalBatch], nextCursor: url.searchParams.has('cursor') ? null : 'opaque-batch-page' });
    if (options.method === 'GET') return Response.json({ batch });
    if (postReply === 'unknown') return Response.json({ error: { code: 'operation_result_unknown' } }, { status: 503 });
    if (postReply === 'receipt') return Response.json({ batch });
    if (url.pathname.endsWith('/knowledge-index-batches')) batch = { id: body.opId, state: 'running', controlVersion: 1,
      createdAt: at, updatedAt: at, targets: body.targets.map(target => ({ ...target, state: 'pending', bucketsCompleted: 0, error: null })) };
    else batch = { ...batch, state: url.pathname.endsWith('/stop') ? 'paused' : 'running', controlVersion: batch.controlVersion + 1 };
    return Response.json({ batch });
  });
  owner.setUser('admin-a'); await owner.checkAccess();
  assert.equal(requests.length, 1, 'Neither index list loads during access checks');
  await owner.setIndexOpen(true);
  assert.equal(owner.getSnapshot().index.versions.items.length, 20);
  failPage = true; await owner.loadIndexVersions(true);
  assert.equal(owner.getSnapshot().index.versions.status, 'error');
  assert.equal(owner.getSnapshot().index.versions.items.length, 20);
  failPage = false; await owner.loadIndexVersions(true);
  assert.equal(requests.at(-1).url.searchParams.get('cursor'), uuid(20));
  await owner.loadIndexVersions(true);
  assert.equal(requests.at(-1).url.searchParams.get('cursor'), uuid(40));
  await owner.loadIndexBatches(true);
  assert.equal(requests.at(-1).url.searchParams.get('cursor'), 'opaque-batch-page');
  assert.equal(owner.getSnapshot().index.batches.items.length, 1, 'Batch pages merge without duplicate batch IDs');
  const beforeFailedResume = requests.length;
  await owner.controlIndexBatch(historicalBatch.id, 'resume');
  assert.equal(requests.length, beforeFailedResume, 'A failed terminal batch cannot be resumed');
  owner.selectIndexVersion(uuid(53), true);
  assert.equal(owner.getSnapshot().index.selected.length, 0, 'Draft versions cannot be selected');
  for (const version of versions.slice(0, 51)) owner.selectIndexVersion(version.id, true);
  assert.equal(owner.getSnapshot().index.selected.length, 50);
  assert.equal(owner.getSnapshot().busy, false, 'Index controls do not occupy invitation/settings reads');
  await owner.createIndexBatch();
  const original = requests.at(-1).body, pending = owner.getSnapshot().index.pending;
  assert.equal(original.targets.length, 50); assert.equal(pending.payload.opId, original.opId);
  owner.selectIndexVersion(uuid(1), false);
  await owner.createIndexBatch();
  assert.equal(requests.at(-1).body.opId, original.opId, 'Unresolved creates cannot be replaced with a new operation');
  await owner.recoverIndexOperation();
  assert.equal(owner.getSnapshot().index.pending.payload.opId, original.opId, 'An absent batch does not authorize a new operation');
  postReply = 'ok'; await owner.retryIndexOperation();
  assert.deepEqual(requests.at(-1).body, original, 'Retry preserves the exact original target hashes and operation ID');
  assert.equal(owner.getSnapshot().index.pending, null);
  assert.equal(owner.getSnapshot().index.batches.items[0].id, original.opId);
  postReply = 'unknown'; await owner.controlIndexBatch(original.opId, 'stop');
  const stop = requests.at(-1).body;
  assert.equal(stop.expectedControlVersion, 1);
  batch = { ...batch, state: 'paused', controlVersion: 2 };
  await owner.recoverIndexOperation();
  assert.equal(owner.getSnapshot().index.pending.payload.opId, stop.opId, 'A matching state cannot prove which control operation committed');
  assert.equal(owner.getSnapshot().index.batches.items[0].state, 'paused');
  // The server returns the receipt of the original command, without applying it again.
  postReply = 'receipt';
  await owner.retryIndexOperation();
  assert.deepEqual(requests.at(-1).body, stop);
  assert.equal(owner.getSnapshot().index.pending, null);
  assert.equal(owner.getSnapshot().index.batches.items[0].controlVersion, 2);
  postReply = 'ok'; await owner.controlIndexBatch(original.opId, 'resume');
  assert.equal(requests.at(-1).body.expectedControlVersion, 2);
  assert.equal(requests.at(-1).url.pathname.endsWith('/resume'), true);
  assert.equal(owner.getSnapshot().index.batches.items[0].state, 'running');
  let finish;
  versionRead = () => new Promise(resolve => { finish = resolve; });
  const stale = owner.loadIndexVersions();
  owner.setUser('admin-b');
  assert.equal(owner.getSnapshot().index.open, false);
  assert.equal(owner.getSnapshot().index.pending, null);
  assert.deepEqual(owner.getSnapshot().index.selected, []);
  assert.deepEqual(owner.getSnapshot().index.batches.items, []);
  finish(Response.json({ items: versions.slice(0, 20), nextVersionId: null })); await stale;
  assert.deepEqual(owner.getSnapshot().index.versions.items, [], 'A late list cannot repopulate a different identity');
  owner.dispose();
});
