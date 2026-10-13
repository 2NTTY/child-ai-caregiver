import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {FinishReason} from '@google/genai';
import {firestoreDomainFixture} from './helpers/firestore-domain-memory.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {createFirestoreAuthority} from '../server/firestore-authority.ts';
import {createFirestoreChatStore} from '../server/firestore-chat.ts';
import {createFirestoreCareStore} from '../server/firestore-care.ts';
import {createFirestoreMemoryStore} from '../server/firestore-memory.ts';
import {createFirestoreOnlineStore} from '../server/firestore-online.ts';
import {createFirestoreFamilyDocumentStore} from '../server/firestore-family-documents.ts';
import {createFirestoreProductAgent} from '../server/firestore-product-agent.ts';
import {createFirestoreAccountExport} from '../server/firestore-account-export.ts';
import {FirestoreDomainData} from '../server/firestore-domain-data.ts';
import {firestorePushDeliverySchema} from '../server/firestore-web-push.ts';
import {firestoreTelegramDeliverySchema} from '../server/firestore-telegram.ts';
import {firestoreContactRequestSchema} from '../server/firestore-contact.ts';
import {createFirebaseRequestHandler} from '../server/firebase-app.ts';
import {createAccountApi} from '../src/client/account-api.ts';
import type {FirebaseAuthPort} from '../server/firebase-auth.ts';
import {notificationHistoryItem} from '../frontend/src/history-view-model.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {SERVICE_POLICY_VERSION} from '../src/shared/account-service.ts';

