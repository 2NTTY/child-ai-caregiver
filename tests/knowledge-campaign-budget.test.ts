import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createKnowledgeCampaignBudget, campaignLimitMicros, campaignRecoverySchemas } from '../server/knowledge-campaign-budget.ts';
import { rejectedScriptEmbedding } from '../server/fhs-script-embedding-receipt.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { bindFirstDispatch, hasUndispatchedOriginal } from '../server/fhs-undispatched-original.ts';
import { manualPublicationPin } from '../server/fhs-manual-publication.ts';
import { commissionedWebOriginal } from '../server/knowledge-retained-draft.ts';

test('the first-dispatch registration binds the comic to its held observation and original commission', () => {
  const sourceId = 'pdf-48e37ddf27a8864e98362fa9';
  const original = '914510f8ffa181fb66386cbdf95ef2ec987c6fed6618c8ddf3c0aa5cd23c5dfb';
  const observation = 'b73aecabc4cad735502392694454d35c75b560a2f4818ffeb138ecb14e87f082';
  const pin = manualPublicationPin(sourceId);
  assert.equal(pin?.lane, 'C2');
  assert.equal(pin.pages, 36);
  const request = { watchId:sourceId, operationFingerprint:original, workerGeneration:randomUUID(), publishMode:'live' as const };
  const result = { status:'candidate_held' as const, code:'unavailable' as const, watchId:sourceId, observationHash:observation, published:false as const };
  const parent = { request, result, budget:{modelCalls:1}, preparedHash:null, lease:null, receipt:null };
  assert.deepEqual(bindFirstDispatch(pin, original, parent), {original, observation});
  assert.equal(bindFirstDispatch(pin, original, {...parent, result:{...result, observationHash:knowledgeReviewHash('other observation')}}), undefined);
  assert.equal(bindFirstDispatch(pin, original, {...parent, receipt:{state:'committed'}}), undefined);
  assert.equal(bindFirstDispatch(pin, knowledgeReviewHash('other commission'), parent), undefined);
  assert.equal(hasUndispatchedOriginal('pdf-836e9d989e83046a43059df7'), false);
});

test('an audited first dispatch keeps its original ticket and admits one worker across restarts and late callbacks', async () => {
  const {database} = firestoreDomainFixture(), namespace = 'first_dispatch', generation = randomUUID();
  const work = createFirestoreKnowledgeWork({database, namespace, projectId:'demo-first-dispatch', cipher:createStorageCipher(randomBytes(32)),
    readControl:async () => ({enabled:true,generation})});
  const budget = createKnowledgeCampaignBudget(database,namespace);
  await budget.initialize();
  const original = knowledgeReviewHash('original'), observation = knowledgeReviewHash('original PDF');
  const originalRequest = {watchId:'test-pdf',publishMode:'live' as const,workerGeneration:generation,operationFingerprint:original};
  const config = knowledgeReviewHash('policy'), limits = {modelCalls:2,deadlineMs:90000};
  const first = randomUUID(), previous = await work.bind(originalRequest,first,config,limits);
  await previous.ports.claimOperation(original,first,Date.now()+80000);
  const stage = {system:'frozen organizer',user:'frozen PDF',attemptKey:'organize-page'};
  await assert.rejects(previous.completeText(stage,async () => {throw Error('unavailable');}),/unavailable/);
  await previous.ports.saveResult(original,{status:'candidate_held',watchId:'test-pdf',observationHash:observation,code:'unavailable',published:false});
  await previous.ports.releaseOperation(original,first);
  const delivery = knowledgeReviewHash(['fhs-first-dispatch/1',original]);
  const request = {...originalRequest,operationFingerprint:delivery};
  const before = await work.inspect(originalRequest);
  const claim = {original,observation,verify:async () => {}};
  const wrong = {...claim,observation:knowledgeReviewHash('different snapshot')};
  await assert.rejects(work.bind(request,randomUUID(),config,limits,undefined,undefined,undefined,wrong),/first_dispatch_binding/);
  const closed = {...claim,verify:async () => {throw Error('changed original registration');}};
  await assert.rejects(work.bind(request,randomUUID(),config,limits,undefined,undefined,undefined,closed),/changed original/);
  const start = (token:string) => work.bind(request,token,config,limits,undefined,undefined,undefined,claim);
  const tokens = [randomUUID(),randomUUID()];
  const sessions = await Promise.all(tokens.map(start));
  assert.equal((await work.inspect(request))?.firstDispatchFrom,original);
  const leases = await Promise.all(sessions.map((s,i) => s.ports.claimOperation(delivery,tokens[i]!,Date.now()+80000)));
  assert.deepEqual(leases.map(l=>l.status).sort(),['busy','claimed']);
  const session = sessions[leases.findIndex(l=>l.status==='claimed')]!;
  const binding = {sourceId:request.watchId,operationFingerprint:original,stageKey:stage.attemptKey,assertLease:session.assertLease};
  let sends = 0;
  const invoke = () => session.completeText(stage,async () => {
    const settle = await budget.reserveShared('generation',binding,8192);
    sends++; await settle(5,7); return 'organizer';
  });
  assert.equal(await invoke(),'organizer');
  assert.equal(await invoke(),'organizer');
  assert.equal(sends,1);
  await assert.rejects(budget.reserveShared('generation',{...binding,assertLease:previous.assertLease},8192));
  await start(randomUUID());
  assert.deepEqual(await work.inspect(originalRequest),before);
  assert.equal((await budget.status())?.attempts,1);
});

