import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFirestoreAuthority} from '../../server/firestore-authority.ts';
import {createFirestoreChatStore} from '../../server/firestore-chat.ts';
import {createFirestoreCareStore} from '../../server/firestore-care.ts';
import {createFirestoreMemoryStore} from '../../server/firestore-memory.ts';
import {createFirestoreOnlineStore} from '../../server/firestore-online.ts';
import {createFirestoreProductAgent} from '../../server/firestore-product-agent.ts';
import {SERVICE_POLICY_VERSION} from '../../src/shared/account-service.ts';

export async function askAboutChart({domain,knowledge,config,active,identity,knowledgeOriginal}) {
  const {database}=domain, userId='synthetic-chart-parent', email='chart@example.test';
  const authority=createFirestoreAuthority(domain);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  await authority.issueInvitation({email,expiresAt:new Date(Date.now()+90000).toISOString(),operationId:randomUUID()});
  await authority.admitIdentity({userId,email,emailVerified:true});
  await authority.acknowledge({userId,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const {scope:{childId,workspaceId}}=await authority.createChild({userId,operationId:randomUUID(),displayName:'Synthetic'});
  const chat=createFirestoreChatStore(domain),care=createFirestoreCareStore(domain);
  const memory=createFirestoreMemoryStore({...domain,chat,care});
  const online=createFirestoreOnlineStore({...domain,mutations:[chat.mutation,care.mutation,memory.mutation]});
  const question='表格要幾張貼紙才可以去公園？',query='表格 去公園 貼紙';
  const filter={classification:'official_guidance',region:'HK',topics:[],age:null,purpose:'read_originals'};
  const search=()=>knowledge.candidates(filter,null,{query,libraryUserId:userId});
  assert.deepEqual(await search(),[]);
  async function myCard(tx) {
    const {cards}=await knowledge.platformCards(tx,userId,undefined,active.source.url);
    const card=cards.find(c=>c.sourceId===active.source.sourceId);
    assert.ok(card);return card;
  }
  await database.runTransaction(async tx=>knowledge.joinListedPlatformCard(tx,userId,await myCard(tx)));
  assert.deepEqual((await search()).map(c=>c.chunkId),[identity.chunkId]);
  assert.deepEqual(await knowledge.candidates({...filter,purpose:undefined},null,{query,libraryUserId:userId}),[]);
  const replyParts=parts=>({content:{role:'model',parts},finishReason:'STOP',
    usageMetadata:{promptTokenCount:30,candidatesTokenCount:15,totalTokenCount:45}});
  const tool=(name,args)=>replyParts([{functionCall:{id:randomUUID(),name,args}}]);
  let reviewCount=0,rejection,comparing=false;
  const comparisonQuestion='照這張表，去公園和去博物館分別要幾多張貼紙？相差幾多張？';
  const expectedText='去公園只需儲夠 6 張貼紙。';
  const agent={async generate(request) {
    const parts=request.contents.flatMap(c=>c.parts??[]), responses=parts.flatMap(p=>p.functionResponse?[p.functionResponse]:[]);
    const review=parts.find(p=>p.text?.startsWith('Server evidence payload for chat-delivery-review.'));
    if(review) {
      const payload=JSON.parse(review.text.slice(review.text.indexOf('\n')+1));
      assert.equal(payload.userRequest,comparing ? comparisonQuestion : question);
      assert.equal(payload.sources.length,1);
      assert.partialDeepStrictEqual(payload.sources[0],{citationId:identity.chunkId,version:active.versionId,contentHash:identity.contentHash});
      const excerpt=payload.sources[0].excerpt;
      const park=/^去公園所需的貼紙張數：(\d+)$/mu.exec(excerpt);
      const museum=/^去博物館所需的貼紙張數：(\d+)$/mu.exec(excerpt);
      assert.ok(park && museum);
      assert.notEqual(park[1],museum[1]);
      const chart=payload.sources[0].chart;
      assert.partialDeepStrictEqual(chart,{sourceId:active.source.sourceId,versionHash:active.versionHash,
        pdfHash:active.source.extraction.contentHash,physicalPage:5,purpose:'original_lookup'});
      assert.equal(payload.paragraphs.length,1);
      const claim=payload.paragraphs[0].text;
      const parkValue=/去公園只需儲夠 (\d+) 張貼紙/u.exec(claim)?.[1];
      assert.equal(parkValue,park[1]);
      const fields=[{index:chart.fields.findIndex(f=>f.label==='去公園所需的貼紙張數'),value:parkValue}];
      if (comparing) {
        const values=/博物館要 (\d+) 張，比公園多 (\d+) 張/u.exec(claim);
        assert.equal(values?.[1],museum[1]);
        assert.equal(Number(values?.[2]),Number(museum[1])-Number(park[1]));
        fields.push({index:chart.fields.findIndex(f=>f.label==='去博物館所需的貼紙張數'),value:values[1]});
      }
      reviewCount++;
      return replyParts([{text:JSON.stringify({draftHash:payload.draftHash,decision:'pass',issues:[],
        chartChecks:[{paragraph:0,citationId:identity.chunkId,fields,passages:[],supported:true}]})}]);
    }
    const last=responses.at(-1);
    if(!last) return tool('find_official_material',{query});
    if(last.response.status!=='succeeded') {rejection=last.response;throw Error('Unexpected chart tool rejection');}
    const result=last.response.data.result;
    if(last.name==='find_official_material') {
      assert.deepEqual(result.chunks.map(c=>c.chunkId),[identity.chunkId]);
      return tool('read_knowledge_context',{anchorChunkId:result.chunks[0].chunkId});
    }
    assert.equal(last.name,'read_knowledge_context');
    const page=result.chunks[0];assert.equal(page.original.text,'');assert.equal(page.excerptPage,5);
    const value=page.reviewedChart.fields.find(f=>f.label.includes('去公園')).value;
    const museum=page.reviewedChart.fields.find(f=>f.label.includes('去博物館')).value;
    const text=`去公園只需儲夠 ${value} 張貼紙。`+(comparing ? `博物館要 ${museum} 張，比公園多 ${Number(museum)-Number(value)} 張。` : '');
    return tool('present_answer',{kind:'public_information',paragraphs:[{text,citationIds:[page.chunkId]}]});
  }};
  const product=await createFirestoreProductAgent({...domain,chat,care,memory,online,knowledge,config,
    platformProviders:()=>({agent,model:{generate:async()=>assert.fail('Unexpected model request')},
      embedding:{embed:async()=>{throw Error('Offline keyword search');}}})});
  let result,stored;
  if (process.env.CHART_PARENT_WEB_DIST) {
    const {askInBrowser}=await import('./selected-page-browser.mjs');
    await askInBrowser({authority,chat,care,memory,online,product,knowledgeOriginal},
      {userId,email,childId,workspaceId,question,expectedText,chunkId:identity.chunkId,pdfHash:active.source.extraction.contentHash});
    const messages=(await chat.listForUser(userId,childId)).messages;
    assert.equal(messages.filter(m=>m.role==='user' && m.text===question).length,1);
    stored=messages.find(m=>m.role==='model' && m.agentRunId);
    assert.ok(stored);
    result=await product.store.get(userId,childId,stored.agentRunId);
  } else {
    const message=await chat.createUserMessageForUser(userId,childId,question);
    result=await product.agent.reply(userId,childId,message.id,async()=>true);
    assert.equal(result?.status,'completed',JSON.stringify({result,rejection}));
    stored=await chat.createModelMessageForUser(userId,childId,message.id,result.text);
  }
  assert.equal(result?.status,'completed',JSON.stringify({result,rejection}));
  assert.equal(reviewCount,1);
  assert.deepEqual(result.tools.map(t=>[t.name,t.status]),[['find_official_material','succeeded'],['read_knowledge_context','succeeded'],['present_answer','succeeded']]);
  assert.equal(result.text,expectedText+' [1]');
  assert.equal(result.deliveryReview.decision,'pass');
  assert.equal(result.retrievalMode,'keyword_degraded');
  const readRun=()=>product.store.get(userId,childId,stored.agentRunId);
  const reply=await readRun();
  assert.partialDeepStrictEqual(reply.citations,[{chunkId:identity.chunkId,versionId:active.versionId,versionHash:active.versionHash,
    excerptPage:5,originalKind:'visual_page',sourceExcerpt:'',applicability:{use:'original_lookup',ageBasis:'unconfirmed'}}]);
  assert.equal(reply.citations[0].citedExcerpt,undefined);
  comparing=true;
  const followup=await chat.createUserMessageForUser(userId,childId,comparisonQuestion);
  const comparison=await product.agent.reply(userId,childId,followup.id,async()=>true);
  assert.equal(comparison?.status,'completed',JSON.stringify({comparison,rejection}));
  assert.equal(comparison.text,'去公園只需儲夠 6 張貼紙。博物館要 9 張，比公園多 3 張。 [1]');
  assert.equal(comparison.deliveryReview?.decision,'pass');
  assert.equal(comparison.citations[0].versionHash,active.versionHash);
  assert.equal(reviewCount,2);
  return {reply,comparison,readRun,userId,childId,async removeDownload() {
    await database.runTransaction(async tx=>{
      const card=await myCard(tx);
      const change=card.childHealth?{action:'manage',operation:'remove',expectedState:card.childHealth.stateHash}:
        {mode:'platform',enabled:true,expectedRevision:card.revision,editions:[{sourceId:card.sourceId,versionId:card.versionId}]};
      return knowledge.saveLibraryPreference(tx,userId,{seriesId:card.seriesId,...change});
    });
    assert.deepEqual(await search(),[]);
  }};
}
