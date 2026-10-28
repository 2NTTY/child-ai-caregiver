import { canonical } from './firestore-session-codec.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestoreChatFileRowSchema, type FirestoreChatFileRow } from './firestore-chat-files.ts';
import { firestoreChatMessageSchema } from './firestore-chat.ts';
import { erasureCoversChatFile, firebaseErasureIntentHash, firebaseErasureDescriptorSchema,
  type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import type { FirestoreRestoreCodec, FirestoreRestoreDecoded } from './firestore-restore-codec.ts';

function requireValue(ok: unknown, code='restore_chat_file_binding'): asserts ok {
  if (!ok) throw Object.assign(new Error('File recovery rejected'),{code,status:409});
}
/** Replays independent deletion evidence before any recovered file can be disclosed. */
export function replayChatFileErasures(data:FirestoreDomainData,codec:FirestoreRestoreCodec,records:FirestoreRestoreDecoded[],
  live:readonly FirestoreRestoreDecoded[],journal:readonly FirebaseErasureIntent[],proofs:ReadonlyMap<string,FirebaseErasureDescriptor>,removed:ReadonlySet<string>) {
  const assets=(values:readonly FirestoreRestoreDecoded[])=>new Map(values.filter(r=>r.context.kind==='chat-file-asset')
    .map(record=>{const value=firestoreChatFileRowSchema.parse(record.value);return [value.id,{record,value}] as const;}));
  const old=assets(records),current=assets(live),intents=new Map<string,FirebaseErasureIntent>();
  for(const intent of journal.filter(v=>v.type==='file-delete')) {
    const prior=intents.get(intent.assetId);requireValue(!prior||canonical(prior)===canonical(intent));intents.set(intent.assetId,intent);
  }
  for(const {value,record} of old.values()) if(value.deletion&&!removed.has(record.path))
    requireValue(journal.some(i=>canonical(i)===canonical(value.deletion!.intent)),'restore_erasure_missing');
  for(const [id,intent] of intents) {
    if(journal.some(i=>['child-delete','account-delete','class-delete'].includes(i.type)&&erasureCoversChatFile(i,intent.scope,id)))continue;
    const source=current.get(id)??old.get(id);requireValue(source,'restore_cleanup_evidence_missing');
    const row=source.value;requireValue(erasureCoversChatFile(intent,row.objectScope,id));
    if(row.deletion)requireValue(canonical(row.deletion.intent)===canonical(intent));
    const integrity=row.metadata??row.deletion?.integrity;requireValue(integrity,'restore_cleanup_evidence_missing');
    const proof=firebaseErasureDescriptorSchema.parse(proofs.get(firebaseErasureIntentHash(intent)));
    requireValue(proof.intentSha256===firebaseErasureIntentHash(intent));
    const tombstone:FirestoreChatFileRow=firestoreChatFileRowSchema.parse({...row,state:'deleted',metadata:null,
      version:row.deletion?row.version:row.version+1,
      deletion:row.deletion?{...row.deletion,proof}:{intent,proof,expectedVersion:row.version,
        integrity:{bytes:integrity.bytes,sha256:integrity.sha256,mimeType:integrity.mimeType},cleanup:'pending',attempts:0,nextCheckAt:intent.at}});
    for(let index=records.length-1;index>=0;index--)if(records[index]!.context.kind==='chat-file-asset'&&records[index]!.context.id===id)records.splice(index,1);
    const path=data.ref('chat_file_assets','chat-file-asset',id).path;
    records.push(codec.decode({path,data:{...data.tags(row.scope),scopeTag:firestoreDomainHash(['chat-file-scope',row.scope]),
      assetId:id,state:'deleted',createdAt:row.createdAt,updatedAt:row.updatedAt,messageId:row.messageId,
      cleanupState:tombstone.deletion!.cleanup,cleanupAt:tombstone.deletion!.nextCheckAt,
      ...data.seal('chat-file-asset',id,row.scope,firestoreChatFileRowSchema,tombstone,tombstone.version)}}));
  }
}
/** Chat references keep the same authorized original; erased assets stay unreadable. */
export function assertRestoredChatFileRelations(records: readonly FirestoreRestoreDecoded[]) {
  const files = new Map(records.filter(r => r.context.kind === 'chat-file-asset').map(r => [r.context.id, firestoreChatFileRowSchema.parse(r.value)]));
  const messages = new Map(records.filter(r => r.context.kind === 'chat-message').map(r => {
    const value = firestoreChatMessageSchema.parse(r.value); return [value.id, { record: r, value }] as const;
  }));
  for (const { record, value: message } of messages.values()) {
    if (!message.file) continue;
    const file = files.get(message.file.id); requireValue(file);
    requireValue(file.messageId === message.id && record.context.family === 'domain'
      && file.scope.ownerUserId === record.context.scope.ownerUserId && file.scope.workspaceId === record.context.scope.workspaceId && file.scope.childId === record.context.scope.childId);
    if (file.deletion) continue;
    requireValue(file.state === 'ready' && file.descriptor && file.version === message.file.version
      && canonical(file.scope) === canonical(record.context.scope)
      && ['bytes','sha256','mimeType'].every(k => file.descriptor![k as keyof typeof file.descriptor] === message.file![k as keyof typeof message.file]));
  }
  for (const file of files.values()) if (file.state === 'ready' && file.messageId)
    requireValue(messages.get(file.messageId)?.value.file?.id === file.id);
}
