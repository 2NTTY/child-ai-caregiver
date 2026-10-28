import { createHash, createPublicKey, sign, verify, randomUUID, type KeyObject } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform, addAbortSignal } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import { handoverHeaderSchema, handoverManifestSchema, handoverProofSchema, handoverPathSchema,
  type HandoverHeader, type HandoverCoverage, type HandoverEntry, type HandoverIntegrity } from '../src/shared/handover.ts';

export class HandoverArchiveError extends Error {
  readonly code: string;
  constructor(code: string) { super('Data package could not be processed'); this.name = 'HandoverArchiveError'; this.code = code; }
}
function reject(code = 'invalid_package'): never { throw new HandoverArchiveError(code); }
export interface HandoverLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number; maxArchiveBytes: number; maxManifestBytes: number; maxDurationMs: number }
const DEFAULT_LIMITS: HandoverLimits = { maxEntries: 10000, maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024, maxArchiveBytes: 256 * 1024 * 1024, maxManifestBytes: 4 * 1024 * 1024, maxDurationMs: 300000 };
export function handoverLimits(input?: Partial<HandoverLimits>): HandoverLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) reject('invalid_package_limits');
  return limits;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function base64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64'); if (bytes.toString('base64') !== value) reject('package_integrity_failed'); return bytes;
}
export interface HandoverEntryInput { path: string; mediaType: string; content: Uint8Array | Readable }

/** Reads have no side effects: cancellation can abandon an uninterruptible SDK read without waiting for it. */
export function waitForHandoverStep<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('Package cancelled'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    pending.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

/** directory is an existing private server spool, never a request-supplied filesystem path. */
export async function writeHandoverArchive(input: {
  directory: string; header: HandoverHeader; entries: AsyncIterable<HandoverEntryInput>;
  coverage(): HandoverCoverage[] | Promise<HandoverCoverage[]>; signingKey?: KeyObject;
  limits?: Partial<HandoverLimits>; signal?: AbortSignal;
}) {
  const header = handoverHeaderSchema.parse(input.header), limits = handoverLimits(input.limits);
  input.signal?.throwIfAborted();
  if (input.signingKey && (input.signingKey.type !== 'private' || input.signingKey.asymmetricKeyType !== 'ed25519')) reject('invalid_package_signing_key');
  const path = join(input.directory, `${randomUUID()}.zip`), zip = new yazl.ZipFile(), stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(limits.maxDurationMs), ...(input.signal ? [input.signal] : [])]);
  let compressedBytes = 0, total = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    compressedBytes += chunk.length;
    callback(compressedBytes > limits.maxArchiveBytes ? new HandoverArchiveError('package_size_exceeded') : null, chunk);
  } });
  const output = zip.outputStream as Readable;
  zip.on('error', error => output.destroy(error));
  const written = pipeline(output, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
  // The source may still be awaiting its next entry when the output fails.
  let outputError: unknown; void written.catch(error => { outputError = error; stop.abort(error); });
  const entries: HandoverEntry[] = [], seen = new Set<string>(), iterator = input.entries[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await waitForHandoverStep(iterator.next(), signal); if (next.done) break;
      const entry = next.value;
      input.signal?.throwIfAborted(); if (outputError) throw outputError;
      if (!handoverPathSchema.safeParse(entry.path).success || seen.has(entry.path)) reject();
      if (seen.size >= limits.maxEntries) reject('package_size_exceeded');
      seen.add(entry.path);
      let bytes = 0; const hash = createHash('sha256');
      const reader = entry.content instanceof Readable ? entry.content : Readable.from([entry.content]);
      const measured = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length; total += chunk.length;
        if (bytes > limits.maxEntryBytes || total > limits.maxTotalBytes) return callback(new HandoverArchiveError('package_size_exceeded'));
        // zlib may retain the final chunk after this stream ends. Own it before the producer releases its buffer.
        hash.update(chunk); callback(null, Buffer.from(chunk));
      } });
      const consumed = finished(measured, { cleanup: true }); void consumed.catch(() => {});
      const supplied = pipeline(reader, measured, { signal }); void supplied.catch(() => {});
      zip.addReadStreamLazy(entry.path, { mtime: new Date(header.createdAt), mode: 0o100600 }, callback => callback(null, measured));
      // Do not ask the producer for the next item until yazl consumes this one.
      await Promise.race([Promise.all([supplied, consumed]), written.then(() => reject('package_output_closed'))]);
      entries.push({ path: entry.path, mediaType: entry.mediaType, bytes, sha256: hash.digest('hex') });
    }
    const manifest = handoverManifestSchema.parse({ ...header, coverage: await waitForHandoverStep(Promise.resolve().then(input.coverage), signal), entries });
    const raw = Buffer.from(JSON.stringify(manifest));
    if (raw.length > limits.maxManifestBytes) reject('package_size_exceeded');
    zip.addBuffer(raw, 'manifest.json', { mtime: new Date(header.createdAt), mode: 0o100600 });
    if (input.signingKey) {
      const publicKey = createPublicKey(input.signingKey).export({ type: 'spki', format: 'der' });
      const proof = { algorithm: 'Ed25519', keyId: digest(publicKey), publicKey: publicKey.toString('base64'),
        signature: sign(null, raw, input.signingKey).toString('base64') };
      zip.addBuffer(Buffer.from(JSON.stringify(proof)), 'proof.json', { mtime: new Date(header.createdAt), mode: 0o100600 });
    }
    zip.end(); await written;
    return { path, bytes: compressedBytes, manifest, manifestSha256: digest(raw) };
  } catch (error) {
    stop.abort(error);
    output.destroy(error instanceof Error ? error : new Error('Package output failed'));
    // An async generator can still be inside a stalled read; do not let return() block file cleanup.
    void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    await written.catch(() => {}); await rm(path, { force: true }); throw error;
  }
}

