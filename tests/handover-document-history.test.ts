import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import type { DocumentSnapshot } from '../src/shared/family-documents.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

test('source document revisions preserve full paged history without consuming local versions or reviving redacted bodies', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 90)), projectId: 'demo-document-history', namespace: 'unit_document_history' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), documents = createFirestoreFamilyDocumentStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), targetChild = await admit('recipient'); await admit('other');
  const path = `/api/children/${sourceChild}/tasks`, payload = { confirm: true, values: { title: 'Original task', details: 'Retained source',
    kind: 'ordinary', assigneeUserId: 'source', dueAt: '2026-11-01T09:00:00Z', timeZone: 'Asia/Hong_Kong' } };
  await online.submit('source', { path, payload, operation: { ...await online.context('source', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  let original = (await documents.create('source', sourceChild, { kind: 'preparation', purpose: 'appointment', title: 'Source document',
    eventDate: null, period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
  const bodies: DocumentSnapshot[] = [original.current!];
  for (let i = 1; i <= 12; i++) {
    original = (await documents.change('source', sourceChild, original.id, { action: 'patch', expectedVersion: original.version,
      authorityVersion: (await documents.describe('source', sourceChild, original.id))!.authorityVersion, confirmShared: true,
      edits: i === 1 ? [{ op: 'upsert_section', sectionId: 'long', title: 'Long source revision', kind: 'notes' },
        ...Array.from({ length: 8 }, (_, index) => ({ op: 'upsert_item' as const, sectionId: 'long', itemId: `long-${index}`,
          text: '歷史🙂'.repeat(800), sourceIds: [] }))] : [{ op: 'set_metadata', summary: `Source revision ${i}` }] }, randomUUID()))!;
    bodies.push(original.current!);
  }
  const packageSource = { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
    manifestSha256: 'c'.repeat(64), path: 'data/documents.json', rowIndex: 0 };
  const parent: HandoverImportRow = { section: 'documents', childId: sourceChild,
    value: (await documents.readExportMetadata('source', sourceChild, original.id))!, source: packageSource };
  const imported = await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await documents.prepareImported(b, randomUUID(), parent, 'missing_proof', original.current); prepared.commit(); return prepared.value;
  });
  const row = (body: DocumentSnapshot, invalidated = false): HandoverImportRow => ({ section: 'document_content', childId: sourceChild,
    source: { ...packageSource, path: 'data/content.json', rowIndex: body.version }, value: { documentId: original.id, snapshotId: body.id,
      snapshotVersion: body.version, generatedAt: body.generatedAt, invalidated, snapshot: invalidated ? null : body } });
  const retained: string[] = [];
  for (const body of bodies) {
    const result = await authority.runTransaction('recipient', targetChild, async b => {
      const prepared = await documents.prepareImportedRevision(b, randomUUID(), row(body, body.version === 3), 'missing_proof',
        { id: imported.id, expectedVersion: imported.version }); prepared.commit?.(); return prepared;
    });
    assert.equal(result.outcome, 'created'); retained.push(result.snapshotId);
  }
  assert.equal((await documents.get('recipient', targetChild, imported.id))!.version, 1);
  assert.equal((await documents.listVersions('recipient', targetChild, imported.id))!.items.length, 1, 'foreign revisions are not local mutations');
  const first = await documents.listSourceVersions('recipient', targetChild, imported.id);
  assert.equal(first!.items.length, 10); assert.ok(first!.nextCursor);
  const second = await documents.listSourceVersions('recipient', targetChild, imported.id, first!.nextCursor);
  assert.equal(second!.items.length, 3); assert.equal(second!.nextCursor, null);
  assert.equal(new Set([...first!.items, ...second!.items].map(item => item.snapshotId)).size, 13);
  const long = (await documents.readSourceVersion('recipient', targetChild, imported.id, retained[1]))!;
  assert.deepEqual(long.snapshot!.sections, bodies[1].sections); assert.equal(long.origin.sourceSnapshot.version, 2);
  assert.equal(long.snapshotVersion, 1); assert.equal(long.origin.importedFrom.current.source.snapshotId, bodies[1].id);
  const redacted = (await documents.readSourceVersion('recipient', targetChild, imported.id, retained[2]))!;
  assert.equal(redacted.invalidated, true); assert.equal(redacted.snapshot, null);
  assert.equal(await documents.readExportSnapshot('recipient', targetChild, imported.id, retained[2], 1), null);
  await assert.rejects(documents.readSourceVersion('other', targetChild, imported.id, retained[1]));
  const repeat = await authority.runTransaction('recipient', targetChild, b => documents.prepareImportedRevision(b, randomUUID(), row(bodies[1]),
    'missing_proof', { id: imported.id, expectedVersion: 1 }));
  assert.equal(repeat.outcome, 'skipped'); assert.equal(repeat.snapshotId, retained[1]); assert.equal(repeat.commit, undefined);
  const conflict = await authority.runTransaction('recipient', targetChild, b => documents.prepareImportedRevision(b, randomUUID(),
    row({ ...bodies[1], summary: 'Different content under the same original version' }), 'missing_proof', { id: imported.id, expectedVersion: 1 }));
  assert.equal(conflict.outcome, 'conflict'); assert.equal(conflict.commit, undefined);
  await assert.rejects(authority.runTransaction('recipient', targetChild, b => documents.prepareImportedRevision(b, randomUUID(), row(bodies[0]),
    'missing_proof', { id: imported.id, expectedVersion: 0 })), { code: 'document_changed' });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('Unexpected photo read'); } } });
  let cursor: string | undefined, scopeVersion: string | undefined; const exported: Record<string, unknown>[] = [];
  do {
    const page = await exporter.page('recipient', { section: 'document_content', childId: targetChild, cursor, scopeVersion });
    scopeVersion = page.scopeVersion; exported.push(...page.items as Record<string, unknown>[]); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(exported.length, 14); assert.equal(exported.filter(item => item.origin).length, 13);
  const codec = createFirestoreRestoreCodec(options);
  const decoded = [...fixture.records].map(([path, data]) => codec.decode({ path, data }));
  assert.doesNotThrow(() => assertFirestoreRestoreContent(decoded), 'foreign quoted tasks need accepted copy evidence, not recipient task rows');
  const restored = serialFirestoreFixture(), restoredOptions = { ...options, database: restored.database };
  const generation = randomUUID(), newEpochByWorkspace = new Map<string, string>();
  for (const value of decoded) if (value.context.family === 'authority' && value.context.kind === 'workspace')
    newEpochByWorkspace.set(value.context.scope.workspaceId, randomUUID());
  for (const value of decoded) {
    if (value.context.family === 'authority' && value.context.kind === 'control') continue;
    const result = codec.transform(value, { generation, newEpochByWorkspace, photoDescriptors: new Map() });
    restored.records.set(result.path, result.data);
  }
  const restoredAuthority = createFirestoreAuthority(restoredOptions), restoredDocuments = createFirestoreFamilyDocumentStore(restoredOptions);
  await restoredAuthority.initializeControl({ generation, enabled: true });
  const restoredRepeat = await restoredAuthority.runTransaction('recipient', targetChild, b =>
    restoredDocuments.prepareImportedRevision(b, randomUUID(), row(bodies[1]), 'missing_proof', { id: imported.id, expectedVersion: 1 }));
  assert.equal(restoredRepeat.outcome, 'skipped', 'a new storage epoch must not change source revision identity');
  assert.equal(restoredRepeat.snapshotId, retained[1]); assert.equal(restoredRepeat.commit, undefined);
  const restoredConflict = await restoredAuthority.runTransaction('recipient', targetChild, b =>
    restoredDocuments.prepareImportedRevision(b, randomUUID(), row({ ...bodies[1], summary: 'Changed after restore' }),
      'missing_proof', { id: imported.id, expectedVersion: 1 }));
  assert.equal(restoredConflict.outcome, 'conflict'); assert.equal(restoredConflict.commit, undefined);
});
