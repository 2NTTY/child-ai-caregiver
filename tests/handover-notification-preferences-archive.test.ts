import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import { openHandoverArchive, writeHandoverArchive } from '../server/handover-archive.ts';
import type { HandoverHeader } from '../src/shared/handover.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/shared/family.ts';
import { handleFirebaseAccountData } from '../server/firebase-account-data-api.ts';
import { handleHandoverUpload } from '../server/firebase-handover-upload-api.ts';

test('authorized account exporter returns the default v0 without creating a preferences record', async () => {
  const fixture = serialFirestoreFixture();
  const options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 74)), projectId: 'preferences-export', namespace: 'preferences_export' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected photo read'); } } }), before = fixture.records.size;
  const page = await exporter.page('owner', { section: 'notification_preferences' });
  assert.deepEqual(page.items, [DEFAULT_NOTIFICATION_PREFERENCES]);
  assert.equal(fixture.records.size, before);
  assert.equal(exporter.notificationPreferencesAvailable, true);
});

test('legacy HTTP readers cannot receive v3 package selections or upload previews', async () => {
  const id = randomUUID(), selection = { childIds: [], modules: [], period: null, notificationPreferences: { version: 0 } };
  const row = { id, selection }, legacy = { id: randomUUID(), selection: { childIds: [randomUUID()], modules: ['care'], period: null } };
  const auth = { async getSession() { return { user: { id: 'owner' } }; } };
  const packages = { async list() { return { items: [row, legacy], nextCursor: null }; }, async get() { return row; },
    capabilities(_review: boolean, _avatar: boolean, preferences: boolean) { return preferences ? { classModules: [], notificationPreferencesBackup: true } : { classModules: [] }; } };
  const request = (path: string, modern = false, method = 'GET') => new Request('https://example.test/api/account/' + path,
    { method, headers: { 'x-expected-user-id': 'owner', 'x-handover-account-backup': '1', ...(modern ? { 'x-handover-account-features': 'notification-preferences' } : {}) } });
  const run = (path: string, modern = false, method = 'GET') => handleFirebaseAccountData(request(path, modern, method), auth as any, { packages } as any, r => r.json());
  assert.deepEqual((await (await run('packages')).json()).items, [legacy]);
  assert.deepEqual((await (await run('packages', true)).json()).items, [row, legacy]);
  assert.equal(Object.hasOwn(await (await run('packages/capabilities')).json(), 'notificationPreferencesBackup'), false);
  assert.equal((await (await run('packages/capabilities', true)).json()).notificationPreferencesBackup, true);
  for (const suffix of ['', '/download', '/cancel', '/reconcile'])
    await assert.rejects(run('packages/' + id + suffix, false, suffix === '/cancel' || suffix === '/reconcile' ? 'POST' : 'GET'), { code: 'unsupported_package_format' });
  const uploads = { async get() { return { preview: { header: { version: 3, selection } } }; } };
  await assert.rejects(handleHandoverUpload(request('package-uploads/' + id), 'owner', uploads as any, r => r.json(), async () => {}), { code: 'unsupported_package_format' });
  assert.equal((await (await handleHandoverUpload(request('package-uploads/' + id, true), 'owner', uploads as any, r => r.json(), async () => {})).json()).preview.header.version, 3);
});

