import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createKnowledgeIndexBatches } from '../server/firestore-knowledge-index-batches.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { readAiConfig } from '../server/ai-config.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import type { ServerAuthSession, ServerAuthSessionWithHeaders } from '../server/auth-port.ts';

test('admin knowledge status reads bounded actual checks with stable equal-time pages and no private worker fields or refresh', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Status reads cannot contact sources'); });
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 137)),
    projectId: 'synthetic-admin-status', namespace: 'admin_status' };
  const authority = createFirestoreAuthority(options), generation = randomUUID();
  await authority.initializeControl({ enabled: true, generation });
  const refreshOptions = { ...options, definitions: SOURCE_WATCHES, readControl: (tx: Parameters<typeof authority.readControl>[0]) => authority.readControl(tx) };
  const refresh = createFirestoreKnowledgeRefresh(refreshOptions);
  await refresh.register(SOURCE_WATCHES[0].id, 'synthetic-admin');
  await refresh.register(SOURCE_WATCHES[1].id, 'synthetic-admin'); await refresh.disable(SOURCE_WATCHES[1].id);
  await createFirestoreKnowledgeRefresh({ ...refreshOptions, definitions: SOURCE_WATCHES.map((definition, index) => index === 2
    ? { ...definition, title: 'Previous controlled definition' } : definition) }).register(SOURCE_WATCHES[2].id, 'synthetic-admin');
  const time = '2026-11-05T00:00:00.000Z', id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const watchedPath = `admin_status_knowledge_watches/${SOURCE_WATCHES[0].id}`;
  fixture.records.set(watchedPath, { ...fixture.records.get(watchedPath)!, lastAttemptAt: time, lastSuccessfulCheckAt: time, lastStatus: 'unchanged' });
  for (let n = 1; n <= 25; n++) fixture.records.set(`admin_status_knowledge_checks/${id(n)}`, {
    schemaVersion: 1, projectId: options.projectId, namespace: options.namespace, jobId: id(n),
    watchId: n === 25 ? 'retired-controlled-source' : SOURCE_WATCHES[0].id, revision: randomUUID(), workerGeneration: generation,
    token: randomUUID(), checkedAt: time, state: 'recorded', status: 'unchanged', attempts: 1, itemCount: 1, changedCount: 0, failureCode: null, httpStatus: null,
  });
  const admin = createFirestoreAdmin(options, readAiConfig({ AI_ENABLED: 'false' }), refresh);
  t.mock.method(admin, 'usage', async () => { throw Error('Status reads cannot query usage'); });
  let actor = 'admin', finalSwitch = false, reads = 0;
  async function getSession(input: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  async function getSession(input: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(input: { headers: Headers; returnHeaders?: boolean }): Promise<ServerAuthSession | ServerAuthSessionWithHeaders | null> {
    const response = { user: { id: finalSwitch && ++reads === 2 ? 'ordinary' : actor } };
    return input.returnHeaders ? { response, headers: new Headers() } : response;
  }
  const auth: FirebaseAuthPort = { fromNodeHeaders: () => new Headers(), getSession,
    handler: async () => new Response(null, { status: 404 }), assertRecentReauthentication: async () => ({ user: { id: actor } }) };
  const handler = createFirebaseRequestHandler({ authority, auth, publicOrigin: 'https://example.test', mailConfigured: true, admin, adminUid: 'admin' });
  const request = (query = '', selected = handler) => selected(new Request('https://example.test/api/admin/knowledge-status' + query,
    { headers: { 'x-expected-user-id': actor } }));
  const before = structuredClone([...fixture.records]);
  actor = 'ordinary'; assert.equal((await request()).status, 403); actor = 'admin';
  const firstResponse = await request(); assert.equal(firstResponse.status, 200);
  assert.match(firstResponse.headers.get('cache-control')!, /private.*no-store/);
  const { adminKnowledgeStatusSchema } = await import('../src/shared/admin.ts');
  const first = adminKnowledgeStatusSchema.parse(await firstResponse.json());
  assert.equal(first.watches.length, SOURCE_WATCHES.length);
  assert.deepEqual(first.watches.slice(0, 4).map(watch => watch.registration), ['enabled', 'disabled', 'definition_changed', 'not_registered']);
  assert.equal(first.watches[0].lastAttemptAt, time); assert.equal(first.watches[0].lastSuccessfulCheckAt, time); assert.equal(first.watches[0].lastStatus, 'unchanged');
  assert.equal(first.watches[3].lastAttemptAt, null); assert.equal(first.watches[3].lastSuccessfulCheckAt, null); assert.equal(first.watches[3].lastStatus, null);
  assert.deepEqual(Object.keys(first.watches[0]).sort(), ['id', 'publisher', 'url', 'kind', 'registration', 'lastAttemptAt', 'lastSuccessfulCheckAt', 'lastStatus'].sort());
  assert.equal(first.checks.length, 20); assert.equal(first.checks[0].jobId, id(25)); assert.equal(first.checks.at(-1)!.jobId, id(6));
  assert.equal(first.checks[0].watchId, 'retired-controlled-source'); assert.ok(first.nextCursor);
  assert.deepEqual(Object.keys(first.checks[0]).sort(), ['jobId', 'watchId', 'checkedAt', 'state', 'status', 'attempts', 'itemCount', 'changedCount', 'failureCode', 'httpStatus'].sort());
  assert.doesNotMatch(JSON.stringify(first), /"(?:workerGeneration|registeredBy|definitionHash|lease|token|originalText)"\s*:/);
  const second = adminKnowledgeStatusSchema.parse(await (await request('?cursor=' + encodeURIComponent(first.nextCursor))).json());
  assert.deepEqual(second.checks.map(check => check.jobId), [5, 4, 3, 2, 1].map(id)); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.checks, ...second.checks].map(check => check.jobId)).size, 25);
  assert.equal((await request('?cursor=broken')).status, 400); assert.equal((await request('?cursor=x&cursor=y')).status, 400);
  assert.equal((await request('?refresh=1')).status, 400);
  const changedPosition = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()), checkedAt: '2025-01-01T00:00:00Z' })).toString('base64url');
  assert.equal((await request('?cursor=' + changedPosition)).status, 400);
  const corruptedPath = `admin_status_knowledge_checks/${id(25)}`, saved = fixture.records.get(corruptedPath)!;
  fixture.records.set(corruptedPath, { ...saved, jobId: randomUUID() }); assert.equal((await request()).status, 503);
  fixture.records.set(corruptedPath, { ...saved, namespace: 'another_namespace' }); assert.equal((await request()).status, 503);
  fixture.records.set(corruptedPath, saved);
  finalSwitch = true; reads = 0; assert.equal((await request()).status, 409); finalSwitch = false;
  const unwired = createFirebaseRequestHandler({ authority, auth, publicOrigin: 'https://example.test', mailConfigured: true,
    admin: createFirestoreAdmin(options, readAiConfig({ AI_ENABLED: 'false' })), adminUid: 'admin' });
  assert.equal((await request('', unwired)).status, 503);
  assert.deepEqual([...fixture.records], before, 'Inspection cannot register watches, persist work, publish content or change receipts');

  const indexes = createKnowledgeIndexBatches(options, { listVersions: async () => ({ items: [], nextVersionId: null }),
    rebuildSearchPageIn: async () => { throw Error('A Web request must not rebuild indexes'); } }, tx => authority.readControl(tx), 'admin');
  const indexHandler = createFirebaseRequestHandler({ authority, auth, publicOrigin: 'https://example.test', mailConfigured: true,
    admin: createFirestoreAdmin(options, readAiConfig({ AI_ENABLED: 'false' }), refresh, indexes), adminUid: 'admin' });
  const path = 'https://example.test/api/admin/knowledge-index-batches';
  const command = { opId: randomUUID(), targets: [{ versionId: randomUUID(), versionHash: 'b'.repeat(64) }] };
  const post = (origin: string) => indexHandler(new Request(path, { method: 'POST',
    headers: { origin, 'x-expected-user-id': actor, 'content-type': 'application/json' }, body: JSON.stringify(command) }));
  actor = 'ordinary'; assert.equal((await post('https://example.test')).status, 403);
  actor = 'admin'; assert.equal((await post('https://other.test')).status, 403);
  const { adminIndexBatchReplySchema } = await import('../src/shared/admin-knowledge-index.ts');
  const created = await post('https://example.test'); assert.equal(created.status, 200);
  const createdView = adminIndexBatchReplySchema.parse(await created.json());
  assert.equal(createdView.batch?.id, command.opId);
  const read = await indexHandler(new Request(path + '/' + command.opId, { headers: { 'x-expected-user-id': actor } }));
  assert.deepEqual(await read.json(), createdView);
});
