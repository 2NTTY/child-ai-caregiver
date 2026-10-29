import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharedInputStore, sharedInputImportSchema } from '../server/firestore-shared-inputs.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('private source copies reuse the original store without importing grants, runs or foreign record links', async () => {
  const fixture = firestoreDomainFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 67)), projectId: 'demo-source-import', namespace: 'unit_source_import' };
  const authority = createFirestoreAuthority(options), store = createFirestoreSharedInputStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), childId = await admit('recipient'); await admit('other');
  const source = await authority.runTransaction('source', sourceChild, async b => {
    const prepared = await store.prepareCreate(b, randomUUID(), { kind: 'personal_source', sourceLabel: 'Original material',
      sourceUrl: 'https://example.test/reference', sourceNotes: 'Original note', sourceDateText: 'October', text: 'Original paragraph' },
    { intention: 'Reference', purpose: 'answer_reference', nature: 'external_material', timeScope: 'long_reference',
      validityText: '', enabled: true, modelExcerpt: 'Original paragraph' }); prepared.commit(); return prepared.value;
  });
  // The package may contain completed or interrupted source-side work, but no local execution is inherited.
  const body = 'Original paragraph\n' + 'Long source '.repeat(2000);
  const row: HandoverImportRow = { section: 'private_sources', childId: sourceChild, value: { ...source,
    kind: 'public_source', sourceId: 'foreign-official-id',
    text: body, sha256: createHash('sha256').update(body).digest('hex'), fetchState: 'running',
    extraction: { ...source.extraction, state: 'available', runId: randomUUID(), excerpt: 'Original paragraph', processedAt: new Date().toISOString(), model: 'foreign-model' },
    recordId: randomUUID(), confirmationKind: 'family_record' }, source: { serverId: 'https://source.test', accountId: 'source',
    packageId: randomUUID(), packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/sources.json', rowIndex: 0 } };
  const imported = await authority.runTransaction('recipient', childId, async b => {
    const prepared = await store.prepareImported(b, randomUUID(), row, 'missing_proof'); prepared.commit(); return prepared.value;
  });
  assert.notEqual(imported.id, source.id); assert.equal(imported.childId, childId); assert.equal(imported.ownerUserId, 'recipient');
  assert.equal(imported.kind, 'personal_source'); assert.equal(imported.sourceId, null);
  assert.equal(imported.text, body); assert.equal(imported.management?.enabled, true); assert.equal(imported.management?.modelExcerpt, null);
  assert.equal(imported.fetchState, 'ready'); assert.equal(imported.extraction.state, 'not_requested'); assert.equal(imported.extraction.runId, null);
  assert.equal(imported.recordId, null); assert.equal(imported.confirmationKind, null); assert.equal('importedFrom' in imported, false, 'existing strict client DTO stays compatible');
  const reopened = createFirestoreSharedInputStore(options); assert.equal((await reopened.get('recipient', childId, imported.id))?.text, body);
  await assert.rejects(reopened.get('other', childId, imported.id));
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unused photo port'); } } });
  const exported = await exporter.page('recipient', { section: 'private_sources', childId });
  const copy = exported.items.map(value => sharedInputImportSchema.parse(value)).find(value => value.id === imported.id)!;
  assert.equal(copy.importedFrom!.current.source.resourceId, source.id);
  assert.equal(copy.importedFrom!.current.source.resourceVersion, source.version);
  await assert.rejects(authority.runTransaction('recipient', childId, b => store.prepareImported(b, randomUUID(), row,
    'missing_proof', { id: imported.id, expectedVersion: imported.version + 1 })), { code: 'version_conflict' });
  const updated = await authority.runTransaction('recipient', childId, async b => {
    const prepared = await store.prepareImported(b, randomUUID(), { ...row, value: { ...row.value, version: source.version + 1, sourceLabel: 'Updated source' } },
      'missing_proof', { id: imported.id, expectedVersion: imported.version }); prepared.commit(); return prepared.value;
  });
  assert.equal(updated.id, imported.id); assert.equal(updated.version, imported.version + 1);
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, data] of fixture.records) if (/shared_inputs\/|shared_input_parts\//u.test(path)) codec.decode({ path, data });
  await store.delete('recipient', childId, updated.id, updated.version);
  const deleted = await authority.runTransaction('recipient', childId, b => store.readImportState(b, updated.id));
  assert.equal(deleted.value, null); assert.equal(deleted.version, updated.version + 1);
  assert.equal((await exporter.page('recipient', { section: 'private_sources', childId })).items.length, 0);
});
