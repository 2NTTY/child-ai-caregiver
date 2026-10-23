import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountApiError, createAccountApi, ACCOUNT_DELETION_VERIFICATION_MS } from '../src/client/account-api.ts';

const signal = () => new AbortController().signal;
const confirmation = '永久刪除我的帳戶';
const password = 'Synthetic reauth password only';
const denied = (code: string) => (error: unknown) => error instanceof AccountApiError && error.code === code;
function fixture({ available = true } = {}) {
  let operation: string | null = null, authCalls = 0, mode = 'success', receiptState = 'prepared';
  let auth: () => Promise<void> = async () => {};
  const writes: Record<string, unknown>[] = [], reads: string[] = [];
  const api = createAccountApi('/api', async (url, init) => {
    const path = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
    assert.ok(!String(init?.body ?? '').includes(password), 'Business API must never receive the password');
    assert.ok(!String(init?.body ?? '').includes('Synthetic provider token'), 'Provider proof must not enter deletion payloads');
    if (path.endsWith('/prepare')) {
      operation ??= body.operationId; assert.equal(body.operationId, operation);
      return Response.json({ operationId: operation, state: receiptState, attachmentsPending: false, receiptToken: 'x'.repeat(43), summary: { childCount: 2 }, expiresAt: '2099-01-01T00:00:00Z' });
    }
    if (path.endsWith('/delete')) {
      writes.push(body);
      if (mode === 'unknown') throw new TypeError('Synthetic response loss');
      if (mode === 'server_reauth') return Response.json({ error: { code: 'recent_reauthentication_required' } }, { status: 401 });
      return Response.json({ operationId: operation, state: 'completed', attachmentsPending: false });
    }
    reads.push(path);
    return Response.json({ operationId: operation, state: receiptState, attachmentsPending: false });
  }, available ? { reauthenticate: async (userId, secret, abort) => { authCalls++; assert.equal(userId, 'synthetic-a'); assert.equal(secret, password); assert.equal(abort.aborted, false); await auth(); } } : undefined);
  api.setIdentity('synthetic-a');
  return { api, writes, reads, setAuth(value: typeof auth) { auth = value; }, setMode(value: string) { mode = value; },
    setReceipt(value: string) { receiptState = value; }, authCalls: () => authCalls, operation: () => operation };
}

test('final deletion is locked until real auth port succeeds, then consumes one original-operation proof without secrets', async () => {
  const f = fixture(); await f.api.prepareDeletion('synthetic-a', signal());
  await assert.rejects(f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal()), denied('recent_reauthentication_required'));
  f.setAuth(async () => { throw new Error('Synthetic wrong password'); });
  await assert.rejects(f.api.verifyDeletionIdentity('synthetic-a', password, signal()), denied('password_verification_failed'));
  assert.equal(f.api.deletionVerification(), null); assert.equal(f.writes.length, 0);
  let resolve!: () => void; f.setAuth(() => new Promise<void>(done => { resolve = done; }));
  const pending = f.api.verifyDeletionIdentity('synthetic-a', password, signal());
  assert.equal(f.api.deletionVerification(), null); assert.equal(f.writes.length, 0);
  resolve(); const proof = await pending; assert.ok(proof.expiresAtMs > Date.now()); assert.equal(f.writes.length, 0);
  await f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal());
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ['confirmation', 'operationId', 'receiptToken']);
  assert.equal(f.writes[0].operationId, f.operation()); assert.equal(f.authCalls(), 2);
  assert.equal(f.api.deletionVerification(), null);
  await assert.rejects(f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal()), denied('recent_reauthentication_required'));
  assert.equal(f.writes.length, 1);
});

test('proof expires locally and remains subject to Server recent auth rejection', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture(); await f.api.prepareDeletion('synthetic-a', signal()); await f.api.verifyDeletionIdentity('synthetic-a', password, signal());
  now += ACCOUNT_DELETION_VERIFICATION_MS;
  await assert.rejects(f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal()), denied('recent_reauthentication_required'));
  assert.equal(f.writes.length, 0);
  await f.api.verifyDeletionIdentity('synthetic-a', password, signal()); f.setMode('server_reauth');
  await assert.rejects(f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal()), denied('recent_reauthentication_required'));
  assert.equal(f.api.deletionVerification(), null);
  await f.api.verifyDeletionIdentity('synthetic-a', password, signal());
  assert.equal(f.writes.length, 1);
});

test('cancel, new preparation and identity changes revoke proofs and reject late auth results', async () => {
  for (const boundary of ['cancel', 'prepare', 'identity', 'abort']) {
    const f = fixture(); await f.api.prepareDeletion('synthetic-a', signal());
    let resolve!: () => void; f.setAuth(() => new Promise<void>(done => { resolve = done; })); const controller = new AbortController();
    const pending = f.api.verifyDeletionIdentity('synthetic-a', password, controller.signal);
    if (boundary === 'cancel') await f.api.discardPreparedDeletion('synthetic-a', signal());
    if (boundary === 'prepare') await f.api.prepareDeletion('synthetic-a', signal());
    if (boundary === 'identity') { f.api.setIdentity('synthetic-b'); f.api.setIdentity('synthetic-a'); }
    if (boundary === 'abort') controller.abort();
    resolve(); await assert.rejects(pending, denied('session_changed'));
    assert.equal(f.api.deletionVerification(), null); assert.equal(f.writes.length, 0);
  }
});

test('unknown execution cannot be reauthenticated or resent; receipt check resumes the same operation', async () => {
  const f = fixture(); const prepared = await f.api.prepareDeletion('synthetic-a', signal());
  await f.api.verifyDeletionIdentity('synthetic-a', password, signal()); f.setMode('unknown');
  await assert.rejects(f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal()));
  await assert.rejects(f.api.verifyDeletionIdentity('synthetic-a', password, signal()), denied('check_original_erasure'));
  await assert.rejects(f.api.executeDeletion('synthetic-a', { password, confirmation }, signal()), denied('check_original_erasure'));
  await assert.rejects(f.api.discardPreparedDeletion('synthetic-a', signal()), denied('check_original_erasure'));
  await f.api.prepareDeletion('synthetic-a', signal());
  await assert.rejects(f.api.verifyDeletionIdentity('synthetic-a', password, signal()), denied('check_original_erasure'));
  assert.equal(f.writes.length, 1);
  await f.api.deletionStatus(prepared, signal()); await f.api.prepareDeletion('synthetic-a', signal(), prepared.operationId);
  await f.api.verifyDeletionIdentity('synthetic-a', password, signal()); f.setMode('success');
  await f.api.executeVerifiedDeletion('synthetic-a', confirmation, signal());
  assert.equal(f.writes.length, 2); assert.equal(f.writes[0].operationId, f.writes[1].operationId);
});

test('unavailable provider cannot use a fake password gate', async () => {
  const f = fixture({ available: false }); await f.api.prepareDeletion('synthetic-a', signal());
  assert.equal(f.api.canVerifyDeletionIdentity(), false);
  await assert.rejects(f.api.verifyDeletionIdentity('synthetic-a', password, signal()), denied('reauthentication_unavailable'));
  assert.equal(f.authCalls(), 0); assert.equal(f.writes.length, 0);
});
