import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountServiceOwner } from '../../production/AccountServiceOwner.ts';
import { createAccountApi, ACCOUNT_DELETION_VERIFICATION_MS } from '../../../../src/client/account-api.ts';
import { SERVICE_POLICY_VERSION } from '../../../../src/shared/account-service.ts';
import { ClientApiError, createRecordsApi } from '../../../../src/client/records-api.ts';
import { RecordsController } from '../../../../src/client/records-controller.ts';
import type { AccountAuthMethods, ReauthenticationInput, SocialAuthProvider } from '../../../../src/shared/auth-providers.ts';
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(expectedProof: ReauthenticationInput = 'Synthetic secret') {
  let auth: () => Promise<void> = async () => {}, deleteMode = 'success', operation: string | null = null, writes = 0, completed = 0;
  let links = 0, preparations = 0;
  const methods: AccountAuthMethods = { userId: 'synthetic-a', providers: [typeof expectedProof === 'string' ? 'password' : expectedProof.provider],
    currentProvider: typeof expectedProof === 'string' ? 'password' : expectedProof.provider };
  const identity = {
    socialProviders: ['google.com', 'apple.com'] as readonly SocialAuthProvider[],
    reauthenticate: async (_userId: string, proof: ReauthenticationInput) => { assert.deepEqual(proof, expectedProof); await auth(); },
    authenticationMethods: async (userId: string) => ({ ...methods, userId }),
    prepareProviderLink: async (userId: string, proof: ReauthenticationInput) => { assert.equal(userId, methods.userId); assert.deepEqual(proof, expectedProof); preparations++; await auth(); },
    linkProvider: async (userId: string, provider: SocialAuthProvider, consent: boolean) => { assert.equal(userId, methods.userId); assert.equal(consent, true); links++; methods.providers = [...methods.providers, provider]; },
    cancelProviderLink() {},
  };
  const api = createAccountApi('/api', async (url, init) => {
    const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : null;
    assert.ok(!String(init?.body ?? '').includes('Synthetic secret'));
    if (path.endsWith('/prepare')) { operation ??= body.operationId; assert.equal(body.operationId, operation);
      return Response.json({ operationId: operation, state: 'prepared', attachmentsPending: false, receiptToken: 'x'.repeat(43), summary: { childCount: 1 }, expiresAt: '2099-01-01T00:00:00Z' }); }
    if (path.endsWith('/delete')) { writes++; if (deleteMode === 'unknown') throw new Error('Synthetic response loss');
      return Response.json({ operationId: operation, state: 'completed', attachmentsPending: false }); }
    if (path.includes('/deletion/')) return Response.json({ operationId: operation, state: 'prepared', attachmentsPending: false });
    const id = new Headers(init?.headers).get('x-expected-user-id');
    return Response.json({ enabled: true, registration: 'invite', mailConfigured: true, policyVersion: SERVICE_POLICY_VERSION, notice: 'Synthetic',
      user: { id, emailVerified: true, acknowledged: true, acknowledgementVersion: SERVICE_POLICY_VERSION } });
  }, identity);
  const owner = new AccountServiceOwner('/api', true, () => { completed++; }, () => {}, { api, reauthentication: identity });
  return { owner, api, writes: () => writes, completed: () => completed, auth(value: typeof auth) { auth = value; }, mode(value: string) { deleteMode = value; },
    links: () => links, preparations: () => preparations,
    async prepare() { owner.syncContext('synthetic-a', true, 'a:1'); await turn(); await owner.prepareDeletion(); } };
}

