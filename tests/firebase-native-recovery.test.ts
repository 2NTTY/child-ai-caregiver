import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { GoogleAuth } from "google-auth-library";
import { createFirebaseNativeRecovery, FirebaseNativeRecoveryError, FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS,
  type FirebaseNativeRecoveryOperation, type FirebaseNativeRecoveryRequest, type FirebaseNativeRecoveryTransport } from "../server/firebase-native-recovery.ts";

const config={projectId:"synthetic-native-project",sourceDatabaseId:"synthetic-source-db",targetDatabaseId:"synthetic-target-db",
  backupBucketName:"independent-private-journal-bucket"};
const resource=(kind:"export"|"import")=>"projects/"+config.projectId+"/databases/"+(kind==="export"?config.sourceDatabaseId:config.targetDatabaseId);
const type=(kind:"export"|"import")=>"type.googleapis.com/google.firestore.admin.v1."+(kind==="export"?"Export":"Import")+"DocumentsMetadata";
const snapshot=()=>new Date(Math.floor(Date.now()/60_000)*60_000-60_000).toISOString();
const code=(expected:string)=>(error:unknown)=>error instanceof FirebaseNativeRecoveryError&&error.code===expected&&error.message===expected;
function fixture(){
  const backupId=randomUUID(),outputUriPrefix="gs://"+config.backupBucketName+"/firebase-backups/v1/"+backupId+"/firestore",snapshotTime=snapshot();
  const calls:FirebaseNativeRecoveryRequest[]=[],exports:FirebaseNativeRecoveryOperation[]=[],imports:FirebaseNativeRecoveryOperation[]=[];
  let lose=false,failGet=false;
  const request:FirebaseNativeRecoveryTransport=async options=>{
    calls.push(options);const direction=options.url.includes(config.sourceDatabaseId)?"export":"import";
    if(options.method==="GET"){
      if(failGet)throw new Error("synthetic private token in upstream error");
      if(options.url.endsWith("/operations"))return {status:200,data:{operations:direction==="export"?exports:imports}};
      const name=decodeURIComponent(options.url.slice("https://firestore.googleapis.com/v1/".length));
      return {status:200,data:(direction==="export"?exports:imports).find(operation=>operation.name===name)};
    }
    const operation:FirebaseNativeRecoveryOperation={name:resource(direction)+"/operations/opaque-"+randomUUID(),done:false,
      metadata:{"@type":type(direction),...(direction==="export"?options.data:{inputUriPrefix:"inputUriPrefix" in options.data?options.data.inputUriPrefix:undefined}),
        progressDocuments:{completedWork:"0"},operationState:"PROCESSING"}};
    (direction==="export"?exports:imports).push(operation);
    if(lose){lose=false;throw new Error("synthetic private POST reply lost");}
    return {status:200,data:operation};
  };
  return {backupId,outputUriPrefix,snapshotTime,calls,exports,imports,request,native:createFirebaseNativeRecovery({...config,request}),
    lose:()=>{lose=true;},failGet:()=>{failGet=true;}};
}

test("export starts once at the fixed source and resumes the same operation without a duplicate POST",async()=>{
  const f=fixture(),first=await f.native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime});
  assert.equal(first.name.startsWith(resource("export")+"/operations/"),true);
  assert.deepEqual(await f.native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime}),first);
  assert.deepEqual(await f.native.findExport({backupId:f.backupId}),first);
  assert.deepEqual(await f.native.getExport(first.name),first);
  const posts=f.calls.filter(row=>row.method==="POST");assert.equal(posts.length,1);
  assert.equal(posts[0].url,"https://firestore.googleapis.com/v1/"+resource("export")+":exportDocuments");
  assert.equal(posts[0].method,"POST");if(posts[0].method==="POST")assert.deepEqual(posts[0].data,{outputUriPrefix:f.outputUriPrefix,snapshotTime:f.snapshotTime});
  assert.ok(f.calls.every(row=>row.retry===false&&row.timeout===FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS));
  assert.equal(f.calls[0].method,"GET");if(f.calls[0].method==="GET")assert.deepEqual(f.calls[0].params,{pageSize:100});
  assert.deepEqual(Object.keys(f.native).sort(),["findExport","findImport","getExport","getImport","startExport","startImport"]);
});

