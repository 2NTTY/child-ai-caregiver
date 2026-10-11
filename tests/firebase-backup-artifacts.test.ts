import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import type { Bucket, SaveOptions } from "@google-cloud/storage";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { canonical } from "../server/firestore-session-codec.ts";
import { FIREBASE_PHOTO_TIMEOUT_MS } from "../server/firebase-photo-objects.ts";
import { FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS, FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS } from "../server/firebase-photo-recovery.ts";
import { createFirebaseBackupArtifacts, createFirebaseBackupArtifactBucketPort, FirebaseBackupArtifactError,
  FIREBASE_NATIVE_EXPORT_MAX_BYTES, FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES,
  type FirebaseBackupArtifactBucketPort, type FirebaseBackupManifestPayload, type FirebaseBackupManifestDescriptor } from "../server/firebase-backup-artifacts.ts";

const START = Date.parse("2026-10-11T12:00:00.000Z");
const hash = (value:string|Buffer) => createHash("sha256").update(value).digest("hex");
const code = (expected:string) => (error:unknown) => error instanceof FirebaseBackupArtifactError
  && error.code===expected && error.message===expected;
interface Record { bytes:Buffer; metadata:any }
class MemoryBucket implements FirebaseBackupArtifactBucketPort {
  readonly records=new Map<string,Record>();
  readonly listCalls:{prefix:string;token?:string}[]=[];
  readonly holds:{name:string;generation:string;metageneration:string}[]=[];
  readonly writes:{name:string;bytes:Buffer;options:SaveOptions}[]=[];
  readonly metadataCalls:{name:string;generation?:string}[]=[];
  readonly streams:Readable[]=[];
  pageSize=2;lostWrite=false;dropWrite=false;lostHold=false;stall=false;extraMedia=false;
  beforeHold?:()=>void;
  listOverride?:FirebaseBackupArtifactBucketPort["list"];
  readonly bucketName:string;
  constructor(bucketName:string) {this.bucketName=bucketName;}
  add(name:string,size=10,held=false) {
    const index=this.records.size+1;
    const record={bytes:Buffer.alloc(size,index),metadata:{name,bucket:this.bucketName,
      generation:String(9007199254740993000n+BigInt(index)),metageneration:String(9007199254740994000n+BigInt(index)),
      size:String(size),crc32c:Buffer.alloc(4,index).toString("base64"),temporaryHold:held}};
    this.records.set(name,record);return record;
  }
  async list(prefix:string,token?:string) {
    this.listCalls.push({prefix,token});if(this.listOverride)return this.listOverride(prefix,token);
    const values=[...this.records.values()].filter(row=>row.metadata.name.startsWith(prefix)).sort((a,b)=>a.metadata.name.localeCompare(b.metadata.name));
    const offset=token===undefined?0:Number(token),end=offset+this.pageSize;
    return {objects:values.slice(offset,end).map(row=>structuredClone(row.metadata)),
      ...(end<values.length?{nextPageToken:String(end)}:{})};
  }
  async metadata(name:string,generation?:string) {
    this.metadataCalls.push({name,generation});const row=this.records.get(name);
    if(!row || generation!==undefined&&row.metadata.generation!==generation)throw Object.assign(new Error("private missing object"),{code:404});
    return structuredClone(row.metadata);
  }
  async hold(name:string,generation:string,metageneration:string) {
    this.holds.push({name,generation,metageneration});this.beforeHold?.();
    const row=this.records.get(name)!;
    if(row.metadata.generation!==generation || row.metadata.metageneration!==metageneration)throw Object.assign(new Error("private precondition"),{code:412});
    row.metadata.temporaryHold=true;row.metadata.metageneration=String(BigInt(metageneration)+1n);
    if(this.lostHold){this.lostHold=false;throw new Error("private lost hold reply");}
    return structuredClone(row.metadata);
  }
  async writeNew(name:string,bytes:Buffer,options:SaveOptions) {
    this.writes.push({name,bytes:Buffer.from(bytes),options});
    if(this.dropWrite){this.dropWrite=false;throw new Error("private timeout before create");}
    if(this.records.has(name))throw Object.assign(new Error("private create precondition"),{code:412});
    const metadata={...structuredClone(options.metadata),name,bucket:this.bucketName,
      generation:String(9007199254740995000n+BigInt(this.writes.length)),metageneration:"1",size:String(bytes.length),crc32c:"AAAAAA=="};
    this.records.set(name,{bytes:Buffer.from(bytes),metadata});
    if(this.lostWrite){this.lostWrite=false;throw new Error("private lost create reply");}
    return structuredClone(metadata);
  }
  readPinned(name:string,generation:string):Readable {
    const row=this.records.get(name)!,stall=this.stall,extra=this.extraMedia;
    let started=false;
    const stream=new Readable({read(){
      if(started)return;started=true;this.emit("response",{statusCode:206,headers:{"x-goog-generation":generation,"content-length":row.metadata.size}});
      if(stall)return;this.push(Buffer.from(row.bytes));if(extra)this.push(Buffer.alloc(1024*1024));this.push(null);
    }});this.streams.push(stream);return stream;
  }
}
async function fixture() {
  const config={projectId:"synthetic-backup-project",namespace:"unit_backup",bucketName:"independent-private-journal-bucket"};
  const backupId=randomUUID(),prefix="firebase-backups/v1/"+backupId+"/firestore/",outputUriPrefix="gs://"+config.bucketName+"/"+prefix+"completed";
  const bucket=new MemoryBucket(config.bucketName);
  for(let i=0;i<3;i++)bucket.add(prefix+"completed/"+i+".export",10+i);
  const clock={at:START},cipher=createStorageCipher(Buffer.alloc(32,41)),options={config,cipher,bucket,serverClock:()=>clock.at};
  const artifacts=createFirebaseBackupArtifacts(options);
  const objects=await artifacts.holdNativeExport({backupId,outputUriPrefix});
  const scope={ownerUserId:"synthetic-backup-owner",workspaceId:randomUUID(),childId:randomUUID(),storageEpoch:randomUUID()},photoId=randomUUID();
  const fullScope={...scope},photoPath=config.namespace+"_photos/"+hash(canonical(["photo",photoId]));
  const documents=[{path:config.namespace+"/control",sha256:hash("opaque-control")},{path:photoPath,sha256:hash("opaque-photo-row")}]
    .sort((a,b)=>a.path.localeCompare(b.path));
  const retainedUntil=new Date(START+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS+12*60*60*1000).toISOString();
  const payload:FirebaseBackupManifestPayload={format:"yuban-firebase-backup-manifest/v1",backupId,databaseId:"synthetic-firebase-db",
    snapshotTime:new Date(START-60_000).toISOString(),controlGeneration:randomUUID(),sourceCommit:"a".repeat(40),
    keyVersionRef:"projects/123456789012/secrets/YUBAN_FIREBASE_STORAGE_KEY/versions/1",retainedUntil,
    nativeExport:{outputUriPrefix,objects},inventory:{schema:"yuban-firestore-backup-inventory/v1",projectId:config.projectId,
      namespace:config.namespace,databaseId:"synthetic-firebase-db",snapshotTime:new Date(START-60_000).toISOString(),
      documents,documentCount:documents.length,bytes:400,sha256:hash(canonical(documents))},
    photos:[{path:photoPath,photoId,scope,descriptor:{
      objectName:"photos/v1/"+hash(JSON.stringify(["yuban-photo-object",1,config.projectId,config.namespace,fullScope]))+"/"+photoId,
      generation:"9007199254740996000",cipherSha256:hash("original ciphertext"),sha256:hash("original photo"),bytes:14,mimeType:"image/png"},
      backup:{format:"yuban-photo-backup/v1",objectName:"firebase-backups/v1/"+backupId+"/photos/"+photoId,
        generation:"9007199254740997000",cipherSha256:hash("photo backup ciphertext"),bytes:1000,retainedUntil}}]};
  return {config,backupId,prefix,outputUriPrefix,bucket,clock,cipher,options,artifacts,objects,payload};
}
function altered(f:Awaited<ReturnType<typeof fixture>>,descriptor:FirebaseBackupManifestDescriptor,change:(payload:FirebaseBackupManifestPayload)=>void) {
  const row=f.bucket.records.get(descriptor.objectName)!,aad=canonical(["yuban-firebase-backup-manifest",1,f.config.projectId,f.config.namespace,f.config.bucketName,descriptor.objectName]);
  const payload=JSON.parse(f.cipher.decrypt(row.bytes.toString(),aad));change(payload);
  row.bytes=Buffer.from(f.cipher.encrypt(canonical(payload),aad));
  row.metadata.size=String(row.bytes.length);row.metadata.metadata.cipherSha256=hash(row.bytes);row.metadata.metadata.payloadSha256=hash(canonical(payload));
  return {...descriptor,bytes:row.bytes.length,cipherSha256:hash(row.bytes)};
}

