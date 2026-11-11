import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { mixedChatErasedBy } from '../server/mixed-chat-records.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('a recipient imports a whole mixed transcript once, reads historical replies without executing them, and retains local changes',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mixed-history-'));
  t.after(()=>rm(directory,{force:true,recursive:true}));
  const fixture=serialFirestoreFixture(), options={database:fixture.database,projectId:'demo-mixed-history',namespace:'unit_mix_in',
    cipher:createStorageCipher(Buffer.alloc(32,86))};
  const authority=createFirestoreAuthority(options), chat=createFirestoreChatStore(options), codec=createFirestoreRestoreCodec(options);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  for (const userId of ['reader','other']) {
    const email=userId+'@example.test';
    await authority.issueInvitation({email,operationId:randomUUID(),expiresAt:'2099-01-01T00:00:00.000Z'});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  }
  const childIds=[randomUUID(),randomUUID()], targets=[];
  for (const id of childIds) {
    const {child}=await authority.createChild({userId:'reader',operationId:randomUUID(),displayName:'同名'});
    targets.push({sourceChildId:id,target:{childId:child.id,spaceId:null},sections:[]});
  }
  const roomId=randomUUID(), createdAt='2026-01-01T00:00:00.000Z', source={serverId:'source',accountId:'space:records'};
  const rows=[], paths=new Map(), scopeVersion='b'.repeat(64);
  function addMessage(text,reply) {
    rows.push({message:{id:randomUUID(),roomId,createdAt,version:rows.length+2,role:'user',text},reply});
  }
  addMessage('原有的問題',{status:'completed',text:'原有的答覆',citations:[{sourceId:'s',versionId:'v',chunkId:'c',title:'原文',url:'https://example.test/source',section:'第一節'}]});
  addMessage('仍在處理的歷史問題',{status:'running'});
  async function stage() {
    const pages=[{section:'children',childId:null,items:childIds.map(id=>({id,displayName:'同名'}))},
      {section:'mixed_chat',childId:null,items:[...rows].reverse()}];
    const archive=await writeHandoverArchive({directory,header:{format:'yuyoufang-data',version:4,purpose:'handover',
      packageId:randomUUID(),packageVersion:1,createdAt,source,mixedAuthorAccountId:'sender',
      selection:{childIds,modules:[],period:null,mixedRooms:[{id:roomId,childIds,version:rows.length+1}]}},
      entries:(async function*(){
        for (const [i,page] of pages.entries()) yield {path:'data/'+i+'.json',mediaType:'application/json',content:Buffer.from(JSON.stringify({...page,scopeVersion}))};
        yield {path:'summary.md',mediaType:'text/markdown',content:Buffer.from('Synthetic')};
      })(), coverage:()=>pages.map(page=>({section:page.section,childId:null,items:page.items.length,scopeVersion,complete:true}))});
    const uploadId=randomUUID(), reader=await openHandoverImport({path:archive.path});
    paths.set(uploadId,archive.path);
    try {return {opId:randomUUID(),uploadId,expectedUploadVersion:1,acceptedManifestSha256:reader.manifestSha256,
      targets,mixedRoomIds:[roomId],resolutions:[]};} finally {await reader.close();}
  }
  const uploads={async open(owner,id){
    assert.equal(owner,'reader'); const reader=await openHandoverImport({path:paths.get(id)});
    return {reader,job:{version:1},dispose:()=>reader.close()};
  },async assertImportableIn(_b,id,version){assert.ok(paths.has(id));assert.equal(version,1);return ()=>{};}};
  const service=createHandoverImportService({...options,uploads}), deliveries=[];
  const signal=new AbortController().signal;
  const queue=createFirestoreBackgroundQueue({...options,enabled:true,readControl:tx=>authority.readControl(tx),
    transport:{async enqueue(delivery){deliveries.push(delivery);return {state:'confirmed'};},async probe(){return {state:'confirmed'};}},
    execute:work=>service.process(work,signal)});
  async function importBatch(command) {
    const queued=await service.create('reader',command,signal);
    assert.deepEqual(await service.create('reader',command,signal),queued);
    await queue.dispatch();
    const delivery=deliveries.splice(0).find(item=>[...fixture.records].some(([path,record])=>path.includes('_background_work/') &&
      record.id===item.id && codec.decode({path,data:record}).value.resourceId===command.opId));
    assert.ok(delivery); await queue.process(delivery);
    const result=await service.get('reader',command.opId);
    assert.equal(result.state,'completed',result.error);
    return result;
  }
  const command=await stage();
  await assert.rejects(service.create('reader',{...command,targets:targets.slice(0,1)},signal),{code:'package_scope_unavailable'});
  await assert.rejects(service.create('reader',{...command,targets:[targets[0],{...targets[1],target:targets[0].target}]},signal),{code:'mixed_import_target_mismatch'});
  assert.equal((await importBatch(command)).counts.created,3);
  const {items:receipts}=await service.mixedResults('reader',command.opId,0);
  assert.deepEqual(receipts.map(r=>r.sourceVersion),[1,2,3]);
  const [room]=(await chat.mixed.list('reader',null)).rooms;
  assert.notEqual(room.id,roomId);
  const detail=await chat.mixed.detail('reader',room.id,null,true);
  assert.equal(detail.room.createdAt,createdAt);
  assert.equal(detail.room.updatedAt,createdAt);
  assert.deepEqual(detail.archivedReplies.map(r=>r.reply),rows.map(r=>r.reply));
  assert.ok(!(await chat.mixed.detail('reader',room.id,null)).archivedReplies);
  const runs=createFirestoreAgentRuns({...options,chat,memory:{}});
  await assert.rejects(runs.claimMixed('reader',room.id,detail.messages[0].id),{code:'imported_message_read_only'});
  await assert.rejects(chat.mixed.detail('other',room.id,null,true),{code:'not_found'});
  assert.equal((await importBatch({...command,opId:randomUUID()})).counts.skipped,3);
  await chat.mixed.append('reader',room.id,{expectedVersion:3,operationId:randomUUID(),text:'收件人自己的新問題'});
  addMessage('發件人後來新增',{status:'not_started'});
  const newer=await stage();
  assert.deepEqual((await importBatch(newer)).counts,{created:0,updated:0,skipped:3,conflict:1});
  assert.equal((await chat.mixed.detail('reader',room.id,null,true)).messages.at(-1).text,'收件人自己的新問題');
  const records=[...fixture.records].filter(([path])=>path.includes('_handover_import_items/'));
  assert.ok(records.length);
  for (const [path,data] of records) {
    const decoded=codec.decode({path,data});
    assert.equal(decoded.context.kind,'mixed-import-receipt');
    assert.ok(mixedChatErasedBy(decoded.context.kind,decoded.value,'reader',{...decoded.context.scope,childId:targets[0].target.childId},false));
  }
});