test('provider login and account deletion reuse the confirmed session and original receipt without a synthetic password', async () => {
  const user = { id: 'synthetic-a', name: 'Synthetic', email: 'synthetic@example.test' };
  let signedIn = false, providerCalls = 0;
  const records = createRecordsApi('/api', async url => {
    if (String(url).endsWith('/auth/get-session')) return Response.json(signedIn ? { user } : null);
    if (String(url).endsWith('/children')) return Response.json({ children: [] });
    throw new Error('Unexpected business request');
  }, { authenticate: async () => { throw new Error('Password path must not run'); }, observeSession() {}, clearSession: async () => {},
    authenticateProvider: async (provider, abort) => { assert.equal(provider, 'google.com'); assert.equal(abort.aborted, false); providerCalls++; signedIn = true; } });
  const controller = new RecordsController(records);
  try {
    await controller.restoreSession(); await controller.authenticateProvider('google.com');
    assert.equal(controller.getSnapshot().auth, 'signedIn'); assert.deepEqual(controller.getSnapshot().user, user); assert.equal(providerCalls, 1);
  } finally { controller.dispose(); }
  const proof = { provider: 'google.com' as const }, f = fixture(proof);
  try {
    f.owner.syncContext('synthetic-a', true, 'a:1'); await turn();
    assert.deepEqual(f.owner.getSnapshot().authenticationMethods?.providers, ['google.com']);
    await f.owner.linkProvider('apple.com', true); assert.equal(f.links(), 0);
    await f.owner.prepareProviderLink(proof); assert.equal(f.preparations(), 1); assert.equal(f.links(), 0);
    await f.owner.linkProvider('apple.com', false); assert.equal(f.links(), 0);
    await f.owner.linkProvider('apple.com', true); assert.equal(f.links(), 1);
    assert.deepEqual(f.owner.getSnapshot().authenticationMethods?.providers, ['google.com', 'apple.com']);
    await f.owner.prepareDeletion(); await f.owner.verifyDeletionIdentity(proof);
    assert.ok(f.owner.getSnapshot().deletionVerification.expiresAtMs); assert.equal(f.writes(), 0);
    await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 1); assert.equal(f.completed(), 1);
    assert.equal(JSON.stringify(f.owner.getSnapshot()).includes('Synthetic secret'), false);
  } finally { f.owner.dispose(); }
});

test('provider login explains safe failures while unconfirmed exchange and session reads stay unknown', async () => {
  const failures = [
    ['auth_popup_blocked', 400, '登入視窗被瀏覽器阻擋。請允許此網站開啟彈出視窗，再親自按登入。'],
    ['authentication_cancelled', 400, '已取消第三方登入。你可以重新選擇登入方式。'],
    ['auth_account_link_required', 409, '這個電郵已使用另一種登入方式。請先以原有方式登入，再到帳戶設定連結 Google 或 Apple。'],
    ['auth_credential_in_use', 409, '這個第三方身份已連結至另一個帳戶。請以該身份登入原帳戶，或選擇其他身份。'],
    ['auth_provider_already_linked', 409, '這個登入方式已連結至本人帳戶。請重新讀取登入狀態及帳戶的登入方式。'],
    ['auth_provider_disabled', 503, '網站尚未啟用所選登入方式。請改用已可用方式，或聯絡管理員啟用。'],
    ['auth_domain_not_allowed', 503, '目前網址未獲身份服務允許。請使用正式網站，或聯絡管理員核對登入網域設定。'],
  ] as const;
  for (const [code, status, notice] of failures) {
    const records = createRecordsApi('/api', async () => Response.json(null), {
      authenticate: async () => {}, observeSession() {}, clearSession: async () => {},
      authenticateProvider: async () => { const error = new ClientApiError(status, code); error.message = 'Raw SDK body must stay hidden'; throw error; },
    });
    const controller = new RecordsController(records);
    try {
      await controller.restoreSession(); await controller.authenticateProvider('google.com');
      assert.equal(controller.getSnapshot().auth, 'signedOut', code); assert.equal(controller.getSnapshot().notice, notice, code);
    } finally { controller.dispose(); }
  }
  for (const boundary of ['exchange', 'session'] as const) {
    let authenticated = false;
    const records = createRecordsApi('/api', async () => authenticated
      ? Response.json({ error: { code: 'auth_provider_disabled' } }, { status: 503 }) : Response.json(null), {
      authenticate: async () => {}, observeSession() {}, clearSession: async () => {},
      authenticateProvider: async () => { if (boundary === 'exchange') throw new ClientApiError(); authenticated = true; },
    });
    const controller = new RecordsController(records);
    try {
      await controller.restoreSession(); await controller.authenticateProvider('google.com');
      assert.equal(controller.getSnapshot().auth, 'unavailable');
      assert.equal(controller.getSnapshot().notice, '登入或註冊結果未能確認，請先重新檢查登入狀態。');
    } finally { controller.dispose(); }
  }
});

