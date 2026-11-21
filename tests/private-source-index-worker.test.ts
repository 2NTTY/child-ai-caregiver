import test, { type TestContext } from 'node:test';
import type { LlmRequest } from '@google/adk';
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
import { inspectSourcePage } from '../server/source-card-page.ts';

async function fixture(t: TestContext, url: string, generate: (request: LlmRequest) => Promise<unknown>) {
  const fake = firestoreDomainFixture(), owner = 'synthetic-owner', cardId = randomUUID(), generation = randomUUID();
  const domain = { database:fake.database,projectId:'demo-private-index',namespace:'private_index',cipher:createStorageCipher(Buffer.alloc(32,54)) };
  const authority = createFirestoreAuthority(domain);
  const email = 'private-index@example.test';
  await authority.initializeControl({enabled:true,generation});
  await authority.issueInvitation({email,operationId:randomUUID(),expiresAt:new Date(Date.now()+86400000).toISOString()});
  await authority.admitIdentity({userId:owner,email,emailVerified:true});
  await authority.acknowledge({userId:owner,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const cards = createFirestoreRegisteredSourceCards({...domain,authority});
  await cards.command(owner,{action:'create',cardId,operationId:randomUUID(),expectedRevision:0,
    settings:{url,kind:'document',name:'Class handout',frequencyMinutes:10080}});
  const documents = createFirestoreSourceCardDocuments(domain,cards);
  const calls = {generations:0,embeddings:0};
  const routing = createFirestoreModelRouting(domain,readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:'synthetic-project'}),
    () => assert.fail('private source used platform funding'), ()=>({
    model:{async generate(){throw Error('unexpected text route');}},
    agent:{async generate(request){
      const result = await generate(request);
      calls.generations++; return {content:{role:'model',parts:[{text:JSON.stringify(result)}]},finishReason:'STOP' as never};
    }},
    embedding:{async embed(){calls.embeddings++;return {values:[1,...Array<number>(1023).fill(0)],inputTokens:3,billableCharacters:8};}}
  }));
  const make = () => createPrivateSourceServices(domain,documents,routing,async uid=>({userId:uid,emailVerified:uid===owner,disabled:false}));
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  async function ingest(bytes:Buffer, mimeType:string, sections:string[] = []) {
    const job = await cards.claim((await cards.due())[0]!); assert.ok(job);
    const version = createHash('sha256').update(bytes).digest('hex');
    const result = await documents.ingest(job,[{url,mimeType,bytes,sha256:version,sections}],new AbortController().signal);
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
  const enable = () => routing.settings.save(owner,{opId:randomUUID(),expectedVersion:0,mode:'personal',provider:'gemini',
    apiKey:'synthetic-personal-key-not-a-credential',model:'gemini-2.5-flash',dailyLimit:100,
    maxModelCalls:4,maxQueryEmbeddings:2,consent:true,backgroundEnabled:true});
  const recheck = async () => cards.command(owner,{action:'check_now',cardId,operationId:randomUUID(),expectedRevision:(await cards.get(owner,cardId))!.revision});
  const codec = createFirestoreRestoreCodec(domain);
  const records = (collection:string) => [...fake.records].filter(([path])=>path.includes('_'+collection+'/')).map(([path,data])=>codec.decode({path,data}));
  return {owner,cardId,documents,make,ingest,deliver,finish,recheck,enable,calls,records};
}

test('an independently rejected image stays held; a later approved original is searchable and can be reopened without another call',async t=>{
  let approve = false;
  const {owner,cardId,make,ingest,deliver,finish,recheck,enable,calls,records} = await fixture(t,'https://publisher.example.org/handout.png',async request=>{
    const parts = request.contents[0]!.parts!, data = Buffer.from(parts[1]!.inlineData!.data!,'base64');
    const pdf = await extractKnowledgePdf(data);
    assert.equal(pdf.totalPages,1); assert.equal(pdf.pages[0]?.text,'');
    return JSON.parse(parts[0]!.text!).role === 'review' ? {supported:[approve]} : {facts:[{type:'visual_description',text:'A red panel.'}]};
  });
  const image = (background: string) => sharp({create:{background,width:1300,height:80,channels:3}}).png().toBuffer();
  const first = await ingest(await image('#ddeeff'),'image/png');
  assert.equal(await deliver(),'pending');
  assert.equal((await make().privateIndexStatus(owner,cardId,first.documentId)).issue,'personal_source_key_required');
  assert.deepEqual(calls,{generations:0,embeddings:0});
  await enable();
  await finish();
  const held = await make().privateIndexStatus(owner,cardId,first.documentId);
  assert.equal(held.held,1);assert.equal(held.ready,0);assert.equal(calls.embeddings,0);
  const query = {operationId:randomUUID()};
  assert.equal((await make().searchPrivate(owner,cardId,'Colour of panel',query)).items.length,0);
  await assert.rejects(make().readPrivateEvidence(owner,cardId,first.documentId,first.version,null,0));
  await recheck();
  approve = true;
  const second = await ingest(await image('#ee1122'),'image/png');
  await finish();
  const found = (await make().searchPrivate(owner,cardId,'Colour of panel',query)).items[0]!;
  assert.equal(found.source.version,second.version);assert.equal(found.page,null);assert.equal(found.offset,0);
  const reopened = await make().readPrivateEvidence(owner,cardId,second.documentId,second.version,null,0,found.incarnation);
  assert.deepEqual(reopened.facts,found.facts); assert.deepEqual(calls,{generations:4,embeddings:2});
  const rows = records('source_card_documents');
  const unit = rows.find(row=>row.context.kind==='private-source-index' && 'kind' in row.value && row.value.kind==='unit');
  assert.ok(unit); assert.ok(rows.some(row=>row.context.kind==='private-source-query'));
});

for (const topicSupported of [false,true]) {
  test('a non-keyword handout retains its quotations across checks with topic review '+topicSupported,async t=>{
    const title = '兩個信封', heading = '先留下車費';
    const paragraph = '把零用錢分入兩個信封。第一個信封留作每天乘車，第二個信封用來儲起買東西的錢。每次拿錢前，先比較餘額和價錢。';
    const originalText = [title,heading,paragraph].join('\n\n'), url = 'https://new-publisher.example.org/handouts/two-envelopes';
    const facts = [{type:'quotation',text:originalText}], topic = {label:'財務管理',evidence:originalText};
    const f = await fixture(t,url,async request=>{
      const parts = request.contents[0]!.parts!;
      assert.equal(parts.length,1);
      const input = JSON.parse(parts[0]!.text!);
      assert.equal(input.title,title); assert.equal(input.originalText,originalText);
      if (input.role === 'organize') {
        assert.equal(input.considerTopic,true); assert.equal(input.proposedTopic,undefined);
        return {facts,topic};
      }
      assert.equal(input.role,'review'); assert.deepEqual(input.candidates,facts); assert.deepEqual(input.proposedTopic,topic);
      return {supported:[true],topicSupported};
    });
    const scan = async (label?:string) => {
      const html = '<article><h1>'+title+'</h1><h2>'+heading+'</h2><p>'+paragraph+'</p>'+
        (label ? '<a rel="category" href="/topics">'+label+'</a>' : '')+'</article>';
      return f.ingest(Buffer.from(html),'text/html',inspectSourcePage(html,url).sections);
    };
    await f.enable();
    const first = await scan(), unclassified = {basis:'unclassified',labels:[]};
    assert.deepEqual(first.categories,unclassified);
    await f.finish();
    const read = async () => (await f.documents.list(f.owner,f.cardId)).items[0]!;
    const expected = topicSupported ? {basis:'document',labels:[topic.label],evidence:topic.evidence} : unclassified;
    assert.deepEqual((await read()).categories,expected);
    const proof = () => f.documents.withIndexHead(f.owner,f.cardId,first.documentId,async (_,h)=>h.rag?.topic);
    const reviewed = await proof();
    if (topicSupported) {
      assert.ok(reviewed); assert.equal(reviewed.label,topic.label); assert.equal(reviewed.evidence,topic.evidence);
      assert.notEqual(reviewed.organizeRunId,reviewed.reviewRunId);
    } else assert.equal(reviewed,undefined);
    assert.equal((await f.make().privateIndexStatus(f.owner,f.cardId,first.documentId)).ready,1);
    for (const label of [undefined,'家長教材','本月選讀',undefined]) {
      await f.recheck();
      const row = await scan(label);
      assert.equal(row.documentId,first.documentId); assert.equal(row.version,first.version);
      assert.deepEqual(row.categories,label ? {basis:'publisher',labels:[label]} : expected);
    }
    const work = f.records('background_work').filter(r=>'kind' in r.value && r.value.kind==='source-card-index');
    assert.equal(work.length,1);
    assert.deepEqual(await proof(),reviewed);
    assert.deepEqual(f.calls,{generations:2,embeddings:1});
    if (topicSupported) {
      await f.recheck();
      const next = await f.ingest(Buffer.from('<article><h1>'+title+'</h1><p>摺起兩角，貼好封口。</p></article>'),'text/html');
      assert.notEqual(next.version,first.version); assert.deepEqual(next.categories,unclassified);
      assert.equal(await proof(),undefined);
    }
  });
}
