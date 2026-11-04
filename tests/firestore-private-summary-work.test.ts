import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryFixture as fixture } from './helpers/private-summary-work.ts';
import { summaryManifestHash, summaryLineageKey, summaryLineageKeyForTarget } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
test('transaction-bound fresh sources preserve the oldest complete message across new chat and unrelated basis changes', async () => {
  const f = await fixture(), text = '  Synthetic oldest source 😀\r\n';
  const oldest = (await f.chat.createUserMessageForUser('owner', f.childId, text))!;
  await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic newer source');
  const before = JSON.stringify([...f.fake.records]); f.fake.retry();
  const { decision, revision } = await f.select();
  assert.equal(JSON.stringify([...f.fake.records]), before, 'Source selection does not write during either transaction attempt');
  assert.deepEqual(decision.manifest.coveredMessageIds, [oldest.id]);
  assert.equal(decision.resolvedSources.length, 1);
  assert.equal(decision.resolvedSources[0].sourceText, text);
  assert.equal(decision.resolvedSources[0].modelMetadata.role, 'user');
  assert.equal(decision.resolvedSources[0].modelMetadata.inReplyTo, null);
  assert.equal(decision.manifest.sourceCoverageComplete, true);
  await f.chat.createUserMessageForUser('owner', f.childId, 'Append while the same source remains unfinished');
  await f.memory.createTopic('owner', f.childId, { title: 'Unrelated new topic', note: '', visibility: 'private', confirmShared: false });
  const current = await f.revalidate(revision);
  assert.equal(current.kind, 'eligible');
  if (current.kind === 'eligible') assert.deepEqual(current.manifest, revision.manifest, 'Unrelated basis changes do not reopen a revision');
  assert.equal(JSON.stringify([...f.fake.records]).includes(text), false);
});

test('incomplete dependency discovery retains its conservative basis fence instead of pretending the page is complete', async () => {
  const f = await fixture();
  for (let index = 0; index < 21; index++) await f.memory.createTopic('owner', f.childId,
    { title: `Synthetic topic ${index}`, note: '', visibility: 'private', confirmShared: false });
  await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic source with a partial dependency graph');
  const { revision } = await f.select();
  assert.equal(revision.manifest.sourceCoverageComplete, false);
  assert.equal((await f.revalidate(revision)).kind, 'eligible');
  await f.memory.createTopic('owner', f.childId, { title: 'A later source', note: '', visibility: 'private', confirmShared: false });
  assert.deepEqual(await f.revalidate(revision), { kind: 'blocked', reason: 'incomplete_dependencies_changed' });
});

test('fresh coverage requires a real whole-message watermark and rejects substituted source evidence', async () => {
  const f = await fixture();
  const oldest = (await f.chat.createUserMessageForUser('owner', f.childId, 'First complete synthetic source'))!;
  const { revision } = await f.select();
  const changedManifest = { ...revision.manifest, units: revision.manifest.units.map(unit => unit.kind === 'chat_text'
    ? { ...unit, messageHash: 'f'.repeat(64) } : unit) };
  const changed = { ...revision, manifest: changedManifest, manifestHash: summaryManifestHash(changedManifest) };
  assert.equal((await f.revalidate(changed)).kind, 'source_changed');
  await f.chat.createUserMessageForUser('owner', f.childId, 'Interactive save can include this later message too');
  const saved = await f.saveAll();
  const covered = await f.revalidate(revision);
  assert.equal(covered.kind, 'already_covered');
  if (covered.kind === 'already_covered') {
    assert.equal(covered.proof.kind, 'fresh_watermark');
    assert.deepEqual(covered.proof.coveredMessageIds, [oldest.id]);
    assert.equal(covered.proof.headVersion, saved.version);
  }
});

