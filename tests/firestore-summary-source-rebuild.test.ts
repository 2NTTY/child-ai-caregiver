import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryFixture as fixture } from './helpers/private-summary-work.ts';
import { summaryLineageKey, type PrivateSummarySourceRevision } from '../server/private-summary-work.ts';
import { randomUUID } from 'node:crypto';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreSavedSummarySchema } from '../server/firestore-memory.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const values = (key: string, content: string) => ({ key, content,
  source: { kind: 'manual' as const, description: 'Synthetic source lifecycle' }, validUntil: null });
async function fact(f: Fixture, key: string) {
  const candidate = (await f.memory.createFact('owner', f.childId, { values: values(key, 'Original ' + key), intendedVisibility: 'private' }))!;
  return (await f.memory.confirmFact('owner', f.childId, candidate.id,
    { expectedVersion: candidate.version, confirm: true, confirmShared: false }))!;
}
async function revise(f: Fixture, prior: Awaited<ReturnType<typeof fact>>, content: string) {
  return (await f.memory.reviseFact('owner', f.childId, prior.id, { expectedVersion: prior.version,
    confirm: true, confirmShared: false, values: values(prior.key, content), reason: 'Synthetic actual correction' }))!;
}
const rebuild = (f: Fixture, revision: PrivateSummarySourceRevision) => f.authority.runTransaction('owner', f.childId,
  b => f.memory.rebuildSummarySource(b, revision));

test('unchanged source rebuilding preserves original manifest and lineage across chat append and unrelated complete-graph changes', async () => {
  const f = await fixture(); await f.chat.createUserMessageForUser('owner', f.childId, '  Original Unicode source 👩‍👩‍👧‍👦\n');
  const { revision } = await f.select();
  await f.chat.createUserMessageForUser('owner', f.childId, 'A later message must not replace the original source');
  await f.memory.createTopic('owner', f.childId, { title: 'Unrelated topic', note: '', visibility: 'private', confirmShared: false });
  const before = JSON.stringify([...f.fake.records]); f.fake.retry(); const result = await rebuild(f, revision);
  assert.equal(result.kind, 'eligible'); if (result.kind !== 'eligible') throw new Error('Expected original source');
  assert.deepEqual(result.manifest, revision.manifest); assert.equal(result.resolvedSources[0].sourceText, '  Original Unicode source 👩‍👩‍👧‍👦\n');
  assert.equal(JSON.stringify([...f.fake.records]), before, 'Rebuilding never persists a revision or changes authority');
});

test('fresh source rebuilding includes every changed original dependency as current canonical correction without substituting new unrelated facts', async () => {
  const f = await fixture(), prior = await fact(f, 'Original preference');
  const original = (await f.chat.createUserMessageForUser('owner', f.childId, 'Original complete message 😀'))!;
  const { revision } = await f.select(), changed = await revise(f, prior, 'Current corrected preference 😀');
  const unrelated = await fact(f, 'Unrelated later fact');
  const result = await rebuild(f, revision);
  assert.equal(result.kind, 'eligible'); if (result.kind !== 'eligible') throw new Error('Expected rebuilt source');
  assert.equal(summaryLineageKey(revision.scope, result.manifest), summaryLineageKey(revision.scope, revision.manifest));
  assert.deepEqual(result.manifest.coveredMessageIds, [original.id]); assert.equal(result.resolvedSources[0].sourceText, original.text);
  assert.equal(result.manifest.dependencies.find(item => item.id === prior.id)?.version, changed.version);
  assert.equal(result.manifest.dependencies.some(item => item.id === unrelated.id), false);
  assert.equal(result.resolvedSources.length, 2);
  assert.ok(result.resolvedSources[1].sourceText.includes('Current corrected preference 😀'));
  assert.equal(result.manifest.units[1].kind, 'correction_json');
});

test('repair rebuilding preserves the whole original batch and previously required corrections while updating another dependency again', async () => {
  const f = await fixture(), firstFact = await fact(f, 'First preference'), secondFact = await fact(f, 'Second preference');
  const first = (await f.chat.createUserMessageForUser('owner', f.childId, 'First complete original message'))!;
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Second complete original message'))!;
  const saved = await f.saveAll();
  const changed = await revise(f, firstFact, 'First correction'); await revise(f, secondFact, 'Still required second correction');
  const { revision } = await f.select({ kind: 'repair_batch', summaryId: saved.id });
  await revise(f, changed, 'New first correction');
  const result = await rebuild(f, revision);
  assert.equal(result.kind, 'eligible'); if (result.kind !== 'eligible') throw new Error('Expected original repair');
  assert.deepEqual(result.manifest.coveredMessageIds, [first.id, second.id]); assert.equal(result.manifest.repairOf, saved.id);
  assert.equal(result.resolvedSources.length, 4);
  const corrections = result.resolvedSources.slice(2).map(item => item.sourceText).join('\n');
  assert.ok(corrections.includes('New first correction')); assert.ok(corrections.includes('Still required second correction'));
});

test('incomplete graph basis changes and removed original dependencies cannot become a smaller eligible replacement', async () => {
  const f = await fixture();
  for (let index = 0; index < 21; index++) await f.memory.createTopic('owner', f.childId,
    { title: 'Original topic ' + index, note: '', visibility: 'private', confirmShared: false });
  await f.chat.createUserMessageForUser('owner', f.childId, 'Partial graph source');
  const { revision } = await f.select(); await f.memory.createTopic('owner', f.childId,
    { title: 'Extra topic', note: '', visibility: 'private', confirmShared: false });
  assert.deepEqual(await rebuild(f, revision), { kind: 'blocked', reason: 'incomplete_dependencies_changed' });
  const other = await fixture(), originalFact = await fact(other, 'Required dependency');
  await other.chat.createUserMessageForUser('owner', other.childId, 'Original source');
  const selected = await other.select(); await other.memory.delete('owner', other.childId, 'facts', originalFact.id, originalFact.version);
  assert.deepEqual(await rebuild(other, selected.revision), { kind: 'suppressed', reason: 'dependency_suppressed' });
});

