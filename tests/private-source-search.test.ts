import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction } from '../server/firestore-authority.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, privateIndexId, privateIndexMetadata, privateIndexRecord } from '../server/private-source-index-record.ts';
import { createPrivateSourceSearch, PRIVATE_QUERY_COLLECTION, PRIVATE_QUERY_FAMILY, privateQueryId, privateQueryRecord } from '../server/private-source-search.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const vector = (first = 1, second = 0) => [first, second, ...Array<number>(KNOWLEDGE_EMBEDDING.dimensions - 2).fill(0)];
function fixture(count = 1) {
  const fake = firestoreDomainFixture(), cardId = randomUUID(), grant = firestoreDomainHash('grant');
  const receipt = (model:string) => ({rootRunId:randomUUID(),model,billingSource:'platform' as const,settingsVersion:'1:policy:1'});
  const scope = { ownerUserId: 'alice', workspaceId: randomUUID(), childId: '00000000-0000-0000-0000-000000000000', storageEpoch: randomUUID() };
  const data = new FirestoreDomainData({ database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 45)), projectId: 'private-search-test', namespace: 'private_search_test' });
  const state = { generation: randomUUID(), authorizationVersion: '1', grant, accessRevision: 1, enabled: true, auth: true,
    calls: 0, sessions: 0, closes: 0, failure: false, loseSave: false,
    afterEmbed: undefined as (() => void) | undefined };
  const heads = new Map<string, { cardId: string; documentId: string; version: string; title: string; url: string; grant: string; rag: { incarnation: string; accessRevision: number } }>();
  const units = Array.from({ length: count }, (_, index) => {
    const row = privateIndexRecord.parse({ kind: 'unit', cardId, grant, documentId: firestoreDomainHash(['doc', index]),
      version: firestoreDomainHash(['version', index]), incarnation: randomUUID(), accessRevision: 1,
      generation: state.generation, authorizationVersion: '1', ordinal: index + 1, page: index % 2 ? null : index + 1, offset: index * 500,
      facts: [{ type: 'quotation', text: `Original wording ${index}` }, { type: 'visual_description', text: `Reviewed diagram ${index}` }],
      proof: { organize: receipt('fixture'), review: receipt('fixture'), embed: receipt(KNOWLEDGE_EMBEDDING.model) },
      vector: vector(1, index / Math.max(1, count)), embeddingModel: KNOWLEDGE_EMBEDDING.model });
    if (row.kind !== 'unit') throw new Error('Invalid fixture');
    const id = privateIndexId(scope, row), ref = data.ref(PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, id);
    fake.records.set(ref.path, { ...data.tags(scope), ...privateIndexMetadata(scope, row), ...data.seal(PRIVATE_INDEX_FAMILY, id, scope, privateIndexRecord, row) });
    heads.set(row.documentId, { cardId, documentId: row.documentId, version: row.version, title: `Synthetic source ${index}`,
      url: `https://private.example.test/${index}`, grant, rag: { incarnation: row.incarnation, accessRevision: 1 } });
    return { row, physicalId: ref.id };
  });
  const documents = {
    async withIndexCard<T>(owner: string, id: string, fn: (b: FirestoreAuthorityTransaction, grant: string, revision: number) => Promise<T>) {
      if (!state.enabled || id !== cardId || owner !== scope.ownerUserId) throw Object.assign(new Error('Source unavailable'), { code: 'source_document_unavailable' });
      return fake.database.runTransaction(async transaction => {
        const tx = { get: transaction.get.bind(transaction), getAll: transaction.getAll.bind(transaction),
          set(ref: any, value: any) {
            transaction.set(ref, value);
            if (state.loseSave && ref.path.includes('_source_card_documents/')) {
              const snap = { exists: true, data: () => value } as any;
              const receiptId = privateQueryId(scope, { kind: 'receipt', cardId, operationId: activeOperation });
              if (ref.path === data.ref(PRIVATE_QUERY_COLLECTION, PRIVATE_QUERY_FAMILY, receiptId).path) {
                const row = data.open(PRIVATE_QUERY_FAMILY, receiptId, scope, privateQueryRecord, snap);
                if (row.kind === 'receipt' && row.state === 'ready') { state.loseSave = false; fake.loseReply(); }
              }
            }
          } };
        return fn({ transaction: tx, scope, actorUserId: owner, generation: state.generation,
          authorizationVersion: state.authorizationVersion } as unknown as FirestoreAuthorityTransaction, state.grant, state.accessRevision);
      });
    },
    async readIndexHeadIn(_b: FirestoreAuthorityTransaction, _card: string, _grant: string, _revision: number, id: string) { return heads.get(id) ?? null; },
  };
  let activeOperation = randomUUID();
  const roots: string[] = [];
  const search = createPrivateSourceSearch({ domain: data, documents,
    currentAuth: async owner => ({ userId: owner, disabled: !state.auth, emailVerified: state.auth }),
    async openSession(options) {
      state.sessions++; roots.push(options.rootRunId);
      assert.equal(options.interactive, true);
      assert.equal(options.reference, activeOperation);
      assert.ok(options.deadlineAtMs! > Date.now());
      assert.equal(await options.authorize(), true);
      return { settingsVersion: 'policy-1', billingSource: 'personal' as const,
        async embed(input, key) {
          state.calls++;
          assert.equal(input.task, 'RETRIEVAL_QUERY'); assert.equal(input.title, undefined);
          assert.equal(key, 'embedding:private-source-query');
          if (state.failure) throw new Error('Synthetic gateway failure');
          state.afterEmbed?.(); return vector();
        }, close() { state.closes++; } };
    } });
  return { fake, data, state, search, scope, cardId, heads, units, roots,
    operation: () => activeOperation, newOperation() { activeOperation = randomUUID(); return activeOperation; } };
}

