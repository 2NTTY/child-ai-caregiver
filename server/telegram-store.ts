import { createHash,createHmac,randomBytes,randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import { z } from "zod";
import type { TelegramBinding,TelegramChallenge,TelegramDelivery,TelegramStatus } from "../src/shared/telegram.ts";
import type { TelegramServices,TelegramEvent,TelegramGateway,TelegramSendResult } from "./telegram-types.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";

interface BindingRow {id:string;user_id:string;bot_id:string;version:number;status:TelegramBinding["status"];target_hash:string|null;target_encrypted:string|null;created_at:Date;updated_at:Date}
interface ChallengeRow {id:string;user_id:string;bot_id:string;storage_epoch:string;version:number;secret_encrypted:string;candidate_encrypted:string|null;state:"waiting"|"seen"|"consumed"|"cancelled";expires_at:Date}
interface DeliveryRow {id:string;user_id:string;binding_id:string;binding_version:number;bot_id:string;storage_epoch:string;worker_generation:string;status:TelegramDelivery["status"];reason:string|null;provider_status:number|null;message_id:string|null;callback_encrypted:string|null;created_at:Date;attempted_at:Date|null;finished_at:Date|null;acknowledged_at:Date|null}
const targetSchema=z.object({chatId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),senderId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),label:z.string().max(160)}).strict();
const missing=()=>new FamilyError(404,"not_found");
const conflict=(code="version_conflict")=>new FamilyError(409,code);
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const aad=(kind:string,userId:string,id:string)=>"telegram:"+kind+":"+userId+":"+id;
const hint=(chatId:number)=>"••••"+String(chatId).slice(-4);
function delivery(row:DeliveryRow):TelegramDelivery{return {id:row.id,bindingId:row.binding_id,status:row.status,reason:row.reason,providerStatus:row.provider_status,messageId:row.message_id===null?null:Number(row.message_id),createdAt:row.created_at.toISOString(),attemptedAt:row.attempted_at?.toISOString()??null,finishedAt:row.finished_at?.toISOString()??null,acknowledgedAt:row.acknowledged_at?.toISOString()??null};}
async function transaction<T>(pool:Pool,action:(client:PoolClient)=>Promise<T>){
 const client=await pool.connect();let discard=false;
 try{await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'");const value=await action(client);await client.query("COMMIT");return value;}
 catch(error){try{await client.query("ROLLBACK");}catch{discard=true;}throw error;}finally{client.release(discard);}
}
export function createTelegramStore(pool:Pool,cipher:StorageCipher,services:TelegramServices){
 const config=services.config;
 const target=(row:BindingRow)=>targetSchema.parse(JSON.parse(cipher.decrypt(row.target_encrypted!,aad("binding",row.user_id,row.id))));
 const candidate=(row:ChallengeRow)=>row.candidate_encrypted?targetSchema.parse(JSON.parse(cipher.decrypt(row.candidate_encrypted,aad("candidate",row.user_id,row.id)))):null;
 function binding(row:BindingRow):TelegramBinding{const value=row.target_encrypted?target(row):null;return {id:row.id,version:row.version,status:row.status,label:value?.label??"已解除的 Telegram 帳號",chatIdHint:value?hint(value.chatId):"",createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()};}
 function challenge(row:ChallengeRow):TelegramChallenge{const value=candidate(row);return {id:row.id,version:row.version,expiresAt:row.expires_at.toISOString(),state:row.state==="seen"?"seen":"waiting",startUrl:"https://t.me/"+config!.botUsername+"?start="+cipher.decrypt(row.secret_encrypted,aad("challenge",row.user_id,row.id)),candidate:value?{label:value.label,chatIdHint:hint(value.chatId)}:null};}
 async function owner(client:PoolClient,userId:string){
  const space=(await client.query<{id:string;storage_epoch:string}>("SELECT id,storage_epoch FROM workspaces WHERE owner_user_id=$1 FOR UPDATE",[userId])).rows[0];
  if(!space || !(await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[userId])).rowCount)throw missing();
  return space;
 }
 async function changed(client:PoolClient,userId:string,workspaceId:string){await appendOnlineChange(client,workspaceId,"preferences",null,false,userId);}
 async function fingerprint(client:PoolClient,botId:string,chatId:number){
  // A stable encrypted random lookup key keeps numeric Telegram IDs out of indexes.
  const key=(await client.query<{lookup_key_encrypted:string}>("SELECT lookup_key_encrypted FROM telegram_meta WHERE id=1")).rows[0]?.lookup_key_encrypted;
  if(!key)return null;
  return createHmac("sha256",Buffer.from(cipher.decrypt(key,"telegram:lookup-key"),"base64")).update(botId+":"+chatId).digest("hex");
 }
 async function revoke(client:PoolClient,row:BindingRow,state:"revoked"|"blocked"){
  const next=(await client.query<BindingRow>("UPDATE telegram_bindings SET status=$2,version=version+1,target_hash=NULL,target_encrypted=NULL,updated_at=now() WHERE id=$1 RETURNING *",[row.id,state])).rows[0];
  await client.query("UPDATE telegram_deliveries SET status='stopped',reason='revoked',finished_at=now(),callback_encrypted=NULL WHERE binding_id=$1 AND status='queued'",[row.id]);
  return binding(next);
 }
 async function owned(client:PoolClient,userId:string,id:string,version:number){const row=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,userId])).rows[0];if(!row)throw missing();if(row.version!==version)throw conflict();return row;}
 async function control(client:PoolClient,row:DeliveryRow){
  const current=(await client.query<{enabled:boolean;generation:string;storage_epoch:string}>("SELECT c.enabled,c.generation,w.storage_epoch FROM worker_control c JOIN workspaces w ON w.owner_user_id=$1 WHERE c.id=1",[row.user_id])).rows[0];
  const b=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE id=$1",[row.binding_id])).rows[0];
  return Boolean(config&&current?.enabled&&current.generation===row.worker_generation&&current.storage_epoch===row.storage_epoch&&row.bot_id===config.botId&&b?.status==="active"&&b.version===row.binding_version);
 }
 return{
  async status(userId:string):Promise<TelegramStatus>{
   return transaction(pool,async client=>{
    await owner(client,userId);
    const b=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE user_id=$1 ORDER BY (status='active') DESC,created_at DESC LIMIT 1",[userId])).rows[0];
    const pending=config?(await client.query<ChallengeRow>("SELECT c.* FROM telegram_challenges c JOIN workspaces w ON w.owner_user_id=c.user_id AND w.storage_epoch=c.storage_epoch WHERE c.user_id=$1 AND c.bot_id=$2 AND c.state IN ('waiting','seen') AND c.expires_at>now() ORDER BY c.created_at DESC LIMIT 1",[userId,config.botId])).rows[0]:null;
    return {configured:Boolean(config&&services.queue),workerEnabled:Boolean((await client.query("SELECT 1 FROM worker_control WHERE id=1 AND enabled")).rowCount),botUsername:config?.botUsername??null,binding:b?binding(b):null,challenge:pending?challenge(pending):null,deliveries:(await client.query<DeliveryRow>("SELECT * FROM telegram_deliveries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",[userId])).rows.map(delivery)};
   });
  },
  async begin(userId:string){return transaction(pool,async client=>{
   const space=await owner(client,userId);if(!config)throw conflict("telegram_unavailable");
   if((await client.query("SELECT id FROM telegram_bindings WHERE user_id=$1 AND status='active'",[userId])).rowCount)throw conflict("telegram_already_bound");
   if(Number((await client.query<{count:string}>("SELECT count(*)::text FROM telegram_challenges WHERE user_id=$1 AND created_at>now()-interval '1 hour'",[userId])).rows[0].count)>=6)throw conflict("telegram_link_limit");
   await client.query("UPDATE telegram_challenges SET state='cancelled',candidate_encrypted=NULL WHERE user_id=$1 AND state IN ('waiting','seen')",[userId]);
   await client.query("INSERT INTO telegram_meta(id,lookup_key_encrypted) VALUES(1,$1) ON CONFLICT DO NOTHING",[cipher.encrypt(randomBytes(32).toString("base64"),"telegram:lookup-key")]);
   const id=randomUUID(),token=randomBytes(24).toString("base64url");
   const row=(await client.query<ChallengeRow>("INSERT INTO telegram_challenges(id,user_id,bot_id,storage_epoch,token_hash,secret_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes') RETURNING *",[id,userId,config.botId,space.storage_epoch,hash(token),cipher.encrypt(token,aad("challenge",userId,id))])).rows[0];
   await changed(client,userId,space.id);return challenge(row);
  });},
  async confirm(userId:string,id:string,version:number){return transaction(pool,async client=>{
   const space=await owner(client,userId);if(!config)throw conflict("telegram_unavailable");
   const row=(await client.query<ChallengeRow>("SELECT * FROM telegram_challenges WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,userId])).rows[0];if(!row)throw missing();
   if(row.version!==version||row.state!=="seen"||row.expires_at.getTime()<=Date.now()||row.bot_id!==config.botId||row.storage_epoch!==space.storage_epoch)throw conflict("telegram_link_changed");
   const value=candidate(row);if(!value)throw conflict("telegram_link_changed");
   if((await client.query("SELECT id FROM telegram_bindings WHERE user_id=$1 AND status='active'",[userId])).rowCount)throw conflict("telegram_already_bound");
   const targetHash=await fingerprint(client,config.botId,value.chatId);if(!targetHash)throw conflict("telegram_link_changed");
   if((await client.query("SELECT id FROM telegram_bindings WHERE bot_id=$1 AND target_hash=$2 AND status='active'",[config.botId,targetHash])).rowCount)throw conflict("telegram_target_in_use");
   const bindingId=randomUUID();
   const next=(await client.query<BindingRow>("INSERT INTO telegram_bindings(id,user_id,bot_id,status,target_hash,target_encrypted) VALUES($1,$2,$3,'active',$4,$5) ON CONFLICT DO NOTHING RETURNING *",[bindingId,userId,config.botId,targetHash,cipher.encrypt(JSON.stringify(value),aad("binding",userId,bindingId))])).rows[0];
   if(!next)throw conflict("telegram_target_in_use");
   await client.query("UPDATE telegram_challenges SET state='consumed',version=version+1,candidate_encrypted=NULL WHERE id=$1",[id]);
   await changed(client,userId,space.id);return binding(next);
  });},
  async revoke(userId:string,id:string,version:number){return transaction(pool,async client=>{const space=await owner(client,userId),row=await owned(client,userId,id,version);const value=row.status==="revoked"?binding(row):await revoke(client,row,"revoked");await changed(client,userId,space.id);return value;});},
  async test(userId:string,id:string,version:number){return transaction(pool,async client=>{
   const space=await owner(client,userId),row=await owned(client,userId,id,version);
   if(!config||!services.queue)throw conflict("telegram_unavailable");
   if(row.status!=="active"||row.bot_id!==config.botId)throw conflict("telegram_binding_unavailable");
   if((await client.query("SELECT 1 FROM telegram_deliveries WHERE binding_id=$1 AND (status IN ('queued','sending') OR (status='unknown' AND acknowledged_at IS NULL)) LIMIT 1",[id])).rowCount)throw conflict("telegram_delivery_unresolved");
   const ctl=(await client.query<{generation:string}>("SELECT generation FROM worker_control WHERE id=1 AND enabled FOR SHARE")).rows[0];if(!ctl)throw conflict("worker_paused");
   const limit=(await client.query<{count:string;recent:boolean}>("SELECT count(*)::text,coalesce(max(created_at)>now()-interval '60 seconds',false) AS recent FROM telegram_deliveries WHERE user_id=$1 AND created_at>now()-interval '24 hours'",[userId])).rows[0];
   if(Number(limit.count)>=3||limit.recent)throw conflict("test_limit");
   const deliveryId=randomUUID(),token=randomBytes(24).toString("base64url");
   const next=(await client.query<DeliveryRow>("INSERT INTO telegram_deliveries(id,user_id,binding_id,binding_version,bot_id,storage_epoch,worker_generation,callback_hash,callback_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[deliveryId,userId,id,version,config.botId,space.storage_epoch,ctl.generation,hash(token),cipher.encrypt(token,aad("callback",userId,deliveryId))])).rows[0];
   await services.queue.enqueue(client,deliveryId);await changed(client,userId,space.id);return delivery(next);
  });},
  async webhook(event:TelegramEvent):Promise<string|null>{
   if(!config||event.kind==="ignore")return null;
   return transaction(pool,async client=>{
    const inserted=await client.query("INSERT INTO telegram_updates(bot_id,update_id,outcome) VALUES($1,$2,'ignored') ON CONFLICT DO NOTHING",[config.botId,event.updateId]);if(!inserted.rowCount)return null;
    if(event.kind==="stop"||event.kind==="blocked"){
     const targetHash=await fingerprint(client,config.botId,event.chatId);
     const users=(await client.query<{user_id:string}>("SELECT user_id FROM telegram_bindings WHERE bot_id=$1 AND target_hash=$2 AND status='active' UNION SELECT user_id FROM telegram_challenges WHERE bot_id=$1 AND candidate_hash=$2 AND state='seen' ORDER BY user_id",[config.botId,targetHash])).rows;
     for(const user of users){
      const space=await owner(client,user.user_id);
      const rows=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE user_id=$1 AND bot_id=$2 AND status='active' FOR UPDATE",[user.user_id,config.botId])).rows;
      for(const row of rows){const value=target(row);if(value.chatId===event.chatId&&value.senderId===event.senderId)await revoke(client,row,event.kind==="blocked"?"blocked":"revoked");}
      await client.query("UPDATE telegram_challenges SET state='cancelled',version=version+1,candidate_encrypted=NULL,candidate_hash=NULL WHERE user_id=$1 AND bot_id=$2 AND candidate_hash=$3 AND state='seen'",[user.user_id,config.botId,targetHash]);
      await changed(client,user.user_id,space.id);
     }
     await client.query("UPDATE telegram_updates SET outcome='revoked' WHERE bot_id=$1 AND update_id=$2",[config.botId,event.updateId]);
     return null;
    }
    let userId:string|undefined;
    if(event.kind==="start")userId=(await client.query<{user_id:string}>("SELECT user_id FROM telegram_challenges WHERE token_hash=$1 AND bot_id=$2",[hash(event.token),config.botId])).rows[0]?.user_id;
    else if(event.kind==="ack")userId=(await client.query<{user_id:string}>("SELECT user_id FROM telegram_deliveries WHERE callback_hash=$1 AND bot_id=$2",[hash(event.token),config.botId])).rows[0]?.user_id;
    if(!userId)return null;
    const space=await owner(client,userId);
    let outcome="ignored",ack:string|null=null;
    if(event.kind==="start"){
     const row=(await client.query<ChallengeRow>("SELECT * FROM telegram_challenges WHERE token_hash=$1 AND user_id=$2 FOR UPDATE",[hash(event.token),userId])).rows[0];
     if(row&&row.storage_epoch===space.storage_epoch&&row.expires_at.getTime()>Date.now()&&["waiting","seen"].includes(row.state)){
      const prior=candidate(row);
      if(!prior){await client.query("UPDATE telegram_challenges SET state='seen',version=version+1,candidate_encrypted=$2,candidate_hash=$3 WHERE id=$1",[row.id,cipher.encrypt(JSON.stringify({chatId:event.chatId,senderId:event.senderId,label:event.label}),aad("candidate",userId,row.id)),await fingerprint(client,config.botId,event.chatId)]);outcome="candidate_seen";}
      else if(prior.chatId===event.chatId&&prior.senderId===event.senderId)outcome="candidate_already_seen";
     }
    }else{
     const rows=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE user_id=$1 AND bot_id=$2 AND status='active' FOR UPDATE",[userId,config.botId])).rows;
     const row=rows.find(item=>{const t=target(item);return t.chatId===event.chatId&&t.senderId===event.senderId;});
     if(row&&event.kind==="ack"){
      const result=await client.query("UPDATE telegram_deliveries SET acknowledged_at=coalesce(acknowledged_at,now()) WHERE callback_hash=$1 AND binding_id=$2 AND binding_version=$3 AND status IN ('sending','accepted','unknown') AND (message_id IS NULL OR message_id=$4) RETURNING id",[hash(event.token),row.id,row.version,event.messageId]);
      if(result.rowCount){outcome="acknowledged";ack=event.callbackQueryId;}
     }
    }
    await client.query("UPDATE telegram_updates SET outcome=$3 WHERE bot_id=$1 AND update_id=$2",[config.botId,event.updateId,outcome]);
    if(outcome!=="ignored")await changed(client,userId,space.id);return ack;
   });
  },
  async reconcile(){
   const ids=(await pool.query<{id:string;user_id:string}>("SELECT d.id,d.user_id FROM telegram_deliveries d LEFT JOIN pgboss.job j ON j.name='telegram-send-v1' AND j.id=d.id WHERE d.status IN ('queued','sending') AND (j.id IS NULL OR j.state IN ('failed','cancelled')) ORDER BY d.user_id,d.id LIMIT 100")).rows;
   for(const id of ids)await transaction(pool,async client=>{
    const space=await owner(client,id.user_id);
    const row=(await client.query<DeliveryRow>("SELECT d.* FROM telegram_deliveries d LEFT JOIN pgboss.job j ON j.name='telegram-send-v1' AND j.id=d.id WHERE d.id=$1 AND d.status IN ('queued','sending') AND (j.id IS NULL OR j.state IN ('failed','cancelled')) FOR UPDATE OF d",[id.id])).rows[0];
    if(!row)return;
    await client.query("UPDATE telegram_deliveries SET status=$2,reason=$3,finished_at=now(),callback_encrypted=NULL WHERE id=$1",[row.id,row.status==="sending"?"unknown":"stopped",row.status==="sending"?"transport_unknown":"worker_unavailable"]);
    await changed(client,row.user_id,space.id);
   });
  },
  async send(deliveryId:string,gateway:TelegramGateway,signal:AbortSignal){
   const prepared=await transaction(pool,async client=>{
    const initial=(await client.query<DeliveryRow>("SELECT * FROM telegram_deliveries WHERE id=$1",[deliveryId])).rows[0];if(!initial)return null;
    const space=await owner(client,initial.user_id);
    const row=(await client.query<DeliveryRow>("SELECT * FROM telegram_deliveries WHERE id=$1 FOR UPDATE",[deliveryId])).rows[0];
    if(row.status==="sending"){await client.query("UPDATE telegram_deliveries SET status='unknown',reason='transport_unknown',finished_at=now(),callback_encrypted=NULL WHERE id=$1",[row.id]);await changed(client,row.user_id,space.id);return null;}
    if(row.status!=="queued")return null;
    if(!await control(client,row)||signal.aborted){await client.query("UPDATE telegram_deliveries SET status='stopped',reason='revoked',finished_at=now(),callback_encrypted=NULL WHERE id=$1",[row.id]);await changed(client,row.user_id,space.id);return null;}
    const b=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE id=$1",[row.binding_id])).rows[0];
    const value=target(b),token=cipher.decrypt(row.callback_encrypted!,aad("callback",row.user_id,row.id));
    await client.query("UPDATE telegram_deliveries SET status='sending',attempted_at=now() WHERE id=$1",[row.id]);await changed(client,row.user_id,space.id);
    return {row,chatId:value.chatId,callbackToken:token};
   });
   if(!prepared)return;
   const stillAuthorized=()=>transaction(pool,async client=>{
    await owner(client,prepared.row.user_id);
    const current=(await client.query<DeliveryRow>("SELECT * FROM telegram_deliveries WHERE id=$1",[deliveryId])).rows[0];
    return Boolean(current?.status==="sending"&&await control(client,current));
   });
   let result:TelegramSendResult;
   try{result=await gateway.send({chatId:prepared.chatId,callbackToken:prepared.callbackToken},signal,stillAuthorized);}
   catch{result={status:"unknown",reason:"transport_unknown",providerStatus:null,messageId:null};}
   await transaction(pool,async client=>{
    const space=await owner(client,prepared.row.user_id);
    const updated=await client.query("UPDATE telegram_deliveries SET status=$2,reason=$3,provider_status=$4,message_id=$5,finished_at=now(),callback_encrypted=NULL WHERE id=$1 AND status='sending' RETURNING id",[deliveryId,result.status,result.reason,result.providerStatus,result.messageId]);
    if(updated.rowCount&&result.reason==="blocked"){
     const row=(await client.query<BindingRow>("SELECT * FROM telegram_bindings WHERE id=$1 FOR UPDATE",[prepared.row.binding_id])).rows[0];
     if(row?.status==="active"&&row.version===prepared.row.binding_version)await revoke(client,row,"blocked");
    }
    if(updated.rowCount)await changed(client,prepared.row.user_id,space.id);
   });
  },
 };
}
export type TelegramStore=ReturnType<typeof createTelegramStore>;
