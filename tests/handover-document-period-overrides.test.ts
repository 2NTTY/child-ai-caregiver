import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { datedDocumentPages, type PackageDocumentFilter } from '../server/handover-document-period.ts';
import { DatedDocumentPeriodIndex } from '../server/handover-document-period-index.ts';
import { HandoverDocumentChoices } from '../server/handover-document-choices.ts';
import { familyDocumentTransferSchema, documentTransferContentSchema } from '../server/family-document-transfer.ts';

const childId = randomUUID(), period = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' };
function document(crossing = false) {
  const id = randomUUID(), snapshotId = randomUUID(), previousId = randomUUID();
  const snapshot = { id: snapshotId, version: 2, generatedAt: '2026-11-05T00:00:00Z', sourceBasis: 'b'.repeat(64),
    title: 'Report', summary: 'Full current body', ageLabel: '', period: { from: crossing ? '2026-10-01' : '2026-11-01', to: '2026-11-07' },
    eventDate: null, coverageNote: '', sections: [], sources: [], changes: [] };
  const content = documentTransferContentSchema.parse({ documentId: id, snapshotId, snapshotVersion: 2,
    generatedAt: snapshot.generatedAt, invalidated: false, snapshot });
  const previous = documentTransferContentSchema.parse({ ...content, snapshotId: previousId, snapshotVersion: 1,
    snapshot: { ...snapshot, id: previousId, version: 1, summary: 'SECRET_PREVIOUS_BODY' } });
  const head = familyDocumentTransferSchema.parse({ format: 'yuyoufang-document:1', id, childId, version: 2,
    kind: 'preparation', purpose: 'appointment', request: { kind: 'preparation', purpose: 'appointment', title: 'Report',
      eventDate: null, period: snapshot.period }, createdAt: '2026-11-05T00:00:00.000000Z', status: 'active', archivedAt: null,
    autoRefresh: false, readState: 'ready', invalidated: false, currentSnapshot: { id: snapshotId, version: 2, readable: true }, recentSnapshotIds: [previousId] });
  const pin = { section: 'documents' as const, childId, id, version: 2, snapshotId, snapshotVersion: 2 };
  return { head, content, previous, pin };
}
type Fixture = ReturnType<typeof document>;
function pages(values: Fixture[]) {
  return async function* (section: string, requestedChild: string, filter?: PackageDocumentFilter) {
    assert.equal(requestedChild, childId);
    const items = section === 'documents' ? values.map(value => value.head)
      : values.flatMap(value => [value.previous, value.content]).filter(value => !filter || filter(value.documentId, value.snapshotId));
    yield { section, scopeVersion: 'a'.repeat(64), complete: true as const, nextCursor: null, notices: [], items };
  };
}
async function collect(values: Fixture[], choices: any[] = []) {
  const output = [];
  for await (const page of datedDocumentPages(childId, period, pages(values), 100, choices)) output.push(page);
  return output;
}
const scopeChanged = (error: any) => error.code === 'export_scope_changed';
const invalidPeriod = (error: any) => error.code === 'invalid_package_period';

test('an explicitly selected all-time document must retain its readable current body until packaging', () => {
  const doc = document(), chosen = new HandoverDocumentChoices([{...doc.pin, include:true}], 'export_scope_changed');
  assert.equal(chosen.decide(childId, 'documents', doc.head), true);
  assert.throws(() => chosen.decide(childId, 'document_content', {...doc.content, invalidated:true, snapshot:null}), scopeChanged);
  assert.throws(() => chosen.verify(), scopeChanged);
});

test('dated document overrides pin one full current body, omit exclusions and retain default history', async () => {
  const manual = document(true), excluded = document(), normal = document();
  const output = await collect([manual, excluded, normal], [{ ...manual.pin, include: true }, { ...excluded.pin, include: false }]);
  const heads = output.filter(page => page.section === 'documents').flatMap(page => page.items) as any[];
  assert.deepEqual(heads.map(head => head.id), [manual.head.id, normal.head.id]);
  assert.deepEqual(heads[0].recentSnapshotIds, []);
  const bodies = output.filter(page => page.section === 'document_content').flatMap(page => page.items) as any[];
  assert.deepEqual(bodies.filter(row => row.documentId === manual.head.id), [manual.content]);
  assert.deepEqual(bodies.filter(row => row.documentId === normal.head.id), [normal.previous, normal.content]);
  assert.ok(!JSON.stringify(output).includes(excluded.head.id));
  assert.equal((await collect([manual])).flatMap(page => page.items).length, 0);
  assert.equal((await collect([manual], [{ ...manual.pin, childId: randomUUID(), include: true }])).flatMap(page => page.items).length, 0);
});

test('dated document choices reject changed or disappeared pins including excluded heads', async () => {
  for (const include of [true, false]) {
    const value = document();
    await assert.rejects(collect([], [{ ...value.pin, include }]), scopeChanged);
    await assert.rejects(collect([value], [{ ...value.pin, version: 1, include }]), scopeChanged);
    await assert.rejects(collect([value], [{ ...value.pin, snapshotId: randomUUID(), include }]), scopeChanged);
    await assert.rejects(collect([value], [{ ...value.pin, snapshotVersion: 1, include }]), scopeChanged);
  }
  const unreadable = document(true);
  unreadable.head.currentSnapshot!.readable = false; unreadable.head.readState = 'stale';
  await assert.rejects(collect([unreadable], [{ ...unreadable.pin, include: true }]), scopeChanged);
  const missing = document(true); missing.content.invalidated = true; missing.content.snapshot = null;
  await assert.rejects(collect([missing], [{ ...missing.pin, include: true }]), scopeChanged);
});

test('dated document reader exceptions require complete exact current pins independent of section order', async () => {
  const manual = document(true), normal = document();
  const output = await collect([manual, normal], [{ ...manual.pin, include: true }]);
  const verify = (pins: any[], rows = output) => {
    const index = new DatedDocumentPeriodIndex(period, pins);
    for (const page of [...rows].reverse()) for (const row of page.items) index.add(page.section, childId, row);
    index.verify();
  };
  assert.doesNotThrow(() => verify([manual.pin]));
  assert.throws(() => verify([]), invalidPeriod);
  assert.throws(() => verify([{ ...manual.pin, version: 1 }]), invalidPeriod);
  assert.throws(() => verify([{ ...manual.pin, snapshotId: randomUUID() }]), invalidPeriod);
  assert.throws(() => verify([{ ...manual.pin, childId: randomUUID() }]), invalidPeriod);
  assert.throws(() => verify([manual.pin, document(true).pin]), invalidPeriod);
  assert.throws(() => verify([manual.pin], output.filter(page => page.section !== 'document_content')), invalidPeriod);
  const { snapshot: _snapshot, ...version } = manual.previous;
  assert.throws(() => verify([manual.pin], [...output, { section: 'document_versions', items: [version] },
    { section: 'document_content', items: [manual.previous] }]), invalidPeriod);
  const altered = structuredClone(output);
  (altered.find(page => page.section === 'documents')!.items[0] as any).currentSnapshot.version = 1;
  assert.throws(() => verify([manual.pin], altered), invalidPeriod);
});
