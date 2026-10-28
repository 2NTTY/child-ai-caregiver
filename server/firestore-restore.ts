import { replayAvatarLifecycle, assertRestoredAvatarRelations, restoredAvatarCleanupRecords, mergeAvatarCopyResponsibilities } from './firestore-restore-avatars.ts';
import { isSharingAuthorityPath, sharingErasedBy, sharedSpaceSchema } from './firestore-sharing-records.ts';
import { replaySharingAuthority } from './firestore-restore-sharing.ts';
import type { AvatarObjectDescriptor, AvatarCleanupRecord } from './avatar-data.ts';
import { replayChatFileErasures, assertRestoredChatFileRelations } from './firestore-restore-chat-files.ts';
import { firestoreChatFileRowSchema } from './firestore-chat-files.ts';
import type { ChatFileObjectDescriptor } from './firebase-chat-file-objects.ts';
import { replayVoiceErasures, assertRestoredVoiceRelations } from './firestore-restore-voice.ts';
import { firestoreVoiceRowSchema } from './firestore-voice.ts';
import type { VoiceObjectDescriptor } from './firebase-voice-objects.ts';
import { replayContentErasures } from './firestore-restore-content-erasure.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { createFirestoreRestoreCodec, type FirestoreRestoreDecoded } from './firestore-restore-codec.ts';
import { firestoreAuthoritySchemas as authority } from './firestore-authority.ts';
import { FirestoreDomainData, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firestorePhotoSchemas as photos } from './firestore-photos.ts';
import { firestoreOnlineRecordSchema, firestoreOnlineErasureBarrierSchema, firestoreSharedResultSchema } from './firestore-online-receipts.ts';
import { firebaseErasureIntentHash, firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import type { FirebasePhotoObjectDescriptor } from './firebase-photo-objects.ts';
import { firebaseBackupDocumentDigest, type FirebaseBackupDocument } from './firestore-backup.ts';
import { assertFirestoreRestoreContent } from './firestore-restore-content.ts';
import { originalRestoreScopeKinds, discardedRestoreKinds } from './firestore-restore-operation-records.ts';
import { isRestoreProtocolOrUsage, restoreFirestoreUsage } from './firestore-restore-usage.ts';
import { firestoreScopeErasureSchema } from './firestore-erasure.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
export interface FirebaseRestoreAuthUser { userId: string; disabled: boolean; emailVerified: boolean; email: string | null }
export interface FirebaseRestoreInput {
  restoreId: string; targetDatabaseId: string; sourceGeneration: string;
  documents: FirebaseBackupDocument[]; liveDocuments: FirebaseBackupDocument[];
  authUsers: readonly FirebaseRestoreAuthUser[]; erasures: readonly FirebaseErasureIntent[];
  photoDescriptors: ReadonlyMap<string, FirebasePhotoObjectDescriptor>;
  avatarDescriptors?: ReadonlyMap<string, AvatarObjectDescriptor>; avatarObjectBucketName?: string;
  avatarCopyResponsibilities?: readonly AvatarCleanupRecord[];
  voiceDescriptors?: ReadonlyMap<string, VoiceObjectDescriptor>; voiceObjectBucketName?: string;
  chatFileDescriptors?: ReadonlyMap<string, ChatFileObjectDescriptor>; chatFileObjectBucketName?: string;
  erasureDescriptors: ReadonlyMap<string, FirebaseErasureDescriptor>;
}
export class FirebaseRestoreError extends Error {
  readonly code: string;
  constructor(code: string) { super('Firebase restore rejected'); this.name = 'FirebaseRestoreError'; this.code = code; }
}
function reject(code: string): never { throw new FirebaseRestoreError(code); }
function requireValue(condition: boolean, code = 'restore_relation'): asserts condition { if (!condition) reject(code); }
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function deterministicUuid(value: unknown): string {
  const bytes = createHash('sha256').update(canonical(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex'); return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
export function firebaseRestoreGeneration(projectId: string, targetDatabaseId: string, restoreId: string): string {
  z.uuid().parse(restoreId); return deterministicUuid(['firebase-restore', projectId, targetDatabaseId, restoreId, 'generation']);
}
export function firebaseRestoreEpoch(projectId: string, targetDatabaseId: string, restoreId: string, workspaceId: string): string {
  z.uuid().parse(restoreId); z.uuid().parse(workspaceId);
  return deterministicUuid(['firebase-restore', projectId, targetDatabaseId, restoreId, 'workspace', workspaceId]);
}
function rows<T>(records: readonly FirestoreRestoreDecoded[], kind: string, schema: z.ZodType<T>) {
  return records.filter(record => record.context.kind === kind).map(record => ({ record, value: schema.parse(record.value) }));
}
function unique<T>(values: readonly T[], key: (value: T) => string): Map<string,T> {
  const map = new Map<string,T>(); for (const value of values) { const id=key(value); requireValue(!map.has(id)); map.set(id,value); } return map;
}
const authSchema = z.object({ userId: z.string().min(1).max(256), disabled: z.boolean(), emailVerified: z.boolean(), email: z.email().nullable() }).strict();
const accountRank = { active:0, deleting:1, deleted:2 };
const identityRank = { active:0, revoked:1, deleting:2, deleted:3 };
function restricted<T extends string>(old: T, current: T, rank: Record<T,number>): T { return rank[old] >= rank[current] ? old : current; }

/** Complete F02 source graph. Device sessions are intentionally excluded and never restored. */
export function assertFirebaseRestoreAuthority(records: readonly FirestoreRestoreDecoded[]): void {
  const accounts=unique(rows(records,'account',authority.account),row=>row.value.userId);
  const identities=unique(rows(records,'authority-identity',authority.identity),row=>row.value.userId);
  const owners=unique(rows(records,'authority-owner',authority.owner),row=>row.value.userId);
  const workspaces=unique(rows(records,'workspace',authority.workspace),row=>row.value.id);
  const children=unique(rows(records,'child',authority.child),row=>row.value.id);
  const invitations=unique(rows(records,'authority-invitation',authority.invitation),row=>row.value.email);
  const classes=unique(rows(records,'shared-space',sharedSpaceSchema).filter(row=>row.value.kind==='class'),row=>row.value.id);
  requireValue(rows(records,'control',authority.control).length===1);
  requireValue(accounts.size===owners.size && accounts.size+classes.size===workspaces.size);
  for(const [id,classroom]of classes){
    const workspace=workspaces.get(id)?.value;
    requireValue(Boolean(workspace && workspace.ownerUserId==='space:'+id
      && classroom.value.storageIdentity.ownerUserId===workspace.ownerUserId && classroom.value.storageIdentity.workspaceId===id));
    if(classroom.value.state==='active')requireValue(accounts.has(classroom.value.managerUserId));
  }
  for (const [id,account] of accounts) {
    const identity=identities.get(id)?.value,owner=owners.get(id)?.value,workspace=owner&&workspaces.get(owner.workspaceId)?.value;
    requireValue(Boolean(owner && workspace && workspace.ownerUserId===id));
    if (account.value.status !== 'deleted') {
      requireValue(Boolean(identity)); const invitation=invitations.get(identity!.email)?.value;
      requireValue(Boolean(invitation && invitation.consumedBy===id));
    }
    requireValue(account.value.userId===id);
  }
  for (const record of records) {
    if(record.context.family==='knowledge'||record.context.kind==='photo-cleanup'||record.context.kind==='avatar-cleanup'
      || record.context.kind==='voice-asset' && firestoreVoiceRowSchema.parse(record.value).deletion !== null
      || record.context.kind==='chat-file-asset' && firestoreChatFileRowSchema.parse(record.value).deletion !== null
      || record.context.kind==='photo' && photos.photo.parse(record.value).state==='deleted')continue;
    const scope=record.context.scope;
    if(scope.workspaceId===NIL)continue;
    const workspace=workspaces.get(scope.workspaceId)?.value;
    requireValue(Boolean(workspace && workspace.ownerUserId===scope.ownerUserId));
    requireValue(scope.storageEpoch===workspace!.storageEpoch || originalRestoreScopeKinds.has(record.context.kind));
    if(scope.childId!==NIL) {
      const child=children.get(scope.childId)?.value;
      requireValue(Boolean(child && child.workspaceId===scope.workspaceId));
    }
  }
  const details=unique(rows(records,'authority-child-detail',authority.childDetail),row=>row.value.id);
  for(const [id,child]of children)if(child.value.status!=='deleted')requireValue(details.has(id)&&details.get(id)!.value.workspaceId===child.value.workspaceId);
}

/** Pure preparation; source records are decoded afresh. The caller still owns pinned backup IO and atomic isolated commit. */
export function prepareFirebaseRestore(options: FirestoreDomainOptions, input: FirebaseRestoreInput) {
  z.uuid().parse(input.restoreId); z.uuid().parse(input.sourceGeneration);
  requireValue(/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u.test(input.targetDatabaseId)
    && input.targetDatabaseId!==options.database.databaseId,'restore_target');
  requireValue(input.documents.length<=2000&&input.liveDocuments.length<=2000,'restore_limit');
  const codec=createFirestoreRestoreCodec(options), data=new FirestoreDomainData(options);
  const isSession=(row:FirebaseBackupDocument)=>isRestoreProtocolOrUsage(options.namespace,row.path);
  const decoded=input.documents.filter(row=>!isSession(row)).map(row=>codec.decode(row));
  const live=input.liveDocuments.filter(row=>!isSession(row)).map(row=>codec.decode(row));
  unique(decoded,row=>row.path); unique(live,row=>row.path);
  assertFirebaseRestoreAuthority(decoded); assertFirebaseRestoreAuthority(live);
  replaySharingAuthority(codec, decoded, live, input.liveDocuments);
  const oldControl=rows(decoded,'control',authority.control)[0]!.value,liveControl=rows(live,'control',authority.control)[0]!.value;
  requireValue(!oldControl.enabled&&!liveControl.enabled&&liveControl.generation===input.sourceGeneration,'restore_source_not_paused');
  const authUsers=unique(input.authUsers.map(value=>authSchema.parse(value)),value=>value.userId);
  const currentByKey=unique(live,row=>row.context.kind+':'+row.context.id);
  const current=<T>(record:FirestoreRestoreDecoded,schema:z.ZodType<T>):T|null=>{
    const row=currentByKey.get(record.context.kind+':'+record.context.id);return row?schema.parse(row.value):null;
  };
  const accounts=rows(decoded,'account',authority.account), identities=rows(decoded,'authority-identity',authority.identity);
  const oldIdentities=unique(identities,row=>row.value.userId);
  for (const {record,value}of accounts) {
    const latest=current(record,authority.account), identity=oldIdentities.get(value.userId);
    if (!identity) { requireValue(value.status==='deleted'); continue; }
    const liveIdentity=current(identity.record,authority.identity), user=authUsers.get(value.userId);
    requireValue(user!==undefined,'restore_auth_missing');
    const identityLive=liveIdentity?.state==='active'&&user.email!==null&&user.email.trim().toLowerCase()===identity.value.email
      &&liveIdentity.email===identity.value.email&&!user.disabled;
    record.value={...value,status:latest?restricted(value.status,latest.status,accountRank):value.status,
      admitted:value.admitted&&Boolean(latest?.admitted)&&identityLive,invitationLive:value.invitationLive&&Boolean(latest?.invitationLive)&&identityLive,
      emailVerified:user.emailVerified&&!user.disabled,acknowledgementVersion:latest?.acknowledgementVersion===value.acknowledgementVersion?value.acknowledgementVersion:null};
    identity.record.value={...identity.value,state:identityLive&&liveIdentity?restricted(identity.value.state,liveIdentity.state,identityRank)
      :restricted(identity.value.state,liveIdentity?.state??'revoked',identityRank)==='active'?'revoked':restricted(identity.value.state,liveIdentity?.state??'revoked',identityRank)};
  }
  for(const {record,value}of rows(decoded,'authority-invitation',authority.invitation)) {
    const latest=current(record,authority.invitation);
    record.value=latest?{...latest,state:value.state==='revoked'?'revoked':latest.state,
      expiresAt:Date.parse(value.expiresAt)<Date.parse(latest.expiresAt)?value.expiresAt:latest.expiresAt}:{...value,state:'revoked'};
    // A changed identity/consumer is never silently reattached to a restored account.
    if(value.consumedBy!==null&&latest?.consumedBy!==value.consumedBy)reject('restore_invitation_changed');
  }
  const newEpochByWorkspace=new Map<string,string>(),newAuthorizationVersionByWorkspace=new Map<string,string>();
  for(const {record,value}of rows(decoded,'workspace',authority.workspace)) {
    const latest=current(record,authority.workspace);requireValue(Boolean(latest&&latest.ownerUserId===value.ownerUserId),'restore_live_workspace_missing');
    const childAccessVersion = value.childAccessVersion === undefined && latest!.childAccessVersion === undefined ? undefined
      : BigInt(value.childAccessVersion ?? '0') > BigInt(latest!.childAccessVersion ?? '0') ? value.childAccessVersion! : latest!.childAccessVersion ?? '0';
    record.value={...value,status:restricted(value.status,latest!.status,accountRank),
      ...(childAccessVersion === undefined ? {} : { childAccessVersion }),
      accessVersion:BigInt(value.accessVersion)>BigInt(latest!.accessVersion)?value.accessVersion:latest!.accessVersion};
    newAuthorizationVersionByWorkspace.set(value.id,(BigInt(authority.workspace.parse(record.value).accessVersion)+1n).toString());
    newEpochByWorkspace.set(value.id,firebaseRestoreEpoch(options.projectId,input.targetDatabaseId,input.restoreId,value.id));
  }
  for(const {record,value}of rows(decoded,'child',authority.child)) {
    const latest=current(record,authority.child);
    record.value={...value,status:latest&&latest.workspaceId===value.workspaceId?restricted(value.status,latest.status,accountRank):'deleted'};
  }
  requireValue(input.erasures.length<=2000,'restore_limit');
  const journal=input.erasures.map(value=>firebaseErasureIntentSchema.parse(value));
  unique(journal,value=>canonical([value.scope.ownerUserId,value.operationId]));
  const scopeJournal=journal.filter(intent=>['child-delete','account-delete'].includes(intent.type));
  // Complete original-object erasure first; recovery must not discard an unresolved cleanup obligation.
  for(const intent of scopeJournal) {
    const job=rows(live,'scope-erasure',firestoreScopeErasureSchema).find(row=>row.value.intent.operationId===intent.operationId
      &&canonical(row.value.intent)===canonical(intent));
    requireValue(job?.value.state==='completed','restore_pending_scope_cleanup');
  }
  const erasedByScope=(owner:string,workspace:string,child:string)=>scopeJournal.some(intent=>intent.scope.ownerUserId===owner
    && (intent.type==='account-delete'||intent.scope.workspaceId===workspace&&intent.scope.childId===child));
  const scopeRemoved=new Set<string>();
  for(const record of decoded) {
    if(record.context.family==='knowledge')continue;
    const {scope,kind}=record.context;
    const accountErased=scopeJournal.some(v=>v.type==='account-delete'&&v.scope.ownerUserId===scope.ownerUserId);
    const body=record.value as Record<string,any>;
    const matches=accountErased||erasedByScope(scope.ownerUserId,scope.workspaceId,scope.childId)
      || scopeJournal.some(intent => sharingErasedBy(kind, body, intent.scope, intent.type === 'account-delete'))
      || ['online-receipt','authority-operation','document-operation','change-projection','change'].includes(kind)
        && erasedByScope(scope.ownerUserId,body.result?.scope?.workspaceId??body.result?.child?.workspaceId??scope.workspaceId,
          body.childId??body.result?.child?.id??body.result?.childId??body.result?.scope?.childId??NIL)
      || kind==='authority-invitation'&&scopeJournal.some(v=>v.type==='account-delete'&&v.scope.ownerUserId===body.consumedBy);
    if(!matches)continue;
    if(kind==='account')record.value={...authority.account.parse(record.value),status:'deleted',admitted:false,invitationLive:false,emailVerified:false,acknowledgementVersion:null};
    else if(kind==='workspace')record.value={...authority.workspace.parse(record.value),status:'deleted'};
    else if(kind==='child')record.value={...authority.child.parse(record.value),status:'deleted'};
    else if(kind!=='authority-owner'&&kind!=='scope-erasure')scopeRemoved.add(record.path);
  }
  replayAvatarLifecycle(data,codec,decoded,live,journal,input.erasureDescriptors,scopeRemoved);
  replayVoiceErasures(data,codec,decoded,live,journal,input.erasureDescriptors,scopeRemoved);
  replayChatFileErasures(data,codec,decoded,live,journal,input.erasureDescriptors,scopeRemoved);
  const intentByAsset=new Map<string,FirebaseErasureIntent>();
  for(const intent of journal.filter(v=>v.type==='photo-delete')){const prior=intentByAsset.get(intent.assetId);if(prior&&canonical(prior.scope)!==canonical(intent.scope))reject('restore_erasure_binding');intentByAsset.set(intent.assetId,intent);}
  const erasedReservations=new Map<string,string>(), removed=new Set(scopeRemoved);
  for(const {record,value}of rows(decoded,'photo',photos.photo)) {
    if(scopeRemoved.has(record.path))continue;
    const intent=intentByAsset.get(value.id);
    if(value.deletion)requireValue(Boolean(intent&&canonical(intent)===canonical(value.deletion.intent)),'restore_erasure_missing');
    if(intent) {
      requireValue(intent.scope.ownerUserId===value.scope.ownerUserId&&intent.scope.workspaceId===value.scope.workspaceId&&intent.scope.childId===value.scope.childId,'restore_erasure_binding');
      erasedReservations.set(canonical([value.scope.ownerUserId,value.reservationOperationId]),value.id);removed.add(record.path);
    }
  }
  // Keep original cleanup envelopes, including newer delete completions, so old immutable objects remain charged and fenced.
  const cleanup=unique(rows(decoded,'photo-cleanup',photos.cleanup).filter(row=>!scopeRemoved.has(row.record.path)),row=>row.value.photoId);
  for(const row of rows(live,'photo-cleanup',photos.cleanup)) {
    if(erasedByScope(row.value.scope.ownerUserId,row.value.scope.workspaceId,row.value.scope.childId))continue;
    const intent=intentByAsset.get(row.value.photoId);
    requireValue(Boolean(intent&&(!row.value.journal||row.value.journal.intentSha256===firebaseErasureIntentHash(intent))
      &&canonical(intent.scope)===canonical(row.value.scope)&&intent.operationId===row.value.operationId),'restore_erasure_missing');
    const old=cleanup.get(row.value.photoId);if(old)removed.add(old.record.path);
    decoded.push(row.record);cleanup.set(row.value.photoId,row);
  }
  // The independent journal may be durable even when its reply never reached the shared writer.
  for (const [id, row] of cleanup) {
    if (row.value.journal) continue;
    const intent = intentByAsset.get(id);
    requireValue(Boolean(intent && canonical(intent.scope) === canonical(row.value.scope)
      && intent.operationId === row.value.operationId), 'restore_erasure_missing');
    const proof = firebaseErasureDescriptorSchema.parse(input.erasureDescriptors.get(firebaseErasureIntentHash(intent!)));
    requireValue(proof.intentSha256 === firebaseErasureIntentHash(intent!), 'restore_erasure_binding');
    const value = photos.cleanup.parse({...row.value, journal: proof});
    const record = codec.decode({path: row.record.path, data: {scopeTag: firestoreDomainHash([options.projectId,options.namespace,'photo-scope',value.scope]),
      state:value.state, ...data.seal('photo-cleanup',id,value.scope,photos.cleanup,value)}});
    removed.add(row.record.path); decoded.push(record); cleanup.set(id,{record,value});
  }
  const backupPhotos=unique(rows(decoded,'photo',photos.photo),row=>row.value.id);
  const currentPhotos=unique(rows(live,'photo',photos.photo),row=>row.value.id);
  for(const intent of journal.filter(v=>v.type==='photo-delete'))if(!cleanup.has(intent.assetId) && !erasedByScope(intent.scope.ownerUserId,intent.scope.workspaceId,intent.scope.childId)) {
    const settled=currentPhotos.get(intent.assetId)?.value;
    // The live photo writer retains the authenticated tombstone after its cleanup
    // transaction removes the obligation and releases quota. There is nothing to
    // reconstruct once that exact deletion has completed; the photo stays removed.
    if(settled?.state==='deleted' && canonical(settled.scope)===canonical(intent.scope)
      && canonical(settled.deletion!.intent)===canonical(intent)
      && settled.deletion!.journal?.intentSha256===firebaseErasureIntentHash(intent))continue;
    const sourcePhoto=currentPhotos.get(intent.assetId)??backupPhotos.get(intent.assetId);
    requireValue(sourcePhoto!==undefined,'restore_cleanup_evidence_missing');
    const photo=sourcePhoto!.value,intentHash=firebaseErasureIntentHash(intent);
    const journalDescriptor=firebaseErasureDescriptorSchema.parse(input.erasureDescriptors.get(intentHash));
    requireValue(journalDescriptor.intentSha256===intentHash&&canonical(photo.scope)===canonical(intent.scope),'restore_erasure_binding');
    const previous=backupPhotos.get(photo.id)?.value;
    const metadata=photo.metadata??previous?.metadata;
    requireValue(metadata!==null&&metadata!==undefined,'restore_cleanup_evidence_missing');
    const descriptor=photo.descriptor??previous?.descriptor??null,upload=photo.upload??previous?.upload??null;
    const value=photos.cleanup.parse({scope:photo.scope,photoId:photo.id,operationId:intent.operationId,
      state:descriptor?'known':'unresolved',uploadStarted:upload!==null,upload,...(photo.objectScope?{objectScope:photo.objectScope}:{}),sha256:metadata!.sha256,
      bytes:metadata!.bytes,mimeType:metadata!.mimeType,descriptor,journal:journalDescriptor});
    const id=photo.id,path=data.ref('photo_cleanup','photo-cleanup',id).path;
    const record=codec.decode({path,data:{scopeTag:firestoreDomainHash([options.projectId,options.namespace,'photo-scope',photo.scope]),state:value.state,
      ...data.seal('photo-cleanup',id,photo.scope,photos.cleanup,value)}});
    decoded.push(record);cleanup.set(id,{record,value});
  }
  // A real cleanup consumer needs an authenticated, body-free original-scope tombstone.
  const cleanupTombstones = new Map<string, FirestoreRestoreDecoded>();
  for (const {value: job} of cleanup.values()) {
    const intent = intentByAsset.get(job.photoId)!;
    requireValue(Boolean(intent && job.journal?.intentSha256 === firebaseErasureIntentHash(intent)), 'restore_erasure_missing');
    const prior = currentPhotos.get(job.photoId)?.value ?? backupPhotos.get(job.photoId)?.value;
    requireValue(Boolean(prior), 'restore_cleanup_evidence_missing');
    const tombstone = photos.photo.parse({ id: job.photoId, scope: job.scope, reservationOperationId: prior!.reservationOperationId,
      createdAt: prior!.createdAt, version: prior!.version, state: 'deleted', metadata: null, descriptor: null, upload: job.upload,
      ...(job.objectScope ? {objectScope: job.objectScope} : {}),
      deletion: {...prior!.deletion, intent, expectedVersion: prior!.deletion?.expectedVersion ?? prior!.version,
        fingerprint: prior!.deletion?.fingerprint ?? firestoreDomainHash(['delete', job.photoId, prior!.version]), journal: job.journal} });
    const record = codec.decode({path: data.ref('photos','photo',job.photoId).path, data: {
      assetId:job.photoId,scopeTag:firestoreDomainHash([options.projectId,options.namespace,'photo-scope',job.scope]),
      live:false,sortKey:tombstone.createdAt+'/'+job.photoId,
      ...data.seal('photo',job.photoId,job.scope,photos.photo,tombstone,tombstone.version)}});
    removed.add(record.path); decoded.push(record); cleanupTombstones.set(record.path,record);
  }
  const outputExtras:FirebaseBackupDocument[]=restoreFirestoreUsage(options,input.documents,input.liveDocuments,
    [...decoded,...live].filter(v=>v.context.kind==='agent-run').map(v=>v.context.id));
  for(const {record,value}of rows(decoded,'online-receipt',z.union([firestoreOnlineRecordSchema,firestoreOnlineErasureBarrierSchema]))) {
    if (!('state' in value)) {
      const pointer = firestoreSharedResultSchema.safeParse(value.result);
      if (pointer.success && 'format' in pointer.data.result && pointer.data.result.format === 'shared-photo-deletion:1') {
        const intent = intentByAsset.get(pointer.data.result.id);
        if (intent) record.value = {...value, result:null};
      }
    }
    if('operation'in value && erasedReservations.has(canonical([value.ownerUserId,value.operation.opId]))) {
      requireValue(!('state'in value),'restore_erasure_receipt');record.value={...value,result:null};
    }
  }
  for(const intent of journal.filter(v=>v.type==='photo-delete'||v.type==='voice-delete'||v.type==='file-delete'||v.type==='avatar-delete')) {
    if(erasedByScope(intent.scope.ownerUserId,intent.scope.workspaceId,intent.scope.childId))continue;
    const epoch=newEpochByWorkspace.get(intent.scope.workspaceId);if(!epoch)continue;
    const owner=accounts.find(row=>row.value.userId===intent.scope.ownerUserId);
    const classroom=rows(decoded,'shared-space',sharedSpaceSchema).find(row=>row.value.kind==='class'
      && row.value.id===intent.scope.workspaceId && row.value.storageIdentity.workspaceId===intent.scope.workspaceId
      && row.value.storageIdentity.ownerUserId===intent.scope.ownerUserId);
    requireValue(Boolean(owner||classroom),'restore_erasure_binding');
    const id=JSON.stringify([intent.scope.ownerUserId,intent.operationId]);
    const existing=decoded.find(row=>row.context.kind==='online-receipt'&&row.context.id===id);
    if(existing)continue;
    const scope={...intent.scope,storageEpoch:epoch,childId:NIL};
    const barrier=firestoreOnlineErasureBarrierSchema.parse({state:'erasure_barrier',ownerUserId:scope.ownerUserId,operationId:intent.operationId,
      childId:intent.scope.childId,assetId:intent.assetId,intentSha256:firebaseErasureIntentHash(intent)});
    outputExtras.push({path:data.ref('online_operations','online-receipt',id).path,
      data:{...data.tags(scope),...data.seal('online-receipt',id,scope,firestoreOnlineErasureBarrierSchema,barrier)}});
  }
  for (const path of replayContentErasures(data,codec,decoded,live,journal,new Map(input.liveDocuments.map(row=>[row.path,row.data])))) removed.add(path);
  const keep=decoded.filter(record=>(!removed.has(record.path)||cleanup.get(record.context.id)?.record===record||cleanupTombstones.get(record.path)===record) && !discardedRestoreKinds.has(record.context.kind));
  // A completed erasure may leave historical owner-wide receipt metadata in an old
  // backup. Remove its authenticated child scope first, then require the entire
  // surviving content graph; missing live content is still an error.
  assertFirestoreRestoreContent(keep);assertRestoredVoiceRelations(keep);assertRestoredChatFileRelations(keep);assertRestoredAvatarRelations(keep);
  const livePhotos=rows(keep,'photo',photos.photo).filter(row=>row.value.state==='ready'||row.value.state==='reserved');
  const quotas=new Map<string,{bytes:number;count:number}>();
  for(const row of livePhotos) {
    requireValue(row.value.metadata!==null);const key=canonical(row.value.scope),quota=quotas.get(key)??{bytes:0,count:0};
    quota.bytes+=row.value.metadata!.bytes;quota.count++;quotas.set(key,quota);
  }
  let activeBytes=0,activeCount=0;for(const quota of quotas.values()){activeBytes+=quota.bytes;activeCount+=quota.count;}
  const childQuotas=rows(keep,'photo-child-quota',photos.childQuota);
  for(const row of childQuotas){requireValue(row.record.context.family!=='knowledge');row.record.value=photos.childQuota.parse(quotas.get(canonical(row.record.context.scope))??{bytes:0,count:0});}
  for(const key of quotas.keys())requireValue(childQuotas.some(row=>row.record.context.family!=='knowledge'&&canonical(row.record.context.scope)===key),'restore_quota_missing');
  const allCleanup=rows(keep,'photo-cleanup',photos.cleanup),global=rows(keep,'photo-global-quota',photos.globalQuota);
  for(const row of allCleanup){const intent=intentByAsset.get(row.value.photoId);requireValue(Boolean(intent
    &&canonical(intent.scope)===canonical(row.value.scope)&&intent.operationId===row.value.operationId
    &&row.value.journal?.intentSha256===firebaseErasureIntentHash(intent)),'restore_erasure_missing');}
  if(!global.length&&allCleanup.length){const currentGlobal=rows(live,'photo-global-quota',photos.globalQuota);
    requireValue(currentGlobal.length===1,'restore_quota_missing');global.push(currentGlobal[0]!);keep.push(currentGlobal[0]!.record);}
  if(livePhotos.length||allCleanup.length)requireValue(global.length===1,'restore_quota_missing');
  if(global.length)global[0]!.record.value=photos.globalQuota.parse({activeBytes,activeCount,
    cleanupBytes:allCleanup.reduce((sum,row)=>sum+row.value.bytes,0),cleanupCount:allCleanup.length});
  const generation=firebaseRestoreGeneration(options.projectId,input.targetDatabaseId,input.restoreId);
  const transform = {generation,newEpochByWorkspace,newAuthorizationVersionByWorkspace,photoDescriptors:input.photoDescriptors,voiceDescriptors:input.voiceDescriptors,voiceObjectBucketName:input.voiceObjectBucketName,chatFileDescriptors:input.chatFileDescriptors,chatFileObjectBucketName:input.chatFileObjectBucketName,avatarDescriptors:input.avatarDescriptors,avatarObjectBucketName:input.avatarObjectBucketName};
  const records=keep.map(record=>{const transformed=codec.transform(record,transform);
    return {path:transformed.path,data:transformed.data};}).concat(outputExtras, restoredAvatarCleanupRecords(data, keep, transform));
  if (input.avatarCopyResponsibilities?.length) {
    requireValue(Boolean(input.avatarObjectBucketName), 'restore_avatar_descriptor_missing');
    mergeAvatarCopyResponsibilities(data, codec, records, input.avatarCopyResponsibilities, { bucketName: input.avatarObjectBucketName!,
      epochFor: binding => firebaseRestoreEpoch(options.projectId, input.targetDatabaseId, input.restoreId, binding.scope.workspaceId), erasures: journal });
  }
  unique(records,row=>row.path);
  const outputPaths=new Set(records.map(row=>row.path));
  const removePaths=input.documents.filter(row=>!outputPaths.has(row.path)).map(row=>row.path);
  // The operator persists a bounded encrypted plan, applies pages, then validates the complete paused result.
  const encodedBytes=records.reduce((sum,row)=>sum+firebaseBackupDocumentDigest(row).bytes,0);
  requireValue(records.length<=4000&&encodedBytes<=32*1024*1024,'restore_limit');
  const restored=records.filter(row=>!isSession(row)).map(row=>codec.decode(row));
  assertFirebaseRestoreAuthority(restored);assertFirestoreRestoreContent(restored);assertRestoredVoiceRelations(restored);assertRestoredChatFileRelations(restored);assertRestoredAvatarRelations(restored,true);
  return {records,removePaths,generation,newEpochByWorkspace,journalHash:digest(journal.map(firebaseErasureIntentHash).sort()),
    authHash:digest([...authUsers.values()].sort((a,b)=>a.userId.localeCompare(b.userId))),
    authorityHash:digest(input.liveDocuments.filter(row=>row.path.startsWith(options.namespace+'/') || isSharingAuthorityPath(options.namespace, row.path)).map(row=>({path:row.path,...firebaseBackupDocumentDigest(row)})).sort((a,b)=>a.path.localeCompare(b.path)))};
}
