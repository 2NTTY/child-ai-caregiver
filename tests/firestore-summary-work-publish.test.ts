import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { firestoreSavedSummarySchema } from '../server/firestore-memory.ts';
import { summaryManifestHash } from '../server/private-summary-work.ts';

async function start(f: Awaited<ReturnType<typeof fixture>>, target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string } = { kind: 'next_fresh' }) {
  await f.barrier(); const result = await f.build().start('owner', f.childId, target);
  if (result.kind !== 'created') throw new Error('Expected work'); return f.build().readState('owner', f.childId, result.work.id);
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, revision: Awaited<ReturnType<typeof start>>['revision'], commit = true) {
  return f.authority.runTransaction('owner', f.childId, async b => {
    const prepared = await f.memory.prepareCompletedWorkWrite(b, { revision, text: 'Complete synthetic folded output' }, randomUUID());
    if (commit && prepared.kind === 'prepared') prepared.commit(); return prepared;
  });
}
async function saved(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  return f.authority.runTransaction('owner', f.childId, async b => f.data.open('conversation-summary', id, b.scope, firestoreSavedSummarySchema,
    await b.transaction.get(f.data.ref('conversation_summaries', 'conversation-summary', id))));
}

test('completed-source writer preserves the immutable manifest dependencies and basis despite unrelated newer memory', async () => {
  const f = await fixture(), state = await start(f);
  await f.memory.createTopic('owner', f.childId, { title: 'Not in the completed model input', note: '', visibility: 'private', confirmShared: false });
  const now = (await f.memory.prepareSummary('owner', f.childId))!; assert.notEqual(now.basis, state.revision.manifest.sourceBasis);
  const result = await publish(f, state.revision); assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw new Error('Expected prepared writer');
  const body = await saved(f, result.value.id);
  assert.deepEqual(body.batch!.dependencies, state.revision.manifest.dependencies);
  assert.equal(body.batch!.sourceCoverageComplete, state.revision.manifest.sourceCoverageComplete);
  assert.equal(body.basis, state.revision.manifest.sourceBasis); assert.equal(body.batch!.authorizationVersion, state.revision.authorizationVersion);
  assert.deepEqual(result.value.coveredMessageIds, [f.message.id]); assert.equal(result.value.previousId, null);
});

test('prepared completed-source writes are discardable, atomic on retry and recognize original coverage after lost acknowledgement', async () => {
  const f = await fixture(), state = await start(f), before = JSON.stringify([...f.fake.records]);
  assert.equal((await publish(f, state.revision, false)).kind, 'prepared'); assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.failCommit(); await assert.rejects(publish(f, state.revision), /Synthetic transaction commit failed/u);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(publish(f, state.revision), /Synthetic lost commit acknowledgement/u);
  const committed = JSON.stringify([...f.fake.records]); const recovered = await publish(f, state.revision);
  assert.equal(recovered.kind, 'already_covered'); assert.equal(JSON.stringify([...f.fake.records]), committed);
  assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 1);
});

test('writer rejects unpersisted revision substitutions and changed or expired original dependencies without publishing', async t => {
  const f = await fixture(), values = { key: 'Synthetic', content: 'Original', source: { kind: 'manual' as const, description: 'Synthetic' },
    validUntil: new Date(Date.now() + 60000).toISOString() };
  const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
  const state = await start(f), forgedManifest = { ...state.revision.manifest, sourceBasis: 'f'.repeat(64) };
  await assert.rejects(publish(f, { ...state.revision, manifest: forgedManifest, manifestHash: summaryManifestHash(forgedManifest) }));
  const originalNow = Date.now(); const clock = t.mock.method(Date, 'now', () => originalNow + 120000);
  const expired = await publish(f, state.revision); assert.equal(expired.kind, 'suppressed'); clock.mock.restore();
  await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false,
    values: { ...values, content: 'Changed after source was fixed' }, reason: 'Synthetic correction' });
  const changed = await publish(f, state.revision); assert.equal(changed.kind, 'source_changed');
  assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 0);
});

