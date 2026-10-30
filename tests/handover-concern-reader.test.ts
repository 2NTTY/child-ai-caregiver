import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';

test('verified concern event locators bind historical prefixes and current timelines across reversed pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-concern-reader-'));
  const childId = randomUUID(), otherChild = randomUUID(), concernId = randomUUID(), timelineId = randomUUID();
  const missingId = randomUUID(), duplicateId = randomUUID(), foreignId = randomUUID(), mismatchId = randomUUID();
  const at = '2026-10-30T00:00:00Z', scopeVersion = 'a'.repeat(64), childIds = [childId, otherChild];
  const selection = { childIds, modules: ['concerns'] as 'concerns'[] };
  const head = (id: string, version: number, eventCount: number, timeline?: string) => ({ id, childId, version, eventCount,
    title: 'Retained concern', reason: 'Original context', status: 'following', createdAt: at, updatedAt: at, archivedAt: null,
    attentionIds: [], followUp: null, ...(timeline ? { timelineId: timeline } : {}) });
  const event = (id: string, sequence: number, text: string, timeline?: string, child = childId, eventId = randomUUID()) => ({ id: eventId,
    concernId: id, childId: child, sequence, at, kind: 'observation', title: 'Original observation', text, sourceLabel: 'Original source',
    actorUserId: 'source', ...(timeline ? { timelineId: timeline } : {}) });
  const native = [event(concernId, 1, 'Early native event'), event(concernId, 2, 'Later native event')];
  const current = [event(concernId, 1, 'Current snapshot first', timelineId), event(concernId, 2, 'Current snapshot second', timelineId)];
  const reusedId = randomUUID();
  type Page = { section: string; childId: string | null; scopeVersion: string; items: Record<string, unknown>[] };
  const pages: Page[] = [
    { section: 'concern_events', childId, scopeVersion, items: [current[1], native[1], event(duplicateId, 1, 'Duplicate A'),
      event(mismatchId, 2, 'Reused event second', undefined, childId, reusedId)] },
    { section: 'concern_events', childId, scopeVersion, items: [current[0], native[0], event(duplicateId, 1, 'Duplicate B'),
      event(mismatchId, 1, 'Reused event first', undefined, childId, reusedId)] },
    { section: 'concerns', childId, scopeVersion, items: [head(concernId, 3, 2, timelineId), head(missingId, 1, 1),
      head(duplicateId, 1, 1), head(foreignId, 1, 1), head(mismatchId, 1, 2)] },
    { section: 'concern_history', childId, scopeVersion, items: [head(concernId, 1, 1), head(concernId, 2, 2)] },
    { section: 'concerns', childId: otherChild, scopeVersion, items: [] },
    { section: 'concern_history', childId: otherChild, scopeVersion, items: [] },
    { section: 'concern_events', childId: otherChild, scopeVersion, items: [event(foreignId, 1, 'Wrong child event', undefined, otherChild)] },
    { section: 'children', childId: null, scopeVersion, items: childIds.map(id => ({ id, displayName: 'Source child' })) },
  ];
  async function* entries() {
    for (const [index, page] of pages.entries()) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify(page)) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic concern history') };
  }
  try {
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: at, purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' }, selection: { ...selection, period: null } },
      entries: entries(), coverage: () => [{ section: 'children', childId: null as string | null, scopeVersion, items: childIds.length, complete: true as const },
        ...childIds.flatMap(child => HANDOVER_SECTIONS.concerns.map(section => ({ section, childId: child, scopeVersion,
          items: pages.filter(page => page.section === section && page.childId === child).reduce((total, page) => total + page.items.length, 0), complete: true as const })))] });
    const reader = await openHandoverImport({ path: archive.path });
    try {
      const acknowledged = reader.manifestSha256;
      const rows = (await reader.readPage({ selection, sections: ['concerns', 'concern_history'], acknowledgedManifestSha256: acknowledged })).rows;
      const currentHead = rows.find(row => row.section === 'concerns' && row.value.id === concernId)!;
      const earlyHead = rows.find(row => row.section === 'concern_history' && row.value.id === concernId && row.value.version === 1)!;
      const laterHead = rows.find(row => row.section === 'concern_history' && row.value.id === concernId && row.value.version === 2)!;
      await assert.rejects(reader.readConcernEvents(currentHead), { code: 'package_trust_acknowledgement_required' });
      assert.deepEqual(await reader.readConcernEvents(currentHead, acknowledged), current);
      assert.deepEqual(await reader.readConcernEvents(earlyHead, acknowledged), [native[0]], 'later native events cannot enter the earlier revision');
      assert.deepEqual(await reader.readConcernEvents(laterHead, acknowledged), native);
      for (const id of [missingId, foreignId]) await assert.rejects(reader.readConcernEvents(rows.find(row => row.value.id === id)!, acknowledged), { code: 'package_concern_event_missing' });
      await assert.rejects(reader.readConcernEvents(rows.find(row => row.value.id === duplicateId)!, acknowledged), { code: 'package_concern_event_duplicate' });
      await assert.rejects(reader.readConcernEvents(rows.find(row => row.value.id === mismatchId)!, acknowledged), { code: 'package_concern_event_mismatch' });
      await assert.rejects(reader.readConcernEvents({ ...currentHead, value: { ...currentHead.value, eventCount: 1 } }, acknowledged), { code: 'invalid_package_scope' });
      await assert.rejects(reader.readConcernEvents({ ...currentHead, source: { ...currentHead.source, rowIndex: currentHead.source.rowIndex + 1 } }, acknowledged), { code: 'invalid_package_scope' });
      await assert.rejects(reader.readConcernEvents({ ...currentHead, source: { ...currentHead.source, accountId: 'other' } }, acknowledged), { code: 'invalid_package_scope' });
    } finally { await reader.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
