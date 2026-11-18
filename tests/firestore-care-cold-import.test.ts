import assert from 'node:assert/strict';
import test from 'node:test';

// Keep care as the first application import in this test process.
test('a cold care import exposes a usable profile schema without preloading document stores', async () => {
  const { firestoreProfileSchema } = await import('../server/firestore-care.ts');
  const profile = { childId: '00000000-0000-4000-8000-000000000001', version: 0,
    data: null, confirmedBy: null, confirmedAt: null, reason: null };
  assert.deepEqual(firestoreProfileSchema.parse(profile), profile);
});
