import { z } from 'zod';
import { taskValuesSchema, taskChangeSchema, taskDueAtSchema, taskTimeZoneSchema } from './tasks.ts';

const id=z.uuid(), version=z.int().min(1).max(2147483647);
const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const targets=z.array(z.strictObject({childId:id,taskId:id,expectedVersion:version})).min(1).max(100)
  .refine(list=>new Set(list.map(item=>item.taskId)).size===list.length);
const [rescheduleTask,completeTask,cancelTask]=taskChangeSchema.options;
export const mixedBatchActionSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('create'),title:taskValuesSchema.shape.title,details:taskValuesSchema.shape.details,
    type:taskValuesSchema.shape.kind,dueAt:taskDueAtSchema,timeZone:taskTimeZoneSchema,
    childIds:z.array(id).min(1).max(100).refine(list=>new Set(list).size===list.length).optional()}),
  z.strictObject({kind:z.literal('complete'),targets,note:completeTask.shape.note}),
  z.strictObject({kind:z.literal('cancel'),targets,note:cancelTask.shape.note}),
  z.strictObject({kind:z.literal('reschedule'),targets,note:rescheduleTask.shape.note,dueAt:taskDueAtSchema,timeZone:taskTimeZoneSchema}),
]);
export type MixedBatchAction=z.infer<typeof mixedBatchActionSchema>;
export const mixedBatchItemSchema=z.strictObject({
  childId:id,childName:z.string().min(1).max(160),taskId:id.nullable(),title:taskValuesSchema.shape.title,
  expectedVersion:version.nullable(),operationId:id,status:z.enum(['pending','completed','skipped','conflict','failed','cancelled']),
  version:version.nullable(),reason:z.string().max(100).nullable(),
});
export const mixedTaskBatchSchema=z.strictObject({
  id,runId:id,digest,state:z.enum(['awaiting_confirmation','running','cancelled','partial','completed']),
  action:mixedBatchActionSchema,items:z.array(mixedBatchItemSchema).min(1).max(100),
});
export type MixedTaskBatch=z.infer<typeof mixedTaskBatchSchema>;
export const mixedBatchControlSchema=z.strictObject({action:z.enum(['confirm','cancel']),digest});
export const mixedBatchAdvanceSchema=z.strictObject({digest,position:z.int().nonnegative().max(99)});