test("native export is bounded, held with exact generation/metageneration and read back as the same live objects",async()=>{
  const f=await fixture();assert.equal(f.objects.length,3);
  assert.equal(f.bucket.holds.length,3);assert.ok(f.bucket.holds.every(row=>BigInt(row.generation)>BigInt(Number.MAX_SAFE_INTEGER)
    && BigInt(row.metageneration)>BigInt(Number.MAX_SAFE_INTEGER)));
  assert.ok([...f.bucket.records.values()].every(row=>row.metadata.temporaryHold===true));
  const calls=f.bucket.holds.length;await f.artifacts.holdNativeExport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix});
  assert.equal(f.bucket.holds.length,calls);
  await f.artifacts.assertNativeExportObjects({backupId:f.backupId,objects:f.objects});
  assert.ok(f.bucket.listCalls.every(row=>row.prefix===f.prefix));
  assert.deepEqual(Object.keys(f.artifacts).sort(),["assertNativeExportObjects","holdNativeExport","readManifest","writeManifest"]);
  const lost=await fixture();for(const row of lost.bucket.records.values())row.metadata.temporaryHold=false;
  lost.bucket.lostHold=true;await lost.artifacts.holdNativeExport({backupId:lost.backupId,outputUriPrefix:lost.outputUriPrefix});
  assert.ok([...lost.bucket.records.values()].every(row=>row.metadata.temporaryHold===true));
});