test('any pre-existing source ticket stops the first-dispatch claim before a work record is created', async () => {
  const {database}=firestoreDomainFixture(), namespace='old_ticket', generation=randomUUID();
  const work=createFirestoreKnowledgeWork({database,namespace,projectId:'demo-first-dispatch',cipher:createStorageCipher(randomBytes(32)),
    readControl:async()=>({enabled:true,generation})});
  const budget=createKnowledgeCampaignBudget(database,namespace);
  await budget.initialize();
  const config=knowledgeReviewHash('configuration'), limits={modelCalls:2,deadlineMs:90000};
  const original=knowledgeReviewHash('old source'), observation=knowledgeReviewHash('PDF');
  const request={watchId:'test-pdf',publishMode:'live' as const,workerGeneration:generation,operationFingerprint:original};
  const token=randomUUID(), session=await work.bind(request,token,config,limits);
  await session.ports.claimOperation(original,token,Date.now()+80000);
  const settle=await budget.reserveShared('generation',{sourceId:request.watchId,operationFingerprint:original,stageKey:'organizer',assertLease:session.assertLease},8192);
  await assert.rejects(session.completeText({system:'organize',user:'PDF',attemptKey:'organizer'},async()=>{throw Error('lost reply');}));
  await session.ports.saveResult(original,{status:'candidate_held',watchId:request.watchId,observationHash:observation,code:'unavailable',published:false});
  await session.ports.releaseOperation(original,token);
  const child={...request,operationFingerprint:knowledgeReviewHash(['fhs-first-dispatch/1',original])};
  const bind=()=>work.bind(child,randomUUID(),config,limits,undefined,undefined,undefined,{original,observation,verify:async()=>{}});
  await assert.rejects(bind(),/first_dispatch_binding/);
  await settle(7,4);
  await assert.rejects(bind(),/first_dispatch_binding/);
  assert.equal(await work.inspect(child),null);
  assert.equal((await budget.status())?.attempts,1);
});

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
  assert.equal(await database.runTransaction(tx=>restarted.hasGenerationCapacity(tx,8192),{readOnly:true}),false);
  assert.ok(held && held.held + held.spent <= campaignLimitMicros);
  await admitted[0]!.value(12, 8);
  assert.equal((await restarted.status())?.held, 0);
  assert.equal(await database.runTransaction(tx=>restarted.hasGenerationCapacity(tx,8192),{readOnly:true}),true);
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

