import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as yazl from 'yazl';
import { writeKnowledgeArchive, openKnowledgeArchive } from '../scripts/knowledge-transfer-zip.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = 'a'.repeat(64), row = sourceId => ({ sourceId, versionHash: hash });
const edition = sourceId => ({ source: { sourceId, text: 'Synthetic public text' }, versionHash: hash, embeddings: [] });
const manifest = rows => ({ format: 'yuyoufang-public-knowledge', version: 1, entries: rows });
const raw = value => Buffer.from(JSON.stringify(value));
async function fixture(path, entries) {
  const zip = new yazl.ZipFile(), written = pipeline(zip.outputStream, createWriteStream(path, { flags: 'wx' }));
  for (const entry of entries) zip.addBuffer(entry.body, entry.name, { mtime: new Date('1980-01-01T00:00:00Z'), ...entry.options });
  zip.end(); await written; return digest(await readFile(path));
}

test('public knowledge ZIP round trips stable selections, publishes without clobbering, and cleans failed outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-zip-'));
  try {
    const path = join(dir, 'edition.zip'), selection = [row('source-b'), row('source-a')], reads = [];
    const result = await writeKnowledgeArchive(path, selection, async item => { reads.push(item.sourceId); return edition(item.sourceId); });
    assert.deepEqual(reads, ['source-b', 'source-a']); assert.equal(result.count, 2);
    assert.equal(result.sha256, digest(await readFile(path)));
    const repeated = await writeKnowledgeArchive(join(dir, 'same.zip'), selection, async item => edition(item.sourceId));
    assert.deepEqual(repeated, result, 'The same ordered material has stable ZIP bytes');
    const reader = await openKnowledgeArchive(path, result.sha256);
    try {
      assert.deepEqual(reader.entries.map(item => [item.sourceId, item.versionHash]), selection.map(item => [item.sourceId, item.versionHash]));
      assert.deepEqual(await reader.readEdition(0), edition('source-b'));
      assert.deepEqual(await reader.readEdition(1), edition('source-a'));
      await assert.rejects(reader.readEdition(-1)); await assert.rejects(reader.readEdition(2));
    } finally { await reader.close(); await reader.close(); }
    await assert.rejects(reader.readEdition(0), { code: 'knowledge_archive_closed' });
    const before = await readdir(dir);
    await assert.rejects(writeKnowledgeArchive(path, selection, async item => edition(item.sourceId)));
    assert.equal(digest(await readFile(path)), result.sha256, 'Existing output remains intact');
    await assert.rejects(writeKnowledgeArchive(join(dir, 'failed.zip'), selection, async item => {
      if (item.sourceId === 'source-a') throw Error('Synthetic edition read failed'); return edition(item.sourceId);
    }), /Synthetic edition read failed/);
    await assert.rejects(writeKnowledgeArchive(join(dir, 'wrong-edition.zip'), [row('source-a')], async () => edition('source-b')));
    for (const invalid of [[], Array.from({ length: 4097 }, (_, n) => row('source-' + n)), [row('same'), row('same')], [row('../escape')],
      [{ sourceId: 'source-a', versionHash: 'A'.repeat(64) }]])
      await assert.rejects(writeKnowledgeArchive(join(dir, 'invalid.zip'), invalid, async () => assert.fail('Invalid selections cannot read editions')));
    await assert.rejects(writeKnowledgeArchive(join(dir, 'large.zip'), [row('source-a')], async () => ({ ...edition('source-a'),
      source: { sourceId: 'source-a', text: 'x'.repeat(2 * 1024 * 1024) } })), { code: 'knowledge_archive_size_exceeded' });
    assert.deepEqual(await readdir(dir), before, 'Failures remove their own partial file without removing previous outputs');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('public knowledge ZIP preflight rejects corruption, incomplete inventories, unsafe metadata and resource excess before exposing editions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-zip-reject-'));
  try {
    const body = raw(edition('source-a')), entry = { sourceId: 'source-a', versionHash: hash, sha256: digest(body) };
    const file = { name: 'editions/source-a.json', body }, meta = value => ({ name: 'manifest.json', body: raw(value) });
    let n = 0;
    async function rejected(entries, code) {
      const path = join(dir, 'bad-' + n++ + '.zip'), fingerprint = await fixture(path, entries);
      await assert.rejects(openKnowledgeArchive(path, fingerprint), code ? { code } : undefined);
    }
    const path = join(dir, 'valid.zip'), fingerprint = await fixture(path, [file, meta(manifest([entry]))]);
    await assert.rejects(openKnowledgeArchive(path, 'b'.repeat(64)), { code: 'knowledge_archive_integrity_failed' });
    await assert.rejects(openKnowledgeArchive(path, fingerprint.toUpperCase()));
    await rejected([file, meta(manifest([{ ...entry, sha256: 'b'.repeat(64) }]))], 'knowledge_archive_integrity_failed');
    await rejected([file, meta(manifest([{ ...entry, versionHash: 'b'.repeat(64) }]))], 'knowledge_archive_integrity_failed');
    await rejected([file, file, meta(manifest([entry]))]);
    await rejected([file, { name: 'editions/extra.json', body: raw(edition('extra')) }, meta(manifest([entry]))]);
    await rejected([meta(manifest([entry]))]);
    await rejected([file]);
    await rejected([file, meta({ ...manifest([entry]), privateProof: {} })]);
    await rejected([file, meta({ ...manifest([entry]), format: 'yuyoufang-data' })]);
    await rejected([file, meta(manifest([entry, entry]))]);
    await rejected([{ name: 'editions/UPPER.json', body }, meta(manifest([entry]))]);
    await rejected([{ ...file, options: { mode: 0o120777 } }, meta(manifest([entry]))]);
    await rejected([{ ...file, body: Buffer.alloc(2 * 1024 * 1024 + 1) }, meta(manifest([entry]))], 'knowledge_archive_size_exceeded');
    const sparse = await open(join(dir, 'oversize.zip'), 'wx');
    await sparse.truncate(512 * 1024 * 1024 + 1); await sparse.close();
    await assert.rejects(openKnowledgeArchive(join(dir, 'oversize.zip'), hash), { code: 'knowledge_archive_size_exceeded' });
    const totalPath = join(dir, 'expanded-total.zip');
    await fixture(totalPath, [...Array.from({ length: 257 }, (_, i) => ({ name: `editions/source-${i}.json`, body: Buffer.from('{}') })), meta(manifest([entry]))]);
    const central = await readFile(totalPath);
    for (let offset = 0; offset <= central.length - 46; offset++) if (central.readUInt32LE(offset) === 0x02014b50)
      central.writeUInt32LE(2 * 1024 * 1024, offset + 24);
    await writeFile(totalPath, central);
    await assert.rejects(openKnowledgeArchive(totalPath, digest(central)), { code: 'knowledge_archive_size_exceeded' });
    const mutablePath = join(dir, 'mutable.zip'), mutableHash = await fixture(mutablePath, [{ ...file, options: { compress: false } }, meta(manifest([entry]))]);
    const reader = await openKnowledgeArchive(mutablePath, mutableHash);
    try {
      const archiveBytes = await readFile(mutablePath), offset = archiveBytes.indexOf(Buffer.from('Synthetic public text'));
      assert.ok(offset >= 0); archiveBytes[offset] ^= 1; await writeFile(mutablePath, archiveBytes);
      await assert.rejects(reader.readEdition(0), { code: 'knowledge_archive_integrity_failed' });
    } finally { await reader.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
