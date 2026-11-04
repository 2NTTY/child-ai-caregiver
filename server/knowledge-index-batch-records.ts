import { z } from 'zod';
import { adminIndexBatchSchema, indexTargetLimit, indexVersionTargetSchema } from '../src/shared/admin-knowledge-index.ts';
import { KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS } from './knowledge-lexical-index.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const positive = z.int().positive().max(2147483647), timestamp = z.iso.datetime({ offset: true });

const target = indexVersionTargetSchema.extend({
  state: z.enum(['pending', 'completed', 'failed']),
  bucketsCompleted: z.int().min(0).max(KNOWLEDGE_LEXICAL_BUCKETS).multipleOf(KNOWLEDGE_LEXICAL_BATCH),
  error: z.string().min(1).max(96).nullable()
}).refine(v => (v.state === 'failed') === (v.error !== null)
  && (v.state === 'completed') === (v.bucketsCompleted === KNOWLEDGE_LEXICAL_BUCKETS));
export const indexBatchCreateSchema = z.strictObject({ opId: uuid, targets: z.array(indexVersionTargetSchema).min(1).max(indexTargetLimit) })
  .refine(v => new Set(v.targets.map(t => t.versionId)).size === v.targets.length);
export const indexBatchControlSchema = z.strictObject({ opId: uuid, expectedControlVersion: positive });
export const indexBatchSchema = adminIndexBatchSchema.extend({
  controlVersion: positive, recordVersion: positive, actorId: z.string().min(1).max(128),
  generation: uuid, workId: hash, lastDispatchRevision: z.int().nonnegative().default(0), createdAt: timestamp, updatedAt: timestamp, targets: z.array(target).min(1).max(indexTargetLimit)
})
  .refine(v => new Set(v.targets.map(t => t.versionId)).size === v.targets.length
    && v.recordVersion >= v.controlVersion
    && (v.state === 'completed' || v.state === 'failed') === v.targets.every(t => t.state !== 'pending')
    && (v.state !== 'completed' || v.targets.every(t => t.state === 'completed'))
    && (v.state !== 'failed' || v.targets.some(t => t.state === 'failed')));
export const indexBatchReceiptSchema = z.strictObject({
  opId: uuid, batchId: uuid, actorId: z.string().min(1).max(128),
  action: z.enum(['create', 'stop', 'resume']), fingerprint: hash, controlVersion: positive, at: timestamp
});
export type IndexBatch = z.infer<typeof indexBatchSchema>;
export function indexBatchView(batch: IndexBatch): z.infer<typeof adminIndexBatchSchema> {
  const { id, state, controlVersion, createdAt, updatedAt, targets } = batch;
  return { id, state, controlVersion, createdAt, updatedAt, targets };
}
export const indexBatchSort = (batch: Pick<IndexBatch, 'id' | 'createdAt'>) => batch.createdAt + '/' + batch.id;
