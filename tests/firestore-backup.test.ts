import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FieldValue } from '@google-cloud/firestore';
import { canonical } from '../server/firestore-session-codec.ts';
import { firebaseBackupDocumentDigest, assertFirebaseBackupInventory, assertFirebaseNativeExport, type FirebaseBackupInventory } from '../server/firestore-backup.ts';

test('native backup inventory preserves vectors and rejects changed, missing or extra documents', () => {
  const documents = [{ path: 'synthetic/source', data: { vector: FieldValue.vector([1, 2, 3]), text: '合成公共來源' } },
    { path: 'synthetic/private', data: { format: 'synthetic', ciphertext: 'synthetic-encrypted-value' } }];
  const rows = documents.map(row => ({ path: row.path, ...firebaseBackupDocumentDigest(row) })).sort((a,b) => a.path.localeCompare(b.path));
  const entries = rows.map(({path,sha256})=>({path,sha256}));
  const manifest: FirebaseBackupInventory = { schema:'yuban-firestore-backup-inventory/v1',projectId:'synthetic-project',databaseId:'synthetic-db',
    namespace:'synthetic', snapshotTime:'2026-10-11T12:00:00.000Z', documents:entries,documentCount:2,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),
    sha256:createHash('sha256').update(canonical(entries)).digest('hex') };
  assert.doesNotThrow(()=>assertFirebaseBackupInventory(manifest, [...documents].reverse()));
  assert.throws(()=>assertFirebaseBackupInventory(manifest, documents.slice(0,1)), {code:'inventory_invalid'});
  assert.throws(()=>assertFirebaseBackupInventory(manifest, [...documents,{path:'synthetic/extra',data:{x:true}}]), {code:'inventory_invalid'});
  assert.throws(()=>assertFirebaseBackupInventory(manifest, [{...documents[0]!,data:{...documents[0]!.data,vector:FieldValue.vector([1,2,4])}},documents[1]!]), {code:'inventory_mismatch'});
  assert.throws(()=>assertFirebaseBackupInventory(manifest, [{...documents[0]!,data:{...documents[0]!.data,vector:{type:'firestore-vector',value:[1,2,3]}}},documents[1]!]), {code:'inventory_mismatch'});
  const native={done:true,metadata:{operationState:'SUCCESSFUL',snapshotTime:manifest.snapshotTime,progressDocuments:{workCompleted:'2'}},
    response:{outputUriPrefix:'gs://synthetic-backup/run/firestore'}};
  assert.deepEqual(assertFirebaseNativeExport(manifest,native,'gs://synthetic-backup/run/firestore'),{outputUriPrefix:native.response.outputUriPrefix,documentCount:2,snapshotTime:manifest.snapshotTime});
  assert.throws(()=>assertFirebaseNativeExport(manifest,{...native,metadata:{...native.metadata,progressDocuments:{workCompleted:'3'}}},'gs://synthetic-backup/run/firestore'),{code:'native_export_mismatch'});
  assert.throws(()=>assertFirebaseNativeExport(manifest,{...native,done:false},'gs://synthetic-backup/run/firestore'),{code:'native_export_invalid'});
});
