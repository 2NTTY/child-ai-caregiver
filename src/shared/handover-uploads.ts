import { z } from 'zod';
import { handoverHeaderSchema } from './handover.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.iso.datetime({ offset: true });
export const HANDOVER_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
export const handoverUploadCommandSchema = z.object({ opId: z.uuid(), filename: z.string().trim().min(1).max(180)
  .refine(value => !/[\u0000-\u001f\u007f/\\]/u.test(value)),
  bytes: z.number().int().positive().max(HANDOVER_UPLOAD_MAX_BYTES), sha256: hash }).strict();
export const handoverUploadPreviewSchema = z.object({ header: handoverHeaderSchema, manifestSha256: hash,
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']),
  children: z.array(z.object({ id: z.uuid(), displayName: z.string().min(1).max(160) }).strict()).max(10000),
  coverage: z.array(z.object({ section: z.string().min(1).max(80), childId: z.uuid().nullable(),
    items: z.number().int().nonnegative() }).strict()).max(10000) }).strict();
export const handoverUploadStateSchema = z.enum(['reserved', 'receiving', 'ready', 'failed', 'cancelled', 'expired']);
export const handoverUploadViewSchema = z.object({ id: z.uuid(), version: z.number().int().positive(),
  filename: z.string(), bytes: z.number().int().positive(), createdAt: time, expiresAt: time,
  state: handoverUploadStateSchema, error: z.string().nullable(), preview: handoverUploadPreviewSchema.nullable() }).strict();
export type HandoverUploadCommand = z.infer<typeof handoverUploadCommandSchema>;
export type HandoverUploadPreview = z.infer<typeof handoverUploadPreviewSchema>;
export type HandoverUploadView = z.infer<typeof handoverUploadViewSchema>;