test("import uses only the separate target and exact held export prefix while resuming its original operation",async()=>{
  const f=fixture(),nested=f.outputUriPrefix+"/completed-export",first=await f.native.startImport({backupId:f.backupId,outputUriPrefix:nested});
  assert.deepEqual(await f.native.startImport({backupId:f.backupId,outputUriPrefix:nested}),first);
  assert.deepEqual(await f.native.findImport({backupId:f.backupId,outputUriPrefix:nested}),first);
  assert.deepEqual(await f.native.getImport(first.name),first);
  const posts=f.calls.filter(row=>row.method==="POST");assert.equal(posts.length,1);assert.equal(posts[0].method,"POST");
  if(posts[0].method==="POST")assert.deepEqual(posts[0].data,{inputUriPrefix:nested});
  assert.equal(posts[0].url,"https://firestore.googleapis.com/v1/"+resource("import")+":importDocuments");
  assert.ok(f.calls.every(row=>!row.url.includes(config.sourceDatabaseId)));
});

test("a lost POST response is fixed unknown, never retried, and find/get recover the original native operation",async()=>{
  for(const direction of ["export","import"] as const){
    const f=fixture();f.lose();
    const start=()=>direction==="export"?f.native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime})
      :f.native.startImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix});
    await assert.rejects(start(),code(direction==="export"?"native_export_unknown":"native_import_unknown"));
    assert.equal(f.calls.filter(row=>row.method==="POST").length,1);
    const found=direction==="export"?await f.native.findExport({backupId:f.backupId})
      :await f.native.findImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix});
    assert.ok(found);assert.deepEqual(await start(),found);assert.equal(f.calls.filter(row=>row.method==="POST").length,1);
  }
  const f=fixture(),calls:FirebaseNativeRecoveryRequest[]=[];
  const native=createFirebaseNativeRecovery({...config,request:async options=>{
    calls.push(options);if(options.method==="POST")throw new Error("private unknown acceptance");
    return {status:200,data:{operations:[]}};
  }});
  await assert.rejects(native.startImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),code("native_import_unknown"));
  assert.equal(await native.findImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),null);
  assert.equal(calls.filter(row=>row.method==="POST").length,1);
});

test("matching export prefixes with a different snapshot conflict and multiple native jobs are ambiguous",async()=>{
  const f=fixture();await f.native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime});
  const earlier=new Date(Date.parse(f.snapshotTime)-60_000).toISOString();
  await assert.rejects(f.native.startExport({backupId:f.backupId,snapshotTime:earlier}),code("native_export_snapshot_conflict"));
  assert.equal(f.calls.filter(row=>row.method==="POST").length,1);
  f.exports.push({...f.exports[0],name:resource("export")+"/operations/other"});
  await assert.rejects(f.native.findExport({backupId:f.backupId}),code("native_export_ambiguous"));
  await assert.rejects(f.native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime}),code("native_export_ambiguous"));
  const g=fixture();await g.native.startImport({backupId:g.backupId,outputUriPrefix:g.outputUriPrefix});
  g.imports.push({...g.imports[0],name:resource("import")+"/operations/other"});
  await assert.rejects(g.native.startImport({backupId:g.backupId,outputUriPrefix:g.outputUriPrefix}),code("native_import_ambiguous"));
  assert.equal(g.calls.filter(row=>row.method==="POST").length,1);
});

test("operation names and backup prefixes cannot escape the fixed HTTPS project/database addresses",async()=>{
  const f=fixture();
  for(const name of ["https://evil.invalid/op",resource("import")+"/operations/op",resource("export")+"/operations/..",
    resource("export")+"/operations/op?secret",resource("export")+"/operations/op%2Fother",resource("export")+"/operations/op/other"]){
    await assert.rejects(f.native.getExport(name),code("native_recovery_invalid"));
  }
  for(const prefix of ["gs://other-bucket/"+f.outputUriPrefix.split("/").slice(3).join("/"),f.outputUriPrefix+"/../other",
    f.outputUriPrefix+"/nested?secret",f.outputUriPrefix+"/nested#fragment",f.outputUriPrefix+"/nested%2Fother",
    f.outputUriPrefix+"/",f.outputUriPrefix.replace(f.backupId,randomUUID())]){
    await assert.rejects(f.native.startImport({backupId:f.backupId,outputUriPrefix:prefix}),code("native_recovery_invalid"));
  }
  assert.equal(f.calls.length,0);
  assert.throws(()=>createFirebaseNativeRecovery({...config,sourceDatabaseId:config.targetDatabaseId,request:f.request}),code("native_recovery_invalid"));
  assert.throws(()=>createFirebaseNativeRecovery({...config,targetDatabaseId:"(default)",request:f.request}),code("native_recovery_invalid"));
});

test("snapshots must be past whole minutes within fifty-five minutes, including fractional-second precision",async()=>{
  const f=fixture(),minute=Math.floor(Date.now()/60_000)*60_000;
  for(const snapshotTime of [new Date(minute+60_000).toISOString(),new Date(minute-56*60_000).toISOString(),
    new Date(Date.parse(f.snapshotTime)+1).toISOString(),f.snapshotTime.replace(".000Z",".000001Z"),"not-a-timestamp"]){
    await assert.rejects(f.native.startExport({backupId:f.backupId,snapshotTime}),code("native_recovery_invalid"));
  }
  assert.equal(f.calls.length,0);
});

