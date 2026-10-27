import { z } from 'zod';

const version = z.number().int().positive().max(2147483647);
export const sharedModuleSchema = z.enum(['profile', 'care', 'memory', 'tasks', 'documents', 'growth', 'concerns', 'attachments']);
export type SharedModule = z.infer<typeof sharedModuleSchema>;
export const sharedAccessBasisSchema = z.object({ spaceVersion: version, membershipVersion: version, shareVersion: version,
  actorAuthorizationVersion: z.string().regex(/^\d+$/u), sourceAuthorizationVersion: z.string().regex(/^\d+$/u) }).strict();
export const sharedSelectionSchema = z.object({ spaceId: z.uuid(), expectedBasis: sharedAccessBasisSchema.optional() }).strict();
export type SharedAccessBasis = z.infer<typeof sharedAccessBasisSchema>;
export type SharedSelection = z.infer<typeof sharedSelectionSchema>;
export const sharedRefreshSelectionSchema = z.object({spaceId:z.uuid(),childId:z.uuid(),module:sharedModuleSchema}).strict();
export const sharedChangesQuerySchema = sharedRefreshSelectionSchema.extend({cursor:z.string().min(1).max(8192).optional()}).strict();
export const sharedChangesPageSchema = sharedRefreshSelectionSchema.extend({cursor:z.string().min(1).max(8192),changed:z.boolean(),hasMore:z.boolean()}).strict();
export type SharedRefreshSelection = z.infer<typeof sharedRefreshSelectionSchema>;
export type SharedChangesQuery = z.infer<typeof sharedChangesQuerySchema>;
export type SharedChangesPage = z.infer<typeof sharedChangesPageSchema>;