test('chat search charges its existing run once and creates no independent model session', async () => {
  const f = fixture(), query = '這份校刊有甚麼圖案？';
  let calls = 0;
  const options = { operationId: f.operation(), async embedInRun(text: string, authorize: () => Promise<boolean>) {
    assert.equal(text, query);
    assert.equal(await authorize(), true);
    calls++;
    return vector();
  } };
  const first = await f.search('alice', f.cardId, query, options);
  assert.ok(first.items.length);
  assert.deepEqual(await f.search('alice', f.cardId, query, options), first);
  assert.equal(calls, 1);
  assert.equal(f.state.sessions, 0);
});

test('private search embeds one query across retries and bounded pages and preserves physical evidence types', async () => {
  const f = fixture(520), operationId = f.operation(), query = 'Synthetic private question';
  const first = await f.search('alice', f.cardId, query, { operationId });
  assert.equal(first.items.length, 6); assert.ok(first.nextCursor);
  assert.equal(first.items[0]!.facts[1]!.type, 'visual_description');
  for (const item of first.items) {
    assert.equal(item.incarnation, f.heads.get(item.source.documentId)!.rag.incarnation);
    assert.equal(item.source.version, f.heads.get(item.source.documentId)!.version);
    assert.equal(typeof item.offset, 'number');
  }
  assert.deepEqual(await f.search('alice', f.cardId, query, { operationId }), first);
  const next = await f.search('alice', f.cardId, query, { operationId, cursor: first.nextCursor });
  assert.equal(next.items.length, 6); assert.equal(next.nextCursor, null);
  assert.equal(f.state.calls, 1); assert.equal(f.state.sessions, 1); assert.equal(f.state.closes, 1);
  assert.equal(first.items.some(item => next.items.some(other => item.source.documentId === other.source.documentId)), false);
  const stored = JSON.stringify([...f.fake.records.values()]);
  assert.equal(stored.includes(query), false); assert.equal(stored.includes('Original wording'), false);
  assert.equal(stored.includes('"vector"'), false); assert.equal(stored.includes('"identity"'), false);
});

test('no eligible ready rows makes no model call, while an empty first batch continues to the live evidence', async () => {
  const empty = fixture(0);
  assert.deepEqual(await empty.search('alice', empty.cardId, 'Nothing indexed', { operationId: empty.operation() }), { items: [], nextCursor: null });
  assert.equal(empty.state.sessions, 0);
  const f = fixture(40), ordered = [...f.units].sort((a, b) => a.physicalId.localeCompare(b.physicalId));
  for (const { row } of ordered.slice(0, 32)) f.heads.delete(row.documentId);
  const first = await f.search('alice', f.cardId, 'Read second page', { operationId: f.operation() });
  assert.equal(first.items.length, 6); assert.equal(first.nextCursor,null); assert.equal(f.state.calls,1);
});

test('gateway failure and unknown admission never become no-match results or repeat paid attempts', async () => {
  const f = fixture(); f.state.failure = true;
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), /gateway failure/);
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), { code: 'private_query_unknown' });
  assert.equal(f.state.calls, 1); assert.equal(f.state.closes, 1);
  const lost = fixture(); lost.fake.loseReply();
  await assert.rejects(lost.search('alice', lost.cardId, 'Private query', { operationId: lost.operation() }), /lost commit/);
  await assert.rejects(lost.search('alice', lost.cardId, 'Private query', { operationId: lost.operation() }), { code: 'private_query_unknown' });
  assert.equal(lost.state.calls, 0);
});

test('a lost ready acknowledgement reads the existing vector on retry', async () => {
  const f = fixture(); f.state.loseSave = true;
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), /lost commit/);
  const result = await f.search('alice', f.cardId, 'Private query', { operationId: f.operation() });
  assert.equal(result.items.length, 1); assert.equal(f.state.calls, 1);
});