test("operation discovery scans all bounded pages before POST and refuses truncated or repeating lists",async()=>{
  const f=fixture(),found:FirebaseNativeRecoveryOperation={name:resource("export")+"/operations/existing",
    metadata:{"@type":type("export"),outputUriPrefix:f.outputUriPrefix+"/completed",snapshotTime:f.snapshotTime}},calls:FirebaseNativeRecoveryRequest[]=[];
  const native=createFirebaseNativeRecovery({...config,request:async options=>{
    calls.push(options);assert.equal(options.method,"GET");
    const token=options.method==="GET"?options.params?.pageToken:undefined;
    return {status:200,data:token===undefined?{operations:[{name:resource("export")+"/operations/unrelated",metadata:{outputUriPrefix:"gs://other"}}],nextPageToken:"late"}
      :{operations:[found]}};
  }});
  assert.deepEqual(await native.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime}),found);assert.equal(calls.length,2);
  for(const mode of ["limit","repeat","oversize","foreign"]){
    const calls:FirebaseNativeRecoveryRequest[]=[];
    const bounded=createFirebaseNativeRecovery({...config,request:async options=>{
      calls.push(options);assert.equal(options.method,"GET");
      const rows=Array.from({length:mode==="oversize"?101:1},(_,index)=>({name:resource("export")+"/operations/op-"+calls.length+"-"+index}));
      if(mode==="foreign")rows[0].name="projects/another-project/databases/"+config.sourceDatabaseId+"/operations/op";
      return {status:200,data:{operations:rows,...(mode==="limit"||mode==="repeat"?{nextPageToken:mode==="repeat"?"same":String(calls.length)}:{})}};
    }});
    await assert.rejects(bounded.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime}),code("native_export_unavailable"));
    assert.equal(calls.filter(row=>row.method==="POST").length,0);
    if(mode==="limit")assert.equal(calls.length,10);
  }
});

test("GET failures and mismatched native responses stay unavailable, while invalid POST replies stay unknown",async()=>{
  const f=fixture();f.failGet();
  await assert.rejects(f.native.findExport({backupId:f.backupId}),code("native_export_unavailable"));
  await assert.rejects(f.native.startImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),code("native_import_unavailable"));
  assert.equal(f.calls.filter(row=>row.method==="POST").length,0);
  const wrong=createFirebaseNativeRecovery({...config,request:async options=>({status:200,data:options.url.endsWith("/operations")?
    {operations:[]}:{name:resource("import")+"/operations/foreign"}})});
  await assert.rejects(wrong.startExport({backupId:f.backupId,snapshotTime:f.snapshotTime}),code("native_export_unknown"));
  await assert.rejects(wrong.getExport(resource("export")+"/operations/existing"),code("native_export_unavailable"));
});

test("real GoogleAuth assembly preserves native auth/billing headers and bypasses high-level auth retries",async t=>{
  const calls:any[]=[],headers=new Headers({authorization:"synthetic-token","x-goog-user-project":"synthetic-billing-project"});
  let highLevel=0,authReads=0;
  const client={async getRequestHeaders(url:string){authReads++;assert.equal(url.startsWith("https://firestore.googleapis.com/v1/projects/"+config.projectId+"/databases/"),true);return headers;},
    async request(){highLevel++;throw new Error("must not use retrying auth request");},
    transporter:{async request(options:any){
      calls.push(options);if(options.method==="GET")return {status:200,data:{operations:[]}};
      throw Object.assign(new Error("synthetic private 401"),{response:{status:401}});
    }}};
  t.mock.method(GoogleAuth.prototype,"getClient",async()=>client as unknown as Awaited<ReturnType<GoogleAuth["getClient"]>>);
  const f=fixture(),native=createFirebaseNativeRecovery(config);assert.equal(authReads,0);
  await assert.rejects(native.startImport({backupId:f.backupId,outputUriPrefix:f.outputUriPrefix}),code("native_import_unknown"));
  assert.equal(highLevel,0);assert.equal(calls.length,2);assert.equal(authReads,2);
  for(const call of calls){
    assert.equal(call.headers,headers);assert.equal(call.headers.get("x-goog-user-project"),"synthetic-billing-project");
    assert.equal(call.retry,false);assert.deepEqual(call.retryConfig,{retry:0});assert.equal(call.maxRedirects,0);
    assert.equal(call.timeout,FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS);
  }
  assert.equal(calls.filter(row=>row.method==="POST").length,1);
});