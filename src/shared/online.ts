import type { SharedAccessBasis, SharedSelection } from './sharing.ts';
/** Online receipts are not an offline queue or a local business database. */
export interface OnlineContext { workspaceId: string; storageEpoch: string; sharingBasis?: SharedAccessBasis }
export interface OnlineIdentity extends Pick<OnlineContext, 'workspaceId' | 'storageEpoch'> { opId: string; deviceId: string }
export interface OnlineCommand { path: string; payload: unknown; sharing?: SharedSelection }
export interface OnlineSubmission extends OnlineCommand { operation: OnlineIdentity }
export interface OnlineReceipt {
  state: "confirmed";
  path?: string;
  operation: OnlineIdentity;
  changeSeq: string;
  statusCode: number;
  /** Null after deletion or when the original result is no longer safe to disclose. */
  result: unknown | null;
}
export interface OnlineChange {
  changeSeq: string;
  kind: "children" | "care" | "profile" | "chat" | "family" | "preferences" | "memory" | "tasks" | "growth" | "documents";
  childId: string | null;
  deleted: boolean;
}
export interface OnlineChanges extends OnlineContext {
  accessVersion: number;
  cursor: string;
  changes: OnlineChange[];
  hasMore: boolean;
}
