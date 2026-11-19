import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import { createFirestoreKnowledgeOriginals, knowledgeOriginalName, knowledgeOriginalManifest } from '../server/firestore-knowledge-originals.ts';
import { createKnowledgeOriginalRecovery } from '../server/firebase-knowledge-original-recovery.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS } from '../server/firebase-photo-recovery.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const projectId='test-originals',namespace='test_knowledge',sourceId='fhs-feeding-booklet-en';
const file=Buffer.from('%PDF-1.7 fixture bytes'), contentHash=hash(file);
function fixture() {
  const fake=firestoreDomainFixture();
  const database={runTransaction:fake.database.runTransaction.bind(fake.database),collection:(name:string)=>({
    doc(id:string) {
      const ref=fake.database.collection(name).doc(id);
      return {...ref,get:()=>fake.database.runTransaction(tx=>tx.get(ref)),set:(value:unknown)=>
        fake.database.runTransaction(async tx=>{tx.set(ref,value as Record<string,unknown>);})};
    },
  })} as unknown as Firestore;
  const primary=avatarMemoryBucket('source-private'),copy=avatarMemoryBucket('source-backup');
  const originalBucket={bucketName:'source-private',bucket:primary.port};
  const store=createFirestoreKnowledgeOriginals({database,projectId,namespace,originalBucket});
  const recovery=createKnowledgeOriginalRecovery(originalBucket,{bucketName:'source-backup',bucket:copy.port});
  const reference=database.collection(namespace+'_knowledge_original_manifests').doc(sourceId+'-'+contentHash);
  return {database,primary,copy,store,recovery,reference};
}
test('original edition lookup distinguishes absent descriptor, missing generation and damaged bytes',async()=>{
  const {primary,store,reference}=fixture();
  assert.equal(await store.findPdf(sourceId,contentHash),null);
  primary.lose();
  assert.equal(await store.save(sourceId,'application/pdf',file),contentHash);
  assert.deepEqual(await store.findPdf(sourceId,contentHash),file);
  await store.save(sourceId,'application/pdf',file);assert.equal(primary.writes(),1);
  const m=knowledgeOriginalManifest.parse((await reference.get()).data()),name=knowledgeOriginalName(m);
  const object=primary.records.get(name)!; object.bytes=Buffer.alloc(file.length);
  await assert.rejects(store.findPdf(sourceId,contentHash));
  object.bytes=file;object.metadata.generation='9876';
  await assert.rejects(store.findPdf(sourceId,contentHash));
  primary.records.delete(name);await assert.rejects(store.findPdf(sourceId,contentHash));
  await reference.set({...m,sourceId:'different'});await assert.rejects(store.findPdf(sourceId,contentHash),/binding/);
});
test('backup pins and holds original bytes and recreates them for an isolated database restore',async()=>{
  const {primary,copy,store,recovery,reference}=fixture();
  const id='c17be145-7caa-42c0-b09f-8d2371ca6a7b',until=new Date(Date.now()+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS+60000).toISOString();
  await store.save(sourceId,'application/pdf',file);
  const m=knowledgeOriginalManifest.parse((await reference.get()).data());
  const entry=await recovery.capture(id,until,reference.path,m);
  assert.equal(copy.records.size,1);assert.deepEqual(await recovery.recover(m,{id,until,entry}),m);
  primary.records.delete(knowledgeOriginalName(m));
  await assert.rejects(recovery.recover(m));
  const rebuilt=await recovery.recover(m,{id,until,entry});
  assert.notEqual(rebuilt.generation,m.generation);
  await reference.set(rebuilt);assert.deepEqual(await store.findPdf(sourceId,contentHash),file);
  await assert.rejects(recovery.recover(m,{id,until,entry:{...entry,original:{...m,sourceId:'other'}}}));
  copy.records.values().next().value!.bytes=Buffer.alloc(file.length);
  await assert.rejects(recovery.recover(m,{id,until,entry}));
});
