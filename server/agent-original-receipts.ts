import type { AgentActionReceipt } from "../src/shared/agent-actions.ts";

/** Original run identity, normalized without storage-specific rows or transaction types. */
export interface AgentOriginalReceiptRun {
  runId: string;
  ownerUserId: string;
  childId: string;
  triggerKind: "interactive" | "worker";
  sourceMessageId: string | null;
  authorizationVersion: string;
  storageEpoch: string;
}

export interface AgentOriginalActionReference {
  id: string;
  kind: AgentActionReceipt["kind"];
}

export interface AgentOriginalDocumentReceipt {
  operationId: string;
  documentId: string;
  savedVersion: number;
  contentState?: "building" | "ready" | "invalidated";
  currentVersion?: number;
  processedSources?: number;
  toolName: "generate_family_document" | "change_family_document";
}

export interface AgentOriginalDocumentReceipts {
  receipts: AgentOriginalDocumentReceipt[];
  unavailable: boolean;
  linked: boolean;
}

/** Read only inside the caller's authorized access callback. Do not retain the
 * reader across callbacks or use its methods concurrently. Errors and overflow
 * remain failures; null and unavailable never imply that an effect did not happen.
 */
export interface AgentOriginalReceiptReader {
  actionReferences(): Promise<AgentOriginalActionReference[]>;
  acceptedConfirmation(): Promise<{ proposalId: string } | null>;
  contactRequestReferences(): Promise<{ id: string }[]>;
  documentOperationReceipts(): Promise<AgentOriginalDocumentReceipts | null>;
}
