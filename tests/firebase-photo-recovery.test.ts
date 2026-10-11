import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { SaveOptions } from "@google-cloud/storage";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createFirebasePhotoObjects, FIREBASE_PHOTO_TIMEOUT_MS,
  type FirebasePhotoBucketPort, type FirebasePhotoSdkBucket } from "../server/firebase-photo-objects.ts";
import { createFirebasePhotoRecovery, createFirebasePhotoBackupBucketPort, FirebasePhotoRecoveryError,
  FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS, FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS,
  FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES } from "../server/firebase-photo-recovery.ts";
import type { WorkRecoveryScope } from "../server/firestore-work-continuation-recovery.ts";

const CONFIG={projectId:"synthetic-recovery-project",namespace:"unit_photo_recovery",backupBucketName:"independent-private-backup-bucket"};
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4),Buffer.from("IHDR"),Buffer.alloc(8)]);
const BASE64=PNG.toString("base64"),START=Date.parse("2026-10-11T12:00:00.000Z");
const rejects=(code:string)=>(error:unknown)=>error instanceof FirebasePhotoRecoveryError&&error.code===code&&error.message===code;
function memoryBucket(bucketName:string) {
  const records=new Map<string,{ciphertext:Buffer;metadata:any}>(),writes:{name:string;bytes:Buffer;options:SaveOptions}[]=[],
    metadataReads:{name:string;generation?:string}[]=[],streams:Readable[]=[];
  let lose=false,drop=false,stalled=false;
  const port:FirebasePhotoBucketPort={
    async writeNew(name,bytes,options) {
      writes.push({name,bytes:Buffer.from(bytes),options});
      if(drop)throw new Error("Synthetic unavailable private@example.test");
      if(records.has(name))throw Object.assign(new Error("Synthetic conflict"),{code:412});
      const metadata={...structuredClone(options.metadata),name,bucket:bucketName,
        generation:String(9007199254740993000n+BigInt(writes.length)),size:String(bytes.length)};
      records.set(name,{ciphertext:Buffer.from(bytes),metadata});
      if(lose){lose=false;throw new Error("Synthetic lost upload acknowledgement");}return structuredClone(metadata);
    },
    async metadata(name,generation) {
      metadataReads.push({name,generation});
      const record=records.get(name);
      if(!record||generation!==undefined&&record.metadata.generation!==generation)throw Object.assign(new Error("Synthetic missing"),{code:404});
      return structuredClone(record.metadata);
    },
    readPinned(name,generation) {
      let emitted=false;
      const stream=new Readable({read(){
        if(emitted)return;emitted=true;
        const record=records.get(name)!;
        this.emit("response",{statusCode:206,headers:{"x-goog-generation":generation,"content-length":String(record.ciphertext.length)}});
        if(stalled)return;this.push(record.ciphertext);this.push(null);
      }});
      streams.push(stream);return stream;
    },
  };
  return {port,records,writes,metadataReads,streams,lose:()=>{lose=true;},drop:()=>{drop=true;},stall:()=>{stalled=true;}};
}
async function fixture() {
  const scope:WorkRecoveryScope={ownerUserId:"synthetic-photo-backup-owner",workspaceId:randomUUID(),childId:randomUUID(),storageEpoch:randomUUID()};
  const targetScope={...scope,storageEpoch:randomUUID()},photoId=randomUUID(),backupId=randomUUID(),clock={at:START};
  const cipher=createStorageCipher(Buffer.alloc(32,45)),source=memoryBucket("source-private-photos"),backup=memoryBucket(CONFIG.backupBucketName),target=memoryBucket("restored-private-photos");
  const sourceObjects=createFirebasePhotoObjects({config:{projectId:CONFIG.projectId,namespace:CONFIG.namespace,bucketName:"source-private-photos"},cipher,bucket:source.port});
  const targetObjects=createFirebasePhotoObjects({config:{projectId:CONFIG.projectId,namespace:CONFIG.namespace,bucketName:"restored-private-photos"},cipher,bucket:target.port});
  const original=await sourceObjects.write(scope,photoId,{base64:BASE64,mimeType:"image/png"});
  const pinned:unknown[]=[];
  const options={config:CONFIG,cipher,backupBucket:backup.port,
    sourceObjects:{async read(s:WorkRecoveryScope,id:string,descriptor:typeof original){pinned.push({scope:s,photoId:id,descriptor});return sourceObjects.read(s,id,descriptor);}},
    targetObjects,serverClock:()=>clock.at};
  const recovery=createFirebasePhotoRecovery(options),input={backupId,scope,photoId,descriptor:original,
    retainedUntil:new Date(START+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS+12*60*60*1000).toISOString()};
  return {scope,targetScope,photoId,backupId,clock,cipher,source,backup,target,sourceObjects,targetObjects,original,pinned,options,recovery,input};
}

