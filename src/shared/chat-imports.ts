import { z } from 'zod';
import { importProvenanceSchema } from './import-provenance.ts';
import { chatFileMessageReferenceSchema } from './chat-files.ts';
import { voiceMessageReferenceSchema } from './voice.ts';
import { photoMessageReferenceSchema } from './photos.ts';

const uuid = z.uuid(), version = z.number().int().positive().max(2147483647);
/** Historical statements retain their source identities, never local execution credentials. */
export const importedChatContentSchema = z.object({
  id: uuid, childId: uuid, authorUserId: z.string().min(1).max(256).nullable(),
  role: z.enum(['user', 'model']), text: z.string().refine(value => value.isWellFormed()
    && !value.includes('\0') && [...value].length <= 10_000),
  inReplyTo: uuid.nullable(), createdAt: z.iso.datetime({ offset: true }),
  voice: voiceMessageReferenceSchema.optional(), file: chatFileMessageReferenceSchema.optional(),
  photo: photoMessageReferenceSchema.optional(),
}).refine(value => (value.role === 'user' ? value.authorUserId !== null && value.inReplyTo === null
  : value.authorUserId === null && value.inReplyTo !== null)
  && [value.voice, value.file, value.photo].filter(Boolean).length <= 1
  && (!(value.voice || value.file || value.photo) || value.role === 'user')
  && (!!value.text.trim() || !!value.voice || !!value.file || !!value.photo));
export const chatImportSourceSchema = importedChatContentSchema.safeExtend({ version: z.literal(1).default(1) });
export const importedChatAttachmentSchema = z.object({ kind: z.enum(['files', 'voices', 'photos']),
  resource: z.object({ id: uuid, version }).strict() }).strict();
export const importedChatMessageSchema = z.object({ id: uuid, childId: uuid, version,
  message: importedChatContentSchema,
  attachment: importedChatAttachmentSchema.nullable().default(null),
  importedFrom: importProvenanceSchema,
}).strict().refine(value => value.importedFrom.current.source.section === 'chat' || value.importedFrom.current.source.section === 'chat_imports');
export const importedChatPageSchema = z.object({ items: z.array(importedChatMessageSchema).max(20),
  nextCursor: uuid.nullable() }).strict();
export type ImportedChatMessage = z.infer<typeof importedChatMessageSchema>;
export type ImportedChatPage = z.infer<typeof importedChatPageSchema>;
export type ImportedChatAttachment = z.infer<typeof importedChatAttachmentSchema>;
