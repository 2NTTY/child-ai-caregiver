import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountServiceOwner } from '../../production/AccountServiceOwner.ts';
import { createAccountApi, ACCOUNT_DELETION_VERIFICATION_MS } from '../../../../src/client/account-api.ts';
import { SERVICE_POLICY_VERSION } from '../../../../src/shared/account-service.ts';
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let auth: () => Promise<void> = async () => {}, deleteMode = 'success', operation: string | null = null, writes = 0, completed = 0;
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
  }, { reauthenticate: async () => { await auth(); } });
  const owner = new AccountServiceOwner('/api', true, () => { completed++; }, () => {}, { api });
  return { owner, api, writes: () => writes, completed: () => completed, auth(value: typeof auth) { auth = value; }, mode(value: string) { deleteMode = value; },
    async prepare() { owner.syncContext('synthetic-a', true, 'a:1'); await turn(); await owner.prepareDeletion(); } };
}

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
