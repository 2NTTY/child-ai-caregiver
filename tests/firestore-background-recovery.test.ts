import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Firestore} from '@google-cloud/firestore';
import {FirestoreDomainData} from '../server/firestore-domain-data.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {createFirestoreBackgroundQueue,prepareFirestoreBackgroundWork,preparePhotoCleanupWake,type FirestoreBackgroundDelivery} from '../server/firestore-background-work.ts';
import {firestoreDomainFixture} from './helpers/firestore-domain-memory.ts';

test('original unknown Task is probed, and new cleanup evidence wakes only the same exhausted work',async t=>{
  const fake=firestoreDomainFixture(); let clock=Date.now(); t.mock.method(Date,'now',()=>clock);
  function query(raw:any):any { return new Proxy(raw,{get(target,key){if(key==='get')return ()=>fake.database.runTransaction(tx=>tx.get(target));
    const value=target[key]; return typeof value==='function' ? (...args:any[])=>{const result=value(...args);return result?.query?query(result):result?.path?{...result,id:result.path.split('/').at(-1)}:result;} : value;}}); }
  const database={...fake.database,collection:(path:string)=>query(fake.database.collection(path))} as Firestore;
  const options={database,projectId:'synthetic-background',namespace:'unit_background',cipher:createStorageCipher(Buffer.alloc(32,81))};
  const data=new FirestoreDomainData(options), generation=randomUUID(), nil='00000000-0000-0000-0000-000000000000';
  const identity={kind:'photo-cleanup' as const,scope:{ownerUserId:'system:background',workspaceId:nil,childId:nil,storageEpoch:nil},
    resourceId:randomUUID(),basis:'original-cleanup',generation,authorizationVersion:'0'};
  const work=await database.runTransaction(async tx=>{const v=await prepareFirestoreBackgroundWork(data,tx,identity,new Date(clock-1000).toISOString());v.commit();return v;});
  let creates=0,probes=0,effects=0; const deliveries:FirestoreBackgroundDelivery[]=[];
  const queue=createFirestoreBackgroundQueue({...options,enabled:true,readControl:async()=>({enabled:true,generation}),
    transport:{enqueue:async job=>{creates++;deliveries.push(job);return {state:creates===1?'unknown':'confirmed'};},
      probe:async job=>{probes++;assert.deepEqual(job,deliveries[0]);return {state:'confirmed'};}},
    execute:async()=>({state:++effects===1?'unknown':'completed'})});
  await queue.dispatch();assert.equal(creates,1);assert.equal(probes,0);
  clock+=61000;await queue.dispatch();assert.equal(creates,1);assert.equal(probes,1);
  assert.equal((await queue.process(deliveries[0])).state,'unknown');
  await database.runTransaction(async tx=>(await preparePhotoCleanupWake(data,tx,identity,'verified-object-generation'))());
  await queue.dispatch();assert.equal(creates,2);assert.equal(deliveries[1].id,work.id);
  assert.equal(deliveries[1].dispatchRevision,deliveries[0].dispatchRevision+1);
  assert.equal((await queue.process(deliveries[1])).state,'completed');
  assert.equal((await queue.process(deliveries[1])).state,'completed');assert.equal(effects,2);
  await database.runTransaction(async tx=>(await preparePhotoCleanupWake(data,tx,identity,'verified-object-generation'))());
  await queue.dispatch();assert.equal(creates,2);
});
