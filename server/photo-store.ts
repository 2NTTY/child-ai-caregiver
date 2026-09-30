import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PhotoAttachment, PhotoMetadata, PhotoDraft, PhotoConfirmation } from "../src/shared/photos.ts";
import { PHOTO_LIMITS, photoDraftSchema } from "../src/shared/photos.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError, READ_ROLES, WRITE_ROLES, requireFamilyVersion, withChildAccess } from "./family-access.ts";
import { createCareStore } from "./care.ts";
import { transactionPool } from "./transaction-pool.ts";
import { appendOnlineChange } from "./online-change.ts";
import { decodePhoto, photoHash, photoFileName, type PhotoFiles } from "./photo-files.ts";
import type { AgentScope } from "./agent-runtime.ts";

interface Row {
  id:string;child_id:string;owner_user_id:string;mime_type:PhotoMetadata["mimeType"];byte_size:number;sha256:string;
  metadata_encrypted:string;state:PhotoAttachment["state"];visibility:PhotoAttachment["visibility"];version:number;record_id:string|null;
  extraction_state:PhotoAttachment["extraction"]["state"];extraction_run_id:string|null;extraction_expires_at:Date|null;
  extraction_access_version:number|null;extraction_encrypted:string|null;created_at:Date;
}
const aad=(id:string,field:string)=>"photo:"+id+":"+field;
const missing=()=>new FamilyError(404,"not_found");
export function createPhotoStore(pool:Pool,cipher:StorageCipher,files:PhotoFiles) {
  const owns=(row:Row,userId:string,role:string)=>row.visibility==="private"?row.owner_user_id===userId:role==="owner"||role==="caregiver";
  const visible=(row:Row,userId:string)=>row.owner_user_id===userId||row.visibility==="shared";
  function decode(row:Row,userId:string,role:string):PhotoAttachment {
    const metadata=JSON.parse(cipher.decrypt(row.metadata_encrypted,aad(row.id,"metadata"))) as Pick<PhotoMetadata,"fileName"|"source">;
    const extraction=row.extraction_encrypted&&row.owner_user_id===userId?JSON.parse(cipher.decrypt(row.extraction_encrypted,aad(row.id,"extraction"))):{};
    return {...metadata,id:row.id,childId:row.child_id,ownerUserId:row.owner_user_id,mimeType:row.mime_type,
      bytes:row.byte_size,sha256:row.sha256,createdAt:row.created_at.toISOString(),version:row.version,state:row.state,
      visibility:row.visibility,canManage:WRITE_ROLES.includes(role as "owner"|"caregiver")&&owns(row,userId,role),recordId:row.record_id,
      extraction:{state:row.extraction_state==="running"&&row.extraction_expires_at!<=new Date()?"unknown":row.extraction_state,
        runId:row.extraction_run_id,draft:extraction.draft??null,stopReason:extraction.stopReason??null,
        processedAt:extraction.processedAt??null,model:extraction.model??null}};
  }
  const rowFor=async(client:PoolClient,id:string,childId:string)=>{
    const row=(await client.query<Row>("SELECT * FROM photo_attachments WHERE id=$1 AND child_id=$2 FOR UPDATE",[id,childId])).rows[0];
    if(!row)throw missing();return row;
  };
  const access=<T>(userId:string,childId:string,write:boolean,action:(client:PoolClient,role:string,space:string)=>Promise<T>)=>
    withChildAccess(pool,userId,childId,write?WRITE_ROLES:READ_ROLES,action,write);
  const service={
    async list(userId:string,childId:string) {
      return access(userId,childId,false,async(client,role)=>{
        const rows=(await client.query<Row>("SELECT * FROM photo_attachments WHERE child_id=$1 AND (owner_user_id=$2 OR visibility='shared') ORDER BY created_at DESC,id LIMIT 100",[childId,userId])).rows;
        return {photos:rows.map(row=>decode(row,userId,role)),canCreate:role!=="viewer"};
      });
    },
    async get(userId:string,childId:string,id:string) {
      return access(userId,childId,false,async(client,role)=>{
        const row=await rowFor(client,id,childId);if(!visible(row,userId))throw missing();return decode(row,userId,role);
      });
    },
    async reserve(userId:string,childId:string,input:PhotoMetadata) {
      return access(userId,childId,true,async(client,role,space)=>{
        await client.query("SELECT pg_advisory_xact_lock(71402321)");
        const counts=(await client.query<{count:string;bytes:string}>("SELECT count(*)::text AS count,coalesce(sum(byte_size),0)::text AS bytes FROM photo_attachments WHERE child_id=$1",[childId])).rows[0];
        const total=(await client.query<{bytes:string;count:string}>("SELECT coalesce(sum(byte_size),0)::text AS bytes,count(*)::text AS count FROM (SELECT byte_size FROM photo_attachments UNION ALL SELECT byte_size FROM photo_file_deletions) occupied")).rows[0];
        if(Number(counts.count)>=PHOTO_LIMITS.count||Number(counts.bytes)+input.bytes>PHOTO_LIMITS.childBytes||Number(total.bytes)+input.bytes>PHOTO_LIMITS.totalBytes||Number(total.count)>=PHOTO_LIMITS.totalCount)throw new FamilyError(409,"photo_capacity");
        const id=randomUUID();
        const row=(await client.query<Row>(`INSERT INTO photo_attachments(id,child_id,owner_user_id,mime_type,byte_size,sha256,relative_path,metadata_encrypted)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,childId,userId,input.mimeType,input.bytes,input.sha256,photoFileName(id),
          cipher.encrypt(JSON.stringify({fileName:input.fileName,source:input.source}),aad(id,"metadata"))])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);
        return decode(row,userId,role);
      });
    },
    async upload(userId:string,childId:string,id:string,base64:string) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);if(row.owner_user_id!==userId)throw missing();
        let bytes:Buffer;try{bytes=decodePhoto(base64,row.mime_type);}catch{throw new FamilyError(400,"invalid_photo");}
        if(bytes.length!==row.byte_size||photoHash(bytes)!==row.sha256)throw new FamilyError(400,"photo_hash_mismatch");
        await files.write(id,base64);
        if(row.state==="reserved"){
          const changed=(await client.query<Row>("UPDATE photo_attachments SET state='ready',version=version+1 WHERE id=$1 RETURNING *",[id])).rows[0];
          await appendOnlineChange(client,space,"care",childId,false,userId);return decode(changed,userId,role);
        }
        return decode(row,userId,role);
      });
    },
    async content(userId:string,childId:string,id:string) {
      return access(userId,childId,false,async client=>{
        const row=await rowFor(client,id,childId);if(!visible(row,userId)||row.state!=="ready")throw missing();
        const base64=await files.read(id),bytes=decodePhoto(base64,row.mime_type);
        if(bytes.length!==row.byte_size||photoHash(bytes)!==row.sha256)throw new Error("Attachment integrity failed");
        return {base64,bytes,mimeType:row.mime_type};
      });
    },
    async claimExtraction(userId:string,childId:string,id:string,expectedVersion:number) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);
        if(row.owner_user_id!==userId||row.visibility!=="private"||row.state!=="ready")throw missing();
        if(row.extraction_state!=="not_requested"&&(row.extraction_state!=="failed"||row.version!==expectedVersion))
          return {created:false,photo:decode(row,userId,role),scope:null};
        requireFamilyVersion(row.version,expectedVersion);
        const version=(await client.query<{access_version:number;storage_epoch:string;change_seq:string}>("SELECT access_version,storage_epoch,change_seq::text FROM workspaces WHERE id=$1",[space])).rows[0];
        const changed=(await client.query<Row>(`UPDATE photo_attachments SET extraction_state='running',extraction_run_id=$2,
          extraction_expires_at=now()+interval '95 seconds',extraction_access_version=$3,version=version+1 WHERE id=$1 RETURNING *`,[id,randomUUID(),version.access_version])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);
        const scope:AgentScope={userId,childId,workspaceId:space,authorizationVersion:String(version.access_version),dataVersion:version.storage_epoch+":"+version.change_seq};
        return {created:true,photo:decode(changed,userId,role),scope};
      });
    },
    async extractionAuthorized(userId:string,childId:string,id:string,runId:string) {
      return Boolean(await access(userId,childId,false,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);
        const version=(await client.query<{access_version:number}>("SELECT access_version FROM workspaces WHERE id=$1",[space])).rows[0];
        return role!=="viewer"&&row.owner_user_id===userId&&row.visibility==="private"&&row.state==="ready"
          &&row.extraction_run_id===runId&&row.extraction_state==="running"&&row.extraction_expires_at!>new Date()
          &&row.extraction_access_version===version.access_version;
      }));
    },
    async finishExtraction(userId:string,childId:string,id:string,runId:string,draft:PhotoDraft|null,stopReason:string|null,model:string|null) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);
        const version=(await client.query<{access_version:number}>("SELECT access_version FROM workspaces WHERE id=$1",[space])).rows[0];
        if(row.owner_user_id!==userId||row.visibility!=="private"||row.extraction_run_id!==runId)throw missing();
        if(row.extraction_state!=="running")return decode(row,userId,role);
        const allowed=row.extraction_access_version===version.access_version&&row.extraction_expires_at!>new Date();
        const value={draft:allowed&&draft?photoDraftSchema.parse(draft):null,stopReason:allowed?stopReason:"unauthorized_or_expired",processedAt:new Date().toISOString(),model};
        const state=value.draft?"available":stopReason==="cancelled"||stopReason==="deadline"||!allowed?"unknown":"failed";
        const changed=(await client.query<Row>("UPDATE photo_attachments SET extraction_state=$2,extraction_encrypted=$3,version=version+1 WHERE id=$1 RETURNING *",
          [id,state,cipher.encrypt(JSON.stringify(value),aad(id,"extraction"))])).rows[0];
        await appendOnlineChange(client,space,"care",childId,false,userId);return decode(changed,userId,role);
      });
    },
    async confirm(userId:string,childId:string,id:string,input:PhotoConfirmation) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);
        if(row.owner_user_id!==userId||row.visibility!=="private"||row.state!=="ready"||row.record_id)throw missing();
        requireFamilyVersion(row.version,input.expectedVersion);
        if(row.extraction_state==="running"&&row.extraction_expires_at!>new Date())throw new FamilyError(409,"photo_processing");
        const bytes=decodePhoto(await files.read(id),row.mime_type);
        if(photoHash(bytes)!==row.sha256)throw new Error("Attachment integrity failed");
        const meta=decode(row,userId,role),borrowed=transactionPool(client);
        const record=await createCareStore(borrowed.pool,cipher,true).create(userId,childId,{...input.values,
          source:"照片 "+id+" · SHA-256 "+row.sha256+" · 上傳 "+meta.createdAt+" · "+meta.source});
        borrowed.assertReleased();if(!record)throw missing();
        const changed=(await client.query<Row>("UPDATE photo_attachments SET visibility='shared',record_id=$2,version=version+1 WHERE id=$1 RETURNING *",[id,record.id])).rows[0];
        await appendOnlineChange(client,space,"care",childId);
        return {photo:decode(changed,userId,role),recordId:record.id};
      });
    },
    async delete(userId:string,childId:string,id:string,expectedVersion:number) {
      return access(userId,childId,true,async(client,role,space)=>{
        const row=await rowFor(client,id,childId);if(!owns(row,userId,role))throw missing();
        requireFamilyVersion(row.version,expectedVersion);
        if(row.record_id){
          const record=(await client.query<{version:number}>("SELECT version FROM text_records WHERE id=$1 FOR UPDATE",[row.record_id])).rows[0];
          if(record){const borrowed=transactionPool(client);await createCareStore(borrowed.pool,cipher,true).delete(userId,childId,row.record_id,record.version);borrowed.assertReleased();}
        }
        await client.query("DELETE FROM photo_attachments WHERE id=$1",[id]);
        await client.query("UPDATE online_operations SET result_encrypted=NULL WHERE child_id=$1 AND kind='care'",[childId]);
        await appendOnlineChange(client,space,"care",childId,true,row.visibility==="private"?userId:undefined);
        return {deleted:true as const,cleanupPending:true as const};
      });
    },
    async purgeDeleted() {
      const rows=(await pool.query<{id:string}>("SELECT id FROM photo_file_deletions ORDER BY created_at LIMIT 100")).rows;
      for(const row of rows){await files.remove(row.id);await pool.query("DELETE FROM photo_file_deletions WHERE id=$1",[row.id]);}
    },
  };
  return service;
}
export type PhotoStore=ReturnType<typeof createPhotoStore>;
