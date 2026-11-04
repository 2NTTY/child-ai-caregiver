import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { handleFirebaseAccountData } from '../server/firebase-account-data-api.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const comparePage = z.object({uploadId:z.uuid(),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/u),childId:z.uuid(),
  module:z.enum(['care','profile','tasks']),items:z.array(z.object({id:z.uuid(),backupVersion:z.number().int().nonnegative(),
    localVersion:z.number().int().nonnegative().nullable(),state:z.enum(['unchanged','local_newer','backup_newer','different','deleted','unavailable']),
    changedFields:z.array(z.string())}).strict()),nextCursor:z.string().nullable()}).strict();

test('original backup preview verifies issued identity and compares real care records without disclosing or writing bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(),'handover-original-backup-'));
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32,104));
    const options = {database:fixture.database,cipher,projectId:'synthetic-original-backup',namespace:'original_backup'};
    const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
    await authority.initializeControl({enabled:true,generation:randomUUID()});
    for (const userId of ['parent','other']) {
      const email = userId+'@example.test';
      await authority.issueInvitation({email,operationId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()});
      await authority.admitIdentity({userId,email,emailVerified:true});
      await authority.acknowledge({userId,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
    }
    const childId = (await authority.createChild({userId:'parent',operationId:randomUUID(),displayName:'Private original child'})).child.id;
    const otherChildId = (await authority.createChild({userId:'other',operationId:randomUUID(),displayName:'Other original child'})).child.id;
    const originals = await Promise.all(['unchanged','newer','deleted'].map(label=>care.create('parent',childId,
      {text:'Secret care body '+label,details:emptyCareDetails(),source:'Private source '+label})));
    assert.ok(originals.every(Boolean));
    const rows = originals.map(row=>({...row!}));
    const newer = await care.revise('parent',childId,rows[1].id,{text:'Secret current care body',details:emptyCareDetails(),source:rows[1].source},rows[1].version,'Local revision');
    assert.ok(newer);
    await care.delete('parent',childId,rows[2].id,rows[2].version);
    const serverId = 'https://original.example.test', keys = generateKeyPairSync('ed25519');
    const keyId = hash(keys.publicKey.export({type:'spki',format:'der'}));
    const stored = new Map<string,{body:Buffer;metadata:any}>();
    const objects = createFirebaseHandoverObjects({config:{projectId:options.projectId,namespace:options.namespace,bucketName:'synthetic-original-backup'},files:cipher.files,
      bucket:{async metadata(name){return stored.get(name)?.metadata??null;},
        createWrite(name,settings){const parts:Buffer[]=[];return new Writable({write(chunk,_encoding,done){parts.push(Buffer.from(chunk));done();},
          final(done){const body=Buffer.concat(parts);stored.set(name,{body,metadata:{name,bucket:'synthetic-original-backup',generation:'11111111111111111',size:String(body.length),metadata:settings.metadata?.metadata}});done();}});},
        readPinned(name){return Readable.from([stored.get(name)!.body]);},async removePinned(name){stored.delete(name);}}});
    let uploadTime=Date.now();
    const uploads = createHandoverUploadService({...options,objects,serverClock:()=>uploadTime,trustedKeys:new Map([[keyId,{key:keys.publicKey,serverId}]])});
    const issued = new Set<string>();
    const originalBackup = {serverId,async matchesIssuedBackup(owner:string,id:string,manifestSha256:string,archiveSha256:string){
      return issued.has(JSON.stringify([owner,id,manifestSha256,archiveSha256]));}};
    const service = createHandoverImportService({...options,uploads,originalBackup});
    async function stage(settings:{signed?:boolean;issued?:boolean;accountId?:string;sourceServerId?:string;purpose?:'backup'|'handover';owner?:string}={}) {
      const scopeVersion='a'.repeat(64),packageId=randomUUID(),owner=settings.owner??'parent';
      const pages=[{section:'children',childId:null,items:[{id:childId,displayName:'Private original child'}]},
        {section:'care',childId,items:rows},{section:'care_history',childId,items:[]}];
      async function* entries(){for(const [index,page] of pages.entries())yield {path:`data/${index}.json`,mediaType:'application/json',content:Buffer.from(JSON.stringify({...page,scopeVersion}))};
        yield {path:'summary.md',mediaType:'text/markdown',content:Buffer.from('Own backup')};}
      const archive=await writeHandoverArchive({directory,header:{format:'yuyoufang-data',version:1,packageId,packageVersion:1,
        createdAt:new Date().toISOString(),purpose:settings.purpose??'backup',source:{serverId:settings.sourceServerId??serverId,accountId:settings.accountId??'parent'},
        selection:{childIds:[childId],modules:['care'],period:null}},entries:entries(),signingKey:settings.signed?keys.privateKey:undefined,
        coverage:()=>pages.map(page=>({section:page.section,childId:page.childId,scopeVersion,items:page.items.length,complete:true}))});
      const bytes=await readFile(archive.path),archiveSha256=hash(bytes),uploadId=randomUUID();
      if(settings.issued)issued.add(JSON.stringify([owner,packageId,archive.manifestSha256,archiveSha256]));
      await uploads.create(owner,{opId:uploadId,filename:'own-backup.zip',bytes:bytes.length,sha256:archiveSha256});
      const uploaded=await uploads.receive(owner,uploadId,Readable.from([bytes]),new AbortController().signal);
      assert.equal(uploaded.state,'ready',uploaded.error??JSON.stringify(uploaded));
      return {uploadId,expectedUploadVersion:uploaded.version,childId,module:'care' as const};
    }
    async function compare(input:unknown,owner='parent') {
      const response=await handleFirebaseAccountData(new Request(serverId+'/api/account/package-imports/compare-original',{
        method:'POST',headers:{'content-type':'application/json','x-expected-user-id':owner},body:JSON.stringify(input)}),
        {getSession:async()=>({user:{id:owner}})} as any,{packageImports:service} as any,request=>request.json());
      assert.ok(response);assert.equal(response.status,200);return comparePage.parse(await response.json());
    }
    async function disposeUpload(request:{uploadId:string;expectedUploadVersion:number},owner='parent') {
      await uploads.cancel(owner,request.uploadId,{opId:randomUUID(),expectedVersion:request.expectedUploadVersion});
      uploadTime+=600001;
      const scope=await authority.runTransaction(owner,null,async binding=>binding.scope);
      assert.equal((await uploads.cleanup(scope,request.uploadId,new AbortController().signal)).state,'completed');
    }
    for(const settings of [{issued:true},{signed:true}]) {
      const request=await stage(settings),before=structuredClone([...fixture.records]);
      const page=await compare(request),items=[...page.items];
      let cursor=page.nextCursor;
      for(let count=0;cursor!==null;count++) {
        assert.ok(count<10,'Comparison pagination must terminate');
        const next=await compare({...request,cursor});assert.notEqual(next.nextCursor,cursor);
        items.push(...next.items);cursor=next.nextCursor;
      }
      assert.equal(page.uploadId,request.uploadId);assert.equal(page.childId,childId);assert.equal(page.module,'care');
      assert.equal(items.length,3);
      const byId=new Map(items.map(item=>[item.id,item]));
      assert.equal(byId.get(rows[0].id)?.state,'unchanged');assert.equal(byId.get(rows[0].id)?.localVersion,rows[0].version);
      assert.equal(byId.get(rows[1].id)?.state,'local_newer');assert.equal(byId.get(rows[1].id)?.localVersion,newer.version);
      assert.equal(byId.get(rows[2].id)?.state,'deleted');
      for(const row of rows)assert.equal(byId.get(row.id)?.backupVersion,row.version);
      assert.equal(JSON.stringify(items).includes('Secret'),false);assert.equal(JSON.stringify(items).includes('Private source'),false);
      assert.deepEqual([...fixture.records],before,'Comparison cannot create receipts, mappings, outbox work or revisions');
      await assert.rejects(compare({...request,childId:otherChildId}),error=>!!error&&typeof error==='object'&&'status'in error&&[400,403,404].includes(Number(error.status)));
      await assert.rejects(compare({...request,module:'chat'}),error=>!!error&&typeof error==='object'&&'status'in error&&[400,403].includes(Number(error.status)));
      await disposeUpload(request);
    }
    for(const settings of [{},{signed:true,accountId:'other'},{signed:true,sourceServerId:'https://elsewhere.example.test'},{signed:true,purpose:'handover' as const}]) {
      const request=await stage(settings),before=structuredClone([...fixture.records]);
      await assert.rejects(compare(request),{code:'package_original_unverified',status:403});
      assert.deepEqual([...fixture.records],before);
      await disposeUpload(request);
    }
    const otherUpload=await stage({signed:true,owner:'other'}),before=structuredClone([...fixture.records]);
    await assert.rejects(compare(otherUpload,'other'),{code:'package_original_unverified',status:403});
    assert.deepEqual([...fixture.records],before,'The same child and resource UUIDs cannot expose another owner originals');
  } finally {await rm(directory,{recursive:true,force:true});}
});