test('valid whole coverage in an older batch reconciles an original pending source even when its dependency changed and the later head is invalid', async () => {
  const f = await fixture(), originalFact = await fact(f, 'Covered dependency');
  const message = (await f.chat.createUserMessageForUser('owner', f.childId, 'Pending original source'))!;
  const { revision } = await f.select(); await revise(f, originalFact, 'Changed before interactive completion');
  const covering = await f.saveAll();
  const laterFact = await fact(f, 'Only the later batch depends on this');
  await f.chat.createUserMessageForUser('owner', f.childId, 'A later complete batch'); const latest = await f.saveAll();
  await revise(f, laterFact, 'Invalidates only the later head');
  const result = await rebuild(f, revision);
  assert.equal(result.kind, 'already_covered'); if (result.kind !== 'already_covered') throw new Error('Expected exact historical coverage');
  assert.deepEqual(result.proof.coveredMessageIds, [message.id]); assert.equal(result.proof.replacementSummaryId, covering.id);
  assert.equal(result.proof.headVersion, latest.version);
});

test('invalid historical coverage and changed authority are not proof that an original source can be skipped', async () => {
  const f = await fixture(), originalFact = await fact(f, 'Invalidated dependency');
  await f.chat.createUserMessageForUser('owner', f.childId, 'Original covered source'); const { revision } = await f.select();
  await f.saveAll(); await revise(f, originalFact, 'Makes the historical batch invalid');
  assert.deepEqual(await rebuild(f, revision), { kind: 'blocked', reason: 'coverage_unverifiable' });
  assert.deepEqual(await rebuild(f, { ...revision, authorizationVersion: '999' }), { kind: 'blocked', reason: 'source_authority_changed' });
});

test('coverage proof rejects missing membership, query metadata mismatch, cross-scope tags and duplicated current endpoints', async () => {
  for (const fault of ['membership', 'version', 'scope', 'duplicate'] as const) {
    const f = await fixture(), data = new FirestoreDomainData(f.options);
    await f.chat.createUserMessageForUser('owner', f.childId, 'Original full source'); const { revision } = await f.select();
    await f.chat.createUserMessageForUser('owner', f.childId, 'Second full source'); const saved = await f.saveAll();
    await f.authority.runTransaction('owner', f.childId, async b => {
      const ref = data.ref('conversation_summaries', 'conversation-summary', saved.id), row = await b.transaction.get(ref);
      const envelope = row.data()!, value = data.open('conversation-summary', saved.id, b.scope, firestoreSavedSummarySchema, row);
      if (fault === 'membership') {
        value.summary.coveredMessageIds = [value.summary.coveredMessageIds[1]];
        b.transaction.set(ref, { ...envelope, ...data.seal('conversation-summary', saved.id, b.scope, firestoreSavedSummarySchema, value, saved.version) });
      } else if (fault === 'version') b.transaction.set(ref, { ...envelope, entityVersion: saved.version + 1 });
      else if (fault === 'scope') b.transaction.set(ref, { ...envelope, childTag: 'not-the-original-scope' });
      else {
        const duplicateId = randomUUID(), copy = { ...value, summary: { ...value.summary, id: duplicateId } };
        b.transaction.create(data.ref('conversation_summaries', 'conversation-summary', duplicateId),
          { ...envelope, entityId: duplicateId, ...data.seal('conversation-summary', duplicateId, b.scope, firestoreSavedSummarySchema, copy, saved.version) });
      }
    });
    assert.deepEqual(await f.revalidate(revision), { kind: 'blocked', reason: 'coverage_unverifiable' }, 'Live validation must use the same coverage proof: ' + fault);
    assert.deepEqual(await rebuild(f, revision), { kind: 'blocked', reason: 'coverage_unverifiable' }, fault);
  }
});

test('whole-batch coverage cannot omit an intervening authoritative message while retaining the target and correct endpoint', async () => {
  const f = await fixture(), data = new FirestoreDomainData(f.options);
  await f.chat.createUserMessageForUser('owner', f.childId, 'First original target'); const { revision } = await f.select();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Intervening original message');
  await f.chat.createUserMessageForUser('owner', f.childId, 'Last original message'); const saved = await f.saveAll();
  await f.authority.runTransaction('owner', f.childId, async b => {
    const ref = data.ref('conversation_summaries', 'conversation-summary', saved.id), row = await b.transaction.get(ref);
    const value = data.open('conversation-summary', saved.id, b.scope, firestoreSavedSummarySchema, row);
    value.summary.coveredMessageIds = [value.summary.coveredMessageIds[0], value.summary.coveredMessageIds[2]];
    b.transaction.set(ref, { ...row.data(), ...data.seal('conversation-summary', saved.id, b.scope, firestoreSavedSummarySchema, value, saved.version) });
  });
  assert.deepEqual(await f.revalidate(revision), { kind: 'blocked', reason: 'coverage_unverifiable' });
  assert.deepEqual(await rebuild(f, revision), { kind: 'blocked', reason: 'coverage_unverifiable' });
});
