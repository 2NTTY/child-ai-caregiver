import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HANDOVER_OBJECT_LIMIT } from './firebase-handover-objects.ts';
import { HandoverArchiveError, waitForHandoverStep } from './handover-archive.ts';
import { openHandoverImport } from './handover-import.ts';

/** Receives one owned spool; archive validation and trust acknowledgement remain with the existing reader. */
export async function receiveHandoverUpload(input: {
  source: AsyncIterable<Uint8Array>; content: { bytes: number; sha256: string }; signal: AbortSignal;
  spoolRoot?: string; trustedKeys?: Parameters<typeof openHandoverImport>[0]['trustedKeys'];
}) {
  input.signal.throwIfAborted();
  if (!Number.isSafeInteger(input.content.bytes) || input.content.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(input.content.sha256))
    throw new HandoverArchiveError('package_content_conflict');
  if (input.content.bytes > HANDOVER_OBJECT_LIMIT) throw new HandoverArchiveError('package_size_exceeded');
  const root = resolve(input.spoolRoot ?? tmpdir()), directory = await mkdtemp(join(root, 'yuyoufang-package-upload-'));
  const path = join(directory, 'package.zip');
  let reader: Awaited<ReturnType<typeof openHandoverImport>> | undefined, disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    try { await reader?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  })();
  try {
    input.signal.throwIfAborted();
    const iterator = input.source[Symbol.asyncIterator]();
    async function* chunks() {
      let completed = false;
      try {
        for (;;) {
          const item = await waitForHandoverStep(iterator.next(), input.signal);
          if (item.done) { completed = true; return; }
          yield item.value;
        }
      } finally {
        // A suspended producer must not delay closing and removing this upload's file.
        if (!completed) void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
      }
    }
    const hash = createHash('sha256'); let bytes = 0;
    const measured = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > HANDOVER_OBJECT_LIMIT) return callback(new HandoverArchiveError('package_size_exceeded'));
      if (bytes > input.content.bytes) return callback(new HandoverArchiveError('package_content_conflict'));
      hash.update(chunk);
      // The producer may reuse its yielded buffer before the file stream finishes writing it.
      callback(null, Buffer.from(chunk));
    } });
    await pipeline(Readable.from(chunks()), measured, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: input.signal });
    if (bytes !== input.content.bytes || hash.digest('hex') !== input.content.sha256) throw new HandoverArchiveError('package_content_conflict');
    try { reader = await openHandoverImport({ path, signal: input.signal, trustedKeys: input.trustedKeys }); }
    catch (error) {
      if (error instanceof HandoverArchiveError || input.signal.aborted
        || error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || 'syscall' in error && 'code' in error)) throw error;
      throw new HandoverArchiveError('invalid_package_archive');
    }
    input.signal.throwIfAborted();
    return { path, directory, reader, dispose };
  } catch (error) { await dispose(); throw error; }
}
