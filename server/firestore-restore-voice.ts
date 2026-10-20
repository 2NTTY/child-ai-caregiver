import { canonical } from './firestore-session-codec.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestoreVoiceRowSchema, type FirestoreVoiceRow } from './firestore-voice.ts';
import { firestoreVoiceTranscriptSchema } from './firestore-voice-transcripts.ts';
import { firestoreChatMessageSchema } from './firestore-chat.ts';
import { erasureCoversVoice, firebaseErasureIntentHash, firebaseErasureDescriptorSchema,
  type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import type { FirestoreRestoreCodec, FirestoreRestoreDecoded } from './firestore-restore-codec.ts';

function requireValue(ok: unknown, code='restore_voice_binding'): asserts ok {
  if (!ok) throw Object.assign(new Error('Voice recovery rejected'),{code,status:409});
}
/** Replays independent deletion evidence before any recovered voice or transcript can be disclosed. */
export function replayVoiceErasures(data:FirestoreDomainData,codec:FirestoreRestoreCodec,records:FirestoreRestoreDecoded[],
  live:readonly FirestoreRestoreDecoded[],journal:readonly FirebaseErasureIntent[],proofs:ReadonlyMap<string,FirebaseErasureDescriptor>,removed:ReadonlySet<string>) {
  const assets=(values:readonly FirestoreRestoreDecoded[])=>new Map(values.filter(r=>r.context.kind==='voice-asset')
    .map(record=>{const value=firestoreVoiceRowSchema.parse(record.value);return [value.id,{record,value}] as const;}));
  const old=assets(records),current=assets(live),intents=new Map<string,FirebaseErasureIntent>();
  for(const intent of journal.filter(v=>v.type==='voice-delete')) {
    const prior=intents.get(intent.assetId);requireValue(!prior||canonical(prior)===canonical(intent));intents.set(intent.assetId,intent);
  }
  for(const {value,record} of old.values()) if(value.deletion&&!removed.has(record.path))
    requireValue(journal.some(i=>canonical(i)===canonical(value.deletion!.intent)),'restore_erasure_missing');
  for(const [id,intent] of intents) {
    if(journal.some(i=>['child-delete','account-delete'].includes(i.type)&&erasureCoversVoice(i,intent.scope,id)))continue;
    const source=current.get(id)??old.get(id);requireValue(source,'restore_cleanup_evidence_missing');
    const row=source.value;requireValue(erasureCoversVoice(intent,row.objectScope,id));
    if(row.deletion)requireValue(canonical(row.deletion.intent)===canonical(intent));
    const integrity=row.metadata??row.deletion?.integrity;requireValue(integrity,'restore_cleanup_evidence_missing');
    const proof=firebaseErasureDescriptorSchema.parse(proofs.get(firebaseErasureIntentHash(intent)));
    requireValue(proof.intentSha256===firebaseErasureIntentHash(intent));
    const tombstone:FirestoreVoiceRow=firestoreVoiceRowSchema.parse({...row,state:'deleted',metadata:null,
      version:row.deletion?row.version:row.version+1,
      deletion:row.deletion?{...row.deletion,proof}:{intent,proof,expectedVersion:row.version,
        integrity:{bytes:integrity.bytes,sha256:integrity.sha256,mimeType:integrity.mimeType},cleanup:'pending',attempts:0,nextCheckAt:intent.at}});
    for(let index=records.length-1;index>=0;index--)if(['voice-asset','voice-transcript'].includes(records[index]!.context.kind)&&records[index]!.context.id===id)records.splice(index,1);
    const path=data.ref('voice_assets','voice-asset',id).path;
    records.push(codec.decode({path,data:{...data.tags(row.scope),scopeTag:firestoreDomainHash(['voice-scope',row.scope]),
      assetId:id,state:'deleted',createdAt:row.createdAt,updatedAt:row.updatedAt,messageId:row.messageId,
      cleanupState:tombstone.deletion!.cleanup,cleanupAt:tombstone.deletion!.nextCheckAt,
      ...data.seal('voice-asset',id,row.scope,firestoreVoiceRowSchema,tombstone,tombstone.version)}}));
  }
}
/** A transcript is only reusable with the same immutable message/audio and current scope. */
export function assertRestoredVoiceRelations(records:readonly FirestoreRestoreDecoded[]) {
  const voices=new Map(records.filter(r=>r.context.kind==='voice-asset').map(r=>[r.context.id,{record:r,value:firestoreVoiceRowSchema.parse(r.value)}]));
  const messages=new Map(records.filter(r=>r.context.kind==='chat-message').map(r=>{const v=firestoreChatMessageSchema.parse(r.value);return [v.id,{record:r,value:v}] as const;}));
  for(const record of records.filter(r=>r.context.kind==='voice-transcript')) {
    const row=firestoreVoiceTranscriptSchema.parse(record.value),voice=voices.get(row.value.voice.id),message=messages.get(row.value.messageId);
    if(voice?.value.deletion)continue; // Pending physical cleanup remains hidden and journal replay removes the transcript.
    requireValue(voice&&message&&voice.value.state==='ready'&&voice.value.descriptor&&voice.value.messageId===row.value.messageId);
    requireValue(message.record.context.family==='domain'&&canonical(message.record.context.scope)===canonical(row.scope)
      &&canonical(voice.value.scope)===canonical(row.scope)&&canonical(message.value.voice)===canonical(row.value.voice)
      &&voice.value.version===row.value.voice.version
      &&['bytes','sha256','mimeType','durationMs'].every(k=>voice.value.descriptor![k as keyof typeof voice.value.descriptor]===row.value.voice[k as keyof typeof row.value.voice]));
  }
}
