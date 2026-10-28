import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHandoverApi, HandoverApiError } from '../src/client/handover-api.ts';
import type { HandoverExportCommand, HandoverExportView } from '../src/shared/handover-jobs.ts';

test('handover client preserves original IDs, validates downloads and rejects late work after identity changes', async context => {
  const command: HandoverExportCommand = { opId: randomUUID(), purpose: 'handover',
    selection: { childIds: [randomUUID()], modules: ['profile'], period: null } };
  const view: HandoverExportView = { id: command.opId, version: 1, purpose: command.purpose, selection: command.selection,
    state: 'queued', createdAt: '2026-10-28T00:00:00Z', expiresAt: '2026-10-29T00:00:00Z', bytes: null, error: null };
  const signal = new AbortController().signal, requests: { path: string; method: string; body?: unknown; signal: AbortSignal }[] = [];
  let failure: { status: number; code: string } | undefined, wrongId = false, selfCursor = false, hold = false;
  let contentType = 'application/zip', contentLength = '4', bodyCancelled = false;
  const held: { release(response: Response): void; signal: AbortSignal }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(init);
    const url = new URL(String(input)), body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    assert.equal(url.origin, 'https://example.test'); assert.equal(init?.credentials, 'include'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'owner'); assert.ok(init.signal);
    requests.push({ path: url.pathname + url.search, method: init.method!, body, signal: init.signal });
    if (hold) return new Promise<Response>(resolve => { held.push({ release: resolve, signal: init.signal! }); });
    if (failure) return Response.json({ error: { code: failure.code, message: 'private source text' } }, { status: failure.status });
    if (url.pathname.endsWith('/download')) return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([80, 75, 3, 4])); controller.close(); },
      cancel() { bodyCancelled = true; },
    }), { headers: { 'Content-Type': contentType, 'Content-Length': contentLength } });
    if (url.pathname.endsWith('/reconcile')) { assert.deepEqual(body, {}); return Response.json({ ...view, state: 'ready', version: 2, bytes: 4 }); }
    if (url.pathname.endsWith('/cancel')) return Response.json({ ...view, state: 'cancelled', version: 2 });
    if (init.method === 'GET' && url.pathname.endsWith('/packages')) return Response.json({ items: [view], nextCursor: selfCursor ? url.searchParams.get('cursor') : 'next_page' });
    return Response.json({ ...view, ...(wrongId ? { id: randomUUID() } : {}) });
  };
  const api = createHandoverApi('https://example.test/api/', fetcher);
  await assert.rejects(api.create('owner', command, signal), { status: 409, code: 'session_changed' }); assert.equal(requests.length, 0);
  api.setIdentity('owner');
  assert.equal((await api.create('owner', command, signal)).id, command.opId);
  assert.equal((await api.create('owner', command, signal)).id, command.opId);
  assert.deepEqual(requests.slice(0, 2).map(request => request.body), [command, command]);
  const page = await api.list('owner', signal); assert.equal(page.items[0].id, command.opId); assert.equal(page.nextCursor, 'next_page');
  selfCursor = true; await assert.rejects(api.list('owner', signal, 'same_cursor'), { code: 'handover_response_invalid' }); selfCursor = false;
  assert.equal((await api.get('owner', view.id, signal)).id, view.id);
  assert.equal((await api.reconcile('owner', view.id, signal)).state, 'ready');
  const cancel = { opId: randomUUID(), expectedVersion: 1 };
  assert.equal((await api.cancel('owner', view.id, cancel, signal)).state, 'cancelled'); assert.deepEqual(requests.at(-1)?.body, cancel);
  wrongId = true; const beforeInvalid = requests.length;
  await assert.rejects(api.create('owner', command, signal), { code: 'handover_response_invalid' }); assert.equal(requests.length, beforeInvalid + 1); wrongId = false;
  await assert.rejects(api.get('owner', 'invalid', signal), { status: 400, code: 'invalid_input' }); assert.equal(requests.length, beforeInvalid + 1);
  failure = { status: 409, code: 'package_job_stopped' };
  await assert.rejects(api.reconcile('owner', view.id, signal), { status: 409, code: 'package_job_stopped' });
  failure = { status: 503, code: 'private source text@example.test' };
  await assert.rejects(api.list('owner', signal), error => error instanceof HandoverApiError && error.status === 503
    && error.code === 'handover_unavailable' && !error.message.includes('private')); failure = undefined;
  const external = new AbortController(); let current!: () => boolean;
  const downloaded = await api.download('owner', view.id, 4, external.signal, async (response, isCurrent) => {
    current = isCurrent; assert.equal(isCurrent(), true); return new Uint8Array(await response.arrayBuffer());
  });
  assert.deepEqual(downloaded, new Uint8Array([80, 75, 3, 4]));
  const completedSignal = requests.at(-1)!.signal; external.abort(); assert.equal(completedSignal.aborted, false, 'The completed download removes its external abort listener');
  await assert.rejects(api.download('owner', view.id, 4, signal, async () => { throw new Error('package_download_incomplete'); }),
    { status: 0, code: 'package_download_incomplete' });
  let consumed = 0; contentType = 'text/html';
  await assert.rejects(api.download('owner', view.id, 4, signal, async () => { consumed++; }), { code: 'handover_response_invalid' });
  contentType = 'application/zip'; contentLength = '5';
  await assert.rejects(api.download('owner', view.id, 4, signal, async () => { consumed++; }), { code: 'handover_response_invalid' });
  contentLength = '4'; assert.equal(consumed, 0); assert.equal(bodyCancelled, true);
  const beforeOversize = requests.length;
  await assert.rejects(api.download('owner', view.id, 256 * 1024 * 1024 + 1, signal, async () => {}), { code: 'invalid_input' }); assert.equal(requests.length, beforeOversize);
  hold = true;
  const lateRead = api.get('owner', view.id, signal), lateWrite = api.create('owner', command, signal);
  const readRejected = assert.rejects(lateRead, { code: 'session_changed' }), writeRejected = assert.rejects(lateWrite, { code: 'session_changed' });
  assert.equal(held.length, 2); api.setIdentity('other');
  assert.ok(held.every(request => request.signal.aborted)); assert.equal(current(), false);
  held.forEach(request => request.release(Response.json(view))); await readRejected; await writeRejected;
  api.setIdentity(null); const afterLogout = requests.length;
  await assert.rejects(api.get('owner', view.id, signal), { code: 'session_changed' }); assert.equal(requests.length, afterLogout);
  hold = false; api.setIdentity('owner');
  let releaseIdentityConsume!: () => void, identityDownloadCurrent!: () => boolean;
  const identityDownload = api.download('owner', view.id, 4, signal, async (_response, isCurrent) => {
    identityDownloadCurrent = isCurrent; await new Promise<void>(resolve => { releaseIdentityConsume = resolve; }); return 'late download';
  });
  const identityDownloadRejected = assert.rejects(identityDownload, { code: 'session_changed' });
  await new Promise(resolve => setImmediate(resolve)); api.setIdentity('other');
  await identityDownloadRejected; assert.equal(identityDownloadCurrent(), false); assert.equal(requests.at(-1)?.signal.aborted, true); releaseIdentityConsume();
  api.setIdentity('owner'); context.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseConsume!: () => void, downloadCurrent!: () => boolean;
  const downloading = api.download('owner', view.id, 4, signal, async (_response, isCurrent) => {
    downloadCurrent = isCurrent; await new Promise<void>(resolve => { releaseConsume = resolve; }); return 'finished';
  });
  const deadlineRejected = assert.rejects(downloading, { code: 'handover_unavailable' });
  await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(299999); assert.equal(downloadCurrent(), true);
  context.mock.timers.tick(1); await deadlineRejected; assert.equal(downloadCurrent(), false); releaseConsume();
});
