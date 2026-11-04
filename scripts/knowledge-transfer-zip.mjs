import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, open, close, fstat, read } from 'node:fs';
import { lstat, link, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Readable, Transform, addAbortSignal } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import { z } from 'zod';
import { waitForHandoverStep } from '../server/handover-archive.ts';

const MAX_ENTRY = 2 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024, MAX_ENTRIES = 4096;
const MAX_DURATION = 300000, stamp = new Date('1980-01-01T00:00:00.000Z');
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const selectedSchema = z.object({ sourceId, versionHash: hash }).strict();
const manifestSchema = z.object({ format: z.literal('yuyoufang-public-knowledge'), version: z.literal(1),
  entries: z.array(selectedSchema.extend({ sha256: hash })).min(1).max(MAX_ENTRIES) }).strict();
const openFd = promisify(open), closeFd = promisify(close), statFd = promisify(fstat), readFd = promisify(read);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function failure(code = 'invalid_knowledge_archive') {
  return Object.assign(new Error('Public knowledge archive could not be processed'), { code });
}
function reject(code) { throw failure(code); }
const sized = () => failure('knowledge_archive_size_exceeded');
const integrity = () => failure('knowledge_archive_integrity_failed');
function decode(bytes) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
// Only the envelope identity is checked here; source/vector schemas and authorization belong to preflight callers.
function editionIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'embeddings,source,versionHash'
    || !value.source || typeof value.source !== 'object' || Array.isArray(value.source)
    || !sourceId.safeParse(value.source.sourceId).success || !hash.safeParse(value.versionHash).success) reject();
  return { sourceId: value.source.sourceId, versionHash: value.versionHash };
}

/** The path belongs to the operator. An existing output is never replaced, including a racing creator. */
export async function writeKnowledgeArchive(path, selection, readEdition) {
  const parsed = z.array(selectedSchema).min(1).max(MAX_ENTRIES).safeParse(selection);
  if (!parsed.success || new Set(parsed.data.map(row => row.sourceId)).size !== parsed.data.length || typeof readEdition !== 'function') reject();
  path = resolve(path);
  try { await lstat(path); reject('knowledge_archive_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const partial = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.partial');
  const zip = new yazl.ZipFile(), stop = new AbortController(), signal = AbortSignal.any([stop.signal, AbortSignal.timeout(MAX_DURATION)]);
  let total = 0, compressed = 0, owned = false;
  const fingerprint = createHash('sha256'), output = zip.outputStream;
  const sink = createWriteStream(partial, { flags: 'wx', mode: 0o600 }); sink.once('open', () => { owned = true; });
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    compressed += chunk.length;
    if (compressed > MAX_TOTAL) return callback(sized());
    fingerprint.update(chunk); callback(null, chunk);
  } });
  zip.on('error', error => output.destroy(error));
  const written = pipeline(output, meter, sink, { signal });
  void written.catch(error => stop.abort(error));
  // Clear the lazy callback's buffer reference as soon as yazl acquires it; completed entries retain only metadata.
  async function addBody(name, buffer) {
    let pending = buffer; buffer = null;
    const consumed = new Promise((done, failed) => {
      zip.addReadStreamLazy(name, { mtime: stamp, forceDosTimestamp: true, mode: 0o100600, size: pending.length }, callback => {
        const stream = Readable.from([pending]); pending = null; addAbortSignal(signal, stream);
        void finished(stream, { cleanup: true }).then(done, failed);
        stream.on('error', error => output.destroy(error)); callback(null, stream);
      });
    });
    await Promise.race([consumed, written.then(() => reject('knowledge_archive_output_closed'))]);
  }
  try {
    const entries = [];
    for (const row of parsed.data) {
      signal.throwIfAborted();
      const value = await waitForHandoverStep(Promise.resolve().then(() => readEdition(Object.freeze({ ...row }))), signal);
      const bytes = Buffer.from(JSON.stringify(value));
      if (bytes.length > MAX_ENTRY || (total += bytes.length) > MAX_TOTAL) throw sized();
      const identity = editionIdentity(decode(bytes));
      if (identity.sourceId !== row.sourceId || identity.versionHash !== row.versionHash) throw integrity();
      entries.push({ ...row, sha256: digest(bytes) });
      await addBody(`editions/${row.sourceId}.json`, bytes);
    }
    const bytes = Buffer.from(JSON.stringify({ format: 'yuyoufang-public-knowledge', version: 1, entries }));
    if (bytes.length > MAX_ENTRY || total + bytes.length > MAX_TOTAL) throw sized();
    await addBody('manifest.json', bytes); zip.end(); await written;
    try { await link(partial, path); } catch (error) { if (error.code === 'EEXIST') reject('knowledge_archive_exists'); throw error; }
    await rm(partial); owned = false;
    return { sha256: fingerprint.digest('hex'), count: entries.length };
  } catch (error) {
    stop.abort(error); output.destroy(error instanceof Error ? error : failure());
    await written.catch(() => {}); if (owned) await rm(partial, { force: true }); throw error;
  }
}

