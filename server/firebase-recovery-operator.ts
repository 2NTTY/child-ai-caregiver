import { erasureCoversPhoto } from './firebase-erasure-journal.ts';
import { createHash } from 'node:crypto';
import { FieldPath, type Firestore } from '@google-cloud/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES, inspectFirebaseBackupSnapshot, assertFirebaseNativeExport,
  assertFirebaseBackupInventory, firebaseBackupDocumentDigest, type FirebaseBackupDocument, type FirebaseBackupOptions, type FirebaseBackupInventory } from './firestore-backup.ts';
import { createFirestoreRestoreCodec } from './firestore-restore-codec.ts';
import { prepareFirebaseRestore, assertFirebaseRestoreAuthority, firebaseRestoreEpoch, type FirebaseRestoreAuthUser } from './firestore-restore.ts';
import { assertFirestoreRestoreContent } from './firestore-restore-content.ts';
import { isRestoreProtocolOrUsage } from './firestore-restore-usage.ts';
import { createFirebaseRestoreApply } from './firebase-restore-apply.ts';
import { firestoreAuthoritySchemas as authority } from './firestore-authority.ts';
import { firestorePhotoSchemas as photoSchemas } from './firestore-photos.ts';
import { workRecoveryDocumentId } from './firestore-work-continuation-recovery.ts';
import { firebaseErasureIntentHash, type FirebaseErasureJournal, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import type { FirebasePhotoRecovery } from './firebase-photo-recovery.ts';
import type { FirebasePhotoObjectDescriptor, FirebasePhotoObjects } from './firebase-photo-objects.ts';
import { firebaseBackupManifestDescriptorSchema, type FirebaseBackupArtifacts, type FirebaseBackupManifestDescriptor,
  type FirebaseBackupManifestPayload, type FirebaseBackupPhotoManifestEntry, firebaseBackupInventorySchema } from './firebase-backup-artifacts.ts';
import type { createFirebaseNativeRecovery } from './firebase-native-recovery.ts';
import type { createFirebaseManagedBackup } from './firebase-managed-backup.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/u),uuid=z.uuid();
const operationSchema=z.object({done:z.literal(true),error:z.never().optional(),metadata:z.object({operationState:z.literal('SUCCESSFUL'),
  inputUriPrefix:z.string(),progressDocuments:z.object({completedWork:z.string().regex(/^[0-9]+$/u)}).passthrough()}).passthrough()}).passthrough();
const checkpointSchema=z.object({format:z.literal('yuban-firebase-restore/v1'),state:z.literal('applied-paused'),
  restoreId:uuid,backupId:uuid,manifestSha256:hash,sourceDatabaseId:z.string(),targetDatabaseId:z.string(),
  sourceGeneration:uuid,generation:uuid,journalHash:hash,authHash:hash,authorityHash:hash,inventory:firebaseBackupInventorySchema}).strict();
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export class FirebaseRecoveryOperatorError extends Error {
  readonly code:string;
  constructor(code:string){super('Firebase recovery operator rejected');this.name='FirebaseRecoveryOperatorError';this.code=code;}
}
function reject(code:string):never{throw new FirebaseRecoveryOperatorError(code);}
function requireValue(condition:boolean,code:string):asserts condition{if(!condition)reject(code);}
export interface FirebaseRecoveryOperatorOptions extends FirebaseBackupOptions {
  targetDatabase:Firestore;backupBucketName:string;journalBucket:Bucket;keyVersionRef:string;
  journal:Pick<FirebaseErasureJournal,'readObject'>;photos:FirebasePhotoRecovery;artifacts:FirebaseBackupArtifacts;
  sourceObjects?:Pick<FirebasePhotoObjects,'inspect'> & Partial<Pick<FirebasePhotoObjects,'read'|'write'|'recover'>>;
  managed?:ReturnType<typeof createFirebaseManagedBackup>;
  native:ReturnType<typeof createFirebaseNativeRecovery>;auth:Pick<Auth,'getUser'>;
}
/** The operator is never attached to the API or worker. Target IAM/rules and external queue pause are deployment gates. */
export function createFirebaseRecoveryOperator(options:FirebaseRecoveryOperatorOptions){
  const {database:source,targetDatabase:target,namespace,projectId,cipher}=options;
  // The factory constructs both SDK clients with this explicit project; SDK 9.3 exposes only databaseId publicly.
  requireValue(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)&&source.databaseId!==target.databaseId,'recovery_configuration');
  requireValue(new RegExp('^projects/'+projectId+'/secrets/[A-Za-z0-9_-]{1,255}/versions/[1-9][0-9]{0,19}$','u').test(options.keyVersionRef),'recovery_key_version');
  const codec=createFirestoreRestoreCodec(options),checkpointCollection=namespace+'_restore_operations';
  const checkpointRef=target.collection(checkpointCollection).doc('current');
  const staged=createFirebaseRestoreApply({database:target,cipher,projectId,namespace});
  const sessionPath=namespace+'_sessions/';
  const prefix=(backupId:string)=>{uuid.parse(backupId);return 'gs://'+options.backupBucketName+'/firebase-backups/v1/'+backupId+'/firestore';};
  const decode=(docs:FirebaseBackupDocument[])=>docs.filter(row=>!isRestoreProtocolOrUsage(namespace,row.path)).map(row=>codec.decode(row));
  async function readAll(database:Firestore,allowCheckpoint=false,unchangedSince?:string):Promise<FirebaseBackupDocument[]>{
    const allowed=new Set(FIREBASE_BACKUP_COLLECTION_SUFFIXES.map(suffix=>namespace+suffix));
    const collections=await database.listCollections();
    requireValue(collections.every(row=>allowed.has(row.id)||allowCheckpoint&&row.id===checkpointCollection),'recovery_collection');
    return database.runTransaction(async tx=>{
      const docs:FirebaseBackupDocument[]=[];let bytes=0;
      async function collect(collection:ReturnType<Firestore['collection']>,depth?:number):Promise<void>{
        let cursor:string|undefined;
        while(true){let query=collection.orderBy(FieldPath.documentId()).limit(100);if(cursor)query=query.startAfter(cursor);
          const page=await tx.get(query);
          for(const row of page.docs){
            if(unchangedSince)requireValue(row.updateTime!==undefined&&row.updateTime.toMillis()<=Date.parse(unchangedSince),'recovery_restored_snapshot_changed');
            const doc={path:row.ref.path,data:row.data()};docs.push(doc);bytes+=firebaseBackupDocumentDigest(doc).bytes;
            requireValue(docs.length<=2000&&bytes<=32*1024*1024,'recovery_limit');
            const child=depth===undefined?undefined:['users','sessions','events'][depth];
            if(child)await collect(row.ref.collection(child),depth!+1);}
          if(page.size<100)break;cursor=page.docs.at(-1)!.id;
        }
      }
      for(const collection of collections.filter(row=>row.id!==checkpointCollection).sort((a,b)=>a.id.localeCompare(b.id)))
        await collect(collection,collection.id===namespace+'_adk'?0:undefined);
      return docs;
    },{readOnly:true});
  }
  async function assertPaused(generation:string){
    uuid.parse(generation);const ref=source.collection(namespace).doc(workRecoveryDocumentId('control','current'));
    const snapshot=await ref.get();requireValue(snapshot.exists&&snapshot.updateTime!==undefined,'recovery_control');
    const record=codec.decode({path:ref.path,data:snapshot.data()}),control=authority.control.parse(record.value);
    requireValue(record.context.kind==='control'&&!control.enabled&&control.generation===generation,'recovery_source_not_paused');
    // This minimum pause is not proof of process shutdown. Deployment must stop source writers and journal IO.
    requireValue(snapshot.updateTime!.toMillis()<=Date.now()-360_000,'recovery_source_not_drained');
  }
  async function journalSnapshot(){
    const entries:{intent:FirebaseErasureIntent;descriptor:FirebaseErasureDescriptor}[]=[];let pageToken:string|undefined;
    const tokens=new Set<string>(),names=new Set<string>();
    for(let page=0;page<32;page++){
      const [body,response]=await options.journalBucket.request({method:'GET',uri:'/o',timeout:20_000,
        qs:{prefix:'erasures/v1/',maxResults:100,fields:'items(name,generation),nextPageToken',...(pageToken?{pageToken}:{})},headers:{'Cache-Control':'no-store'}});
      requireValue(response?.statusCode===200,'recovery_journal_unavailable');
      const result=z.object({items:z.array(z.object({name:z.string().regex(/^erasures\/v1\/[a-f0-9]{64}$/u),generation:z.string().regex(/^[1-9][0-9]{0,19}$/u)})).optional(),nextPageToken:z.string().optional()}).parse(body);
      for(const row of result.items??[]){requireValue(!names.has(row.name),'recovery_journal_duplicate');names.add(row.name);
        entries.push(await options.journal.readObject(row.name,row.generation));requireValue(entries.length<=2000,'recovery_limit');}
      if(!result.nextPageToken)return entries;
      requireValue(!tokens.has(result.nextPageToken),'recovery_journal_cursor');tokens.add(result.nextPageToken);pageToken=result.nextPageToken;
    }return reject('recovery_limit');
  }
  async function currentAuth(records:ReturnType<typeof decode>):Promise<FirebaseRestoreAuthUser[]>{
    const ids=[...new Set(records.filter(row=>row.context.kind==='account').map(row=>authority.account.parse(row.value).userId))];
    requireValue(ids.length<=100,'recovery_limit');const users:FirebaseRestoreAuthUser[]=[];
    for(const id of ids){try{const user=await options.auth.getUser(id);requireValue(user.uid===id,'recovery_auth_binding');
      users.push({userId:id,disabled:user.disabled,emailVerified:user.emailVerified,email:user.email??null});
    }catch(error){const code=error&&typeof error==='object'&&'code'in error?error.code:null;
      if(code==='auth/user-not-found'||code==='auth/user-disabled')users.push({userId:id,disabled:true,emailVerified:false,email:null});
      else reject('recovery_auth_unavailable');}}
    return users;
  }
  function evidence(live:FirebaseBackupDocument[],users:FirebaseRestoreAuthUser[],erasures:FirebaseErasureIntent[]){
    return {journalHash:digest(erasures.map(firebaseErasureIntentHash).sort()),
      authHash:digest([...users].sort((a,b)=>a.userId.localeCompare(b.userId))),
      authorityHash:digest(live.filter(row=>row.path.startsWith(namespace+'/')).map(row=>({path:row.path,...firebaseBackupDocumentDigest(row)})).sort((a,b)=>a.path.localeCompare(b.path)))};
  }
  function checkpointAad(){return canonical(['yuban-firebase-restore',1,projectId,target.databaseId,namespace,'current']);}
  const applyIdentity=(input:{backupId:string;restoreId:string;descriptor:Pick<FirebaseBackupManifestDescriptor,'cipherSha256'>})=>digest([input.backupId,input.restoreId,input.descriptor.cipherSha256]);
  async function resumeStaged(input:{backupId:string;restoreId:string;descriptor:Pick<FirebaseBackupManifestDescriptor,'cipherSha256'>;sourceGeneration:string}){
    const state=await staged.read(applyIdentity(input));if(!state)return false;
    const final=z.object({format:z.literal('yuban-firebase-restore'),version:z.literal(1),ciphertext:z.string()}).strict().parse(state.final);
    const plan=checkpointSchema.parse(JSON.parse(cipher.decrypt(final.ciphertext,checkpointAad())));
    requireValue(plan.sourceGeneration===input.sourceGeneration&&plan.restoreId===input.restoreId&&plan.backupId===input.backupId
      &&plan.manifestSha256===input.descriptor.cipherSha256,'recovery_checkpoint_conflict');
    await staged.resume(applyIdentity(input),()=>assertPaused(input.sourceGeneration),async()=>{
      const restored=await readAll(target,true);assertFirebaseBackupInventory(plan.inventory,restored);
      const records=decode(restored);assertFirebaseRestoreAuthority(records);assertFirestoreRestoreContent(records);
      const latest=evidence(await readAll(source),await currentAuth(records),(await journalSnapshot()).map(row=>row.intent));
      requireValue(latest.journalHash===plan.journalHash&&latest.authHash===plan.authHash&&latest.authorityHash===plan.authorityHash,'recovery_latest_state_changed');
    });return true;
  }
  async function applied(input:{backupId:string;restoreId:string;descriptor:Pick<FirebaseBackupManifestDescriptor,'cipherSha256'>}){
    const snapshot=await checkpointRef.get();if(!snapshot.exists)return null;
    const raw=z.object({format:z.literal('yuban-firebase-restore'),version:z.literal(1),ciphertext:z.string()}).strict().parse(snapshot.data());
    const result=checkpointSchema.parse(JSON.parse(cipher.decrypt(raw.ciphertext,checkpointAad())));
    requireValue(result.restoreId===input.restoreId&&result.backupId===input.backupId&&result.manifestSha256===input.descriptor.cipherSha256
      &&result.sourceDatabaseId===source.databaseId&&result.targetDatabaseId===target.databaseId,'recovery_checkpoint_conflict');
    assertFirebaseBackupInventory(result.inventory,await readAll(target,true));return result;
  }
  return {
    async startBackup(input:{backupId:string;snapshotTime:string;generation:string}){
      await assertPaused(input.generation);const snapshot=await inspectFirebaseBackupSnapshot(options,{snapshotTime:input.snapshotTime,generation:input.generation});
      const records=decode(snapshot.documents);assertFirebaseRestoreAuthority(records);assertFirestoreRestoreContent(records);
      return options.native.startExport({backupId:input.backupId,snapshotTime:input.snapshotTime});
    },
    async finishBackup(input:{backupId:string;snapshotTime:string;generation:string;operationName:string;sourceCommit:string;retainedUntil:string}){
      await assertPaused(input.generation);const snapshot=await inspectFirebaseBackupSnapshot(options,{snapshotTime:input.snapshotTime,generation:input.generation});
      const native=assertFirebaseNativeExport(snapshot.inventory,await options.native.getExport(input.operationName),prefix(input.backupId));
      const records=decode(snapshot.documents);assertFirebaseRestoreAuthority(records);assertFirestoreRestoreContent(records);
      const objects=await options.artifacts.holdNativeExport({backupId:input.backupId,outputUriPrefix:native.outputUriPrefix});
      const photos:FirebaseBackupPhotoManifestEntry[]=[];
      for(const record of records.filter(row=>row.context.kind==='photo')){
        const photo=photoSchemas.photo.parse(record.value);
        requireValue(photo.state!=='deleting'&&!(photo.state==='reserved'&&photo.upload),'recovery_unsettled_photo');
        if(photo.state!=='ready')continue;
        requireValue(photo.descriptor!==null,'recovery_photo_binding');
        const backup=await options.photos.backupPhoto({backupId:input.backupId,scope:photo.scope,photoId:photo.id,descriptor:photo.descriptor!,retainedUntil:input.retainedUntil});
        photos.push({path:record.path,photoId:photo.id,scope:photo.scope,descriptor:photo.descriptor!,backup});
      }
      await assertPaused(input.generation);await options.artifacts.assertNativeExportObjects({backupId:input.backupId,objects});
      const payload:FirebaseBackupManifestPayload={format:'yuban-firebase-backup-manifest/v1',backupId:input.backupId,databaseId:source.databaseId,
        snapshotTime:input.snapshotTime,controlGeneration:input.generation,sourceCommit:input.sourceCommit,keyVersionRef:options.keyVersionRef,
        retainedUntil:input.retainedUntil,nativeExport:{outputUriPrefix:native.outputUriPrefix,objects},inventory:snapshot.inventory,photos};
      const descriptor=await options.artifacts.writeManifest(payload);
      return {descriptor,documentCount:snapshot.inventory.documentCount,photoCount:photos.length,inventorySha256:snapshot.inventory.sha256};
    },
    async startRestoreImport(input:{backupId:string;descriptor:FirebaseBackupManifestDescriptor}){
      const manifest=await options.artifacts.readManifest({backupId:input.backupId,descriptor:input.descriptor});
      requireValue(manifest.databaseId===source.databaseId&&manifest.keyVersionRef===options.keyVersionRef,'recovery_source_binding');
      await options.artifacts.assertNativeExportObjects({backupId:input.backupId,objects:manifest.nativeExport.objects});
      const existing=await options.native.findImport({backupId:input.backupId,outputUriPrefix:manifest.nativeExport.outputUriPrefix});
      if(existing)return existing;
      requireValue((await target.listCollections()).length===0,'recovery_target_not_empty');
      return options.native.startImport({backupId:input.backupId,outputUriPrefix:manifest.nativeExport.outputUriPrefix});
    },
    async applyRestore(request:{backupId:string;restoreId:string;descriptor:FirebaseBackupManifestDescriptor;operationName:string;sourceGeneration:string}
      |{backupName:string;restoreId:string;operationName:string;sourceGeneration:string}){
      uuid.parse(request.restoreId);
      const managedRequest='backupName'in request?request:null;
      requireValue(!managedRequest||options.managed!==undefined,'recovery_managed_port_missing');
      const proof=managedRequest?await options.managed!.verify(managedRequest.backupName,managedRequest.operationName):null;
      if(proof)requireValue(proof.sourceDatabase===`projects/${projectId}/databases/${source.databaseId}`
        &&proof.targetDatabase===`projects/${projectId}/databases/${target.databaseId}`,'recovery_source_binding');
      // The checkpoint fingerprint binds native provenance, or the existing encrypted paired manifest.
      const input=proof?{...request,backupId:request.restoreId,descriptor:{cipherSha256:digest(proof)}}:
        request as {backupId:string;restoreId:string;descriptor:FirebaseBackupManifestDescriptor;operationName:string;sourceGeneration:string};
      await assertPaused(input.sourceGeneration);
      const manifest='descriptor'in request?await options.artifacts.readManifest({backupId:request.backupId,
        descriptor:firebaseBackupManifestDescriptorSchema.parse(request.descriptor)}):null;
      if(manifest)requireValue(manifest.databaseId===source.databaseId&&manifest.keyVersionRef===options.keyVersionRef,'recovery_source_binding');
      async function verifySnapshot(){
        if(proof&&managedRequest)requireValue(digest(await options.managed!.verify(managedRequest.backupName,managedRequest.operationName))===digest(proof),'recovery_native_provenance_changed');
        else if(manifest)await options.artifacts.assertNativeExportObjects({backupId:input.backupId,objects:manifest.nativeExport.objects});
        else reject('recovery_snapshot_missing');
      }
      await verifySnapshot();
      const prior=await applied(input);
      if(prior){
        const live=await readAll(source),users=await currentAuth(decode(await readAll(target,true))),entries=await journalSnapshot();
        const observed=evidence(live,users,entries.map(row=>row.intent));
        requireValue(prior.sourceGeneration===input.sourceGeneration&&observed.journalHash===prior.journalHash
          &&observed.authHash===prior.authHash&&observed.authorityHash===prior.authorityHash,'recovery_latest_state_changed');
        return {state:prior.state,replayed:true,documentCount:prior.inventory.documentCount,generation:prior.generation,inventorySha256:prior.inventory.sha256};
      }
      if(await resumeStaged(input)){
        const restored=await applied(input);requireValue(restored!==null,'recovery_apply_unknown');
        return {state:restored.state,replayed:true,documentCount:restored.inventory.documentCount,generation:restored.generation,inventorySha256:restored.inventory.sha256};
      }
      if(manifest){
        const operation=operationSchema.parse(await options.native.getImport(input.operationName));
        requireValue(operation.metadata.inputUriPrefix===manifest.nativeExport.outputUriPrefix
          &&BigInt(operation.metadata.progressDocuments.completedWork)===BigInt(manifest.inventory.documentCount),'recovery_import_mismatch');
      }
      const documents=await readAll(target,false,proof?.endTime);
      if(manifest)assertFirebaseBackupInventory(manifest.inventory,documents);
      else requireValue(proof!==null&&documents.length===proof.documentCount,'recovery_native_inventory_mismatch');
      const records=decode(documents);assertFirebaseRestoreAuthority(records);
      // A hot native snapshot can contain enabled control. Quarantine only this verified snapshot's
      // planner input; original ciphertext still anchors staged write preconditions. Live control must be paused.
      const plannerDocuments=proof?documents.map(row=>{
        const record=records.find(item=>item.path===row.path);if(record?.context.kind!=='control')return row;
        return codec.transform(record,{generation:authority.control.parse(record.value).generation,
          newEpochByWorkspace:new Map(),photoDescriptors:new Map()});
      }):documents;
      // The restore planner applies independently verified erasures before checking
      // surviving cross-document references. Never resurrect a deleted parent just
      // to satisfy an obsolete operation receipt in the imported snapshot.
      const liveDocuments=await readAll(source),authUsers=await currentAuth(records),entries=await journalSnapshot();
      const erasures=entries.map(row=>row.intent),erasureDescriptors=new Map(entries.map(row=>[firebaseErasureIntentHash(row.intent),row.descriptor]));
      // Journal replay does not trust a Firestore cleanup flag alone: check that all original objects are gone.
      for(const intent of erasures.filter(v=>['child-delete','account-delete'].includes(v.type))){
        const affected=new Map<string,{scope:typeof intent.scope;photoId:string}>();
        for(const row of [...records,...decode(liveDocuments)]){
          if(row.context.kind!=='photo'&&row.context.kind!=='photo-cleanup')continue;
          const value=row.context.kind==='photo'?photoSchemas.photo.parse(row.value):photoSchemas.cleanup.parse(row.value);
          if(value.scope.ownerUserId!==intent.scope.ownerUserId||intent.type==='child-delete'
            &&(value.scope.workspaceId!==intent.scope.workspaceId||value.scope.childId!==intent.scope.childId))continue;
          const photoId='id'in value?value.id:value.photoId;
          affected.set(digest([value.scope,photoId]),{scope:value.scope,photoId});
        }
        requireValue(affected.size===0||typeof options.sourceObjects?.inspect==='function','recovery_cleanup_verifier_missing');
        for(const item of affected.values())requireValue(await options.sourceObjects!.inspect!(item.scope,item.photoId)===null,'recovery_pending_scope_cleanup');
      }
      type PhotoEntry=Omit<FirebaseBackupPhotoManifestEntry,'backup'> & Partial<Pick<FirebaseBackupPhotoManifestEntry,'backup'>>;
      const deleted=(entry:PhotoEntry)=>erasures.some(row=>erasureCoversPhoto(row,entry.scope,entry.photoId));
      const photoRows=records.filter(row=>row.context.kind==='photo').map(row=>({record:row,photo:photoSchemas.photo.parse(row.value)}));
      const ready=photoRows.filter(row=>row.photo.state==='ready');
      const photoEntries:PhotoEntry[]=manifest?manifest.photos:ready.map(({record,photo})=>{
        requireValue(photo.descriptor!==null,'recovery_photo_binding');
        return {path:record.path,photoId:photo.id,scope:photo.scope,descriptor:photo.descriptor!};
      });
      requireValue(ready.length===photoEntries.length,'recovery_photo_manifest');
      const pending:PhotoEntry[]=[];
      const expectedDescriptors=new Map<string,FirebasePhotoObjectDescriptor>();
      for(const entry of photoEntries){
        const row=ready.find(row=>row.record.path===entry.path&&row.photo.id===entry.photoId);
        requireValue(Boolean(row&&canonical(row.photo.scope)===canonical(entry.scope)&&canonical(row.photo.descriptor)===canonical(entry.descriptor)),'recovery_photo_manifest');
        if(deleted(entry))continue;
        const scope={...entry.scope,storageEpoch:firebaseRestoreEpoch(projectId,target.databaseId,input.restoreId,entry.scope.workspaceId)};
        const scopeHash=createHash('sha256').update(JSON.stringify(['yuban-photo-object',1,projectId,namespace,scope])).digest('hex');
        // Validate the complete transform before IO. These planned names are never persisted as actual object evidence.
        expectedDescriptors.set(entry.photoId,{...entry.descriptor,objectName:'photos/v1/'+scopeHash+'/'+entry.photoId});pending.push(entry);
      }
      const base={restoreId:input.restoreId,targetDatabaseId:target.databaseId,sourceGeneration:input.sourceGeneration,
        documents:plannerDocuments,liveDocuments,authUsers,erasures,erasureDescriptors};
      prepareFirebaseRestore(options,{...base,photoDescriptors:expectedDescriptors});
      const photoDescriptors=new Map<string,FirebasePhotoObjectDescriptor>();
      for(const entry of pending){const targetScope={...entry.scope,storageEpoch:firebaseRestoreEpoch(projectId,target.databaseId,input.restoreId,entry.scope.workspaceId)};
        if(entry.backup)photoDescriptors.set(entry.photoId,await options.photos.restorePhoto({backupId:input.backupId,backup:entry.backup,targetScope}));
        else{
          const objects=options.sourceObjects;
          requireValue(Boolean(objects?.read&&objects.write),'recovery_photo_port_missing');
          // Immutable retained objects are pinned by generation/hash; a missing object stops recovery.
          // Independent erasures are applied above, before any original object is read or copied.
          const content=await objects!.read!(entry.scope,entry.photoId,entry.descriptor);
          photoDescriptors.set(entry.photoId,await objects!.write!(targetScope,entry.photoId,{base64:content.base64,mimeType:content.mimeType}));
        }
      }
      const plan=prepareFirebaseRestore(options,{...base,photoDescriptors});
      await assertPaused(input.sourceGeneration);
      const latestLive=await readAll(source),latestUsers=await currentAuth(records),latestEntries=await journalSnapshot();
      const observed=evidence(latestLive,latestUsers,latestEntries.map(row=>row.intent));
      requireValue(observed.journalHash===plan.journalHash&&observed.authHash===plan.authHash&&observed.authorityHash===plan.authorityHash,'recovery_latest_state_changed');
      await verifySnapshot();
      const rows=plan.records.map(row=>({path:row.path,...firebaseBackupDocumentDigest(row)})).sort((a,b)=>a.path.localeCompare(b.path));
      const hashes=rows.map(({path,sha256})=>({path,sha256}));
      const inventory:FirebaseBackupInventory={schema:'yuban-firestore-backup-inventory/v1',projectId,databaseId:target.databaseId,namespace,
        snapshotTime:manifest?.snapshotTime??proof!.snapshotTime,documents:hashes,documentCount:hashes.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),sha256:digest(hashes)};
      const checkpoint=checkpointSchema.parse({format:'yuban-firebase-restore/v1',state:'applied-paused',restoreId:input.restoreId,backupId:input.backupId,
        manifestSha256:input.descriptor.cipherSha256,sourceDatabaseId:source.databaseId,targetDatabaseId:target.databaseId,
        sourceGeneration:input.sourceGeneration,generation:plan.generation,journalHash:plan.journalHash,authHash:plan.authHash,authorityHash:plan.authorityHash,inventory});
      const ciphertext=cipher.encrypt(canonical(checkpoint),checkpointAad());
      await staged.stage(applyIdentity(input),documents,plan.records,plan.removePaths,{format:'yuban-firebase-restore',version:1,ciphertext});
      await resumeStaged(input);
      const result=await applied(input);requireValue(result!==null,'recovery_apply_unknown');
      await assertPaused(input.sourceGeneration);
      const after=evidence(await readAll(source),await currentAuth(records),(await journalSnapshot()).map(row=>row.intent));
      requireValue(after.journalHash===result.journalHash&&after.authHash===result.authHash&&after.authorityHash===result.authorityHash,'recovery_latest_state_changed');
      return {state:result.state,replayed:false,documentCount:result.inventory.documentCount,generation:result.generation,inventorySha256:result.inventory.sha256};
    },
  };
}
