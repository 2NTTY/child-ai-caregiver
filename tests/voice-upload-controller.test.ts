import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { VoiceUploadController } from '../frontend/src/production/VoiceUploadController.ts';
import { VoiceApiError, type VoiceApi } from '../src/client/voice-api.ts';
import type { VoiceAttachment } from '../src/shared/voice.ts';

test('shared voice owner resolves the original upload and ignores a previous identity response', async () => {
  const childId=randomUUID(),id=randomUUID(),hash='a'.repeat(64);
  let reads=0,uploads=0,reservations=0,localReads=0;
  let release: (()=>void)|undefined;
  const value:VoiceAttachment={id,childId,version:1,state:'reserved',createdAt:new Date().toISOString(),fileName:'voice.wav',
    mimeType:'audio/wav',bytes:1,sha256:hash,durationMs:null,messageId:null};
  const api={
    async reserve(child:string,input:{opId:string}) {assert.equal(child,childId);assert.equal(input.opId,id);reservations++;return {...value};},
    async upload() {uploads++;Object.assign(value,{state:'ready',version:2,durationMs:1000});throw new VoiceApiError(0,'unavailable');},
    async get() {reads++;if(reads===2)await new Promise<void>(resolve=>{release=resolve;});return {...value};},
  } as unknown as VoiceApi;
  const owner=new VoiceUploadController(api,async()=>hash,()=>{throw new Error('Unexpected access loss');},()=>id);
  owner.syncContext({key:'parent:child',userId:'parent',childId},true);
  const input={id:'local',fileName:'voice.wav',mimeType:'audio/wav',bytes:1,async readBase64(){localReads++;return 'AQ==';}};
  assert.equal(await owner.prepare(input),null);assert.equal(owner.getSnapshot().unknown,true);
  assert.equal(await owner.prepare(input),null);assert.equal(uploads,1);
  await owner.check();assert.equal(owner.getSnapshot().unknown,false);
  assert.equal((await owner.prepare(input))?.id,id);assert.equal(localReads,1);
  assert.equal(uploads,1);assert.equal(reservations,1);
  const delayed=owner.check();owner.syncContext({key:'other:child',userId:'other',childId},true);release!();await delayed;
  assert.equal(owner.getSnapshot().voice,null);assert.equal(owner.getSnapshot().localId,null);
  owner.dispose();
});
