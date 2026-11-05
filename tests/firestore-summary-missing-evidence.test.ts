import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryTerminalFixture as fixture } from './helpers/private-summary-terminal.ts';
import { privateSummaryUsageSchema } from '../server/private-summary-work.ts';

// Removing either original record must never turn an existing claim into fresh execution.
// These are direct negative checks of existing guards, not a new recovery protocol.
for (const missing of ['revision', 'active attempt'] as const) {
  for (const entry of ['claimPart', 'reservePart'] as const) {
    test(`${entry} rejects a missing original ${missing} without replacing execution or charging usage`, async () => {
      const f = await fixture();
      await f.withWorkLease(f.work.id, async reference => {
        const p = await f.claim(f.work, reference);
        await f.root.open(p.context);
        const original = await f.build().readState('owner', f.childId, f.work.id);
        assert.equal(original.work.activeAttemptId, p.input.attemptId);
        assert.equal(p.claimed.decision, 'execute');
        assert.deepEqual(original.usage.used, { modelCalls: 0, toolCalls: 0 });
        const originalRoot = await f.root.read(p.context);
        assert.equal(await f.daily.read(p.input.originalDailyRequest), null);

        const missingRef = missing === 'revision'
          ? f.data.ref('private_summary_revisions', 'private-summary-revision', original.work.sourceRevisionId)
          : f.data.ref('private_summary_attempts', 'private-summary-attempt', original.work.activeAttemptId!);
        assert.equal(f.fake.records.delete(missingRef.path), true, 'Remove only the original persisted evidence');
        const before = JSON.stringify([...f.fake.records]);
        const resolutions = f.resolutions();
        let executionPermits = 0;
        await assert.rejects(async () => {
          const decision = entry === 'claimPart'
            ? (await f.build().claimPart('owner', f.childId, f.work.id, reference)).decision
            : await f.build().reservePart(p.input);
          if (decision === 'execute') executionPermits++;
        }, { code: missing === 'active attempt' ? 'not_found'
          : entry === 'claimPart' ? 'private_summary_binding' : 'private_summary_attempt_binding' });

        assert.equal(executionPermits, 0, 'No execution or provider-dispatch permit may escape the domain guard');
        assert.equal(JSON.stringify([...f.fake.records]), before,
          'No replacement run, grant, attempt, reservation, or other persistent write is allowed');
        assert.equal(f.resolutions(), resolutions, 'Missing evidence must not resolve a fresh work grant');
        const usage = await f.authority.runTransaction('owner', f.childId, async b => f.data.open(
          'private-summary-usage', f.work.id, b.scope, privateSummaryUsageSchema,
          await b.transaction.get(f.data.ref('private_summary_usage', 'private-summary-usage', f.work.id))));
        assert.deepEqual(usage, original.usage, 'Preserve the complete original usage ledger');
        assert.deepEqual(await f.root.read(p.context), originalRoot);
        assert.equal(await f.daily.read(p.input.originalDailyRequest), null);
        assert.equal(f.fake.records.has(missingRef.path), false, 'Do not reconstruct the missing evidence');
      });
    });
  }
}
