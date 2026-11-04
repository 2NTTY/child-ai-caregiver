import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const operator = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u);
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const at = z.iso.datetime({ offset: true });
const offset = z.int().min(0).max(4095);
export const transferBatchSchema = z.strictObject({
  id: digest, total: z.int().min(1).max(4096), next: z.int().min(0).max(4096),
  revision: z.int().positive(), generation: z.uuid(), state: z.enum(['ready', 'stopped', 'failed', 'completed']),
  lastOperator: operator, updatedAt: at,
  lastFailure: z.strictObject({ index: offset, sourceId, reason: z.string().regex(/^knowledge_[a-z_]{1,100}$/u), at }).nullable(),
}).refine(job => job.next <= job.total && (job.next === job.total) === (job.state === 'completed')
  && (job.state !== 'failed' || job.lastFailure?.index === job.next));
export const transferResultSchema = z.strictObject({
  id: digest, index: offset, sourceId, versionHash: digest, versionId: z.uuid(), unchanged: z.boolean(),
  editionState: z.enum(['draft', 'reviewed', 'withdrawn']), operator, at,
});
export type KnowledgeTransferBatch = z.infer<typeof transferBatchSchema>;
export const transferItemId = (id: string, index: number) => id + '/' + index;
