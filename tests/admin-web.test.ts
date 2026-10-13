import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { AdminOwner } from '../frontend/src/production/AdminOwner.ts';
import { readAdminUid } from '../server/admin-api.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import type { AdminCommand } from '../src/shared/admin.ts';

test('web admin uses production HTTP, invitation authority, shared policy and immutable usage with original-operation recovery', async () => {
  const f = firestoreDomainFixture(), options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 19)), projectId: 'synthetic-admin', namespace: 'synthetic_admin' };
  const authority = createFirestoreAuthority(options), origin = 'https://synthetic.example';
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['admin', 'parent']) {
    await authority.issueInvitation({ email: userId + '@example.test', expiresAt: new Date(Date.now() + 86400000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email: userId + '@example.test', emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-admin', VERTEX_LOCATION: 'global', GEMINI_MODEL: 'gemini-3.1-flash-lite', AI_DAILY_USER_ATTEMPTS: '12', AI_DAILY_GLOBAL_ATTEMPTS: '20' });
  const admin = createFirestoreAdmin(options, config);
  let actor: string | null = 'admin', recent = true;
  const session = () => actor ? { user: { id: actor } } : null;
  const auth = { getSession: async () => session(), handler: async () => new Response(null, { status: 404 }),
    assertRecentReauthentication: async () => { if (!recent) { const { FirebaseAuthError } = await import('../server/firebase-auth.ts'); throw new FirebaseAuthError(401, 'recent_reauthentication_required'); } return session()!; } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority, auth, publicOrigin: origin, mailConfigured: true, admin, adminUid: 'admin' });
  let requests = 0;
  async function http(path: string, body?: unknown, who = 'admin', suppliedOrigin = origin) {
    requests++; return handler(new Request(origin + '/api/admin/' + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-expected-user-id': who, origin: suppliedOrigin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  }
  const command: AdminCommand = { kind: 'invite', email: 'invited@example.test', expiresAt: new Date(Date.now() + 86400000).toISOString(), opId: randomUUID() };
  actor = null; assert.equal((await http('policy')).status, 401);
  actor = 'parent'; assert.equal((await http('operations', command, 'parent')).status, 403);
  assert.equal((await http('policy', undefined, 'parent')).status, 403);
  actor = 'admin'; assert.equal((await http('operations', command, 'admin', 'https://foreign.example')).status, 403);
  recent = false; assert.equal((await http('operations', command)).status, 401); recent = true;
  assert.equal(readAdminUid({}), null);
  let r = await http('operations', command); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control')!, /no-store/);
  const invitationReceipt = await r.json(); assert.equal(invitationReceipt.result.state, 'issued');
  assert.deepEqual(await (await http('operations', command)).json(), invitationReceipt);
  assert.equal((await http('operations', { ...command, email: 'different@example.test' })).status, 409);
  let page = await (await http('invitations')).json(); assert.equal(page.items.length, 1); assert.equal(page.items[0].state, 'issued');
  await authority.admitIdentity({ userId: 'invited', email: command.email, emailVerified: true });
  assert.equal((await http('operations', { kind: 'revoke', email: command.email, opId: randomUUID() })).status, 409);
  assert.equal((await authority.accountStatus('invited')).user?.id, 'invited');
  page = await (await http('invitations')).json(); assert.equal(page.items[0].state, 'consumed');
  const second = { ...command, email: 'unused@example.test', opId: randomUUID() };
  assert.equal((await http('operations', second)).status, 200);
  assert.equal((await http('operations', { kind: 'revoke', email: second.email, opId: randomUUID() })).status, 200);
  assert.equal((await (await http('invitation?email=unused%40example.test')).json()).invitation.state, 'revoked');
  assert.equal((await (await http('invitation?email=parent%40example.test')).json()).invitation.state, 'consumed');
  const apiRouting = createFirestoreModelRouting(options, config), workerRouting = createFirestoreModelRouting(options, config);
  const original = await apiRouting.resolve('parent', 'interactive'); assert.equal(original.config.dailyUserAttempts, 12); assert.equal(original.runLimits.modelCalls, 4);
  const baseline = (await admin.overview()).policy, { version, updatedAt, ...values } = baseline;
  const change: AdminCommand = { kind: 'policy', opId: randomUUID(), expectedVersion: 0, values: { ...values, maxModelCalls: 5, dailyUserAttempts: 13 } };
  f.loseReply(); r = await http('operations', change); assert.equal(r.status, 503);
  const saved = await (await http('operations/' + change.opId)).json(); assert.equal(saved.receipt.result.version, 1);
  assert.equal((await (await http('operations', change)).json()).result.version, 1);
  assert.equal((await http('operations', { ...change, opId: randomUUID() })).status, 409);
  const newer = await apiRouting.resolve('parent', 'interactive'), worker = await workerRouting.resolve('parent', 'worker');
  assert.equal(newer.config.dailyUserAttempts, 13); assert.deepEqual(worker.runLimits, newer.runLimits); assert.equal(original.config.dailyUserAttempts, 12);
  const usage = new FirestoreAiUsage({ ...options, namespace: options.namespace + '_ai_usage', billingSource: 'platform' });
  const attempt = { rootRunId: 'admin-synthetic-run', attemptKey: 'model:1', bindingFingerprint: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64),
    userId: 'parent', childId: 'synthetic-child', model: config.model, deadlineAtMs: Date.now() + 90000, userLimit: 13, globalLimit: 20 };
  assert.equal((await usage.reserve(attempt)).decision, 'execute');
  await usage.record(attempt, { outcome: 'succeeded', inputTokens: 10, outputTokens: 2, cachedTokens: 0, durationMs: 5 });
  const pause: AdminCommand = { ...change, opId: randomUUID(), expectedVersion: 1, values: { ...change.values, enabled: false } };
  assert.equal((await http('operations', pause)).status, 200); assert.equal(await newer.authorize(), false);
  const totals = await (await http('usage')).json(); assert.equal(totals.platform.attempts, 1); assert.equal(totals.platform.inputTokens, 10); assert.equal(totals.personal.attempts, 0);
  assert.equal((await http('usage?day=2026-02-30')).status, 400);
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, data] of f.records) if (path.includes('_admin_policy/') || path.includes('_admin_operations/') || path.includes('_admin_invitations/')) {
    const decoded = codec.decode({ path, data });
    const restored = codec.transform(decoded, { newEpochByWorkspace: new Map(), generation: randomUUID(), photoDescriptors: new Map() });
    const roundtrip = codec.decode(restored); assert.equal(roundtrip.context.kind, decoded.context.kind);
    if (roundtrip.context.kind === 'platform-policy') assert.equal((roundtrip.value as any).enabled, false);
  }
  let drop = true;
  const owner = new AdminOwner(origin + "/api", (async (url, init) => {
    const response = await handler(new Request(String(url), { ...init, headers: { ...(init?.headers as object), origin } }));
    if (drop && init?.method === 'POST') { drop = false; throw new Error('Synthetic lost response'); } return response;
  }) as typeof fetch);
  owner.setUser('admin'); await owner.checkAccess(); await owner.load(new Date().toISOString().slice(0,10));
  assert.equal(owner.getSnapshot().access, 'allowed');
  await owner.submit({ ...second, email: 'owner@example.test', opId: randomUUID() });
  assert.ok(owner.getSnapshot().pending); await owner.recover(); assert.equal(owner.getSnapshot().pending, null); assert.ok(owner.getSnapshot().receipt);
  owner.setUser('parent'); assert.equal(owner.getSnapshot().overview, null); assert.equal(owner.getSnapshot().audit.items.length, 0);
  owner.dispose(); assert.ok(requests < 40); console.info(JSON.stringify({ syntheticHttpRequests: requests, realModelCalls: 0, notifications: 0 }));
});
