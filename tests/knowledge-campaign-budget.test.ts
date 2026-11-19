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
