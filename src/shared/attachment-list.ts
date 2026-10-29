import { z } from 'zod';

/** Per-request work bounds, never a limit on the number of stored attachments. */
export const ATTACHMENT_LIST_BOUNDS = Object.freeze({ maxLimit: 100, maxScan: 500, cursorCharacters: 4096 });
export const DEFAULT_ATTACHMENT_LIST_POLICY = Object.freeze({ defaultLimit: 20, maxLimit: 50, scanLimit: 100 });
export const attachmentListPolicySchema = z.object({
  defaultLimit: z.number().int().positive().max(ATTACHMENT_LIST_BOUNDS.maxLimit),
  maxLimit: z.number().int().positive().max(ATTACHMENT_LIST_BOUNDS.maxLimit),
  scanLimit: z.number().int().positive().max(ATTACHMENT_LIST_BOUNDS.maxScan),
}).strict().refine(value => value.defaultLimit <= value.maxLimit && value.maxLimit <= value.scanLimit);
export type AttachmentListPolicy = z.infer<typeof attachmentListPolicySchema>;
export const attachmentListCursorSchema = z.string().min(1).max(ATTACHMENT_LIST_BOUNDS.cursorCharacters).regex(/^[A-Za-z0-9_-]+$/u);
export const attachmentListQuerySchema = z.object({
  limit: z.number().int().positive().max(ATTACHMENT_LIST_BOUNDS.maxLimit).optional(),
  cursor: attachmentListCursorSchema.nullable().optional(),
  includeImported: z.boolean().optional(),
}).strict();
export type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;
export const attachmentListPageFields = {
  nextCursor: attachmentListCursorSchema.nullable(), complete: z.boolean(),
  scanned: z.number().int().nonnegative().max(ATTACHMENT_LIST_BOUNDS.maxScan),
  pagePolicy: attachmentListPolicySchema.optional(),
};
/** An empty bounded scan can still have another page. Creation time is not recording time. */
export function consistentAttachmentPage(value: {
  items: { id: string; createdAt: string }[]; nextCursor: string | null; complete: boolean; scanned: number;
  pagePolicy?: AttachmentListPolicy;
}) {
  return value.complete === (value.nextCursor === null) && value.items.length <= value.scanned
    && (value.complete || value.scanned > 0)
    && (!value.pagePolicy || value.items.length <= value.pagePolicy.maxLimit && value.scanned <= value.pagePolicy.scanLimit)
    && new Set(value.items.map(item => item.id)).size === value.items.length
    && value.items.every((item, index) => !index || value.items[index - 1].createdAt > item.createdAt
      || value.items[index - 1].createdAt === item.createdAt && value.items[index - 1].id > item.id);
}
