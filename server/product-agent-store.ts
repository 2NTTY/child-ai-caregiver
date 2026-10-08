import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { agentDecisionSchema, agentProposalSchema } from "../src/shared/product-agent.ts";
import { agentActionToolNames } from "../src/shared/agent-actions.ts";
import type { AgentDecision, AgentProposal, AgentProposalValue, AgentPendingPage, ProductAgentResult } from "../src/shared/product-agent.ts";
import type { AgentScope } from "./agent-runtime.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { transactionPool } from "./transaction-pool.ts";
import { canonicalJson } from "./online-routing.ts";
import { z } from "zod";
import { createSharedInputStore } from "./shared-input-store.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import { documentRequestSchema, documentChangeSchema, type DocumentRequest, type DocumentChange } from "../src/shared/family-documents.ts";
import { createConcernStore } from "./concern-store.ts";
import { summarySaveSchema } from "./memory-validation.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore, type TaskScheduling } from "./tasks.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { documentPatchIsStructural } from "./family-document-edits.ts";
import { createAgentWorkStore } from "./agent-work-store.ts";
import { createAgentConfirmationStore } from "./agent-confirmation-store.ts";
import { createAgentActionsStore } from "./agent-actions-store.ts";
import { AGENT_LIMITS } from "./agent-budget.ts";

interface RunRow {
  id: string; child_id: string; owner_user_id: string; trigger_kind: "interactive" | "worker";
  trigger_reference: string; source_message_id: string | null; authorization_version: string;
  data_version: string; recipe_id: string; state: ProductAgentResult["status"]; stop_reason: string | null;
  result_encrypted: string | null; created_at: Date; expires_at: Date;
}
interface ProposalRow { id: string; run_id: string; call_id: string; version: number; state: AgentProposal["status"];
  payload_encrypted: string; created_at: Date; expires_at: Date; is_expired?: boolean }
interface PendingProposalRow extends ProposalRow {
  child_id: string; owner_user_id: string; cursor_created_at: string; is_expired: boolean;
}
const pendingCursorSchema = z.object({
  version: z.literal(1), userId: z.string().min(1).max(128), childId: z.uuid(),
  createdAt: z.iso.datetime({ precision: 6 }), id: z.uuid(),
}).strict();
function pendingCursor(raw: string | null, userId: string, childId: string) {
  if (raw === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error();
    const cursor = pendingCursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (cursor.userId !== userId || cursor.childId !== childId) throw new Error();
    return cursor;
  } catch { throw new FamilyError(400, "invalid_input"); }
}
interface ProposalPayload { value: AgentProposalValue; result: AgentProposal["result"]; targetLabel: string | null; targetVisibility?: "private" | "family"; documentSourceBasis?: string }
export interface AgentRunClaim {
  runId: string; scope: AgentScope; created: boolean; sourceMessageId: string | null;
  state: ProductAgentResult["status"]; expiresAt: string;
}
const missing = () => new FamilyError(404, "not_found");
const aad = (run: Pick<RunRow, "id" | "child_id" | "owner_user_id">) => "agent-run:" + run.child_id + ":" + run.owner_user_id + ":" + run.id;
const proposalAad = (run: Pick<RunRow, "id" | "child_id" | "owner_user_id">, row: Pick<ProposalRow, "id" | "version">) => aad(run) + ":proposal:" + row.id + ":" + row.version;
const empty = (run: RunRow): ProductAgentResult => ({ runId: run.id, status: run.state, stopReason: run.stop_reason,
  provenance: null, countsKnown: false, text: "", citations: [], retrievalMode: "not_used", tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] });