test("one pinned photo is privately backed up under a hold and restored to a different epoch without changing original bytes",async()=>{
  const f=await fixture(),original=structuredClone([...f.source.records]),saved=await f.recovery.backupPhoto(f.input);
  assert.equal(saved.objectName,"firebase-backups/v1/"+f.backupId+"/photos/"+f.photoId);
  assert.equal(typeof saved.generation,"string");assert.ok(BigInt(saved.generation)>BigInt(Number.MAX_SAFE_INTEGER));
  assert.deepEqual(f.pinned,[{scope:f.scope,photoId:f.photoId,descriptor:f.original}]);
  const write=f.backup.writes[0];
  assert.deepEqual(write.options.preconditionOpts,{ifGenerationMatch:0});assert.equal(write.options.resumable,false);
  assert.equal(write.options.validation,"crc32c");assert.equal(write.options.timeout,FIREBASE_PHOTO_TIMEOUT_MS);
  assert.equal(write.options.metadata?.temporaryHold,true);assert.equal(write.options.metadata?.metadata?.retainedUntil,f.input.retainedUntil);
  assert.equal(write.bytes.includes(BASE64),false);assert.equal(write.bytes.includes(PNG),false);
  assert.equal(JSON.stringify(write.options.metadata).includes(f.scope.ownerUserId),false);
  assert.equal(JSON.stringify(saved).includes(BASE64),false);assert.equal("base64" in saved,false);
  const backupState=structuredClone([...f.backup.records]),restored=await f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope});
  assert.notEqual(restored.objectName,f.original.objectName);assert.equal(restored.sha256,f.original.sha256);
  assert.equal(restored.bytes,f.original.bytes);assert.equal(restored.mimeType,f.original.mimeType);
  assert.deepEqual((await f.targetObjects.read(f.targetScope,f.photoId,restored)).buffer,PNG);
  assert.deepEqual(structuredClone([...f.source.records]),original);assert.deepEqual(structuredClone([...f.backup.records]),backupState);
  assert.deepEqual(Object.keys(f.recovery).sort(),["backupPhoto","restorePhoto"]);
});

test("unknown backup and target creates recover the same generation and never overwrite or select another backup name",async()=>{
  const f=await fixture();f.backup.lose();
  const saved=await f.recovery.backupPhoto(f.input);assert.equal(f.backup.writes.length,1);assert.equal(f.backup.records.size,1);
  assert.deepEqual(f.backup.metadataReads.map(row=>row.generation),[undefined,saved.generation]);
  const original=Buffer.from(f.backup.records.get(saved.objectName)!.ciphertext);
  assert.deepEqual(await f.recovery.backupPhoto(f.input),saved);assert.equal(f.backup.records.size,1);
  await assert.rejects(f.recovery.backupPhoto({...f.input,retainedUntil:new Date(Date.parse(f.input.retainedUntil)+1000).toISOString()}),rejects("photo_backup_conflict"));
  assert.deepEqual(f.backup.records.get(saved.objectName)!.ciphertext,original);
  f.target.lose();const restored=await f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope});
  assert.deepEqual(await f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope}),restored);
  assert.equal(f.target.records.size,1);
  const missing=await fixture();missing.backup.drop();
  await assert.rejects(missing.recovery.backupPhoto(missing.input),rejects("photo_backup_unavailable"));
  assert.equal(missing.backup.writes.length,1);assert.equal(missing.backup.records.size,0);
});

test("retention outside fourteen to fifteen days is rejected before source reads and an expired held backup cannot restore",async()=>{
  const f=await fixture();
  for(const offset of [FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS-1,FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS+1])
    await assert.rejects(f.recovery.backupPhoto({...f.input,retainedUntil:new Date(START+offset).toISOString()}),rejects("photo_backup_invalid"));
  assert.equal(f.pinned.length,0);assert.equal(f.backup.writes.length,0);
  const saved=await f.recovery.backupPhoto(f.input);f.clock.at=Date.parse(saved.retainedUntil);
  await assert.rejects(f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope}),rejects("photo_backup_expired"));
  assert.equal(f.target.writes.length,0);assert.equal(f.backup.records.get(saved.objectName)!.metadata.temporaryHold,true);
});

