import type { z } from 'zod';
import type { adminTransferListSchema, adminTransferDetailSchema } from '../../../src/shared/admin-knowledge-transfer.ts';

export type AdminTransferBatch = z.infer<typeof adminTransferListSchema>['items'][number];
type ReadState = { status: 'unread' | 'loading' | 'ready' | 'error'; notice: string | null };
export type AdminTransferPending = { digest: string; kind: 'stop' | 'resume'; expectedRevision: number };
export interface AdminTransferState {
  open: boolean; busy: boolean; pending: AdminTransferPending | null; notice: string | null;
  batches: z.infer<typeof adminTransferListSchema> & ReadState;
  detail: Omit<z.infer<typeof adminTransferDetailSchema>, 'batch'> & ReadState & { digest: string | null; batch: AdminTransferBatch | null };
}
export const emptyTransfers = (): AdminTransferState => ({ open: false, busy: false, pending: null, notice: null,
  batches: { items: [], nextCursor: null, status: 'unread', notice: null },
  detail: { digest: null, batch: null, items: [], nextFrom: null, status: 'unread', notice: null } });
