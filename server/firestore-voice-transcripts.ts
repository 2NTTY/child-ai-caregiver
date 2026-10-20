import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { voiceTranscriptSchema, voiceTranscriptDraftSchema, type VoiceTranscriptDraft } from '../src/shared/voice-transcript.ts';
import type { VoiceMessageReference } from '../src/shared/voice.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundReference, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { FirestoreVoiceStore } from './firestore-voice.ts';
import type { AgentRunClaim } from './product-agent-store.ts';
import type { AgentRunResult } from './agent-runtime.ts';

const attemptSchema = z.object({ runId: z.uuid(), reference: z.uuid(), expiresAt: z.iso.datetime({ offset: true }),
  workerGeneration: z.uuid(), authorizationVersion: z.string(), dataVersion: z.string() }).strict();
export const firestoreVoiceTranscriptSchema = z.object({ scope: workRecoveryScopeSchema, value: voiceTranscriptSchema,
  attempt: attemptSchema.nullable(), modelAttempted: z.boolean(), quotaDeferrals: z.number().int().min(0).max(7) }).strict();
const ref = (data: FirestoreDomainData, id: string) => data.ref('voice_transcripts','voice-transcript',id);
const basis = (source: VoiceMessageReference) => source.version + ':' + source.sha256;
function seal(data: FirestoreDomainData, row: z.infer<typeof firestoreVoiceTranscriptSchema>) {
  return { ...data.tags(row.scope), assetId: row.value.voice.id, state: row.value.state, retryAt: row.value.retryAt,
    ...data.seal('voice-transcript',row.value.voice.id,row.scope,firestoreVoiceTranscriptSchema,row,row.value.version) };
}
/** Called while the original message and its one audio reference are still in their transaction. */
export async function prepareVoiceTranscription(data: FirestoreDomainData, b: Binding, source: VoiceMessageReference, messageId: string) {
  const target = ref(data,source.id);
  if ((await b.transaction.get(target)).exists) domainReject('voice_transcript_exists');
  const at = new Date().toISOString(), work = await prepareFirestoreBackgroundWork(data,b.transaction,
    { kind: 'voice-transcription',scope:b.scope,resourceId:source.id,basis:basis(source),generation:b.generation,authorizationVersion:b.authorizationVersion },
    new Date(Date.now()+120000).toISOString());
  const row = firestoreVoiceTranscriptSchema.parse({scope:b.scope,value:{voice:source,messageId,version:1,state:'pending',automatic:true,
    updatedAt:at,reason:null,retryAt:null,content:null},attempt:null,modelAttempted:false,quotaDeferrals:0});
  return () => { b.transaction.create(target,seal(data,row));work.commit(); };
}
export function createFirestoreVoiceTranscripts(options: FirestoreDomainOptions & { voices: Pick<FirestoreVoiceStore,'readEvidence'> }) {
  const data = new FirestoreDomainData(options),authority = createFirestoreAuthority(options);
  async function read(b:Binding,id:string) {
    domainParse(z.uuid(),id);const row=await b.transaction.get(ref(data,id));
    if(!row.exists||Object.entries(data.tags(b.scope)).some(([k,v])=>row.get(k)!==v))domainReject('not_found',404);
    const value=data.open('voice-transcript',id,b.scope,firestoreVoiceTranscriptSchema,row);
    if(value.value.voice.id!==id||value.value.version!==row.get('recordVersion')||firestoreDomainHash(value.scope)!==firestoreDomainHash(b.scope))domainReject('voice_transcript_binding',503);
    await options.voices.readEvidence(b,value.value.messageId,value.value.voice);return value;
  }
  async function jobBinding(b:Binding,job:FirestoreBackgroundWork) {
    const current=await readFirestoreBackgroundClaim(data,b,firestoreBackgroundReference(job));
    if(job.kind!=='voice-transcription'||!current||current.id!==job.id||current.lease?.token!==job.lease?.token)domainReject('voice_transcript_lease',409);
    const row=await read(b,job.resourceId);if(basis(row.value.voice)!==job.basis)domainReject('voice_changed');return row;
  }
  async function claim(job:FirestoreBackgroundWork) {
    return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
      const row=await jobBinding(b,job);
      if(row.value.state==='available')return {decision:'completed' as const};
      if(row.value.state==='unknown'||row.value.state==='running') {
        if(row.value.state==='running'&&row.attempt&&Date.parse(row.attempt.expiresAt)<=Date.now()) {
          const updated={...row,value:{...row.value,version:row.value.version+1,state:'unknown' as const,
            updatedAt:new Date().toISOString(),reason:'interrupted',content:null}};
          b.transaction.set(ref(data,row.value.voice.id),seal(data,updated));
        }
        return {decision:'unknown' as const};
      }
      if(row.value.state==='stopped'||row.modelAttempted)return {decision:'stopped' as const};
      if(row.value.retryAt&&Date.parse(row.value.retryAt)>Date.now())return {decision:'deferred' as const,nextAt:row.value.retryAt};
      const attempt={runId:randomUUID(),reference:firestoreBackgroundReference(job),expiresAt:new Date(Date.now()+90000).toISOString(),
        workerGeneration:b.generation,authorizationVersion:b.authorizationVersion,dataVersion:b.scope.storageEpoch+':'+b.changeSeq};
      const updated={...row,attempt,value:{...row.value,version:row.value.version+1,state:'running' as const,updatedAt:new Date().toISOString(),reason:null,retryAt:null}};
      b.transaction.set(ref(data,row.value.voice.id),seal(data,updated));
      const claimed:AgentRunClaim={runId:attempt.runId,scope:{userId:b.scope.ownerUserId,workspaceId:b.scope.workspaceId,childId:b.scope.childId,
        authorizationVersion:attempt.authorizationVersion,dataVersion:attempt.dataVersion},created:true,sourceMessageId:null,state:'running',
        expiresAt:attempt.expiresAt,storageEpoch:b.scope.storageEpoch,purpose:'voice-transcription',workerGeneration:b.generation,
        sourceResource:{kind:'voice',id:row.value.voice.id,version:row.value.voice.version},trigger:{kind:'worker',reference:attempt.reference},recipeId:'voice-transcription'};
      return {decision:'execute' as const,claim:claimed,voice:row.value.voice,messageId:row.value.messageId};
    });
  }
  async function authorize(job:FirestoreBackgroundWork,claim:AgentRunClaim) {
    return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
      const row=await jobBinding(b,job);return row.value.state==='running'&&row.attempt?.runId===claim.runId
        && row.attempt.authorizationVersion===b.authorizationVersion&&row.attempt.workerGeneration===b.generation&&Date.now()<Date.parse(row.attempt.expiresAt);
    });
  }
  async function finish(job:FirestoreBackgroundWork,claim:AgentRunClaim,result:AgentRunResult,draft:VoiceTranscriptDraft|null) {
    if(result.runId!==claim.runId||result.counts.modelCalls>1)domainReject('voice_transcript_binding',503);
    return authority.runTransaction(job.scope.ownerUserId,job.scope.childId,async b=>{
      const row=await jobBinding(b,job);if(row.value.state!=='running'||row.attempt?.runId!==claim.runId)domainReject('voice_transcript_changed');
      const timely=row.attempt&&Date.now()<Date.parse(row.attempt.expiresAt);
      const content=timely&&result.status==='completed'&&draft?domainParse(voiceTranscriptDraftSchema,draft):null;
      if(content){let end=0;for(const part of content.segments)if(part.startMs!==null){if(part.startMs<end||part.endMs! > row.value.voice.durationMs)domainReject('invalid_voice_timestamps',400);end=part.endMs!;}}
      // One permitted generation: quota rejection proves no provider call in this run. Other uncertain outcomes never retry.
      const quota=result.stopReason==='quota_exceeded'&&row.quotaDeferrals<7;
      const nextAt=quota?new Date(Math.floor(Date.now()/86400000)*86400000+86400000+60000).toISOString():null;
      const state=content?'available' as const:quota?'pending' as const:result.counts.modelCalls>0?'unknown' as const:'stopped' as const;
      const updated={...row,modelAttempted:!quota&&result.counts.modelCalls>0,quotaDeferrals:row.quotaDeferrals+(quota?1:0),
        attempt:quota?null:row.attempt,value:{...row.value,version:row.value.version+1,state,updatedAt:new Date().toISOString(),
          reason:content?null:result.stopReason??'interrupted',retryAt:nextAt,content}};
      const change=await b.prepareChange(claim.runId,'chat',false);change.commit();b.transaction.set(ref(data,row.value.voice.id),seal(data,updated));
      return quota?{state:'deferred' as const,nextAt:nextAt!}:{state:content?'completed' as const:state==='unknown'?'unknown' as const:'stopped' as const};
    });
  }
  return {claim,authorize,finish,readIn:async(b:Binding,id:string)=>(await read(b,id)).value,get:(userId:string,childId:string,id:string)=>authority.runTransaction(userId,childId,async b=>{
    const row=await read(b,id);
    // A lost worker result is not permission to transcribe the same audio again.
    return row.value.state==='running'&&row.attempt&&Date.parse(row.attempt.expiresAt)<=Date.now()
      ? {...row.value,state:'unknown' as const,reason:'interrupted',content:null}:row.value;
  })};
}
export type FirestoreVoiceTranscripts=ReturnType<typeof createFirestoreVoiceTranscripts>;
