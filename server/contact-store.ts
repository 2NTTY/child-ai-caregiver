import { createHash,randomBytes,randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import { contactConsentInput,contactGrantInput,type ContactBinding,type ContactConsent,type ContactGrant,type ContactPage,type ContactRequest,type ContactAttempt,type ContactGrantInput,type ContactConsentInput } from "../src/shared/contact.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES,type NotificationPreferences } from "../src/shared/family.ts";
import { pushRegistrationInput } from "../src/shared/web-push.ts";
import type { CareTask } from "../src/shared/tasks.ts";
import { FamilyError,withChildAccess,READ_ROLES,WRITE_ROLES } from "./family-access.ts";
import { decodeTask,taskSelection,createTaskStore,type TaskRow } from "./tasks.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { transactionPool } from "./transaction-pool.ts";
import { appendOnlineChange } from "./online-change.ts";
import { reminderLocalTime,reminderDecision,nextReminderCheck } from "./task-policy.ts";
import { createGrowthStore } from "./growth-store.ts";
import type { ContactQueue } from "./contact-events.ts";
import type { WebPushGateway } from "./web-push-types.ts";
import type { TelegramGateway,TelegramEvent } from "./telegram-types.ts";

interface VersionRow {version:number;payload_encrypted:string}
interface ConsentSaved {value:ContactConsent;authorityVersion:number}
interface Target {userId:string;consentVersion:number;bindings:ContactBinding[]}
interface GrantSaved {value:ContactGrant;targets:Target[];authorityVersion:number}
interface RequestSaved {grant:GrantSaved;taskVersion:number;occurrenceId:string;phase:"initial"|"follow_up";actorUserId:string;runId:string}
interface RequestRow {id:string;child_id:string;task_id:string;reminder_id:string;worker_generation:string;storage_epoch:string;job_id:string;state:ContactRequest["state"];reason:string|null;next_at:Date;payload_encrypted:string;grouped_to:string|null;created_at:Date}
interface AttemptRow {id:string;request_id:string;position:number;recipient_user_id:string;channel:ContactBinding["channel"];binding_id:string;binding_version:number;status:ContactAttempt["status"];reason:string|null;provider_status:number|null;message_id:string|null;bot_id:string|null;callback_hash:string|null;callback_encrypted:string|null;attempted_at:Date;finished_at:Date|null;acknowledged_at:Date|null}
interface Space {id:string;owner_user_id:string;storage_epoch:string;access_version:number}
export interface ContactServices {queue?:ContactQueue;pushKey:string|null;telegramBotId:string|null}
const conflict=(code="contact_changed")=>new FamilyError(409,code);
const missing=()=>new FamilyError(404,"not_found");
const aad=(kind:string,childId:string,id:string,version:number)=>"contact:"+kind+":"+childId+":"+id+":"+version;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const callbackAad=(id:string)=>"contact:callback:"+id;
const requestAad=(id:string)=>"contact:request:"+id;

export function createContactStore(pool:Pool,cipher:StorageCipher,services:ContactServices){
 const access=<T>(userId:string,childId:string,write:boolean,fn:(c:PoolClient,s:Space)=>Promise<T>)=>
  withChildAccess(pool,userId,childId,write?WRITE_ROLES:READ_ROLES,async(c,_role,workspaceId)=>{
   const s=(await c.query<Space>("SELECT id,owner_user_id,storage_epoch,access_version FROM workspaces WHERE id=$1",[workspaceId])).rows[0];
   return fn(c,s);
  },write);
 async function members(c:PoolClient,s:Space){return (await c.query<{userId:string;name:string}>('SELECT id AS "userId",name FROM "user" WHERE id=$1 UNION ALL SELECT u.id,u.name FROM family_members m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$2 AND m.role=\'caregiver\'',[s.owner_user_id,s.id])).rows;}
 const eligible=async(c:PoolClient,s:Space,id:string)=>id===s.owner_user_id||Boolean((await c.query("SELECT 1 FROM family_members WHERE workspace_id=$1 AND user_id=$2 AND role='caregiver'",[s.id,id])).rowCount);
 async function task(c:PoolClient,childId:string,id:string){const row=(await c.query<TaskRow>(taskSelection+" WHERE t.child_id=$1 AND t.id=$2",[childId,id])).rows[0];return row?decodeTask(row,cipher):null;}
 async function consent(c:PoolClient,childId:string,userId:string):Promise<ConsentSaved>{
  const row=(await c.query<VersionRow>("SELECT version,payload_encrypted FROM contact_consents WHERE child_id=$1 AND user_id=$2",[childId,userId])).rows[0];
  return row?JSON.parse(cipher.decrypt(row.payload_encrypted,aad("consent",childId,userId,row.version))):{value:{userId,version:0,enabled:false,allowBackup:false,bindings:[]},authorityVersion:0};
 }
 async function grant(c:PoolClient,childId:string,taskId:string):Promise<GrantSaved|null>{
  const row=(await c.query<VersionRow>("SELECT version,payload_encrypted FROM contact_grants WHERE child_id=$1 AND task_id=$2",[childId,taskId])).rows[0];
  return row?JSON.parse(cipher.decrypt(row.payload_encrypted,aad("grant",childId,taskId,row.version))):null;
 }
 async function bindings(c:PoolClient,userId:string):Promise<ContactPage["availableBindings"]>{
  const result:ContactPage["availableBindings"]=[];
  if(services.pushKey)for(const row of (await c.query<{id:string;version:number;subscription_encrypted:string}>("SELECT id,version,subscription_encrypted FROM web_push_subscriptions WHERE user_id=$1 AND status='active' AND vapid_public_key=$2 AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at,id LIMIT 5",[userId,services.pushKey])).rows){
   const value=pushRegistrationInput.parse(JSON.parse(cipher.decrypt(row.subscription_encrypted,"web-push:"+userId+":"+row.id)));
   result.push({channel:"web_push",bindingId:row.id,bindingVersion:row.version,label:value.label});
  }
  if(services.telegramBotId)for(const row of (await c.query<{id:string;version:number;target_encrypted:string}>("SELECT id,version,target_encrypted FROM telegram_bindings WHERE user_id=$1 AND status='active' AND bot_id=$2 LIMIT 1",[userId,services.telegramBotId])).rows){
   const value=JSON.parse(cipher.decrypt(row.target_encrypted,"telegram:binding:"+userId+":"+row.id)) as {label:string};
   result.push({channel:"telegram",bindingId:row.id,bindingVersion:row.version,label:value.label});
  }return result;
 }
 const sameBinding=(a:ContactBinding,b:ContactBinding)=>a.channel===b.channel&&a.bindingId===b.bindingId&&a.bindingVersion===b.bindingVersion;
 async function validTarget(c:PoolClient,s:Space,childId:string,value:Target,backup:boolean){
  if(!await eligible(c,s,value.userId))return false;
  const saved=await consent(c,childId,value.userId);
  return saved.authorityVersion===s.access_version&&saved.value.version===value.consentVersion&&saved.value.enabled&&(!backup||saved.value.allowBackup);
 }
 async function currentGrant(c:PoolClient,s:Space,childId:string,t:CareTask,g:GrantSaved|null){
  return Boolean(g&&g.value.enabled&&g.authorityVersion===s.access_version&&g.value.taskVersion===t.version&&g.value.primaryUserId===t.assigneeUserId&&t.occurrence.state==="scheduled"&&Date.parse(g.value.validUntil)>Date.now()&&await eligible(c,s,g.value.authorizedBy));
 }
 async function attentionAllowed(c:PoolClient,userId:string,childId:string,taskId:string){
  const borrowed=transactionPool(c),value=await createGrowthStore(borrowed.pool,cipher).taskAllowed(userId,childId,taskId);borrowed.assertReleased();return value;
 }
 function decodeRequest(row:RequestRow):RequestSaved{return JSON.parse(cipher.decrypt(row.payload_encrypted,requestAad(row.id)));}
 function publicAttempt(row:AttemptRow,saved:RequestSaved):ContactAttempt{
  return {id:row.id,recipientUserId:row.recipient_user_id,channel:row.channel,grantVersion:saved.grant.value.version,taskVersion:saved.taskVersion,status:row.status,reason:row.reason,providerStatus:row.provider_status,messageId:row.message_id===null?null:Number(row.message_id),attemptedAt:row.attempted_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null,acknowledgedAt:row.acknowledged_at?.toISOString()??null};
 }
 async function view(c:PoolClient,row:RequestRow):Promise<ContactRequest>{
  const saved=decodeRequest(row),attempts=(await c.query<AttemptRow>("SELECT * FROM contact_attempts WHERE request_id=$1 ORDER BY position",[row.id])).rows;
  return {id:row.id,taskId:row.task_id,taskVersion:saved.taskVersion,occurrenceId:saved.occurrenceId,phase:saved.phase,state:row.state,reason:row.reason,nextAt:row.next_at.toISOString(),groupedTo:row.grouped_to,createdAt:row.created_at.toISOString(),attempts:attempts.map(x=>publicAttempt(x,saved))};
 }
 async function selected(c:PoolClient,s:Space,childId:string,t:CareTask,g:GrantSaved){
  if(!g.targets[0]||!await validTarget(c,s,childId,g.targets[0],false))return null;
  for(const [index,target] of g.targets.entries()){
   if(index>0&&!g.value.allowFallback)break;
   if(!await validTarget(c,s,childId,target,index>0))continue;
   const active=await bindings(c,target.userId);
   if(target.bindings.some(b=>active.some(a=>sameBinding(a,b))))return {userId:g.targets[0].userId,reason:"task_assignee_with_authorized_fallback"};
  }return null;
 }
 async function actionable(c:PoolClient,s:Space,userId:string,childId:string,taskId:string){
  const t=await task(c,childId,taskId),g=await grant(c,childId,taskId);
  if(!t||!g||!await currentGrant(c,s,childId,t,g)||!await eligible(c,s,userId)||!await attentionAllowed(c,userId,childId,taskId))return null;
  const reminder=(await c.query<{id:string;phase:"initial"|"follow_up";worker_generation:string;storage_epoch:string}>("SELECT r.id,r.phase,w.worker_generation,w.storage_epoch FROM task_reminders r JOIN task_work w ON w.task_id=r.task_id AND w.task_version=r.task_version AND w.occurrence_id=r.occurrence_id JOIN worker_control ctl ON ctl.id=1 AND ctl.enabled AND ctl.generation=w.worker_generation WHERE r.task_id=$1 AND r.task_version=$2 AND w.storage_epoch=$3 AND w.status IN ('pending','processed') ORDER BY r.created_at DESC LIMIT 1",[taskId,t.version,s.storage_epoch])).rows[0];
  if(!reminder||Date.parse(t.occurrence.dueAt)>Date.now()||reminder.phase==="follow_up"&&!g.value.allowFollowUp)return null;
  const choice=await selected(c,s,childId,t,g);return choice?{t,g,reminder,choice}:null;
 }
 async function lockedRequest<T>(id:string,fn:(c:PoolClient,s:Space,row:RequestRow)=>Promise<T>):Promise<T|null>{
  const client=await pool.connect();let discard=false;
  try{
   await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
   const ref=(await client.query<{workspace_id:string}>("SELECT ch.workspace_id FROM contact_requests r JOIN children ch ON ch.id=r.child_id WHERE r.id=$1",[id])).rows[0];
   if(!ref){await client.query("COMMIT");return null;}
   const s=(await client.query<Space>("SELECT id,owner_user_id,storage_epoch,access_version FROM workspaces WHERE id=$1 FOR UPDATE",[ref.workspace_id])).rows[0];
   const row=(await client.query<RequestRow>("SELECT * FROM contact_requests WHERE id=$1 FOR UPDATE",[id])).rows[0];
   const result=s&&row?await fn(client,s,row):null;await client.query("COMMIT");return result;
  }catch(error){try{await client.query("ROLLBACK");}catch{discard=true;}throw error;}finally{client.release(discard);}
 }
 async function setState(c:PoolClient,s:Space,row:RequestRow,state:ContactRequest["state"],reason:string|null){
  await c.query("UPDATE contact_requests SET state=$2,reason=$3,updated_at=now() WHERE id=$1",[row.id,state,reason]);
  await appendOnlineChange(c,s.id,"tasks",row.child_id);
 }

 async function validRequest(c:PoolClient,s:Space,row:RequestRow,saved:RequestSaved){
  const ctl=(await c.query<{generation:string;enabled:boolean}>("SELECT generation,enabled FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
  const t=await task(c,row.child_id,row.task_id),g=await grant(c,row.child_id,row.task_id);
  if(!ctl?.enabled||ctl.generation!==row.worker_generation||s.storage_epoch!==row.storage_epoch||!t||!g||g.value.version!==saved.grant.value.version||!await currentGrant(c,s,row.child_id,t,g)||t.occurrence.id!==saved.occurrenceId||!await eligible(c,s,saved.actorUserId)||saved.phase==="follow_up"&&!g.value.allowFollowUp)return null;
  return await attentionAllowed(c,saved.actorUserId,row.child_id,row.task_id)?t:null;
 }
 async function defer(c:PoolClient,row:RequestRow,at:string){
  if(!services.queue)throw conflict("contact_worker_unavailable");
  const jobId=randomUUID();await services.queue.enqueue(c,row.id,jobId,at);
  await c.query("UPDATE contact_requests SET job_id=$2,next_at=$3,updated_at=now() WHERE id=$1",[row.id,jobId,at]);
 }
 const api={
  page(userId:string,childId:string):Promise<ContactPage|null>{return access(userId,childId,false,async(c,s)=>{
   const availableBindings=await bindings(c,userId),own=await consent(c,childId,userId),list=await members(c,s);
   const recipients=await Promise.all(list.map(async person=>{const v=await consent(c,childId,person.userId);return {...person,enabled:v.value.enabled&&v.authorityVersion===s.access_version,allowBackup:v.value.allowBackup,channels:v.value.bindings.map(x=>x.channel)};}));
   const rows=(await c.query<TaskRow>(taskSelection+" WHERE t.child_id=$1 ORDER BY t.id LIMIT 51",[childId])).rows;
   const grants=(await c.query<{task_id:string}>("SELECT task_id FROM contact_grants WHERE child_id=$1 ORDER BY task_id LIMIT 501",[childId])).rows;
   if(grants.length>500)throw conflict("contact_history_requires_review");
   const requests=(await c.query<RequestRow>("SELECT * FROM contact_requests WHERE child_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51",[childId])).rows;
   return {canManage:list.some(x=>x.userId===userId),workerEnabled:Boolean((await c.query("SELECT 1 FROM worker_control WHERE id=1 AND enabled")).rowCount),consent:{...own.value,enabled:own.value.enabled&&own.authorityVersion===s.access_version},availableBindings,recipients,tasks:rows.slice(0,50).map(r=>decodeTask(r,cipher)),tasksHaveMore:rows.length>50,grants:(await Promise.all(grants.map(r=>grant(c,childId,r.task_id)))).filter((v):v is GrantSaved=>Boolean(v)).map(v=>({...v.value,enabled:v.value.enabled&&v.authorityVersion===s.access_version})),requests:await Promise.all(requests.slice(0,50).map(r=>view(c,r))),historyLimited:requests.length>50};
  });},
  saveConsent(userId:string,childId:string,raw:ContactConsentInput){const input=contactConsentInput.parse(raw);return access(userId,childId,true,async(c,s)=>{
   const old=await consent(c,childId,userId);if(old.value.version!==input.expectedVersion)throw conflict();
   await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[userId]);
   const active=await bindings(c,userId);
   if(input.enabled&&input.bindings.some(b=>!active.some(a=>sameBinding(a,b))))throw conflict("contact_binding_changed");
   const value:ContactConsent={userId,version:old.value.version+1,enabled:input.enabled,allowBackup:input.allowBackup,bindings:input.enabled?input.bindings:[]};
   const payload=cipher.encrypt(JSON.stringify({value,authorityVersion:s.access_version}),aad("consent",childId,userId,value.version));
   await c.query("INSERT INTO contact_consents(child_id,user_id,version,payload_encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(child_id,user_id) DO UPDATE SET version=$3,payload_encrypted=$4",[childId,userId,value.version,payload]);
   await c.query("INSERT INTO contact_consent_revisions(child_id,user_id,version,payload_encrypted) VALUES($1,$2,$3,$4)",[childId,userId,value.version,payload]);
   await appendOnlineChange(c,s.id,"tasks",childId);return value;
  });},
  saveGrant(userId:string,childId:string,taskId:string,raw:ContactGrantInput){const input=contactGrantInput.parse(raw);return access(userId,childId,true,async(c,s)=>{
   const t=await task(c,childId,taskId),old=await grant(c,childId,taskId);
   if(!t)throw missing();if((old?.value.version??0)!==input.expectedVersion||t.version!==input.expectedTaskVersion)throw conflict();
   if(input.enabled&&(t.occurrence.state!=="scheduled"||Date.parse(input.validUntil)<=Date.now()||Date.parse(input.validUntil)>Date.now()+365*86400000||input.backupUserId===t.assigneeUserId))throw conflict("contact_scope_invalid");
   const targets:Target[]=[];
   if(input.enabled)for(const [i,id] of [t.assigneeUserId,...(input.backupUserId?[input.backupUserId]:[])].entries()){
    const v=await consent(c,childId,id);
    if(!await eligible(c,s,id)||v.authorityVersion!==s.access_version||!v.value.enabled||i>0&&!v.value.allowBackup)throw conflict("contact_consent_required");
    const active=await bindings(c,id),choices=v.value.bindings.filter(b=>active.some(a=>sameBinding(a,b)));
    if(!choices.length)throw conflict("contact_binding_changed");
    targets.push({userId:id,consentVersion:v.value.version,bindings:input.allowFallback?choices:choices.slice(0,1)});
   }
   const value:ContactGrant={taskId,version:(old?.value.version??0)+1,taskVersion:t.version,enabled:input.enabled,primaryUserId:t.assigneeUserId,backupUserId:input.backupUserId,allowFollowUp:input.allowFollowUp,allowFallback:input.allowFallback,validUntil:input.validUntil,authorizedBy:userId,content:"generic_notice",trigger:"task_due",updatedAt:new Date().toISOString()};
   const payload=cipher.encrypt(JSON.stringify({value,targets,authorityVersion:s.access_version}),aad("grant",childId,taskId,value.version));
   await c.query("INSERT INTO contact_grants(task_id,child_id,version,payload_encrypted) VALUES($1,$2,$3,$4) ON CONFLICT(task_id) DO UPDATE SET version=$3,payload_encrypted=$4",[taskId,childId,value.version,payload]);
   await c.query("INSERT INTO contact_grant_revisions(task_id,version,payload_encrypted) VALUES($1,$2,$3)",[taskId,value.version,payload]);
   if(input.enabled&&services.queue?.onGrant){
    const ref=(await c.query<{work_id:string;reminder_id:string}>("SELECT w.id AS work_id,r.id AS reminder_id FROM task_reminders r JOIN task_work w ON w.task_id=r.task_id AND w.task_version=r.task_version AND w.occurrence_id=r.occurrence_id JOIN worker_control ctl ON ctl.id=1 AND ctl.enabled AND ctl.generation=w.worker_generation WHERE r.task_id=$1 AND r.task_version=$2 AND w.storage_epoch=$3 AND w.status IN ('pending','processed') ORDER BY r.created_at DESC LIMIT 1",[taskId,t.version,s.storage_epoch])).rows[0];
    if(ref)await services.queue.onGrant(c,ref.work_id,ref.reminder_id,randomUUID());
   }
   await appendOnlineChange(c,s.id,"tasks",childId);return value;
  });},
  recordedForRun(userId:string,childId:string,runId:string){return access(userId,childId,false,async(c)=>{
   return (await c.query<{id:string}>("SELECT r.id FROM contact_requests r JOIN agent_runs a ON a.id=r.run_id AND a.owner_user_id=$1 AND a.child_id=r.child_id WHERE r.run_id=$2 AND r.child_id=$3 ORDER BY r.created_at LIMIT 8",[userId,runId,childId])).rows.map(row=>row.id);
  });},
  options(userId:string,childId:string,taskId:string){return access(userId,childId,false,async(c,s)=>{
   const value=await actionable(c,s,userId,childId,taskId);
   if(!value)return {eligible:false as const,reason:"Explicit current task grant, recipient consent, due event and applicable source are required."};
   const existing=(await c.query<RequestRow>("SELECT * FROM contact_requests WHERE reminder_id=$1",[value.reminder.id])).rows[0];
   return {eligible:true as const,taskId,taskVersion:value.t.version,grantVersion:value.g.value.version,recipientUserId:value.choice.userId,selectionReason:value.choice.reason,existing:existing?await view(c,existing):null};
  });},
  request(userId:string,childId:string,input:{taskId:string;taskVersion:number;grantVersion:number;recipientUserId:string;runId:string}){
   return access(userId,childId,true,async(c,s)=>{
    if(!services.queue)throw conflict("contact_worker_unavailable");
    const live=(await c.query<{data_version:string;authorization_version:string}>("SELECT data_version,authorization_version::text FROM agent_runs WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 AND state='running' AND expires_at>now() FOR UPDATE",[input.runId,userId,childId])).rows[0];
    const seq=(await c.query<{change_seq:string}>("SELECT change_seq::text FROM workspaces WHERE id=$1",[s.id])).rows[0].change_seq;
    if(!live||live.data_version!==s.storage_epoch+":"+seq||live.authorization_version!==String(s.access_version))throw conflict("contact_run_changed");
    const value=await actionable(c,s,userId,childId,input.taskId);
    if(!value||value.t.version!==input.taskVersion||value.g.value.version!==input.grantVersion||value.choice.userId!==input.recipientUserId)throw conflict("contact_authorization_required");
    const old=(await c.query<RequestRow>("SELECT * FROM contact_requests WHERE reminder_id=$1",[value.reminder.id])).rows[0];if(old)return view(c,old);
    const id=randomUUID(),jobId=randomUUID(),at=new Date(Date.now()+30000).toISOString();
    const saved:RequestSaved={grant:value.g,taskVersion:value.t.version,occurrenceId:value.t.occurrence.id,phase:value.reminder.phase,actorUserId:userId,runId:input.runId};
    const row=(await c.query<RequestRow>("INSERT INTO contact_requests(id,child_id,task_id,reminder_id,worker_generation,storage_epoch,job_id,state,next_at,payload_encrypted,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING *",[id,childId,input.taskId,value.reminder.id,value.reminder.worker_generation,value.reminder.storage_epoch,jobId,at,cipher.encrypt(JSON.stringify(saved),requestAad(id)),input.runId])).rows[0];
    await services.queue.enqueue(c,id,jobId,at);await appendOnlineChange(c,s.id,"tasks",childId);
    await c.query("UPDATE agent_runs SET data_version=$2||':'||(SELECT change_seq::text FROM workspaces WHERE id=$3) WHERE id=$1",[input.runId,s.storage_epoch,s.id]);
    return view(c,row);
   });
  },

  async process(id:string,jobId:string,gateways:{push:WebPushGateway;telegram:TelegramGateway},signal:AbortSignal){
   const attempt=await lockedRequest(id,async(c,s,row)=>{
    if(row.job_id!==jobId||row.state!=="pending")return null;
    const saved=decodeRequest(row),prior=(await c.query<AttemptRow>("SELECT * FROM contact_attempts WHERE request_id=$1 ORDER BY position",[id])).rows;
    if(prior.some(x=>x.status==="sending")){
     await c.query("UPDATE contact_attempts SET status='unknown',reason='worker_interrupted',callback_encrypted=NULL,finished_at=now() WHERE request_id=$1 AND status='sending'",[id]);
     await setState(c,s,row,"unknown","worker_interrupted");return null;
    }
    const current=await validRequest(c,s,row,saved);
    if(!current){await setState(c,s,row,"stopped","authorization_or_task_changed");return null;}
    if(signal.aborted){await setState(c,s,row,"stopped","worker_interrupted");return null;}
    if((await c.query("SELECT 1 FROM contact_attempts a JOIN contact_requests r ON r.id=a.request_id WHERE r.task_id=$1 AND a.status='unknown' AND a.acknowledged_at IS NULL LIMIT 1",[row.task_id])).rowCount){
     await setState(c,s,row,"stopped","earlier_delivery_unknown");return null;
    }
    const routes=saved.grant.targets.flatMap((target,index)=>target.bindings.map(binding=>({target,binding,backup:index>0})));
    const position=prior.length,route=routes[position];
    if(!route){await setState(c,s,row,"rejected","fallback_exhausted");return null;}
    const {target,binding,backup}=route;
    if(!await validTarget(c,s,row.child_id,target,backup)){await setState(c,s,row,"stopped","recipient_consent_changed");return null;}
    await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[target.userId]);
    const preferences=(await c.query<{preferences_encrypted:string;version:number}>("SELECT preferences_encrypted,version FROM notification_preferences WHERE user_id=$1",[target.userId])).rows[0];
    const prefs:NotificationPreferences=preferences?{...JSON.parse(cipher.decrypt(preferences.preferences_encrypted,"notification-preferences:"+target.userId)),version:preferences.version}:DEFAULT_NOTIFICATION_PREFERENCES;
    const now=new Date().toISOString(),evidence={authorized:true,assigneeEligible:true,deliveryUnknown:false,initialAt:null,followUpAt:null,lastOrdinaryBatchAt:null};
    const decision=reminderDecision(current,prefs,evidence,now);
    if(decision==="quiet"||decision==="not_due"){
     const at=nextReminderCheck(current,prefs,evidence,now);
     if(at&&Date.parse(at)<Date.parse(saved.grant.value.validUntil)){await defer(c,row,at);return null;}
     await setState(c,s,row,"stopped","authorization_expired");return null;
    }
    if(decision!=="initial"){await setState(c,s,row,"stopped","reminder_not_allowed");return null;}
    if(current.kind==="ordinary"){
     const day=reminderLocalTime(now,prefs.timeZone).day;
     const slot=(await c.query<{request_id:string|null}>("SELECT request_id FROM contact_daily_slots WHERE user_id=$1 AND local_day=$2",[target.userId,day])).rows[0];
     if(slot&&slot.request_id!==row.id){
      await c.query("UPDATE contact_requests SET grouped_to=$2 WHERE id=$1",[id,slot.request_id]);
      await setState(c,s,row,"coalesced","daily_slot_already_used");return null;
     }
     await c.query("INSERT INTO contact_daily_slots(user_id,local_day,request_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[target.userId,day,id]);
    }
    const active=(await bindings(c,target.userId)).some(b=>sameBinding(b,binding));
    const attemptId=randomUUID(),token=binding.channel==="telegram"?randomBytes(24).toString("base64url"):null;
    const next=(await c.query<AttemptRow>("INSERT INTO contact_attempts(id,request_id,position,recipient_user_id,channel,binding_id,binding_version,status,bot_id,callback_hash,callback_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7,'sending',$8,$9,$10) RETURNING *",[attemptId,id,position,target.userId,binding.channel,binding.bindingId,binding.bindingVersion,binding.channel==="telegram"?services.telegramBotId:null,token?hash(token):null,token?cipher.encrypt(token,callbackAad(attemptId)):null])).rows[0];
    if(current.kind==="ordinary")await c.query("UPDATE task_reminder_batches SET state='sealed' WHERE id=(SELECT batch_id FROM task_reminders WHERE id=$1)",[row.reminder_id]);
    await appendOnlineChange(c,s.id,"tasks",row.child_id);
    return {row:next,binding,target,token,active};
   });
   if(!attempt)return;
   const recheck=()=>lockedRequest(id,async(c,s,row)=>{
    if(row.state!=="pending"||row.job_id!==jobId||!await validRequest(c,s,row,decodeRequest(row)))return false;
    await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[attempt.target.userId]);
    const saved=decodeRequest(row);
    if(!await validTarget(c,s,row.child_id,attempt.target,saved.grant.targets[0].userId!==attempt.target.userId))return false;
    const a=(await c.query<AttemptRow>("SELECT * FROM contact_attempts WHERE id=$1",[attempt.row.id])).rows[0];
    if(a?.status!=="sending"||!(await bindings(c,attempt.target.userId)).some(b=>sameBinding(b,attempt.binding)))return false;
    const preference=(await c.query<{preferences_encrypted:string;version:number}>("SELECT preferences_encrypted,version FROM notification_preferences WHERE user_id=$1",[attempt.target.userId])).rows[0];
    const prefs:NotificationPreferences=preference?{...JSON.parse(cipher.decrypt(preference.preferences_encrypted,"notification-preferences:"+attempt.target.userId)),version:preference.version}:DEFAULT_NOTIFICATION_PREFERENCES;
    const t=await task(c,row.child_id,row.task_id);
    return Boolean(t&&reminderDecision(t,prefs,{authorized:true,assigneeEligible:true,deliveryUnknown:false,initialAt:null,followUpAt:null,lastOrdinaryBatchAt:null},new Date().toISOString())==="initial");
   }).then(Boolean);
   type Result={status:"accepted"|"rejected"|"unknown"|"stopped";reason:string|null;providerStatus:number|null;messageId?:number|null};
   let result:Result;
   if(!attempt.active)result={status:"rejected",reason:"binding_unavailable",providerStatus:null};
   else try{
    if(attempt.binding.channel==="web_push"){
     const r=(await pool.query<{subscription_encrypted:string}>("SELECT subscription_encrypted FROM web_push_subscriptions WHERE id=$1 AND user_id=$2 AND status='active' AND version=$3",[attempt.binding.bindingId,attempt.target.userId,attempt.binding.bindingVersion])).rows[0];
     if(!r)result={status:"stopped",reason:"revoked",providerStatus:null};
     else{
      const subscription=pushRegistrationInput.parse(JSON.parse(cipher.decrypt(r.subscription_encrypted,"web-push:"+attempt.target.userId+":"+attempt.binding.bindingId))).subscription;
      result=await gateways.push.send(subscription,{v:1,kind:"care",bindingId:attempt.binding.bindingId,bindingVersion:attempt.binding.bindingVersion,deliveryId:attempt.row.id},signal,recheck);
     }
    }else{
     const r=(await pool.query<{target_encrypted:string}>("SELECT target_encrypted FROM telegram_bindings WHERE id=$1 AND user_id=$2 AND status='active' AND version=$3 AND bot_id=$4",[attempt.binding.bindingId,attempt.target.userId,attempt.binding.bindingVersion,services.telegramBotId])).rows[0];
     if(!r)result={status:"stopped",reason:"revoked",providerStatus:null};
     else{
      const target=JSON.parse(cipher.decrypt(r.target_encrypted,"telegram:binding:"+attempt.target.userId+":"+attempt.binding.bindingId)) as {chatId:number};
      result=await gateways.telegram.send({chatId:target.chatId,callbackToken:attempt.token!,kind:"care"},signal,recheck);
     }
    }
   }catch{result={status:"unknown",reason:"transport_unknown",providerStatus:null};}
   await lockedRequest(id,async(c,s,row)=>{
    const recorded=(await c.query<AttemptRow>("SELECT * FROM contact_attempts WHERE id=$1 FOR UPDATE",[attempt.row.id])).rows[0];
    if(recorded?.acknowledged_at&&(result.status==="rejected"||result.status==="stopped"))result={...result,status:"unknown",reason:"receipt_without_provider_confirmation"};
    const changed=await c.query("UPDATE contact_attempts SET status=$2,reason=$3,provider_status=$4,message_id=coalesce(message_id,$5),callback_encrypted=NULL,finished_at=now() WHERE id=$1 AND status='sending' RETURNING id",[attempt.row.id,result.status,result.reason,result.providerStatus,result.messageId??null]);
    if(!changed.rowCount)return;
    if(result.reason==="blocked"&&attempt.binding.channel==="telegram"){
     await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[attempt.target.userId]);
     await c.query("UPDATE telegram_bindings SET status='blocked',version=version+1,target_hash=NULL,target_encrypted=NULL,updated_at=now() WHERE id=$1 AND version=$2 AND status='active'",[attempt.binding.bindingId,attempt.binding.bindingVersion]);
    }
    if(result.reason==="subscription_expired"&&attempt.binding.channel==="web_push"){
     await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[attempt.target.userId]);
     await c.query("UPDATE web_push_subscriptions SET status='expired',version=version+1,endpoint_hash=NULL,subscription_encrypted=NULL,updated_at=now() WHERE id=$1 AND version=$2 AND status='active'",[attempt.binding.bindingId,attempt.binding.bindingVersion]);
    }
    const saved=decodeRequest(row),routes=saved.grant.targets.flatMap(t=>t.bindings);
    if(result.status==="rejected"&&saved.grant.value.allowFallback&&attempt.row.position+1<routes.length&&await validRequest(c,s,row,saved)){
     await defer(c,row,new Date().toISOString());await appendOnlineChange(c,s.id,"tasks",row.child_id);
    }else await setState(c,s,row,result.status,result.status==="rejected"?"fallback_exhausted":result.reason);
   });
  },
  async reconcile(){
   const ids=(await pool.query<{id:string}>("SELECT r.id FROM contact_requests r LEFT JOIN pgboss.job j ON j.name='care-contact-v1' AND j.id=r.job_id WHERE r.state='pending' AND (j.id IS NULL OR j.state IN ('failed','cancelled','completed')) ORDER BY r.next_at,r.id LIMIT 50")).rows;
   for(const {id} of ids)await lockedRequest(id,async(c,s,row)=>{
    if(row.state!=="pending")return;
    const job=await c.query("SELECT 1 FROM pgboss.job WHERE name='care-contact-v1' AND id=$1 AND state NOT IN ('failed','cancelled','completed')",[row.job_id]);if(job.rowCount)return;
    const unknown=(await c.query("UPDATE contact_attempts SET status='unknown',reason='worker_interrupted',callback_encrypted=NULL,finished_at=now() WHERE request_id=$1 AND status='sending' RETURNING id",[id])).rowCount;
    await setState(c,s,row,unknown?"unknown":"stopped",unknown?"worker_interrupted":"worker_unavailable");
   });
  },
  async telegramAcknowledgement(event:Extract<TelegramEvent,{kind:"contact_ack"}>){
   if(!services.telegramBotId)return null;
   const found=(await pool.query<{request_id:string}>("SELECT request_id FROM contact_attempts WHERE callback_hash=$1 AND bot_id=$2",[hash(event.token),services.telegramBotId])).rows[0];if(!found)return null;
   return lockedRequest(found.request_id,async(c,s,row)=>{
    const a=(await c.query<AttemptRow>("SELECT * FROM contact_attempts WHERE callback_hash=$1 AND request_id=$2 FOR UPDATE",[hash(event.token),row.id])).rows[0];
    if(!a||!await eligible(c,s,a.recipient_user_id)||!["sending","accepted","unknown"].includes(a.status)||a.message_id!==null&&Number(a.message_id)!==event.messageId)return null;
    await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[a.recipient_user_id]);
    const b=(await c.query<{target_encrypted:string}>("SELECT target_encrypted FROM telegram_bindings WHERE id=$1 AND user_id=$2 AND version=$3 AND status='active' AND bot_id=$4",[a.binding_id,a.recipient_user_id,a.binding_version,services.telegramBotId])).rows[0];if(!b)return null;
    const target=JSON.parse(cipher.decrypt(b.target_encrypted,"telegram:binding:"+a.recipient_user_id+":"+a.binding_id)) as {chatId:number;senderId:number};
    if(target.chatId!==event.chatId||target.senderId!==event.senderId)return null;
    const fresh=await c.query("INSERT INTO contact_updates(bot_id,update_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING update_id",[services.telegramBotId,event.updateId]);
    if(fresh.rowCount){await c.query("UPDATE contact_attempts SET acknowledged_at=coalesce(acknowledged_at,now()),message_id=coalesce(message_id,$2) WHERE id=$1",[a.id,event.messageId]);await appendOnlineChange(c,s.id,"tasks",row.child_id);}
    return event.callbackQueryId;
   });
  },
  acknowledge(userId:string,childId:string,id:string){return access(userId,childId,true,async(c,s)=>{
   const row=(await c.query<AttemptRow>("SELECT a.* FROM contact_attempts a JOIN contact_requests r ON r.id=a.request_id WHERE a.id=$1 AND r.child_id=$2 AND a.recipient_user_id=$3 FOR UPDATE OF a",[id,childId,userId])).rows[0];
   if(!row||!["sending","accepted","unknown"].includes(row.status))throw missing();
   await c.query("UPDATE contact_attempts SET acknowledged_at=coalesce(acknowledged_at,now()) WHERE id=$1",[id]);await appendOnlineChange(c,s.id,"tasks",childId);return {acknowledged:true as const};
  });},
 };
 return api;
}
export type ContactStore=ReturnType<typeof createContactStore>;