test('account preference backup pins default and stored versions without children or execution data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-preferences-'));
  const scopeVersion = 'a'.repeat(64), at = '2026-11-08T00:00:00Z';
  const childId = randomUUID();
  let value = { version: 0, timeZone: 'Asia/Hong_Kong', quietStart: '22:00', quietEnd: '08:00', allowAppointmentDuringQuiet: false };
  let changed = false, reads = 0;
  const seen: string[] = [];
  const exporter = { async page(_owner: string, query: { section: string }) {
    seen.push(query.section);
    return { section: query.section, scopeVersion, complete: true, nextCursor: null, notices: [],
      items: query.section === 'notification_preferences' ? [{ ...value, version: changed && ++reads > 1 ? value.version + 1 : value.version }]
        : query.section === 'children' ? [{ id: childId, displayName: 'Selected child' }]
        : query.section === 'self_avatar' ? [{ target: { kind: 'self' }, asset: null, updatedAt: null, version: 0 }] : [] };
  } };
  const base = { directory, exporter, ownerUserId: 'owner', serverId: 'issuer', createdAt: at, purpose: 'backup' as const };
  const selection = () => ({ childIds: [], modules: [], period: { from: at, to: at }, notificationPreferences: { version: value.version } });
  try {
    for (const version of [0, 4]) {
      value = { ...value, version }; seen.length = 0; reads = 0;
      const written = await writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: selection() });
      const archive = await openHandoverArchive({ path: written.path });
      try {
        assert.equal(archive.manifest.version, 3);
        assert.deepEqual(archive.manifest.coverage.map(row => [row.section, row.childId, row.items]), [['children', null, 0], ['notification_preferences', null, 1]]);
        const summary = archive.manifest.entries.find(row => row.path === 'summary.md')!;
        assert.match((await archive.readEntry(summary.path, summary.bytes)).toString(), /本人明確/);
      } finally { await archive.close(); }
      const reader = await openHandoverImport({ path: written.path });
      try {
        assert.deepEqual(await reader.readNotificationPreferences(reader.manifestSha256), value);
        assert.throws(() => reader.readNotificationPreferences('b'.repeat(64)), { code: 'package_scope_unavailable' });
      } finally { await reader.close(); }
      assert.equal(seen.includes('children'), false);
      assert.ok(seen.every(section => ['manifest', 'notification_preferences'].includes(section)));
    }
    const mixed = await writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: {
      ...selection(), period: null, childIds: [childId], modules: ['care'], accountAvatar: { version: 0 },
    } });
    const mixedReader = await openHandoverImport({ path: mixed.path });
    try {
      assert.equal(mixedReader.manifest.version, 3);
      assert.deepEqual(mixedReader.readNotificationPreferences(mixedReader.manifestSha256), value);
      assert.equal((await mixedReader.readAccountAvatar(mixedReader.manifestSha256)).head.version, 0);
      assert.equal(mixedReader.children[0].id, childId);
    } finally { await mixedReader.close(); }
    await assert.rejects(writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: selection(), purpose: 'handover' }), { code: 'invalid_package_scope' });
    await assert.rejects(writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: selection(), sourceAccountId: 'other' }), { code: 'invalid_package_scope' });
    await assert.rejects(writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: { ...selection(), notificationPreferences: { version: 3 } } }), { code: 'export_scope_changed' });
    reads = 0; changed = true;
    await assert.rejects(writePersonalHandoverPackage({ ...base, packageId: randomUUID(), selection: selection() }), { code: 'export_scope_changed' });
    changed = false;
    const header = { format: 'yuyoufang-data', version: 3, packageId: randomUUID(), packageVersion: 1, createdAt: at,
      purpose: 'backup', source: { serverId: 'issuer', accountId: 'owner' }, selection: selection() } as HandoverHeader;
    for (const items of [[{ ...value, secret: 'excluded' }], [value, value], [{ ...value, version: value.version + 1 }]]) {
      const pages = [{ section: 'children', items: [] }, { section: 'notification_preferences', items }];
      const archive = await writeHandoverArchive({ directory, header: { ...header, packageId: randomUUID() },
        coverage: () => pages.map(page => ({ section: page.section, childId: null, scopeVersion, items: page.items.length, complete: true })),
        entries: (async function* () {
          for (const page of pages) yield { path: `data/${page.section}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, childId: null, scopeVersion })) };
          yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Backup') };
        })() });
      await assert.rejects(openHandoverImport({ path: archive.path }), { code: 'invalid_package_notification_preferences' });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
