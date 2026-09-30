import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { agentDecisionSchema, agentProposalSchema } from "../src/shared/product-agent.ts";
import type { AgentDecision, AgentProposal, AgentProposalValue, ProductAgentResult } from "../src/shared/product-agent.ts";
import type { AgentScope } from "./agent-runtime.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { transactionPool } from "./transaction-pool.ts";
import { canonicalJson } from "./online-routing.ts";
import { z } from "zod";
import { summarySaveSchema } from "./memory-validation.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore, type TaskScheduling } from "./tasks.ts";
import type { StorageCipher } from "./storage-crypto.ts";

interface RunRow {
  id: string; child_id: string; owner_user_id: string; trigger_kind: "interactive" | "worker";
  trigger_reference: string; source_message_id: string | null; authorization_version: string;
  data_version: string; recipe_id: string; state: ProductAgentResult["status"]; stop_reason: string | null;
  result_encrypted: string | null; created_at: Date; expires_at: Date;
}
interface ProposalRow { id: string; run_id: string; call_id: string; version: number; state: AgentProposal["status"];
  payload_encrypted: string; created_at: Date; expires_at: Date }
interface ProposalPayload { value: AgentProposalValue; result: AgentProposal["result"]; targetLabel: string | null }
export interface AgentRunClaim {
  runId: string; scope: AgentScope; created: boolean; sourceMessageId: string | null;
  state: ProductAgentResult["status"]; expiresAt: string;
}
const missing = () => new FamilyError(404, "not_found");
const aad = (run: Pick<RunRow, "id" | "child_id" | "owner_user_id">) => "agent-run:" + run.child_id + ":" + run.owner_user_id + ":" + run.id;
const proposalAad = (run: RunRow, row: Pick<ProposalRow, "id" | "version">) => aad(run) + ":proposal:" + row.id + ":" + row.version;
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
  function decodeProposal(run: RunRow, row: ProposalRow): AgentProposal {
    const payload = JSON.parse(cipher.decrypt(row.payload_encrypted, proposalAad(run, row))) as ProposalPayload;
    return { id: row.id, runId: run.id, childId: run.child_id, version: row.version, status: row.state,
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), ...payload };
  }
  async function proposals(client: PoolClient, run: RunRow): Promise<AgentProposal[]> {
    // Each run has at most eight tool calls, hence at most eight proposals.
    const rows = (await client.query<ProposalRow>("SELECT * FROM agent_proposals WHERE run_id=$1 ORDER BY created_at,id", [run.id])).rows;
    return rows.map(row => decodeProposal(run, row));
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
  return {
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
    async get(userId: string, childId: string, runId: string): Promise<ProductAgentResult | null> {
      return access(userId, childId, true, async client => {
        const row = await runFor(client, userId, childId, runId);
        await expireRun(client, row);
        await client.query("UPDATE agent_proposals SET state='expired' WHERE run_id=$1 AND state='pending' AND expires_at<=clock_timestamp()", [runId]);
        const saved = row.result_encrypted ? JSON.parse(cipher.decrypt(row.result_encrypted, aad(row))) as ProductAgentResult : empty(row);
        return { ...saved, runId, status: row.state, stopReason: row.stop_reason, proposals: await proposals(client, row) };
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
          const contact=value.tools.filter(tool=>tool.name==="contact_caregiver" && tool.status==="succeeded" && tool.reference);
          if(!contact.length)return false;
          value={...value,status:"stopped",stopReason:"unauthorized",text:"已記錄聯絡請求；資料隨後有變，請到聯絡台帳核對目前投遞結果。入列不代表送達或完成。",citations:[],retrievalMode:"not_used",proposals:[],tools:contact};
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
        let targetLabel: string | null = value.kind === "task_create" ? page.eligibleAssignees.find(person => person.userId === value.values.assigneeUserId)?.name ?? null : null;
        if (value.kind === "task_create" && !page.eligibleAssignees.some(person => person.userId === value.values.assigneeUserId)) throw new FamilyError(400, "invalid_assignee");
        if (value.kind === "task_change") {
          const task = await tasks.get(scope.userId, scope.childId, value.taskId); borrowed.assertReleased();
          if (!task || task.version !== value.change.expectedVersion) throw new FamilyError(409, "version_conflict");
          targetLabel = task.title + " · " + (page.eligibleAssignees.find(person => person.userId === (value.change.action === "reschedule" ? value.change.assigneeUserId : task.assigneeUserId))?.name ?? "原照顧者");
          const rescheduledAssignee = value.change.action === "reschedule" ? value.change.assigneeUserId : null;
          if (rescheduledAssignee && !page.eligibleAssignees.some(person => person.userId === rescheduledAssignee)) throw new FamilyError(400, "invalid_assignee");
        }
        const previous = (await client.query<ProposalRow>("SELECT * FROM agent_proposals WHERE run_id=$1", [runId])).rows;
        const encoded = canonicalJson(value);
        for (const row of previous) {
          const decoded = decodeProposal(run, row), same = canonicalJson(decoded.value) === encoded;
          if (row.call_id === callId && !same) throw new FamilyError(409, "operation_conflict");
          if (same) return decoded;
        }
        if (previous.length >= 8) throw new FamilyError(409, "agent_proposal_limit");
        const id = randomUUID();
        const row = (await client.query<ProposalRow>("INSERT INTO agent_proposals(id,run_id,call_id,payload_encrypted) VALUES($1,$2,$3,$4) RETURNING *",
          [id, runId, callId, cipher.encrypt(JSON.stringify({ value, result: null, targetLabel }), proposalAad(run, { id, version: 1 }))])).rows[0];
        return decodeProposal(run, row);
      });
    },
    async decide(userId: string, childId: string, runId: string, proposalId: string, raw: AgentDecision): Promise<AgentProposal | null> {
      const input = agentDecisionSchema.parse(raw);
      return access(userId, childId, true, async (client, workspaceId) => {
        const run = await runFor(client, userId, childId, runId);
        const row = (await client.query<ProposalRow>("SELECT * FROM agent_proposals WHERE id=$1 AND run_id=$2 FOR UPDATE", [proposalId, runId])).rows[0];
        if (!row) throw missing();
        const proposal = decodeProposal(run, row), wanted = input.decision === "accept" ? "accepted" : "dismissed";
        // Exact repeat after response loss returns the already committed effect, never another task.
        if (proposal.status === wanted && proposal.version === input.expectedVersion + 1) return proposal;
        if (proposal.status !== "pending" || proposal.version !== input.expectedVersion) throw new FamilyError(409, "version_conflict");
        if (proposal.expiresAt <= new Date().toISOString()) throw new FamilyError(409, "confirmation_expired");
        const current = await currentScope(client, workspaceId, userId, childId);
        if (run.authorization_version.toString() !== current.authorizationVersion
          || run.data_version.split(":")[0] !== current.dataVersion.split(":")[0]) throw new FamilyError(409, "confirmation_scope_changed");
        const value = proposal.value, shared = value.kind !== "memory_fact" || value.intendedVisibility === "family";
        if (input.decision === "accept" && shared && !input.confirmShared) throw new FamilyError(400, "sharing_confirmation_required");
        let result: AgentProposal["result"] = null;
        if (input.decision === "accept") {
          const borrowed = transactionPool(client);
          if (value.kind === "memory_fact") {
            if (!run.source_message_id) throw new FamilyError(409, "source_changed");
            const memory = createMemoryStore(borrowed.pool, cipher, true);
            const fact = await memory.createFact(userId, childId, { values: { key: value.key, content: value.content, validUntil: value.validUntil,
              source: { kind: "private_chat", messageId: run.source_message_id, description: "由本人聊天提出，經本人核對確認" } }, intendedVisibility: value.intendedVisibility });
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
          [row.id, updated.version, wanted, cipher.encrypt(JSON.stringify({ value, result, targetLabel: proposal.targetLabel }), proposalAad(run, updated))])).rows[0];
        return decodeProposal(run, saved);
      });
    },
  };
}
export type ProductAgentStore = ReturnType<typeof createProductAgentStore>;
