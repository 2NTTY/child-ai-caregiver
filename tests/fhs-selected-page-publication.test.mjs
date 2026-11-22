import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolveObjectURL } from 'node:buffer';
import React from 'react';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { campaignMaterialWatches, platformMaterials } from '../server/platform-materials.ts';
import { knowledgeReviewHash, knowledgeOperationId } from '../server/knowledge-review-assessment.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { campaign, campaignCredentials, createKnowledgeCampaignBudget } from '../server/knowledge-campaign-budget.ts';
import { extractKnowledgePdf } from '../server/knowledge-pdf.ts';
import { observeKnowledgeLeaflet } from '../server/knowledge-source-fetch.ts';
import { readAiConfig } from '../server/ai-config.ts';

const lanes = JSON.parse(fs.readFileSync(new URL('../knowledge/fhs-initial-publication-lanes.json', import.meta.url), 'utf8'));
const { sourceId: id } = lanes.lanes.find(lane => lane.id === 'C1').sources.find(source => source.pages === 8);
const definition = campaignMaterialWatches.find(row => row.id === id);
const scope = {physicalPage:5,question:'Which room and materials are listed for the workshop?',
  fields:[{key:'room',label:'Room'},{key:'materials',label:'Materials'}]};
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');

test('commissioned first page passes the lane, two readings, gross ledger, family citation and duplicate run', async t => {
  const facts = {room:'Amber Hall',materials:'Blue card and a pencil'};
  const bytes = await renderToBuffer(React.createElement(Document,{},...Array.from({length:8},(_,i)=>
    React.createElement(Page,{key:i},React.createElement(Text,{},i === 4 ? Object.values(facts).join(' / ') : 'Another physical page ' + (i+1))))));
  const hash = checksum(bytes);
  const revision = randomUUID(), generation = randomUUID();
  const original = knowledgeReviewHash([campaignCredentials,id,revision,generation]);
  const signal=new AbortController().signal;
  const fetched=await observeKnowledgeLeaflet(definition,bytes,'Workshop guide',null,'catalogue-pdf-original/1',signal);
  assert.equal(fetched.status,'ok');
  const [observed]=fetched.items;
  assert.equal(observed.extraction.totalPages,8);
  const observation = observationHash(observed);
  const commitment = knowledgeReviewHash(['fhs-first-print-page/1','C1',id,hash,8,original,observation,scope]);
  // Load an isolated operator registry for this process and this randomly generated original only.
  const read = fs.readFileSync;
  const registry = t.mock.method(fs,'readFileSync',function(path,...args) {
    if (path instanceof URL && path.pathname.endsWith('/fhs-undispatched-originals.json'))
      return JSON.stringify({[id]:{scope,commitment}});
    if (path instanceof URL && path.pathname.endsWith('/fhs-initial-publication-lanes.json')) {
      const manifest = JSON.parse(read(path,...args));
      manifest.lanes.find(l=>l.id==='C1').sources.find(s=>s.sourceId===id).sha256=hash;
      return JSON.stringify(manifest);
    }
    return read(path,...args);
  });
  syncBuiltinESMExports();
  const {manualPublicationPin} = await import('../server/fhs-manual-publication.ts');
  const {bindFirstDispatch,firstDispatchWorkId,registeredPrintPage,isUndispatchedParent} = await import('../server/fhs-undispatched-original.ts');
  registry.mock.restore();
  syncBuiltinESMExports();
  const {avatarMemoryBucket} = await import('./helpers/avatar-memory.ts');
  const {createFirestoreKnowledgeMaintenance} = await import('../server/firestore-knowledge-maintenance.ts');
  const {createFirestoreKnowledgeRefresh} = await import('../server/firestore-knowledge-refresh.ts');
  const {createFirestoreKnowledgeStore} = await import('../server/firestore-knowledge.ts');
  const {createFirestoreKnowledgeWork} = await import('../server/firestore-knowledge-work.ts');
  const {createLaneOperations} = await import('../scripts/fhs-lane-operations.mjs');
  const {runPublicationLane} = await import('../scripts/fhs-publication-lanes.mjs');
  const {readFhsDelivery,confirmOriginalGenerations} = await import('../scripts/fhs-publication-receipt.mjs');
  const {database,records} = firestoreDomainFixture(), projectId='demo-selected-page', namespace='selected';
  const domain = {database,projectId,namespace,cipher:createStorageCipher(randomBytes(32))};
  const bucketName=projectId+'-private', readControl=async()=>({enabled:true,generation});
  const originalBucket={bucketName,bucket:avatarMemoryBucket(bucketName).port};
  const refresh=createFirestoreKnowledgeRefresh({...domain,readControl,definitions:[definition],originalBucket});
  const knowledge=createFirestoreKnowledgeStore({...domain,sourceIds:[id],platformMaterials,observations:refresh.gate});
  const work=createFirestoreKnowledgeWork({...domain,readControl});
  const gate=createKnowledgeCampaignBudget(database,namespace);
  await gate.initialize();
  await refresh.register(id,'synthetic-operator',true);
  records.get(namespace+'_knowledge_watches/'+id).revision=revision;
  const [job]=await refresh.jobs(id);
  const checkId=knowledgeOperationId('knowledge-observation/1',original);
  await refresh.process(job.data,checkId,async()=>fetched,signal);
  const pin=manualPublicationPin(id), source={sourceId:id,pages:8,sha256:hash,url:definition.url,bytes:bytes.byteLength};
  const ledger=database.collection(namespace+'_knowledge_campaigns').doc(campaign);
  const binding={sourceId:id,pages:8,sha256:hash,lane:'C1',operationFingerprint:original,revision,workerGeneration:generation};
  await database.runTransaction(async tx=>tx.create(ledger.collection('publicationBindings').doc(id),binding));
  const request={watchId:id,workerGeneration:generation,publishMode:'live',operationFingerprint:original};
  const token=randomUUID(), parent=await work.bind(request,token,'a'.repeat(64),{modelCalls:2,deadlineMs:150000});
  await parent.ports.claimOperation(original,token,Date.now()+120000);
  await parent.completeText({system:'original',user:'fixture',attemptKey:'prior'},async()=> 'unavailable');
  await parent.ports.saveResult(original,{status:'candidate_held',code:'unavailable',watchId:id,observationHash:observation,published:false});
  await parent.ports.releaseOperation(original,token);
  const untouched=await work.inspect(request), grant=bindFirstDispatch(pin,original,untouched,5);
  assert.equal(pin.sha256,hash,'The synthetic manifest must be loaded before the pinned edition');
  assert.deepEqual(registeredPrintPage(id),scope);
  assert.ok(isUndispatchedParent(untouched,request,observation));
  assert.deepEqual(grant?.scope,scope);
  for (const other of [undefined,4,9]) assert.equal(bindFirstDispatch(pin,original,untouched,other),undefined);
  assert.equal(bindFirstDispatch(pin,original,{...untouched,result:{...untouched.result,code:'knowledge_window_review_held'}},5),undefined);
  const child=firstDispatchWorkId(original), derived={...request,operationFingerprint:child};
  const unexpected=()=>{throw Error('Unexpected source fetch or cloud provider');};
  const persistence={...domain,config:{...domain,photoBucket:bucketName,knowledgeSourceIds:[id]},authority:{readControl}};
  const lane=createLaneOperations(persistence,unexpected,'C1',5);
  assert.equal((await lane.inspect(source)).state,'ready');
  await assert.rejects(()=>createLaneOperations(persistence,unexpected,'C1',6).inspect(source),/not_commissioned/);
  const attempts=ledger.collection('attempts'), pending=attempts.doc(randomUUID());
  await database.runTransaction(async tx=>tx.create(pending,{kind:'generation',sourceId:id,state:'reserved',operationFingerprint:original}));
  assert.equal((await lane.inspect(source)).state,'reconciliation_required');
  await assert.rejects(()=>work.bind(derived,randomUUID(),'b'.repeat(64),{modelCalls:2,deadlineMs:120000},undefined,undefined,undefined,
    {...grant,verify:async()=>{}}),/first_dispatch_binding/);
  assert.equal(await work.inspect(derived),null);
  await database.runTransaction(async tx=>tx.delete(pending));

  const config=readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:projectId,AI_BACKGROUND_KNOWLEDGE_MAINTENANCE_ENABLED:'true',
    AI_BACKGROUND_KNOWLEDGE_LIVE_FETCH:'true',AI_BACKGROUND_KNOWLEDGE_LIVE_PUBLISH:'true'});
  const calls=[], checks=Object.fromEntries(['age','numbersAndUnits','timing','conditions','exceptions','prohibitions','withdrawal'].map(k=>[k,'Checked']));
  let embeddings=0;
  const providers=()=>({agent:{async generate(request) {
    const [instruction,part]=request.contents[0].parts, input=JSON.parse(instruction.text), slice=Buffer.from(part.inlineData.data,'base64');
    assert.deepEqual(input.readScope,{parentHash:hash,sliceHash:checksum(slice),firstPhysicalPage:5,lastPhysicalPage:5,firstCorePage:5,lastCorePage:5});
    assert.equal((await extractKnowledgePdf(slice,{startPage:1,pageLimit:1})).totalPages,1);
    assert.equal(part.mediaResolution.level,'MEDIA_RESOLUTION_HIGH');
    assert.ok(Object.values(facts).every(value=>!instruction.text.includes(value)));
    calls.push(checksum(slice));
    const output={decision:'approve',finding:'The chart identifies all requested fields.',facts,...(calls.length===2?{checks}:{})};
    return {content:{role:'model',parts:[{text:JSON.stringify(output)}]},finishReason:'STOP',
      usageMetadata:{promptTokenCount:50,candidatesTokenCount:50,totalTokenCount:100}};
  }},embedding:{async embed(){embeddings++;return {values:[1,...Array(1023).fill(0)],inputTokens:10,billableCharacters:30};}}});
  const settings={...domain,readControl,config,refresh,knowledge,fetch:unexpected,providers,
    campaignBudget:gate,manualPublication:pin,firstDispatch:grant,explicitAgeScope:true,credentialBinding:campaignCredentials};
  const runner=createFirestoreKnowledgeMaintenance(settings);
  const changedScope={...scope,question:'A different question about the same page'};
  const uncommissioned=createFirestoreKnowledgeMaintenance({...settings,firstDispatch:{...grant,scope:changedScope}});
  await assert.rejects(uncommissioned.start(derived,signal,revision,checkId),/knowledge_campaign_operation_changed/);
  assert.equal(await work.inspect(derived),null);
  await t.test('lost provider output retains its original reservation on restart',async()=>{
    const shadow=firestoreDomainFixture();
    for (const [path,value] of records) shadow.records.set(path,structuredClone(value));
    const isolated={...domain,database:shadow.database};
    const refresh=createFirestoreKnowledgeRefresh({...isolated,readControl,definitions:[definition],originalBucket});
    const knowledge=createFirestoreKnowledgeStore({...isolated,sourceIds:[id],platformMaterials,observations:refresh.gate});
    const campaignBudget=createKnowledgeCampaignBudget(shadow.database,namespace);
    let sends=0;
    const lost=createFirestoreKnowledgeMaintenance({...isolated,readControl,config,refresh,knowledge,fetch:unexpected,
      providers:()=>({agent:{async generate(){sends++;throw Error('Synthetic lost provider response');}},embedding:{embed:unexpected}}),
      campaignBudget,manualPublication:pin,firstDispatch:grant,explicitAgeScope:true,credentialBinding:campaignCredentials});
    const stopped=await lost.start(derived,signal,revision,checkId);
    assert.equal(stopped.published,false);
    const balance=await campaignBudget.status();
    assert.ok(balance.held>0);
    assert.deepEqual([sends,balance.attempts,balance.settled],[1,1,0]);
    const lane=createLaneOperations({...persistence,database:shadow.database},unexpected,'C1',5);
    assert.equal((await lane.inspect(source)).code,'fhs_lane_dispatch_reserved');
    assert.equal(await runPublicationLane([source],'run',{...lane,report(){},dispatch:unexpected}),2);
    assert.deepEqual(await campaignBudget.status(),balance);
    assert.equal(await knowledge.publishedEdition(id),null);
  });
  const port={...lane,prepare:unexpected,report(){},async dispatch(_source,op,started) {
    assert.equal(op,original);assert.equal(started,true);
    const result=await runner.start(derived,signal,revision,checkId);
    assert.equal(result.published,true,JSON.stringify(result));
    return 0;
  }};
  assert.equal(await runPublicationLane([source],'run',port),0);
  const charged=await gate.status();
  assert.deepEqual([calls.length,new Set(calls).size,embeddings,charged.attempts,charged.settled,charged.held],[2,1,1,3,3,0]);
  assert.ok(charged.spent>0);
  assert.equal(await runPublicationLane([source],'run',{...port,dispatch:unexpected}),0);
  assert.deepEqual(await gate.status(),charged);
  assert.deepEqual(await work.inspect(request),untouched);
  const ports={originalOperation:original,pin:source,inspect:op=>work.inspect({...request,operationFingerprint:op}),
    verifyRepair:async(a,b)=>a===original&&b===child,active:()=>knowledge.publishedEdition(id),
    confirmOriginalGenerations:(sourceId,op,stages)=>confirmOriginalGenerations({doc:key=>attempts.doc(key),
      firestore:{getAll:(...refs)=>database.runTransaction(tx=>tx.getAll(...refs))}},sourceId,op,stages),
    familyCard:(url)=>database.runTransaction(async tx=>(await knowledge.platformCards(tx,randomUUID(),undefined,url)).cards.find(c=>c.sourceId===id)),
    exportEdition:(...args)=>knowledge.exportPublishedEdition(...args),resolve:citation=>knowledge.citedPdf(citation),
    readOriginal:(sourceId,sha)=>refresh.originals.readPdf(sourceId,sha),extract:extractKnowledgePdf};
  const selection={sourceId:id,originalOperation:original,deliveryOperation:child};
  const receipt=await readFhsDelivery(selection,ports);
  assert.equal(receipt.readback,'verified');
  assert.deepEqual(receipt.pdf.recordedWindowReadings.map(w=>w.physicalPages),[[5]]);
  assert.deepEqual(receipt.pdf.pages.map(p=>[p.page,p.proof]),[[5,'reviewed_visual_page']]);
  assert.equal(receipt.vectors.exported,1);
  assert.equal((await readFhsDelivery(selection,{...ports,confirmOriginalGenerations:async()=>false})).readback,'citation_incomplete');
  await import('./helpers/frontend-source-loader.mjs');
  const {projectAgentCitation}=await import('../frontend/src/production/agent-projection.ts');
  const {openCitationPdf}=await import('../frontend/src/platform/file-export.ts');
  const {readCitationPdf}=await import('../src/client/citation-original.ts');
  const active=await ports.active(), identity=active.chunkIdentities[0];
  const evidence={...active.source,...active.source.chunks[0],...identity,versionId:active.versionId,versionHash:active.versionHash};
  const citation=projectAgentCitation(evidence);
  assert.match(citation.excerpt,/Materials：Blue card and a pencil/u);
  assert.equal(citation.savedPdf,true);
  const childId=randomUUID(),runId=randomUUID(),userId=randomUUID(),current=()=>true;
  const load=()=>readCitationPdf({apiBaseUrl:'https://fixture.invalid',childId,runId,userId,chunkId:identity.chunkId,current,
    async fetcher(url,init) {
      assert.equal(new URL(url).pathname,'/api/children/'+childId+'/agent/runs/'+runId+'/citations/'+identity.chunkId+'/original');
      assert.equal(init.headers['x-expected-user-id'],userId);
      const resolved=await knowledge.citedPdf(evidence);
      const originalBytes=await refresh.originals.readPdf(resolved.sourceId,resolved.sha256);
      return new Response(originalBytes,{headers:{'content-type':'application/pdf','content-length':String(originalBytes.length)}});
    }});
  let destination;
  globalThis.window={open:()=>({location:{replace:url=>{destination=new URL(url);}}})};
  t.after(()=>{delete globalThis.window;});
  t.mock.timers.enable({apis:['setTimeout']});
  await openCitationPdf(load,citation.excerptPage ?? citation.pageStart,current);
  assert.equal(destination.hash,'#page=5');
  destination.hash='';
  const opened=resolveObjectURL(destination.href);
  assert.equal(checksum(Buffer.from(await opened.arrayBuffer())),hash);
  URL.revokeObjectURL(destination.href);
});
