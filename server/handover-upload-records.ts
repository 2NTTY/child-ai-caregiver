import { z } from 'zod';
import { handoverUploadCommandSchema, handoverUploadPreviewSchema, handoverUploadStateSchema } from '../src/shared/handover-uploads.ts';
import { handoverCancelCommandSchema } from '../src/shared/handover-jobs.ts';
import { handoverObjectDescriptorSchema } from './firebase-handover-objects.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
export const HANDOVER_UPLOAD_RETENTION_MS = 24 * 60 * 60_000;
export const handoverUploadRecordSchema = z.object({ id: z.uuid(), version: z.number().int().positive(),
  scope: workRecoveryScopeSchema, request: handoverUploadCommandSchema, fingerprint: hash,
  state: handoverUploadStateSchema, createdAt: time, expiresAt: time, error: z.string().max(100).nullable(),
  generation: z.uuid(), authorizationVersion: z.string().min(1).max(256),
  preview: handoverUploadPreviewSchema.nullable(), artifact: handoverObjectDescriptorSchema.nullable(),
  uploadStarted: z.boolean(), cleaned: z.boolean(),
  lease: z.object({ token: z.uuid(), until: time }).strict().nullable(), cancellation: handoverCancelCommandSchema.nullable(),
}).strict();
export type HandoverUploadRecord = z.infer<typeof handoverUploadRecordSchema>;
export const handoverUploadId = (owner: string, id: string) => JSON.stringify([owner, id]);
export const handoverUploadMetadata = (job: HandoverUploadRecord) => ({ createdAt: job.createdAt, expiresAt: job.expiresAt,
  state: job.state, cleaned: job.cleaned });
export function validHandoverUpload(job: HandoverUploadRecord) {
  return job.request.opId === job.id && job.fingerprint === firestoreDomainHash(job.request)
    && job.scope.childId === '00000000-0000-0000-0000-000000000000'
    && (job.state !== 'ready' || !!job.artifact && !!job.preview && job.uploadStarted && !job.cleaned)
    && (!job.artifact || job.artifact.sha256 === job.request.sha256 && job.artifact.bytes === job.request.bytes)
    && (job.state !== 'receiving' || job.lease !== null);
}