/** Business authority for runs and confirmations, never an ADK session persistence service. */
export function createProductAgentStore(pool: Pool, cipher: StorageCipher, scheduling?: TaskScheduling) {
  const access = <T>(userId: string, childId: string, write: boolean, operation: (client: PoolClient, workspaceId: string) => Promise<T>) =>
    withChildAccess(pool, userId, childId, READ_ROLES, (client, _role, workspaceId) => operation(client, workspaceId), write);
  async function runFor(client: PoolClient, userId: string, childId: string, runId: string) {
    const row = (await client.query<RunRow>("SELECT * FROM agent_runs WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 FOR UPDATE",
      [runId, userId, childId])).rows[0];
    if (!row) throw missing(); return row;
  }
  function decodeProposal(run: Pick<RunRow, "id" | "child_id" | "owner_user_id">, row: ProposalRow): AgentProposal {
    const payload = JSON.parse(cipher.decrypt(row.payload_encrypted, proposalAad(run, row))) as ProposalPayload;
    const { documentSourceBasis: _documentSourceBasis, ...publicPayload } = payload;
    return { id: row.id, runId: run.id, childId: run.child_id, version: row.version, status: row.state === "pending" && (row.is_expired ?? row.expires_at.getTime() <= Date.now()) ? "expired" : row.state,
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), ...publicPayload };
  }
  async function publicProposal(client: PoolClient, run: Pick<RunRow, "id" | "child_id" | "owner_user_id">, row: ProposalRow): Promise<AgentProposal> {
    const proposal = decodeProposal(run, row);
    if (proposal.value.kind !== "family_document_change") return proposal;
    const payload = JSON.parse(cipher.decrypt(row.payload_encrypted, proposalAad(run, row))) as ProposalPayload;
    let valid = false;
    if (payload.documentSourceBasis) {
      const borrowed = transactionPool(client);
      try {
        const current = await createFamilyDocumentStore(borrowed.pool, cipher).validatePatch(run.owner_user_id, run.child_id,
          proposal.value.documentId, proposal.value.change, proposal.status === "accepted" ? proposal.result?.version : undefined);
        valid = current?.sourceBasis === payload.documentSourceBasis;
      } catch (error) {
        if (!(error instanceof FamilyError)) throw error;
        if (!["document_changed", "source_changed", "invalid_document_edit", "document_capacity_exceeded", "not_found"].includes(error.code)) throw error;
      } finally { borrowed.assertReleased(); }
    }
    if (valid) return { ...proposal, contentState: "ready" };
    const edits = proposal.value.change.edits.map(edit => {
      if (edit.op === "set_metadata") return { ...edit, ...(edit.title !== undefined ? { title: "內容已失效，請重新核對" } : {}),
        ...(edit.summary !== undefined ? { summary: "內容已失效，請重新核對" } : {}), ...(edit.eventDate !== undefined ? { eventDate: null } : {}) };
      if (edit.op === "upsert_section") return { ...edit, ...(edit.title !== undefined ? { title: "內容已失效，請重新核對" } : {}), ...(edit.domain !== undefined ? { domain: null } : {}) };
      if (edit.op === "upsert_item") return { ...edit, ...(edit.text !== undefined ? { text: "內容已失效，請重新核對" } : {}), sourceIds: [] };
      return edit;
    });
    return { ...proposal, contentState: "invalidated", targetLabel: null, value: { ...proposal.value, change: { ...proposal.value.change, edits } } };
  }
  async function proposals(client: PoolClient, run: RunRow): Promise<AgentProposal[]> {
    // Each run has at most eight tool calls, hence at most eight proposals.
    const rows = (await client.query<ProposalRow>("SELECT * FROM agent_proposals WHERE run_id=$1 ORDER BY created_at,id LIMIT $2",
      [run.id, AGENT_LIMITS.toolCalls + 1])).rows;
    if (rows.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "agent_proposal_limit");
    const items: AgentProposal[] = [];
    for (const row of rows) items.push(await publicProposal(client, run, row));
    return items;
  }
  async function currentScope(client: PoolClient, workspaceId: string, userId: string, childId: string): Promise<AgentScope> {
    const row = (await client.query<{ access_version: string; storage_epoch: string; change_seq: string }>(
      "SELECT access_version::text,storage_epoch,change_seq::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    return { userId, childId, workspaceId, authorizationVersion: row.access_version, dataVersion: row.storage_epoch + ":" + row.change_seq };
  }
  async function expireRun(client: PoolClient, row: RunRow) {
    const expired = (await client.query("UPDATE agent_runs SET state='unknown',stop_reason='interrupted',updated_at=now() WHERE id=$1 AND state='running' AND expires_at<=clock_timestamp() RETURNING id", [row.id])).rowCount;
    if (expired) { row.state = "unknown"; row.stop_reason = "interrupted"; }
  }
  const documentTool = (name: string) => name === "generate_family_document" || name === "change_family_document";
  type DocumentReceipt = { operationId: string; documentId: string; savedVersion: number;
    toolName: "generate_family_document" | "change_family_document" };
  async function documentReceiptsFor(client: PoolClient, workspaceId: string, run: RunRow): Promise<{
    receipts: DocumentReceipt[]; unavailable: boolean; linked: boolean;
  } | null> {
    const links = (await client.query<{ op_id: string; tool_name: DocumentReceipt["toolName"]; child_id: string; receipt_child_id: string }>(
      `SELECT a.op_id,a.tool_name,a.child_id,o.child_id AS receipt_child_id FROM agent_document_operations a
       LEFT JOIN family_document_operations o ON o.user_id=a.owner_user_id AND o.op_id=a.op_id
       WHERE a.run_id=$1 AND a.owner_user_id=$2 AND a.child_id=$3 ORDER BY a.op_id LIMIT $4`,
      [run.id, run.owner_user_id, run.child_id, AGENT_LIMITS.toolCalls + 1])).rows;
    if (links.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "document_receipt_limit");
    // No new linkage means legacy/non-document behavior; do not rewrite that historical result.
    if (!links.length) return { receipts: [], unavailable: false, linked: false };
    const current = await currentScope(client, workspaceId, run.owner_user_id, run.child_id);
    // Expiry stops execution, not authorized reads of an already committed operation.
    if (run.authorization_version.toString() !== current.authorizationVersion
      || run.data_version.split(":")[0] !== current.dataVersion.split(":")[0]) return null;
    if (run.trigger_kind !== "interactive" || !run.source_message_id || !(await client.query(
      "SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE",
      [run.source_message_id, run.child_id, run.owner_user_id])).rowCount) return null;
    const borrowed = transactionPool(client), documents = createFamilyDocumentStore(borrowed.pool, cipher);
    const receipts: DocumentReceipt[] = [];
    try {
      for (const link of links) {
        if (link.child_id !== run.child_id || link.receipt_child_id !== run.child_id || !documentTool(link.tool_name))
          throw new FamilyError(409, "document_receipt_scope_changed");
        const receipt = await documents.operationReceipt(run.owner_user_id, run.child_id, link.op_id);
        borrowed.assertReleased();
        if (receipt) receipts.push({ ...receipt, toolName: link.tool_name });
      }
    } finally { borrowed.assertReleased(); }
    const after = await currentScope(client, workspaceId, run.owner_user_id, run.child_id);
    if (after.workspaceId !== current.workspaceId || after.authorizationVersion !== current.authorizationVersion
      || after.dataVersion.split(":")[0] !== current.dataVersion.split(":")[0]) return null;
    return { receipts, unavailable: receipts.length !== links.length, linked: true };
  }
  // Durable cancellation leaves the result null; legacy finish always writes ciphertext.
  // Revisit this marker before persisting in-flight progress in result_encrypted.
  const cancelled = (run: RunRow) => run.state === "stopped" && run.stop_reason === "cancelled" && run.result_encrypted === null;
  async function cancelledResult(client: PoolClient, workspaceId: string, run: RunRow, expected?: AgentScope): Promise<ProductAgentResult | null> {
    if (!cancelled(run)) return null;
    const current = await currentScope(client, workspaceId, run.owner_user_id, run.child_id);
    if (run.trigger_kind !== "interactive" || !run.source_message_id || run.trigger_reference !== run.source_message_id
      || String(run.authorization_version) !== current.authorizationVersion
      || run.data_version.split(":")[0] !== current.dataVersion.split(":")[0]
      || expected && (expected.userId !== run.owner_user_id || expected.childId !== run.child_id
        || expected.workspaceId !== workspaceId || expected.authorizationVersion !== current.authorizationVersion
        || expected.dataVersion.split(":")[0] !== current.dataVersion.split(":")[0])) return null;
    if (!(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE",
      [run.source_message_id, run.child_id, run.owner_user_id])).rowCount) return null;
    const value = { ...empty(run), privateSourceCitations: [] };
    try {
      await client.query("UPDATE agent_proposals SET state='expired' WHERE run_id=$1 AND state='pending' AND expires_at<=clock_timestamp()", [run.id]);
      value.proposals = await proposals(client, run);
      const actionIds = (await client.query<{ id: string }>(`SELECT id FROM agent_action_receipts
        WHERE run_id=$1 AND owner_user_id=$2 AND child_id=$3 ORDER BY created_at,id LIMIT $4`,
        [run.id, run.owner_user_id, run.child_id, AGENT_LIMITS.toolCalls + 1])).rows;
      if (actionIds.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "agent_action_limit");
      const borrowed = transactionPool(client);
      try {
        const actions = await createAgentActionsStore(borrowed.pool, cipher).receipts(run.owner_user_id, run.child_id, run.id);
        borrowed.assertReleased();
        if (!actions || actions.length !== actionIds.length || actions.some(receipt => !actionIds.some(row => row.id === receipt.id)))
          throw new FamilyError(409, "agent_action_receipt_changed");
        for (const receipt of actions) value.tools.push({ name: agentActionToolNames[receipt.kind], status: "succeeded", reference: receipt.id });
        const confirmation = await createAgentConfirmationStore(borrowed.pool, cipher, async () => {
          throw new Error("A receipt read cannot decide a confirmation");
        }).recordedConfirmation(run.owner_user_id, run.child_id, run.source_message_id);
        borrowed.assertReleased();
        if (confirmation) value.tools.push({ name: "confirmed_proposal", status: "succeeded", reference: confirmation.proposalId });
      } finally { borrowed.assertReleased(); }
      const contacts = (await client.query<{ id: string }>(`SELECT r.id FROM contact_requests r
        JOIN agent_runs a ON a.id=r.run_id AND a.owner_user_id=$1 AND a.child_id=r.child_id
        WHERE r.run_id=$2 AND r.child_id=$3 ORDER BY r.created_at,r.id LIMIT $4`,
        [run.owner_user_id, run.id, run.child_id, AGENT_LIMITS.toolCalls + 1])).rows;
      if (contacts.length > AGENT_LIMITS.toolCalls) throw new FamilyError(409, "contact_receipt_limit");
      for (const receipt of contacts) value.tools.push({ name: "contact_caregiver", status: "succeeded", reference: receipt.id });
      const documents = await documentReceiptsFor(client, workspaceId, run);
      if (!documents) return null;
      if (!documents.unavailable) for (const receipt of documents.receipts)
        value.tools.push({ name: receipt.toolName, status: "succeeded", reference: receipt.documentId });
      value.text = documents.unavailable
        ? "文件操作的目前資料或來源已變，未能顯示原收據；請重新讀取目前資料，勿重複提交操作。"
        : value.tools.length ? "已有操作保存了 Server 收據；請查看原操作及目前結果，勿重複提交。已安排或入列不代表送達、成果完整或照護完成。" : "";
      return value;
    } catch {
      return { ...value, status: "unknown", stopReason: "cancelled_receipt_unavailable", tools: [],
        text: "取消已接受，但未能核對原操作收據；請查核原運行及台帳，勿重新提交同一操作。" };
    }
  }
  return {
    ...createAgentWorkStore(pool, cipher),
    ...createAgentConfirmationStore(pool, cipher, async (client, userId, childId, runId, proposalId, input): Promise<AgentProposal | null> => {
      const borrowed = transactionPool(client);
      try { return await createProductAgentStore(borrowed.pool, cipher, scheduling).decide(userId, childId, runId, proposalId, input); }
      finally { borrowed.assertReleased(); }
    }),
    async writeDocument(scope: AgentScope, runId: string, opId: string, sourceQuote: string,
      mutation: { request: DocumentRequest } | { id: string; change: DocumentChange }) {
      z.uuid().parse(opId); z.string().trim().min(2).max(1000).parse(sourceQuote);
      if ("change" in mutation && mutation.change.action === "patch" && !documentPatchIsStructural(mutation.change))
        throw new FamilyError(400, "document_confirmation_required");
      return access(scope.userId, scope.childId, true, async (client, workspaceId) => {
        const row = await runFor(client, scope.userId, scope.childId, runId);
        const current = await currentScope(client, workspaceId, scope.userId, scope.childId);
        if (row.trigger_kind !== "interactive" || row.state !== "running" || row.expires_at.getTime() <= Date.now()
          || !row.source_message_id || current.workspaceId !== scope.workspaceId
          || current.authorizationVersion !== scope.authorizationVersion || String(row.authorization_version) !== current.authorizationVersion
          || row.data_version !== current.dataVersion || scope.dataVersion.split(":")[0] !== current.dataVersion.split(":")[0])
          throw new FamilyError(409, "agent_scope_changed");
        const original = (await client.query<{ text_encrypted: string }>(
          "SELECT text_encrypted FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE",
          [row.source_message_id, scope.childId, scope.userId])).rows[0];
        if (!original || !cipher.decrypt(original.text_encrypted, `chat_messages:${row.source_message_id}:${scope.childId}:${scope.userId}:user::text`).includes(sourceQuote))
          throw new FamilyError(409, "agent_source_mismatch");
        const borrowed = transactionPool(client), documents = createFamilyDocumentStore(borrowed.pool, cipher);
        const item = "request" in mutation
          ? await documents.create(scope.userId, scope.childId, documentRequestSchema.parse(mutation.request), opId)
          : await documents.change(scope.userId, scope.childId, z.uuid().parse(mutation.id), documentChangeSchema.parse(mutation.change), opId);
        borrowed.assertReleased();
        if (!item) throw missing();
        const committed = (await client.query<{ child_id: string }>(
          "SELECT child_id FROM family_document_operations WHERE user_id=$1 AND op_id=$2", [scope.userId, opId])).rows[0];
        if (!committed || committed.child_id !== scope.childId) throw new FamilyError(409, "document_receipt_scope_changed");
        const toolName = "request" in mutation ? "generate_family_document" : "change_family_document";
        await client.query(`INSERT INTO agent_document_operations(run_id,child_id,owner_user_id,op_id,tool_name)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_user_id,op_id) DO NOTHING`, [runId, scope.childId, scope.userId, opId, toolName]);
        const link = (await client.query<{ run_id: string; child_id: string; tool_name: string; receipt_child_id: string }>(
          `SELECT a.run_id,a.child_id,a.tool_name,o.child_id AS receipt_child_id FROM agent_document_operations a
           JOIN family_document_operations o ON o.user_id=a.owner_user_id AND o.op_id=a.op_id
           WHERE a.owner_user_id=$1 AND a.op_id=$2`, [scope.userId, opId])).rows[0];
        if (!link || link.run_id !== runId || link.child_id !== scope.childId || link.receipt_child_id !== scope.childId || link.tool_name !== toolName)
          throw new FamilyError(409, "document_receipt_scope_changed");
        const after = await currentScope(client, workspaceId, scope.userId, scope.childId);
        await client.query("UPDATE agent_runs SET data_version=$2 WHERE id=$1", [runId, after.dataVersion]);
        return item;
      });
    },
    async claim(userId: string, childId: string, trigger: { kind: "interactive" | "worker"; reference: string }, recipeId: string): Promise<AgentRunClaim | null> {
      return access(userId, childId, true, async (client, workspaceId) => {
        // A trusted worker caller must first validate its current event, generation and terminal state.
        const sourceMessageId = trigger.kind === "interactive" ? trigger.reference : null;
        if (sourceMessageId && !(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND role='user'", [sourceMessageId, childId, userId])).rowCount) throw missing();
        const scope = await currentScope(client, workspaceId, userId, childId), id = randomUUID();
        const inserted = await client.query<RunRow>(
          "INSERT INTO agent_runs(id,child_id,owner_user_id,trigger_kind,trigger_reference,source_message_id,authorization_version,data_version,recipe_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'running') ON CONFLICT(owner_user_id,child_id,trigger_kind,trigger_reference) DO NOTHING RETURNING *",
          [id, childId, userId, trigger.kind, trigger.reference, sourceMessageId, scope.authorizationVersion, scope.dataVersion, recipeId]);
        const row = inserted.rows[0] ?? (await client.query<RunRow>("SELECT * FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2 AND trigger_kind=$3 AND trigger_reference=$4 FOR UPDATE",
          [userId, childId, trigger.kind, trigger.reference])).rows[0];
        await expireRun(client, row);
        return { runId: row.id, scope: { ...scope, authorizationVersion: row.authorization_version.toString(), dataVersion: row.data_version },
          created: Boolean(inserted.rowCount), sourceMessageId: row.source_message_id, state: row.state, expiresAt: row.expires_at.toISOString() };
      });
    },
    async authorize(scope: AgentScope, runId?:string): Promise<boolean> {
      return Boolean(await access(scope.userId, scope.childId, false, async (client, workspaceId) => {
        const current = await currentScope(client, workspaceId, scope.userId, scope.childId);
        const liveRun=runId?(await client.query<RunRow>("SELECT * FROM agent_runs WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND state='running' AND expires_at>now()",[runId,scope.childId,scope.userId])).rows[0]:undefined;
        if(runId&&!liveRun)return false;
        // Only a trusted tool transaction can advance this run past its own ledger write.
        // Revoke/reinvite and restore both invalidate an in-flight run.
        return current.workspaceId === scope.workspaceId && current.authorizationVersion === scope.authorizationVersion
          && current.dataVersion === (liveRun?.data_version ?? scope.dataVersion);
      }));
    },
    async cancelReply(userId: string, childId: string, messageId: string): Promise<boolean> {
      return Boolean(await access(userId, childId, true, async (client, workspaceId) => {
        const row = (await client.query<RunRow>(`SELECT * FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2
          AND trigger_kind='interactive' AND trigger_reference=$3 AND source_message_id=$3 FOR UPDATE`, [userId, childId, messageId])).rows[0];
        if (!row) return false;
        const current = await currentScope(client, workspaceId, userId, childId);
        if (String(row.authorization_version) !== current.authorizationVersion
          || row.data_version.split(":")[0] !== current.dataVersion.split(":")[0]
          || row.result_encrypted !== null
          || !(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE",
            [messageId, childId, userId])).rowCount) return false;
        await expireRun(client, row);
        if (cancelled(row)) return true;
        if (row.state !== "running") return false;
        return Boolean((await client.query("UPDATE agent_runs SET state='stopped',stop_reason='cancelled',updated_at=now() WHERE id=$1 AND state='running' RETURNING id", [row.id])).rowCount);
      }));
    },
    async readCancelled(scope: AgentScope, runId: string): Promise<ProductAgentResult | null> {
      return access(scope.userId, scope.childId, true, async (client, workspaceId) =>
        cancelledResult(client, workspaceId, await runFor(client, scope.userId, scope.childId, runId), scope));
    },
    async get(userId: string, childId: string, runId: string): Promise<ProductAgentResult | null> {
      return access(userId, childId, true, async (client, workspaceId) => {
        const row = await runFor(client, userId, childId, runId);
        await expireRun(client, row);
        if (cancelled(row)) return cancelledResult(client, workspaceId, row);
        await client.query("UPDATE agent_proposals SET state='expired' WHERE run_id=$1 AND state='pending' AND expires_at<=clock_timestamp()", [runId]);
        const saved = row.result_encrypted ? JSON.parse(cipher.decrypt(row.result_encrypted, aad(row))) as ProductAgentResult : empty(row);
        const value: ProductAgentResult = { ...saved, runId, status: row.state, stopReason: row.stop_reason, proposals: await proposals(client, row),
          tools: [...saved.tools] };
        let recorded: Awaited<ReturnType<typeof documentReceiptsFor>>;
        try { recorded = await documentReceiptsFor(client, workspaceId, row); }
        catch {
          return { ...value, status: "unknown", stopReason: "document_receipt_unavailable", text: "未能核對文件操作收據；請查核原運行結果，勿重新提交同一操作。",
            tools: value.tools.filter(tool => !documentTool(tool.name)), citations: [], privateSourceCitations: [], retrievalMode: "not_used" };
        }
        if (!recorded) return null;
        if (!recorded.linked) return value;
        value.tools = value.tools.filter(tool => !documentTool(tool.name));
        for (const receipt of recorded.receipts) if (!value.tools.some(tool => tool.name === receipt.toolName && tool.reference === receipt.documentId))
          value.tools.push({ name: receipt.toolName, status: "succeeded", reference: receipt.documentId });
        if (recorded.unavailable) return { ...value, status: value.status === "completed" ? "stopped" : value.status,
          stopReason: value.status === "completed" ? "document_source_changed" : value.stopReason,
          text: "文件操作的目前資料或來源已變，未能顯示原收據；請重新讀取目前資料，勿重複提交操作。",
          tools: value.tools.filter(tool => !documentTool(tool.name)), citations: [], privateSourceCitations: [], retrievalMode: "not_used" };
        if (recorded.receipts.length && !value.text) value.text = "文件操作已保存，但未完成文字收尾。請在準備單／成長檔案查看原文件，勿重複提交；已保存操作不代表成果完整或照護完成。";
        return value;
      });
    },
    async documentReceipts(scope: AgentScope, runId: string): Promise<{
      receipts: DocumentReceipt[]; unavailable: boolean; linked: boolean;
    } | null> {
      // Match the nested document read's authority lock, avoiding concurrent SHARE-to-UPDATE upgrades.
      return access(scope.userId, scope.childId, true, async (client, workspaceId) => {
        const run = await runFor(client, scope.userId, scope.childId, runId);
        if (workspaceId !== scope.workspaceId || run.authorization_version.toString() !== scope.authorizationVersion
          || run.data_version.split(":")[0] !== scope.dataVersion.split(":")[0]) return null;
        const recorded = await documentReceiptsFor(client, workspaceId, run);
        return recorded;
      });
    },
    async pendingProposals(userId: string, childId: string, rawCursor: string | null = null): Promise<AgentPendingPage | null> {
      const cursor = pendingCursor(rawCursor, userId, childId);
      // Document proposal validation borrows WRITE-locked stores; acquire that lock before reading the page.
      return access(userId, childId, true, async client => {
        const rows = (await client.query<PendingProposalRow>(
          `SELECT p.*,r.child_id,r.owner_user_id,
             to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
             p.expires_at<=clock_timestamp() AS is_expired
           FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id
           WHERE r.owner_user_id=$1 AND r.child_id=$2 AND p.state IN ('pending','expired')
             AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid))
           ORDER BY p.created_at DESC,p.id DESC LIMIT 21`,
          [userId, childId, cursor?.createdAt ?? null, cursor?.id ?? null])).rows;
        const page = rows.slice(0, 20), last = page.at(-1);
        const items: AgentProposal[] = [];
        for (const row of page) items.push(await publicProposal(client, { id: row.run_id, child_id: row.child_id, owner_user_id: row.owner_user_id }, row));
        return {
          proposals: items,
          nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify({ version: 1, userId, childId,
            createdAt: last.cursor_created_at, id: last.id }), "utf8").toString("base64url") : null,
        };
      });
    },
    async backgroundRuns(userId: string, childId: string) {
      return access(userId, childId, false, async client => (await client.query<{ runId: string; createdAt: Date }>(
        `SELECT id AS "runId",created_at AS "createdAt" FROM agent_runs WHERE owner_user_id=$1 AND child_id=$2 AND trigger_kind='worker' ORDER BY created_at DESC,id DESC LIMIT 20`,
        [userId, childId])).rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })));
    },
    async finish(scope: AgentScope, value: ProductAgentResult, summary?: z.infer<typeof summarySaveSchema>): Promise<boolean> {
      return Boolean(await access(scope.userId, scope.childId, true, async (client, workspaceId) => {
        const row = await runFor(client, scope.userId, scope.childId, value.runId);
        const current = await currentScope(client, workspaceId, scope.userId, scope.childId);
        if (row.state !== "running" || row.authorization_version.toString() !== current.authorizationVersion
          || row.data_version.split(":")[0] !== current.dataVersion.split(":")[0]) return false;
        if(row.data_version !== current.dataVersion){
          const contact=value.tools.filter(tool=>(["generate_family_document","change_family_document"].includes(tool.name) || tool.name==="contact_caregiver" || tool.name==="execute_ordinary_instruction" || Object.values(agentActionToolNames).includes(tool.name)) && tool.status==="succeeded" && tool.reference);
          if(!contact.length)return false;
          value={...value,status:"stopped",stopReason:"unauthorized",text:"已有操作寫入台帳；資料隨後有變，請查看原操作收據及目前狀態，勿另建重複操作。入列不代表送達或完成。",citations:[],privateSourceCitations:[],retrievalMode:"not_used",proposals:[],tools:contact};
          summary=undefined;
        }
        if (summary && row.trigger_kind === "interactive" && value.status === "completed") {
          const borrowed = transactionPool(client);
          try {
            const saved = await createMemoryStore(borrowed.pool, cipher, true).saveSummary(scope.userId, scope.childId, summary);
            borrowed.assertReleased();
            if (!saved) throw missing();
          } catch (error) {
            borrowed.assertReleased();
            // A new message or authority revision can invalidate exact coverage. Keep the prior summary.
            if (!(error instanceof FamilyError && error.status === 409)) throw error;
          }
        }
        // Even a late/cancelled result never creates another run or replays a tool.
        const { proposals: _proposals, ...result } = value;
        await client.query("UPDATE agent_runs SET state=$2,stop_reason=$3,result_encrypted=$4,updated_at=now() WHERE id=$1",
          [row.id, value.status, value.stopReason, cipher.encrypt(JSON.stringify({ ...result, proposals: [] }), aad(row))]);
        return true;
      }));
    },
    async propose(scope: AgentScope, runId: string, callId: string, raw: AgentProposalValue): Promise<AgentProposal | null> {
      const value = agentProposalSchema.parse(raw);
      if (!callId || callId.length > 200) throw new FamilyError(400, "invalid_input");
      return access(scope.userId, scope.childId, true, async (client, workspaceId) => {
        const run = await runFor(client, scope.userId, scope.childId, runId);
        const current = await currentScope(client, workspaceId, scope.userId, scope.childId);
        if (run.state !== "running" || run.expires_at.getTime() <= Date.now()
          || run.authorization_version.toString() !== current.authorizationVersion
          || run.data_version.split(":")[0] !== current.dataVersion.split(":")[0]) throw new FamilyError(409, "agent_run_expired");
        // Private conversation is never exported by a background run.
        if (run.trigger_kind !== "interactive") throw new FamilyError(400, "confirmation_requires_interactive_scope");
        const borrowed = transactionPool(client), tasks = createTaskStore(borrowed.pool, cipher, scheduling);
        const page = await tasks.list(scope.userId, scope.childId); borrowed.assertReleased();
        if (!page) throw missing();
        let targetVisibility: "private" | "family" | undefined, documentSourceBasis: string | undefined;
        let targetLabel: string | null = value.kind === "task_create" ? page.eligibleAssignees.find(person => person.userId === value.values.assigneeUserId)?.name ?? null : null;
        if (value.kind === "family_document_change") {
          const target = await createFamilyDocumentStore(borrowed.pool, cipher).validatePatch(scope.userId, scope.childId, value.documentId, value.change);
          borrowed.assertReleased(); if (!target) throw missing(); targetLabel = target.title; targetVisibility = "family"; documentSourceBasis = target.sourceBasis;
        }
        if (value.kind === "task_create" && !page.eligibleAssignees.some(person => person.userId === value.values.assigneeUserId)) throw new FamilyError(400, "invalid_assignee");
        if (value.kind === "task_change") {
          const task = await tasks.get(scope.userId, scope.childId, value.taskId); borrowed.assertReleased();
          if (!task || task.version !== value.change.expectedVersion) throw new FamilyError(409, "version_conflict");
          targetLabel = task.title + " · " + (page.eligibleAssignees.find(person => person.userId === (value.change.action === "reschedule" ? value.change.assigneeUserId : task.assigneeUserId))?.name ?? "原照顧者");
          const rescheduledAssignee = value.change.action === "reschedule" ? value.change.assigneeUserId : null;
          if (rescheduledAssignee && !page.eligibleAssignees.some(person => person.userId === rescheduledAssignee)) throw new FamilyError(400, "invalid_assignee");
        }
        if (value.kind === "concern_change") {
          const concern = await createConcernStore(borrowed.pool,cipher).get(scope.userId,scope.childId,value.concernId);
          borrowed.assertReleased();
          if(!concern || concern.version !== value.change.expectedVersion) throw new FamilyError(409,"version_conflict");
          targetLabel=concern.title;
        } else if(value.kind === "concern_create") targetLabel=value.values.title;
        if (value.kind === "private_source_change") {
          const source=await createSharedInputStore(borrowed.pool,cipher).get(scope.userId,scope.childId,value.inputId);
          borrowed.assertReleased();
          if(!source||source.version!==value.change.expectedVersion)throw new FamilyError(409,"version_conflict");
          targetLabel=source.sourceLabel;
        } else if(value.kind === "private_source_create") targetLabel=value.input.sourceLabel;
        if (value.kind === "memory_fact_revise" || value.kind === "memory_fact_deactivate") {
          const fact = await createMemoryStore(borrowed.pool, cipher, true).getFact(scope.userId, scope.childId, value.factId);
          borrowed.assertReleased();
          if (!fact || fact.version !== value.expectedVersion || fact.status === "inactive") throw new FamilyError(409, "version_conflict");
          targetLabel = fact.key; targetVisibility = fact.visibility;
          if (value.kind === "memory_fact_revise" && !(await client.query(`SELECT 1 FROM chat_messages WHERE id=$1 AND owner_user_id=$2 AND author_user_id=$2 AND child_id=$3 AND role='user'
            AND (created_at,id)<=(SELECT created_at,id FROM chat_messages WHERE id=$4 AND owner_user_id=$2 AND child_id=$3) FOR SHARE`,
            [value.sourceMessageId, scope.userId, scope.childId, run.source_message_id])).rowCount) throw new FamilyError(409, "source_changed");
        }
        if (value.kind === "memory_fact") {
          const sourceId = value.sourceMessageId ?? run.source_message_id;
          if (!sourceId || !(await client.query(`SELECT 1 FROM chat_messages WHERE id=$1 AND owner_user_id=$2 AND author_user_id=$2 AND child_id=$3 AND role='user'
            AND (created_at,id)<=(SELECT created_at,id FROM chat_messages WHERE id=$4 AND owner_user_id=$2 AND child_id=$3) FOR SHARE`, [sourceId, scope.userId, scope.childId, run.source_message_id])).rowCount) throw new FamilyError(409, "source_changed");
        }
        const previous = (await client.query<ProposalRow>("SELECT * FROM agent_proposals WHERE run_id=$1", [runId])).rows;
        const encoded = canonicalJson(value);
        for (const row of previous) {
          const decoded = decodeProposal(run, row), same = canonicalJson(decoded.value) === encoded;
          if (row.call_id === callId && !same) throw new FamilyError(409, "operation_conflict");
          if (same) return publicProposal(client, run, row);
        }
        if (previous.length >= 8) throw new FamilyError(409, "agent_proposal_limit");
        const id = randomUUID();
        const row = (await client.query<ProposalRow>("INSERT INTO agent_proposals(id,run_id,call_id,payload_encrypted) VALUES($1,$2,$3,$4) RETURNING *",
          [id, runId, callId, cipher.encrypt(JSON.stringify({ value, result: null, targetLabel, ...(targetVisibility ? { targetVisibility } : {}), ...(documentSourceBasis ? { documentSourceBasis } : {}) }), proposalAad(run, { id, version: 1 }))])).rows[0];
        return decodeProposal(run, row);
      });
    },
    async decide(userId: string, childId: string, runId: string, proposalId: string, raw: AgentDecision): Promise<AgentProposal | null> {
      const input = agentDecisionSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        const run = await runFor(client, userId, childId, runId);
        const row = (await client.query<ProposalRow>("SELECT *,expires_at<=clock_timestamp() AS is_expired FROM agent_proposals WHERE id=$1 AND run_id=$2 FOR UPDATE", [proposalId, runId])).rows[0];
        if (!row) throw missing();
        const proposal = decodeProposal(run, row), wanted = input.decision === "accept" ? "accepted" : "dismissed";
        // Exact repeat after response loss returns the already committed effect, never another task.
        if (proposal.status === wanted && proposal.version === input.expectedVersion + 1) return publicProposal(client, run, row);
        if ((proposal.status !== "pending" && proposal.status !== "expired") || proposal.version !== input.expectedVersion) throw new FamilyError(409, "version_conflict");
        if (input.decision === "accept" && proposal.status === "expired") throw new FamilyError(409, "confirmation_expired");
        // An expired dismissal only retires the candidate; it never creates a business effect.
        if (proposal.status === "pending") {
          const current = await currentScope(client, workspaceId, userId, childId);
          if (run.authorization_version.toString() !== current.authorizationVersion
            || run.data_version.split(":")[0] !== current.dataVersion.split(":")[0]) throw new FamilyError(409, "confirmation_scope_changed");
        }
        const value = proposal.value;
        const payload = JSON.parse(cipher.decrypt(row.payload_encrypted, proposalAad(run, row))) as ProposalPayload;
        if (input.decision === "accept" && value.kind === "family_document_change") {
          const borrowed = transactionPool(client);
          const current = await createFamilyDocumentStore(borrowed.pool, cipher).validatePatch(userId, childId, value.documentId, value.change);
          borrowed.assertReleased();
          if (!payload.documentSourceBasis || current?.sourceBasis !== payload.documentSourceBasis) throw new FamilyError(409, "source_changed");
        }
        let factScope: import("../src/shared/memory.ts").MemoryFact | null = null;
        if (value.kind === "memory_fact_revise" || value.kind === "memory_fact_deactivate") {
          const borrowed = transactionPool(client);
          factScope = await createMemoryStore(borrowed.pool, cipher, true).getFact(userId, childId, value.factId); borrowed.assertReleased();
          if (!factScope || factScope.version !== value.expectedVersion || factScope.status === "inactive") throw new FamilyError(409, "version_conflict");
        }
        const shared = value.kind === "family_document_change" || value.kind === "concern_create" || value.kind === "concern_change" || value.kind === "task_create" || value.kind === "task_change" || value.kind === "memory_fact" && value.intendedVisibility === "family" || Boolean(factScope && factScope.visibility === "family");
        if (input.decision === "accept" && shared && !input.confirmShared) throw new FamilyError(400, "sharing_confirmation_required");
        let result: AgentProposal["result"] = null;
        if (input.decision === "accept") {
          const borrowed = transactionPool(client);
          if (value.kind === "family_document_change") {
            const document = await createFamilyDocumentStore(borrowed.pool, cipher).change(userId, childId, value.documentId,
              { ...value.change, confirmShared: true }, row.id);
            borrowed.assertReleased(); if (!document) throw missing();
            result = { kind: "family_document", id: document.id, version: document.version };
          } else if(value.kind === "concern_create" || value.kind === "concern_change") {
            const concerns=createConcernStore(borrowed.pool,cipher);
            const concern=value.kind === "concern_create" ? await concerns.create(userId,childId,value.values,row.id)
              : await concerns.change(userId,childId,value.concernId,value.change,row.id);
            borrowed.assertReleased(); if(!concern)throw missing();
            result={kind:"concern",id:concern.id,version:concern.version};
          } else if (value.kind === "private_source_create" || value.kind === "private_source_change") {
            const sources=createSharedInputStore(borrowed.pool,cipher);
            let source;
            if(value.kind === "private_source_create") {
              source=await sources.create(userId,childId,value.input); borrowed.assertReleased();
              if(!source)throw missing();
              source=await sources.manage(userId,childId,source.id,{expectedVersion:source.version,management:value.management,content:null,reason:"本人在對話核對私人來源用途及模型片段授權"});
            } else source=await sources.manage(userId,childId,value.inputId,value.change);
            borrowed.assertReleased(); if(!source)throw missing();
            result={kind:"private_source",id:source.id,version:source.version};
          } else if (value.kind === "memory_fact_revise" || value.kind === "memory_fact_deactivate") {
            const memory = createMemoryStore(borrowed.pool, cipher, true);
            if (value.kind === "memory_fact_revise" && !(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE", [value.sourceMessageId, childId, userId])).rowCount) throw new FamilyError(409, "source_changed");
            const changed = value.kind === "memory_fact_revise" ? await memory.reviseFact(userId, childId, value.factId, {
              expectedVersion: value.expectedVersion, confirm: true, confirmShared: input.confirmShared, reason: value.reason,
              values: { key: value.key, content: value.content, validUntil: value.validUntil, source: { kind: "private_chat", messageId: value.sourceMessageId, description: "由本人聊天提出，經本人核對更正" } },
            }) : await memory.deactivateFact(userId, childId, value.factId, { expectedVersion: value.expectedVersion, reason: value.reason });
            borrowed.assertReleased(); if (!changed) throw missing();
            result = { kind: "memory_fact", id: changed.id, version: changed.version };
          } else if (value.kind === "memory_fact") {
            const sourceId = value.sourceMessageId ?? run.source_message_id;
            if (!sourceId || !(await client.query(`SELECT 1 FROM chat_messages WHERE id=$1 AND owner_user_id=$2 AND author_user_id=$2 AND child_id=$3 AND role='user'
              AND (created_at,id)<=(SELECT created_at,id FROM chat_messages WHERE id=$4 AND owner_user_id=$2 AND child_id=$3) FOR SHARE`, [sourceId, userId, childId, run.source_message_id])).rowCount) throw new FamilyError(409, "source_changed");
            const memory = createMemoryStore(borrowed.pool, cipher, true);
            const fact = await memory.createFact(userId, childId, { values: { key: value.key, content: value.content, validUntil: value.validUntil,
              source: { kind: "private_chat", messageId: sourceId, description: "由本人聊天提出，經本人核對確認" } }, intendedVisibility: value.intendedVisibility });
            borrowed.assertReleased(); if (!fact) throw missing();
            const confirmed = await memory.confirmFact(userId, childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: input.confirmShared });
            borrowed.assertReleased(); if (!confirmed) throw missing();
            result = { kind: "memory_fact", id: confirmed.id, version: confirmed.version };
          } else {
            const tasks = createTaskStore(borrowed.pool, cipher, scheduling);
            const task = value.kind === "task_create" ? await tasks.create(userId, childId, { values: value.values, confirm: true })
              : await tasks.change(userId, childId, value.taskId, value.change);
            borrowed.assertReleased(); if (!task) throw missing();
            result = { kind: "task", id: task.id, version: task.version };
          }
        }
        const updated = { id: row.id, version: row.version + 1 };
        const saved = (await client.query<ProposalRow>("UPDATE agent_proposals SET version=$2,state=$3,payload_encrypted=$4 WHERE id=$1 RETURNING *",
          [row.id, updated.version, wanted, cipher.encrypt(JSON.stringify({ value, result, targetLabel: proposal.targetLabel, ...(proposal.targetVisibility ? { targetVisibility: proposal.targetVisibility } : {}), ...(payload.documentSourceBasis ? { documentSourceBasis: payload.documentSourceBasis } : {}) }), proposalAad(run, updated))])).rows[0];
        return publicProposal(client, run, saved);
      });
    },
  };
}
export type ProductAgentStore = ReturnType<typeof createProductAgentStore>;
