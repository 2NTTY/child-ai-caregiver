import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarReserveInputForPolicy, avatarReserveInputSchema, avatarStateSchema, avatarTargetSchema,
  avatarUploadSchema, type AvatarPolicy, type AvatarUpload } from '../src/shared/avatars.ts';
import { AvatarApiError, createAvatarApi } from '../src/client/avatars-api.ts';

const id = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333';
const now = '2026-10-23T00:00:00.000Z';
const policy: AvatarPolicy = { policyId: 'synthetic-v1', acceptedMimeTypes: ['image/jpeg', 'image/png'], maxInputBytes: 1024,
  maxInputPixels: 1024, maxInputDimension: 64, outputSize: 16, maxOutputBytes: 1024, maxCropZoom: 8 };
const input = { expectedVersion: 0, policyId: policy.policyId, mimeType: 'image/png' as const, bytes: 24,
  sha256: 'a'.repeat(64), crop: { centerX: .5, centerY: .5, zoom: 1 } };
const upload: AvatarUpload = { id, target: { kind: 'self' }, expectedVersion: 0, policyId: policy.policyId,
  state: 'reserved', expiresAt: now, normalized: null, errorCode: null };
const signal = () => new AbortController().signal;

test('avatar wire is strict, policy-bound and keeps monotone tombstone semantics', () => {
  assert.equal(avatarTargetSchema.safeParse({ kind: 'self', childId }).success, false);
  assert.equal(avatarReserveInputSchema.safeParse({ ...input, opId: id }).success, false);
  assert.equal(avatarReserveInputForPolicy(policy).safeParse(input).success, true);
  for (const change of [{ crop: { ...input.crop, zoom: 9 } }, { bytes: 1025 }, { policyId: 'other' }, { crop: { ...input.crop, centerX: Infinity } }])
    assert.equal(avatarReserveInputForPolicy(policy).safeParse({ ...input, ...change }).success, false);
  assert.equal(avatarStateSchema.safeParse({ target: { kind: 'self' }, version: 1, asset: null, updatedAt: now, canManage: true }).success, true);
  assert.equal(avatarStateSchema.safeParse({ target: { kind: 'self' }, version: 0, asset: null, updatedAt: now, canManage: true }).success, false);
  assert.equal(avatarUploadSchema.safeParse({ ...upload, state: 'ready' }).success, false);
});

test('self reserve loss is reconciled with original operation and no child path', async () => {
  let submission: any, submitCount = 0, lookups = 0;
  const fetcher: typeof fetch = async (raw, init) => {
    const url = String(raw); assert.equal((init?.headers as Record<string, string>)['x-expected-user-id'], 'synthetic-user');
    if (url.endsWith('/online/context')) { assert.equal(JSON.parse(String(init?.body)).path, '/api/me/avatar/uploads'); return Response.json({ workspaceId: id, storageEpoch: epoch }); }
    if (url.endsWith('/online/submit')) { submitCount++; submission = JSON.parse(String(init?.body)); throw new Error('synthetic lost response'); }
    if (url.includes('/online/operations/')) {
      lookups++; assert.ok(url.endsWith(submission.operation.opId));
      return Response.json({ state: 'confirmed', path: submission.path, operation: submission.operation, changeSeq: '0', statusCode: 201, result: { upload } });
    }
    throw new Error('unexpected request');
  };
  const api = createAvatarApi('', fetcher);
  await assert.rejects(api.reserve({ kind: 'self' }, input, signal(), 'synthetic-user'), AvatarApiError);
  assert.equal(api.hasPendingOnline({ kind: 'self' }), true);
  assert.equal(api.hasPendingOnline({ kind: 'child', childId }), false);
  const recovered = await api.reconcilePending({ kind: 'self' }, signal(), 'synthetic-user');
  assert.equal(recovered?.state, 'confirmed');
  assert.equal(submitCount, 1); assert.equal(lookups, 1); assert.equal(api.hasPendingOnline(), false);
  assert.equal('opId' in submission.payload, false);
});

test('avatar late identity results, wrong target and unavailable are never accepted as empty', async () => {
  let deliver!: (response: Response) => void;
  const api = createAvatarApi('', async () => await new Promise<Response>(resolve => { deliver = resolve; }));
  const pending = api.read({ kind: 'self' }, signal(), 'synthetic-user');
  api.resetOnline();
  deliver(Response.json({ avatar: { target: { kind: 'self' }, version: 0, asset: null, updatedAt: null, canManage: true }, policy }));
  await assert.rejects(pending, AvatarApiError);
  const wrong = createAvatarApi('', async () => Response.json({ avatar: { target: { kind: 'child', childId }, version: 0, asset: null, updatedAt: null, canManage: true }, policy }));
  await assert.rejects(wrong.read({ kind: 'self' }, signal(), 'synthetic-user'), (error: unknown) => error instanceof AvatarApiError && error.onlineCode === 'avatar_integrity_failed');
  const absent = createAvatarApi('', async () => Response.json({ error: { code: 'avatar_unavailable' } }, { status: 503 }));
  await assert.rejects(absent.read({ kind: 'self' }, signal(), 'synthetic-user'), (error: unknown) => error instanceof AvatarApiError && error.onlineCode === 'avatar_unavailable');
});

