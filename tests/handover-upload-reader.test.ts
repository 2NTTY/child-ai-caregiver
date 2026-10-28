import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { receiveHandoverUpload } from '../server/handover-upload-reader.ts';

test('upload reader streams exact package content, retains trust acknowledgement and removes failed or disposed spools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handover-upload-test-')), spoolRoot = join(root, 'uploads');
  await mkdir(spoolRoot, { mode: 0o700 });
  const childId = randomUUID(), scopeVersion = 'a'.repeat(64), selection = { childIds: [childId], modules: ['profile'] as 'profile'[], period: null };
  const pages = [
    { section: 'children', childId: null, items: [{ id: childId, displayName: 'Synthetic child' }] },
    { section: 'profile', childId, items: [{ childId, version: 1, data: null }] },
    { section: 'profile_history', childId, items: [] },
  ];
  async function* entries() {
    for (let i = 0; i < pages.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...pages[i], scopeVersion })) };
    yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('# Synthetic package') };
  }
  const signal = new AbortController().signal;
  try {
    const archive = await writeHandoverArchive({ directory: root, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: '2026-10-29T01:00:00Z', purpose: 'handover', source: { serverId: 'https://source.example.test', accountId: 'source' }, selection },
      entries: entries(), coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, scopeVersion, items: page.items.length, complete: true as const })) });
    const bytes = await readFile(archive.path), content = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    async function* source() { for (let i = 0; i < bytes.length; i += 17) yield bytes.subarray(i, i + 17); }
    const upload = await receiveHandoverUpload({ source: source(), content, signal, spoolRoot });
    assert.equal(upload.reader.integrity, 'missing_proof'); assert.deepEqual(await readFile(upload.path), bytes);
    if (process.platform !== 'win32') assert.equal((await stat(upload.path)).mode & 0o777, 0o600);
    const readerSelection = { childIds: selection.childIds, modules: selection.modules };
    await assert.rejects(upload.reader.readPage({ selection: readerSelection }), { code: 'package_trust_acknowledgement_required' });
    const page = await upload.reader.readPage({ selection: readerSelection, acknowledgedManifestSha256: upload.reader.manifestSha256 });
    assert.equal(page.rows.length, 2);
    await upload.dispose(); await upload.dispose(); assert.deepEqual(await readdir(spoolRoot), []);
    await assert.rejects(receiveHandoverUpload({ source: source(), content: { ...content, bytes: content.bytes + 1 }, signal, spoolRoot }), { code: 'package_content_conflict' });
    assert.deepEqual(await readdir(spoolRoot), []);
    await assert.rejects(receiveHandoverUpload({ source: source(), content: { ...content, sha256: '0'.repeat(64) }, signal, spoolRoot }), { code: 'package_content_conflict' });
    assert.deepEqual(await readdir(spoolRoot), []);
    await assert.rejects(receiveHandoverUpload({ source: source(), content: { ...content, bytes: 256 * 1024 * 1024 + 1 }, signal, spoolRoot }), { code: 'package_size_exceeded' });
    assert.deepEqual(await readdir(spoolRoot), []);
    const invalid = Buffer.from('not a zip');
    await assert.rejects(receiveHandoverUpload({ source: (async function* () { yield invalid; })(),
      content: { bytes: invalid.length, sha256: createHash('sha256').update(invalid).digest('hex') }, signal, spoolRoot }), { code: 'invalid_package_archive' });
    assert.deepEqual(await readdir(spoolRoot), []);
    const stop = new AbortController(); let entered!: () => void, unblock!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { unblock = resolve; });
    async function* suspended() { yield bytes.subarray(0, 17); entered(); await blocked; }
    const pending = receiveHandoverUpload({ source: suspended(), content, signal: stop.signal, spoolRoot });
    void pending.catch(() => {}); await waiting; stop.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      assert.equal(await Promise.race([pending.then(() => 'completed', () => 'aborted'),
        new Promise<string>(resolve => { timer = setTimeout(() => resolve('stalled'), 1000); })]), 'aborted');
      assert.deepEqual(await readdir(spoolRoot), []);
    } finally { if (timer) clearTimeout(timer); unblock(); await pending.catch(() => {}); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
