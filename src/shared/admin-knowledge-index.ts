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
