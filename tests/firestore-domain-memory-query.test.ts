import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldPath } from '@google-cloud/firestore';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('synthetic document-id bounds and cursor compare actual IDs without adding fields to stored envelopes', async () => {
  const f = firestoreDomainFixture(), rows = f.database.collection('synthetic');
  await f.database.runTransaction(async tx => { for (const id of ['b', 'a', 'c']) tx.set(rows.doc(id), { value: 1 }); });
  const page = await f.database.runTransaction(tx => tx.get(rows.where('__name__', '<=', 'b').orderBy('__name__', 'asc').startAfter('a')));
  assert.deepEqual(page.docs.map(row => row.id), ['b']);
  assert.ok([...f.records.values()].every(value => Object.keys(value).join() === 'value'));
});

test('synthetic native FieldPath document-id ordering preserves same-sort-key pagination', async () => {
  const f = firestoreDomainFixture(), rows = f.database.collection('synthetic');
  await f.database.runTransaction(async tx => { for (const id of ['a', 'c', 'b']) tx.set(rows.doc(id), { sortKey: 'same' }); });
  const page = await f.database.runTransaction(tx => tx.get(rows.orderBy('sortKey', 'desc').orderBy(FieldPath.documentId(), 'desc').startAfter('same', 'c')));
  assert.deepEqual(page.docs.map(row => row.id), ['b', 'a']);
});
