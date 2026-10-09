import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import type { AgentScope } from "./agent-runtime.ts";
import type { AgentDecision, AgentProposal } from "../src/shared/product-agent.ts";
import type { AgentConfirmation } from "../src/shared/agent-work.ts";
import { requestAgentConfirmationSchema } from "../src/shared/agent-work.ts";
import { buildAgentConfirmationQuestion, isExplicitAgentConsent } from "./agent-work-tool-descriptions.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import { transactionPool } from "./transaction-pool.ts";
import { canonicalJson } from "./online-routing.ts";
import type { StorageCipher } from "./storage-crypto.ts";
interface Row {
  id: string; owner_user_id: string; child_id: string; asking_run_id: string; proposal_run_id: string; proposal_id: string;
  proposal_version: number; authorization_version: string; storage_epoch: string; policy_version: number;
  work_id: string | null; work_version: number | null; state: string; ask_message_id: string | null; response_message_id: string | null;
  payload_encrypted: string; expires_at: Date;
}
interface Payload { hash: string; question: string; shared: boolean; result: AgentProposal | null }
const aad = (userId: string, childId: string, id: string) => `agent-confirmation:${childId}:${userId}:${id}`;
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const conflict = (code: string) => new FamilyError(409, code);
type Decide = (client: PoolClient, userId: string, childId: string, runId: string, proposalId: string, input: AgentDecision) => Promise<AgentProposal | null>;
export function createAgentConfirmationStore(pool: Pool, cipher: StorageCipher, decide: Decide) {
  const access = <T>(userId: string, childId: string, fn: (client: PoolClient, workspaceId: string) => Promise<T>) =>
    withChildAccess(pool, userId, childId, READ_ROLES, (client, _role, workspaceId) => fn(client, workspaceId), true);
  const decode = (row: Row): Payload => JSON.parse(cipher.decrypt(row.payload_encrypted, aad(row.owner_user_id, row.child_id, row.id)));
  async function proposal(client: PoolClient, userId: string, childId: string, runId: string, id: string) {
    const row = (await client.query<{ id: string; version: number; state: AgentProposal["status"]; created_at: Date; expires_at: Date; payload_encrypted: string; authorization_version: string; data_version: string }>(`SELECT p.*,r.authorization_version::text,r.data_version
      FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id WHERE p.id=$1 AND p.run_id=$2 AND r.owner_user_id=$3 AND r.child_id=$4 FOR UPDATE OF p`, [id, runId, userId, childId])).rows[0];
    if (!row) throw new FamilyError(404, "not_found");
    const saved = JSON.parse(cipher.decrypt(row.payload_encrypted, `agent-run:${childId}:${userId}:${runId}:proposal:${id}:${row.version}`));
    return { row, documentSourceBasis: saved.documentSourceBasis as string | undefined, value: { id, runId, childId, version: row.version, status: row.state, createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(), ...saved } as AgentProposal };
  }
  async function scope(client: PoolClient, workspaceId: string, userId: string, childId: string) {
    const row = (await client.query<{ access_version: string; storage_epoch: string }>("SELECT access_version::text,storage_epoch::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    const policy = (await client.query<{ version: number }>("SELECT version FROM agent_operation_policies WHERE user_id=$1 AND child_id=$2", [userId, childId])).rows[0];
    return { ...row, policyVersion: policy?.version ?? 0 };
  }
  async function acceptedReceipt(client: PoolClient, workspaceId: string, userId: string, childId: string, responseMessageId: string, lock: boolean): Promise<AgentProposal | null> {
    // Both read paths share the caller's authorized transaction, never a second connection.
    const current = (await client.query<{ access_version: string; storage_epoch: string }>(
      "SELECT access_version::text,storage_epoch::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
    const rows = (await client.query<Row & { proposal_owner: string; proposal_child: string;
      proposal_authorization: string; proposal_epoch: string; proposal_state: string; saved_proposal_version: number; verified_response_id: string | null }>(`SELECT c.*,
        r.owner_user_id AS proposal_owner,r.child_id AS proposal_child,r.authorization_version::text AS proposal_authorization,
        split_part(r.data_version,':',1) AS proposal_epoch,p.state AS proposal_state,p.version AS saved_proposal_version,
        m.id AS verified_response_id
      FROM agent_confirmations c
      LEFT JOIN agent_runs r ON r.id=c.proposal_run_id
      LEFT JOIN agent_proposals p ON p.id=c.proposal_id AND p.run_id=r.id
      LEFT JOIN chat_messages m ON m.id=c.response_message_id AND m.owner_user_id=c.owner_user_id
        AND m.child_id=c.child_id AND m.author_user_id=c.owner_user_id AND m.role='user'
      WHERE c.owner_user_id=$1 AND c.child_id=$2 AND c.response_message_id=$3 AND c.state='accepted'
      ORDER BY c.id LIMIT 2${lock ? " FOR UPDATE OF c" : ""}`, [userId, childId, responseMessageId])).rows;
    if (rows.length > 1) throw conflict("confirmation_receipt_limit");
    const row = rows[0];
    if (!row) return null;
    if (!current || row.verified_response_id !== responseMessageId
      || String(row.authorization_version) !== current.access_version || row.storage_epoch !== current.storage_epoch
      || row.proposal_owner !== userId || row.proposal_child !== childId || row.proposal_state !== "accepted"
      || row.proposal_authorization !== current.access_version || row.proposal_epoch !== current.storage_epoch)
      throw conflict("confirmation_receipt_changed");
    // Expiration limits a new decision, never hides an already committed effect.
    const result = decode(row).result;
    if (!result?.result || result.id !== row.proposal_id || result.runId !== row.proposal_run_id
      || result.childId !== childId || result.status !== "accepted" || result.version !== row.saved_proposal_version)
      throw conflict("confirmation_receipt_changed");
    return result;
  }
  return {
    async recordedConfirmation(userId: string, childId: string, responseMessageId: string): Promise<{ proposalId: string } | null> {
      return access(userId, childId, async (client, workspaceId) => {
        const result = await acceptedReceipt(client, workspaceId, userId, childId, responseMessageId, false);
        return result ? { proposalId: result.id } : null;
      });
    },
    async requestConfirmation(agentScope: AgentScope, askingRunId: string, raw: z.infer<typeof requestAgentConfirmationSchema>): Promise<AgentConfirmation | null> {
      const input = requestAgentConfirmationSchema.parse(raw), { userId, childId } = agentScope;
      return access(userId, childId, async (client, workspaceId) => {
        const run = (await client.query<{ authorization_version: string; data_version: string }>(`SELECT authorization_version::text,data_version FROM agent_runs
          WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND trigger_kind='interactive' AND state='running' AND expires_at>clock_timestamp() FOR UPDATE`,
          [askingRunId, childId, userId])).rows[0];
        const current = await scope(client, workspaceId, userId, childId);
        if (!run || workspaceId !== agentScope.workspaceId || run.authorization_version !== current.access_version || agentScope.authorizationVersion !== current.access_version
          || run.data_version.split(":")[0] !== current.storage_epoch) throw conflict("confirmation_scope_changed");
        const target = await proposal(client, userId, childId, input.runId, input.proposalId);
        if (target.row.state !== "pending" || target.row.version !== input.expectedVersion || target.row.expires_at.getTime() <= Date.now()) throw conflict("confirmation_expired");
        if (target.row.authorization_version !== current.access_version || target.row.data_version.split(":")[0] !== current.storage_epoch) throw conflict("confirmation_scope_changed");
        let workVersion: number | null = null;
        if (input.workId) {
          const work = (await client.query<{ version: number }>("SELECT version FROM agent_work WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 AND status IN ('active','waiting') FOR UPDATE", [input.workId, userId, childId])).rows[0];
          if (!work) throw conflict("work_cancelled"); workVersion = work.version;
        }
        const value = target.value.value;
        let shared = ["family_document_change", "task_create", "task_change", "concern_create", "concern_change"].includes(value.kind) || value.kind === "memory_fact" && value.intendedVisibility === "family";
        if (value.kind === "family_document_change") {
          const borrowed = transactionPool(client);
          const document = await createFamilyDocumentStore(borrowed.pool, cipher).validatePatch(userId, childId, value.documentId, value.change);
          borrowed.assertReleased();
          if (!target.documentSourceBasis || document?.sourceBasis !== target.documentSourceBasis) throw conflict("source_changed");
        }
        if (value.kind === "memory_fact_revise" || value.kind === "memory_fact_deactivate") {
          const fact = (await client.query<{ visibility: string; version: number }>("SELECT visibility,version FROM memory_facts WHERE id=$1 AND child_id=$2 AND (visibility='family' OR created_by=$3) FOR SHARE", [value.factId, childId, userId])).rows[0];
          if (!fact || fact.version !== value.expectedVersion) throw conflict("version_conflict");
          shared = fact.visibility === "family";
        }
        const child = (await client.query<{ display_name_encrypted: string; owner_user_id: string }>("SELECT c.display_name_encrypted,w.owner_user_id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [childId])).rows[0];
        const childLabel = cipher.decrypt(child.display_name_encrypted, `children:${childId}:${child.owner_user_id}:display_name`);
        const question = buildAgentConfirmationQuestion(target.value, shared, childLabel);
        const prior = (await client.query<Row>("SELECT * FROM agent_confirmations WHERE asking_run_id=$1 AND proposal_id=$2 AND proposal_version=$3", [askingRunId, input.proposalId, input.expectedVersion])).rows[0];
        if (prior) {
          const saved = decode(prior);
          if (saved.hash !== hash(value) || prior.work_id !== input.workId || prior.work_version !== workVersion || prior.state === "invalidated") throw conflict("confirmation_scope_changed");
          return { id: prior.id, proposalRunId: prior.proposal_run_id, proposalId: prior.proposal_id, proposalVersion: prior.proposal_version, expiresAt: prior.expires_at.toISOString(), question: saved.question };
        }
        const id = randomUUID(), expiresAt = target.row.expires_at.toISOString();
        await client.query(`INSERT INTO agent_confirmations(id,child_id,owner_user_id,asking_run_id,proposal_run_id,proposal_id,proposal_version,work_id,work_version,
          authorization_version,storage_epoch,policy_version,payload_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [id, childId, userId, askingRunId, input.runId, input.proposalId, input.expectedVersion, input.workId, workVersion,
            current.access_version, current.storage_epoch, current.policyVersion, cipher.encrypt(JSON.stringify({ hash: hash(value), question, shared, result: null }), aad(userId, childId, id)), expiresAt]);
        return { id, proposalRunId: input.runId, proposalId: input.proposalId, proposalVersion: input.expectedVersion, expiresAt, question };
      });
    },
    async confirmationQuestions(userId: string, childId: string, runId: string) {
      return access(userId, childId, async client => (await client.query<Row>("SELECT * FROM agent_confirmations WHERE owner_user_id=$1 AND child_id=$2 AND asking_run_id=$3 AND state IN ('waiting','asked') AND expires_at>clock_timestamp() ORDER BY created_at,id", [userId, childId, runId])).rows.map(row => decode(row).question));
    },
    async bindConfirmationQuestion(userId: string, childId: string, messageId: string) {
      return access(userId, childId, async client => {
        const message = (await client.query<{ text_encrypted: string; in_reply_to: string }>("SELECT text_encrypted,in_reply_to FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND role='model'", [messageId, childId, userId])).rows[0];
        if (!message) return false;
        const text = cipher.decrypt(message.text_encrypted, `chat_messages:${messageId}:${childId}:${userId}:model:${message.in_reply_to}:text`);
        const rows = (await client.query<Row>(`SELECT c.* FROM agent_confirmations c JOIN agent_runs r ON r.id=c.asking_run_id
          WHERE c.owner_user_id=$1 AND c.child_id=$2 AND r.trigger_reference=$3 AND c.state='waiting' FOR UPDATE OF c`, [userId, childId, message.in_reply_to])).rows;
        for (const row of rows) await client.query("UPDATE agent_confirmations SET state=$2,ask_message_id=$3 WHERE id=$1",
          [row.id, row.expires_at.getTime() > Date.now() && text.includes(decode(row).question) ? "asked" : "invalidated", messageId]);
        return true;
      });
    },
    async consumeConfirmation(userId: string, childId: string, responseMessageId: string): Promise<AgentProposal | null> {
      return access(userId, childId, async (client, workspaceId) => {
        const recorded = await acceptedReceipt(client, workspaceId, userId, childId, responseMessageId, true);
        if (recorded) return recorded;
        const message = (await client.query<{ id: string; role: string; text_encrypted: string; created_at: Date }>("SELECT id,role,text_encrypted,created_at FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND author_user_id=$3 AND role='user' FOR SHARE", [responseMessageId, childId, userId])).rows[0];
        if (!message) return null;
        const previous = (await client.query<{ id: string; role: string }>("SELECT id,role FROM chat_messages WHERE child_id=$1 AND owner_user_id=$2 AND (created_at,id)<(SELECT created_at,id FROM chat_messages WHERE id=$3) ORDER BY created_at DESC,id DESC LIMIT 1", [childId, userId, responseMessageId])).rows[0];
        const retire = async () => { await client.query("UPDATE agent_confirmations SET state='invalidated' WHERE owner_user_id=$1 AND child_id=$2 AND ask_message_id=$3 AND state IN ('waiting','asked')", [userId, childId, previous?.id ?? null]); };
        const latest = (await client.query<{ id: string }>("SELECT id FROM chat_messages WHERE child_id=$1 AND owner_user_id=$2 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1", [childId, userId])).rows[0];
        const text = cipher.decrypt(message.text_encrypted, `chat_messages:${responseMessageId}:${childId}:${userId}:user::text`);
        if (latest?.id !== responseMessageId || previous?.role !== "model" || !isExplicitAgentConsent(text)) { await retire(); return null; }
        const current = await scope(client, workspaceId, userId, childId);
        // Eligibility and retirement stay in SQL; never decrypt an unbounded pending ledger.
        await client.query(`UPDATE agent_confirmations c SET state='invalidated' WHERE c.owner_user_id=$1 AND c.child_id=$2 AND c.state IN ('waiting','asked')
          AND (c.expires_at<=clock_timestamp() OR c.authorization_version<>$3::bigint OR c.storage_epoch<>$4 OR c.policy_version<>$5
          OR NOT EXISTS(SELECT 1 FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id WHERE p.id=c.proposal_id AND p.version=c.proposal_version AND p.state='pending'
            AND p.expires_at>clock_timestamp() AND r.owner_user_id=$1 AND r.child_id=$2 AND r.authorization_version=$3::bigint AND split_part(r.data_version,':',1)=$4)
          OR (c.work_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_work w WHERE w.id=c.work_id AND w.owner_user_id=$1 AND w.child_id=$2 AND w.version=c.work_version AND w.status IN ('active','waiting'))))`,
          [userId, childId, current.access_version, current.storage_epoch, current.policyVersion]);
        const pending = (await client.query<{ id: string }>(`SELECT p.id FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id
          WHERE r.owner_user_id=$1 AND r.child_id=$2 AND p.state='pending' AND p.expires_at>clock_timestamp()
            AND r.authorization_version=$3::bigint AND split_part(r.data_version,':',1)=$4 ORDER BY p.id LIMIT 2`,
          [userId, childId, current.access_version, current.storage_epoch])).rows;
        const rows = (await client.query<Row>("SELECT * FROM agent_confirmations WHERE owner_user_id=$1 AND child_id=$2 AND ask_message_id=$3 AND state='asked' ORDER BY id LIMIT 2 FOR UPDATE", [userId, childId, previous.id])).rows;
        if (pending.length !== 1 || rows.length !== 1 || pending[0].id !== rows[0].proposal_id) { await retire(); return null; }
        const row = rows[0], saved = decode(row), target = await proposal(client, userId, childId, row.proposal_run_id, row.proposal_id);
        if (row.expires_at.getTime() <= Date.now() || String(row.authorization_version) !== current.access_version || row.storage_epoch !== current.storage_epoch
          || row.policy_version !== current.policyVersion || target.row.state !== "pending" || target.row.version !== row.proposal_version
          || target.row.expires_at.getTime() <= Date.now() || target.row.authorization_version !== current.access_version
          || target.row.data_version.split(":")[0] !== current.storage_epoch || hash(target.value.value) !== saved.hash) { await retire(); return null; }
        // Borrow the original atomic decision; conflicts retire the shortcut while retaining the named proposal.
        let result: AgentProposal | null;
        try { result = await decide(client, userId, childId, row.proposal_run_id, row.proposal_id,
          { expectedVersion: row.proposal_version, decision: "accept", confirmShared: saved.shared }); }
        catch (error) { if (!(error instanceof FamilyError)) throw error; await retire(); return null; }
        if (!result) return null;
        await client.query("UPDATE agent_confirmations SET state='accepted',response_message_id=$2,payload_encrypted=$3 WHERE id=$1",
          [row.id, responseMessageId, cipher.encrypt(JSON.stringify({ ...saved, result }), aad(userId, childId, row.id))]);
        return result;
      });
    },
  };
}