test("a replaced generation cannot be held and native import readbacks reject any changed, missing or added live object",async()=>{
  const f=await fixture();for(const row of f.bucket.records.values())row.metadata.temporaryHold=false;
  f.bucket.beforeHold=()=>{const row=[...f.bucket.records.values()][0];row.metadata.generation=String(BigInt(row.metadata.generation)+100n);};
  await assert.rejects(f.artifacts.holdNativeExport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),code("backup_artifact_conflict"));
  assert.equal([...f.bucket.records.values()].some(row=>row.metadata.temporaryHold===true),false);
  for(const mode of ["crc","missing","extra","hold"]){
    const g=await fixture(),row=g.bucket.records.get(g.objects[0].name)!;
    if(mode==="crc")row.metadata.crc32c="AAAAAQ==";
    if(mode==="missing")g.bucket.records.delete(g.objects[0].name);
    if(mode==="extra")g.bucket.add(g.prefix+"completed/extra",1,true);
    if(mode==="hold")row.metadata.temporaryHold=false;
    await assert.rejects(g.artifacts.assertNativeExportObjects({backupId:g.backupId,objects:g.objects}),code("backup_artifact_conflict"));
  }
});

test("listing rejects more than 256 objects, excessive bytes and non-progressing pages before adding holds",async()=>{
  for(const mode of ["count","bytes","repeat","empty","outside","numeric-generation"]){
    const f=await fixture();f.bucket.holds.length=0;f.bucket.records.clear();
    if(mode==="count")for(let i=0;i<257;i++)f.bucket.add(f.prefix+"completed/"+String(i).padStart(3,"0"),1);
    if(mode==="bytes"){const a=f.bucket.add(f.prefix+"completed/a",1),b=f.bucket.add(f.prefix+"completed/b",1);a.metadata.size=String(FIREBASE_NATIVE_EXPORT_MAX_BYTES);b.metadata.size="1";}
    if(mode==="repeat")f.bucket.listOverride=async()=>({objects:[{name:f.prefix+"completed/"+randomUUID(),bucket:f.config.bucketName,
      generation:"1",metageneration:"1",size:"1",crc32c:"AAAAAA=="}],nextPageToken:"same"});
    if(mode==="empty")f.bucket.listOverride=async()=>({objects:[],nextPageToken:"next"});
    if(mode==="outside")f.bucket.listOverride=async()=>({objects:[{...f.bucket.add("other-prefix/a",1).metadata}]});
    if(mode==="numeric-generation"){const row=f.bucket.add(f.prefix+"completed/a",1);(row.metadata as unknown as {generation:unknown}).generation=42;}
    await assert.rejects(f.artifacts.holdNativeExport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),
      code(mode==="count"||mode==="bytes"?"backup_artifact_limit":"backup_artifact_integrity"));
    assert.equal(f.bucket.holds.length,0);assert.equal(f.bucket.writes.length,0);
  }
});

