import { z } from 'zod';
import { taskDueAtSchema } from './tasks.ts';

// Limits apply to one read. Roster and task pages can both be continued.
export const scopeTaskChildrenPerRead = 5;
export const scopeTasksPerChild = 8;
const id = z.uuid(), version = z.int().positive();
const cursor = z.strictObject({ afterId: id, basis: z.string().regex(/^[0-9a-f]{64}$/u) });
export const assistantTaskScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal') }),
  z.strictObject({ kind: z.literal('class'), spaceId: id, spaceVersion: version, teacherSpaceVersion: version.nullable() }),
]);
export const assistantTaskContextRequestSchema = z.strictObject({
  scope: assistantTaskScopeSchema,
  targets: z.array(z.strictObject({ childId: id, cursor: cursor.optional() })).min(1).max(scopeTaskChildrenPerRead)
    .refine(items => new Set(items.map(item => item.childId)).size === items.length),
});
export const assistantTaskContextPageSchema = z.strictObject({
  children: z.array(z.strictObject({
    childId: id, childName: z.string().min(1).max(160),
    tasks: z.array(z.strictObject({ id, version, title: z.string(), dueAt: taskDueAtSchema,
      state: z.enum(['scheduled', 'completed', 'cancelled', 'needs_review']) })).max(scopeTasksPerChild),
    nextCursor: cursor.nullable(),
  })).max(scopeTaskChildrenPerRead),
});
export type AssistantTaskContextRequest = z.infer<typeof assistantTaskContextRequestSchema>;
export type AssistantTaskContextPage = z.infer<typeof assistantTaskContextPageSchema>;
