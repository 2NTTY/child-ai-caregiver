import { FirestoreDomainError } from './firestore-domain-data.ts';

/** A response deadline is not evidence that remote I/O or a native worker stopped. */
export function holdAvatarPipeline<T>(releaseAdmission: () => void) {
  let running = false, releaseRequested = false, used = false;
  return {
    release() { if (running) releaseRequested = true; else releaseAdmission(); },
    execute(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
      if (used) return Promise.reject(new FirestoreDomainError(503, 'avatar_unavailable'));
      used = true; running = true;
      return new Promise<T>((resolve, reject) => {
        let disclosed = false;
        const abort = () => { if (disclosed) return; disclosed = true; reject(new FirestoreDomainError(422, 'avatar_decode_limit')); };
        const finish = (value?: T, error?: unknown) => {
          running = false; signal.removeEventListener('abort', abort);
          if (releaseRequested) releaseAdmission();
          if (disclosed) return; disclosed = true;
          if (error !== undefined) reject(error); else resolve(value!);
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { running = false; abort(); signal.removeEventListener('abort', abort); return; }
        // The underlying promise remains owned and observed after an HTTP timeout.
        // Its codec supervisor must still kill/wait for child close; Storage uncertainty retains its durable cleanup marker.
        try { void start().then(value => finish(value), error => finish(undefined, error)); }
        catch (error) { finish(undefined, error); }
      });
    },
  };
}
