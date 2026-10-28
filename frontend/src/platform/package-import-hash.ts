import { sha256 } from '@noble/hashes/sha2.js';
/** Incremental hashing shares one implementation without retaining the whole archive. */
export async function packageHash(stream: ReadableStream<Uint8Array>, bytes: number, signal: AbortSignal): Promise<string> {
  const reader = stream.getReader(), hash = sha256.create(); let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break;
      size += value.byteLength; if (size > bytes) throw new Error('invalid_package_file'); hash.update(value);
    }
    if (size !== bytes || !size) throw new Error('invalid_package_file');
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { signal.removeEventListener('abort', abort); hash.destroy(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
