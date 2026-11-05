import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreBackgroundMaintenance } from '../server/firestore-background-maintenance.ts';
import { contentErasureSchema } from '../server/firestore-content-erasure.ts';
import { summaryErasureFixture } from './helpers/summary-erasure-fixture.ts';

test('the real maintenance tick advances every content and private-summary erasure stage', async () => {
  for (const [stage, next] of [['source_history', 'receipts'], ['summary_revisions', 'summary_attempts'],
    ['summary_attempts', 'done'], ['done', 'summary_attempts']] as const) {
    const f = await summaryErasureFixture();
    const job = { intent: f.intent, journal: f.descriptor, stage, after: null };
    f.store('content_erasures', 'content-erasure', f.intent.operationId, contentErasureSchema, job, f.scope, { stage });
    const maintenance = createFirestoreBackgroundMaintenance({ ...f.options, enabled: true, journal: f.journal,
      knowledge: { async jobs() { return []; } } as never,
      photos: {} as never, erasures: {} as never, cleanup: {} as never });
    assert.equal(await maintenance.tick(), 1, `The ${stage} row must be selected by the actual dispatcher query`);
    const saved = await f.fake.database.runTransaction(async tx => f.data.open('content-erasure', f.intent.operationId,
      f.scope, contentErasureSchema, await tx.get(f.data.ref('content_erasures', 'content-erasure', f.intent.operationId))));
    assert.equal(saved.stage, next);
    if (next === 'done') assert.equal(saved.privateSummaryComplete, true);
  }
});
