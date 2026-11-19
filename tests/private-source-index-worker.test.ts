import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreRegisteredSourceCards } from '../server/firestore-registered-source-cards.ts';
import { createFirestoreSourceCardDocuments } from '../server/firestore-source-card-documents.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { createPrivateSourceServices } from '../server/private-source-services.ts';
import { extractKnowledgePdf } from '../server/knowledge-pdf.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';

test('an independently rejected image stays held; a later approved original is searchable and can be reopened without another call',async t=>{
  const fake = firestoreDomainFixture(), owner = 'synthetic-owner', cardId = randomUUID(), generation = randomUUID();
  const domain = { database:fake.database,projectId:'demo-private-index',namespace:'private_index',cipher:createStorageCipher(Buffer.alloc(32,54)) };
  const authority = createFirestoreAuthority(domain);
  const email = 'private-index@example.test';
  await authority.initializeControl({enabled:true,generation});
  await authority.issueInvitation({email,operationId:randomUUID(),expiresAt:new Date(Date.now()+86400000).toISOString()});
  await authority.admitIdentity({userId:owner,email,emailVerified:true});
  await authority.acknowledge({userId:owner,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const cards = createFirestoreRegisteredSourceCards({...domain,authority}), url = 'https://publisher.example.org/handout.png';
  await cards.command(owner,{action:'create',cardId,operationId:randomUUID(),expectedRevision:0,
    settings:{url,kind:'document',name:'Class handout',frequencyMinutes:10080}});
  const documents = createFirestoreSourceCardDocuments(domain,cards);
  let approve = false, generations = 0, embeddings = 0;
  const routing = createFirestoreModelRouting(domain,readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:'synthetic-project'}),
    () => assert.fail('private source used platform funding'), ()=>({
    model:{async generate(){throw Error('unexpected text route');}},
    agent:{async generate(request){
      const parts = request.contents[0]!.parts!, data = Buffer.from(parts[1]!.inlineData!.data!,'base64');
      const pdf = await extractKnowledgePdf(data);
      assert.equal(pdf.totalPages,1); assert.equal(pdf.pages[0]?.text,'');
      const {role} = JSON.parse(parts[0]!.text!);
      const result = role === 'review' ? {supported:[approve]} : {facts:[{type:'visual_description',text:'A red panel.'}]};
      generations++; return {content:{role:'model',parts:[{text:JSON.stringify(result)}]},finishReason:'STOP' as never};
    }},
    embedding:{async embed(){embeddings++;return {values:[1,...Array<number>(1023).fill(0)],inputTokens:3,billableCharacters:8};}}
  }));
  const make = () => createPrivateSourceServices(domain,documents,routing,async uid=>({userId:uid,emailVerified:uid===owner,disabled:false}));
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  async function ingest(background:string) {
    const job = await cards.claim((await cards.due())[0]!); assert.ok(job);
    const bytes = await sharp({create:{background,width:1300,height:80,channels:3}}).png().toBuffer();
    const version = createHash('sha256').update(bytes).digest('hex');
    const result = await documents.ingest(job,[{url,mimeType:'image/png',bytes,sha256:version}],new AbortController().signal);
    await cards.finish(job,result.result);
    return (await documents.list(owner,cardId)).items[0]!;
  }
  async function deliver() {
    const deliveries:FirestoreBackgroundDelivery[]=[];
    const queue = createFirestoreBackgroundQueue({...domain,enabled:true,readControl:tx=>authority.readControl(tx),
      transport:{async enqueue(d){deliveries.push(d); return {state:'confirmed'};},async probe(){throw Error('unexpected probe');}},
      execute:(job,signal)=>make().process(job,signal)});
    await queue.dispatch();assert.equal(deliveries.length,1);
    const request=deliveries[0]!; t.mock.timers.tick(Math.max(0,Date.parse(request.scheduledAt)-Date.now()));
    return (await queue.process(request)).state;
  }
  async function finish() {
    for (let i=0;i<5;i++) {
      const state=await deliver(); if (state==='completed') return;
      assert.equal(state,'pending');
    }
    assert.fail('Index work did not settle');
  }
  const first = await ingest('#ddeeff');
  assert.equal(await deliver(),'pending');
  assert.equal((await make().privateIndexStatus(owner,cardId,first.documentId)).issue,'personal_source_key_required');
  assert.deepEqual([generations,embeddings],[0,0]);
  await routing.settings.save(owner,{opId:randomUUID(),expectedVersion:0,mode:'personal',provider:'gemini',
    apiKey:'synthetic-personal-key-not-a-credential',model:'gemini-2.5-flash',dailyLimit:100,
    maxModelCalls:4,maxQueryEmbeddings:2,consent:true,backgroundEnabled:true});
  await finish();
  const held = await make().privateIndexStatus(owner,cardId,first.documentId);
  assert.equal(held.held,1);assert.equal(held.ready,0);assert.equal(embeddings,0);
  const query = {operationId:randomUUID()};
  assert.equal((await make().searchPrivate(owner,cardId,'Colour of panel',query)).items.length,0);
  await assert.rejects(make().readPrivateEvidence(owner,cardId,first.documentId,first.version,null,0));
  await cards.command(owner,{action:'check_now',cardId,operationId:randomUUID(),expectedRevision:(await cards.get(owner,cardId))!.revision});
  approve = true;
  const second = await ingest('#ee1122');
  await finish();
  const found = (await make().searchPrivate(owner,cardId,'Colour of panel',query)).items[0]!;
  assert.equal(found.source.version,second.version);assert.equal(found.page,null);assert.equal(found.offset,0);
  const reopened = await make().readPrivateEvidence(owner,cardId,second.documentId,second.version,null,0,found.incarnation);
  assert.deepEqual(reopened.facts,found.facts); assert.deepEqual([generations,embeddings],[4,2]);
  const codec = createFirestoreRestoreCodec(domain);
  const rows = [...fake.records].filter(([path])=>path.includes('_source_card_documents/')).map(([path,data])=>codec.decode({path,data}));
  const unit = rows.find(row=>row.context.kind==='private-source-index' && 'kind' in row.value && row.value.kind==='unit');
  assert.ok(unit); assert.ok(rows.some(row=>row.context.kind==='private-source-query'));
});
