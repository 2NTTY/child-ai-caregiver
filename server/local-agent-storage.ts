import { Storage } from '@google-cloud/storage';
import { PassThrough, Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertLocalAgentEnvironment, localEmulatorOrigin } from './local-agent-config.ts';
import type { FirebasePhotoBucketPort } from './firebase-photo-objects.ts';
import { HANDOVER_OBJECT_LIMIT, type HandoverBucketPort } from './firebase-handover-objects.ts';
import { waitForHandoverStep } from './handover-archive.ts';

const HANDOVER_TIMEOUT = 300_000, HANDOVER_CIPHER_LIMIT = HANDOVER_OBJECT_LIMIT + 32;

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
  const photoBucket = (name: string): FirebasePhotoBucketPort => {
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
  let handoverPort: HandoverBucketPort | undefined;
  const handover = (name: string): HandoverBucketPort => {
    if (name !== config.photoBucket) throw new Error('Unknown local package bucket');
    if (handoverPort) return handoverPort;
    const bucket = storage.bucket(name);
    const deadline = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(HANDOVER_TIMEOUT)]);
    const url = (object: string) => origin + '/storage/v1/b/' + encodeURIComponent(name) + '/o/' + encodeURIComponent(object);
    const metadata = async (object: string, signal: AbortSignal, generation?: string) => {
      signal.throwIfAborted();
      const [value] = await waitForHandoverStep(bucket.file(object).getMetadata(), signal);
      if (typeof value.generation !== 'string') throw failure(502);
      if (generation !== undefined && value.generation !== generation) throw failure(412);
      return value;
    };
    const bound = () => {
      let bytes = 0;
      return new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length; callback(bytes > HANDOVER_CIPHER_LIMIT ? failure(413) : null, chunk);
      } });
    };
    handoverPort = {
      createWrite(object, options) {
        const input = new PassThrough(), stop = new AbortController();
        // Cancellation may arrive while another operation still owns this object's lock.
        input.on('error', () => {});
        let completed: Promise<void>;
        const output = new Writable({
          write(chunk: Buffer, encoding, callback) { input.write(chunk, encoding, callback); },
          final(callback) { input.end(); completed.then(() => callback(), callback); },
          destroy(error, callback) { stop.abort(error ?? new Error('Local package upload closed')); input.destroy(error ?? undefined); callback(error); },
        });
        const timeout = setTimeout(() => output.destroy(failure(504)), HANDOVER_TIMEOUT);
        output.once('close', () => clearTimeout(timeout));
        completed = locked(name + '/' + object, async () => {
          stop.signal.throwIfAborted();
          if (options.preconditionOpts?.ifGenerationMatch !== 0) throw failure(400);
          try { await metadata(object, stop.signal); throw failure(412); }
          catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
          stop.signal.throwIfAborted();
          await pipeline(input, bound(), bucket.file(object).createWriteStream({ ...options, timeout: HANDOVER_TIMEOUT }), { signal: stop.signal });
        });
        void completed.catch(error => output.destroy(error));
        return output;
      },
      metadata(object, inputSignal) {
        const signal = deadline(inputSignal);
        return waitForHandoverStep(locked(name + '/' + object, async () => {
          try { return await metadata(object, signal); }
          catch (error) { if ((error as { code?: number }).code === 404) return null; throw error; }
        }), signal);
      },
      readPinned(object, generation, inputSignal) {
        const stream = new PassThrough(), stop = new AbortController(), signal = deadline(AbortSignal.any([inputSignal, stop.signal]));
        const cancel = () => stream.destroy(signal.reason instanceof Error ? signal.reason : new Error('Local package download cancelled'));
        signal.addEventListener('abort', cancel, { once: true });
        stream.once('close', () => { signal.removeEventListener('abort', cancel); stop.abort(); });
        if (signal.aborted) cancel();
        void locked(name + '/' + object, async () => {
          const value = await metadata(object, signal, generation);
          if (!Number.isSafeInteger(Number(value.size)) || Number(value.size) <= 0 || Number(value.size) > HANDOVER_CIPHER_LIMIT) throw failure(413);
          const response = await fetch(url(object) + '?alt=media', { signal, redirect: 'error', headers: { 'Accept-Encoding': 'identity' } });
          if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(response.status); }
          stream.emit('response', { statusCode: response.status, headers: {
            'content-length': String(value.size), 'x-goog-generation': generation, 'content-encoding': 'identity',
          } });
          await pipeline(Readable.fromWeb(response.body as never), bound(), stream, { signal });
        }).catch(error => stream.destroy(error));
        return stream;
      },
      removePinned(object, generation, inputSignal) {
        const signal = deadline(inputSignal);
        return waitForHandoverStep(locked(name + '/' + object, async () => {
          try {
            await metadata(object, signal, generation); signal.throwIfAborted();
            // The emulator ignores preconditions; retain the shared lock until this cancellable DELETE settles.
            const response = await fetch(url(object) + '?ifGenerationMatch=' + encodeURIComponent(generation), { method: 'DELETE', signal, redirect: 'error' });
            await response.body?.cancel();
            if (!response.ok && response.status !== 404) throw failure(response.status);
          } catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
        }), signal);
      },
    };
    return handoverPort;
  };
  return Object.assign(photoBucket, { handover });
}
