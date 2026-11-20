import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeCampaignBudget, campaignLimitMicros } from '../server/knowledge-campaign-budget.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('campaign admission serializes attempts, survives lost acknowledgement, and enforces the gross cap', async () => {
  const { database, loseReply } = firestoreDomainFixture();
  const first = createKnowledgeCampaignBudget(database, 'test');
  await first.initialize();
  const candidates = await Promise.allSettled([first.reserve('generation', 'a', 65536), first.reserve('generation', 'b', 65536)]);
  assert.equal(candidates.filter(candidate => candidate.status === 'fulfilled').length, 1);
  const accepted = candidates.find(candidate => candidate.status === 'fulfilled')!;
  await accepted.value(1048576, 65536);
  const after = await first.status();
  assert.equal(after?.held, 0);
  assert.equal(after?.spent, 2064384);
  const restart = createKnowledgeCampaignBudget(database, 'test');
  await restart.initialize();
  for (let i = 1; i < 14; i++) await (await restart.reserve('generation', 'a', 65536))(1048576, 65536);
  await assert.rejects(restart.reserve('generation', 'a', 65536), /budget_exhausted/);
  const known = await restart.status();
  assert.ok(known && known.spent < campaignLimitMicros);
  loseReply();
  await assert.rejects(restart.reserve('embedding', 'a', 0), /lost commit acknowledgement/);
  assert.equal((await restart.status())?.held, 308);
  await assert.rejects(first.reserve('embedding', 'a', 0), /reconcile/);
});

test('missing usage keeps the full reservation across restarts', async () => {
  const { database } = firestoreDomainFixture();
  const ledger = createKnowledgeCampaignBudget(database, 'test');
  await ledger.initialize();
  const settle = await ledger.reserve('generation', 'a', 1024);
  await assert.rejects(settle(100, null), /usage_unknown/);
  assert.equal((await ledger.status())?.held, 1580544);
  await assert.rejects(ledger.reserve('embedding', 'a', 0), /reconcile/);
});

test('an inspected terminal unknown keeps its entire ceiling while one independent source advances', async () => {
  const { database } = firestoreDomainFixture();
  const ordinary = createKnowledgeCampaignBudget(database, 'test');
  await ordinary.initialize();
  const unknown = await ordinary.reserve('generation', 'a', 4096);
  await assert.rejects(unknown(42, null), /usage_unknown/);
  const ref = database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120');
  const [doc] = (await ref.collection('attempts').get()).docs;
  const pinned = { ticketId: doc!.id, sourceId: 'a', kind: 'generation' as const, ceiling: 1603584,
    at: doc!.get('at') as string, operationFingerprint: '1'.repeat(64) };
  const resumed = createKnowledgeCampaignBudget(database, 'test', [pinned]);
  await assert.rejects(resumed.reserve('embedding', 'a', 0), /reconcile/);
  await assert.rejects(createKnowledgeCampaignBudget(database, 'test', [{ ...pinned, sourceId: 'x' }]).reserve('embedding', 'b', 0), /receipt_mismatch/);
  const admitted = await Promise.allSettled([resumed.reserve('embedding', 'b', 0), resumed.reserve('embedding', 'c', 0)]);
  assert.equal(admitted.filter(candidate => candidate.status === 'fulfilled').length, 1);
  await admitted.find(candidate => candidate.status === 'fulfilled')!.value(100, 0);
  const current = await resumed.status();
  assert.deepEqual([current?.spent,current?.held,current?.attempts,current?.settled], [15,1603584,2,1]);
  await assert.rejects(ordinary.reserve('embedding', 'c', 0), /reconcile/);
  // The unknown ceiling still subtracts from the budget available to all subsequent requests.
  for (let i = 0; i < 13; i++) await (await resumed.reserve('generation', 'b', 65536))(1048576, 65536);
  await assert.rejects(resumed.reserve('generation', 'b', 65536), /budget_exhausted/);
  assert.equal((await resumed.status())?.held, pinned.ceiling);
});