test('only the original rejected embedding receipt releases its own hold once',async()=>{
  const pin=rejectedScriptEmbedding,{database}=firestoreDomainFixture(),ledger=createKnowledgeCampaignBudget(database,'test');
  const root=database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120');
  await ledger.initialize();
  await database.runTransaction(async tx=>{
    tx.update(root,{held:pin.ceiling,attempts:1});
    tx.create(root.collection('attempts').doc(pin.ticketId),{sourceId:pin.sourceId,kind:'embedding',state:'reserved',
      operationFingerprint:pin.parent,stageHash:pin.stageHash,at:pin.at,ceiling:pin.ceiling});
  });
  const evidence={stageHash:pin.stageHash,versionHash:pin.versionHash,ticketAt:pin.at,
    documentHash:'b48cd1266623b0e9d1f99f5ff578b0ade4ff5803c7caf36db0091191c9a98ea7',operationId:'fb60651f-f395-543f-8dd4-1f2c32f98313',
    reservedAtMs:1795278173890,record:{kind:'embedding',outcome:'invalid_input',inputTokens:null,billableCharacters:null,durationMs:1598}};
  await assert.rejects(ledger.settleScriptEmbeddingRejection(async()=>({...evidence,record:null})),/receipt_binding/u);
  assert.equal((await ledger.status())!.held,308);
  await ledger.settleScriptEmbeddingRejection(async()=>evidence);
  await ledger.settleScriptEmbeddingRejection(async()=>evidence);
  const row=await ledger.status();assert.deepEqual([row?.held,row?.spent,row?.attempts,row?.settled],[0,0,1,1]);
  const original=await database.runTransaction(tx=>tx.get(root.collection('attempts').doc(pin.ticketId)));
  const entry=campaignRecoverySchemas.attempt.parse(original.data());
  assert.equal(entry.rejection?.evidenceSha256,pin.evidenceHash);assert.equal(entry.inputTokens,undefined);
});

