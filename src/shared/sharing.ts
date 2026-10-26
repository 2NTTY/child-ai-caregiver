import { z } from 'zod';

const version = z.number().int().positive().max(2147483647);
export const sharedAccessBasisSchema = z.object({ spaceVersion: version, membershipVersion: version, shareVersion: version,
  actorAuthorizationVersion: z.string().regex(/^\d+$/u), sourceAuthorizationVersion: z.string().regex(/^\d+$/u) }).strict();
export const sharedSelectionSchema = z.object({ spaceId: z.uuid(), expectedBasis: sharedAccessBasisSchema.optional() }).strict();
export type SharedAccessBasis = z.infer<typeof sharedAccessBasisSchema>;
export type SharedSelection = z.infer<typeof sharedSelectionSchema>;