test('repair sources include the whole original batch and current canonical corrections, and deletion is not mistaken for completion', async () => {
  const f = await fixture(), values = { key: 'synthetic preference', content: 'Original preference',
    source: { kind: 'manual' as const, description: 'Synthetic fixture' }, validUntil: null };
  const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
  const first = (await f.chat.createUserMessageForUser('owner', f.childId, 'Original synthetic preference'))!;
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Second synthetic source in the original batch'))!;
  const saved = await f.saveAll();
  const revised = (await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true,
    confirmShared: false, values: { ...values, content: 'Updated synthetic preference' }, reason: 'Synthetic correction' }))!;
  const { decision, revision } = await f.select({ kind: 'repair_batch', summaryId: saved.id });
  assert.deepEqual(decision.manifest.coveredMessageIds, [first.id, second.id]);
  assert.equal(decision.manifest.repairOf, saved.id);
  assert.equal(decision.resolvedSources.length, 3);
  assert.equal(decision.resolvedSources[2].source.kind, 'correction_json');
  assert.ok(decision.resolvedSources[2].sourceText.includes('Updated synthetic preference'));
  assert.equal((await f.revalidate(revision)).kind, 'eligible');
  await f.memory.delete('owner', f.childId, 'facts', revised.id, revised.version);
  const removed = await f.revalidate(revision);
  assert.equal(removed.kind, 'suppressed');
  assert.notEqual(removed.kind, 'already_covered');
});

test('prepared claims keep ordinary authority and deadline checks while deferring every write until commit', async () => {
  const f = await fixture(), message = (await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic prepared claim'))!;
  const runs = createFirestoreAgentRuns({ ...f.options, chat: f.chat, memory: f.memory });
  const trigger = { kind: 'interactive' as const, reference: message.id }, candidateRunId = randomUUID();
  const untouched = JSON.stringify([...f.fake.records]);
  const uncommitted = await f.authority.runTransaction('owner', f.childId, async b => {
    const prepared = await runs.prepareClaim(b, { trigger, recipeId: 'product-interactive', candidateRunId });
    assert.equal(await runs.originalRun(b, trigger.kind, trigger.reference), null, 'Preparing must not start the write phase');
    return prepared.claim;
  });
  assert.equal(uncommitted.created, true);
  assert.equal(JSON.stringify([...f.fake.records]), untouched, 'A discarded prepared helper has no durable side effect');
  let attempts = 0; f.fake.retry();
  const claim = await f.authority.runTransaction('owner', f.childId, async b => {
    attempts++;
    const prepared = await runs.prepareClaim(b, { trigger, recipeId: 'product-interactive', candidateRunId });
    assert.equal(await runs.originalRun(b, trigger.kind, trigger.reference), null);
    prepared.commit(); return prepared.claim;
  });
  assert.equal(attempts, 2);
  assert.equal(claim.runId, candidateRunId);
  assert.equal(claim.created, true);
  const duplicate = await runs.claim('owner', f.childId, trigger, 'product-interactive');
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.runId, claim.runId);
  assert.equal(duplicate.expiresAt, claim.expiresAt, 'Reopening does not extend the original deadline');
  await assert.rejects(f.authority.runTransaction('owner', f.childId, b => runs.prepareClaim(b,
    { trigger, recipeId: 'memory-refresh', candidateRunId: randomUUID() })));
});

