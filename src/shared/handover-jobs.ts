import { z } from 'zod';
import { handoverDocumentChoiceSchema, handoverDocumentPinSchema, handoverDocumentSectionSchema, handoverSelectionSchema, validHandoverDocumentPins } from './handover.ts';

const scopeVersion = z.string().regex(/^[a-f0-9]{64}$/u);
export const HANDOVER_EXPORT_COMMAND_BYTES = 256 * 1024;
export const handoverPreviewQuerySchema = z.object({ section: handoverDocumentSectionSchema,
  childId: z.uuid(), period: handoverSelectionSchema.shape.period, scopeVersion: scopeVersion.optional(), cursor: z.string().min(1).max(2048).optional(),
}).strict().refine(value => (!value.cursor || !!value.scopeVersion) && (!value.period || Date.parse(value.period.from) <= Date.parse(value.period.to)));
export const handoverPreviewItemSchema = handoverDocumentPinSchema.extend({ title: z.string().min(1).max(512),
  from: z.iso.date().nullable(), to: z.iso.date().nullable(),
  reason: z.enum(['all', 'inside', 'crosses', 'outside', 'uncertain', 'metadata_only']), defaultIncluded: z.boolean(), canInclude: z.boolean(),
});
export const handoverPreviewPageSchema = z.object({ items: z.array(handoverPreviewItemSchema).max(10), scopeVersion,
  nextCursor: z.string().max(2048).nullable(), avatarVersion: z.number().int().nonnegative().optional() }).strict();
export type HandoverPreviewQuery = z.infer<typeof handoverPreviewQuerySchema>;
export type HandoverPreviewPage = z.infer<typeof handoverPreviewPageSchema>;
export type HandoverPreviewItem = z.infer<typeof handoverPreviewItemSchema>;

// A class supplies its own records. The authenticated account still owns the export job.
export const handoverClassSourceSchema = z.object({ kind: z.literal('class'), spaceId: z.uuid() }).strict();
export const classHandoverModuleSchema = z.enum(['profile', 'care', 'tasks']);
export const handoverClassExportCommandSchema = z.object({
  opId: z.uuid(), purpose: z.literal('handover'), source: handoverClassSourceSchema,
  selection: handoverSelectionSchema.safeExtend({
    modules: z.array(classHandoverModuleSchema).min(1).max(classHandoverModuleSchema.options.length),
  }),
}).strict();
export type HandoverClassExportCommand = z.infer<typeof handoverClassExportCommandSchema>;

export const handoverExportCommandSchema = z.object({ opId: z.uuid(), purpose: z.enum(['handover', 'backup']),
  selection: handoverSelectionSchema, documentReview: z.object({ scopeVersion,
    choices: z.array(handoverDocumentChoiceSchema).max(1000),
    avatarVersions: z.array(z.object({childId: z.uuid(), version: z.number().int().nonnegative()}).strict()).max(10000).optional(),
  }).strict().optional() }).strict()
  .refine(({ documentReview, selection }) => {
    if (!documentReview) return true;
    const avatars = documentReview.avatarVersions ?? [];
    const expected = new Set(selection.modules.includes('attachments') ? selection.childIds : []);
    return validHandoverDocumentPins(selection, documentReview.choices) && avatars.every(item => expected.delete(item.childId)) && !expected.size;
  });
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
