import { z } from 'zod';
import { adminTransferBatchSchema, adminTransferDigestSchema, adminTransferItemSchema } from '../src/shared/admin-knowledge-transfer.ts';

const operator = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u);
export const transferBatchSchema = adminTransferBatchSchema.extend({
  generation: z.uuid(), lastOperator: operator,
}).refine(job => job.next <= job.total && (job.next === job.total) === (job.state === 'completed')
  && (job.state !== 'failed' || job.lastFailure?.index === job.next));
export const transferResultSchema = adminTransferItemSchema.extend({ id: adminTransferDigestSchema, operator });
export type KnowledgeTransferBatch = z.infer<typeof transferBatchSchema>;
export const adminTransferView = (job: KnowledgeTransferBatch) => ({
  id: job.id, state: job.state, total: job.total, next: job.next, revision: job.revision, updatedAt: job.updatedAt, lastFailure: job.lastFailure,
});
export const transferItemId = (id: string, index: number) => id + '/' + index;
