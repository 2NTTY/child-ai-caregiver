import { z } from 'zod';
import { handoverSelectionSchema } from './handover.ts';

export const handoverExportCommandSchema = z.object({ opId: z.uuid(), purpose: z.enum(['handover', 'backup']),
  selection: handoverSelectionSchema }).strict();
export const handoverExportStateSchema = z.enum(['queued', 'building', 'ready', 'cancelled', 'failed', 'expired']);
export const handoverExportViewSchema = z.object({ id: z.uuid(), version: z.number().int().positive(),
  purpose: z.enum(['handover', 'backup']), selection: handoverSelectionSchema, state: handoverExportStateSchema,
  createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  bytes: z.number().int().positive().nullable(), error: z.string().max(100).nullable(),
}).strict();
export const handoverCancelCommandSchema = z.object({ opId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();
export const handoverExportPageSchema = z.object({ items: z.array(handoverExportViewSchema).max(20),
  nextCursor: z.string().max(2048).nullable() }).strict();
export type HandoverExportCommand = z.infer<typeof handoverExportCommandSchema>;
export type HandoverExportView = z.infer<typeof handoverExportViewSchema>;
