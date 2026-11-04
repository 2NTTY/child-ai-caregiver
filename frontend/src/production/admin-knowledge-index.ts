import type { z } from 'zod';
import type { adminIndexVersionPageSchema, adminIndexBatchSchema, adminIndexBatchPageSchema } from '../../../src/shared/admin-knowledge-index.ts';
export { adminIndexVersionPageSchema, adminIndexBatchPageSchema, adminIndexBatchReplySchema, indexTargetLimit } from '../../../src/shared/admin-knowledge-index.ts';
export type AdminIndexVersion = z.infer<typeof adminIndexVersionPageSchema>['items'][number];
export type AdminIndexBatch = z.infer<typeof adminIndexBatchSchema>;
export type AdminIndexTarget = { versionId: string; versionHash: string };
export type AdminIndexPending = { kind: 'create'; batchId: string; payload: { opId: string; targets: AdminIndexTarget[] } }
  | { kind: 'stop' | 'resume'; batchId: string; payload: { opId: string; expectedControlVersion: number } };
type ReadState<T> = T & { status: 'unread' | 'loading' | 'ready' | 'error'; notice: string | null };
export interface AdminIndexState {
  open: boolean; versions: ReadState<z.infer<typeof adminIndexVersionPageSchema>>; batches: ReadState<z.infer<typeof adminIndexBatchPageSchema>>;
  selected: AdminIndexTarget[]; busy: boolean; pending: AdminIndexPending | null; notice: string | null;
}
export const emptyIndex = (): AdminIndexState => ({ open: false,
  versions: { items: [], nextVersionId: null, status: 'unread', notice: null },
  batches: { items: [], nextCursor: null, status: 'unread', notice: null }, selected: [], busy: false, pending: null, notice: null });
