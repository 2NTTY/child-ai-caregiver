import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleFamilyDocumentRequest } from '../server/family-document-api.ts';
import type { DocumentSnapshot, DocumentExport } from '../src/shared/family-documents.ts';
import type { FamilyDocumentStore } from '../server/family-document-store.ts';

test('report preview uses the exact authorized PDF snapshot, options and second authority read', async () => {
  const child = randomUUID(), doc = randomUUID(), id = randomUUID();
  const snapshot: DocumentSnapshot = { id, version: 3, sourceBasis: 'basis', generatedAt: '2026-11-18T00:00:00Z', title: '學期報告',
    summary: '概要', ageLabel: '三歲', period: { from: '2026-09-01', to: '2026-11-18' }, eventDate: null, coverageNote: '期間內資料',
    sections: [{ id: 'a', title: '準備', kind: 'checklist', domain: null, items: [{ id: 'b', text: '完成', sourceIds: [], checked: true }] }],
    sources: [{ id: 's', resourceId: 'r', kind: 'record', version: 2, label: '記錄', text: '只在勾選原文時顯示', at: null }], changes: ['只在勾選更新時顯示'] };
  const input: DocumentExport = { snapshotId: id, snapshotVersion: 3, authorityVersion: 'basis', purpose: 'school', includeSources: false, includeRevision: false };
  let reads = 0, invalidate = false;
  const store = { async exportSnapshot() { reads++; return invalidate && reads % 2 === 0 ? null : snapshot; } } as unknown as FamilyDocumentStore;
  const request = (body: DocumentExport, preview = true) => handleFamilyDocumentRequest(new Request(
    'https://example.invalid/api/children/' + child + '/documents/' + doc + '/pdf' + (preview ? '?view=content' : ''), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': 'admin' }, body: JSON.stringify(body),
    }), 'admin', store, async () => true);
  const base = await request(input);
  assert.match(base.headers.get('content-type') ?? '', /json/);
  assert.equal(base.headers.get('cache-control'), 'no-store');
  const { preview } = await base.json();
  assert.equal(preview.snapshotId, id); assert.equal(preview.snapshotVersion, 3);
  assert.match(preview.subtitle, /入園認識/);
  assert.deepEqual(preview.sections, [{ title: '準備', items: ['[已核對] 完成'] }]);
  assert.equal(preview.changes, null); assert.equal(preview.sources, null);
  const full = (await (await request({ ...input, includeSources: true, includeRevision: true })).json()).preview;
  assert.deepEqual(full.changes, snapshot.changes); assert.equal(full.sources[0].text, snapshot.sources[0].text);
  assert.match(full.sources[0].label, /版本 2/);
  invalidate = true;
  assert.equal((await request(input)).status, 409);
  invalidate = false;
  const pdf = await request(input, false);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
