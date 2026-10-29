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
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';

test('verified attachment content locators bind photo voice file and avatar bytes without accepting forged or incomplete pairs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-attachment-reader-')), childId = randomUUID(), emptyChild = randomUUID(), unexpectedChild = randomUUID();
  const childIds = [childId, emptyChild, unexpectedChild], scopeVersion = 'a'.repeat(64), at = '2026-10-30T00:00:00Z';
  const selection = { childIds, modules: ['attachments', 'care'] as ('attachments' | 'care')[] };
  const pages = childIds.flatMap(child => [...HANDOVER_SECTIONS.attachments, ...HANDOVER_SECTIONS.care].map(section => ({ section: section as string,
    childId: child as string | null, scopeVersion, items: [] as Record<string, unknown>[] })));
  pages.push({ section: 'children', childId: null, scopeVersion, items: childIds.map(id => ({ id, displayName: 'Synthetic child' })) });
  const rows = (section: string, child = childId) => pages.find(page => page.section === section && page.childId === child)!.items;
  const priorImport = (section: 'files' | 'voices' | 'child_avatar') => ({ current: {
    source: { serverId: 'earlier-source', accountId: 'earlier-parent', childId, section, resourceId: randomUUID(), resourceVersion: 1,
      authorUserId: null, createdAt: at, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: scopeVersion, packageId: randomUUID(), packageVersion: 1, manifestSha256: scopeVersion, integrity: 'trusted', importedBy: 'source', importedAt: at,
  }, previous: [] });
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex'), photoBytes = Buffer.from('photo'), voiceBytes = Buffer.from('voice'), fileBytes = Buffer.from('file'), avatarBytes = Buffer.from('avatar');
  const blobs: { path: string; bytes: Buffer; mimeType: string }[] = [];
  function body(section: string, sourceId: string, version: number, mimeType: string, bytes: Buffer, child = childId, asset?: unknown) {
    const path = `attachments/${blobs.length}.bin`; blobs.push({ path, bytes, mimeType });
    const identity = section === 'child_avatar_content' ? { target: { kind: 'child', childId: child }, version, asset }
      : { [section === 'photo_content' ? 'photoId' : section === 'voice_content' ? 'voiceId' : 'fileId']: sourceId, version };
    rows(section, child).push({ ...identity, attachmentPath: path, mimeType, bytes: bytes.length, sha256: hash(bytes) });
  }
  const photo = (patch: Record<string, unknown> = {}) => ({ id: randomUUID(), childId, version: 2, state: 'ready',
    metadata: { fileName: 'original.png', mimeType: 'image/png', bytes: photoBytes.length, sha256: hash(photoBytes), source: 'Original source' }, ...patch });
  const ready = photo(), reserved = photo({ state: 'reserved' }), missing = photo(), duplicate = photo(), badHash = photo(), badVersion = photo(), badMime = photo(), badBytes = photo(), pendingBody = photo({ state: 'reserved' });
  badHash.metadata = { ...badHash.metadata, sha256: 'f'.repeat(64) }; badBytes.metadata = { ...badBytes.metadata, bytes: photoBytes.length + 1 };
  rows('photos').push(ready, reserved, missing, duplicate, badHash, badVersion, badMime, badBytes, pendingBody, { id: randomUUID(), childId });
  for (const item of [ready, duplicate, duplicate, badHash, badVersion, badMime, badBytes, pendingBody]) body('photo_content', item.id, item === badVersion ? 1 : 2,
    item === badMime ? 'image/jpeg' : 'image/png', photoBytes);
  const voice = { id: randomUUID(), childId, version: 3, createdAt: at, state: 'ready', fileName: 'original.wav', mimeType: 'audio/wav', bytes: voiceBytes.length,
    durationMs: 1000, sha256: hash(voiceBytes), messageId: null, importedFrom: priorImport('voices') };
  const file = { id: randomUUID(), childId, version: 4, createdAt: at, state: 'ready', fileName: 'original.pdf', mimeType: 'application/pdf', bytes: fileBytes.length,
    sha256: hash(fileBytes), messageId: null, importedFrom: priorImport('files') };
  rows('voices').push(voice, { ...voice, id: randomUUID(), state: 'unknown', durationMs: null }); rows('files').push(file, { ...file, id: randomUUID(), state: 'uploading' });
  body('voice_content', voice.id, 3, voice.mimeType, voiceBytes); body('file_content', file.id, 4, file.mimeType, fileBytes);
  const asset = { id: randomUUID(), mimeType: 'image/jpeg', bytes: avatarBytes.length, sha256: hash(avatarBytes), width: 256, height: 256 };
  rows('child_avatar').push({ target: { kind: 'child', childId }, version: 5, asset, updatedAt: at, importedFrom: priorImport('child_avatar') },
    { target: { kind: 'child', childId }, version: 5, asset: { ...asset, width: 128, height: 128 }, updatedAt: at });
  rows('child_avatar', emptyChild).push({ target: { kind: 'child', childId: emptyChild }, version: 0, asset: null, updatedAt: null });
  rows('child_avatar', unexpectedChild).push({ target: { kind: 'child', childId: unexpectedChild }, version: 0, asset: null, updatedAt: null });
  body('child_avatar_content', childId, 5, 'image/jpeg', avatarBytes, childId, asset);
  body('child_avatar_content', unexpectedChild, 0, 'image/jpeg', avatarBytes, unexpectedChild, asset);
  rows('care').push({ id: randomUUID(), childId, text: 'Unselected attachment metadata is not a care failure' });
  pages.sort((left, right) => Number(!left.section.endsWith('_content')) - Number(!right.section.endsWith('_content')));
  async function* entries() { for (const blob of blobs) yield { path: blob.path, mediaType: blob.mimeType, content: blob.bytes };
    for (let index = 0; index < pages.length; index++) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify(pages[index])) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic attachments') }; }
  try {
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1, createdAt: at,
      purpose: 'handover', source: { serverId: 'https://source.invalid', accountId: 'source' }, selection: { ...selection, period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    const reader = await openHandoverImport({ path: archive.path });
    try {
      const acknowledged = reader.manifestSha256;
      assert.equal((await reader.readPage({ selection: { childIds: [childId], modules: ['care'] }, sections: ['care'], acknowledgedManifestSha256: acknowledged })).rows.length, 1);
      const source = (await reader.readPage({ selection, sections: ['photos', 'voices', 'files', 'child_avatar'], acknowledgedManifestSha256: acknowledged })).rows;
      const found = (id: string) => source.find(row => row.value.id === id)!;
      const avatar = source.filter(row => row.section === 'child_avatar' && row.childId === childId);
      await assert.rejects(reader.readAttachmentContent(found(ready.id)), { code: 'package_trust_acknowledgement_required' });
      for (const [row, bytes, id, version] of [[found(ready.id), photoBytes, ready.id, 2], [found(voice.id), voiceBytes, voice.id, 3], [found(file.id), fileBytes, file.id, 4], [avatar[0], avatarBytes, childId, 5]] as const) {
        const content = await reader.readAttachmentContent(row, acknowledged); assert.ok(content); assert.deepEqual(content.content, bytes);
        assert.deepEqual(Object.keys(content).sort(), ['section', 'sourceId', 'sourceVersion', 'attachmentPath', 'mimeType', 'bytes', 'sha256', 'content'].sort());
        assert.equal(content.sourceId, id); assert.equal(content.sourceVersion, version); assert.equal(content.section, row.section); content.content.fill(0);
      }
      for (const row of [found(reserved.id), source.find(row => row.value.state === 'unknown')!, source.find(row => row.value.state === 'uploading')!, source.find(row => row.section === 'child_avatar' && row.childId === emptyChild)!])
        assert.equal(await reader.readAttachmentContent(row, acknowledged), null);
      await assert.rejects(reader.readAttachmentContent(found(missing.id), acknowledged), { code: 'package_attachment_content_missing' });
      await assert.rejects(reader.readAttachmentContent(found(duplicate.id), acknowledged), { code: 'package_attachment_content_duplicate' });
      for (const row of [found(badHash.id), found(badVersion.id), found(badMime.id), found(badBytes.id), avatar[1]])
        await assert.rejects(reader.readAttachmentContent(row, acknowledged), { code: 'package_attachment_content_mismatch' });
      for (const row of [found(pendingBody.id), source.find(row => row.section === 'child_avatar' && row.childId === unexpectedChild)!])
        await assert.rejects(reader.readAttachmentContent(row, acknowledged), { code: 'package_attachment_content_unexpected' });
      const original = found(ready.id);
      for (const changed of [{ ...original, source: { ...original.source, accountId: 'other' } }, { ...original, source: { ...original.source, rowIndex: 1 } },
        { ...original, value: { ...original.value, version: 99 } }]) await assert.rejects(reader.readAttachmentContent(changed, acknowledged), { code: 'invalid_package_scope' });
    } finally { await reader.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('verified document content locators pair reverse pages and reject missing, duplicate or mismatched source rows on demand', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-document-reader-')), childId = randomUUID(), scopeVersion = 'a'.repeat(64);
  const documentId = randomUUID(), snapshotId = randomUUID(), missingId = randomUUID(), duplicateId = randomUUID(), invalidatedId = randomUUID(), staleId = randomUUID();
  const snapshot = { id: snapshotId, version: 1, generatedAt: '2026-10-30T00:00:00Z', sourceBasis: 'b'.repeat(64), title: 'Original document',
    summary: 'Original body', ageLabel: '', period: { from: '2026-10-01', to: '2026-10-31' }, eventDate: null, coverageNote: '', sections: [], sources: [], changes: [] };
  const body = { documentId, snapshotId, snapshotVersion: 1, generatedAt: snapshot.generatedAt, invalidated: false, snapshot };
  const staleContent = { ...body, documentId: staleId, invalidated: true, snapshot: null };
  const { snapshot: _snapshot, ...version } = body;
  const metadata = { format: 'yuyoufang-document:1', id: documentId, childId, version: 1, kind: 'preparation', purpose: 'appointment',
    request: { kind: 'preparation', purpose: 'appointment', title: 'Original request', eventDate: null, period: snapshot.period },
    createdAt: '2026-10-30T00:00:00.000000Z', status: 'active', archivedAt: null, autoRefresh: false, readState: 'ready', invalidated: false,
    currentSnapshot: { id: snapshotId, version: 1, readable: true }, recentSnapshotIds: [] };
  const selection = { childIds: [childId], modules: ['documents', 'care'] as ('documents' | 'care')[] };
  const pages = [
    { section: 'document_content', childId, scopeVersion, items: [body] },
    { section: 'document_content', childId, scopeVersion, items: [{ ...body, documentId: duplicateId }, { ...body, documentId: duplicateId },
      { ...body, documentId: invalidatedId, invalidated: true, snapshot: null }, staleContent] },
    { section: 'document_versions', childId, scopeVersion, items: [version, { ...version, generatedAt: '2026-10-30T01:00:00Z' }] },
    { section: 'visit_preparation_history', childId, scopeVersion, items: [] },
    { section: 'visit_preparation', childId, scopeVersion, items: [] },
    { section: 'documents', childId, scopeVersion, items: [metadata, { ...metadata, id: randomUUID(), currentSnapshot: null, readState: 'stale' },
      { ...metadata, id: missingId }, { ...metadata, id: duplicateId }, { ...metadata, id: invalidatedId }, { id: randomUUID(), childId },
      { ...metadata, id: staleId, readState: 'stale', currentSnapshot: { ...metadata.currentSnapshot, readable: false } }] },
    { section: 'care', childId, scopeVersion, items: [{ id: randomUUID(), childId, text: 'Unrelated care remains readable' }] },
    { section: 'care_history', childId, scopeVersion, items: [] },
    { section: 'children', childId: null, scopeVersion, items: [{ id: childId, displayName: 'Synthetic child' }] },
  ];
  async function* entries() {
    for (let index = 0; index < pages.length; index++) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify(pages[index])) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic documents') };
  }
  try {
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: '2026-10-30T00:00:00Z', purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' }, selection: { ...selection, period: null } },
      entries: entries(), coverage: () => selection.modules.flatMap(module => (module === 'care' ? ['care', 'care_history']
        : ['documents', 'document_versions', 'document_content', 'visit_preparation', 'visit_preparation_history']).map(section => ({ section, childId, scopeVersion,
          items: pages.filter(page => page.section === section).reduce((sum, page) => sum + page.items.length, 0), complete: true as const })))
        .concat([{ section: 'children', childId: null as any, scopeVersion, items: 1, complete: true }]) });
    const reader = await openHandoverImport({ path: archive.path });
    try {
      const acknowledged = reader.manifestSha256;
      const care = await reader.readPage({ selection: { childIds: [childId], modules: ['care'] }, sections: ['care'], acknowledgedManifestSha256: acknowledged });
      assert.equal(care.rows[0].value.text, 'Unrelated care remains readable', 'unselected malformed document metadata cannot block another module');
      const documents = (await reader.readPage({ selection, sections: ['documents'], acknowledgedManifestSha256: acknowledged })).rows;
      const versions = (await reader.readPage({ selection, sections: ['document_versions'], acknowledgedManifestSha256: acknowledged })).rows;
      await assert.rejects(reader.readDocumentContent(documents[0]), { code: 'package_trust_acknowledgement_required' });
      assert.deepEqual(await reader.readDocumentContent(documents[0], acknowledged), body, 'current metadata finds content exported on an earlier page');
      assert.deepEqual(await reader.readDocumentContent(versions[0], acknowledged), body);
      assert.equal(await reader.readDocumentContent(documents[1], acknowledged), null);
      assert.deepEqual(await reader.readDocumentContent(documents[6], acknowledged), staleContent, 'a stale document may retain invalidated=false while its current body is withheld');
      await assert.rejects(reader.readDocumentContent(documents[2], acknowledged), { code: 'package_document_content_missing' });
      await assert.rejects(reader.readDocumentContent(documents[3], acknowledged), { code: 'package_document_content_duplicate' });
      await assert.rejects(reader.readDocumentContent(documents[4], acknowledged), { code: 'package_document_content_mismatch' });
      await assert.rejects(reader.readDocumentContent(versions[1], acknowledged), { code: 'package_document_content_mismatch' });
      await assert.rejects(reader.readDocumentContent(documents[5], acknowledged), { code: 'invalid_package_document_metadata' });
      for (const source of [{ ...documents[0].source, packageId: randomUUID() }, { ...documents[0].source, manifestSha256: 'f'.repeat(64) },
        { ...documents[0].source, rowIndex: 1 }, { ...documents[0].source, path: versions[0].source.path }])
        await assert.rejects(reader.readDocumentContent({ ...documents[0], source }, acknowledged), { code: 'invalid_package_scope' });
      await assert.rejects(reader.readDocumentContent({ ...documents[0], value: { ...documents[0].value, id: missingId } }, acknowledged), { code: 'invalid_package_scope' });
      await assert.rejects(reader.readDocumentContent(care.rows[0], acknowledged), { code: 'invalid_package_scope' });
    } finally { await reader.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('verified import section filters bind cursors while unfiltered reads retain their original order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-filter-')), childId = randomUUID(), scopeVersion = 'a'.repeat(64);
  const selection = { childIds: [childId], modules: ['care', 'profile'] as ('care' | 'profile')[] };
  const row = (id: string, version: number) => ({ id, childId, version });
  const pages = [
    { section: 'children', childId: null, scopeVersion, items: [{ id: childId, displayName: 'Synthetic child' }] },
    { section: 'care_history', childId, scopeVersion, items: [row('care-history-1', 1), row('care-history-2', 2)] },
    { section: 'profile_history', childId, scopeVersion, items: [row('profile-history', 1)] },
    { section: 'care', childId, scopeVersion, items: [row('care-current-1', 3), row('care-current-2', 4)] },
    { section: 'profile', childId, scopeVersion, items: [row('profile-current', 2)] },
  ];
  async function* entries() {
    for (let index = 0; index < pages.length; index++) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify(pages[index])) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic package') };
  }
  try {
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: '2026-10-29T01:00:00Z', purpose: 'handover', source: { serverId: 'https://source.example.test', accountId: 'source' },
      selection: { ...selection, period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, scopeVersion, items: page.items.length, complete: true as const })) });
    const reader = await openHandoverImport({ path: archive.path });
    try {
      const request = { selection, acknowledgedManifestSha256: reader.manifestSha256 };
      const current = await reader.readPage({ ...request, sections: ['care', 'profile'], limit: 1 });
      assert.deepEqual(current.rows.map(item => item.value.id), ['care-current-1']); assert.equal(current.rows[0].source.path, 'data/3.json');
      assert.ok(current.nextCursor);
      const nextCurrent = await reader.readPage({ ...request, sections: ['profile', 'care'], cursor: current.nextCursor, limit: 1 });
      assert.equal(nextCurrent.rows[0].value.id, 'care-current-2'); assert.equal(nextCurrent.rows[0].source.rowIndex, 1);
      const history = await reader.readPage({ ...request, sections: ['care_history', 'profile_history'], limit: 1 });
      assert.equal(history.rows[0].value.id, 'care-history-1'); assert.equal(history.rows[0].source.path, 'data/1.json'); assert.ok(history.nextCursor);
      const nextHistory = await reader.readPage({ ...request, sections: ['profile_history', 'care_history'], cursor: history.nextCursor, limit: 1 });
      assert.equal(nextHistory.rows[0].value.id, 'care-history-2'); assert.equal(nextHistory.rows[0].source.rowIndex, 1);
      await assert.rejects(reader.readPage({ ...request, sections: ['care_history', 'profile_history'], cursor: current.nextCursor }), { code: 'invalid_package_cursor' });
      await assert.rejects(reader.readPage({ ...request, sections: ['care', 'profile'], cursor: history.nextCursor }), { code: 'invalid_package_cursor' });
      const allCurrent = await reader.readPage({ ...request, sections: ['care', 'profile'] });
      assert.deepEqual(allCurrent.rows.map(item => item.value.id), ['care-current-1', 'care-current-2', 'profile-current']); assert.equal(allCurrent.nextCursor, null);
      const allHistory = await reader.readPage({ ...request, sections: ['care_history', 'profile_history'] });
      assert.deepEqual(allHistory.rows.map(item => item.value.id), ['care-history-1', 'care-history-2', 'profile-history']); assert.equal(allHistory.nextCursor, null);
      const original = await reader.readPage({ ...request, limit: 1 }); assert.equal(original.rows[0].section, 'children'); assert.ok(original.nextCursor);
      const originalHash = createHash('sha256').update(JSON.stringify({ childIds: [childId], modules: ['care', 'profile'] })).digest('hex');
      assert.equal(original.nextCursor.selectionHash, originalHash);
      assert.equal((await reader.readPage({ ...request, cursor: original.nextCursor, limit: 1 })).rows[0].value.id, 'care-history-1');
      await assert.rejects(reader.readPage({ ...request, cursor: current.nextCursor }), { code: 'invalid_package_cursor' });
      await assert.rejects(reader.readPage({ ...request, sections: ['care'], cursor: original.nextCursor }), { code: 'invalid_package_cursor' });
      for (const sections of [[], ['care', 'care'], ['children'], ['tasks']]) await assert.rejects(reader.readPage({ ...request, sections }));
      await assert.rejects(reader.readPage({ selection, sections: ['care'] }), { code: 'package_trust_acknowledgement_required' });
      await assert.rejects(reader.readPage({ ...request, sections: ['care'], limit: 101 }), { code: 'invalid_package_limit' });
    } finally { await reader.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
