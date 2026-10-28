import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { handleFirebaseAccountData } from '../server/firebase-account-data-api.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { FirestoreDomainData, FirestoreDomainError, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { importBatchId, importBatchMetadata, importBatchSchema } from '../server/handover-import-batch-records.ts';
import { handoverImportItemId, handoverImportItemMetadata, handoverImportItemSchema } from '../server/handover-import-records.ts';
import { createHandoverApi } from '../src/client/handover-api.ts';

test('verified packages reach formal import worker, retain partial progress and import history before rejecting cancelled sources', async t => {
  const realNow = Date.now.bind(Date); let elapsed = 0, slowRead = false;
  t.mock.method(Date, 'now', () => realNow() + elapsed);
  const directory = await mkdtemp(join(tmpdir(), 'handover-runner-'));
  const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 91));
  const options = { database: fixture.database, cipher, projectId: 'demo-import-runner', namespace: 'unit_import_runner' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), codec = createFirestoreRestoreCodec(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), recipientChild = await admit('recipient'); await admit('other');
  const originals = await Promise.all(['one', 'two'].map(text => care.create('source', sourceChild,
    { text, details: emptyCareDetails(), source: 'Original account' })));
  const stored = new Map<string, { body: Buffer; metadata: any }>();
  const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-import' }, files: cipher.files,
    bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, config) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
        final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-import', generation: '11111111111111111',
          size: String(body.length), metadata: config.metadata?.metadata } }); done(); } }); },
      readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); },
    } });
  const uploads = createHandoverUploadService({ ...options, objects }); let cancelWhenOpened = false;
  const service = createHandoverImportService({ ...options, maxItemsPerExecution: 1, uploads: { ...uploads,
    async open(owner, id, signal) { const opened = await uploads.open(owner, id, signal);
      if (slowRead) { slowRead = false; elapsed = 75_000; }
      if (cancelWhenOpened) { cancelWhenOpened = false; await uploads.cancel(owner, id, { opId: randomUUID(), expectedVersion: opened.job.version }); }
      return opened;
    } } });
  const deliveries: any[] = [], controller = new AbortController();
  const runtime: any = { ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
    currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) };
  const worker = createFirebaseWorkerServices(runtime, { taskName: () => 'unused', enqueue: async () => { throw new Error('Unexpected reminder'); },
    probe: async () => { throw new Error('Unexpected reminder'); } }, { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; },
    async probe() { return { state: 'confirmed' }; } }, controller);
  const call = async (path: string, body?: unknown, owner = 'recipient') => handleFirebaseAccountData(new Request('https://local.test/api/account/package-imports' + path,
    { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': owner },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { getSession: async () => ({ user: { id: owner } }) } as any,
    { packageImports: service } as any, request => request.json());
  async function upload(history = false) {
    const scopeVersion = 'a'.repeat(64), pages = [
      { section: 'children', childId: null, items: [{ id: sourceChild, displayName: 'Source child' }] },
      { section: 'care_history', childId: sourceChild, items: history ? [originals[0]] : [] },
      { section: 'care', childId: sourceChild, items: originals },
    ];
    async function* entries() { for (let i = 0; i < pages.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json',
      content: Buffer.from(JSON.stringify({ ...pages[i], scopeVersion })) }; yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Test') }; }
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: new Date().toISOString(), purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' },
      selection: { childIds: [sourceChild], modules: ['care'], period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    const bytes = await readFile(archive.path), id = randomUUID();
    await uploads.create('recipient', { opId: id, filename: 'handover.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    return uploads.receive('recipient', id, Readable.from([bytes]), controller.signal);
  }
  const nextDelivery = async () => {
    await worker.background.dispatch();
    const choices = deliveries.splice(0).filter(delivery => { const record = [...fixture.records].find(([path, data]) => path.includes('_background_work/') && data.id === delivery.id)!;
      const work = codec.decode({ path: record[0], data: record[1] }).value as any;
      if (work.kind !== 'handover-import') return false;
      const batch = [...fixture.records].filter(([path]) => path.includes('_handover_import_batches/'))
        .map(([path, data]) => codec.decode({ path, data }).value as any).find(value => value.id === work.resourceId);
      // The dispatcher can already have scheduled a stale execution; the lease fence, not queue deletion, stops it.
      return work.basis === `${batch.fingerprint}:${batch.execution}` && ['queued', 'running'].includes(batch.state);
    });
    assert.equal(choices.length, 1); return choices[0];
  };
  try {
    const uploaded = await upload();
    const command = { opId: randomUUID(), uploadId: uploaded.id, expectedUploadVersion: uploaded.version,
      acceptedManifestSha256: uploaded.preview!.manifestSha256, targets: [{ sourceChildId: sourceChild, target: { childId: recipientChild, spaceId: null }, sections: ['care'] }], resolutions: [] };
    const created = await (await call('', command)).json(); assert.equal(created.state, 'queued'); assert.equal(created.totalItems, 2);
    const initialList = await (await call('')).json(); assert.deepEqual(initialList.items.map((item: any) => item.id), [command.opId]);
    assert.equal(initialList.nextCursor, null);
    assert.equal((await (await call('', command)).json()).id, command.opId);
    await assert.rejects(call('', { ...command, acceptedManifestSha256: null }), { code: 'operation_conflict' });
    await assert.rejects(call('/' + command.opId, undefined, 'other'), { code: 'import_batch_not_found' });
    const firstDelivery = await nextDelivery(); slowRead = true;
    const first = await worker.background.process(firstDelivery); elapsed = 0;
    assert.equal(first.state, 'pending', JSON.stringify(await service.get('recipient', command.opId)));
    const partial = await service.get('recipient', command.opId); assert.equal(partial.processedItems, 1);
    const cancelled = await service.cancel('recipient', command.opId, { opId: randomUUID(), expectedVersion: partial.version });
    const resumeCommand = { opId: randomUUID(), expectedVersion: cancelled.version };
    const resumed = await service.resume('recipient', command.opId, resumeCommand, controller.signal);
    assert.equal(resumed.processedItems, 1);
    const finalDelivery = await nextDelivery(); assert.equal((await worker.background.process(finalDelivery)).state, 'completed');
    assert.equal((await worker.background.process(finalDelivery)).state, 'completed');
    const done = await service.get('recipient', command.opId); assert.deepEqual(done.counts, { created: 2, updated: 0, conflict: 0, skipped: 0 });
    const resultQuery = new URLSearchParams({ sourceChildId: sourceChild, module: 'care' }).toString();
    const resultPage = await (await call('/' + command.opId + '/items?' + resultQuery)).json();
    assert.equal(resultPage.items.length, 2); assert.equal(resultPage.complete, true);
    assert.ok(resultPage.items.every((item: any) => item.outcome === 'created' && item.availableResolution === null));
    assert.equal(JSON.stringify(resultPage).includes('Original account'), false, 'Results do not expose original record bodies');
    await assert.rejects(call('/' + command.opId + '/items?' + resultQuery, undefined, 'other'), { code: 'import_batch_not_found' });
    await assert.rejects(call('/' + command.opId + '/items?' + resultQuery + '&module=tasks'), { code: 'invalid_input' });
    await assert.rejects(call('/' + command.opId + '/items?' + new URLSearchParams({ sourceChildId: sourceChild, module: 'tasks' })), { code: 'import_result_scope_unavailable' });
    const repeated = await (await call('', command)).json(); assert.equal(repeated.state, 'completed');
    const blocked = await upload(true), blockedCommand = { ...command, opId: randomUUID(), uploadId: blocked.id,
      expectedUploadVersion: blocked.version, acceptedManifestSha256: blocked.preview!.manifestSha256 };
    const withHistory = await (await call('', blockedCommand)).json(); assert.equal(withHistory.state, 'queued');
    assert.equal(withHistory.processedItems, 0); assert.equal(withHistory.totalItems, 3);
    for (let i = 0; i < 3; i++) { await worker.background.process(await nextDelivery()); elapsed += 2000; }
    const histories = await service.get('recipient', blockedCommand.opId); assert.equal(histories.state, 'completed');
    assert.deepEqual(histories.counts, { created: 1, updated: 0, conflict: 0, skipped: 2 });
    const storedHistory = [...fixture.records].filter(([path]) => path.includes('_handover_source_history/'))
      .map(([path, data]) => codec.decode({ path, data }).value as any);
    assert.equal(storedHistory.length, 1);
    const historyPage = await (await call('/source-history?' + new URLSearchParams({ childId: recipientChild, module: 'care', resourceId: storedHistory[0].resource.id }))).json();
    assert.equal(historyPage.items[0].evidence.value.text, originals[0]!.text);
    await assert.rejects(call('/source-history?' + new URLSearchParams({ childId: recipientChild, module: 'care', resourceId: storedHistory[0].resource.id }), undefined, 'other'));
    const imported = resultPage.items.find((item: any) => item.sourceResourceId === originals[0]!.id).recordedResource;
    const revised = await care.revise('recipient', recipientChild, imported.id,
      { text: 'Local edit', details: emptyCareDetails(), source: 'Recipient' }, imported.version, 'Local correction');
    assert.ok(revised);
    const conflictCommand = { ...command, opId: randomUUID() };
    await call('', conflictCommand);
    for (let i = 0; i < 2; i++) { await worker.background.process(await nextDelivery()); elapsed += 2000; }
    const conflictPage = await (await call('/' + conflictCommand.opId + '/items?' + resultQuery)).json();
    const conflict = conflictPage.items.find((item: any) => item.outcome === 'conflict');
    assert.equal(conflict.availableResolution, 'replace_current');
    assert.deepEqual(conflict.currentResource, { id: imported.id, version: revised.version, deleted: false });
    const newer = await care.revise('recipient', recipientChild, imported.id,
      { text: 'Newer local edit', details: emptyCareDetails(), source: 'Recipient' }, revised.version, 'Second correction');
    assert.ok(newer);
    const staleCommand = { ...command, opId: randomUUID(), resolutions: [{ sourceChildId: sourceChild, section: 'care', resourceId: originals[0]!.id,
      resolution: { mode: 'replace_current', targetId: imported.id, expectedVersion: revised.version } }] };
    await call('', staleCommand);
    for (let i = 0; i < 2; i++) { await worker.background.process(await nextDelivery()); elapsed += 2000; }
    assert.equal((await service.get('recipient', staleCommand.opId)).counts.conflict, 1);
    assert.equal((await care.get('recipient', recipientChild, imported.id))!.text, 'Newer local edit');
    const refreshed = await (await call('/' + conflictCommand.opId + '/items?' + resultQuery)).json();
    assert.equal(refreshed.items.find((item: any) => item.id === conflict.id).currentResource.version, newer.version);
    const resolvedCommand = { ...staleCommand, opId: randomUUID(), resolutionOnly: true, resolutions: [{ ...staleCommand.resolutions[0],
      resolution: { ...staleCommand.resolutions[0].resolution, expectedVersion: newer.version } }] };
    await call('', resolvedCommand);
    await worker.background.process(await nextDelivery()); elapsed += 2000;
    const resolved = await service.get('recipient', resolvedCommand.opId);
    assert.equal(resolved.totalItems, 1);
    assert.deepEqual(resolved.counts, { created: 0, updated: 1, skipped: 0, conflict: 0 });
    assert.equal((await care.get('recipient', recipientChild, imported.id))!.text, originals[0]!.text);
    assert.deepEqual((await service.get('recipient', conflictCommand.opId)).counts, { created: 0, updated: 0, skipped: 1, conflict: 1 });
    assert.deepEqual((await (await call('', resolvedCommand)).json()).counts, resolved.counts);
    const noLongerActionable = await (await call('/' + conflictCommand.opId + '/items?' + resultQuery)).json();
    assert.equal(noLongerActionable.items.find((item: any) => item.id === conflict.id).availableResolution, null);
    const revoked = await upload(), revokedCommand = { ...command, opId: randomUUID(), uploadId: revoked.id,
      expectedUploadVersion: revoked.version, acceptedManifestSha256: revoked.preview!.manifestSha256 };
    const before = [...fixture.records.keys()].filter(path => path.includes('_handover_import_items/')).length;
    await call('', revokedCommand); cancelWhenOpened = true;
    assert.equal((await worker.background.process(await nextDelivery())).state, 'stopped');
    const stopped = await service.get('recipient', revokedCommand.opId); assert.equal(stopped.processedItems, 0); assert.equal(stopped.state, 'failed');
    assert.equal([...fixture.records.keys()].filter(path => path.includes('_handover_import_items/')).length, before);
    await uploads.cancel('recipient', uploaded.id, { opId: randomUUID(), expectedVersion: uploaded.version });
    assert.equal((await service.resume('recipient', command.opId, resumeCommand, controller.signal)).state, 'completed');
    const data = new FirestoreDomainData(options), entries = [...fixture.records].filter(([path]) => path.includes('_handover_import_batches/'));
    const template = codec.decode({ path: entries[0][0], data: entries[0][1] }).value as any;
    assert.equal(template.scope.childId, '00000000-0000-0000-0000-000000000000');
    const expectedIds = new Set(entries.map(([path, value]) => (codec.decode({ path, data: value }).value as any).id));
    for (let i = entries.length; i < 21; i++) {
      const id = randomUUID(), request = { ...template.request, opId: id }, batch = { ...template, id, request, fingerprint: firestoreDomainHash(request) };
      const logicalId = importBatchId('recipient', id), target = data.ref('handover_import_batches', 'handover-import-batch', logicalId);
      assert.notEqual(target.id, id, 'The stored document ID is a hash, not the public batch UUID');
      fixture.records.set(target.path, { ...data.tags(batch.scope), ...importBatchMetadata(batch),
        ...data.seal('handover-import-batch', logicalId, batch.scope, importBatchSchema, batch, batch.version) }); expectedIds.add(id);
    }
    const listFetcher: typeof fetch = async (input, init) => {
      assert.ok(init);
      assert.equal(init?.method, 'GET'); assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
      const url = new URL(String(input)), owner = new Headers(init.headers).get('x-expected-user-id')!;
      assert.equal(url.pathname, '/api/account/package-imports');
      try { return (await call(url.search, undefined, owner))!; }
      catch (error) { if (error instanceof FirestoreDomainError) return Response.json({ error: { code: error.code } }, { status: error.status }); throw error; }
    };
    const firstClient = createHandoverApi('https://local.test', listFetcher); firstClient.setIdentity('recipient');
    const firstPage = await firstClient.listImports('recipient', controller.signal); assert.equal(firstPage.items.length, 20); assert.ok(firstPage.nextCursor);
    const restoredClient = createHandoverApi('https://local.test', listFetcher); restoredClient.setIdentity('recipient');
    const lastPage = await restoredClient.listImports('recipient', controller.signal, firstPage.nextCursor);
    assert.equal(lastPage.items.length, 1); assert.equal(lastPage.nextCursor, null);
    assert.deepEqual(new Set([...firstPage.items, ...lastPage.items].map(item => item.id)), expectedIds);
    restoredClient.setIdentity('other'); assert.deepEqual((await restoredClient.listImports('other', controller.signal)).items, []);
    await assert.rejects(restoredClient.listImports('other', controller.signal, firstPage.nextCursor), { status: 400, code: 'invalid_cursor' });
    await assert.rejects(call('?cursor=invalid'), { code: 'invalid_cursor' });
    await assert.rejects(call('?cursor=one&cursor=two'), { code: 'invalid_input' });
    await assert.rejects(call('?other=value'), { code: 'invalid_input' });
    const oldScopeCursor = JSON.parse(Buffer.from(firstPage.nextCursor, 'base64url').toString('utf8'));
    oldScopeCursor.scope = firestoreDomainHash({ ...template.scope, storageEpoch: randomUUID() });
    await assert.rejects(call('?cursor=' + Buffer.from(JSON.stringify(oldScopeCursor)).toString('base64url')), { code: 'invalid_cursor' });
    const firstRef = data.ref('handover_import_batches', 'handover-import-batch', importBatchId('recipient', firstPage.items[0].id));
    const originalRow = fixture.records.get(firstRef.path)!; fixture.records.set(firstRef.path, { ...originalRow, state: 'tampered' });
    try { await assert.rejects(call(''), { code: 'import_batch_binding' }); }
    finally { fixture.records.set(firstRef.path, originalRow); }
    const loopingClient = createHandoverApi('https://local.test', async () => Response.json({ items: [], nextCursor: 'loop' })); loopingClient.setIdentity('recipient');
    await assert.rejects(loopingClient.listImports('recipient', controller.signal, 'loop'), { code: 'handover_response_invalid' });
    const receiptTemplate = [...fixture.records].filter(([path]) => path.includes('_handover_import_items/'))
      .map(([path, row]) => codec.decode({ path, data: row }))
      .find(decoded => (decoded.value as any).batchId === command.opId)!;
    assert.equal(receiptTemplate.context.family, 'domain');
    for (let i = 2; i < 21; i++) {
      const receipt = { ...(receiptTemplate.value as any), opId: randomUUID() }, scope = (receiptTemplate.context as { scope: typeof template.scope }).scope;
      const logicalId = handoverImportItemId(scope, receipt.opId), ref = data.ref('handover_import_items', 'handover-import-item', logicalId);
      fixture.records.set(ref.path, { ...data.tags(scope), ...handoverImportItemMetadata(receipt),
        ...data.seal('handover-import-item', logicalId, scope, handoverImportItemSchema, receipt) });
    }
    const resultClient = createHandoverApi('https://local.test', async (input, init) => {
      const url = new URL(String(input)); assert.equal(init?.method, 'GET');
      assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'include');
      return (await call(url.pathname.slice('/api/account/package-imports'.length) + url.search))!;
    }); resultClient.setIdentity('recipient');
    const resultFirst = await resultClient.importResults('recipient', command.opId, { sourceChildId: sourceChild, module: 'care' }, controller.signal);
    assert.equal(resultFirst.items.length, 20); assert.equal(resultFirst.complete, false); assert.ok(resultFirst.nextCursor);
    const resultLast = await resultClient.importResults('recipient', command.opId,
      { sourceChildId: sourceChild, module: 'care', cursor: resultFirst.nextCursor! }, controller.signal);
    assert.equal(resultLast.items.length, 1); assert.equal(resultLast.complete, true);
    assert.equal(new Set([...resultFirst.items, ...resultLast.items].map(item => item.id)).size, 21);
    await assert.rejects(call('/' + command.opId + '/items?' + resultQuery + '&cursor=invalid'), { code: 'invalid_cursor' });
    await assert.rejects(call('/' + conflictCommand.opId + '/items?' + resultQuery + '&cursor=' + encodeURIComponent(resultFirst.nextCursor!)), { code: 'import_results_changed' });
    const current = await care.get('recipient', recipientChild, imported.id);
    await care.revise('recipient', recipientChild, imported.id,
      { text: 'Changed after page', details: emptyCareDetails(), source: 'Recipient' }, current!.version, 'Correction after reading');
    await assert.rejects(call('/' + command.opId + '/items?' + resultQuery + '&cursor=' + encodeURIComponent(resultFirst.nextCursor!)), { code: 'import_results_changed' });
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