test("the paired manifest is private, strictly bound and immutable with a fourteen-day hold",async()=>{
  const f=await fixture(),nativeSnapshot=structuredClone([...f.bucket.records]),saved=await f.artifacts.writeManifest(f.payload);
  assert.equal(saved.objectName,"firebase-backups/v1/"+f.backupId+"/manifest");assert.equal(typeof saved.generation,"string");
  const call=f.bucket.writes[0];assert.deepEqual(call.options.preconditionOpts,{ifGenerationMatch:0});
  assert.equal(call.options.resumable,false);assert.equal(call.options.validation,"crc32c");assert.equal(call.options.timeout,FIREBASE_PHOTO_TIMEOUT_MS);
  assert.equal(call.options.metadata?.temporaryHold,true);assert.equal(call.options.metadata?.metadata?.retainedUntil,f.payload.retainedUntil);
  assert.equal(call.bytes.includes(f.payload.keyVersionRef),false);assert.equal(call.bytes.includes(f.payload.photos[0].scope.ownerUserId),false);
  assert.equal(JSON.stringify(call.options.metadata).includes(f.payload.keyVersionRef),false);assert.equal("payload" in saved,false);
  assert.deepEqual(await f.artifacts.readManifest({backupId:f.backupId,descriptor:saved}),f.payload);
  assert.deepEqual(structuredClone([...f.bucket.records].filter(([name])=>name.startsWith(f.prefix))),nativeSnapshot);
});

test("a lost manifest reply probes only its original address and reuses the original generation without overwrite",async()=>{
  const f=await fixture();f.bucket.lostWrite=true;const saved=await f.artifacts.writeManifest(f.payload);
  assert.equal(f.bucket.writes.length,1);assert.deepEqual(f.bucket.metadataCalls.slice(-2),[
    {name:saved.objectName,generation:undefined},{name:saved.objectName,generation:saved.generation}]);
  const bytes=Buffer.from(f.bucket.records.get(saved.objectName)!.bytes);
  assert.deepEqual(await f.artifacts.writeManifest(f.payload),saved);
  await assert.rejects(f.artifacts.writeManifest({...f.payload,sourceCommit:"b".repeat(40)}),code("backup_artifact_conflict"));
  assert.deepEqual(f.bucket.records.get(saved.objectName)!.bytes,bytes);assert.equal(f.bucket.writes.every(row=>row.name===saved.objectName),true);
  const missing=await fixture();missing.bucket.dropWrite=true;
  await assert.rejects(missing.artifacts.writeManifest(missing.payload),code("backup_artifact_unavailable"));
  assert.equal(missing.bucket.writes.length,1);assert.equal(missing.bucket.records.has("firebase-backups/v1/"+missing.backupId+"/manifest"),false);
});

test("tamper, missing hold, forged photo epoch and cross-project or backup bindings cannot become manifest authority",async()=>{
  for(const mode of ["tamper","hold","retention","photo","inventory","oversize"]){
    const f=await fixture(),saved=await f.artifacts.writeManifest(f.payload),row=f.bucket.records.get(saved.objectName)!;let descriptor=saved;
    if(mode==="tamper"){row.bytes[row.bytes.length-10]^=1;row.metadata.metadata.cipherSha256=hash(row.bytes);descriptor={...saved,cipherSha256:hash(row.bytes)};}
    if(mode==="hold")delete row.metadata.temporaryHold;
    if(mode==="retention")row.metadata.metadata.retainedUntil=new Date(Date.parse(saved.retainedUntil)+1000).toISOString();
    if(mode==="photo")descriptor=altered(f,saved,payload=>{payload.photos[0].scope.storageEpoch=randomUUID();});
    if(mode==="inventory")descriptor=altered(f,saved,payload=>{payload.inventory.documents[0].sha256="f".repeat(64);});
    if(mode==="oversize")row.metadata.size=String(FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES+1);
    await assert.rejects(f.artifacts.readManifest({backupId:f.backupId,descriptor}),code("backup_artifact_integrity"));
  }
  const f=await fixture(),saved=await f.artifacts.writeManifest(f.payload);
  await assert.rejects(f.artifacts.readManifest({backupId:randomUUID(),descriptor:saved}),code("backup_artifact_conflict"));
  const foreign=createFirebaseBackupArtifacts({...f.options,config:{...f.config,projectId:"other-backup-project"}});
  await assert.rejects(foreign.readManifest({backupId:f.backupId,descriptor:saved}),code("backup_artifact_integrity"));
});

