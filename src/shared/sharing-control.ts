import { z } from 'zod';
import { sharedModuleSchema, sharedAccessBasisSchema } from './sharing.ts';

const userId = z.string().min(1).max(256);
const version = z.number().int().positive().max(2147483647);
const date = z.iso.datetime({ offset: true });
const change = { operationId: z.uuid(), spaceId: z.uuid(), expectedVersion: version };
export const sharedSpaceViewSchema = z.object({
  id: z.uuid(), kind: z.enum(['family', 'teachers']), name: z.string().min(1).max(160), version,
  role: z.enum(['owner', 'caregiver', 'viewer']), managerUserId: userId,
  transferTargetUserId: userId.nullable(), createdAt: date, updatedAt: date,
}).strict();
export const sharedMemberViewSchema = z.object({ userId, label: z.string().min(1).max(320),
  role: z.enum(['owner', 'caregiver', 'viewer']), version, joinedAt: date }).strict();
export const sharedGrantViewSchema = z.object({ childId: z.uuid(), childName: z.string().min(1).max(160),
  modules: z.array(sharedModuleSchema).min(1).max(8), sharedBy: userId, version, canWithdraw: z.boolean() }).strict();
export const sharedChildViewSchema = z.object({ spaceId:z.uuid(), spaceName:z.string().min(1).max(160),
  childId:z.uuid(), childName:z.string().min(1).max(160), role:z.enum(['owner','caregiver','viewer']),
  modules:z.array(sharedModuleSchema).min(1).max(8), basis:sharedAccessBasisSchema }).strict();
export const sharedInviteViewSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u), email: z.email(),
  role: z.enum(['caregiver', 'viewer']), expiresAt: date, state: z.enum(['issued', 'expired']) }).strict();
const page = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema).max(20), nextCursor: z.string().max(8192).nullable() }).strict();
export const sharedSpacePageSchema = page(sharedSpaceViewSchema);
export const sharedMemberPageSchema = page(sharedMemberViewSchema);
export const sharedGrantPageSchema = page(sharedGrantViewSchema);
export const sharedInvitePageSchema = page(sharedInviteViewSchema);
export const sharingCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), operationId: z.uuid(), name: z.string().trim().min(1).max(160), kind: z.literal('family') }).strict(),
  z.object({ action: z.literal('invite'), ...change, email: z.email().max(320), role: z.enum(['caregiver', 'viewer']), expiresAt: date }).strict(),
  z.object({ action: z.literal('acceptInvitation'), operationId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict(),
  z.object({ action: z.literal('share'), ...change, childId: z.uuid(), modules: z.array(sharedModuleSchema).min(1).max(8) }).strict(),
  z.object({ action: z.literal('unshare'), ...change, childId: z.uuid() }).strict(),
  z.object({ action: z.literal('proposeTransfer'), ...change, targetUserId: userId }).strict(),
  z.object({ action: z.literal('acceptTransfer'), ...change }).strict(),
  z.object({ action: z.literal('leave'), ...change }).strict(),
  z.object({ action: z.literal('updateMember'), ...change, targetUserId: userId, role: z.enum(['caregiver', 'viewer']).nullable() }).strict(),
  z.object({ action: z.literal('revokeInvitation'), ...change, invitationId: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ action: z.literal('dissolve'), ...change }).strict(),
]);
export const sharingOperationSchema = z.object({ operationId: z.uuid(), action: z.enum([
  'create', 'invite', 'acceptInvitation', 'share', 'unshare', 'proposeTransfer', 'acceptTransfer', 'leave', 'updateMember', 'revokeInvitation', 'dissolve',
]), space: sharedSpaceViewSchema.nullable(), invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
  redacted:z.literal(true).optional(),
  exit: z.object({ spaceId: z.uuid(), version, state: z.enum(['left', 'dissolved']) }).strict().optional() }).strict()
  .refine(value => value.redacted ? value.space === null && !value.invitationToken && !value.exit
    : ['leave','dissolve'].includes(value.action) ? value.space === null && !!value.exit && !value.invitationToken
    : value.space !== null && !value.exit && (!value.invitationToken || value.action === 'invite'));
export type SharingCommand = z.infer<typeof sharingCommandSchema>;
export type SharingOperation = z.infer<typeof sharingOperationSchema>;
export type SharedSpaceView = z.infer<typeof sharedSpaceViewSchema>;
export type SharedMemberView = z.infer<typeof sharedMemberViewSchema>;
export type SharedGrantView = z.infer<typeof sharedGrantViewSchema>;
export type SharedChildView = z.infer<typeof sharedChildViewSchema>;
export type SharedInviteView = z.infer<typeof sharedInviteViewSchema>;
export type SharedPage<T> = { items: T[]; nextCursor: string | null };
