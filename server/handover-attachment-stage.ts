import { z } from 'zod';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import type { SharedSelection } from '../src/shared/sharing.ts';

/** Internal reservation identity; publication still requires the original import transaction fence. */
export const attachmentImportStageSchema = z.object({
  batchId: z.uuid(), operationId: z.uuid(), actorUserId: z.string().min(1).max(256),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type AttachmentImportStage = z.infer<typeof attachmentImportStageSchema>;
export type AttachmentImportAccess = { stage: AttachmentImportStage; selection?: SharedSelection };

export function checkedAttachmentImportStage(binding: FirestoreAuthorityTransaction, raw: AttachmentImportStage,
  prior?: AttachmentImportStage): AttachmentImportStage {
  const value = domainParse(attachmentImportStageSchema, raw);
  if (value.actorUserId !== binding.actorUserId) domainReject('operation_conflict');
  if (prior && firestoreDomainHash(value) !== firestoreDomainHash(prior)) domainReject('operation_conflict');
  return value;
}
