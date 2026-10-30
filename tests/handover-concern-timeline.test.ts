import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreConcernStore, firestoreConcernSchema } from '../server/firestore-concerns.ts';
import { createFirestoreDocumentSources, firestoreDocumentConcernEventSchema, type FirestoreDocumentReport } from '../server/firestore-document-sources.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { newReportAccumulator } from '../server/family-document-report-core.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';

test('concern timeline replacement preserves native revisions and binds current events and document sources', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 93)),
    projectId: 'synthetic-concern-timeline', namespace: 'unit_concern_timeline' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), concerns = createFirestoreConcernStore(options);
  const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat });
  const sources = createFirestoreDocumentSources({ ...options, care, memory });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), otherChild = await admit('other'), opId = randomUUID(), at = new Date().toISOString();
  const values = { title: 'Original concern', reason: 'Original context', observation: 'Native observation', observedAt: at,
    links: { recordId: null, taskId: null, attentionId: null }, followUpAt: null };
  const native = await concerns.create('recipient', childId, values, opId);
  assert.equal(native.version, 1); assert.equal(native.events[0].text, values.observation);
  const sourceReference = (id: string) => ({ kind: 'concern' as const, resourceId: native.id, id: `concern:${native.id}:observation:${id}` });
  const nativeReference = sourceReference(native.events[0].id);
  const before = await authority.runTransaction('recipient', childId, binding => sources.reference(binding, nativeReference));
  assert.ok(before); assert.match(before.text, /Native observation/);
  const timelineId = randomUUID(), eventId = randomUUID();
  function report(timeline?: string): FirestoreDocumentReport {
    const state: FirestoreDocumentReport = newReportAccumulator({ kind: 'growth_report', purpose: 'handoff', title: 'Timeline report', eventDate: null,
      period: { from: at.slice(0, 4) + '-01-01', to: at.slice(0, 4) + '-12-31' } }, 'a'.repeat(64));
    state.stage = 'concerns'; state.concernAfter = { id: native.id, sequence: 0, ...(timeline ? { timelineId: timeline } : {}) };
    state.pendingConcern = { id: native.id, header: null, sawObservation: false }; return state;
  }
  const legacyCursor = report();
  const nativeReport = structuredClone(legacyCursor);
  await authority.runTransaction('recipient', childId, binding => sources.advance(binding, nativeReport));
  assert.deepEqual(nativeReport.selected.map(item => item.source.id), [nativeReference.id]);
  // The import coordinator is not part of this foundation: inject only its proposed authenticated snapshot.
  await authority.runTransaction('recipient', childId, async binding => {
    const previous = await concerns.head(binding, native.id); assert.ok(previous);
    const head = { ...previous, version: 2, timelineId, eventCount: 1, updatedAt: at };
    const event = { ...native.events[0], id: eventId, text: 'Imported timeline observation',
      concernId: native.id, childId, sequence: 1, timelineId };
    const tags = { ...data.tags(binding.scope), concernId: native.id, entityVersion: head.version, createdAt: head.createdAt };
    const headSchema = firestoreConcernSchema.extend({ timelineId: z.uuid().optional() });
    const eventSchema = firestoreDocumentConcernEventSchema.extend({ timelineId: z.uuid().optional() });
    const revisionId = JSON.stringify([native.id, head.version]);
    binding.transaction.set(data.ref('concerns', 'concern', native.id), { ...tags,
      ...data.seal('concern', native.id, binding.scope, headSchema, head, head.version) });
    binding.transaction.create(data.ref('concern_revisions', 'concern-revision', revisionId), { ...tags,
      ...data.seal('concern-revision', revisionId, binding.scope, headSchema, head, head.version) });
    binding.transaction.create(data.ref('concern_events', 'concern-event', eventId), { ...data.tags(binding.scope), timelineId, eventId, sequence: 1,
      ...data.seal('concern-event', eventId, binding.scope, eventSchema, event) });
  });
  const current = await concerns.get('recipient', childId, native.id); assert.ok(current);
  assert.deepEqual(current.events.map(event => event.id), [eventId]); assert.equal(current.events[0].text, 'Imported timeline observation');
  assert.equal('timelineId' in current, false); assert.equal('timelineId' in current.events[0], false);
  const replay = await concerns.create('recipient', childId, values, opId);
  assert.equal(replay.id, native.id); assert.equal(replay.version, native.version);
  assert.deepEqual(replay.events, native.events, 'the original receipt still hydrates every original native event');
  await authority.runTransaction('recipient', childId, async binding => {
    const revision = await concerns.head(binding, native.id, 1); assert.ok(revision);
    assert.equal(revision.timelineId, undefined); assert.equal(revision.eventCount, 1);
    assert.equal(await sources.reference(binding, nativeReference), null, 'old events cannot remain current document sources');
    const replacement = await sources.reference(binding, sourceReference(eventId)); assert.ok(replacement); assert.match(replacement.text, /Imported timeline observation/);
  });
  await assert.rejects(authority.runTransaction('recipient', childId, binding => sources.advance(binding, legacyCursor)), { code: 'document_source_changed' });
  const version = (await concerns.list('recipient', childId)).authorityVersion;
  const appended = await concerns.change('recipient', childId, native.id, { action: 'append', expectedVersion: 2, authorityVersion: version,
    text: 'Normal append after import', observedAt: at, links: values.links }, randomUUID());
  assert.equal(appended.version, 3); assert.deepEqual(appended.events.map(event => event.text), ['Imported timeline observation', 'Normal append after import']);
  const appendedId = appended.events[1].id;
  for (const id of [eventId, appendedId]) {
    const metadata = fixture.records.get(data.ref('concern_events', 'concern-event', id).path);
    assert.equal(metadata.timelineId, timelineId); assert.equal(metadata.concernId, undefined);
  }
  const loaded = await authority.runTransaction('recipient', childId, binding => sources.load(binding));
  const concernSources = loaded.entries.filter(source => source.kind === 'concern');
  assert.equal(concernSources.some(source => source.id === nativeReference.id), false);
  assert.ok(concernSources.some(source => source.id === sourceReference(eventId).id));
  assert.ok(concernSources.some(source => source.id === sourceReference(appendedId).id));
  const currentReport = report(timelineId);
  await authority.runTransaction('recipient', childId, binding => sources.advance(binding, currentReport));
  assert.deepEqual(currentReport.selected.map(item => item.source.id).sort(), [sourceReference(eventId).id, sourceReference(appendedId).id].sort());
  await assert.rejects(concerns.get('other', childId, native.id));
  await assert.rejects(authority.runTransaction('other', otherChild, binding => sources.reference(binding, sourceReference(eventId))));
  const codec = createFirestoreRestoreCodec(options), epoch = randomUUID();
  const records = [...fixture.records].filter(([path]) => /_concerns\/|_concern_revisions\/|_concern_events\//u.test(path));
  assert.equal(records.length, 7);
  for (const [path, metadata] of records) {
    const decoded = codec.decode({ path, data: metadata }); assert.equal(decoded.context.family, 'domain');
    if (decoded.context.family !== 'domain') throw Error('Expected private domain');
    const rotated = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, epoch]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    const checked = codec.decode(rotated); assert.deepEqual(checked.value, decoded.value);
    if (decoded.context.kind === 'concern-event') {
      const event = firestoreDocumentConcernEventSchema.parse(decoded.value);
      assert.equal(rotated.data.timelineId, event.timelineId); assert.equal(rotated.data.concernId, event.timelineId ? undefined : native.id);
    }
  }
});
