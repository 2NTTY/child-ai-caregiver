import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export interface TemporaryZip {
  path: string;
  bytes: number;
  dispose(): Promise<void>;
}

export async function streamTemporaryZip(file: TemporaryZip, signal: AbortSignal, checkSession: () => Promise<void>,
  disposition: string, extraHeaders?: Record<string, string>): Promise<Response> {
  try {
    await checkSession();
    signal.throwIfAborted();
    const stream = createReadStream(file.path, { signal });
    stream.once('close', () => { void file.dispose().catch(() => {}); });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      ...extraHeaders, 'Content-Type': 'application/zip', 'Content-Length': String(file.bytes), 'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': disposition,
    } });
  } catch (error) { await file.dispose(); throw error; }
}