test('an incomplete dependency graph retains the original exact-basis publication fence', async () => {
  const f = await fixture();
  for (let index = 0; index < 21; index++) await f.memory.createTopic('owner', f.childId, { title: 'Synthetic ' + index, note: '', visibility: 'private', confirmShared: false });
  const state = await start(f); assert.equal(state.revision.manifest.sourceCoverageComplete, false);
  await f.memory.createTopic('owner', f.childId, { title: 'Later missing graph source', note: '', visibility: 'private', confirmShared: false });
  const before = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await publish(f, state.revision), { kind: 'blocked', reason: 'incomplete_dependencies_changed' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('whole repair publication uses the current head version without rewinding later append coverage or replacing its fixed dependencies', async () => {
  const f = await fixture(), values = { key: 'Synthetic repair', content: 'Before', source: { kind: 'manual' as const, description: 'Synthetic' }, validUntil: null };
  const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
  const first = await f.saveAll(), secondMessage = (await f.chat.createUserMessageForUser('owner', f.childId, 'Later complete batch'))!, second = await f.saveAll();
  await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false,
    values: { ...values, content: 'After' }, reason: 'Synthetic correction' });
  const state = await start(f, { kind: 'repair_batch', summaryId: first.id });
  const head = (await f.memory.prepareSummary('owner', f.childId))!;
  await f.memory.saveSummary('owner', f.childId, { previousVersion: head.previousVersion, basis: head.basis,
    coveredMessageIds: [secondMessage.id], repairOf: second.id, text: 'Other repair changes the head version' });
  await f.chat.createUserMessageForUser('owner', f.childId, 'Newest append after both batches'); await f.saveAll();
  await f.memory.createTopic('owner', f.childId, { title: 'Unrelated new topic', note: '', visibility: 'private', confirmShared: false });
  const current = (await f.memory.prepareSummary('owner', f.childId))!;
  const result = await publish(f, state.revision); assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw new Error('Expected whole repair');
  assert.equal(result.value.version, current.previousVersion + 1); assert.deepEqual(result.value.coveredMessageIds, first.coveredMessageIds);
  const body = await saved(f, result.value.id); assert.equal(body.batch!.replaces, first.id);
  assert.deepEqual(body.batch!.dependencies, state.revision.manifest.dependencies); assert.equal(body.basis, state.revision.manifest.sourceBasis);
  assert.ok(body.lastSortKey > body.batch!.lastMessageSortKey);
  const after = (await f.memory.prepareSummary('owner', f.childId))!; assert.deepEqual(after.messages, []);
  const original = f.fake.records.get(f.data.ref('conversation_summaries', 'conversation-summary', first.id).path)!;
  assert.equal(original.currentBatch, false);
});

test('completed-source expiry uses the earliest instant across timezone offsets', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00.000Z') });
  const f = await fixture();
  for (const [key, validUntil] of [['Earlier instant', '2030-01-01T11:00:00+10:00'], ['Earlier lexical text', '2030-01-01T02:00:00Z']]) {
    const fact = (await f.memory.createFact('owner', f.childId, { values: { key, content: key,
      source: { kind: 'manual', description: 'Synthetic cross-timezone expiry' }, validUntil }, intendedVisibility: 'private' }))!;
    await f.memory.confirmFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false });
  }
  const state = await start(f), result = await publish(f, state.revision);
  assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw new Error('Expected completed-source publication');
  assert.equal((await saved(f, result.value.id)).validUntil, '2030-01-01T01:00:00.000Z');
});

test('completed fresh-source period records the original message time rather than publication time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00.000Z') });
  const f = await fixture(), state = await start(f);
  t.mock.timers.tick(3600000);
  const result = await publish(f, state.revision);
  assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw new Error('Expected completed-source publication');
  const period = { from: f.message.createdAt, to: f.message.createdAt };
  assert.deepEqual(result.value.sourcePeriod, period);
  assert.deepEqual((await saved(f, result.value.id)).summary.sourcePeriod, period);
  assert.notEqual(result.value.createdAt, period.to);
});

test('completed repair-source period includes the current correction supplied to the model', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00.000Z') });
  const f = await fixture(), values = { key: 'Dated correction', content: 'Before', validUntil: null,
    source: { kind: 'manual' as const, description: 'Synthetic correction period' } };
  const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id,
    { expectedVersion: candidate.version, confirm: true, confirmShared: false }))!;
  const original = await f.saveAll(); t.mock.timers.tick(3600000);
  const changed = (await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true,
    confirmShared: false, values: { ...values, content: 'After' }, reason: 'Synthetic later correction' }))!;
  const state = await start(f, { kind: 'repair_batch', summaryId: original.id });
  assert.ok(state.revision.manifest.units.some(unit => unit.kind === 'correction_json' && unit.dependency.id === fact.id));
  t.mock.timers.tick(3600000);
  const result = await publish(f, state.revision);
  assert.equal(result.kind, 'prepared'); if (result.kind !== 'prepared') throw new Error('Expected completed repair publication');
  const period = { from: f.message.createdAt, to: changed.contentUpdatedAt };
  assert.deepEqual(result.value.sourcePeriod, period);
  assert.deepEqual((await saved(f, result.value.id)).summary.sourcePeriod, period);
  assert.notEqual(result.value.createdAt, period.to);
});
