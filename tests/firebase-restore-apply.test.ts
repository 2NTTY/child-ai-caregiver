import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from '@google-cloud/firestore';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirebaseRestoreApply } from '../server/firebase-restore-apply.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('restore resumes the original bounded plan after a lost acknowledgement and interrupted page', async () => {
  const fake=firestoreDomainFixture(), namespace='synthetic_apply';
  const ref=(path:string):any=>({path,async get(){return {exists:fake.records.has(path),data:()=>structuredClone(fake.records.get(path))};},
    async set(value:unknown){fake.records.set(path,structuredClone(value));}});
  const database={databaseId:'synthetic-restore',doc:ref,collection:(name:string)=>({doc:(id:string)=>ref(name+'/'+id)}),
    runTransaction:fake.database.runTransaction.bind(fake.database)} as unknown as Firestore;
  const options={database,cipher:createStorageCipher(Buffer.alloc(32,61)),projectId:'synthetic-restore',namespace};
  const original=Array.from({length:81},(_,i)=>({path:namespace+'/row-'+i,data:{version:1}}));
  for(const row of original)fake.records.set(row.path,row.data);
  const records=original.map(row=>({...row,data:{version:2}})), identity='3'.repeat(64), final={paused:true};
  const apply=createFirebaseRestoreApply(options);await apply.stage(identity,original,records,[],final);
  fake.loseReply();let pages=0;
  await assert.rejects(()=>apply.resume(identity,async()=>{if(++pages===2)throw new Error('operator interrupted');},async()=>{}),/operator interrupted/);
  assert.equal((await apply.read(identity))?.nextPage,1);
  assert.equal(fake.records.get(original[80].path).version,1);
  let validated=false;
  await createFirebaseRestoreApply(options).resume(identity,async()=>{},async()=>{
    for(const row of records)assert.deepEqual(fake.records.get(row.path),row.data);validated=true;
  });
  assert.equal(validated,true);assert.deepEqual(fake.records.get(namespace+'_restore_operations/current'),final);
  assert.equal(await apply.read(identity),null);
  assert.deepEqual([...fake.records.keys()].filter(path=>path.startsWith(namespace+'_restore_operations/')),
    [namespace+'_restore_operations/current']);
});
