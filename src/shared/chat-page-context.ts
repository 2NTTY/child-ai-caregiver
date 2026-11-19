import { z } from 'zod';

export const assistantPages = ['/', '/tasks', '/care', '/summary', '/growth', '/sources', '/history', '/memory',
  '/photos', '/settings', '/family', '/teachers', '/classes', '/guide', '/share', '/more', '/profile', '/contact', '/admin'] as const;
export const chatPageItemSchema = z.object({
  kind: z.enum(['task', 'record', 'document']), id: z.uuid(), version: z.number().int().positive(), snapshotId: z.uuid().optional(),
}).strict().refine(item => !item.snapshotId || item.kind === 'document');
export const chatPageContextSchema = z.object({ page: z.enum(assistantPages), item: chatPageItemSchema.optional() }).strict();
export type ChatPageItem = z.infer<typeof chatPageItemSchema>;
export type ChatPageContext = z.infer<typeof chatPageContextSchema>;
export function sameChatPageContext(a?: ChatPageContext, b?: ChatPageContext) {
  return a?.page === b?.page && a?.item?.kind === b?.item?.kind && a?.item?.id === b?.item?.id && a?.item?.version === b?.item?.version
    && a?.item?.snapshotId === b?.item?.snapshotId;
}
