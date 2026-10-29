import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHandoverApi, HandoverApiError } from '../src/client/handover-api.ts';
import type { HandoverExportCommand, HandoverExportView } from '../src/shared/handover-jobs.ts';
import type { HandoverUploadCommand, HandoverUploadView } from '../src/shared/handover-uploads.ts';
import type { HandoverImportCommand, HandoverImportView } from '../src/shared/handover-imports.ts';

test('source history reuses authenticated transport and validates destination, resource and pagination bindings', async () => {
  const childId = randomUUID(), resourceId = randomUUID(), spaceId = randomUUID(), signal = new AbortController().signal;
  const item = { format: 'yuyoufang-source-revision:1', childId, resource: { id: resourceId, version: 1 }, evidence: { module: 'memory_topics',
    source: { current: { source: { serverId: 'https://source.test', accountId: 'external', childId: randomUUID(), section: 'memory_topics', resourceId: randomUUID(),
      resourceVersion: 2, authorUserId: null, createdAt: null, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
      sourceHash: 'a'.repeat(64), packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), integrity: 'trusted', importedBy: 'owner', importedAt: '2026-10-30T00:00:00Z' }, previous: [] },
    value: { title: 'Foreign topic', note: '<script>literal source text</script>' } } };
  let response: unknown = { items: [item], nextCursor: null, complete: true }, held: ((response: Response) => void) | null = null, holding = false, calls = 0;
  const api = createHandoverApi('https://example.test', async (input, init) => {
    calls++; const url = new URL(String(input)); assert.equal(url.pathname, '/api/account/package-imports/source-history');
    assert.equal(init?.method, 'GET'); assert.equal(init?.cache, 'no-store'); assert.equal(new Headers(init?.headers).get('x-expected-user-id'), 'owner');
    assert.equal(url.searchParams.get('childId'), childId); assert.equal(url.searchParams.get('resourceId'), resourceId); assert.equal(url.searchParams.get('module'), 'memory_topics');
    assert.equal(url.searchParams.get('spaceId'), spaceId);
    return holding ? new Promise(resolve => { held = resolve; }) : Response.json(response);
  });
  api.setIdentity('owner'); const query = { childId, spaceId, resourceId, module: 'memory_topics' as const };
  assert.deepEqual((await api.sourceHistory('owner', query, signal)).items, [item]);
  response = { items: [{ ...item, resource: { id: randomUUID(), version: 1 } }], nextCursor: null, complete: true };
  await assert.rejects(api.sourceHistory('owner', query, signal), { code: 'handover_response_invalid' });
  response = { items: [], nextCursor: 'same', complete: false };
  await assert.rejects(api.sourceHistory('owner', { ...query, cursor: 'same' }, signal), { code: 'handover_response_invalid' });
  const before = calls; await assert.rejects(api.sourceHistory('owner', { ...query, childId: 'wrong' }, signal), { code: 'invalid_input' }); assert.equal(calls, before);
  holding = true; const pending = api.sourceHistory('owner', query, signal), rejected = assert.rejects(pending, { code: 'session_changed' });
  api.setIdentity('other'); held!(Response.json({ items: [item], nextCursor: null, complete: true })); await rejected;
});

