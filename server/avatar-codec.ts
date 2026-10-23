import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { avatarCropSchema, type AvatarCrop } from '../src/shared/avatars.ts';
import { avatarAdmissionSchema, avatarRecipeSchema, type AvatarAdmission, type AvatarRecipe } from './avatar-config.ts';
import { AvatarCodecError } from './avatar-codec-error.ts';
import type { AvatarNormalized } from './avatar-codec-core.ts';

interface Job { actor: string; input: Buffer; mimeType: 'image/jpeg' | 'image/png'; crop: AvatarCrop; recipe: AvatarRecipe;
  admission: AvatarAdmission; signal: AbortSignal; queuedAt: number; done: boolean; child: ChildProcessWithoutNullStreams | null;
  timer: ReturnType<typeof setTimeout>; decodeTimer?: ReturnType<typeof setTimeout>; cancellation?: AvatarCodecError; abort(): void; resolve(result: AvatarNormalized): void; reject(error: AvatarCodecError): void }
const resultSchema = z.object({ bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mimeType: z.literal('image/jpeg'), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
const errorSchema = z.object({ error: z.enum(['avatar_input_too_large', 'avatar_unsupported_format', 'avatar_invalid_image',
  'avatar_decode_limit', 'avatar_integrity_failed', 'avatar_unavailable']) }).strict();

/** Process-local queue complements the persistent per-upload admission/lease. No native addon enters the API process. */
export function createAvatarCodec(admissionInput: AvatarAdmission) {
  const admission = avatarAdmissionSchema.parse(admissionInput), queue: Job[] = [], actors = new Set<string>(), running = new Set<Job>();
  const closeWaiters: (() => void)[] = [];
  let active = 0, stopped = false;
  const worker = fileURLToPath(new URL('./avatar-codec-worker.ts', import.meta.url));
  function finish(job: Job, result?: AvatarNormalized, error?: AvatarCodecError) {
    if (job.done) return; job.done = true; clearTimeout(job.timer); clearTimeout(job.decodeTimer); job.signal.removeEventListener('abort', job.abort);
    actors.delete(job.actor); if (job.child) { active--; running.delete(job); }
    job.input = Buffer.alloc(0);
    if (stopped && active === 0) for (const resolve of closeWaiters.splice(0)) resolve();
    if (error) job.reject(error); else job.resolve(result!);
    pump();
  }
  function cancel(job: Job, reason: AvatarCodecError) {
    if (job.done) return;
    if (job.child) {
      job.cancellation ??= reason;
      // Do not release admission until close proves the process and its native work stopped.
      if (!job.child.kill('SIGKILL')) { stopped = true; job.reject(new AvatarCodecError('avatar_unavailable')); }
      return;
    }
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    finish(job, undefined, reason);
  }
  function launch(job: Job) {
    if (job.done) return;
    if (Date.now() - job.queuedAt >= admission.totalTimeoutMs) return finish(job, undefined, new AvatarCodecError('avatar_decode_limit'));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, ['--max-old-space-size=128', '--no-warnings', worker], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { NODE_ENV: 'production', UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' },
      });
    } catch { return finish(job, undefined, new AvatarCodecError('avatar_unavailable')); }
    job.child = child; active++; running.add(job);
    job.decodeTimer = setTimeout(() => cancel(job, new AvatarCodecError('avatar_decode_limit')), job.admission.decodeTimeoutMs);
    const chunks: Buffer[] = []; let size = 0, failure: AvatarCodecError | undefined;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > job.recipe.maxOutputBytes + 4096) { cancel(job, new AvatarCodecError('avatar_integrity_failed')); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', () => { /* Never retain decoder/native diagnostics or image metadata. */ });
    child.stdin.on('error', () => { /* Final process outcome is established by close. */ });
    child.once('error', () => { failure = new AvatarCodecError('avatar_unavailable'); });
    child.once('close', (code, signal) => {
      if (job.cancellation) return finish(job, undefined, job.cancellation);
      if (failure) return finish(job, undefined, failure);
      if (signal || job.signal.aborted || Date.now() - job.queuedAt >= job.admission.totalTimeoutMs)
        return finish(job, undefined, new AvatarCodecError('avatar_decode_limit'));
      try {
        const output = Buffer.concat(chunks, size), newline = output.indexOf(10);
        if (newline < 0 || newline > 4096) throw new AvatarCodecError('avatar_integrity_failed');
        const raw: unknown = JSON.parse(output.subarray(0, newline).toString('utf8'));
        if (code !== 0) { const parsed = errorSchema.safeParse(raw); throw new AvatarCodecError(parsed.success ? parsed.data.error : 'avatar_unavailable'); }
        const value = resultSchema.parse(raw), buffer = output.subarray(newline + 1);
        if (value.bytes !== buffer.length || buffer.length > job.recipe.maxOutputBytes || value.width !== job.recipe.outputSize
          || value.height !== job.recipe.outputSize || createHash('sha256').update(buffer).digest('hex') !== value.sha256)
          throw new AvatarCodecError('avatar_integrity_failed');
        finish(job, { ...value, buffer });
      } catch (error) { finish(job, undefined, error instanceof AvatarCodecError ? error : new AvatarCodecError('avatar_integrity_failed')); }
    });
    const header = { bytes: job.input.length, mimeType: job.mimeType, crop: job.crop, recipe: job.recipe, admission: job.admission };
    try { child.stdin.write(JSON.stringify(header) + '\n'); child.stdin.end(job.input); }
    catch { cancel(job, new AvatarCodecError('avatar_unavailable')); }
  }
  function pump() {
    while (!stopped && active < admission.decodeConcurrency && queue.length) launch(queue.shift()!);
  }
  return {
    normalize(actor: string, input: Buffer, mimeType: 'image/jpeg' | 'image/png', crop: AvatarCrop, recipe: AvatarRecipe, signal: AbortSignal): Promise<AvatarNormalized> {
      if (stopped) return Promise.reject(new AvatarCodecError('avatar_unavailable'));
      if (actors.has(actor) || active >= admission.decodeConcurrency && queue.length >= admission.queueLimit) return Promise.reject(new AvatarCodecError('avatar_busy'));
      if (!Buffer.isBuffer(input) || input.length < 1 || input.length > admission.maxInputBytes) return Promise.reject(new AvatarCodecError('avatar_input_too_large'));
      if (signal.aborted) return Promise.reject(new AvatarCodecError('avatar_decode_limit'));
      const checkedCrop = avatarCropSchema.parse(crop), checkedRecipe = avatarRecipeSchema.parse(recipe);
      return new Promise((resolve, reject) => {
        const job = { actor, input, mimeType, crop: checkedCrop, recipe: checkedRecipe, admission, signal, queuedAt: Date.now(), done: false,
          child: null, resolve, reject } as Job;
        job.abort = () => cancel(job, new AvatarCodecError('avatar_decode_limit'));
        job.timer = setTimeout(job.abort, admission.totalTimeoutMs);
        signal.addEventListener('abort', job.abort, { once: true }); actors.add(actor); queue.push(job); pump();
      });
    },
    close(): Promise<void> {
      stopped = true; for (const job of [...queue, ...running]) cancel(job, new AvatarCodecError('avatar_unavailable'));
      return active === 0 ? Promise.resolve() : new Promise(resolve => closeWaiters.push(resolve));
    },
    state() { return { active, queued: queue.length, actors: actors.size }; },
  };
}
export type AvatarCodec = ReturnType<typeof createAvatarCodec>;
