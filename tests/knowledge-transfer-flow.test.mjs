import assert from 'node:assert/strict';
import test from 'node:test';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createKnowledgeTransfers } from '../server/firestore-knowledge-transfers.ts';
import { parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { readFile } from 'node:fs/promises';

test('knowledge import checkpoints with the draft transaction, stops stale work and resumes the pinned edition', async () => {
  const { database } = serialFirestoreFixture();
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 59)), projectId: 'synthetic-knowledge-transfer', namespace: 'test_transfer' };
  const source = parseKnowledgeSource(JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'))[0]);
  const hash = sourceVersionHash(source), digest = 'b'.repeat(64), actor = 'local-maintainer';
  const corpus = createFirestoreKnowledgeStore({ ...options, sourceIds: [source.sourceId] });
  const open = () => createKnowledgeTransfers(options, async () => ({ enabled: true, generation: 'a89b5137-2809-46c9-b53d-3031066a210b' }));
  const job = await open().start(digest, 1, actor), entry = {sourceId: source.sourceId, versionHash: hash};
  const stopped = await open().control(digest, 'stop', job.revision, actor);
  await assert.rejects(corpus.importSource(source, open().fence(job, entry, actor)), /knowledge_transfer_changed/);
  assert.equal((await corpus.listVersions()).items.length, 0);
  const resumed = await open().control(digest, 'resume', stopped.revision, actor);
  const result = await corpus.importSource(source, open().fence(resumed, entry, actor));
  assert.equal(result.state, 'draft');
  assert.equal(await corpus.publishedEdition(source.sourceId), null);
  assert.deepEqual((await open().results(digest, 0, 1)).map(row => [row.sourceId, row.versionId, row.unchanged]), [[source.sourceId, result.versionId, false]]);
  assert.equal((await open().start(digest, 1, actor)).state, 'completed');
  await assert.rejects(corpus.importSource(source, open().fence(resumed, entry, actor)), /knowledge_transfer_changed/);
});
test('a checked ZIP resumes on its second public edition and a changed source hash leaves a traceable failure', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path'), { tmpdir } = await import('node:os');
  const { writeKnowledgeArchive, openKnowledgeArchive } = await import('../scripts/knowledge-transfer-zip.mjs');
  const { importKnowledgePage, readPortableEdition } = await import('../scripts/knowledge-transfer-operations.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-transfer-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const sources = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8')).slice(0, 2).map(parseKnowledgeSource);
  const entries = sources.map((source) => ({ sourceId: source.sourceId, versionHash: sourceVersionHash(source) }));
  const { database } = serialFirestoreFixture();
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 66)), projectId: 'synthetic-transfer-flow', namespace: 'transfer_flow' };
  const store = createFirestoreKnowledgeStore({ ...options, sourceIds: entries.map((entry) => entry.sourceId) });
  const ledger = createKnowledgeTransfers(options, async () => ({ enabled: true, generation: 'a89b5137-2809-46c9-b53d-3031066a210b' }));
  const operator = 'fixture', file = join(directory, 'public.zip');
  const load = (entry) => ({
    source: sources.find((s) => s.sourceId === entry.sourceId),
    versionHash: entry.versionHash, embeddings: [],
  });
  const saved = await writeKnowledgeArchive(file, entries, load);
  async function step() {
    const archive = await openKnowledgeArchive(file, saved.sha256);
    try { return await importKnowledgePage({ ledger, store, archive, digest: saved.sha256, operator, limit: 1 }); }
    finally { await archive.close(); }
  }
  assert.equal((await step()).next, 1);
  const { createFirestoreAdmin } = await import('../server/firestore-admin.ts');
  const { readAiConfig } = await import('../server/ai-config.ts');
  const { handleAdminRequest } = await import('../server/admin-api.ts');
  const actor = 'test-admin', origin = 'https://localhost', zip = await readFile(file);
  const { createKnowledgeArchiveReceiver } = await import('../server/admin-knowledge-archive.ts');
  const admin = createFirestoreAdmin(options, readAiConfig({AI_ENABLED:'false'}), undefined, undefined, ledger, createKnowledgeArchiveReceiver(ledger,store,directory));
  const post = (digest,bytes,uid = actor) => handleAdminRequest(new Request(origin + '/api/admin/knowledge-transfers/' + digest + '/content', {
    method:'POST', headers:{origin,'content-type':'application/zip','x-expected-user-id':uid,'x-archive-bytes':String(bytes.length)}, body:bytes
  }), {publicOrigin:origin,adminUid:actor,admin,auth:{getSession:async()=>({user:{id:uid}}),assertRecentReauthentication:async()=>({user:{id:uid}})},
    readJson(){ throw Error('ZIP must stay streamed'); }});
  await assert.rejects(post(saved.sha256,zip,'other'),{code:'forbidden'});
  await assert.rejects(post('e'.repeat(64),zip),{code:'knowledge_archive_integrity_failed'});
  assert.equal(await ledger.get('e'.repeat(64)),null);
  const { createFirebaseNodeHandler } = await import('../server/firebase-http.ts');
  const { IncomingMessage } = await import('node:http');
  const { Socket } = await import('node:net');
  const { EventEmitter } = await import('node:events');
  const auth = {fromNodeHeaders:raw=>new Headers(raw),getSession:async()=>({user:{id:actor}}),assertRecentReauthentication:async()=>({user:{id:actor}})};
  const http = createFirebaseNodeHandler({publicOrigin:origin,auth,handler:async request => {
    try { return await handleAdminRequest(request,{publicOrigin:origin,adminUid:actor,admin,auth,readJson(){throw Error('expected streaming ingress');}}); }
    catch (error) {return Response.json({error:{code:error.code}},{status:error.status??500});}
  }});
  async function send(digest,body) {
    const request = new IncomingMessage(new Socket());
    request.method='POST'; request.url='/api/admin/knowledge-transfers/'+digest+'/content';
    request.headers={origin,'x-expected-user-id':actor,'content-type':'application/zip','x-archive-bytes':String(body.length),'content-length':String(body.length)};
    request.push(body); request.push(null);
    const response = Object.assign(new EventEmitter(),{statusCode:200,setHeader(){},end(bytes){this.bytes=bytes;}});
    await http(request,response);
    return new Response(response.bytes,{status:response.statusCode});
  }
  // Even an invalid ZIP above the normal JSON limit must reach the archive verifier as a stream.
  const invalid = await send('e'.repeat(64),Buffer.alloc(70000));
  assert.equal(invalid.status,400); assert.equal((await invalid.json()).error.code,'knowledge_archive_integrity_failed');
  const draft = await send(saved.sha256,zip);
  assert.equal(draft.status,200);
  assert.equal((await draft.json()).batch.state,'completed');
  assert.equal((await (await post(saved.sha256,zip)).json()).batch.revision,3);
  assert.equal((await step()).state, 'completed');
  assert.equal((await step()).revision, 3);
  assert.equal((await ledger.results(saved.sha256, 0, 2)).length, 2);
  assert.equal(await store.publishedEdition(entries[0].sourceId), null);
  const foreign = { ...load(entries[0]), embeddings: [{ chunkKey: sources[0].chunks[0].key, inputHash: 'b'.repeat(64),
    model: 'different-space', pipeline: 'foreign-v2', dimensions: 2, values: [0, 1] }] };
  assert.deepEqual(readPortableEdition(foreign, entries[0]).embeddings, []);
  const mutated = { ...load(entries[0]), source: { ...sources[0], title: 'modified in transit' } };
  const badDigest = 'f'.repeat(64), bad = { entries: [entries[0]], readEdition: async () => mutated };
  await assert.rejects(importKnowledgePage({ ledger, store, archive: bad, digest: badDigest, operator, limit: 1 }), /knowledge_transfer_binding_invalid/);
  assert.equal((await ledger.get(badDigest))?.state, 'failed');
  assert.equal((await ledger.get(badDigest))?.lastFailure?.sourceId, entries[0].sourceId);
});
