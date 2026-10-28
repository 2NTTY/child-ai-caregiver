/** Check actual streamed bytes, including truncated responses, before handing a package to the user. */
export function boundedPackageStream(response: Response, expectedBytes: number, isCurrent: () => boolean): ReadableStream<Uint8Array> {
  if (!response.body || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 256 * 1024 * 1024) throw Error('package_download_invalid');
  const reader = response.body.getReader(); let received = 0, released = false;
  const release = () => { if (!released) { released = true; reader.releaseLock(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!isCurrent()) throw Error('session_changed');
        const next = await reader.read();
        if (!isCurrent()) throw Error('session_changed');
        if (next.done) {
          if (received !== expectedBytes) throw Error('package_download_incomplete');
          release(); controller.close(); return;
        }
        received += next.value.byteLength;
        if (received > expectedBytes) throw Error('package_download_invalid');
        controller.enqueue(next.value);
      } catch (error) { try { await reader.cancel(); } finally { release(); controller.error(error); } }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { release(); } },
  });
}
