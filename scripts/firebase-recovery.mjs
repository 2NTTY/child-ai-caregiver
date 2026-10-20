import { createCloudStorageChatFileObjects, CHAT_FILE_OBJECT_MAX_BYTES } from '../server/firebase-chat-file-objects.ts';
import { createFirebaseChatFileRecovery } from '../server/firebase-chat-file-recovery.ts';
import { createCloudStorageVoiceObjects, VOICE_OBJECT_MAX_BYTES } from '../server/firebase-voice-objects.ts';
import { createFirebaseVoiceRecovery } from '../server/firebase-voice-recovery.ts';
import { createFirebasePhotoBucketPort } from '../server/firebase-photo-objects.ts';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { createCloudStoragePhotoObjects } from '../server/firebase-photo-objects.ts';
import { createCloudStorageErasureJournal } from '../server/firebase-erasure-journal.ts';
import { createFirebasePhotoRecovery, createFirebasePhotoBackupBucketPort } from '../server/firebase-photo-recovery.ts';
import { createFirebaseBackupArtifacts, createFirebaseBackupArtifactBucketPort } from '../server/firebase-backup-artifacts.ts';
import { createFirebaseNativeRecovery } from '../server/firebase-native-recovery.ts';
import { createFirebaseManagedBackup } from '../server/firebase-managed-backup.ts';
import { createFirebaseManagedPhotoReader, createFirebaseManagedVoiceReader, createFirebaseManagedChatFileReader } from '../server/firebase-managed-photo-recovery.ts';
import { createFirebaseRecoveryOperator } from '../server/firebase-recovery-operator.ts';

