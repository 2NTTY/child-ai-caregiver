import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createKnowledgeCampaignBudget, campaignLimitMicros } from '../server/knowledge-campaign-budget.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('three original work leases compete for the last affordable dispatch', async t => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host) assert.match(host, /^127\.0\.0\.1:[1-9]\d{0,4}$/u);
  const projectId = 'demo-fhs-lanes';
  const emulator = host ? new Firestore({ projectId, host, ssl: false }) : undefined;
  if (emulator) t.after(() => emulator.terminate());
  const database = emulator ?? firestoreDomainFixture().database;
  const namespace = 'lanes_' + randomBytes(5).toString('hex');
  const generation = randomUUID(), cipher = createStorageCipher(randomBytes(32));
  const work = createFirestoreKnowledgeWork({ database, cipher, namespace, projectId,
    readControl: async () => ({ enabled: true, generation }) });
  const ledger = createKnowledgeCampaignBudget(database, namespace);
  await ledger.initialize();
  for (let i = 0; i < 13; i++) await (await ledger.reserve('generation', 'earlier', 65536))(1048576, 65536);
  const bindings = await Promise.all(['lane-one', 'lane-two', 'lane-three'].map(async sourceId => {
    const operationFingerprint = knowledgeReviewHash(sourceId), token = randomUUID();
    const session = await work.bind({ watchId: sourceId, operationFingerprint, workerGeneration: generation, publishMode: 'live' },
      token, knowledgeReviewHash('configuration'), { deadlineMs: 120000, modelCalls: 2 });
    const claim = await session.ports.claimOperation(operationFingerprint, token, Date.now() + 90000);
    assert.equal(claim.status, 'claimed');
    return { sourceId, operationFingerprint, stageKey: 'organizer', assertLease: session.assertLease };
  }));
  const results = await Promise.allSettled(bindings.map(binding => ledger.reserveShared('generation', binding, 8192)));
  const admitted = results.filter(result => result.status === 'fulfilled');
  assert.equal(admitted.length, 1);
  for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason), /budget_exhausted/);
  const restarted = createKnowledgeCampaignBudget(database, namespace);
  const held = await restarted.status();
  assert.equal(held?.held, 1634304);
  assert.ok(held && held.held + held.spent <= campaignLimitMicros);
  await admitted[0]!.value(12, 8);
  assert.equal((await restarted.status())?.held, 0);
});

test('independent leased sources share one cap and unknown or replayed stages remain lookup-only', async () => {
  const { database, loseReply } = firestoreDomainFixture();
  const ledger = createKnowledgeCampaignBudget(database, 'test');
  await ledger.initialize();
  const bound = (sourceId: string) => ({ sourceId, operationFingerprint: sourceId.padEnd(64, '0'), stageKey: 'organize',
    assertLease: async () => {} });
  const a = bound('a'), b = bound('b');
  const [finishA, finishB] = await Promise.all([ledger.reserveShared('generation', a, 8192), ledger.reserveShared('generation', b, 8192)]);
  const active = await ledger.sourceStatus('a');
  assert.equal(active.admissible, false);
  assert.equal(active.reservations[0]?.operationFingerprint, a.operationFingerprint);
  assert.equal((await ledger.sourceStatus('c')).admissible, true);
  await assert.rejects(ledger.reserveShared('generation', {...a, stageKey:'review'},8192), /source_reserved/);
  await assert.rejects(finishA(30,null),/usage_unknown/);
  await finishB(10,20);
  await finishB(10,20);
  await assert.rejects(finishB(11,20),/attempt_changed/);
  await assert.rejects(ledger.reserveShared('generation',b,8192),/attempt_recorded/);
  await assert.rejects(ledger.reserveShared('generation',{...bound('c'),assertLease:async()=>{throw Error('lease lost');}},8192),/lease lost/);
  loseReply();
  await assert.rejects(ledger.reserveShared('embedding',bound('c'),0),/lost commit acknowledgement/);
  const restarted = createKnowledgeCampaignBudget(database, 'test');
  assert.equal((await restarted.sourceStatus('c')).reservations.length,1);
  assert.equal((await restarted.sourceStatus('d')).admissible,true);
  assert.deepEqual([(await restarted.status())?.attempts,(await restarted.status())?.held], [3,1634304+308]);
});

test('legacy unknowns must match before handoff and stay reserved for every independent worker', async () => {
  const {database}=firestoreDomainFixture();
  const old=createKnowledgeCampaignBudget(database,'test');
  await old.initialize();
  await old.reserve('generation','old',4096);
  const root=database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120');
  const [ticket]=(await root.collection('attempts').get()).docs;
  const pin={sourceId:'old',operationFingerprint:'1'.repeat(64),ticketId:ticket!.id,at:ticket!.get('at') as string,kind:'generation' as const,ceiling:1603584};
  assert.equal((await old.sourceStatus('new')).admissible,false);
  await assert.rejects(createKnowledgeCampaignBudget(database,'test',[{...pin,ceiling:1}]).retainInspected(),/receipt_mismatch/);
  const owner=createKnowledgeCampaignBudget(database,'test',[pin]);
  await owner.retainInspected();
  await owner.retainInspected();
  assert.equal((await old.sourceStatus('new')).admissible,true);
  assert.equal((await old.sourceStatus('old')).admissible,false);
  assert.equal((await old.status())?.held,1603584);
});

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