/** A separately trusted fingerprint authenticates this file; no caller receives material before the full inventory passes. */
export async function openKnowledgeArchive(path, expectedSha256) {
  if (!hash.safeParse(expectedSha256).success) reject();
  const fd = await openFd(path, 'r');
  let zip, closed = false, closing, zipError, active = null;
  const closeArchive = () => {
    if (closing) return closing;
    closed = true; active?.destroy(failure('knowledge_archive_closed'));
    closing = zip ? new Promise((done, failed) => {
      const cleanup = () => { zip.removeListener('close', onClose); zip.removeListener('error', onError); };
      const onClose = () => { cleanup(); done(); }, onError = error => { cleanup(); failed(error); };
      zip.once('close', onClose); zip.once('error', onError); zip.close();
    }) : closeFd(fd);
    return closing;
  };
  try {
    const snapshot = await statFd(fd, { bigint: true });
    if (!snapshot.isFile() || snapshot.size < 1n || snapshot.size > BigInt(MAX_TOTAL)) throw sized();
    async function unchanged() {
      if (closed) reject('knowledge_archive_closed');
      const current = await statFd(fd, { bigint: true });
      if (['size', 'dev', 'ino', 'mtimeNs', 'ctimeNs'].some(key => current[key] !== snapshot[key])) throw integrity();
    }
    const fingerprint = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), deadline = AbortSignal.timeout(MAX_DURATION);
    let compressed = 0;
    while (compressed < Number(snapshot.size)) {
      deadline.throwIfAborted();
      const { bytesRead } = await readFd(fd, buffer, 0, Math.min(buffer.length, Number(snapshot.size) - compressed), compressed);
      if (!bytesRead) throw integrity();
      fingerprint.update(buffer.subarray(0, bytesRead)); compressed += bytesRead;
    }
    if (compressed !== Number(snapshot.size) || fingerprint.digest('hex') !== expectedSha256) throw integrity();
    await unchanged();
    zip = await yauzl.fromFdPromise(fd, { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    zip.on('error', error => { zipError = error; });
    if (zip.entryCount < 2 || zip.entryCount > MAX_ENTRIES + 1) throw sized();
    const physical = new Map(); let total = 0, metadataBytes = 0;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName, mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (physical.has(name) || name !== 'manifest.json' && !/^editions\/[a-z0-9][a-z0-9-]{0,79}\.json$/u.test(name)
        || entry.isEncrypted() || mode !== 0 && mode !== 0o100000 || ![0, 8].includes(entry.compressionMethod)) reject();
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_ENTRY
        || (total += entry.uncompressedSize) > MAX_TOTAL) throw sized();
      // Bound the retained central-directory metadata as well as the expanded payload.
      metadataBytes += entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
      if (metadataBytes > MAX_ENTRY) throw sized();
      physical.set(name, entry);
    }
    if (physical.size !== zip.entryCount || !physical.has('manifest.json')) reject();
    async function read(entry) {
      if (closed) reject('knowledge_archive_closed'); if (zipError) throw zipError;
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (!local.fileName.equals(Buffer.from(entry.fileName)) || local.compressionMethod !== entry.compressionMethod
        || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) reject();
      let stream;
      try {
        stream = await zip.openReadStreamPromise(entry); active = stream; addAbortSignal(AbortSignal.timeout(MAX_DURATION), stream);
        const chunks = [], hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length; if (bytes > MAX_ENTRY || bytes > entry.uncompressedSize) throw sized();
          hash.update(chunk); chunks.push(chunk);
        }
        if (bytes !== entry.uncompressedSize) throw integrity();
        return { bytes, sha256: hash.digest('hex'), body: Buffer.concat(chunks, bytes) };
      } catch (error) {
        if (closed) reject('knowledge_archive_closed'); if (error.code === 'knowledge_archive_size_exceeded') throw error; throw integrity();
      } finally { stream?.destroy(); active = null; }
    }
    const actual = new Map(); let manifest;
    for (const [name, entry] of physical) {
      const result = await read(entry), value = decode(result.body);
      if (name === 'manifest.json') manifest = manifestSchema.parse(value);
      else {
        const identity = editionIdentity(value);
        if (name !== `editions/${identity.sourceId}.json`) throw integrity();
        actual.set(name, { ...identity, bytes: result.bytes, sha256: result.sha256 });
      }
    }
    if (!manifest || manifest.entries.length + 1 !== physical.size
      || new Set(manifest.entries.map(row => row.sourceId)).size !== manifest.entries.length) reject();
    const entries = Object.freeze(manifest.entries.map(row => Object.freeze({ ...row })));
    for (const row of entries) {
      const found = actual.get(`editions/${row.sourceId}.json`);
      if (!found || found.versionHash !== row.versionHash || found.sha256 !== row.sha256) throw integrity();
    }
    await unchanged(); let reading = false;
    return { entries, close: closeArchive,
      async readEdition(index) {
        if (closed) reject('knowledge_archive_closed');
        if (!Number.isSafeInteger(index) || index < 0 || index >= entries.length) reject();
        if (reading) reject('knowledge_archive_busy'); reading = true;
        try {
          await unchanged();
          const row = entries[index], name = `editions/${row.sourceId}.json`, result = await read(physical.get(name));
          if (result.sha256 !== row.sha256 || result.bytes !== actual.get(name).bytes) throw integrity();
          const value = decode(result.body), identity = editionIdentity(value);
          if (identity.sourceId !== row.sourceId || identity.versionHash !== row.versionHash) throw integrity();
          await unchanged(); return value;
        } catch (error) { await closeArchive().catch(() => {}); throw error; }
        finally { reading = false; }
      } };
  } catch (error) { await closeArchive().catch(() => {}); throw error; }
}
