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
import { createFirebaseRecoveryOperator } from '../server/firebase-recovery-operator.ts';

// Explicit operator command only; never loaded by the API, scheduler or worker.
let persistence,target,app;
try {
  const command=process.argv[2];
  if(!['pause','start-export','find-export','finish-backup','start-import','find-import','apply-restore'].includes(command))throw new Error('command');
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
    const journal=createCloudStorageErasureJournal({config:artifactConfig,cipher});
    const native=createFirebaseNativeRecovery({projectId:config.projectId,sourceDatabaseId:config.databaseId,targetDatabaseId,backupBucketName:config.erasureBucket});
    app=initializeApp({projectId:config.projectId,credential:applicationDefault()},'recovery-'+randomUUID());
    const operator=createFirebaseRecoveryOperator({...domain,targetDatabase:target,backupBucketName:config.erasureBucket,journalBucket,journal,photos,sourceObjects:objects,artifacts,native,auth:getAuth(app),keyVersionRef:process.env.FIREBASE_STORAGE_KEY_VERSION_REF});
    if(command==='start-export')result=await operator.startBackup(input);
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