test('handover upload and import commands retain original operations and cancel stale transport', async context => {
  const sourceChildId = randomUUID(), targetChildId = randomUUID(), packageId = randomUUID(), manifestSha256 = 'a'.repeat(64);
  const uploadCommand: HandoverUploadCommand = { opId: randomUUID(), filename: 'synthetic.zip', bytes: 4, sha256: 'b'.repeat(64) };
  let upload: HandoverUploadView = { id: uploadCommand.opId, version: 1, filename: uploadCommand.filename, bytes: 4,
    createdAt: '2026-10-29T00:00:00Z', expiresAt: '2026-10-30T00:00:00Z', state: 'reserved', error: null, preview: null };
  const importCommand: HandoverImportCommand = { opId: randomUUID(), uploadId: upload.id, expectedUploadVersion: 2,
    acceptedManifestSha256: manifestSha256, targets: [{ sourceChildId, target: { childId: targetChildId, spaceId: null }, sections: ['care'] }], resolutions: [] };
  let imported: HandoverImportView = { id: importCommand.opId, version: 1, uploadId: upload.id, packageId, packageVersion: 1,
    manifestSha256, integrity: 'missing_proof', targets: importCommand.targets, createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z',
    state: 'queued', totalItems: 1, processedItems: 0, counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null };
  const zip = new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/zip' }), signal = new AbortController().signal;
  const requests: { path: string; method: string; body: unknown; signal: AbortSignal }[] = [], held: { release(response: Response): void; signal: AbortSignal; upload: boolean }[] = [];
  let loseReply = true, hold = false, wrongId = false;
  const api = createHandoverApi('https://example.test', async (input, init) => {
    assert.ok(init); assert.ok(init.signal);
    const url = new URL(String(input)), headers = new Headers(init.headers), binary = url.pathname.endsWith('/content');
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(headers.get('x-expected-user-id'), 'owner');
    assert.equal(headers.get('Accept'), 'application/json');
    if (init.method === 'POST') assert.equal(headers.get('Content-Type'), binary ? 'application/zip' : 'application/json');
    const body = binary ? init.body : init.body === undefined ? undefined : JSON.parse(String(init.body));
    if (binary) assert.equal(body, zip, 'The caller body must reach fetch without JSON conversion');
    requests.push({ path: url.pathname, method: init.method!, body, signal: init.signal });
    if (hold) return new Promise<Response>(resolve => { held.push({ release: resolve, signal: init.signal!, upload: binary }); });
    const uploads = '/api/account/package-uploads', imports = '/api/account/package-imports';
    let result: HandoverUploadView | HandoverImportView;
    if (url.pathname === uploads) {
      assert.deepEqual(body, uploadCommand);
      if (loseReply) { loseReply = false; throw new Error('Lost accepted upload reservation reply'); }
      result = upload;
    } else if (url.pathname === uploads + '/' + upload.id) result = upload;
    else if (binary) {
      assert.equal(url.pathname, uploads + '/' + upload.id + '/content');
      upload = { ...upload, version: 2, state: 'ready', preview: { header: { format: 'yuyoufang-data', version: 1, packageId, packageVersion: 1,
        createdAt: '2026-10-29T00:00:00Z', purpose: 'handover', source: { serverId: 'https://source.example.test', accountId: 'source' },
        selection: { childIds: [sourceChildId], modules: ['care'], period: null } }, manifestSha256, integrity: 'missing_proof',
        children: [{ id: sourceChildId, displayName: 'Synthetic source' }], coverage: [{ section: 'care', childId: sourceChildId, items: 1 }] } }; result = upload;
    } else if (url.pathname === uploads + '/' + upload.id + '/cancel') result = { ...upload, version: 3, state: 'cancelled', preview: null };
    else if (url.pathname === imports) { assert.deepEqual(body, importCommand); result = imported; }
    else if (url.pathname === imports + '/' + imported.id) result = imported;
    else if (url.pathname === imports + '/' + imported.id + '/resume') { imported = { ...imported, version: 3, state: 'queued' }; result = imported; }
    else if (url.pathname === imports + '/' + imported.id + '/cancel') { imported = { ...imported, version: 4, state: 'cancelled' }; result = imported; }
    else throw new Error('Unexpected package route');
    return Response.json(wrongId ? { ...result, id: randomUUID() } : result);
  });
  api.setIdentity('owner');
  await assert.rejects(api.reserveUpload('owner', uploadCommand, signal), { code: 'handover_unavailable' });
  assert.equal(requests.length, 1, 'An unknown reservation must not be retried automatically');
  assert.equal((await api.getUpload('owner', uploadCommand.opId, signal)).id, uploadCommand.opId);
  assert.equal((await api.reserveUpload('owner', uploadCommand, signal)).id, uploadCommand.opId);
  assert.deepEqual(requests.filter(request => request.path === '/api/account/package-uploads').map(request => request.body), [uploadCommand, uploadCommand]);
  assert.equal((await api.uploadContent('owner', upload.id, zip, signal)).state, 'ready');
  assert.equal((await api.createImport('owner', importCommand, signal)).id, importCommand.opId);
  assert.equal((await api.getImport('owner', imported.id, signal)).uploadId, upload.id);
  imported = { ...imported, version: 2, state: 'interrupted' };
  const resume = { opId: randomUUID(), expectedVersion: 2 };
  assert.equal((await api.resumeImport('owner', imported.id, resume, signal)).state, 'queued'); assert.deepEqual(requests.at(-1)?.body, resume);
  const cancel = { opId: randomUUID(), expectedVersion: 3 };
  assert.equal((await api.cancelImport('owner', imported.id, cancel, signal)).state, 'cancelled'); assert.deepEqual(requests.at(-1)?.body, cancel);
  const cancelUpload = { opId: randomUUID(), expectedVersion: 2 };
  assert.equal((await api.cancelUpload('owner', upload.id, cancelUpload, signal)).state, 'cancelled'); assert.deepEqual(requests.at(-1)?.body, cancelUpload);
  wrongId = true; await assert.rejects(api.createImport('owner', importCommand, signal), { code: 'handover_response_invalid' }); wrongId = false;
  const beforeInvalid = requests.length;
  await assert.rejects(api.getUpload('owner', 'invalid', signal), { code: 'invalid_input' });
  await assert.rejects(api.resumeImport('owner', imported.id, { opId: randomUUID(), expectedVersion: 0 }, signal), { code: 'invalid_input' }); assert.equal(requests.length, beforeInvalid);
  hold = true;
  const rawPending = api.uploadContent('owner', upload.id, zip, signal), importPending = api.createImport('owner', importCommand, signal);
  const rawRejected = assert.rejects(rawPending, { code: 'session_changed' }), importRejected = assert.rejects(importPending, { code: 'session_changed' });
  api.setIdentity('other'); assert.equal(held.length, 2); assert.ok(held.every(request => request.signal.aborted));
  held.forEach(request => request.release(Response.json(request.upload ? upload : imported))); await rawRejected; await importRejected;
  api.setIdentity('owner'); context.mock.timers.enable({ apis: ['setTimeout'] });
  const timedUpload = api.uploadContent('owner', upload.id, zip, signal), timeoutRejected = assert.rejects(timedUpload, { code: 'handover_unavailable' });
  context.mock.timers.tick(299999); assert.equal(held.at(-1)?.signal.aborted, false);
  context.mock.timers.tick(1); await timeoutRejected; assert.equal(held.at(-1)?.signal.aborted, true);
  held.at(-1)!.release(Response.json(upload));
  for (const request of [
    { name: 'createImport', start: () => api.createImport('owner', importCommand, signal), timeout: 300000 },
    { name: 'resumeImport', start: () => api.resumeImport('owner', imported.id, resume, signal), timeout: 300000 },
    { name: 'getImport', start: () => api.getImport('owner', imported.id, signal), timeout: 20000 },
    { name: 'cancelImport', start: () => api.cancelImport('owner', imported.id, cancel, signal), timeout: 20000 },
  ]) {
    const pending = request.start(), rejected = assert.rejects(pending, { code: 'handover_unavailable' });
    context.mock.timers.tick(request.timeout - 1); assert.equal(held.at(-1)?.signal.aborted, false, request.name + ' must retain its full deadline');
    context.mock.timers.tick(1); await rejected; assert.equal(held.at(-1)?.signal.aborted, true, request.name + ' must stop at its deadline');
    held.at(-1)!.release(Response.json(imported));
  }
});

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
