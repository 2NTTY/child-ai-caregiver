import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore, firestoreGrowthSchema, firestoreGrowthTopicSchema, growthTopicResourceId } from '../server/firestore-growth.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import { growthProposals } from '../server/growth-rules.ts';
import type { FirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import type { KnowledgeSourceInput } from '../src/shared/knowledge.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

test('growth import preserves source outcomes and topic suppression without replaying old decisions', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-30T00:00:00Z') });
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 96)),
    projectId: 'synthetic-growth-import', namespace: 'unit_growth_import' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'recipient@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'recipient', email: 'recipient@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Recipient' })).child.id;
  const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
  const at = new Date().toISOString(), sourceChild = randomUUID(), sourceId = randomUUID(), foreignTask = randomUUID(), foreignFact = randomUUID();
  const row: HandoverImportRow = { section: 'growth_attention', childId: sourceChild,
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/growth.json', rowIndex: 0 },
    value: { item: { id: sourceId, childId: sourceChild, topicId: 'solid_food', version: 3, state: 'accepted', title: 'Original growth title', kind: 'arrange',
      whyNow: 'Original reason', advice: 'Original source advice', limits: 'Original limits', basis: { stage: 'infant-solids', ruleRevision: 'source-rule', sourceHash: 'b'.repeat(64), values: {} },
      evidence: { profileVersion: 8, facts: [{ id: foreignFact, version: 2 }] }, source: { sourceId: 'source-manual', versionId: randomUUID(), chunkId: randomUUID(),
        contentHash: 'b'.repeat(64), url: 'https://example.test/source', title: 'Original source', section: 'one', checkedAt: at, excerpt: 'Original text' },
      sourceAvailable: true, createdAt: at, updatedAt: at, snoozeUntil: null, previousId: randomUUID(), newReason: 'Original new reason',
      taskId: foreignTask, taskState: 'completed', lastAction: 'accept', actorUserId: 'source-author', note: 'Original result' },
      lastRequest: { authorityVersion: 'foreign-authority', expectedVersion: 2, confirm: true, action: 'accept', task: { kind: 'existing', id: foreignTask, expectedVersion: 9 } } } };
  const save = (input: HandoverImportRow, expected?: { id: string; expectedVersion: number }) => authority.runTransaction('recipient', childId, async b => {
    const prepared = await growth.prepareImportedAttention(b, randomUUID(), input, 'trusted', expected); prepared.commit(); return prepared.value;
  });
  const first = await save(row);
  assert.notEqual(first.item.id, sourceId); assert.equal(first.item.childId, childId); assert.equal(first.item.state, 'accepted');
  assert.equal(first.lastRequest, null); assert.equal(first.item.taskId, null); assert.equal(first.item.previousId, null); assert.equal(first.item.actorUserId, 'source-author');
  assert.deepEqual(first.item.evidence, { profileVersion: 0, facts: [] }); assert.equal(first.importedFrom!.current.source.resourceId, sourceId);
  assert.equal(first.importedFrom!.current.source.growth!.taskId, foreignTask); assert.equal(first.importedFrom!.current.source.growth!.evidence.facts[0].id, foreignFact);
  const view = await growth.list('recipient', childId);
  assert.equal(view.items[0].sourceAvailable, false); assert.equal(view.items[0].note, 'Original result'); assert.equal('importedFrom' in view.items[0], false);
  assert.equal([...fixture.records].filter(([key]) => key.includes('_tasks/')).length, 0, 'old accept request must not create a task');
  await assert.rejects(save(row, { id: first.item.id, expectedVersion: 99 }), (e: any) => e.code === 'growth_changed');
  const updated = structuredClone(row); (updated.value.item as any).version = 4; (updated.value.item as any).note = 'Source correction';
  const second = await save(updated, { id: first.item.id, expectedVersion: 1 });
  assert.equal(second.item.id, first.item.id); assert.equal(second.item.version, 2);
  await care.saveProfile('recipient', childId, { age: { kind: 'birth_date', date: '2026-03-30' }, dueDate: null, gestationalWeeksRaw: null,
    region: 'HK', language: 'zh-HK', allergies: null, specialNeeds: null, preferences: null, source: 'Synthetic profile', validUntil: null }, 0, 'Initial profile');
  // Original pinned rule evidence for adapter contracts only, not approval of current public knowledge.
  const raw = JSON.parse(readFileSync(new URL('./fixtures/growth-reviewed-chunks-20260924.json', import.meta.url), 'utf8'));
  const sources = ((raw.sources ?? raw) as KnowledgeSourceInput[]).flatMap(source => source.chunks.map(chunk => ({ ...source, ...chunk,
    chunkId: randomUUID(), versionId: randomUUID(), versionHash: 'synthetic', contentHash: createHash('sha256').update(JSON.stringify(chunk)).digest('hex'),
    checkedAt: at, reviewState: 'reviewed' as const })));
  const connected = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options),
    knowledge: { ruleCandidates: async () => sources } as unknown as FirestoreKnowledgeStore });
  const profile = await authority.runTransaction('recipient', childId, b => care.readProfile(b));
  const proposal = growthProposals({ profile, profileApplicable: true, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [],
    unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }, sources, new Date()).proposals[0];
  assert.ok(proposal);
  const activeRow: HandoverImportRow = { ...row, value: { item: { ...(row.value.item as object), ...proposal, id: randomUUID(), childId: sourceChild,
    version: 1, state: 'proposed', taskId: null, taskState: null }, lastRequest: null } };
  const saveActive = (input: HandoverImportRow, expected?: { id: string; expectedVersion: number }) => authority.runTransaction('recipient', childId, async b => {
    const prepared = await connected.prepareImportedAttention(b, randomUUID(), input, 'trusted', expected); prepared.commit(); return prepared.value;
  });
  const active = await saveActive(activeRow); assert.equal(active.item.state, 'proposed'); assert.equal(active.item.sourceAvailable, true);
  assert.equal(active.item.evidence.profileVersion, profile.version);
  sources.forEach(source => { source.versionId = randomUUID(); });
  const currentSource = (await connected.list('recipient', childId)).items.find(item => item.id === active.item.id)!;
  assert.equal(currentSource.source.versionId, sources.find(source => source.sourceId === proposal.source.sourceId)!.versionId);
  const job = [...fixture.records].filter(([path]) => path.includes('_background_work/')).map(([path, data]) => codec.decode({ path, data }).value)
    .map(value => firestoreBackgroundWorkSchema.parse(value)).find(value => value.kind === 'growth' && value.resourceId === active.item.id)!;
  assert.ok(await connected.backgroundInput(job));
  const forged = structuredClone(activeRow); (forged.value.item as any).advice = 'Unsupported claim with the same hash';
  const rejectedAdvice = await saveActive(forged, { id: active.item.id, expectedVersion: active.item.version });
  assert.equal(rejectedAdvice.item.state, 'inapplicable'); assert.equal(rejectedAdvice.item.sourceAvailable, false);
  assert.equal(await connected.backgroundInput(job), null, 'old work must recheck the current content');
  const goodAgain = structuredClone(activeRow); (goodAgain.value.item as any).id = randomUUID();
  const live = await saveActive(goodAgain); assert.equal(live.item.state, 'proposed');
  const topic: HandoverImportRow = { ...row, section: 'growth_topics', value: { topicId: 'solid_food', version: 4, disabled: true, actor: 'source-author', at,
    request: { authorityVersion: 'foreign-authority', expectedVersion: 3, confirm: true, action: 'set_enabled', enabled: false } } };
  await authority.runTransaction('recipient', childId, async b => {
    const prepared = await growth.prepareImportedTopic(b, randomUUID(), topic, 'trusted'); prepared.commit();
  });
  const after = await growth.list('recipient', childId); assert.equal(after.topics.find(t => t.id === 'solid_food')!.disabled, true);
  assert.equal((await connected.list('recipient', childId)).items.find(item => item.id === live.item.id)!.state, 'dismissed');
  const enabling = structuredClone(topic); enabling.value.disabled = false;
  await assert.rejects(authority.runTransaction('recipient', childId, b => connected.prepareImportedTopic(b, randomUUID(), enabling, 'trusted')),
    (e: any) => e.code === 'growth_changed', 'an existing suppression cannot be silently overwritten');
  const activeSource = structuredClone(row); (activeSource.value.item as any).id = randomUUID(); (activeSource.value.item as any).state = 'proposed';
  const suppressed = await save(activeSource); assert.equal(suppressed.item.state, 'inapplicable');
  await authority.runTransaction('recipient', childId, async b => {
    const oldId = JSON.stringify([first.item.id, 1]), snap = await b.transaction.get(data.ref('growth_revisions', 'growth-revision', oldId));
    assert.equal(data.open('growth-revision', oldId, b.scope, firestoreGrowthSchema, snap).item.note, 'Original result');
    const topicId = JSON.stringify([childId, 'solid_food']), topicSnap = await b.transaction.get(data.ref('growth_topics', 'growth-topic', topicId));
    const savedTopic = data.open('growth-topic', topicId, b.scope, firestoreGrowthTopicSchema, topicSnap);
    assert.equal(savedTopic.actor, 'source-author'); assert.equal(savedTopic.request, null); assert.equal(savedTopic.importedFrom!.current.importedBy, 'recipient');
    assert.deepEqual(await connected.readImportTopic(b, 'solid_food'), savedTopic);
    assert.equal((await connected.readImportAttention(b, first.item.id))!.item.version, 2);
  });
  assert.notEqual(growthTopicResourceId(childId, 'solid_food'), growthTopicResourceId(childId, 'school_vision'));
  assert.notEqual(growthTopicResourceId(childId, 'solid_food'), growthTopicResourceId(sourceChild, 'solid_food'));
  const enabled = await connected.topic('recipient', childId, 'solid_food', { authorityVersion: after.authorityVersion,
    expectedVersion: after.topics.find(t => t.id === 'solid_food')!.version, confirm: true, action: 'set_enabled', enabled: true });
  assert.equal(enabled.topics.find(t => t.id === 'solid_food')!.disabled, false, 'normal explicit topic changes still work');
  await authority.runTransaction('recipient', childId, async b => {
    const local = await connected.readImportTopic(b, 'solid_food'); assert.ok(local?.request);
    assert.equal(local.actor, 'recipient'); assert.equal(local.importedFrom!.current.source.authorUserId, 'source-author');
  });
  for (const [path, record] of fixture.records) if (/_growth_(attention|revisions|topics|topic_revisions)\//u.test(path)) {
    const decoded = codec.decode({ path, data: record });
    if (decoded.context.family !== 'domain') throw Error('Expected domain record');
    const restored = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, randomUUID()]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    assert.deepEqual(codec.decode(restored).value, decoded.value);
  }
});
