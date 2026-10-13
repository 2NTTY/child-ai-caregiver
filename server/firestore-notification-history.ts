import {z} from 'zod';
import type {Query} from '@google-cloud/firestore';
import type {FirestoreAuthorityTransaction} from './firestore-authority.ts';
import {FirestoreDomainData,domainParse,domainReject,type FirestoreDomainOptions} from './firestore-domain-data.ts';
import {openRecoveryEnvelope} from './firestore-recovery-envelope.ts';
import {firestorePushDeliverySchema} from './firestore-web-push.ts';
import {firestoreTelegramDeliverySchema} from './firestore-telegram.ts';
import {firestoreContactRequestSchema} from './firestore-contact.ts';

const definitions=[['push_deliveries','push-delivery','deliveryId'],['telegram_deliveries','telegram-delivery','deliveryId'],['contact_requests','contact-request','requestId']] as const;
const position=z.object({at:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
const cursorSchema=z.array(z.object({after:position.nullable(),done:z.boolean()}).strict()).length(3);
/** Bounded merge by original request creation. A request alone is never delivery evidence. */
export async function readNotificationHistory(options:FirestoreDomainOptions,b:FirestoreAuthorityTransaction,raw?:string){
  const data=new FirestoreDomainData(options),tags=data.tags(b.scope);
  let cursor:z.infer<typeof cursorSchema>;
  try {cursor=raw?cursorSchema.parse(JSON.parse(raw)):definitions.map(()=>({after:null,done:false}));}
  catch {return domainReject('invalid_export_cursor',400);}
  const streams=await Promise.all(definitions.map(async([suffix,,field],index)=>{
    if(cursor[index].done)return [];
    let q:Query=data.collection(suffix).where('workspaceTag','==',tags.workspaceTag).where('epochTag','==',tags.epochTag).where('userTag','==',tags.userTag);
    if(suffix!=='contact_requests')q=q.where('childTag','==',tags.childTag);
    q=q.orderBy('createdAt','desc').orderBy(field,'desc').limit(11);
    if(cursor[index].after)q=q.startAfter(cursor[index].after!.at,cursor[index].after!.id);
    const page=await b.transaction.get(q);
    return page.docs.map(row=>({row,position:domainParse(position,{at:row.get('createdAt'),id:row.get(field)},'delivery_binding',500)}));
  }));
  const offsets=[0,0,0],items:unknown[]=[],seen=new Set<string>();
  for(let scanned=0;scanned<10;scanned++){
    let selected=-1;
    for(let i=0;i<streams.length;i++){
      const candidate=streams[i][offsets[i]];if(!candidate)continue;
      const previous=selected<0?null:streams[selected][offsets[selected]];
      if(!previous||candidate.position.at>previous.position.at||candidate.position.at===previous.position.at&&candidate.position.id>previous.position.id)selected=i;
    }
    if(selected<0)break;
    const {row,position:next}=streams[selected][offsets[selected]++], [suffix,kind]=definitions[selected];
    cursor[selected].after=next;
    const body=row.data(),{context,value}=openRecoveryEnvelope({...options,locator:body.recovery,
      envelope:{family:'domain',version:body.version,recordVersion:body.recordVersion,ciphertext:body.ciphertext}});
    if(context.kind!==kind||context.id!==next.id||data.ref(suffix,kind,context.id).path!==row.ref.path
      ||context.scope.ownerUserId!==b.scope.ownerUserId||context.scope.workspaceId!==b.scope.workspaceId||context.scope.storageEpoch!==b.scope.storageEpoch
      ||Object.entries(data.tags(context.scope)).some(([key,v])=>row.get(key)!==v))domainReject('delivery_binding',500);
    if(selected<2){
      if(context.scope.childId!==b.scope.childId)domainReject('delivery_binding',500);
      const delivery=selected===0?firestorePushDeliverySchema.parse(value).delivery:firestoreTelegramDeliverySchema.parse(value).delivery;
      if(delivery.id!==next.id||delivery.createdAt!==next.at)domainReject('delivery_binding',500);
      if(!seen.has(delivery.id)){seen.add(delivery.id);items.push({id:delivery.id,channel:selected===0?'push':'telegram',status:delivery.status,
        created_at:delivery.createdAt,attempted_at:delivery.attemptedAt,finished_at:delivery.finishedAt,
        acknowledged_at:'acknowledgedAt' in delivery?delivery.acknowledgedAt:null});}
    }else{
      if(!await b.readChild(context.scope.childId))continue;
      const {request}=firestoreContactRequestSchema.parse(value);
      if(request.id!==next.id||request.createdAt!==next.at)domainReject('delivery_binding',500);
      for(const attempt of request.attempts){
        if(attempt.recipientUserId!==b.scope.ownerUserId||seen.has(attempt.id))continue;
        seen.add(attempt.id);items.push({id:attempt.id,request_id:request.id,channel:attempt.channel,status:attempt.status,
          created_at:request.createdAt,attempted_at:attempt.attemptedAt,finished_at:attempt.finishedAt,acknowledged_at:attempt.acknowledgedAt});
      }
    }
  }
  for(let i=0;i<streams.length;i++)if(offsets[i]===streams[i].length&&streams[i].length<11)cursor[i].done=true;
  return {items,next:cursor.every(v=>v.done)?null:JSON.stringify(cursor)};
}
