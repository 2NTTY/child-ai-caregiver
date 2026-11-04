import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePersonalHandoverPackage, type HandoverExportSource } from '../server/handover-export.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import type { HandoverDocumentChoice } from '../src/shared/handover.ts';

test('dated attachment overrides preserve included originals and suppress deselected content and transcription', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-preview-attachments-')), childId = randomUUID();
  const period = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' };
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  function file(createdAt: string, fileName: string, text: string) {
    const bytes = Buffer.from(text), row = { id: randomUUID(), childId, version: 2, createdAt,
      state: 'ready', fileName, mimeType: 'text/plain', bytes: bytes.length, sha256: hash(bytes), messageId: null };
    return { row, bytes };
  }
  const included = file('2026-10-31T23:59:59+08:00', 'Original 跨期.txt', 'Original included bytes\n\u0000\u00ff'),
    selected = file(period.from, 'Within period.txt', 'Selected original bytes'),
    excludedByDate = file('2026-10-30T00:00:00+08:00', 'SECRET_UNSELECTED_OLD.txt', 'SECRET_UNSELECTED_OLD_BYTES');
  const files = [included, selected, excludedByDate], voiceBytes = Buffer.from('SECRET_DESELECTED_AUDIO');
  const voice = { id: randomUUID(), childId, version: 3, createdAt: period.to, state: 'ready', fileName: 'SECRET_DESELECTED.wav',
    mimeType: 'audio/wav', bytes: voiceBytes.length, sha256: hash(voiceBytes), durationMs: 1000, messageId: randomUUID() };
  const transcript = { voice: { id: voice.id, version: 2, mimeType: voice.mimeType, bytes: voice.bytes, sha256: voice.sha256, durationMs: voice.durationMs },
    messageId: voice.messageId, version: 2, state: 'available', automatic: true, updatedAt: period.to, reason: null, retryAt: null,
    content: { complete: true, segments: [{ text: 'SECRET_DESELECTED_TRANSCRIPT', startMs: 0, endMs: 1000, unclear: false }] } };
  const choice = (section: 'files' | 'voices', row: { id: string; version: number }, include: boolean): HandoverDocumentChoice =>
    ({ section, childId, id: row.id, version: row.version, snapshotId: null, snapshotVersion: null, include });
  const documentChoices = [choice('files', included.row, true), choice('voices', voice, false)], reads: string[] = [];
  const exporter: HandoverExportSource = { async page(_owner, query, filter) {
    let items: unknown[] = [];
    if (query.section === 'children') items = [{ id: childId, displayName: 'Source child' }];
    if (query.section === 'files') items = files.map(value => value.row);
    if (query.section === 'voices') items = [voice];
    if (query.section === 'voice_transcripts') items = [transcript];
    if (query.section === 'child_avatar') items = [{ target: { kind: 'child', childId }, version: 0, asset: null, updatedAt: null }];
    if (query.section === 'file_content') items = files.filter(value => !filter || filter('files', value.row.id)).map(value => {
      reads.push(value.row.id);
      return { fileId: value.row.id, version: value.row.version, mimeType: value.row.mimeType, base64: value.bytes.toString('base64') };
    });
    if (query.section === 'voice_content' && (!filter || filter('voices', voice.id))) {
      reads.push(voice.id); items = [{ voiceId: voice.id, version: voice.version, mimeType: voice.mimeType, base64: voiceBytes.toString('base64') }];
    }
    return { section: query.section, items, scopeVersion: 'a'.repeat(64), complete: true, nextCursor: null, notices: [] };
  } };
  const selection = { childIds: [childId], modules: ['attachments'] as 'attachments'[] };
  const input = { directory, exporter, ownerUserId: 'source', serverId: 'https://source.test', createdAt: period.to, purpose: 'handover' as const };
  try {
    const dated = await writePersonalHandoverPackage({ ...input, packageId: randomUUID(), selection: { ...selection, period }, documentChoices });
    assert.deepEqual(reads, [included.row.id, selected.row.id], 'deselected and default out-of-period storage bodies are not requested');
    const reader = await openHandoverImport({ path: dated.path });
    try {
      assert.deepEqual(reader.manifest.selection.period, period);
      const { include: _include, ...pin } = documentChoices[0];
      assert.deepEqual(reader.manifest.periodExceptions, [pin], 'only the explicit included exception is disclosed');
      const page = await reader.readPage({ selection, acknowledgedManifestSha256: reader.manifestSha256, limit: 100 });
      assert.equal(page.nextCursor, null);
      const heads = page.rows.filter(row => row.section === 'files');
      assert.deepEqual(heads.map(row => row.value.fileName), [included.row.fileName, selected.row.fileName]);
      assert.deepEqual(page.rows.filter(row => row.section === 'file_content').map(row => row.value.fileId), [included.row.id, selected.row.id]);
      assert.equal(page.rows.some(row => row.section === 'voices' || row.section === 'voice_content' || row.section === 'voice_transcripts'), false);
      assert.ok(!JSON.stringify(page.rows).includes('SECRET_'));
      for (const original of [included, selected]) {
        const content = await reader.readAttachmentContent(heads.find(row => row.value.id === original.row.id)!, reader.manifestSha256);
        assert.ok(content); assert.deepEqual(content.content, original.bytes);
      }
    } finally { await reader.close(); }
    reads.length = 0;
    const full = await writePersonalHandoverPackage({ ...input, packageId: randomUUID(), selection: { ...selection, period: null }, documentChoices });
    assert.deepEqual(reads, files.map(value => value.row.id));
    const fullReader = await openHandoverImport({ path: full.path });
    try {
      assert.equal(fullReader.manifest.periodExceptions, undefined);
      const page = await fullReader.readPage({ selection, acknowledgedManifestSha256: fullReader.manifestSha256, limit: 100 });
      assert.deepEqual(page.rows.filter(row => row.section === 'files').map(row => row.value.id), files.map(value => value.row.id));
      assert.equal(page.rows.some(row => row.section === 'voices' || row.section === 'voice_content' || row.section === 'voice_transcripts'), false);
    } finally { await fullReader.close(); }
    for (const chosen of documentChoices) await assert.rejects(writePersonalHandoverPackage({ ...input, packageId: randomUUID(),
      selection: { ...selection, period }, documentChoices: [{ ...chosen, version: chosen.version + 1 }] }),
    (error: any) => error.code === 'export_scope_changed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
