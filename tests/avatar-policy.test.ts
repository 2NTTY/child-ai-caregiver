import test from 'node:test';
import assert from 'node:assert/strict';
import { readAvatarConfig } from '../server/avatar-config.ts';
import { avatarBinding, avatarHeadRecordSchema, avatarUploadRecordSchema, AVATAR_NIL } from '../server/avatar-data.ts';
import { avatarAdmissionPlan, expireAvatarUpload, avatarPublicState, assertAvatarHeadWritable } from '../server/avatar-policy.ts';

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const config = readAvatarConfig({}), now = Date.parse('2026-10-23T00:00:00Z');
const binding = avatarBinding({ ownerUserId: 'synthetic-owner', workspaceId: id(1), childId: AVATAR_NIL, storageEpoch: id(2) }, { kind: 'self' });
const head = avatarHeadRecordSchema.parse({ binding, version: 0, descriptor: null, updatedAt: null, reservationNonce: id(3), erasedThroughVersion: null, removal: null });
function reserved(n: number, expired = false) {
  return avatarUploadRecordSchema.parse({ id: id(n), assetId: id(n + 20), binding, actorUserId: 'synthetic-owner', reservationOperationId: id(n + 40),
    expectedVersion: 0, createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + (expired ? -1 : 1000)).toISOString(),
    mimeType: 'image/png', bytes: 8, sha256: 'a'.repeat(64), crop: { centerX: .5, centerY: .5, zoom: 1 },
    policyId: config.policy.policyId, recipe: config.recipe, admission: config.admission,
    state: 'reserved', lease: null, preparedAsset: null, descriptor: null, committedVersion: null, errorCode: null });
}
test('pending admission counts live actor-target rows and expires unopened rows without TTL deletion', () => {
  const rows = [reserved(4), reserved(5, true)];
  const plan = avatarAdmissionPlan(rows, 'synthetic-owner', head, now, 2);
  assert.equal(plan.pending, 1); assert.equal(plan.expired.length, 1); assert.equal(plan.expired[0].state, 'expired');
  assert.equal(rows[1].state, 'reserved');
  assert.throws(() => avatarAdmissionPlan(rows, 'another-actor', head, now, 2));
  assert.throws(() => avatarAdmissionPlan(Array.from({ length: 9 }, (_, n) => reserved(100 + n)), 'synthetic-owner', head, now, 2));
});
test('unknown processing lease remains admitted after both upload expiry and lease expiry', () => {
  const row = avatarUploadRecordSchema.parse({ ...reserved(6, true), state: 'processing', lease: { token: id(7), generation: id(8),
    authorizationVersion: '1', childAccessVersion: '2', acquiredAt: new Date(now - 1000).toISOString(), until: new Date(now - 1).toISOString() } });
  assert.equal(expireAvatarUpload(row, now).state, 'processing');
  assert.equal(avatarAdmissionPlan([row], 'synthetic-owner', head, now, 1).pending, 1);
});
test('initial head and versioned empty tombstone are distinct and stale writes fail', () => {
  assert.equal(avatarPublicState(head, true).version, 0);
  const tombstone = { ...head, version: 2, updatedAt: new Date(now).toISOString(), erasedThroughVersion: 1 };
  assert.deepEqual(avatarPublicState(tombstone, true).asset, null);
  assert.throws(() => assertAvatarHeadWritable(tombstone, 0));
  assert.doesNotThrow(() => assertAvatarHeadWritable(tombstone, 2));
});

test('ingress caps are acquired before body parsing and release is idempotent', async () => {
  const { createAvatarIngress } = await import('../server/avatar-ingress.ts');
  const ingress = createAvatarIngress({ ...config.admission, decodeConcurrency: 1, queueLimit: 0 });
  const one = ingress.acquire('synthetic-actor-target');
  assert.throws(() => ingress.acquire('synthetic-actor-target'));
  assert.throws(() => ingress.acquire('another-actor-target'));
  one.consume(); assert.throws(() => one.consume()); one.release(); one.release();
  assert.deepEqual(ingress.state(), { admitted: 0, limit: 1 });
  const second = ingress.acquire('another-actor-target'); second.release(); assert.throws(() => second.consume());
});

test('response deadline does not release admission while the underlying pipeline is unresolved', async () => {
  const { holdAvatarPipeline } = await import('../server/avatar-response-deadline.ts');
  let releases = 0, settle!: (value: string) => void;
  const pipeline = holdAvatarPipeline<string>(() => { releases++; });
  const controller = new AbortController();
  const response = pipeline.execute(controller.signal, () => new Promise(resolve => { settle = resolve; }));
  controller.abort();
  await assert.rejects(response); pipeline.release(); assert.equal(releases, 0);
  settle('late result not disclosed'); await Promise.resolve(); assert.equal(releases, 1);
});