/** Verifies the complete archive before returning access; nothing is extracted to user-selected paths. */
export async function openHandoverArchive(input: { path: string; trustedKeys?: ReadonlyMap<string, { key: KeyObject; serverId: string }>;
  limits?: Partial<HandoverLimits>; signal?: AbortSignal }) {
  const limits = handoverLimits(input.limits), signal = AbortSignal.any([AbortSignal.timeout(limits.maxDurationMs), ...(input.signal ? [input.signal] : [])]);
  signal.throwIfAborted();
  if ((await stat(input.path)).size > limits.maxArchiveBytes) reject('package_size_exceeded');
  const zip = await yauzl.openPromise(input.path, { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  let zipError: unknown; zip.on('error', error => { zipError = error; });
  let closed = false, total = 0;
  const close = async () => { if (!closed) { closed = true; zip.close(); } };
  const entries = new Map<string, yauzl.Entry>(), actual = new Map<string, { bytes: number; sha256: string }>();
  const metadata = new Map<string, Buffer>();
  async function read(entry: yauzl.Entry, limit: number, collect: boolean) {
    signal.throwIfAborted(); if (zipError) throw zipError; if (closed) reject('package_closed');
    if (entry.uncompressedSize > limit) reject('package_size_exceeded');
    const stream = await zip.openReadStreamPromise(entry); addAbortSignal(signal, stream);
    const hash = createHash('sha256'), chunks: Buffer[] = []; let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += chunk.length; if (bytes > limit) reject('package_size_exceeded');
        hash.update(chunk); if (collect) chunks.push(chunk);
      }
    } finally { stream.destroy(); }
    return { bytes, sha256: hash.digest('hex'), buffer: collect ? Buffer.concat(chunks) : undefined };
  }
  try {
    if (zip.entryCount > limits.maxEntries + 4) reject('package_size_exceeded');
    const names = new Set<string>();
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName, meta = name === 'manifest.json' || name === 'proof.json';
      const directory = name === 'data/' || name === 'attachments/';
      if (names.has(name) || !meta && !directory && !handoverPathSchema.safeParse(name).success
        || entry.isEncrypted() || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) reject();
      names.add(name);
      if (directory) { if (entry.uncompressedSize !== 0) reject(); continue; }
      if (entries.size >= limits.maxEntries + 2) reject('package_size_exceeded');
      total += entry.uncompressedSize; if (total > limits.maxTotalBytes + limits.maxManifestBytes + 2048) reject('package_size_exceeded');
      entries.set(name, entry);
      const result = await read(entry, name === 'proof.json' ? 2048 : meta ? limits.maxManifestBytes : limits.maxEntryBytes, meta);
      actual.set(name, result); if (result.buffer) metadata.set(name, result.buffer);
    }
    const raw = metadata.get('manifest.json'); if (!raw) reject();
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const parsed = handoverManifestSchema.safeParse(decoded); if (!parsed.success) reject('unsupported_package_format');
    const manifest = parsed.data;
    if (entries.size !== manifest.entries.length + 1 + (entries.has('proof.json') ? 1 : 0)) reject('package_integrity_failed');
    for (const expected of manifest.entries) {
      const found = actual.get(expected.path);
      if (!found || found.bytes !== expected.bytes || found.sha256 !== expected.sha256) reject('package_integrity_failed');
    }
    let integrity: HandoverIntegrity = 'missing_proof';
    const proofRaw = metadata.get('proof.json');
    if (proofRaw) {
      try {
        const proof = handoverProofSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(proofRaw)));
        const publicBytes = base64(proof.publicKey), key = createPublicKey({ key: publicBytes, type: 'spki', format: 'der' });
        if (key.asymmetricKeyType !== 'ed25519' || digest(publicBytes) !== proof.keyId || !verify(null, raw, key, base64(proof.signature))) reject('package_integrity_failed');
        const trusted = input.trustedKeys?.get(proof.keyId);
        if (trusted && digest(trusted.key.export({ type: 'spki', format: 'der' })) !== proof.keyId) reject('invalid_package_trust_configuration');
        integrity = trusted && trusted.serverId === manifest.source.serverId ? 'trusted' : 'untrusted_signer';
      } catch (error) { if (error instanceof HandoverArchiveError) throw error; reject('package_integrity_failed'); }
    }
    return { manifest, integrity, manifestSha256: digest(raw), close,
      async readEntry(path: string, maxBytes: number): Promise<Buffer> {
        const expected = manifest.entries.find(entry => entry.path === path), entry = entries.get(path);
        if (!expected || !entry || !Number.isSafeInteger(maxBytes) || maxBytes < 0) reject();
        const result = await read(entry, Math.min(maxBytes, limits.maxEntryBytes), true);
        if (result.bytes !== expected.bytes || result.sha256 !== expected.sha256) reject('package_integrity_failed');
        return result.buffer!;
      } };
  } catch (error) { await close(); throw error; }
}
