import { z } from 'zod';

const text = z.string().min(1).max(256), time = z.iso.datetime({ offset: true });
const sourceSchema = z.object({ serverId: text, accountId: text, childId: z.uuid(), section: z.enum(['care', 'profile', 'tasks']),
  resourceId: z.uuid(), resourceVersion: z.number().int().nonnegative().max(2147483647),
  authorUserId: text.nullable(), createdAt: time.nullable(), confirmedBy: text.nullable(), confirmedAt: time.nullable(),
  confirmationBasis: z.enum(['explicit', 'preauthorized_user_statement', 'imported_source']).nullable(),
  assigneeUserId: text.nullable(),
}).strict();
export const importProvenanceLinkSchema = z.object({ source: sourceSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  packageId: z.uuid(), packageVersion: z.number().int().positive(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']), importedBy: text, importedAt: time,
}).strict();
/** Source identities are provenance, never local membership or execution authority. */
export const importProvenanceSchema = z.object({ current: importProvenanceLinkSchema,
  previous: z.array(importProvenanceLinkSchema).max(10000) }).strict();
export type ImportProvenance = z.infer<typeof importProvenanceSchema>;