test("retention, strict payload fields and a complete matching inventory are checked before creating a manifest",async()=>{
  const f=await fixture(),before=f.bucket.listCalls.length;
  for(const value of [START+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS-1,START+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS+1]){
    const payload=structuredClone(f.payload);payload.retainedUntil=new Date(value).toISOString();payload.photos[0].backup.retainedUntil=payload.retainedUntil;
    await assert.rejects(f.artifacts.writeManifest(payload),code("backup_artifact_invalid"));
  }
  await assert.rejects(f.artifacts.writeManifest({...f.payload,base64:"private attachment"} as any),code("backup_artifact_invalid"));
  await assert.rejects(f.artifacts.writeManifest({...f.payload,keyVersionRef:"latest"}),code("backup_artifact_invalid"));
  const changed=structuredClone(f.payload);changed.inventory.documentCount++;
  await assert.rejects(f.artifacts.writeManifest(changed),code("backup_artifact_integrity"));
  assert.equal(f.bucket.writes.length,0);assert.equal(f.bucket.listCalls.length,before);
  const saved=await f.artifacts.writeManifest(f.payload);f.clock.at=Date.parse(saved.retainedUntil);
  await assert.rejects(f.artifacts.readManifest({backupId:f.backupId,descriptor:saved}),code("backup_artifact_expired"));
  assert.equal(f.bucket.streams.length,0);
});

test("a stalled or oversized manifest stream is destroyed rather than returning partial authority",async t=>{
  const f=await fixture(),saved=await f.artifacts.writeManifest(f.payload);f.bucket.stall=true;
  t.mock.timers.enable({apis:["setTimeout"]});
  const pending=f.artifacts.readManifest({backupId:f.backupId,descriptor:saved});
  await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(FIREBASE_PHOTO_TIMEOUT_MS);
  await assert.rejects(pending,code("backup_artifact_unavailable"));assert.equal(f.bucket.streams[0].destroyed,true);
  t.mock.timers.reset();
  f.bucket.stall=false;f.bucket.extraMedia=true;
  await assert.rejects(f.artifacts.readManifest({backupId:f.backupId,descriptor:saved}),code("backup_artifact_integrity"));
  assert.equal(f.bucket.streams.at(-1)!.destroyed,true);
});

test("the real SDK adapter uses public exact-string preconditions and bounded manual listing/media requests",async()=>{
  const calls:any[]=[],revision="9007199254740999000",metaRevision="9007199254740999001";
  const file={metadata:{name:"synthetic"},async save(bytes:Buffer,options:SaveOptions){calls.push({save:{bytes,options}});},
    async request(options:any){calls.push(options);return [{name:"synthetic"},{statusCode:200}];},
    requestStream(options:any){calls.push(options);return new Readable({read(){this.push(null);}});}};
  const sdk={file(name:string){calls.push({file:name});return file;},
    async request(options:any){calls.push(options);return [{items:[],nextPageToken:"next"},{statusCode:200}];}};
  const port=createFirebaseBackupArtifactBucketPort(sdk as unknown as Bucket);
  assert.deepEqual(await port.list("fixed-prefix/","opaque-token"),{objects:[],nextPageToken:"next"});
  await port.metadata("manifest",revision);await port.hold("native",revision,metaRevision);port.readPinned("manifest",revision).destroy();
  const list=calls.find(row=>row.uri==="/o");assert.equal(list.qs.prefix,"fixed-prefix/");assert.equal(list.qs.pageToken,"opaque-token");
  assert.equal(list.qs.maxResults,64);assert.equal(list.timeout,FIREBASE_PHOTO_TIMEOUT_MS);assert.equal("autoPaginate" in list.qs,false);
  const patch=calls.find(row=>row.method==="PATCH");assert.deepEqual(patch.qs,{ifGenerationMatch:revision,ifMetagenerationMatch:metaRevision});
  assert.deepEqual(patch.json,{temporaryHold:true});assert.equal(patch.timeout,FIREBASE_PHOTO_TIMEOUT_MS);
  const media=calls.find(row=>row.qs?.alt==="media");assert.equal(media.qs.generation,revision);
  assert.equal(media.headers.Range,"bytes=0-"+FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES);
  assert.equal(media.gzip,false);assert.equal(media.timeout,FIREBASE_PHOTO_TIMEOUT_MS);
  assert.ok(calls.some(row=>row.method==="GET"&&row.qs?.generation===revision));
});