test("missing hold, changed retention, oversized metadata and forged ciphertext hashes fail before target writes",async()=>{
  for(const change of ["hold","retention","size","cipher"] as const) {
    const f=await fixture(),saved=await f.recovery.backupPhoto(f.input),record=f.backup.records.get(saved.objectName)!;
    let descriptor=saved;
    if(change==="hold")delete record.metadata.temporaryHold;
    if(change==="retention")record.metadata.metadata.retainedUntil=new Date(Date.parse(saved.retainedUntil)+1000).toISOString();
    if(change==="size")record.metadata.size=String(FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES+1);
    if(change==="cipher") {
      record.ciphertext[record.ciphertext.length-5]^=1;
      const hash=createHash("sha256").update(record.ciphertext).digest("hex");record.metadata.metadata.cipherSha256=hash;descriptor={...saved,cipherSha256:hash};
    }
    await assert.rejects(f.recovery.restorePhoto({backupId:f.backupId,backup:descriptor,targetScope:f.targetScope}),rejects("photo_backup_integrity"));
    assert.equal(f.target.writes.length,0);assert.equal(f.backup.streams.every(stream=>stream.destroyed),true);
    if(change==="hold"||change==="size")assert.equal(f.backup.streams.length,0);
  }
});

test("object/project bindings and scope changes other than a new epoch cannot restore or disclose a mismatched original",async()=>{
  const f=await fixture(),saved=await f.recovery.backupPhoto(f.input);
  await assert.rejects(f.recovery.restorePhoto({backupId:randomUUID(),backup:saved,targetScope:f.targetScope}),rejects("photo_backup_conflict"));
  for(const targetScope of [f.scope,{...f.targetScope,ownerUserId:"another-owner"},{...f.targetScope,workspaceId:randomUUID()},{...f.targetScope,childId:randomUUID()}])
    await assert.rejects(f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope}),rejects("photo_backup_conflict"));
  const wrongProject=createFirebasePhotoRecovery({...f.options,config:{...CONFIG,projectId:"another-recovery-project"}});
  await assert.rejects(wrongProject.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope}),rejects("photo_backup_integrity"));
  await assert.rejects(f.recovery.backupPhoto({...f.input,scope:{...f.scope,storageEpoch:randomUUID()}}),rejects("photo_backup_conflict"));
  const movedName="firebase-backups/v1/"+f.backupId+"/photos/"+randomUUID(),moved=structuredClone(f.backup.records.get(saved.objectName)!);
  moved.metadata.name=movedName;f.backup.records.set(movedName,moved);
  await assert.rejects(f.recovery.restorePhoto({backupId:f.backupId,backup:{...saved,objectName:movedName},targetScope:f.targetScope}),rejects("photo_backup_integrity"));
  assert.equal(f.target.writes.length,0);
});

test("backup streams have an absolute twenty-second deadline and are destroyed on failure",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const f=await fixture(),saved=await f.recovery.backupPhoto(f.input);f.backup.stall();
  const denied=assert.rejects(f.recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope}),rejects("photo_backup_unavailable"));
  await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(FIREBASE_PHOTO_TIMEOUT_MS);await denied;
  assert.equal(f.backup.streams.at(-1)?.destroyed,true);assert.equal(f.target.writes.length,0);
});

test("the public backup SDK adapter preserves exact generations and its own larger bounded Range",async()=>{
  const f=await fixture(),saved=await f.recovery.backupPhoto(f.input),requests:any[]=[];
  const sdk:FirebasePhotoSdkBucket={file(name){return {
    get metadata(){return f.backup.records.get(name)?.metadata;},
    async save(){throw new Error("Unexpected create");},
    async request(input){requests.push(input);return [await f.backup.port.metadata(name,input.qs?.generation),{statusCode:200}];},
    requestStream(input){requests.push(input);return f.backup.port.readPinned(name,input.qs!.generation!);},
  };}};
  const recovery=createFirebasePhotoRecovery({...f.options,backupBucket:createFirebasePhotoBackupBucketPort(sdk)});
  await recovery.restorePhoto({backupId:f.backupId,backup:saved,targetScope:f.targetScope});
  assert.equal(requests[0].qs.generation,saved.generation);assert.equal(requests[1].qs.generation,saved.generation);
  assert.equal(requests[1].headers.Range,"bytes=0-"+FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES);
  assert.equal(requests[1].headers["Accept-Encoding"],"identity");assert.equal(requests[1].gzip,false);
  assert.equal(requests.every(input=>input.timeout===FIREBASE_PHOTO_TIMEOUT_MS),true);
});