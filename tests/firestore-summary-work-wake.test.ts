import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { privateSummaryWorkSchema } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import type { SummaryWorkPolicyPort } from '../server/firestore-private-summary-work.ts';

async function start(f: Awaited<ReturnType<typeof fixture>>) {
  await f.barrier(); const result = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  if (result.kind !== 'created') throw new Error('Expected work'); await f.saveAll(); return result.work;
}

test('authoritative completion durably records a bounded pending scope wake when no scheduler policy exists', async () => {
  const f = await fixture(), work = await start(f);
  await f.withWorkLease(work.id, async reference => {
    const result = await f.build().claimPart('owner', f.childId, work.id, reference); assert.equal(result.decision, 'lookup');
    const saved = await f.build().readState('owner', f.childId, work.id);
    const expected = { id: firestoreDomainHash(['private-summary-completion-wake/v1', work.id, result.attempt.id]),
      receiptHash: firestoreDomainHash(result.attempt.receipt), scheduling: { kind: 'pending_schedule' } };
    assert.deepEqual(saved.work.completionWake, expected);
    assert.equal(privateSummaryWorkSchema.safeParse({ ...saved.work, completionWake: null }).success, false);
    assert.equal(privateSummaryWorkSchema.safeParse({ ...saved.work, completionWake: { ...expected, receiptHash: 'f'.repeat(64) } }).success, false);
    assert.equal(privateSummaryWorkSchema.safeParse({ ...work, completionWake: expected }).success, false);
    const before = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.build().scheduleCompletionWake('owner', f.childId, work.id), expected);
    assert.equal(JSON.stringify([...f.fake.records]), before); assert.equal(f.resolutions(), 1);
  });
});

test('pending completion wake is atomically queued under a distinct identity and duplicate scheduling preserves its original due time', async () => {
  const f = await fixture(), work = await start(f), dueAt = new Date(Date.now() + 60000).toISOString(); let schedules = 0;
  const policy: SummaryWorkPolicyPort = { ...f.policy, async resolveWakeDueAt() { schedules++; return { kind: 'due', dueAt }; } };
  await f.withWorkLease(work.id, async reference => { await f.build().claimPart('owner', f.childId, work.id, reference); });
  f.fake.retry(); const queued = await f.build(policy).scheduleCompletionWake('owner', f.childId, work.id);
  const scheduling = queued.scheduling;
  assert.equal(scheduling.kind, 'queued'); assert.equal(scheduling.dueAt, dueAt); assert.equal(schedules, 2);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const job = f.data.open('background-work', scheduling.jobId, b.scope, firestoreBackgroundWorkSchema,
      await b.transaction.get(f.data.ref('background_work', 'background-work', scheduling.jobId)));
    assert.equal(job.resourceId, f.childId); assert.equal(job.kind, 'memory-refresh'); assert.equal(job.basis, 'summary-completion:v1:' + queued.id);
    assert.equal(job.dueAt, dueAt); assert.equal(job.generation, work.workerGeneration); assert.equal(job.authorizationVersion, work.authorizationVersion);
  });
  const before = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.build(policy).scheduleCompletionWake('owner', f.childId, work.id), queued);
  assert.equal(schedules, 2); assert.equal(JSON.stringify([...f.fake.records]), before); assert.equal(f.resolutions(), 1);
});

test('wake scheduling abort leaves pending, lost acknowledgement recovers original outbox and same-transaction completion can queue immediately', async () => {
  const f = await fixture(), work = await start(f), policy: SummaryWorkPolicyPort = { ...f.policy,
    async resolveWakeDueAt() { return { kind: 'due', dueAt: new Date().toISOString() }; } };
  await f.withWorkLease(work.id, async reference => { await f.build().claimPart('owner', f.childId, work.id, reference); });
  const before = JSON.stringify([...f.fake.records]); f.fake.failCommit();
  await assert.rejects(f.build(policy).scheduleCompletionWake('owner', f.childId, work.id), /Synthetic transaction commit failed/u);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.loseReply(); await assert.rejects(f.build(policy).scheduleCompletionWake('owner', f.childId, work.id), /Synthetic lost commit acknowledgement/u);
  const after = JSON.stringify([...f.fake.records]); const wake = await f.build(policy).scheduleCompletionWake('owner', f.childId, work.id);
  assert.equal(wake.scheduling.kind, 'queued'); assert.equal(JSON.stringify([...f.fake.records]), after);
  const other = await fixture(), fresh = await start(other); const immediate: SummaryWorkPolicyPort = { ...other.policy, resolveWakeDueAt: policy.resolveWakeDueAt };
  await other.withWorkLease(fresh.id, async reference => {
    await other.build(immediate).claimPart('owner', other.childId, fresh.id, reference);
    const result = await other.build().scheduleCompletionWake('owner', other.childId, fresh.id);
    assert.equal(result.scheduling.kind, 'queued', 'The committed completion already contains its outbox without calling the missing resolver');
  });
});
