import type { PoolClient } from "pg";
import type { AgentOriginalDocumentReceipt, AgentOriginalReceiptReader, AgentOriginalReceiptRun } from "./agent-original-receipts.ts";
import { createAgentActionsStore } from "./agent-actions-store.ts";
import { AGENT_LIMITS } from "./agent-budget.ts";
import { createAgentConfirmationStore } from "./agent-confirmation-store.ts";
import { FamilyError } from "./family-access.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { transactionPool } from "./transaction-pool.ts";

/** The caller must already hold its workspace/run authority locks. This short-lived
 * reader borrows only that leased client, sequentially; it owns no outer transaction.
 */
export function createPostgresAgentOriginalReceiptReader(client: PoolClient, cipher: StorageCipher,
  workspaceId: string, run: AgentOriginalReceiptRun): AgentOriginalReceiptReader {
  const borrowed = transactionPool(client);
  async function documentAuthority() {
    const row = (await client.query<{ access_version: string; storage_epoch: string; change_seq: string }>(
      "SELECT access_version::text,storage_epoch,change_seq::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    return { authorizationVersion: row.access_version, storageEpoch: row.storage_epoch };
  }
  return {
    async actionReferences() {
      const actionIds = (await client.query<{ id: string }>(`SELECT id FROM agent_action_receipts
        WHERE run_id=$1 AND owner_user_id=$2 AND child_id=$3 ORDER BY created_at,id LIMIT $4`,
        [run.runId, run.ownerUserId, run.childId, AGENT_LIMITS.toolCalls + 1])).rows;
      if (actionIds.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "agent_action_limit");
      try {
        const actions = await createAgentActionsStore(borrowed.pool, cipher).receipts(run.ownerUserId, run.childId, run.runId);
        borrowed.assertReleased();
        if (!actions || actions.length !== actionIds.length || actions.some(receipt => !actionIds.some(row => row.id === receipt.id)))
          throw new FamilyError(409, "agent_action_receipt_changed");
        return actions.map(receipt => ({ id: receipt.id, kind: receipt.kind }));
      } finally { borrowed.assertReleased(); }
    },
    async acceptedConfirmation() {
      if (!run.sourceMessageId) return null;
      try {
        const confirmation = await createAgentConfirmationStore(borrowed.pool, cipher, async () => {
          throw new Error("A receipt read cannot decide a confirmation");
        }).recordedConfirmation(run.ownerUserId, run.childId, run.sourceMessageId);
        borrowed.assertReleased();
        return confirmation;
      } finally { borrowed.assertReleased(); }
    },
    async contactRequestReferences() {
      const contacts = (await client.query<{ id: string }>(`SELECT r.id FROM contact_requests r
        JOIN agent_runs a ON a.id=r.run_id AND a.owner_user_id=$1 AND a.child_id=r.child_id
        WHERE r.run_id=$2 AND r.child_id=$3 ORDER BY r.created_at,r.id LIMIT $4`,
        [run.ownerUserId, run.runId, run.childId, AGENT_LIMITS.toolCalls + 1])).rows;
      if (contacts.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "contact_receipt_limit");
      return contacts.map(receipt => ({ id: receipt.id }));
    },
    async documentOperationReceipts() {
      const links = (await client.query<{ op_id: string; tool_name: AgentOriginalDocumentReceipt["toolName"]; child_id: string; receipt_child_id: string }>(
        `SELECT a.op_id,a.tool_name,a.child_id,o.child_id AS receipt_child_id FROM agent_document_operations a
         LEFT JOIN family_document_operations o ON o.user_id=a.owner_user_id AND o.op_id=a.op_id
         WHERE a.run_id=$1 AND a.owner_user_id=$2 AND a.child_id=$3 ORDER BY a.op_id LIMIT $4`,
        [run.runId, run.ownerUserId, run.childId, AGENT_LIMITS.toolCalls + 1])).rows;
      if (links.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "document_receipt_limit");
      // No new linkage means legacy/non-document behavior; retain that historical result.
      if (!links.length) return { receipts: [], unavailable: false, linked: false };
      const current = await documentAuthority();
      // Expiry stops execution, not authorized reads of an already committed operation.
      if (run.authorizationVersion !== current.authorizationVersion || run.storageEpoch !== current.storageEpoch) return null;
      if (run.triggerKind !== "interactive" || !run.sourceMessageId || !(await client.query(
        "SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE",
        [run.sourceMessageId, run.childId, run.ownerUserId])).rowCount) return null;
      const documents = createFamilyDocumentStore(borrowed.pool, cipher), receipts: AgentOriginalDocumentReceipt[] = [];
      try {
        for (const link of links) {
          if (link.child_id !== run.childId || link.receipt_child_id !== run.childId
            || link.tool_name !== "generate_family_document" && link.tool_name !== "change_family_document")
            throw new FamilyError(409, "document_receipt_scope_changed");
          const receipt = await documents.operationReceipt(run.ownerUserId, run.childId, link.op_id);
          borrowed.assertReleased();
          if (receipt) receipts.push({ ...receipt, toolName: link.tool_name });
        }
      } finally { borrowed.assertReleased(); }
      const after = await documentAuthority();
      if (after.authorizationVersion !== current.authorizationVersion || after.storageEpoch !== current.storageEpoch) return null;
      return { receipts, unavailable: receipts.length !== links.length, linked: true };
    },
  };
}
