import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Evaluate only the actual pure comparator declarations, never the operator entry or GoogleAuth.
const source = readFileSync(new URL('../scripts/firestore-indexes.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const canonical =');
const end = source.indexOf('const sessionIndexes =');
assert.ok(start >= 0 && end > start);
const shape = runInNewContext(source.slice(start, end) + '\nshape;');
const field = (fieldPath: string, order = 'ASCENDING') => ({ fieldPath, order });
const index = (fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>) => ({ queryScope: 'COLLECTION', fields });

test('mixed chat excludes private fields and lists rooms through the owner tag without composites', () => {
  const config = JSON.parse(readFileSync(new URL('../deploy/firebase/firestore.indexes.json', import.meta.url), 'utf8'));
  for (const collectionGroup of ['yuban_authority_mixed_rooms', 'yuban_authority_mixed_messages']) {
    for (const fieldPath of ['*', 'ciphertext', 'recovery']) assert.deepEqual(config.fieldOverrides.filter((entry: any) =>
      entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath), [{ collectionGroup, fieldPath, indexes: [] }]);
    assert.equal(config.indexes.some((entry: any) => entry.collectionGroup === collectionGroup), false);
  }
  assert.deepEqual(config.fieldOverrides.find((entry: any) => entry.collectionGroup === 'yuban_authority_mixed_rooms' && entry.fieldPath === 'userTag').indexes,
    [{ order: 'ASCENDING', queryScope: 'COLLECTION' }]);
});

test('growth report duplicate queries have the complete scoped ordered index', () => {
  const config = JSON.parse(readFileSync(new URL('../deploy/firebase/firestore.indexes.json', import.meta.url), 'utf8'));
  const fields = ['workspaceTag', 'epochTag', 'userTag', 'childTag', 'status', 'kind'].map(name => field(name));
  fields.push(field('createdAt', 'DESCENDING'), field('documentId', 'DESCENDING'));
  assert.ok(config.indexes.some((entry: { collectionGroup: string }) => entry.collectionGroup === 'yuban_authority_documents'
    && shape(entry) === shape(index(fields))), 'Growth report duplicate scan needs a deployable composite index');
});

test('explicit document-id direction distinguishes bounded ascending pages from descending heads', () => {
  for (const scope of [['workspaceTag', 'epochTag', 'userTag', 'childTag'], ['workspaceTag', 'userTag', 'childTag']]) {
    const fields = scope.map(name => field(name));
    assert.notEqual(shape(index([...fields, field('__name__', 'ASCENDING')])),
      shape(index([...fields, field('__name__', 'DESCENDING')])));
  }
});

test('implicit document-id order matches the server-appended last directional field', () => {
  for (const direction of ['ASCENDING', 'DESCENDING']) {
    const fields = [field('workspaceTag'), field('lastMessageSortKey', direction)];
    assert.equal(shape(index(fields)), shape(index([...fields, field('__name__', direction)])));
    assert.notEqual(shape(index(fields)), shape(index([...fields,
      field('__name__', direction === 'ASCENDING' ? 'DESCENDING' : 'ASCENDING')])));
  }
});

test('a non-directional final field defaults to ascending document-id ordering', () => {
  const fields = [field('workspaceTag', 'DESCENDING'), { fieldPath: 'members', arrayConfig: 'CONTAINS' }];
  assert.equal(shape(index(fields)), shape(index([...fields, field('__name__')])));
  assert.notEqual(shape(index(fields)), shape(index([...fields, field('__name__', 'DESCENDING')])));
});

test('comparator preserves query scope and field order while ignoring unrelated server metadata', () => {
  const value = index([field('workspaceTag'), field('childTag')]);
  assert.equal(shape(value), shape({ ...value, name: 'synthetic/index', state: 'READY' }));
  assert.notEqual(shape(value), shape({ ...value, queryScope: 'COLLECTION_GROUP' }));
  assert.notEqual(shape(value), shape(index([...value.fields].reverse())));
});
