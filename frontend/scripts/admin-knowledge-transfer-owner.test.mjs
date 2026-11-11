import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminOwner } from '../src/production/AdminOwner.ts';

test('transfer ledger preserves paging, original-batch recovery and selection authority within one admin session', async () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), cursor = 'd'.repeat(64), at = '2026-11-11T01:00:00.000Z';
  const makeBatch = (id, state = 'ready', revision = 2) => ({ id, total: 3, next: 2, state, revision, updatedAt: at,
    lastFailure: state === 'failed' ? { index: 2, sourceId: 'synthetic-source', reason: 'knowledge_source_changed', at } : null });
  const item = index => ({ index, sourceId: 'synthetic-source', versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    versionHash: 'c'.repeat(64), editionState: index ? 'draft' : 'reviewed', unchanged: index === 0, at });
  let batch = makeBatch(a), listFailure = false, readFailure = false, postMode = 'success';
  let detailRead = async url => Response.json({ batch: url.pathname.endsWith(b) ? makeBatch(b, 'failed', 3) : batch,
    items: [item(Number(url.searchParams.get('from') ?? 0))], nextFrom: url.searchParams.get('from') === '1' ? null : 1 });
  let finishPost;
  const requests = [];
  const owner = new AdminOwner('https://synthetic.invalid', async (input, options) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body, options });
    assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['x-expected-user-id'], owner.getSnapshot().userId);
    if (url.pathname.endsWith('/session')) return Response.json({ administrator: true });
    if (url.pathname.endsWith('/operations')) return Response.json({ opId: body.opId, actorId: 'admin-a', at, command: body,
      before: null, result: { email: body.email, expiresAt: body.expiresAt, state: 'issued' } });
    if (options.method === 'POST') {
      if (postMode === 'delay') return new Promise(resolve => { finishPost = resolve; });
      if (postMode === 'reauth') return Response.json({ error: { code: 'recent_reauthentication_required' } }, { status: 428 });
      if (postMode === 'conflict') { batch = makeBatch(a, 'failed', batch.revision + 1); return Response.json({ error: { code: 'version_conflict' } }, { status: 409 }); }
      batch = makeBatch(a, url.pathname.endsWith('/stop') ? 'stopped' : 'ready', batch.revision + 1);
      return postMode === 'unknown' ? Response.json({ error: { code: 'unavailable' } }, { status: 503 }) : Response.json({ batch });
    }
    if (url.pathname.endsWith('/knowledge-transfers')) return listFailure
      ? Response.json({ error: { code: 'unavailable' } }, { status: 503 })
      : Response.json({ items: url.searchParams.has('cursor') ? [batch, makeBatch(b, 'failed', 3)] : [batch], nextCursor: url.searchParams.has('cursor') ? null : cursor });
    if (readFailure) return Response.json({ error: { code: 'unavailable' } }, { status: 503 });
    return detailRead(url);
  });
  owner.setUser('admin-a'); await owner.checkAccess();
  assert.equal(requests.length, 1, 'The ledger is not loaded during access checks');
  await owner.setTransfersOpen(true);
  assert.equal(owner.getSnapshot().transfers.batches.items.length, 1);
  listFailure = true; await owner.loadTransfers(true);
  assert.equal(owner.getSnapshot().transfers.batches.status, 'error');
  assert.equal(owner.getSnapshot().transfers.batches.nextCursor, cursor);
  listFailure = false; await owner.loadTransfers(true);
  assert.equal(requests.at(-1).url.searchParams.get('cursor'), cursor);
  assert.equal(owner.getSnapshot().transfers.batches.items.length, 2, 'Paging deduplicates by full digest');
  const beforeInvalid = requests.length;
  await owner.loadTransfer('abc');
  assert.equal(requests.length, beforeInvalid, 'A partial fingerprint never reaches the API');
  await owner.loadTransfer(a);
  await owner.loadTransfer(a, true);
  assert.equal(requests.at(-1).url.searchParams.get('from'), '1');
  assert.deepEqual(owner.getSnapshot().transfers.detail.items, [item(0), item(1)]);
  assert.equal(owner.getSnapshot().transfers.detail.nextFrom, null);

  const delayed = [];
  detailRead = url => url.pathname.endsWith(a) ? new Promise(resolve => delayed.push(resolve))
    : Promise.resolve(Response.json({ batch: makeBatch(b, 'failed', 3), items: [], nextFrom: null }));
  const firstA = owner.loadTransfer(a);
  await owner.loadTransfer(b);
  const secondA = owner.loadTransfer(a);
  batch = makeBatch(a, 'ready', 4);
  delayed[1](Response.json({ batch, items: [item(1)], nextFrom: null })); await secondA;
  delayed[0](Response.json({ batch: makeBatch(a, 'ready', 2), items: [item(0)], nextFrom: 1 })); await firstA;
  assert.equal(owner.getSnapshot().transfers.detail.batch.revision, 4, 'An earlier same-account selection cannot replace the newer selection');
  assert.deepEqual(owner.getSnapshot().transfers.detail.items, [item(1)]);
  detailRead = async url => Response.json({ batch: url.pathname.endsWith(b) ? makeBatch(b, 'failed', 3) : batch, items: [item(0)], nextFrom: null });

  postMode = 'unknown';
  let posts = requests.filter(request => request.options.method === 'POST').length;
  await owner.controlTransfer('stop');
  assert.equal(requests.filter(request => request.options.method === 'POST').length, posts + 1);
  assert.equal(requests.at(-1).options.method, 'GET', 'An unknown result reads the original digest instead of resending');
  assert.equal(owner.getSnapshot().transfers.detail.batch.state, 'stopped');
  assert.equal(owner.getSnapshot().transfers.pending, null);
  postMode = 'conflict';
  await owner.controlTransfer('resume');
  assert.equal(requests.at(-1).options.method, 'GET', 'A revision conflict reads current authority');
  assert.equal(owner.getSnapshot().transfers.detail.batch.state, 'failed');
  postMode = 'success'; await owner.controlTransfer('resume');
  assert.equal(requests.at(-1).body.expectedRevision, 6);
  assert.equal(owner.getSnapshot().transfers.detail.batch.state, 'ready');
  assert.match(owner.getSnapshot().transfers.notice, /同一.*包|原包/);
  assert.doesNotMatch(owner.getSnapshot().transfers.notice, /已重新開始|已發布/);

  postMode = 'reauth'; await owner.controlTransfer('stop');
  assert.equal(owner.getSnapshot().transfers.pending, null);
  assert.match(owner.getSnapshot().transfers.notice, /重新驗證/);
  postMode = 'unknown'; readFailure = true; await owner.controlTransfer('stop');
  assert.equal(owner.getSnapshot().transfers.pending.digest, a);
  await owner.submit({ kind: 'invite', opId: '00000000-0000-4000-8000-000000000099', email: 'invited@example.test', expiresAt: '2026-11-12T01:00:00.000Z' });
  assert.equal(requests.at(-1).url.pathname, '/api/admin/operations', 'An unresolved transfer cannot block the independent invitation authority');
  assert.equal(owner.getSnapshot().transfers.pending.digest, a);
  posts = requests.filter(request => request.options.method === 'POST').length;
  await owner.controlTransfer('stop');
  assert.equal(requests.filter(request => request.options.method === 'POST').length, posts, 'Unresolved controls cannot be blindly repeated');
  readFailure = false; await owner.recoverTransferOperation();
  assert.equal(owner.getSnapshot().transfers.pending, null);

  postMode = 'delay'; const control = owner.controlTransfer('resume');
  await owner.loadTransfer(b);
  finishPost(Response.json({ batch: makeBatch(a, 'ready', 9) })); await control;
  assert.equal(owner.getSnapshot().transfers.detail.digest, b);
  assert.equal(owner.getSnapshot().transfers.detail.batch.id, b, 'A late control reply cannot repopulate the previously selected batch');
  assert.equal(owner.getSnapshot().transfers.notice, null, 'A late control reply cannot attach the previous selection notice to the current batch');
  detailRead = () => new Promise(resolve => delayed.push(resolve));
  const stale = owner.loadTransfer(a);
  owner.setUser('admin-b');
  assert.equal(owner.getSnapshot().transfers.open, false);
  assert.equal(owner.getSnapshot().transfers.detail.batch, null);
  assert.equal(owner.getSnapshot().transfers.pending, null);
  delayed.at(-1)(Response.json({ batch, items: [item(0)], nextFrom: null })); await stale;
  assert.equal(owner.getSnapshot().transfers.detail.batch, null);
  assert.deepEqual(owner.getSnapshot().transfers.batches.items, []);
  await owner.checkAccess(); await owner.setTransfersOpen(true);
  detailRead = async () => Response.json({ error: { code: 'forbidden' } }, { status: 403 });
  await owner.loadTransfer(b);
  assert.equal(owner.getSnapshot().access, 'error');
  assert.deepEqual(owner.getSnapshot().transfers.batches.items, []);
  assert.equal(owner.getSnapshot().transfers.detail.batch, null, 'Revoked read authority clears all ledger content');
  owner.dispose();
});
