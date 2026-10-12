import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharedInputStore } from '../server/firestore-shared-inputs.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentSources } from '../server/firestore-agent-sources.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import type { ServerAuthSession, ServerAuthSessionWithHeaders } from '../server/auth-port.ts';
import { createSharedInputApi } from '../src/client/shared-input-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { SourceManagement } from '../src/shared/shared-inputs.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('F05 existing source client and Agent share Firestore versions, consent, receipts and deletion', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 24)),
    projectId: 'synthetic-sources', namespace: 'synthetic_sources' };
  const authority = createFirestoreAuthority(options), sources = createFirestoreSharedInputStore(options);
  const online = createFirestoreOnlineStore({ ...options, mutations: [sources.mutation] });
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const owner of ['one', 'two']) {
    const email = owner + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId: owner, email, emailVerified: true });
    await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const { child } = await authority.createChild({ userId: 'one', operationId: randomUUID(), displayName: '合成孩子' });
  const origin = 'https://synthetic.example.test';
  let active = 'one';
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }): Promise<ServerAuthSession | ServerAuthSessionWithHeaders | null> {
    const response = { user: { id: active } }; return options.returnHeaders ? { response, headers: new Headers() } : response;
  }
  const auth: FirebaseAuthPort = { getSession, async handler() { return new Response('', { status: 404 }); },
    fromNodeHeaders: () => new Headers(), async assertRecentReauthentication() { return { user: { id: active } }; } };
  const handler = createFirebaseRequestHandler({ authority, auth, online, sources, publicOrigin: origin, mailConfigured: false });
  const submissions: any[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers); headers.set('origin', origin);
    const request = new Request(url, { ...init, headers });
    if (new URL(request.url).pathname === '/api/online/submit') submissions.push(await request.clone().json());
    return handler(request);
  };
  const api = createSharedInputApi(origin, fetcher), signal = new AbortController().signal;
  let result = await api.create(child.id, { kind: 'personal_source', sourceLabel: '合成私人資料', sourceUrl: null,
    sourceDateText: null, sourceNotes: '只供本人', text: '原文第一項\n第二項' }, signal, 'one');
  assert.ok(result && 'input' in result); let item = result.input;
  assert.equal(item.management, null); assert.equal((await api.inputs(child.id, signal, 'one')).inputs[0].id, item.id);
  const original = submissions.at(-1); assert.ok(original);
  assert.ok((await online.submit('one', original)).result); assert.equal((await sources.list('one', child.id))?.inputs.length, 1);
  const management: SourceManagement = { intention: '僅參考', purpose: 'answer_reference', nature: 'external_material', timeScope: 'long_reference',
    validityText: '', enabled: true, modelExcerpt: '原文第一項' };
  result = await api.manage(item, { expectedVersion: item.version, management, content: null, reason: '本人授權選段' }, signal, 'one');
  assert.ok(result && 'input' in result); item = result.input;
  const extension = createFirestoreAgentSources(sources);
  await authority.runTransaction('one', child.id, async b => {
    const change = { expectedVersion: item.version, management, content: { kind: 'personal_source' as const, sourceLabel: item.sourceLabel,
      sourceUrl: null, sourceDateText: null, sourceNotes: item.sourceNotes, text: '更正第一項\n第二項' }, reason: '本人已確認的更正' };
    const value = { kind: 'private_source_change' as const, inputId: item.id, change };
    assert.equal((await extension.target(b, value)).visibility, 'private');
    const prepared = await extension.prepare(b, { proposal: { value } } as any, randomUUID()); prepared.commit();
  });
  item = await api.input(child.id, item.id, signal, 'one');
  assert.equal(item.text, '更正第一項\n第二項'); assert.equal(item.management?.modelExcerpt, null);
  assert.equal((await api.managementHistory(item, signal, 'one')).revisions.length, 2);
  await assert.rejects(sources.manage('one', child.id, item.id, { expectedVersion: 1, management, content: null, reason: '舊版本' }));
  active = 'two'; await assert.rejects(api.input(child.id, item.id, signal, 'two')); active = 'one';
  const fresh = createFirestoreSharedInputStore(options); assert.equal((await fresh.get('one', child.id, item.id))?.text, item.text);
  assert.equal((await online.submit('one', original)).result, null, 'old receipt never impersonates a later body');
  await api.delete(item, signal, 'one');
  assert.equal((await api.inputs(child.id, signal, 'one')).inputs.length, 0);
  assert.equal((await online.submit('one', original)).result, null);
  await assert.rejects(fresh.get('one', child.id, item.id));
});
