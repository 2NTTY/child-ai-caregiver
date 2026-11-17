import type { z } from 'zod';
import { indexGroupTargetBytes, type indexGroupViewSchema, type adminIndexVersionPageSchema, adminIndexBatchSchema, adminIndexBatchPageSchema } from '../../../src/shared/admin-knowledge-index.ts';
export { adminIndexVersionPageSchema, adminIndexBatchPageSchema, adminIndexBatchReplySchema, indexTargetLimit, indexGroupTargetLimit, indexGroupReplySchema } from '../../../src/shared/admin-knowledge-index.ts';
export type AdminIndexVersion = z.infer<typeof adminIndexVersionPageSchema>['items'][number];
export type AdminIndexBatch = z.infer<typeof adminIndexBatchSchema>;
export type AdminIndexTarget = { versionId: string; versionHash: string };
export type AdminIndexGroup = z.infer<typeof indexGroupViewSchema>;
export type AdminIndexSinglePending = { kind: 'create'; batchId: string; payload: { opId: string; targets: AdminIndexTarget[] } }
  | { kind: 'stop' | 'resume'; batchId: string; payload: { opId: string; expectedControlVersion: number } };
export type IndexGroupCommand =
  | { group: true; kind: 'create'; batchId: string; payload: { opId: string; targets: AdminIndexTarget[] } }
  | { group: true; kind: 'stop' | 'resume'; batchId: string; payload: { opId: string; versions: number[] } };
export type AdminIndexPending = AdminIndexSinglePending | IndexGroupCommand;
export async function matchesGroupTargets(group: AdminIndexGroup, targets: AdminIndexTarget[]) {
  if (group.parts.reduce((count, part) => count + part.total, 0) !== targets.length) return false;
  const bytes = await crypto.subtle.digest('SHA-256', indexGroupTargetBytes(targets));
  const actual = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return actual === group.targetDigest;
}
type ReadState<T> = T & { status: 'unread' | 'loading' | 'ready' | 'error'; notice: string | null };
export interface AdminIndexState {
  open: boolean; versions: ReadState<z.infer<typeof adminIndexVersionPageSchema>>; batches: ReadState<z.infer<typeof adminIndexBatchPageSchema>>;
  group: AdminIndexGroup | null; selected: AdminIndexTarget[]; busy: boolean; pending: AdminIndexPending | null; notice: string | null;
}
export const emptyIndex = (): AdminIndexState => ({ open: false,
  versions: { items: [], nextVersionId: null, status: 'unread', notice: null },
  batches: { items: [], nextCursor: null, status: 'unread', notice: null }, group: null, selected: [], busy: false, pending: null, notice: null });