test('an evidenced native rejection releases its original reservation once without inventing usage or replaying it', async () => {
  const { database, loseReply } = firestoreDomainFixture();
  const ledger = createKnowledgeCampaignBudget(database, 'test');
  await ledger.initialize();
  const binding = { sourceId: 'original', operationFingerprint: 'a'.repeat(64), stageKey: 'organize', assertLease: async () => {} };
  const settle = await ledger.reserveShared('generation', binding, 8192);
  const [ticket] = (await database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120').collection('attempts').get()).docs;
  const proof = { ticketId: ticket!.id, sourceId: binding.sourceId, operationFingerprint: binding.operationFingerprint,
    stageHash: ticket!.get('stageHash'), at: ticket!.get('at'), ceiling: ticket!.get('ceiling'),
    rejection: { httpStatus: 400, evidenceSha256: 'f'.repeat(64) } };
  await assert.rejects(ledger.settleRejectedGeneration({ ...proof, stageHash: 'b'.repeat(64) }));
  await assert.rejects(ledger.settleRejectedGeneration({ ...proof, at: '2026-01-01T00:00:00.000Z' }));
  await assert.rejects(ledger.settleRejectedGeneration({ ...proof, rejection: { ...proof.rejection, httpStatus: 200 } }));
  assert.equal((await ledger.status())?.held, proof.ceiling);
  loseReply();
  await assert.rejects(ledger.settleRejectedGeneration(proof), /lost commit acknowledgement/);
  await ledger.settleRejectedGeneration(proof);
  const row = await database.runTransaction(async tx => (await tx.get(ticket!.ref)).data()!);
  assert.equal(row.state, 'settled');
  assert.equal(row.cost, 0);
  assert.equal(row.inputTokens, undefined);
  assert.equal(row.outputTokens, undefined);
  assert.deepEqual(row.rejection, proof.rejection);
  assert.deepEqual(campaignRecoverySchemas.attempt.parse(row), row);
  for (const invalid of [{...row, inputTokens: 0}, {...row, cost: 1}, {...row, kind: 'embedding'}, {...row, state: 'reserved'}]) {
    assert.equal(campaignRecoverySchemas.attempt.safeParse(invalid).success, false);
  }
  await assert.rejects(ledger.settleRejectedGeneration({ ...proof, rejection: { ...proof.rejection, evidenceSha256: 'e'.repeat(64) } }));
  await assert.rejects(settle(0,0), /attempt_changed/);
  const final = await ledger.status();
  assert.deepEqual([final?.held, final?.spent, final?.attempts, final?.settled], [0,0,1,1]);
  await assert.rejects(ledger.reserveShared('generation', binding, 8192), /attempt_recorded/);
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

test('only the inspected original can release a legacy rejection and its historic profile remains usable', async () => {
  const { database, loseReply } = firestoreDomainFixture();
  const ordinary = createKnowledgeCampaignBudget(database, 'test');
  await ordinary.initialize();
  await ordinary.reserve('generation', 'archived', 4096);
  const collection = database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120').collection('attempts');
  const [ticket] = (await collection.get()).docs;
  const pin = { ticketId: ticket!.id, sourceId: 'archived', operationFingerprint: 'a'.repeat(64),
    kind: 'generation' as const, at: ticket!.get('at') as string, ceiling: 1603584 };
  const { kind, ...original } = pin;
  const proof = { ...original, rejection: { httpStatus: 504, evidenceSha256: 'e'.repeat(64) } };
  const owner = createKnowledgeCampaignBudget(database, 'test', [pin]);
  await assert.rejects(owner.settleRejectedGeneration(proof));
  await owner.retainInspected();
  await assert.rejects(ordinary.settleRejectedGeneration(proof));
  await assert.rejects(owner.settleRejectedGeneration({ ...proof, at: '2026-01-01T00:00:00.000Z' }));
  loseReply();
  await assert.rejects(owner.settleRejectedGeneration(proof), /lost commit acknowledgement/);
  await owner.settleRejectedGeneration(proof);
  await assert.rejects(owner.settleRejectedGeneration({ ...proof, rejection: { ...proof.rejection, httpStatus: 503 } }));
  await owner.retainInspected();
  assert.equal((await owner.sourceStatus('archived')).admissible, false);
  assert.equal((await owner.sourceStatus('new')).admissible, true);
  await assert.rejects(owner.reserveShared(kind, { sourceId: pin.sourceId, operationFingerprint: pin.operationFingerprint,
    stageKey: 'review', assertLease: async () => {} }, 4096));
  const settle = await owner.reserve('embedding', 'new', 0);
  await settle(100, 0);
  const final = await owner.status();
  assert.deepEqual([final?.held, final?.spent, final?.attempts, final?.settled], [0, 15, 2, 2]);
  const entry = (await collection.get()).docs.find(doc => doc.id === pin.ticketId)!.data();
  assert.equal(entry.stageHash, undefined);
  assert.equal(entry.inputTokens, undefined);
  assert.equal(entry.cost, 0);
});

test('only the original settled 504 grants the selected chapter a metered stage on its original operation', async () => {
  const {database} = firestoreDomainFixture();
  const web = commissionedWebOriginal('fhs-14851')!;
  const pin = {sourceId:web.sourceId, operationFingerprint:web.operationFingerprint,
    ticketId:web.ticketId, kind:'generation' as const, at:'2026-11-20T00:03:11.096Z', ceiling:1603584};
  const ordinary = createKnowledgeCampaignBudget(database, 'test', [pin]);
  const selected = createKnowledgeCampaignBudget(database, 'test', [pin], web);
  await createKnowledgeCampaignBudget(database, 'test').initialize();
  const root = database.collection('test_knowledge_campaigns').doc('fhs-child-initial-20261120');
  const ticket = root.collection('attempts').doc(pin.ticketId);
  const binding = {sourceId:pin.sourceId, operationFingerprint:pin.operationFingerprint, stageKey:'independent-review', assertLease:async () => {}};
  await database.runTransaction(async tx => {
    tx.update(root, {held:pin.ceiling, attempts:1});
    const {ticketId:_, ...row} = pin;
    tx.create(ticket, {...row, state:'reserved'});
  });
  await assert.rejects(selected.reserveShared('generation', binding, 4096));
  const {kind:_, ...proof} = pin;
  await ordinary.settleRejectedGeneration({...proof, rejection:{httpStatus:504, evidenceSha256:web.rejectionHash}});
  assert.equal((await ordinary.sourceStatus(pin.sourceId)).admissible, false);
  assert.equal((await selected.sourceStatus(pin.sourceId)).admissible, true);
  await assert.rejects(selected.reserveShared('generation', {...binding, operationFingerprint:'f'.repeat(64)}, 4096));
  const settle = await selected.reserveShared('generation', binding, 4096);
  assert.equal((await selected.sourceStatus(pin.sourceId)).admissible, false);
  await settle(100, 40);
  await assert.rejects(selected.reserveShared('generation', binding, 4096), /attempt_recorded/);
  assert.deepEqual([(await selected.status())?.attempts, (await selected.status())?.settled], [2,2]);
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