test('identity lookup uses authoritative coverage before dependency validation and keeps the original lineage hash', async () => {
  const f = await fixture();
  const first = (await f.chat.createUserMessageForUser('owner', f.childId, 'Original identity'))!;
  await f.chat.createUserMessageForUser('owner', f.childId, 'Later identity');
  const { revision } = await f.select(), before = JSON.stringify([...f.fake.records]);
  const targets = await f.authority.runTransaction('owner', f.childId, b => f.memory.readSummaryLineageTargets(b, { kind: 'next_fresh' }));
  assert.deepEqual(targets, [{ target: { kind: 'fresh_message', messageId: first.id }, lineageKey: summaryLineageKey(revision.scope, revision.manifest) }]);
  assert.equal(summaryLineageKeyForTarget(revision.scope, targets[0].target), summaryLineageKey(revision.scope, revision.manifest));
  assert.equal(targets[0].lineageKey, firestoreDomainHash(['private-summary-lineage/v1', revision.scope,
    { kind: 'fresh_message', messageId: first.id }]), 'Original lineage hash bytes remain unchanged');
  assert.equal(JSON.stringify([...f.fake.records]), before);
  const summary = await f.saveAll();
  const fresh = await f.authority.runTransaction('owner', f.childId, b => f.memory.readSummaryLineageTargets(b, { kind: 'next_fresh' }));
  assert.deepEqual(fresh, []);
  const repair = await f.authority.runTransaction('owner', f.childId, b => f.memory.readSummaryLineageTargets(b, { kind: 'repair_batch', summaryId: summary.id }));
  assert.deepEqual(repair, [{ target: { kind: 'repair_batch', repairOf: summary.id },
    lineageKey: summaryLineageKeyForTarget(revision.scope, { kind: 'repair_batch', repairOf: summary.id }) }]);
});

test('fast source reading fixes the exact full prefix and every source lineage without trusting caller IDs', async () => {
  const f = await fixture(), first = (await f.chat.createUserMessageForUser('owner', f.childId, 'First full source 😀'))!;
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Second full source'))!;
  const read = (firstMessageId = first.id, messageCount = 2) => f.authority.runTransaction('owner', f.childId,
    b => f.memory.readFastSource(b, { kind: 'fresh_prefix', firstMessageId, messageCount }));
  const before = JSON.stringify([...f.fake.records]), source = await read();
  assert.equal(source.kind, 'eligible'); if (source.kind !== 'eligible') throw new Error('Expected full prefix');
  assert.deepEqual(source.input.messages.map(message => message.id), [first.id, second.id]);
  assert.equal(source.input.messages[0].text, first.text);
  assert.equal(source.lineageKeys.length, 2); assert.notEqual(source.lineageKeys[0], source.lineageKeys[1]);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  assert.equal((await read(second.id, 1)).kind, 'source_changed');
  assert.equal((await read(first.id, 3)).kind, 'source_changed');
  await assert.rejects(read(first.id, 0)); await assert.rejects(read(first.id, 1.5));
  const shorter = await read(first.id, 1);
  assert.equal(shorter.kind, 'eligible'); if (shorter.kind !== 'eligible') throw new Error('Expected first message');
  assert.notEqual(shorter.sourceHash, source.sourceHash); assert.equal(shorter.input.moreUncovered, true);
});

test('fast repair reading binds the whole original batch and all current correction sources', async () => {
  const f = await fixture();
  const values = { key: 'synthetic fast fact', content: 'Synthetic original fact',
    source: { kind: 'manual' as const, description: 'Synthetic fixture' }, validUntil: null };
  const fact = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const confirmed = (await f.memory.confirmFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false }))!;
  await f.chat.createUserMessageForUser('owner', f.childId, 'First source');
  await f.chat.createUserMessageForUser('owner', f.childId, 'Second source');
  const summary = await f.saveAll();
  await f.memory.reviseFact('owner', f.childId, confirmed.id, { expectedVersion: confirmed.version,
    values: { ...values, content: 'Synthetic corrected fact' }, reason: 'Synthetic correction', confirm: true, confirmShared: false });
  const result = await f.authority.runTransaction('owner', f.childId,
    b => f.memory.readFastSource(b, { kind: 'repair_batch', summaryId: summary.id }));
  assert.equal(result.kind, 'eligible'); if (result.kind !== 'eligible') throw new Error('Expected full repair');
  assert.deepEqual(result.input.messages.map(message => message.id), summary.coveredMessageIds);
  assert.equal(result.input.currentSources?.length, 1); assert.equal(result.input.repairOf, summary.id);
  assert.equal(result.lineageKeys.length, 1);
});
