import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryScanSchema, privateSummarySuppressedSourceSchema, privateSummaryCutoverSchema,
  privateSummaryScanId, privateSummarySuppressedSourceId, privateSummaryCutoverId, privateSummaryInventoryGenesis,
  assertPrivateSummaryScanRecord } from '../server/private-summary-scan.ts';
import { summaryRestoreFixture } from './helpers/summary-restore-fixture.ts';

function records() {
  const f = summaryRestoreFixture(), common = { scope: f.scope, authorizationVersion: '1', workerGeneration: f.generation, version: 1 };
  const scan = { ...common, format: 'private-summary-scan/v1' as const, id: privateSummaryScanId(f.scope),
    repairAfterSortKey: null, repairAfterId: null, cycleUpperSortKey: null, repairWorkAfterId: null, prefer: 'fresh' as const,
    cycle: { number: 0, state: 'idle' as const, sourceBasis: null, sourceExhausted: false, workUpperDocumentId: null, workExhausted: false,
      hasUnresolvedRepair: false } };
  const target = { kind: 'fresh_message' as const, messageId: randomUUID() };
  const suppressed = { ...common, format: 'private-summary-suppressed-source/v1' as const,
    id: privateSummarySuppressedSourceId(f.scope, target), target, sourceVersion: 1, sourceBasis: 'a'.repeat(64), reason: 'source_missing' as const };
  const cutover = { ...common, format: 'private-summary-cutover/v1' as const, id: privateSummaryCutoverId(f.scope), inventoryVersion: 1,
    phase: 'inventory' as const, entryFenceVersion: 'private-summary-entry/v1' as const, upperCaptured: false, upperRunDocumentId: null,
    afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
    inventoryHash: privateSummaryInventoryGenesis(f.scope, '1', f.generation, 1), exhausted: false, restoreId: null };
  const context = (kind: string, id: string) => ({ family: 'domain' as const, kind, id, scope: f.scope,
    envelopeVersion: 1 as const, recordVersion: 1, aad: 'synthetic-authenticated-context' });
  return { f, scan, suppressed, cutover, context };
}
test('the exact scan cutover and suppression shapes retain their initial values without extra fields', () => {
  const f = records();
  assert.deepEqual(privateSummaryScanSchema.parse(f.scan), f.scan);
  assert.deepEqual(privateSummarySuppressedSourceSchema.parse(f.suppressed), f.suppressed);
  assert.deepEqual(privateSummaryCutoverSchema.parse(f.cutover), f.cutover);
  assert.equal(privateSummaryCutoverSchema.safeParse({ ...f.cutover, installed: true }).success, false);
});
test('scan codecs preserve unresolved repairs and reject wrong locator identity scope and record version', () => {
  const f = records(), context = f.context('private-summary-scan', f.scan.id);
  assertPrivateSummaryScanRecord(context, f.scan);
  assert.throws(() => assertPrivateSummaryScanRecord({ ...context, id: 'f'.repeat(64) }, f.scan));
  assert.throws(() => assertPrivateSummaryScanRecord({ ...context, scope: { ...f.f.scope, storageEpoch: randomUUID() } }, f.scan));
  assert.throws(() => assertPrivateSummaryScanRecord({ ...context, recordVersion: 2 }, f.scan));
  const completed = privateSummaryScanSchema.parse({ ...f.scan, cycle: { ...f.scan.cycle, number: 1, state: 'complete',
    sourceBasis: 'a'.repeat(64), sourceExhausted: true, workExhausted: true, hasUnresolvedRepair: true } });
  const original = f.f.codec.decode({ path: f.f.data.ref('private_summary_scans', 'private-summary-scan', completed.id).path,
    data: { ...f.f.data.tags(completed.scope), ...f.f.data.seal('private-summary-scan', completed.id, completed.scope, privateSummaryScanSchema, completed, 1) } });
  const restored = f.f.codec.transform(original, { newEpochByWorkspace: new Map(), generation: f.f.generation, photoDescriptors: new Map() });
  assert.deepEqual(privateSummaryScanSchema.parse(f.f.codec.decode(restored).value), completed);
});
test('scan and cutover schemas reject inconsistent cursors terminal claims and restore phase', () => {
  const f = records();
  assert.equal(privateSummaryScanSchema.safeParse({ ...f.scan, repairAfterId: randomUUID() }).success, false);
  assert.equal(privateSummaryScanSchema.safeParse({ ...f.scan, cycle: { ...f.scan.cycle, state: 'complete' } }).success, false);
  assert.equal(privateSummaryScanSchema.safeParse({ ...f.scan, cycle: { ...f.scan.cycle, hasUnresolvedRepair: true } }).success, false);
  const { hasUnresolvedRepair, ...withoutRepairEvidence } = f.scan.cycle;
  assert.equal(hasUnresolvedRepair, false);
  assert.equal(privateSummaryScanSchema.safeParse({ ...f.scan, cycle: withoutRepairEvidence }).success, false);
  assert.equal(privateSummaryCutoverSchema.safeParse({ ...f.cutover, phase: 'complete' }).success, false);
  assert.equal(privateSummaryCutoverSchema.safeParse({ ...f.cutover, phase: 'restore_suspended' }).success, false);
});
