import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFirebaseAvatarRequest, type FirebaseAvatarApiPort } from '../server/firebase-avatar-api.ts';
import { FirestoreDomainError } from '../server/firestore-domain-data.ts';

const userId = 'synthetic-user', id = '11111111-1111-4111-8111-111111111111';
const headers = { 'x-expected-user-id': userId, 'content-type': 'application/json' };
const current = async () => true;
const rejectsCode = (code: string, status: number) => (error: unknown) => error instanceof FirestoreDomainError && error.code === code && error.status === status;
test('avatar disabled is explicit unavailable; direct mutations still require online operation', async () => {
  await assert.rejects(handleFirebaseAvatarRequest(new Request('https://synthetic.invalid/api/me/avatar', { headers }), userId, undefined, current), rejectsCode('avatar_unavailable', 503));
  await assert.rejects(handleFirebaseAvatarRequest(new Request('https://synthetic.invalid/api/me/avatar/remove', { method: 'POST', headers, body: '{}' }), userId, undefined, current), rejectsCode('operation_required', 428));
  await assert.rejects(handleFirebaseAvatarRequest(new Request('https://synthetic.invalid/api/me/avatar'), userId, undefined, current), rejectsCode('account_precondition_required', 428));
});
test('avatar content refuses over-limit streaming input before domain decoding or allocation', async () => {
  let uploaded = 0, released = 0;
  const port = { uploadAdmission: async () => ({ maxBytes: 3, totalTimeoutMs: 1000, release: () => { released++; }, upload: async () => { uploaded++; throw new Error('never'); } }) } as unknown as FirebaseAvatarApiPort;
  const request = new Request('https://synthetic.invalid/api/me/avatar/uploads/' + id + '/content', { method: 'POST', headers,
    body: JSON.stringify({ base64: 'YQ==', padding: 'x'.repeat(100) }) });
  await assert.rejects(handleFirebaseAvatarRequest(request, userId, port, current), rejectsCode('avatar_input_too_large', 413));
  assert.equal(uploaded, 0); assert.equal(released, 1);
});
test('avatar content rechecks identity after fetching and rejects duplicate version query', async () => {
  let checks = 0;
  const port = { content: async () => ({ buffer: Buffer.from('synthetic') }) } as unknown as FirebaseAvatarApiPort;
  const request = new Request('https://synthetic.invalid/api/me/avatar/content?assetId=' + id + '&version=1', { headers });
  await assert.rejects(handleFirebaseAvatarRequest(request, userId, port, async () => ++checks < 2), rejectsCode('identity_changed', 409));
  const duplicate = new Request(request.url + '&version=1', { headers });
  await assert.rejects(handleFirebaseAvatarRequest(duplicate, userId, port, current), rejectsCode('invalid_input', 400));
});