async function fixture(){
  const fake=firestoreDomainFixture(),options={database:fake.database,projectId:'synthetic-results',namespace:'unit_results',cipher:createStorageCipher(Buffer.alloc(32,83))};
  const authority=createFirestoreAuthority(options),generation=randomUUID();await authority.initializeControl({generation,enabled:true});
  const children:string[]=[];
  for(const owner of ['owner','peer']){const email=owner+'@example.test';await authority.issueInvitation({email,operationId:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()});
    await authority.admitIdentity({userId:owner,email,emailVerified:true});await authority.acknowledge({userId:owner,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
    children.push((await authority.createChild({userId:owner,displayName:'合成孩子',operationId:randomUUID()})).child.id);}
  return {options,authority,generation,children};
}
test('building report commits through production Agent and reads back as the same pending document',async()=>{
  const {options,children}=await fixture(),childId=children[0];
  const chat=createFirestoreChatStore(options),care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const online=createFirestoreOnlineStore({...options,mutations:[chat.mutation,care.mutation,memory.mutation]}),documents=createFirestoreFamilyDocumentStore(options);
  const message=await chat.createUserMessageForUser('owner',childId,'請製作今年的成長報告。');let calls=0;
  const product=await createFirestoreProductAgent({...options,chat,care,memory,online,documents,config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId}),
    platformProvider:{async generate(){calls++;assert.ok(calls<=3);
      const name=calls===1?'load_capabilities':calls===2?'generate_family_document':'present_answer';
      const args=calls===1?{capabilities:['document_create']}:calls===2?{sourceQuote:message!.text,kind:'growth_report',purpose:'family',eventDate:null,
        period:{from:'2026-01-01',to:'2026-12-31'}}:{kind:'operation',paragraphs:[{text:'已提交報告整理。',citationIds:[]}]};
      return {content:{role:'model',parts:[{functionCall:{id:'step-'+calls,name,args}}]},finishReason:FinishReason.STOP,usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
    }}});
  const answer=await product.agent.reply('owner',childId,message!.id,async()=>true);
  assert.equal(answer?.status,'completed',JSON.stringify(answer));assert.equal(answer?.stopReason,null);assert.match(answer!.text,/仍在整理中/u);
  const receipt=answer!.tools.find(t=>t.name==='generate_family_document');assert.equal(receipt?.status,'succeeded');assert.ok(receipt?.reference);
  const same=await createFirestoreFamilyDocumentStore(options).get('owner',childId,receipt!.reference!);
  assert.equal(same?.id,receipt!.reference);assert.equal(same?.report?.phase,'building');assert.equal(same?.current,null);
  const persisted=await product.store.get('owner',childId,answer!.runId);assert.equal(persisted?.stopReason,null);
  assert.equal(persisted?.tools.find(t=>t.name==='generate_family_document')?.reference,same?.id);
});

test('notification metadata crosses the existing API and owner projection with merged cursors and account isolation',async()=>{
  const {options,authority,generation,children}=await fixture(),data=new FirestoreDomainData(options),now=new Date().toISOString();
  for(const owner of ['owner','peer'])await authority.runTransaction(owner,null,async b=>{
    for(let i=0;i<(owner==='owner'?10:1);i++){
      const telegram=i%2===1,id=randomUUID(),kind=telegram?'telegram-delivery':'push-delivery',suffix=telegram?'telegram_deliveries':'push_deliveries';
      const delivery={id,bindingId:randomUUID(),status:'accepted',reason:null,providerStatus:201,createdAt:new Date(Date.now()-i*1000).toISOString(),attemptedAt:now,finishedAt:now,
        ...(telegram?{messageId:1,acknowledgedAt:now}:{})};
      const value={delivery,bindingVersion:1,generation,authorizationVersion:b.authorizationVersion,attempt:randomUUID(),...(telegram?{botId:'synthetic',callback:null}:{})};
      b.transaction.create(data.ref(suffix,kind,id),{...data.tags(b.scope),deliveryId:id,createdAt:delivery.createdAt,...data.seal(kind,id,b.scope,telegram?firestoreTelegramDeliverySchema:firestorePushDeliverySchema as any,value as any)});
    }
  });
  await authority.runTransaction('owner',children[0],async b=>{
    for(const delivered of [true,false]){const id=randomUUID(),taskId=randomUUID();
      const value={request:{id,taskId,taskVersion:1,occurrenceId:randomUUID(),phase:'initial',state:delivered?'accepted':'pending',reason:null,nextAt:now,groupedTo:null,createdAt:now,
        attempts:delivered?[{id:randomUUID(),recipientUserId:'owner',channel:'telegram',grantVersion:1,taskVersion:1,status:'accepted',reason:null,providerStatus:200,messageId:1,attemptedAt:now,finishedAt:now,acknowledgedAt:now}]:[]},
        grant:{value:{taskId,version:1,taskVersion:1,enabled:true,primaryUserId:'owner',backupUserId:null,allowFollowUp:false,allowFallback:false,validUntil:now,
          authorizedBy:'owner',content:'generic_notice',trigger:'task_due',updatedAt:now},authorityVersion:b.authorizationVersion,consentVersion:1,bindings:[]},
        generation,authorizationVersion:b.authorizationVersion,runId:randomUUID(),reminderId:id,batchId:randomUUID(),callbackHash:null};
      b.transaction.create(data.ref('contact_requests','contact-request',id),{...data.tags(b.scope),requestId:id,createdAt:now,...data.seal('contact-request',id,b.scope,firestoreContactRequestSchema,value as any)});
    }
  });
  const exporter=createFirestoreAccountExport({...options,photos:{async content(){throw Error('No photo reads');}}});let active='owner';
  const auth={async handler(){return new Response('',{status:404});},async getSession(){return {user:{id:active},session:{id:'synthetic'}};}} as unknown as FirebaseAuthPort;
  const handler=createFirebaseRequestHandler({authority,auth,accountData:{exporter,erasures:{} as any},publicOrigin:'https://example.test',mailConfigured:false});
  const client=createAccountApi('https://example.test',(async(url,init)=>handler(new Request(String(url),init))) as typeof fetch),signal=new AbortController().signal;
  const first=await client.exportPage('owner',{section:'notification_deliveries'},signal);assert.ok(first.nextCursor);assert.equal(first.complete,false);
  const second=await client.exportPage('owner',{section:'notification_deliveries',scopeVersion:first.scopeVersion,cursor:first.nextCursor!},signal);assert.equal(second.complete,true);
  const items=[...first.items,...second.items].map(notificationHistoryItem);assert.equal(items.length,11);assert.equal(new Set(items.map(v=>v.id)).size,11);
  assert.equal(items.filter(v=>v.contact).length,1);assert.equal(items.some(v=>v.channel==='mail'),false);assert.equal(items.filter(v=>v.acknowledgedAt).length,6);
  assert.equal(JSON.stringify([...first.items,...second.items]).includes('bindingId'),false);
  active='peer';client.setIdentity('peer');await assert.rejects(client.exportPage('peer',{section:'notification_deliveries',scopeVersion:first.scopeVersion,cursor:first.nextCursor!},signal));
  assert.equal((await client.exportPage('peer',{section:'notification_deliveries'},signal)).items.length,1);
});
