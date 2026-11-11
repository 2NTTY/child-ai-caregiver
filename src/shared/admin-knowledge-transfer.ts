import { z } from 'zod';

export const adminTransferDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const adminTransferPageSize = 20;
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const at = z.iso.datetime({ offset: true });
const index = z.int().min(0).max(4095);
export const adminTransferBatchSchema = z.strictObject({
  id: adminTransferDigestSchema, total: z.int().min(1).max(4096), next: z.int().min(0).max(4096),
  revision: z.int().positive(), state: z.enum(['ready', 'stopped', 'failed', 'completed']), updatedAt: at,
  lastFailure: z.strictObject({ index, sourceId, reason: z.string().regex(/^knowledge_[a-z_]{1,100}$/u), at }).nullable(),
});
export const adminTransferItemSchema = z.strictObject({
  index, sourceId, versionHash: adminTransferDigestSchema, versionId: z.uuid(), unchanged: z.boolean(),
  editionState: z.enum(['draft', 'reviewed', 'withdrawn']), at,
});
export const adminTransferListSchema = z.strictObject({
  items: z.array(adminTransferBatchSchema).max(adminTransferPageSize), nextCursor: adminTransferDigestSchema.nullable(),
});
export const adminTransferDetailSchema = z.strictObject({
  batch: adminTransferBatchSchema, items: z.array(adminTransferItemSchema).max(adminTransferPageSize), nextFrom: index.nullable(),
});
export const adminTransferReplySchema = z.strictObject({ batch: adminTransferBatchSchema });
export const adminTransferControlSchema = z.strictObject({ expectedRevision: z.int().positive() });
