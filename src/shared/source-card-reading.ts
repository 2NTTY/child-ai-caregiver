import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const documentCategoriesSchema = z.strictObject({
  basis: z.enum(['publisher', 'document', 'unclassified']), labels: z.array(z.string().min(1).max(80)).max(12),
  evidence: z.string().max(300).optional(),
});
export type DocumentCategories = z.infer<typeof documentCategoriesSchema>;
export const sourceDirectoryPageSchema = z.object({
  items: z.array(z.object({ documentId: digest, version: digest, title: z.string(), mimeType: z.string(),
    url: z.url(), categories: documentCategoriesSchema, preview: z.string() })), nextCursor: z.string().nullable(),
});
/** A chat keeps a version and location. Opening it reads the account's then-authorized original. */
export const sourceFactType = z.enum(['quotation', 'visual_description']);
export const sourceReadingSchema = z.strictObject({
  cardId: z.uuid(), documentId: digest, version: digest, page: z.int().min(1).optional(), offset: z.int().nonnegative(),
  fact: z.strictObject({ type: sourceFactType, hash: digest, incarnation: z.uuid() }).optional(),
});
export type SourceReading = z.infer<typeof sourceReadingSchema>;
export const sourceReadingViewSchema = z.strictObject({ title: z.string(), excerpt: z.string(), page: z.int().min(1).nullable(),
  next: z.strictObject({ page: z.int().min(1).optional(), offset: z.int().min(0) }).nullable(), current: z.boolean(), kind: sourceFactType });
