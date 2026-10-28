import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
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
import { openHandoverArchive } from '../server/handover-archive.ts';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';

test('personal package reuses current scoped export, follows pages and refuses changed or unauthorized sources', async () => {
  const fixture = serialFirestoreFixture(), dir = await mkdtemp(join(tmpdir(), 'handover-export-'));
  const options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 83)), projectId: 'synthetic-pack',
    namespace: 'unit_pack', serverClock: () => Date.parse('2026-10-28T03:00:00Z') };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation] });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('No synthetic photo'); } } });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = `${userId}@example.test`;
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: '2026-10-29T03:00:00Z' });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const ownerChild = await admit('owner'), peerChild = await admit('peer');
  async function record(userId: string, childId: string, text: string) {
    const path = `/api/children/${childId}/records`, payload = { text };
    return online.submit(userId, { path, payload, operation: { ...await online.context(userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  for (let i = 0; i < 11; i++) await record('owner', ownerChild, `保存記錄 ${i}`);
  await record('peer', peerChild, '另一帳戶的私人資料');
  const input = { exporter, directory: dir, ownerUserId: 'owner', serverId: 'https://example.test', packageId: randomUUID(),
    createdAt: '2026-10-28T03:00:00Z', purpose: 'backup' as const,
    selection: { childIds: [ownerChild], modules: ['care'] as 'care'[], period: null }, signingKey: generateKeyPairSync('ed25519').privateKey };
  try {
    const written = await writePersonalHandoverPackage(input), archive = await openHandoverArchive({ path: written.path });
    try {
      assert.equal(archive.manifest.coverage.find(c => c.section === 'care')?.items, 11);
      const pages: any[] = [];
      for (const entry of archive.manifest.entries.filter(entry => entry.path.startsWith('data/'))) pages.push(JSON.parse((await archive.readEntry(entry.path, 1024 * 1024)).toString()));
      assert.equal(pages.filter(page => page.section === 'care').flatMap(page => page.items).length, 11);
      assert.equal(pages.some(page => ['agent_policy', 'agent_runs', 'contact_grants'].includes(page.section)), false);
      assert.ok(!JSON.stringify(pages).includes('另一帳戶'));
      assert.equal(pages.filter(page => page.section === 'children').flatMap(page => page.items).length, 1);
      assert.match((await archive.readEntry('summary.md', 65536)).toString(), /11/);
    } finally { await archive.close(); }
    await assert.rejects(writePersonalHandoverPackage({ ...input, selection: { ...input.selection, childIds: [peerChild] } }),
      (error: any) => error.code === 'package_scope_unavailable');
    let changed = false;
    const before = await readdir(dir);
    await assert.rejects(writePersonalHandoverPackage({ ...input, exporter: { async page(owner, query) {
      const result = await exporter.page(owner, query);
      if (query.section === 'care' && !changed) { changed = true; await record('owner', ownerChild, 'changed while exporting'); }
      return result;
    } } }), (error: any) => error.code === 'export_scope_changed');
    assert.deepEqual(await readdir(dir), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('package fences avatar versions across metadata, content and final authorization read', async () => {
  const f = await avatarDomainFixture(), dir = await mkdtemp(join(tmpdir(), 'handover-avatar-'));
  const childId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'pack child' })).child.id;
  const target = { kind: 'child' as const, childId };
  async function replace(version: number) {
    const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(version, target))).result);
    await f.upload(reserved.upload.id, target);
    await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.upload.id, expectedVersion: version }, target));
  }
  const exporter = createFirestoreAccountExport({ ...f.options, avatars: f.avatars, photos: { async content() { throw Error('No photo'); } } });
  const input = { exporter, directory: dir, ownerUserId: f.owner, serverId: 'https://example.test', packageId: randomUUID(),
    createdAt: '2026-10-28T04:00:00Z', purpose: 'backup' as const,
    selection: { childIds: [childId], modules: ['attachments'] as 'attachments'[], period: null } };
  try {
    await replace(0); let changed = false;
    await assert.rejects(writePersonalHandoverPackage({ ...input, exporter: { async page(owner, query) {
      const result = await exporter.page(owner, query);
      if (query.section === 'child_avatar' && !changed) { changed = true; await replace(1); }
      return result;
    } } }), (error: any) => error.code === 'export_scope_changed');
    assert.deepEqual(await readdir(dir), []);
    let finalChange = false;
    await assert.rejects(writePersonalHandoverPackage({ ...input, exporter: { async page(owner, query) {
      const result = await exporter.page(owner, query);
      if (query.section === 'child_avatar_content' && !finalChange) { finalChange = true; await replace(2); }
      return result;
    } } }), (error: any) => error.code === 'export_scope_changed');
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
