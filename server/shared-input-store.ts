import { createHash,randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import type { SharedInput,SharedInputCreate,SharedInputConfirmation } from "../src/shared/shared-inputs.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import { photoDraftSchema,type PhotoDraft } from "../src/shared/photos.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError,READ_ROLES,WRITE_ROLES,requireFamilyVersion,withChildAccess } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";
import { createCareStore } from "./care.ts";
import { transactionPool } from "./transaction-pool.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import type { ObservedContent } from "./knowledge-refresh-types.ts";
import type { AgentScope } from "./agent-runtime.ts";

export const publicInputSources=SOURCE_WATCHES.filter(source=>source.kind==="page"&&source.audience==="public_noncommercial");
interface Payload {
  sourceLabel:string;sourceUrl:string|null;sourceDateText:string|null;text:string;sha256:string|null;retrievedAt:string|null;
  excerpt:string|null;draft:PhotoDraft|null;stopReason:string|null;processedAt:string|null;model:string|null;
}
interface Row {
  id:string;child_id:string;owner_user_id:string;kind:SharedInput["kind"];source_id:string|null;payload_encrypted:string;version:number;
  fetch_state:SharedInput["fetchState"];fetch_run_id:string|null;fetch_expires_at:Date|null;fetch_access_version:number|null;
  extraction_state:SharedInput["extraction"]["state"];extraction_run_id:string|null;extraction_expires_at:Date|null;extraction_access_version:number|null;
  record_id:string|null;confirmation_kind:SharedInput["confirmationKind"];created_at:Date;
}
const missing=()=>new FamilyError(404,"not_found");
const hash=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const aad=(id:string)=>"shared-input:"+id+":payload";
type Phase="fetch"|"extraction";
export function createSharedInputStore(pool:Pool,cipher:StorageCipher) {
  const payload=(row:Row)=>JSON.parse(cipher.decrypt(row.payload_encrypted,aad(row.id))) as Payload;
  function decode(row:Row,role:string):SharedInput {
    const data=payload(row);
    return {id:row.id,childId:row.child_id,ownerUserId:row.owner_user_id,version:row.version,createdAt:row.created_at.toISOString(),
      canManage:role!=="viewer",kind:row.kind,sourceId:row.source_id,sourceLabel:data.sourceLabel,sourceUrl:data.sourceUrl,
      sourceDateText:data.sourceDateText,text:data.text,sha256:data.sha256,retrievedAt:data.retrievedAt,
      fetchState:row.fetch_state==="running"&&row.fetch_expires_at!<=new Date()?"unknown":row.fetch_state,
      extraction:{state:row.extraction_state==="running"&&row.extraction_expires_at!<=new Date()?"unknown":row.extraction_state,
        runId:row.extraction_run_id,excerpt:data.excerpt,draft:data.draft,stopReason:data.stopReason,processedAt:data.processedAt,model:data.model},
      recordId:row.record_id,confirmationKind:row.confirmation_kind};
  }
  const rowFor=async(client:PoolClient,userId:string,childId:string,id:string)=>{
    const row=(await client.query<Row>("SELECT * FROM shared_inputs WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 FOR UPDATE",[id,childId,userId])).rows[0];
    if(!row)throw missing();return row;
  };
  const access=<T>(userId:string,childId:string,write:boolean,action:(client:PoolClient,role:string,space:string)=>Promise<T>)=>
    withChildAccess(pool,userId,childId,write?WRITE_ROLES:READ_ROLES,action,write);
  const versions=async(client:PoolClient,space:string)=>(await client.query<{access_version:number;storage_epoch:string;change_seq:string}>(
    "SELECT access_version,storage_epoch,change_seq::text FROM workspaces WHERE id=$1",[space])).rows[0];
  const service={
    async list(userId:string,childId:string) {
      return access(userId,childId,false,async(client,role)=>{
        const rows=(await client.query<Row>("SELECT * FROM shared_inputs WHERE child_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC,id LIMIT 50",[childId,userId])).rows;
        return {inputs:rows.map(row=>decode(row,role)),sources:publicInputSources.map(({id,url,publisher})=>({id,url,publisher})),canCreate:role!=="viewer"};
      });
    },
    async get(userId:string,childId:string,id:string) {
      return access(userId,childId,false,async(client,role)=>decode(await rowFor(client,userId,childId,id),role));
    },
    async create(userId:string,childId:string,input:SharedInputCreate) {
      return access(userId,childId,true,async(client,role,space)=>{
        // The workspace write lock serializes the per-child cap.
        const count=(await client.query<{count:string}>("SELECT count(*)::text AS count FROM shared_inputs WHERE child_id=$1",[childId])).rows[0];
        if(Number(count.count)>=50)throw new FamilyError(409,"inputs_capacity");
        const source=input.kind==="public_source"?publicInputSources.find(source=>source.id===input.sourceId):undefined;
        if(input.kind==="public_source"&&!source)throw new FamilyError(400,"invalid_input");
        const data:Payload={sourceLabel:input.kind==="paste"?input.sourceLabel:source!.publisher,sourceUrl:input.kind==="paste"?input.sourceUrl:source!.url,
          sourceDateText:input.kind==="paste"?input.sourceDateText:null,text:input.kind==="paste"?input.text:"",sha256:input.kind==="paste"?hash(input.text):null,
          retrievedAt:null,excerpt:null,draft:null,stopReason:null,processedAt:null,model:null};
        const id=randomUUID(),row=(await client.query<Row>(`INSERT INTO shared_inputs(id,child_id,owner_user_id,kind,source_id,payload_encrypted,fetch_state)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,childId,userId,input.kind,source?.id??null,
          cipher.encrypt(JSON.stringify(data),aad(id)),input.kind==="paste"?"ready":"not_requested"])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);return decode(row,role);
      });
    },
    async claim(userId:string,childId:string,id:string,phase:Phase,expectedVersion:number,excerpt?:string) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id);
        if(row.record_id||phase==="fetch"&&row.kind!=="public_source"||phase==="extraction"&&row.fetch_state!=="ready")throw missing();
        const state=row[phase+"_state" as "fetch_state"|"extraction_state"];
        // A lost response never launches a new run. Only an explicit failed/current-version retry can do that.
        if(state!=="not_requested"&&(state!=="failed"||row.version!==expectedVersion))return {created:false,input:decode(row,role),scope:null,runId:null};
        requireFamilyVersion(row.version,expectedVersion);
        const data=payload(row);
        if(phase==="extraction"){
          if(!excerpt?.trim()||excerpt.length>10000||!data.text.includes(excerpt))throw new FamilyError(400,"invalid_input");
          data.excerpt=excerpt;data.draft=null;data.stopReason=null;data.processedAt=null;data.model=null;
        }else if(!publicInputSources.some(source=>source.id===row.source_id))throw missing();
        const version=await versions(client,space),runId=randomUUID();
        // phase is a closed internal union, never a request field.
        const changed=(await client.query<Row>(`UPDATE shared_inputs SET ${phase}_state='running',${phase}_run_id=$2,
          ${phase}_expires_at=now()+($3::int * interval '1 second'),${phase}_access_version=$4,payload_encrypted=$5,version=version+1 WHERE id=$1 RETURNING *`,
          [id,runId,phase==="fetch"?25:95,version.access_version,cipher.encrypt(JSON.stringify(data),aad(id))])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);
        const scope:AgentScope={userId,childId,workspaceId:space,authorizationVersion:String(version.access_version),dataVersion:version.storage_epoch+":"+version.change_seq};
        return {created:true,input:decode(changed,role),scope,runId};
      });
    },
    async authorized(userId:string,childId:string,id:string,phase:Phase,runId:string) {
      return Boolean(await access(userId,childId,false,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id),version=await versions(client,space);
        return role!=="viewer"&&!row.record_id&&row[phase+"_state" as "fetch_state"|"extraction_state"]==="running"
          &&row[phase+"_run_id" as "fetch_run_id"|"extraction_run_id"]===runId
          &&row[phase+"_access_version" as "fetch_access_version"|"extraction_access_version"]===version.access_version
          &&row[phase+"_expires_at" as "fetch_expires_at"|"extraction_expires_at"]!>new Date();
      }));
    },
    async finishFetch(userId:string,childId:string,id:string,runId:string,content:ObservedContent|null,uncertain:boolean) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id),version=await versions(client,space);
        if(row.fetch_run_id!==runId||row.record_id)throw missing();
        if(row.fetch_state!=="running")return decode(row,role);
        const allowed=row.fetch_access_version===version.access_version&&row.fetch_expires_at!>new Date();
        const data=payload(row);
        if(content&&allowed){
          if(!content.text.trim()||content.text.length>64000||/[\u0000\uD800-\uDFFF]/u.test(content.text)||content.url!==data.sourceUrl)throw new FamilyError(400,"invalid_input");
          data.text=content.text;data.sha256=hash(content.text);data.retrievedAt=new Date().toISOString();data.sourceDateText=content.sourceDateText;
        }
        const state=allowed&&content?"ready":!allowed||uncertain?"unknown":"failed";
        const changed=(await client.query<Row>("UPDATE shared_inputs SET fetch_state=$2,payload_encrypted=$3,version=version+1 WHERE id=$1 RETURNING *",
          [id,state,cipher.encrypt(JSON.stringify(data),aad(id))])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);return decode(changed,role);
      });
    },
    async finishExtraction(userId:string,childId:string,id:string,runId:string,draft:PhotoDraft|null,stopReason:string|null,model:string|null) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id),version=await versions(client,space);
        if(row.extraction_run_id!==runId||row.record_id)throw missing();
        if(row.extraction_state!=="running")return decode(row,role);
        const allowed=row.extraction_access_version===version.access_version&&row.extraction_expires_at!>new Date();
        const data=payload(row);
        Object.assign(data,{draft:allowed&&draft?photoDraftSchema.parse(draft):null,stopReason:allowed?stopReason:"unauthorized_or_expired",processedAt:new Date().toISOString(),model});
        const state=data.draft?"available":!allowed||stopReason==="cancelled"||stopReason==="deadline"?"unknown":"failed";
        const changed=(await client.query<Row>("UPDATE shared_inputs SET extraction_state=$2,payload_encrypted=$3,version=version+1 WHERE id=$1 RETURNING *",
          [id,state,cipher.encrypt(JSON.stringify(data),aad(id))])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);return decode(changed,role);
      });
    },
    async confirm(userId:string,childId:string,id:string,input:SharedInputConfirmation) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id);
        if(row.record_id||row.fetch_state!=="ready")throw missing();
        requireFamilyVersion(row.version,input.expectedVersion);
        if(row.extraction_state==="running"&&row.extraction_expires_at!>new Date())throw new FamilyError(409,"input_processing");
        if(input.kind==="family_record"&&!input.confirmChildFact)throw new FamilyError(400,"invalid_input");
        const data=payload(row),borrowed=transactionPool(client);
        const reference=input.kind==="reference";
        const source=(reference?"外部參考（不是孩子事實）":"家長確認與孩子有關")+" · 輸入 "+id+" · SHA-256 "+data.sha256
          +" · 保存 "+row.created_at.toISOString()+" · "+data.sourceLabel;
        const record=await createCareStore(borrowed.pool,cipher,true).create(userId,childId,{...input.values,
          details:reference?emptyCareDetails():input.values.details,source});
        borrowed.assertReleased();if(!record)throw missing();
        const changed=(await client.query<Row>("UPDATE shared_inputs SET record_id=$2,confirmation_kind=$3,version=version+1 WHERE id=$1 RETURNING *",[id,record.id,input.kind])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);return {input:decode(changed,role),recordId:record.id};
      });
    },
    async delete(userId:string,childId:string,id:string,expectedVersion:number) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,userId,childId,id);requireFamilyVersion(row.version,expectedVersion);
        if(row.record_id){
          const record=(await client.query<{version:number}>("SELECT version FROM text_records WHERE id=$1 FOR UPDATE",[row.record_id])).rows[0];
          if(record){const borrowed=transactionPool(client);await createCareStore(borrowed.pool,cipher,true).delete(userId,childId,row.record_id,record.version);borrowed.assertReleased();}
        }
        await client.query("DELETE FROM shared_inputs WHERE id=$1",[id]);
        await client.query("UPDATE online_operations SET result_encrypted=NULL WHERE child_id=$1 AND kind='care'",[childId]);
        await appendOnlineChange(client,space,"care",childId,true,userId);return {deleted:true as const};
      });
    },
  };
  return service;
}
export type SharedInputStore=ReturnType<typeof createSharedInputStore>;
