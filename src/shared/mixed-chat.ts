import { z } from 'zod';
import { assistantTaskScopeSchema } from './assistant-task-context.ts';

const id = z.uuid();
// Bounded per conversation. Roster membership and the number of conversations are independent.
export const mixedChildIdsSchema = z.array(id).min(1).max(100)
  .refine(ids => new Set(ids).size === ids.length);
export const mixedChatCreateSchema = z.strictObject({
  operationId: id, scope: assistantTaskScopeSchema, childIds: mixedChildIdsSchema,
});
export const mixedChatTextSchema = z.string().refine(value =>
  value.trim().length > 0 && value.isWellFormed() && !value.includes('\0') && [...value].length <= 10_000);
export const mixedChatAppendSchema = z.strictObject({
  operationId: id, expectedVersion: z.int().positive(), text: mixedChatTextSchema,
});
export const mixedChatScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('personal')}),
  z.strictObject({kind:z.literal('class'), spaceId:id}),
]);
export const mixedChatRoomSchema = z.strictObject({
  id, version:z.int().positive(), scope:mixedChatScopeSchema, childIds:mixedChildIdsSchema,
  createdAt:z.iso.datetime(), updatedAt:z.iso.datetime(),
});
export const mixedChatMessageSchema = z.strictObject({
  id, roomId:id, version:z.int().min(2), role:z.literal('user'), text:mixedChatTextSchema, createdAt:z.iso.datetime(),
});
export type MixedChatRoom = z.infer<typeof mixedChatRoomSchema>;
export type MixedChatMessage = z.infer<typeof mixedChatMessageSchema>;