test('real online transport preserves safe avatar conflicts and does not loop the original commit', async () => {
  for (const code of ['avatar_version_conflict', 'avatar_policy_changed']) {
    let submits = 0;
    const api = createAvatarApi('', async (raw, init) => {
      if (String(raw).endsWith('/online/context')) return Response.json({ workspaceId: id, storageEpoch: epoch });
      assert.ok(String(raw).endsWith('/online/submit')); submits++;
      const body = JSON.parse(String(init?.body)); assert.equal(body.path, code === 'avatar_version_conflict' ? '/api/me/avatar/commit' : '/api/me/avatar/uploads');
      return Response.json({ error: { code, message: 'must never be displayed', metadata: 'private synthetic sentinel' } }, { status: 409 });
    });
    const operation = code === 'avatar_version_conflict'
      ? api.commit({ kind: 'self' }, { uploadId: id, expectedVersion: 0 }, signal(), 'synthetic-user')
      : api.reserve({ kind: 'self' }, input, signal(), 'synthetic-user');
    await assert.rejects(operation, (error: unknown) => error instanceof AvatarApiError && error.status === 409 && error.onlineCode === code
      && !error.message.includes('sentinel') && !error.confirmed);
    assert.equal(api.hasPendingOnline(), false);
    assert.equal(await api.reconcilePending({ kind: 'self' }, signal(), 'synthetic-user'), null);
    assert.equal(submits, 1);
  }
});

test('ambiguous avatar operation lookup 404 retains the original operation for later confirmation', async () => {
  let submitted: any, lookupCount = 0, postCount = 0;
  const api = createAvatarApi('', async (raw, init) => {
    const path = String(raw);
    if (path.endsWith('/online/context')) return Response.json({ workspaceId: id, storageEpoch: epoch });
    if (path.endsWith('/online/submit')) { postCount++; submitted = JSON.parse(String(init?.body)); throw new Error('synthetic lost reply'); }
    assert.ok(path.endsWith('/online/operations/' + submitted.operation.opId)); lookupCount++;
    if (lookupCount === 1) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    return Response.json({ state: 'confirmed', path: submitted.path, operation: submitted.operation, changeSeq: '0', statusCode: 200,
      result: { avatar: { target: { kind: 'self' }, version: 1, asset: null, updatedAt: now, canManage: true }, cleanupPending: true } });
  });
  await assert.rejects(api.remove({ kind: 'self' }, { expectedVersion: 0, confirmRemove: true }, signal(), 'synthetic-user'), AvatarApiError);
  await assert.rejects(api.reconcilePending({ kind: 'self' }, signal(), 'synthetic-user'), (error: unknown) => error instanceof AvatarApiError && error.status === 404);
  assert.equal(api.hasPendingOnline(), true);
  const result = await api.reconcilePending({ kind: 'self' }, signal(), 'synthetic-user');
  assert.equal(result?.state, 'confirmed'); assert.equal(result?.state === 'confirmed' && result.kind, 'remove');
  assert.equal(api.hasPendingOnline(), false); assert.equal(postCount, 1); assert.equal(lookupCount, 2);
});

test('real avatar lookup identity change safely propagates its fixed code and clears the old operation', async () => {
  let posts = 0, operation: any;
  const api = createAvatarApi('', async (raw, init) => {
    if (String(raw).endsWith('/online/context')) return Response.json({ workspaceId: id, storageEpoch: epoch });
    if (String(raw).endsWith('/online/submit')) { posts++; operation = JSON.parse(String(init?.body)).operation; throw new Error('synthetic lost reply'); }
    assert.ok(String(raw).endsWith('/online/operations/' + operation.opId));
    return Response.json({ error: { code: 'identity_changed', message: 'private synthetic sentinel' } }, { status: 409 });
  });
  await assert.rejects(api.commit({ kind: 'self' }, { uploadId: id, expectedVersion: 0 }, signal(), 'synthetic-user'));
  await assert.rejects(api.reconcilePending({ kind: 'self' }, signal(), 'synthetic-user'), (error: unknown) => error instanceof AvatarApiError
    && error.status === 409 && error.onlineCode === 'identity_changed' && !error.message.includes('sentinel'));
  assert.equal(api.hasPendingOnline(), false); assert.equal(posts, 1);
});