// Explicit operator command only; never loaded by the API, scheduler or worker.
let persistence,target,app;
try {
  const command=process.argv[2];
  if(!['pause','start-export','find-export','finish-backup','start-import','find-import','apply-restore',
    'start-managed-restore','get-managed-restore','apply-managed-restore'].includes(command))throw new Error('command');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16384)throw new Error('input');chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  persistence=await openFirebasePersistence(process.env);
  const {config,cipher,database}=persistence,domain={database,cipher,projectId:config.projectId,namespace:config.namespace};
  let result;
  if(command==='pause'){
    if(input.enabled!==false)throw new Error('pause_only');
    result=await setFirebaseBackupControl(domain,input);
  }else{
    const targetDatabaseId=process.env.FIREBASE_RESTORE_DATABASE_ID;
    if(!targetDatabaseId||!/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u.test(targetDatabaseId)||targetDatabaseId===config.databaseId)throw new Error('target');
    target=new Firestore({projectId:config.projectId,databaseId:targetDatabaseId});
    const storage=new Storage({projectId:config.projectId,retryOptions:{autoRetry:false},timeout:20000});
    const journalBucket=storage.bucket(config.erasureBucket),artifactConfig={projectId:config.projectId,namespace:config.namespace,bucketName:config.erasureBucket};
    const artifacts=createFirebaseBackupArtifacts({config:artifactConfig,cipher,bucket:createFirebaseBackupArtifactBucketPort(journalBucket)});
    const objects=createCloudStoragePhotoObjects({config:{projectId:config.projectId,namespace:config.namespace,bucketName:config.photoBucket},cipher});
    const photos=createFirebasePhotoRecovery({config:{projectId:config.projectId,namespace:config.namespace,backupBucketName:config.erasureBucket},cipher,
      backupBucket:createFirebasePhotoBackupBucketPort(journalBucket),sourceObjects:objects,targetObjects:objects});
    const voiceObjects=createCloudStorageVoiceObjects({config:{projectId:config.projectId,namespace:config.namespace,bucketName:config.photoBucket},cipher});
    const voices={bucketName:config.photoBucket,objects:voiceObjects,recovery:createFirebaseVoiceRecovery({
      config:{projectId:config.projectId,namespace:config.namespace,backupBucketName:config.erasureBucket},cipher,
      backupBucket:createFirebasePhotoBucketPort(journalBucket,VOICE_OBJECT_MAX_BYTES),objects:voiceObjects})};
    const chatFileObjects=createCloudStorageChatFileObjects({config:{projectId:config.projectId,namespace:config.namespace,bucketName:config.photoBucket},cipher});
    const chatFiles={bucketName:config.photoBucket,objects:chatFileObjects,recovery:createFirebaseChatFileRecovery({
      config:{projectId:config.projectId,namespace:config.namespace,backupBucketName:config.erasureBucket},cipher,
      backupBucket:createFirebasePhotoBucketPort(journalBucket,CHAT_FILE_OBJECT_MAX_BYTES),objects:chatFileObjects})};
    const journal=createCloudStorageErasureJournal({config:artifactConfig,cipher});
    const native=createFirebaseNativeRecovery({projectId:config.projectId,sourceDatabaseId:config.databaseId,targetDatabaseId,backupBucketName:config.erasureBucket});
    const managed=command.includes('managed')?createFirebaseManagedBackup({projectId:config.projectId,
      sourceDatabaseId:config.databaseId,targetDatabaseId,location:process.env.FIREBASE_LOCATION??'asia-east2'}):undefined;
    app=initializeApp({projectId:config.projectId,credential:applicationDefault()},'recovery-'+randomUUID());
    const sourceObjects=command==='apply-managed-restore'?{...objects,read:createFirebaseManagedPhotoReader({
      bucket:storage.bucket(config.photoBucket),journalBucket,journal,objects,authority:persistence.authority,sourceGeneration:input.sourceGeneration})}:objects;
    if(command==='apply-managed-restore') voices.objects={...voiceObjects,read:createFirebaseManagedVoiceReader({
      bucket:storage.bucket(config.photoBucket),journalBucket,journal,objects:voiceObjects,authority:persistence.authority,sourceGeneration:input.sourceGeneration})};
    if(command==='apply-managed-restore') chatFiles.objects={...chatFileObjects,read:createFirebaseManagedChatFileReader({
      bucket:storage.bucket(config.photoBucket),journalBucket,journal,objects:chatFileObjects,authority:persistence.authority,sourceGeneration:input.sourceGeneration})};
    const operator=createFirebaseRecoveryOperator({...domain,targetDatabase:target,backupBucketName:config.erasureBucket,journalBucket,journal,photos,voices,chatFiles,sourceObjects,artifacts,native,managed,auth:getAuth(app),keyVersionRef:process.env.FIREBASE_STORAGE_KEY_VERSION_REF});
    if(command==='start-managed-restore')result=await managed.start(input.backupName);
    else if(command==='get-managed-restore')result=await managed.inspect(input.backupName,input.operationName);
    else if(command==='apply-managed-restore'){
      if(!input.backupName||input.descriptor||input.backupId)throw new Error('managed_input');
      result=await operator.applyRestore(input);
    }
    else if(command==='start-export')result=await operator.startBackup(input);
    else if(command==='find-export')result=await native.findExport(input);
    else if(command==='finish-backup')result=await operator.finishBackup(input);
    else if(command==='start-import')result=await operator.startRestoreImport(input);
    else if(command==='find-import')result=await native.findImport(input);
    else result=await operator.applyRestore(input);
  }
  // Native operation metadata/error bodies and private rows never enter command output.
  console.info(JSON.stringify(result&&typeof result==='object'&&'name'in result?{command,name:result.name,done:result.done===true}:
    {command,confirmed:true,result}));
}catch(error){
  const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/u.test(error.code)?error.code:'firebase_recovery_unconfirmed';
  console.error(JSON.stringify({confirmed:false,code}));process.exitCode=1;
}finally{
  await target?.terminate().catch(()=>{process.exitCode=1;});
  if(app)await deleteApp(app).catch(()=>{process.exitCode=1;});
  await persistence?.close().catch(()=>{process.exitCode=1;});
}
