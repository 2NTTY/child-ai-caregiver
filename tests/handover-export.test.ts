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
import { openHandoverImport } from '../server/handover-import.ts';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';

test('a dated package filters by event, due and message time through export and import', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-period-'));
  const childId = randomUUID(), scopeVersion = 'a'.repeat(64);
  const period = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-01T23:59:59.999+08:00' };
  const outside = '2026-11-01T16:00:00Z', lower = '2026-10-31T16:00:00Z';
  const record = (at: string | null) => ({ id: randomUUID(), childId, version: 1, createdAt: outside,
    details: { eventTime: { at } }, text: at === null ? 'undated' : at });
  const inScope = record(lower), outOfScope = record(outside);
  const task = { id: randomUUID(), childId, version: 1, createdAt: outside, occurrence: { dueAt: period.to } };
  const message = { id: randomUUID(), childId, createdAt: lower };
  const rows: Record<string, unknown[]> = {
    children: [{ id: childId, displayName: 'Child' }], care: [inScope, outOfScope, record(null)], care_history: [inScope, outOfScope],
    tasks: [task], task_history: [{ task, at: outside }], chat: [message, { ...message, id: randomUUID(), createdAt: outside }],
    chat_imports: [{ id: randomUUID(), childId, message: { ...message }, importedAt: outside }],
  };
  const exporter = { async page(_owner: string, query: { section: string }) {
    return { section: query.section, scopeVersion, items: rows[query.section] ?? [], complete: true, nextCursor: null, notices: [] };
  } };
  try {
    const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'owner', serverId: 'https://example.test',
      packageId: randomUUID(), createdAt: outside, purpose: 'handover', selection: { childIds: [childId], modules: ['care', 'tasks', 'chat'], period } });
    const opened = await openHandoverImport({ path: archive.path });
    try {
      assert.deepEqual(opened.manifest.selection.period, period);
      assert.deepEqual(Object.fromEntries(opened.manifest.coverage.map(row => [row.section, row.items])),
        { children: 1, care: 1, care_history: 1, tasks: 1, task_history: 1, chat: 1, chat_imports: 1 });
      const page = await opened.readPage({ selection: { childIds: [childId], modules: ['care'] }, sections: ['care'],
        acknowledgedManifestSha256: opened.manifestSha256, limit: 10 });
      assert.deepEqual(page.rows.map(row => row.value.id), [inScope.id]);
    } finally { await opened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
