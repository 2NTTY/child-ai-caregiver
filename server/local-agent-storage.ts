import { Storage } from '@google-cloud/storage';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertLocalAgentEnvironment, localEmulatorOrigin } from './local-agent-config.ts';
import type { FirebasePhotoBucketPort } from './firebase-photo-objects.ts';

/** Firebase Storage Emulator 15.34 ignores generation preconditions. The single local
 * runtime serializes each object and checks metadata around the same emulator bytes.
 * This is not evidence of Cloud Storage concurrency or IAM behavior. */
export function createLocalAgentBuckets(env: Record<string, string | undefined>) {
  const config = assertLocalAgentEnvironment(env), origin = localEmulatorOrigin(env.FIREBASE_STORAGE_EMULATOR_HOST);
  const storage = new Storage({ projectId: config.projectId, apiEndpoint: origin, useAuthWithCustomEndpoint: false,
    retryOptions: { autoRetry: false }, timeout: 20_000 });
  const locks = new Map<string, Promise<unknown>>(), ports = new Map<string, FirebasePhotoBucketPort>();
  const failure = (code: number) => Object.assign(new Error('local_storage_' + code), { code });
  function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = locks.get(key) ?? Promise.resolve(), result = prior.catch(() => {}).then(operation);
    locks.set(key, result);
    void result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
    return result;
  }
  return (name: string): FirebasePhotoBucketPort => {
    if (![config.photoBucket, config.erasureBucket].includes(name)) throw new Error('Unknown local bucket');
    if (ports.has(name)) return ports.get(name)!;
    const bucket = storage.bucket(name);
    const metadata = async (object: string, generation?: string) => {
      const [value] = await bucket.file(object).getMetadata();
      if (generation !== undefined && String(value.generation) !== generation) throw failure(412);
      return value;
    };
    const port: FirebasePhotoBucketPort = {
      writeNew: (object, bytes, options) => locked(name + '/' + object, async () => {
        if (options.preconditionOpts?.ifGenerationMatch !== 0 || bytes.length > 40 * 1024 * 1024) throw failure(400);
        try { await metadata(object); throw failure(412); }
        catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
        const file = bucket.file(object);
        await file.save(bytes, options);
        return metadata(object);
      }),
      metadata: (object, generation) => locked(name + '/' + object, () => metadata(object, generation)),
      readPinned(object, generation) {
        const stream = new PassThrough(), controller = new AbortController();
        const timeout = setTimeout(() => stream.destroy(failure(504)), 20_000);
        stream.once('close', () => { clearTimeout(timeout); controller.abort(); });
        void locked(name + '/' + object, async () => {
          const value = await metadata(object, generation);
          if (Number(value.size) > 40 * 1024 * 1024) throw failure(413);
          const url = origin + '/storage/v1/b/' + encodeURIComponent(name) + '/o/' + encodeURIComponent(object) + '?alt=media';
          const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { 'Accept-Encoding': 'identity' } });
          if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(response.status); }
          stream.emit('response', { statusCode: response.status, headers: {
            'content-length': String(value.size), 'x-goog-generation': generation, 'content-encoding': 'identity',
          } });
          await pipeline(Readable.fromWeb(response.body as never), stream, { signal: controller.signal });
        }).catch(error => stream.destroy(error));
        return stream;
      },
      ...(name === config.photoBucket ? { removePinned: (object: string, generation: string) => locked(name + '/' + object, async () => {
        try { await metadata(object, generation); await bucket.file(object).delete(); }
        catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
      }) } : {}),
    };
    ports.set(name, port);
    return port;
  };
}
