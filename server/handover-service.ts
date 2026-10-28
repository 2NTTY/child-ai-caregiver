import { createHash, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePersonalHandoverPackage, type HandoverExportSource } from './handover-export.ts';
import { createFirestoreHandoverJobs, type FirestoreHandoverJob } from './firestore-handover-jobs.ts';
import { HANDOVER_OBJECT_LIMIT, type createFirebaseHandoverObjects, type HandoverObjectDescriptor } from './firebase-handover-objects.ts';
import type { FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';

type ObjectStore = ReturnType<typeof createFirebaseHandoverObjects>;
type Outcome = { state: 'completed' | 'stopped' | 'unknown' | 'deferred'; nextAt?: string };
const objectContent = (value: { bytes: number; sha256: string }) => ({ bytes: value.bytes, sha256: value.sha256 });
async function fileHash(path: string, signal: AbortSignal) {
  const hash = createHash('sha256'); let bytes = 0;
  const stream = createReadStream(path, { signal });
  for await (const part of stream) {
    bytes += part.length; if (bytes > HANDOVER_OBJECT_LIMIT) { stream.destroy(); throw Object.assign(new Error('package_size_exceeded'), { code: 'package_size_exceeded' }); }
    hash.update(part);
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** ZIP work runs outside transactions; the same durable job and immutable object survive request disconnects. */
export function createHandoverService(options: FirestoreDomainOptions & { exporter: HandoverExportSource; objects: ObjectStore;
  serverId: string; signingKey?: KeyObject; spoolRoot?: string; serverClock?: () => number }) {
  const jobs = createFirestoreHandoverJobs(options), clock = options.serverClock ?? Date.now;
  const spool = () => mkdtemp(join(options.spoolRoot ?? tmpdir(), 'yuyoufang-package-'));
  const removeSpool = (directory: string) => rm(directory, { recursive: true, force: true });
  async function processExport(work: FirestoreBackgroundWork, signal: AbortSignal): Promise<Outcome> {
    const job = await jobs.claim(work); if (!job) return { state: 'stopped' };
    let directory: string | undefined, artifact: HandoverObjectDescriptor | undefined;
    try {
      signal.throwIfAborted();
      // Reconcile a previously attempted immutable upload before rebuilding anything.
      if (job.content && job.uploadStarted) artifact = await options.objects.probe({ scope: job.objectScope, packageId: job.id, content: objectContent(job.content), signal }) ?? undefined;
      if (!artifact) {
        directory = await spool();
        const archive = await writePersonalHandoverPackage({ exporter: options.exporter, directory, ownerUserId: job.scope.ownerUserId,
          serverId: options.serverId, packageId: job.id, createdAt: job.createdAt, purpose: job.request.purpose,
          selection: job.request.selection, expectedScopeVersion: job.sourceVersion, signingKey: options.signingKey, signal });
        const content = { ...await fileHash(archive.path, signal), manifestSha256: archive.manifestSha256 };
        await jobs.prepareUpload(work, content);
        artifact = await options.objects.put({ scope: job.objectScope, packageId: job.id, source: archive.path, directory, content: objectContent(content), signal });
      }
      await jobs.publish(work, artifact);
      return { state: 'completed' };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'package_build_failed';
      await jobs.retainFailure(work, code, artifact);
      return { state: code === 'package_object_unknown' ? 'unknown' : 'stopped' };
    } finally { if (directory) await removeSpool(directory); }
  }
  async function cleanup(scope: WorkRecoveryScope, id: string, signal: AbortSignal): Promise<Outcome> {
    const job = await jobs.retire(scope, id); if (!job || job.cleaned) return { state: 'completed' };
    // An already-started request may still be settling. Never delete while the old producer can recreate the object.
    const settleAt = job.claim ? Date.parse(job.claim.until) + 300_000 : 0;
    if (settleAt > clock()) return { state: 'deferred', nextAt: new Date(settleAt).toISOString() };
    let artifact = job.artifact;
    if (!artifact && job.uploadStarted) {
      if (!job.content) return { state: 'unknown' };
      artifact = await options.objects.probe({ scope: job.objectScope, packageId: job.id, content: objectContent(job.content), signal });
      if (!artifact) return { state: 'unknown' }; // Absence is not confirmation that an unknown upload never committed.
    }
    if (artifact) await options.objects.remove({ scope: job.objectScope, packageId: job.id, descriptor: artifact, signal });
    await jobs.cleaned(job); return { state: 'completed' };
  }
  async function download(owner: string, id: string, signal?: AbortSignal) {
    const job = await jobs.downloadable(owner, id), directory = await spool();
    try {
      const file = await options.objects.read({ scope: job.objectScope, packageId: job.id, descriptor: job.artifact!, directory, signal });
      const latest = await jobs.downloadable(owner, id);
      if (latest.version !== job.version) throw new Error('Package changed during download');
      return { ...file, filename: '育有方資料包-' + job.id + '.zip', dispose: () => removeSpool(directory) };
    } catch (error) { await removeSpool(directory); throw error; }
  }
  return { create: jobs.create, get: jobs.get, list: jobs.list, cancel: jobs.cancel, processExport, cleanup, download,
    async reconcile(owner: string, id: string, signal?: AbortSignal) {
      const job = await jobs.reconcilable(owner, id);
      if (job.state === 'ready' || !job.uploadStarted || !job.content) return jobs.get(owner, id);
      const artifact = await options.objects.probe({ scope: job.objectScope, packageId: id, content: objectContent(job.content), signal });
      return artifact ? jobs.reconciled(owner, job, artifact) : jobs.get(owner, id);
    },
    /** Erasure consumer already verified the independent journal; this only settles the exact package object. */
    async erase(job: FirestoreHandoverJob, signal?: AbortSignal) {
      const result = await cleanup(job.scope, job.id, signal ?? AbortSignal.timeout(300_000));
      return result.state === 'completed';
    } };
}
