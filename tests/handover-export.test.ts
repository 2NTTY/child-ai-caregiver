import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
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
import { openHandoverArchive, writeHandoverArchive } from '../server/handover-archive.ts';
import { openHandoverImport, type HandoverImportRow } from '../server/handover-import.ts';
import { avatarDomainFixture, avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';
import { createChatFileObjects } from '../server/firebase-chat-file-objects.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirebasePhotoObjects } from '../server/firebase-photo-objects.ts';
import { createFirestorePhotoStore } from '../server/firestore-photos.ts';
import { makeImportProvenance } from '../server/handover-provenance.ts';
import type { HandoverHeader } from '../src/shared/handover.ts';

test('dated memory ZIP uses content dates, bounded summary evidence and selected revision parents without fetching chat', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-dated-memory-'));
  const childId = randomUUID(), scopeVersion = 'e'.repeat(64);
  const period = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' };
  const before = '2026-10-31T23:59:59.999+08:00', after = '2026-11-08T00:00:00+08:00';
  const instruction = (updatedAt: string, text: string) => ({ id: randomUUID(), childId, version: 1, title: 'Instruction', text,
    sourceMessageId: randomUUID(), provenance: 'user_statement', createdAt: before, updatedAt });
  const fact = (createdAt: string, content: string, contentUpdatedAt?: string) => ({ id: randomUUID(), childId, version: 2,
    key: content, content, source: { kind: 'manual', description: 'Original statement' }, validUntil: null,
    visibility: 'private', intendedVisibility: 'private', status: 'confirmed', createdBy: 'source-parent', confirmedBy: 'source-parent',
    confirmedAt: after, reason: '', applicable: true, sourceState: 'current', createdAt,
    ...(contentUpdatedAt ? { contentUpdatedAt } : {}) });
  const topic = (updatedAt: string, note: string) => ({ id: randomUUID(), childId, version: 2, visibility: 'private',
    title: 'Topic', note, status: 'pending', updatedBy: 'source-parent', updatedAt, resumeAfter: null,
    reopenReason: null, reopenedFrom: null, mayAsk: true });
  const summary = (createdAt: string, text: string, sourcePeriod?: { from: string; to: string }) => {
    const messageId = randomUUID();
    return { id: randomUUID(), childId, version: 1, text, createdAt, previousId: null,
      coveredMessageIds: [messageId], lastCoveredMessageId: messageId, ...(sourcePeriod ? { sourcePeriod } : {}) };
  };
  const selectedInstruction = instruction(period.from, 'Selected instruction');
  const selectedFact = fact(before, 'Edited within period', period.from), legacyFact = { ...fact(period.to, 'Legacy native v1'), version: 1 };
  const excludedFact = fact(period.from, 'SECRET_OLD_CONTENT_RECENT_CREATION', before);
  const selectedFactRevision = { ...selectedFact, version: 1, contentUpdatedAt: period.to };
  const selectedTopic = topic(period.to, 'Selected topic'), excludedTopic = topic(before, 'SECRET_OLD_TOPIC');
  const selectedTopicRevision = { ...selectedTopic, version: 1, updatedAt: period.from };
  const selectedSummary = summary(after, 'Summary of the selected conversation period', period);
  const rows: Record<string, unknown[]> = {
    instructions: [selectedInstruction, instruction(before, 'SECRET_OLD_INSTRUCTION')],
    memory_facts: [selectedFact, legacyFact, excludedFact, fact(after, 'SECRET_LATER_FACT', after)],
    memory_fact_history: [selectedFactRevision, { ...selectedFact, version: 1, contentUpdatedAt: before },
      { ...excludedFact, version: 1, contentUpdatedAt: period.to, content: 'SECRET_ORPHAN_FACT_REVISION' }],
    memory_topics: [selectedTopic, excludedTopic],
    memory_topic_history: [selectedTopicRevision, { ...selectedTopic, version: 1, updatedAt: after },
      { ...excludedTopic, version: 1, updatedAt: period.from, note: 'SECRET_ORPHAN_TOPIC_REVISION' }],
    summary_history: [selectedSummary, summary(period.from, 'SECRET_CROSSING_BEFORE', { from: before, to: period.to }),
      summary(period.to, 'SECRET_CROSSING_AFTER', { from: period.from, to: after }),
      summary(period.from, 'SECRET_LEGACY_WITHOUT_PERIOD')],
    chat: [{ id: randomUUID(), childId, createdAt: period.from, text: 'SECRET_UNREQUESTED_CHAT_BODY' }],
  };
  const expected: Record<string, unknown[]> = { instructions: [selectedInstruction], memory_facts: [selectedFact, legacyFact],
    memory_fact_history: [selectedFactRevision], memory_topics: [selectedTopic], memory_topic_history: [selectedTopicRevision],
    summary_history: [selectedSummary] };
  const queried: string[] = [];
  const exporter = { async page(_owner: string, query: { section: string }) {
    queried.push(query.section);
    return { section: query.section, scopeVersion, complete: true, nextCursor: null, notices: [],
      items: query.section === 'children' ? [{ id: childId, displayName: 'Child' }] : rows[query.section] ?? [] };
  } };
  const selection = { childIds: [childId], modules: ['memory'] as HandoverHeader['selection']['modules'] };
  const input = { directory, exporter, ownerUserId: 'owner', serverId: 'https://example.test', createdAt: after, purpose: 'handover' as const };
  try {
    const dated = await writePersonalHandoverPackage({ ...input, packageId: randomUUID(), selection: { ...selection, period } });
    const opened = await openHandoverImport({ path: dated.path });
    try {
      assert.deepEqual(opened.manifest.selection.period, period);
      assert.deepEqual(opened.children, [{ id: childId, displayName: 'Child' }]);
      assert.deepEqual(Object.fromEntries(opened.manifest.coverage.map(row => [row.section, row.items])),
        { children: 1, ...Object.fromEntries(Object.entries(expected).map(([section, items]) => [section, items.length])) });
      const page = await opened.readPage({ selection, acknowledgedManifestSha256: opened.manifestSha256, limit: 100 });
      assert.equal(page.nextCursor, null);
      for (const [section, values] of Object.entries(expected)) {
        const actual: HandoverImportRow[] = page.rows.filter(row => row.section === section);
        assert.deepEqual(actual.map(row => row.value), values, section);
        assert.ok(actual.every(row => row.childId === childId && row.source.manifestSha256 === opened.manifestSha256
          && row.source.accountId === 'owner'), `${section} preserves its package receipt`);
      }
      assert.ok(!JSON.stringify(page.rows).includes('SECRET_'));
    } finally { await opened.close(); }

    const full = await writePersonalHandoverPackage({ ...input, packageId: randomUUID(), selection: { ...selection, period: null } });
    const fullReader = await openHandoverImport({ path: full.path });
    try {
      assert.equal(fullReader.manifest.selection.period, null);
      const page = await fullReader.readPage({ selection, acknowledgedManifestSha256: fullReader.manifestSha256, limit: 100 });
      for (const section of Object.keys(expected)) assert.deepEqual(page.rows.filter(row => row.section === section).map(row => row.value), rows[section], section);
    } finally { await fullReader.close(); }
    assert.deepEqual([...new Set(queried)].sort(), ['manifest', 'children', ...Object.keys(expected)].sort());

    const source = await openHandoverArchive({ path: dated.path });
    try {
      const { entries: declaredEntries, coverage, ...header } = source.manifest;
      async function* entries() {
        for (const entry of declaredEntries) {
          let content = await source.readEntry(entry.path, entry.bytes);
          if (entry.path.startsWith('data/')) {
            const page = JSON.parse(content.toString('utf8'));
            if (page.section === 'summary_history') {
              page.items[0].sourcePeriod = { from: period.from, to: after };
              content = Buffer.from(JSON.stringify(page));
            }
          }
          yield { path: entry.path, mediaType: entry.mediaType, content };
        }
      }
      const forged = await writeHandoverArchive({ directory, header, entries: entries(), coverage: () => coverage });
      await assert.rejects(openHandoverImport({ path: forged.path }), (error: any) => error.code === 'invalid_package_period');
    } finally { await source.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dated profile, source and growth exports retain domain dates and only selected parents through ZIP preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-dated-domains-'));
  const childId = randomUUID(), otherChild = randomUUID(), sourceId = randomUUID(), excludedSource = randomUUID();
  const attentionId = randomUUID(), excludedAttention = randomUUID(), scopeVersion = 'd'.repeat(64);
  const period = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' };
  const before = '2026-10-31T23:59:59.999+08:00', after = '2026-11-08T00:00:00+08:00';
  const profile = (child: string, confirmedAt: string, version: number, reason: string) =>
    ({ childId: child, version, data: { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
      region: 'HK', language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Profile fixture', validUntil: null },
      confirmedBy: 'source-parent', confirmedAt, reason });
  function retainedProfile(confirmedAt: string, importedAt: string, reason: string) {
    const value = profile(childId, confirmedAt, 1, reason);
    return { format: 'yuyoufang-source-revision:1', childId, resource: { id: childId, version: 1 },
      evidence: { module: 'profile', value, source: makeImportProvenance({ section: 'profile', childId, value,
        source: { serverId: 'https://original.test', accountId: 'original', packageId: randomUUID(), packageVersion: 1,
          manifestSha256: 'b'.repeat(64), path: 'data/original-profile.json', rowIndex: 0 } }, 'missing_proof', 'importer', importedAt) } };
  }
  const selectedWrapper = retainedProfile(period.from, after, 'Retained original confirmation');
  const excludedWrapper = retainedProfile(before, period.from, 'SECRET_OLD_EVIDENCE_RECENT_IMPORT');
  const source = (id: string, createdAt: string, sourceDateText: string) => ({ id, childId, version: 3, createdAt, sourceDateText });
  const sourceHistory = (inputId: string, changedAt: string, reason: string) => ({ inputId, childId, version: 2, changedAt, reason });
  const attention = (id: string, updatedAt: string, note: string) => ({ item: { id, childId, version: 3, createdAt: before, updatedAt, note } });
  const topic = (topicId: string, at: string, version = 3) => ({ topicId, version, at, disabled: false, actor: 'source-parent', request: null });
  const selectedProfile = profile(childId, period.from, 3, 'Selected profile');
  const nativeProfileHistory = profile(childId, period.to, 2, 'Selected native confirmation');
  const selectedSource = source(sourceId, period.from, 'Published 1999-01-01; this text is not the intake date');
  const selectedSourceHistory = sourceHistory(sourceId, period.to, 'Selected source management');
  const selectedAttention = attention(attentionId, period.to, 'Selected attention');
  const selectedGrowthHistory = attention(attentionId, period.from, 'Selected attention history');
  const selectedTopic = topic('solid_food', period.from), selectedTopicHistory = topic('solid_food', period.to, 2);
  const rows: Record<string, Record<string, unknown[]>> = {
    [childId]: {
      profile: [selectedProfile], profile_history: [nativeProfileHistory, selectedWrapper, excludedWrapper],
      private_sources: [selectedSource, source(excludedSource, before, '2026-11-01')],
      private_source_history: [selectedSourceHistory, sourceHistory(sourceId, after, 'SECRET_LATER_SOURCE_HISTORY'),
        sourceHistory(excludedSource, period.from, 'SECRET_ORPHAN_SOURCE_HISTORY')],
      growth_attention: [selectedAttention, attention(excludedAttention, before, 'SECRET_OLD_ATTENTION')],
      growth_history: [selectedGrowthHistory, attention(attentionId, after, 'SECRET_LATER_ATTENTION_HISTORY'),
        attention(excludedAttention, period.from, 'SECRET_ORPHAN_ATTENTION_HISTORY')],
      growth_topics: [selectedTopic, topic('toddler_play', before)],
      growth_topic_history: [selectedTopicHistory, topic('solid_food', after, 1), topic('toddler_play', period.to, 2)],
    },
    [otherChild]: { profile: [profile(otherChild, before, 3, 'SECRET_OLD_PROFILE')],
      profile_history: [profile(otherChild, period.to, 2, 'SECRET_ORPHAN_PROFILE_HISTORY')],
      growth_topics: [topic('solid_food', before)], growth_topic_history: [topic('solid_food', period.to, 2)] },
  };
  const expected: Record<string, unknown[]> = { profile: [selectedProfile], profile_history: [nativeProfileHistory, selectedWrapper],
    private_sources: [selectedSource], private_source_history: [selectedSourceHistory], growth_attention: [selectedAttention],
    growth_history: [selectedGrowthHistory], growth_topics: [selectedTopic], growth_topic_history: [selectedTopicHistory] };
  const modules: HandoverHeader['selection']['modules'] = ['profile', 'sources', 'growth'];
  const exporter = { async page(_owner: string, query: { section: string; childId?: string }) {
    return { section: query.section, scopeVersion, complete: true, nextCursor: null, notices: [],
      items: query.section === 'children' ? [{ id: childId, displayName: 'Selected' }, { id: otherChild, displayName: 'Outside current' }]
        : query.childId ? rows[query.childId]?.[query.section] ?? [] : [] };
  } };
  try {
    const archive = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'owner', serverId: 'https://example.test',
      packageId: randomUUID(), createdAt: after, purpose: 'handover', selection: { childIds: [childId, otherChild], modules, period } });
    const opened = await openHandoverImport({ path: archive.path });
    try {
      assert.deepEqual(opened.manifest.selection.period, period);
      const page = await opened.readPage({ selection: { childIds: [childId, otherChild], modules },
        acknowledgedManifestSha256: opened.manifestSha256, limit: 100 });
      assert.equal(page.nextCursor, null);
      for (const [section, values] of Object.entries(expected)) {
        assert.deepEqual(page.rows.filter(row => row.section === section && row.childId === childId).map(row => row.value), values, section);
        assert.equal(page.rows.filter(row => row.section === section && row.childId === otherChild).length, 0, `${section} cannot import an unselected parent's history`);
      }
      assert.ok(!JSON.stringify(page.rows).includes('SECRET_'));
    } finally { await opened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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

test('a dated attachment package reads only selected file bytes and omits out-of-period or absent avatars', async () => {
  const f = await avatarDomainFixture(), directory = await mkdtemp(join(tmpdir(), 'handover-attachment-period-'));
  try {
    async function child(displayName: string) {
      return (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName })).child.id;
    }
    const childId = await child('Selected file and older avatar'), earlierChild = await child('Earlier file without avatar'), laterChild = await child('Later file without avatar');
    const target = { kind: 'child' as const, childId };
    const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(0, target))).result);
    await f.upload(reserved.upload.id, target);
    await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.upload.id, expectedVersion: 0 }, target));
    const bucket = avatarMemoryBucket('synthetic-dated-files');
    const objects = createChatFileObjects({ config: { projectId: f.options.projectId, namespace: f.options.namespace, bucketName: 'synthetic-dated-files' },
      cipher: f.options.cipher, bucket: bucket.port });
    const files = createFirestoreChatFilesStore({ ...f.options, objects, journal: f.journal });
    async function file(selectedChild: string, name: string, bytes: Buffer) {
      const id = randomUUID(), metadata = { opId: id, fileName: name, mimeType: 'text/plain', bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') };
      const reservation = await files.reserve(f.owner, selectedChild, metadata);
      return files.upload(f.owner, selectedChild, id, reservation.version, bytes.toString('base64'), new AbortController().signal);
    }
    const earlier = await file(earlierChild, 'SECRET_EARLIER_FILE.txt', Buffer.from('SECRET_EARLIER_BYTES'));
    f.advance(2 * 86400000);
    const bytes = Buffer.from('Selected original file bytes\n育有方\n\u0000\u00ff', 'utf8');
    const selected = await file(childId, 'Selected original.txt', bytes);
    const photos = createFirestorePhotoStore({ ...f.options, journal: f.journal, objects: createFirebasePhotoObjects({
      config: { projectId: f.options.projectId, namespace: f.options.namespace, bucketName: 'synthetic-dated-files' },
      cipher: f.options.cipher, bucket: bucket.port }) });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kv1sAAAAASUVORK5CYII=', 'base64');
    const photo = await photos.reserve(f.owner, childId, randomUUID(), { fileName: 'selected.png', source: 'fixture', mimeType: 'image/png',
      bytes: image.length, sha256: createHash('sha256').update(image).digest('hex') });
    await photos.upload(f.owner, childId, photo.id, image.toString('base64'));
    const period = { from: selected.createdAt, to: new Date(Date.parse(selected.createdAt) + 500).toISOString() };
    f.advance(1000);
    const later = await file(laterChild, 'SECRET_LATER_FILE.txt', Buffer.from('SECRET_LATER_BYTES'));
    const fileReads: string[] = []; let avatarReads = 0;
    const exporter = createFirestoreAccountExport({ ...f.options, photos,
      files: { readMetadata: files.readMetadata, async content(...args: Parameters<typeof files.content>) {
        fileReads.push(args[2]); return files.content(...args);
      } }, avatars: { async content(...args: Parameters<typeof f.avatars.content>) {
        avatarReads++; return f.avatars.content(...args);
      } } });
    const written = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: f.owner, serverId: 'https://example.test',
      packageId: randomUUID(), createdAt: new Date(f.now()).toISOString(), purpose: 'handover',
      selection: { childIds: [childId, earlierChild, laterChild], modules: ['attachments'], period } });
    assert.deepEqual(fileReads, [selected.id], 'out-of-period originals must be filtered before storage content callbacks');
    assert.equal(avatarReads, 0, 'an older avatar cannot trigger a storage content read');
    const archive = await openHandoverArchive({ path: written.path });
    try {
      const pages: { section: string; childId: string | null; items: any[] }[] = [];
      for (const entry of archive.manifest.entries.filter(entry => entry.path.startsWith('data/'))) {
        pages.push(JSON.parse((await archive.readEntry(entry.path, 4 * 1024 * 1024)).toString('utf8')));
      }
      const rows = (section: string) => pages.filter(page => page.section === section).flatMap(page => page.items);
      assert.deepEqual(rows('files').map(row => row.id), [selected.id]);
      assert.deepEqual(rows('file_content').map(row => row.fileId), [selected.id]);
      assert.deepEqual(rows('child_avatar'), [], 'neither an old avatar nor absence is a removal selected by this period');
      assert.deepEqual(rows('child_avatar_content'), []);
      const json = JSON.stringify(pages);
      for (const excluded of [earlier.id, later.id, 'SECRET_EARLIER', 'SECRET_LATER']) assert.ok(!json.includes(excluded), `Out-of-period index leaked: ${excluded}`);
      const attachments = archive.manifest.entries.filter(entry => entry.path.startsWith('attachments/'));
      assert.equal(attachments.length, 2);
      assert.deepEqual(await archive.readEntry(rows('file_content')[0].attachmentPath, 1024), bytes);
      assert.deepEqual(await archive.readEntry(rows('photo_content')[0].attachmentPath, 1024), image);
    } finally { await archive.close(); }
    const preview = await openHandoverImport({ path: written.path });
    try {
      assert.deepEqual(preview.manifest.selection.period, period);
      assert.equal(preview.manifest.coverage.filter(row => row.section === 'files').reduce((total, row) => total + row.items, 0), 1);
      assert.equal(preview.manifest.coverage.filter(row => row.section === 'child_avatar' || row.section === 'child_avatar_content').reduce((total, row) => total + row.items, 0), 0);
      const page = await preview.readPage({ selection: { childIds: [childId, earlierChild, laterChild], modules: ['attachments'] },
        acknowledgedManifestSha256: preview.manifestSha256, limit: 100 });
      assert.equal(page.nextCursor, null);
      assert.deepEqual(page.rows.filter(row => row.section === 'files').map(row => row.value.id), [selected.id]);
      assert.equal(page.rows.some(row => row.section === 'child_avatar'), false);
      const copied = await preview.readAttachmentContent(page.rows.find(row => row.section === 'files')!, preview.manifestSha256);
      assert.ok(copied); assert.deepEqual(copied.content, bytes, 'the imported file keeps its original bytes');
      const datedPhoto = page.rows.find(row => row.section === 'photos')!;
      const full = await exporter.page(f.owner, { section: 'photos', childId });
      assert.equal(datedPhoto.value.createdAt, period.from);
      const original = full.items[0] as typeof datedPhoto.value;
      assert.equal(Object.hasOwn(original, 'createdAt'), false);
      const source = (value: typeof original) => makeImportProvenance({ ...datedPhoto, value }, preview.integrity, f.owner, period.from).current;
      assert.equal(source(datedPhoto.value).sourceHash, source(original).sourceHash);
    } finally { await preview.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('account avatar backup writer pins normalized self images without reading a child roster',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'handover-account-avatar-writer-'));
  const bytes=Buffer.from([255,216,255,217]),scopeVersion='f'.repeat(64),childId=randomUUID();
  const asset={id:randomUUID(),mimeType:'image/jpeg',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:384,height:384};
  const at='2026-11-05T00:00:00Z',period={from:'2026-11-01T00:00:00Z',to:'2026-11-02T23:59:59Z'};
  let head={target:{kind:'self' as const},version:7,asset:asset as typeof asset|null,updatedAt:at as string|null},finalChanged=false,badContent=false,missingContent=false,headReads=0;
  const queries:string[]=[];
  const exporter={async page(_owner:string,query:{section:string;childId?:string}) {
    queries.push(query.section);assert.equal(query.childId,query.section === 'care' || query.section === 'care_history' ? childId : undefined);
    let items:unknown[]=[];
    if(query.section==='self_avatar'){headReads++;items=[finalChanged&&headReads>1?{...head,version:head.version+1}:head];}
    if(query.section==='self_avatar_content')items=head.asset&&!missingContent?[{target:head.target,version:badContent?head.version+1:head.version,asset:head.asset,base64:bytes.toString('base64'),mimeType:'image/jpeg'}]:[];
    if(query.section==='children')items=[{id:childId,displayName:'Existing child'}];
    return {section:query.section,scopeVersion,complete:true,nextCursor:null,notices:[],items};
  }};
  const input={directory,exporter,ownerUserId:'owner',serverId:'https://example.test',createdAt:at,purpose:'backup' as const};
  const selection={childIds:[],modules:[],period,accountAvatar:{version:7}};
  async function inspect(empty=false){
    headReads=0;queries.length=0;
    const written=await writePersonalHandoverPackage({...input,packageId:randomUUID(),selection:{...selection,accountAvatar:{version:head.version}}});
    const archive=await openHandoverArchive({path:written.path});
    try{
      assert.equal(archive.manifest.version,2);assert.equal(queries.includes('children'),false);
      const pages=[];for(const entry of archive.manifest.entries.filter(entry=>entry.path.startsWith('data/')))
        pages.push(JSON.parse((await archive.readEntry(entry.path,entry.bytes)).toString('utf8')));
      const metadata=pages.find(page=>page.section==='self_avatar'),content=pages.find(page=>page.section==='self_avatar_content');
      assert.equal(metadata.childId,null);assert.equal(content.childId,null);assert.deepEqual(metadata.items,[head]);
      assert.equal(archive.manifest.coverage.find(row=>row.section==='self_avatar')?.items,1);
      assert.equal(archive.manifest.coverage.find(row=>row.section==='self_avatar_content')?.items,empty?0:1);
      if(!empty){const pointer=content.items[0];assert.deepEqual(pointer.target,{kind:'self'});assert.equal(pointer.version,7);assert.deepEqual(pointer.asset,asset);
        assert.equal(pointer.bytes,bytes.length);assert.equal(pointer.sha256,asset.sha256);assert.deepEqual(await archive.readEntry(pointer.attachmentPath,bytes.length),bytes);}
      else {assert.deepEqual(content.items,[]);assert.equal(archive.manifest.entries.some(entry=>entry.path.startsWith('attachments/')),false);}
      const summaryEntry=archive.manifest.entries.find(entry=>entry.path==='summary.md')!;
      const summary=(await archive.readEntry(summaryEntry.path,summaryEntry.bytes)).toString('utf8');
      assert.ok(summary.includes('本人頭像'));assert.ok(summary.includes(head.updatedAt??'日期未知'));assert.ok(summary.includes(empty?'不是移除指令':'期間外'));
      assert.ok(summary.includes('| self_avatar | 本人帳戶 | 1 |'));assert.equal(summary.includes('| self_avatar | 名冊 |'),false);
      if(!head.updatedAt)assert.equal(summary.includes('所選期間內'),false);
    }finally{await archive.close();}
  }
  try{
    await inspect();
    head={...head,version:8,asset:null};await inspect(true);
    head={...head,version:0,updatedAt:null};await inspect(true);
    head={...head,version:7,asset,updatedAt:at};
    await assert.rejects(writePersonalHandoverPackage({...input,packageId:randomUUID(),selection,purpose:'handover'}),{code:'invalid_package_scope'});
    await assert.rejects(writePersonalHandoverPackage({...input,packageId:randomUUID(),selection,sourceAccountId:'other'}),{code:'invalid_package_scope'});
    headReads=0;badContent=true;await assert.rejects(writePersonalHandoverPackage({...input,packageId:randomUUID(),selection}),{code:'export_scope_changed'});badContent=false;
    headReads=0;missingContent=true;await assert.rejects(writePersonalHandoverPackage({...input,packageId:randomUUID(),selection}),{code:'export_scope_changed'});missingContent=false;
    headReads=0;finalChanged=true;await assert.rejects(writePersonalHandoverPackage({...input,packageId:randomUUID(),selection}),{code:'export_scope_changed'});finalChanged=false;
    queries.length=0;await writePersonalHandoverPackage({...input,packageId:randomUUID(),selection:{childIds:[childId],modules:['care'],period:null}});
    assert.equal(queries.includes('self_avatar'),false);assert.equal(queries.includes('self_avatar_content'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