test('current head incarnation and version are checked again after embedding and on cache reuse', async () => {
  const f = fixture(), head = f.heads.values().next().value!;
  f.state.afterEmbed = () => { head.rag.incarnation = randomUUID(); };
  assert.equal((await f.search('alice', f.cardId, 'Changed source', { operationId: f.operation() })).items.length, 0);
  assert.equal((await f.search('alice', f.cardId, 'Changed source', { operationId: f.operation() })).items.length, 0);
  assert.equal(f.state.calls, 1);
});

test('owner authentication, grants and control generation fence the query before delivery', async () => {
  const disabled = fixture(); disabled.state.afterEmbed = () => { disabled.state.auth = false; };
  await assert.rejects(disabled.search('alice', disabled.cardId, 'Private query', { operationId: disabled.operation() }), { code: 'private_source_changed' });
  const f = fixture();
  await f.search('alice', f.cardId, 'Private query', { operationId: f.operation() });
  await assert.rejects(f.search('alice', f.cardId, 'Changed query', { operationId: f.operation() }), { code: 'private_source_changed' });
  f.state.grant = firestoreDomainHash('replacement-grant');
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), { code: 'private_source_changed' });
  f.state.grant = firestoreDomainHash('grant'); f.state.generation = randomUUID();
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), { code: 'private_source_changed' });
  assert.equal(f.state.calls, 1);
});

test('an expired original deadline or evicted cache never causes a new root or embedding', async () => {
  const f = fixture();
  await f.search('alice', f.cardId, 'Private query', { operationId: f.operation() });
  const key = privateQueryId(f.scope, { kind: 'receipt', cardId: f.cardId, operationId: f.operation() });
  const ref = f.data.ref(PRIVATE_QUERY_COLLECTION, PRIVATE_QUERY_FAMILY, key);
  const snap = await f.fake.database.runTransaction(tx => tx.get(ref));
  const row = f.data.open(PRIVATE_QUERY_FAMILY, key, f.scope, privateQueryRecord, snap);
  assert.equal(row.kind, 'receipt');
  const expired = { ...row, deadlineAtMs: Date.now() - 1 };
  f.fake.records.set(ref.path, { ...f.data.tags(f.scope), ...f.data.seal(PRIVATE_QUERY_FAMILY, key, f.scope, privateQueryRecord, expired) });
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), { code: 'private_query_expired' });
  assert.equal(f.state.calls, 1); assert.equal(f.roots.length, 1);
  const evicted = fixture(); await evicted.search('alice', evicted.cardId, 'Private query', { operationId: evicted.operation() });
  for (const [path, value] of evicted.fake.records) {
    if (path !== evicted.data.ref(PRIVATE_QUERY_COLLECTION, PRIVATE_QUERY_FAMILY,
      privateQueryId(evicted.scope, { kind: 'receipt', cardId: evicted.cardId, operationId: evicted.operation() })).path && value.targetTag === undefined) evicted.fake.records.delete(path);
  }
  await assert.rejects(evicted.search('alice', evicted.cardId, 'Private query', { operationId: evicted.operation() }), { code: 'private_query_expired' });
  assert.equal(evicted.state.calls, 1);
});

test('database failures and foreign cursors are surfaced without invoking the gateway', async () => {
  const f = fixture(); f.fake.failCommit();
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation() }), /commit failed/);
  assert.equal(f.state.calls, 0);
  const foreign = Buffer.from(JSON.stringify({ operationId: randomUUID(), after: 'a'.repeat(64) })).toString('base64url');
  await assert.rejects(f.search('alice', f.cardId, 'Private query', { operationId: f.operation(), cursor: foreign }), { code: 'invalid_cursor' });
  assert.equal(f.state.calls, 0);
});

test('one private search returns the most similar evidence from later batches with one embedding', async () => {
  const f = fixture(96), ordered = [...f.units].sort((a, b) => a.physicalId.localeCompare(b.physicalId));
  const best = ordered.at(-1)!.row;
  for (const { row } of ordered) {
    const updated = { ...row, vector: row === best ? vector() : vector(0.1, 1) };
    const id = privateIndexId(f.scope, updated), ref = f.data.ref(PRIVATE_INDEX_COLLECTION, PRIVATE_INDEX_FAMILY, id);
    f.fake.records.set(ref.path, { ...f.data.tags(f.scope), ...privateIndexMetadata(f.scope, updated),
      ...f.data.seal(PRIVATE_INDEX_FAMILY, id, f.scope, privateIndexRecord, updated) });
  }
  const result = await f.search('alice', f.cardId, 'Relevant later evidence', { operationId: f.operation() });
  assert.equal(result.items[0]!.source.documentId, best.documentId);
  assert.equal(result.items[0]!.score, 1); assert.equal(result.items.length, 6);
  assert.equal(result.nextCursor, null); assert.equal(f.state.calls, 1); assert.equal(f.roots.length, 1);
});
