import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handoverHeaderSchema } from '../src/shared/handover.ts';
import { createFirestoreHandoverUploads } from './firestore-handover-uploads.ts';
import { receiveHandoverUpload } from './handover-upload-reader.ts';
import { openHandoverImport } from './handover-import.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { createFirebaseHandoverObjects, HandoverObjectDescriptor } from './firebase-handover-objects.ts';
import type { HandoverUploadRecord } from './handover-upload-records.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

type Outcome = { state: 'completed' | 'unknown' | 'deferred'; nextAt?: string };
/** Same ZIP verifier and encrypted immutable objects as exports; no domain data is imported here. */
export function createHandoverUploadService(options: FirestoreDomainOptions & {
  objects: ReturnType<typeof createFirebaseHandoverObjects>; spoolRoot?: string; serverClock?: () => number;
  trustedKeys?: Parameters<typeof openHandoverImport>[0]['trustedKeys'];
}) {
  const uploads = createFirestoreHandoverUploads(options), clock = options.serverClock ?? Date.now;
  async function receive(owner: string, id: string, source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
    const upload = await uploads.claim(owner, id); if (!upload) return uploads.get(owner, id);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
    let staged: Awaited<ReturnType<typeof receiveHandoverUpload>> | undefined, artifact: HandoverObjectDescriptor | undefined;
    try {
      staged = await receiveHandoverUpload({ source, content: upload.request, signal: deadline,
        spoolRoot: options.spoolRoot, trustedKeys: options.trustedKeys });
      const reader = staged.reader;
      const { entries: _entries, coverage: _coverage, ...header } = reader.manifest;
      const preview = { header: handoverHeaderSchema.parse(header), manifestSha256: reader.manifestSha256,
        integrity: reader.integrity, children: reader.children,
        coverage: reader.manifest.coverage.map(({ section, childId, items }) => ({ section, childId, items })) };
      await uploads.beforeObject(upload);
      artifact = await options.objects.put({ scope: upload.scope, packageId: upload.id, source: staged.path,
        directory: staged.directory, content: { bytes: upload.request.bytes, sha256: upload.request.sha256 }, signal: deadline });
      await uploads.publish(upload, artifact, preview);
      return uploads.get(owner, id);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'package_upload_failed';
      await uploads.failed(upload, code, artifact); throw error;
    } finally { await staged?.dispose(); }
  }
  async function open(owner: string, id: string, signal: AbortSignal) {
    const job = await uploads.readable(owner, id), directory = await mkdtemp(join(options.spoolRoot ?? tmpdir(), 'yuyoufang-import-'));
    let reader: Awaited<ReturnType<typeof openHandoverImport>> | undefined;
    const dispose = async () => { try { await reader?.close(); } finally { await rm(directory, { recursive: true, force: true }); } };
    try {
      const file = await options.objects.read({ scope: job.scope, packageId: id, descriptor: job.artifact!, directory, signal });
      reader = await openHandoverImport({ path: file.path, trustedKeys: options.trustedKeys, signal });
      if (reader.manifestSha256 !== job.preview!.manifestSha256 || (await uploads.readable(owner, id)).version !== job.version)
        throw Object.assign(new Error('package_upload_changed'), { code: 'package_upload_changed', status: 409 });
      return { job, reader, directory, dispose };
    } catch (error) { await dispose(); throw error; }
  }
  async function cleanup(scope: WorkRecoveryScope, id: string, signal: AbortSignal): Promise<Outcome> {
    const job = await uploads.retire(scope, id); if (!job || job.cleaned) return { state: 'completed' };
    const settleAt = job.lease ? Date.parse(job.lease.until) + 300_000 : 0;
    if (clock() < settleAt) return { state: 'deferred', nextAt: new Date(settleAt).toISOString() };
    let artifact = job.artifact;
    if (!artifact && job.uploadStarted) {
      artifact = await options.objects.probe({ scope: job.scope, packageId: job.id,
        content: { bytes: job.request.bytes, sha256: job.request.sha256 }, signal });
      if (!artifact) return { state: 'unknown' };
    }
    if (artifact) await options.objects.remove({ scope: job.scope, packageId: job.id, descriptor: artifact, signal });
    await uploads.cleaned(job); return { state: 'completed' };
  }
  return { create: uploads.create, get: uploads.get, list: uploads.list, cancel: uploads.cancel, receive, open, cleanup, assertImportableIn: uploads.assertImportableIn,
    async erase(job: HandoverUploadRecord, signal?: AbortSignal) {
      return (await cleanup(job.scope, job.id, signal ?? AbortSignal.timeout(300_000))).state === 'completed';
    } };
}
