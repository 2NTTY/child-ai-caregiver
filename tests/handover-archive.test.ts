import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { writeHandoverArchive, openHandoverArchive } from '../server/handover-archive.ts';

test('handover archive streams data and verifies trust separately from integrity before exposing entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handover-'));
  const keys = generateKeyPairSync('ed25519');
  const childId = randomUUID(), packageId = randomUUID();
  const header = { format: 'yuyoufang-data' as const, version: 1 as const, packageId, packageVersion: 1,
    createdAt: '2026-10-28T04:00:00Z', purpose: 'backup' as const,
    source: { serverId: 'https://example.test', accountId: 'synthetic-owner' },
    selection: { childIds: [childId], modules: ['care', 'attachments'] as ('care' | 'attachments')[], period: null } };
  const record = Buffer.from(JSON.stringify({ id: randomUUID(), version: 2, text: '私人原文', confirmedBy: 'source-owner' }));
  const attachment = Buffer.from([0, 255, 7, 4]);
  const coverage = [{ section: 'care', childId, scopeVersion: 'a'.repeat(64), items: 1, complete: true as const }];
  async function* entries() {
    yield { path: 'data/00000001.json', mediaType: 'application/json', content: record };
    yield { path: 'attachments/00000002.bin', mediaType: 'application/octet-stream', content: attachment };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('# 本人備份\n記錄 1 筆，附件 1 份。') };
  }
  try {
    const archive = await writeHandoverArchive({ directory: dir, header, entries: entries(), coverage: () => coverage, signingKey: keys.privateKey });
    const keyId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    const verified = await openHandoverArchive({ path: archive.path, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId: header.source.serverId }]]) });
    try {
      assert.equal(verified.integrity, 'trusted');
      assert.deepEqual(verified.manifest.coverage, coverage);
      assert.deepEqual(await verified.readEntry('data/00000001.json', 4096), record);
      assert.deepEqual(await verified.readEntry('attachments/00000002.bin', 32), attachment);
      await assert.rejects(verified.readEntry('attachments/00000002.bin', 1), (e: any) => e.code === 'package_size_exceeded');
    } finally { await verified.close(); }
    const untrusted = await openHandoverArchive({ path: archive.path });
    assert.equal(untrusted.integrity, 'untrusted_signer'); await untrusted.close();
    const zip = await JSZip.loadAsync(await readFile(archive.path));
    zip.remove('proof.json');
    const unsignedPath = join(dir, 'unsigned.zip'); await writeFile(unsignedPath, await zip.generateAsync({ type: 'nodebuffer' }));
    const unsigned = await openHandoverArchive({ path: unsignedPath });
    assert.equal(unsigned.integrity, 'missing_proof'); await unsigned.close();
    zip.file('data/00000001.json', Buffer.from('modified'));
    const changedPath = join(dir, 'changed.zip'); await writeFile(changedPath, await zip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(openHandoverArchive({ path: changedPath }), (e: any) => e.code === 'package_integrity_failed');
    const brokenProof = await JSZip.loadAsync(await readFile(archive.path));
    const proof = JSON.parse(await brokenProof.file('proof.json')!.async('string'));
    proof.signature = Buffer.alloc(64, 7).toString('base64'); brokenProof.file('proof.json', JSON.stringify(proof));
    const brokenPath = join(dir, 'broken.zip'); await writeFile(brokenPath, await brokenProof.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(openHandoverArchive({ path: brokenPath }), (e: any) => e.code === 'package_integrity_failed');
    const extra = await JSZip.loadAsync(await readFile(archive.path)); extra.file('data/unlisted.json', '{}');
    const extraPath = join(dir, 'extra.zip'); await writeFile(extraPath, await extra.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(openHandoverArchive({ path: extraPath }), (e: any) => e.code === 'package_integrity_failed');
    const before = await readdir(dir);
    await assert.rejects(writeHandoverArchive({ directory: dir, header, entries: entries(), coverage: () => coverage,
      limits: { maxEntryBytes: 1 } }), (e: any) => e.code === 'package_size_exceeded');
    assert.deepEqual(await readdir(dir), before, 'failed exports remove only their own temporary file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('archive owns compressed bytes after yielding and aborts a suspended source without awaiting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handover-stream-'));
  const header = { format: 'yuyoufang-data' as const, version: 1 as const, packageId: randomUUID(), packageVersion: 1,
    createdAt: '2026-10-28T04:00:00Z', purpose: 'backup' as const,
    source: { serverId: 'https://example.test', accountId: 'owner' },
    selection: { childIds: [randomUUID()], modules: ['attachments'] as 'attachments'[], period: null } };
  try {
    const bytes = Buffer.alloc(1024 * 1024, 77), originalHash = createHash('sha256').update(bytes).digest('hex');
    async function* ownedSource() {
      try { yield { path: 'attachments/one.bin', mediaType: 'application/octet-stream', content: bytes }; }
      finally { bytes.fill(0); }
      yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('one attachment') };
    }
    const written = await writeHandoverArchive({ directory: dir, header, entries: ownedSource(), coverage: () => [] });
    const read = await openHandoverArchive({ path: written.path });
    try { assert.equal(createHash('sha256').update(await read.readEntry('attachments/one.bin', 1024 * 1024)).digest('hex'), originalHash); }
    finally { await read.close(); }
    const before = await readdir(dir), stop = new AbortController();
    let unblock!: () => void, waiting!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; }), entered = new Promise<void>(resolve => { waiting = resolve; });
    async function* suspendedSource() {
      yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('summary') };
      waiting(); await blocked;
    }
    const pending = writeHandoverArchive({ directory: dir, header, entries: suspendedSource(), coverage: () => [], signal: stop.signal });
    void pending.catch(() => {}); await entered; stop.abort(new Error('synthetic cancellation'));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([pending.then(() => 'succeeded', () => 'cancelled'),
        new Promise<string>(resolve => { timeout = setTimeout(() => resolve('stalled'), 1000); })]);
      assert.equal(outcome, 'cancelled'); assert.deepEqual(await readdir(dir), before);
    } finally { if (timeout) clearTimeout(timeout); unblock(); await pending.catch(() => {}); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