test('owner exposes verification only after the true port resolves and cannot submit from a password-shaped string', async () => {
  const f = fixture(); try {
    await f.prepare(); await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 0);
    let resolve!: () => void; f.auth(() => new Promise<void>(done => { resolve = done; }));
    const verify = f.owner.verifyDeletionIdentity('Synthetic secret');
    assert.equal(f.owner.getSnapshot().busy, 'verify'); assert.equal(f.owner.getSnapshot().deletionVerification.expiresAtMs, null);
    await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 0);
    resolve(); await verify; assert.ok(f.owner.getSnapshot().deletionVerification.expiresAtMs);
    assert.equal(f.writes(), 0); assert.ok(!JSON.stringify(f.owner.getSnapshot()).includes('Synthetic secret'));
    await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 1); assert.equal(f.completed(), 1);
    assert.equal(f.owner.getSnapshot().deletionVerification.expiresAtMs, null);
  } finally { f.owner.dispose(); }
});

test('cancel can interrupt identity verification and late success cannot unlock a replacement confirmation', async () => {
  const f = fixture(); try {
    await f.prepare(); let resolve!: () => void; f.auth(() => new Promise<void>(done => { resolve = done; }));
    const verify = f.owner.verifyDeletionIdentity('Synthetic secret'); await f.owner.cancelPreparedDeletion();
    assert.equal(f.owner.getSnapshot().deletion.phase, 'idle'); await f.owner.prepareDeletion();
    resolve(); await verify;
    assert.equal(f.owner.getSnapshot().deletionVerification.expiresAtMs, null); await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 0);
  } finally { f.owner.dispose(); }
});

test('identity generation and offline boundaries clear a successful proof; expired proof fails before writing', async t => {
  const f = fixture(); try {
    await f.prepare(); await f.owner.verifyDeletionIdentity('Synthetic secret');
    f.owner.syncContext('synthetic-a', false, 'a:1'); assert.equal(f.api.deletionVerification(), null);
    f.owner.syncContext('synthetic-a', true, 'a:1'); await f.owner.verifyDeletionIdentity('Synthetic secret');
    f.owner.syncContext('synthetic-a', true, 'a:2'); await turn(); assert.equal(f.api.deletionVerification(), null);
    assert.equal(f.owner.getSnapshot().deletion.phase, 'unknown'); await f.owner.checkDeletion();
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    await f.owner.verifyDeletionIdentity('Synthetic secret'); now += ACCOUNT_DELETION_VERIFICATION_MS;
    await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 0); assert.equal(f.owner.getSnapshot().deletionVerification.expiresAtMs, null);
  } finally { f.owner.dispose(); }
});

test('unknown deletion stays on the original receipt and needs a fresh verification after recovery', async () => {
  const f = fixture(); try {
    await f.prepare(); await f.owner.verifyDeletionIdentity('Synthetic secret'); f.mode('unknown'); await f.owner.executeDeletion('永久刪除我的帳戶');
    assert.equal(f.owner.getSnapshot().deletion.phase, 'unknown'); await f.owner.verifyDeletionIdentity('Synthetic secret'); await f.owner.cancelPreparedDeletion();
    assert.equal(f.writes(), 1); await f.owner.checkDeletion(); assert.equal(f.owner.getSnapshot().deletion.phase, 'prepared');
    await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 1);
    await f.owner.verifyDeletionIdentity('Synthetic secret'); f.mode('success'); await f.owner.executeDeletion('永久刪除我的帳戶'); assert.equal(f.writes(), 2);
  } finally { f.owner.dispose(); }
});
