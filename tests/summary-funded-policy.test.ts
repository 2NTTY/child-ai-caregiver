import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createFundedSummaryPolicy, parseSummarySponsor, summarySponsorMatches, type SummaryWorkerProfile } from '../server/summary-funded-policy.ts';
import type { FirestoreAuthorityTransaction } from '../server/firestore-authority.ts';

test('a cumulative work grant is explicit and bound to the original private scope, generation and expiry', () => {
  const scope = { ownerUserId: 'pilot', childId: randomUUID(), workspaceId: randomUUID(), storageEpoch: randomUUID() };
  const binding = { scope, actorUserId: scope.ownerUserId, authorizationVersion: '1', generation: randomUUID() } as FirestoreAuthorityTransaction;
  const now = Date.now();
  const source = { scope, authorizationVersion: '1', generation: binding.generation, payer: 'personal', model: 'synthetic-model',
    expiresAt: new Date(now + 60_000).toISOString(), limits: { modelCalls: 3, toolCalls: 6 } };
  const sponsor = parseSummarySponsor(JSON.stringify(source))!;
  assert.equal(parseSummarySponsor(undefined), undefined);
  assert.throws(() => parseSummarySponsor(JSON.stringify({ ...source, limits: undefined })));
  assert.equal(summarySponsorMatches(sponsor, binding, now), true);
  assert.equal(summarySponsorMatches(sponsor, { ...binding, actorUserId: 'other' }, now), false);
  assert.equal(summarySponsorMatches(sponsor, { ...binding, scope: { ...scope, childId: randomUUID() } }, now), false);
  assert.equal(summarySponsorMatches(sponsor, { ...binding, authorizationVersion: '2' }, now), false);
  assert.equal(summarySponsorMatches(sponsor, { ...binding, generation: randomUUID() }, now), false);
  assert.equal(summarySponsorMatches(sponsor, binding, now + 60_000), false);
});

test('changing the background payer, model or consent stops a sponsored scope', async () => {
  const scope = { ownerUserId: 'owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const b = { scope, actorUserId: 'owner', authorizationVersion: '1', generation: randomUUID() } as FirestoreAuthorityTransaction;
  const sponsor = { scope, authorizationVersion: '1', generation: b.generation, payer: 'personal' as const,
    model: 'chosen', expiresAt: new Date(Date.now() + 60_000).toISOString(), limits: { modelCalls: 1, toolCalls: 2 } };
  let enabled = true, model = 'chosen', payer: 'personal' | 'platform' = 'personal';
  const policy = createFundedSummaryPolicy({ sponsor, promptPackVersion: 'pilot',
    readProfile: async () => ({ enabled, selectedConfig: { model }, billingSource: payer } as SummaryWorkerProfile),
    readLegacyAdmission: async () => assert.fail('unexpected legacy read'), bind: () => assert.fail('unexpected dispatch') });
  assert.equal(await policy.availableIn!(b), true);
  payer = 'platform'; assert.equal(await policy.availableIn!(b), false);
  payer = 'personal'; model = 'changed'; assert.equal(await policy.availableIn!(b), false);
  model = 'chosen'; enabled = false; assert.equal(await policy.availableIn!(b), false);
});
