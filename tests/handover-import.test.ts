import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { openHandoverImport } from '../server/handover-import.ts';

test('verified import keeps source statements, binds paging and rejects inconsistent scope before handing rows to writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handover-import-'));
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 91)), projectId: 'synthetic-import', namespace: 'unit_import',
    serverClock: () => Date.parse('2026-10-28T03:00:00Z') };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation] });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('No photo'); } } });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'source@example.test', operationId: randomUUID(), expiresAt: '2026-10-29T03:00:00Z' });
  await authority.admitIdentity({ userId: 'source', email: 'source@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'source', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const child = (await authority.createChild({ userId: 'source', operationId: randomUUID(), displayName: 'Same name' })).child;
  const path = `/api/children/${child.id}/records`, payload = { text: '原來的說法可能不準確，但匯入不能重新宣稱已確認' };
  await online.submit('source', { path, payload, operation: { ...await online.context('source', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const keys = generateKeyPairSync('ed25519'), keyId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const selection = { childIds: [child.id], modules: ['care'] as 'care'[] };
  const header = { format: 'yuyoufang-data' as const, version: 1 as const, packageId: randomUUID(), packageVersion: 1,
    createdAt: '2026-10-28T03:00:00Z', purpose: 'backup' as const, source: { serverId: 'https://source.test', accountId: 'source' },
    selection: { ...selection, period: null } };
  try {
    const zip = await writePersonalHandoverPackage({ exporter, directory: dir, ownerUserId: 'source',
      serverId: header.source.serverId, packageId: header.packageId, createdAt: header.createdAt, purpose: header.purpose,
      selection: header.selection, signingKey: keys.privateKey });
    const trusted = await openHandoverImport({ path: zip.path, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId: header.source.serverId }]]) });
    let checkpoint: any;
    try {
      assert.equal(trusted.integrity, 'trusted');
      assert.equal(trusted.children[0].id, child.id);
      const first = await trusted.readPage({ selection, limit: 1 }); checkpoint = first.nextCursor;
      assert.ok(checkpoint);
      const next = await trusted.readPage({ selection, cursor: checkpoint, limit: 1 });
      assert.equal(next.rows[0].section, 'care');
      assert.equal(next.rows[0].value.confirmedBy, 'source');
      assert.equal(next.rows[0].value.text, payload.text);
      assert.equal(next.rows[0].source.manifestSha256, trusted.manifestSha256);
      assert.equal(next.rows[0].source.accountId, 'source');
      await assert.rejects(trusted.readPage({ selection: { ...selection, childIds: [randomUUID()] } }), (e: any) => e.code === 'package_scope_unavailable');
      await assert.rejects(trusted.readPage({ selection, cursor: { ...checkpoint, manifestSha256: 'f'.repeat(64) } }), (e: any) => e.code === 'invalid_package_cursor');
      // Mutating a public view cannot change the fixed archive or widen subsequent reads.
      trusted.manifest.selection.childIds.push(randomUUID());
      assert.equal((await trusted.readPage({ selection, limit: 1 })).rows[0].value.id, child.id);
    } finally { await trusted.close(); }
    const resumed = await openHandoverImport({ path: zip.path });
    try {
      await assert.rejects(resumed.readPage({ selection }), (e: any) => e.code === 'package_trust_acknowledgement_required');
      await assert.rejects(resumed.readPage({ selection, acknowledgedManifestSha256: 'e'.repeat(64) }), (e: any) => e.code === 'package_trust_acknowledgement_required');
      assert.equal((await resumed.readPage({ selection, cursor: checkpoint, limit: 1,
        acknowledgedManifestSha256: resumed.manifestSha256 })).rows[0].value.text, payload.text);
    } finally { await resumed.close(); }

    const scopeVersion = 'a'.repeat(64), recordId = randomUUID();
    const pages: any[] = [
      { section: 'children', childId: null, scopeVersion, items: [child] },
      { section: 'care', childId: child.id, scopeVersion, items: [{ id: recordId, childId: child.id, version: 1, text: 'not clinically checked' }] },
      { section: 'care_history', childId: child.id, scopeVersion, items: [] },
    ];
    async function malformed(changed: any[], coverage = pages.map(p => ({ section: p.section, childId: p.childId, scopeVersion, items: p.items.length, complete: true as const }))) {
      async function* entries() {
        for (let i = 0; i < changed.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify(changed[i])) };
        yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Summary') };
      }
      return writeHandoverArchive({ directory: dir, header, entries: entries(), coverage: () => coverage });
    }
    const changedChild = structuredClone(pages); changedChild[1].items[0].childId = randomUUID();
    await assert.rejects(openHandoverImport({ path: (await malformed(changedChild)).path }), (e: any) => e.code === 'invalid_package_scope');
    const missing = pages.slice(0, 2);
    await assert.rejects(openHandoverImport({ path: (await malformed(missing)).path }), (e: any) => e.code === 'invalid_package_coverage');
    const forgedCount = pages.map(p => ({ section: p.section, childId: p.childId, scopeVersion, items: p.items.length + 1, complete: true as const }));
    await assert.rejects(openHandoverImport({ path: (await malformed(pages, forgedCount)).path }), (e: any) => e.code === 'invalid_package_coverage');
    const execution = structuredClone(pages); execution[2].section = 'task_outbox';
    await assert.rejects(openHandoverImport({ path: (await malformed(execution)).path }), (e: any) => e.code === 'invalid_package_scope');

    const fileId = randomUUID(), bytes = Buffer.from('small attachment'), mediaSelection = { ...selection, modules: ['attachments'] as 'attachments'[] };
    const media = await writePersonalHandoverPackage({ directory: dir, ownerUserId: 'source', serverId: header.source.serverId,
      packageId: randomUUID(), createdAt: header.createdAt, purpose: 'handover', selection: { ...mediaSelection, period: null },
      exporter: { async page(_owner, query) {
        let items: unknown[] = [];
        if (query.section === 'children') items = [child];
        if (query.section === 'child_avatar') items = [{ target: { kind: 'child', childId: child.id }, version: 0, asset: null, updatedAt: null }];
        if (query.section === 'files') items = [{ id: fileId, childId: child.id, version: 1 }];
        if (query.section === 'file_content') items = [{ fileId, version: 1, base64: bytes.toString('base64'), mimeType: 'text/plain' }];
        return { section: query.section, scopeVersion, items, nextCursor: null, complete: true, notices: [] };
      } } });
    const mediaRead = await openHandoverImport({ path: media.path });
    try {
      const rows = await mediaRead.readPage({ selection: mediaSelection, acknowledgedManifestSha256: mediaRead.manifestSha256 });
      const ref = rows.rows.find(row => row.section === 'file_content')!.value.attachmentPath as string;
      assert.deepEqual((await mediaRead.readAttachment(ref, mediaSelection, mediaRead.manifestSha256)).content, bytes);
      await assert.rejects(mediaRead.readAttachment(ref, { ...mediaSelection, childIds: [randomUUID()] }, mediaRead.manifestSha256),
        (e: any) => e.code === 'package_scope_unavailable');
    } finally { await mediaRead.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
