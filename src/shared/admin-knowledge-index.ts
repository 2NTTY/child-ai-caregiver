import { z } from 'zod';

export const indexTargetLimit = 50;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), date = z.iso.datetime({ offset: true });
export const adminIndexVersionPageSchema = z.object({ items: z.array(z.object({ id: z.uuid(), sourceId: z.string().min(1),
  hash, state: z.string().min(1), publishedAt: date.nullable(), searchReady: z.boolean() }).strict()).max(20), nextVersionId: z.uuid().nullable() }).strict();
export const adminIndexBatchSchema = z.object({ id: z.uuid(), state: z.enum(['running', 'paused', 'interrupted', 'completed', 'failed']),
  controlVersion: z.number().int().positive(), createdAt: date, updatedAt: date,
  targets: z.array(z.object({ versionId: z.uuid(), versionHash: hash, state: z.enum(['pending', 'completed', 'failed']),
    bucketsCompleted: z.number().int().nonnegative(), error: z.string().nullable() }).strict()).min(1).max(indexTargetLimit) }).strict();
export const adminIndexBatchPageSchema = z.object({ items: z.array(adminIndexBatchSchema).max(20), nextCursor: z.string().min(1).max(2048).nullable() }).strict();
export const adminIndexBatchReplySchema = z.object({ batch: adminIndexBatchSchema.nullable() }).strict();
export const indexVersionTargetSchema = adminIndexBatchSchema.shape.targets.element.pick({ versionId: true, versionHash: true });


// Fits the existing 64 KiB HTTP transport while each worker still processes at most 50 versions.
export const indexGroupParts = 8;
export const indexGroupTargetLimit = indexGroupParts * indexTargetLimit;
export const indexGroupCreateSchema = z.strictObject({opId:z.uuid(),
  targets:z.array(indexVersionTargetSchema).min(indexTargetLimit+1).max(indexGroupTargetLimit)})
  .refine(value=>new Set(value.targets.map(target=>target.versionId)).size===value.targets.length);
export const indexGroupControlSchema = z.strictObject({opId:z.uuid(),versions:z.array(z.int().positive()).min(2).max(indexGroupParts)});
export function indexGroupTargetBytes(targets:readonly z.infer<typeof indexVersionTargetSchema>[]) {
  return new TextEncoder().encode(JSON.stringify(targets.map(t=>[t.versionId,t.versionHash])));
}
export const indexGroupViewSchema = z.strictObject({id:z.uuid(),targetDigest:hash,parts:z.array(z.strictObject({
  id:z.uuid(),controlVersion:z.int().positive(),state:adminIndexBatchSchema.shape.state,total:z.int().positive().max(indexTargetLimit),
  completed:z.int().nonnegative(),failed:z.int().nonnegative(),
})).min(2).max(indexGroupParts)});
export const indexGroupReplySchema=z.strictObject({group:indexGroupViewSchema.nullable()});
