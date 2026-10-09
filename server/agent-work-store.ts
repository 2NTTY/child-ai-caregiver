import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import type { AgentScope } from "./agent-runtime.ts";
import type { AgentWork, AgentWorkPage, AgentHistoryPage, AgentHistoryMessage, SaveAgentWork, WorkResource } from "../src/shared/agent-work.ts";
import { readAgentWorkSchema, saveAgentWorkSchema, historySearchSchema, historyReadSchema } from "../src/shared/agent-work.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";
import { canonicalJson } from "./online-routing.ts";
import { syncAgentWorkFollowUp, latestAgentWorkFollowUps } from "./agent-work-continuation.ts";
const missing = () => new FamilyError(404, "not_found");
const conflict = (code: string) => new FamilyError(409, code);
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const aad = (userId: string, childId: string, id: string, version: number) => `agent-work:${childId}:${userId}:${id}:${version}`;
const operationAad = (userId: string, childId: string, operationId: string) => `agent-work-operation:${childId}:${userId}:${operationId}`;
interface WorkRow { id: string; child_id: string; owner_user_id: string; version: number; status: AgentWork["status"]; payload_encrypted: string; created_at: Date; updated_at: Date; cursor_at: string }
interface ScanRow { id: string; version: number; role: "user" | "model" | null; payload_encrypted: string; created_at: Date; cursor_at: string; in_reply_to: string | null; created_by?: string; source_record_id?: string; source_record_version?: number }
const cursorSchema = z.object({
  v: z.literal(1), userId: z.string(), childId: z.uuid(), kind: z.string(), queryHash: z.string(),
  highAt: z.iso.datetime({ offset: true }), highId: z.uuid(), afterAt: z.iso.datetime({ offset: true }).nullable(), afterId: z.uuid().nullable(),
}).strict();
function parseCursor(raw: string | null, userId: string, childId: string, kind: string, query: string) {
  if (raw === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error();
    const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (value.userId !== userId || value.childId !== childId || value.kind !== kind || value.queryHash !== digest(query)) throw new Error();
    return value;
  } catch { throw new FamilyError(400, "invalid_cursor"); }
}
const encode = (value: z.infer<typeof cursorSchema>) => Buffer.from(JSON.stringify(value)).toString("base64url");
const at = "to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at";
export function createAgentWorkStore(pool: Pool, cipher: StorageCipher) {
  const access = <T>(userId: string, childId: string, write: boolean, fn: (client: PoolClient, workspaceId: string) => Promise<T>) =>
    withChildAccess(pool, userId, childId, READ_ROLES, (client, _role, workspaceId) => fn(client, workspaceId), write);
  const decode = (row: WorkRow): AgentWork => ({ ...JSON.parse(cipher.decrypt(row.payload_encrypted, aad(row.owner_user_id, row.child_id, row.id, row.version))),
    id: row.id, childId: row.child_id, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
  async function resource(client: PoolClient, userId: string, childId: string, ref: WorkResource) {
    const tables = { task: "care_tasks", memory_fact: "memory_facts", private_note: "agent_private_notes", private_source: "shared_inputs",
      concern: "concerns", family_document: "family_documents", care_record: "text_records", receipt: "agent_action_receipts" } as const;
    const privateFilter = ref.kind === "private_note" || ref.kind === "private_source" || ref.kind === "receipt" ? " AND owner_user_id=$3"
      : ref.kind === "memory_fact" ? " AND (visibility='family' OR created_by=$3)" : "";
    const params = privateFilter ? [ref.id, childId, userId] : [ref.id, childId];
    const row = (await client.query<{ version: number }>(`SELECT ${ref.kind === "receipt" ? "1" : "version"} AS version FROM ${tables[ref.kind]} WHERE id=$1 AND child_id=$2${privateFilter} FOR SHARE`, params)).rows[0];
    if (!row) throw missing();
    if (row.version !== ref.version) throw conflict("work_resource_changed");
  }
  return {
    async readWork(userId: string, childId: string, raw: z.infer<typeof readAgentWorkSchema>): Promise<AgentWorkPage | null> {
      const input = readAgentWorkSchema.parse(raw), cursor = parseCursor(input.cursor, userId, childId, "work", "");
      return access(userId, childId, false, async client => {
        if (input.workId) {
          const row = (await client.query<WorkRow>("SELECT * FROM agent_work WHERE id=$1 AND child_id=$2 AND owner_user_id=$3", [input.workId, childId, userId])).rows[0];
          const latest = await latestAgentWorkFollowUps(client, userId, childId, row ? [row.id] : []);
          return { items: row ? [{ ...decode(row), ...(latest.has(row.id) ? { latestFollowUp: latest.get(row.id)! } : {}) }] : [], nextCursor: null, complete: true };
        }
        const high = cursor ?? (await client.query<{ id: string; cursor_at: string }>(`SELECT id,${at} FROM agent_work WHERE owner_user_id=$1 AND child_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, childId])).rows[0];
        if (!high) return { items: [], nextCursor: null, complete: true };
        const highAt = "highAt" in high ? high.highAt : high.cursor_at, highId = "highId" in high ? high.highId : high.id;
        const rows = (await client.query<WorkRow>(`SELECT *,${at} FROM agent_work WHERE owner_user_id=$1 AND child_id=$2
          AND (created_at,id)<=($3::timestamptz,$4::uuid) AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid))
          ORDER BY created_at DESC,id DESC LIMIT 11`, [userId, childId, highAt, highId, cursor?.afterAt ?? null, cursor?.afterId ?? null])).rows;
        const items: WorkRow[] = [];
        let size = 0;
        for (const row of rows.slice(0, 10)) {
          const length = JSON.stringify(decode(row)).length;
          if (items.length && size + length > 7000) break;
          items.push(row); size += length;
        }
        const last = items.at(-1), more = items.length < rows.length;
        const latest = await latestAgentWorkFollowUps(client, userId, childId, items.map(row => row.id));
        return { items: items.map(row => ({ ...decode(row), ...(latest.has(row.id) ? { latestFollowUp: latest.get(row.id)! } : {}) })), complete: !more, nextCursor: more && last
          ? encode({ v: 1, userId, childId, kind: "work", queryHash: digest(""), highAt, highId, afterAt: last.cursor_at, afterId: last.id }) : null };
      });
    },
    async saveWork(scope: AgentScope, runId: string, callId: string, raw: SaveAgentWork): Promise<AgentWork | null> {
      const input = saveAgentWorkSchema.parse(raw), hash = digest(input);
      z.string().min(1).max(200).parse(callId);
      return access(scope.userId, scope.childId, true, async (client, workspaceId) => {
        const run = (await client.query<{ source_message_id: string; authorization_version: string; data_version: string }>(`SELECT source_message_id,authorization_version::text,data_version FROM agent_runs
          WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 AND trigger_kind='interactive' AND state='running' AND expires_at>clock_timestamp() FOR UPDATE`, [runId, scope.userId, scope.childId])).rows[0];
        const prior = (await client.query<{ operation_id: string; payload_encrypted: string }>("SELECT operation_id,payload_encrypted FROM agent_work_operations WHERE owner_user_id=$1 AND child_id=$2 AND (operation_id=$3 OR (run_id=$4 AND call_id=$5))",
          [scope.userId, scope.childId, input.operationId, runId, callId])).rows[0];
        if (prior) {
          const saved = JSON.parse(cipher.decrypt(prior.payload_encrypted, operationAad(scope.userId, scope.childId, prior.operation_id)));
          if (saved.hash !== hash) throw conflict("operation_conflict");
          return saved.result as AgentWork;
        }
        const space = (await client.query<{ access_version: string; storage_epoch: string; change_seq: string }>("SELECT access_version::text,storage_epoch::text,change_seq::text FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
        if (!run || workspaceId !== scope.workspaceId || run.authorization_version !== space.access_version || scope.authorizationVersion !== space.access_version
          || scope.dataVersion.split(":")[0] !== space.storage_epoch || run.data_version !== space.storage_epoch + ":" + space.change_seq) throw conflict("agent_scope_changed");
        const old = input.workId ? (await client.query<WorkRow>("SELECT * FROM agent_work WHERE id=$1 AND owner_user_id=$2 AND child_id=$3 FOR UPDATE", [input.workId, scope.userId, scope.childId])).rows[0] : null;
        if (input.workId && !old) throw missing();
        if ((old?.version ?? 0) !== input.expectedVersion) throw conflict("version_conflict");
        if (old?.status === "cancelled" && input.values.status !== "cancelled") throw conflict("work_cancelled");
        for (const id of input.values.sourceMessageIds) {
          if (!(await client.query("SELECT 1 FROM chat_messages WHERE id=$1 AND child_id=$2 AND owner_user_id=$3 AND role='user' AND author_user_id=$3 AND (created_at,id)<=(SELECT created_at,id FROM chat_messages WHERE id=$4 AND child_id=$2 AND owner_user_id=$3) FOR SHARE",
            [id, scope.childId, scope.userId, run.source_message_id])).rowCount) throw missing();
        }
        for (const ref of input.values.resources) await resource(client, scope.userId, scope.childId, ref);
        for (const ref of input.values.pending) if (!(await client.query(`SELECT 1 FROM agent_proposals p JOIN agent_runs r ON r.id=p.run_id
          WHERE p.id=$1 AND p.run_id=$2 AND p.version=$3 AND p.state='pending' AND p.expires_at>clock_timestamp() AND r.owner_user_id=$4 AND r.child_id=$5`,
          [ref.proposalId, ref.runId, ref.version, scope.userId, scope.childId])).rowCount) throw conflict("work_proposal_changed");
        const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
        const encrypted = cipher.encrypt(JSON.stringify(input.values), aad(scope.userId, scope.childId, id, version));
        const row = old ? (await client.query<WorkRow>("UPDATE agent_work SET version=$2,status=$3,payload_encrypted=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [id, version, input.values.status, encrypted])).rows[0]
          : (await client.query<WorkRow>("INSERT INTO agent_work(id,child_id,owner_user_id,version,status,payload_encrypted) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [id, scope.childId, scope.userId, version, input.values.status, encrypted])).rows[0];
        const result = decode(row);
        await syncAgentWorkFollowUp(client, cipher, { work: result, userId: scope.userId, workspaceId,
          authorizationVersion: space.access_version, storageEpoch: space.storage_epoch });
        await client.query("INSERT INTO agent_work_operations(owner_user_id,child_id,operation_id,run_id,call_id,work_id,payload_encrypted) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [scope.userId, scope.childId, input.operationId, runId, callId, id, cipher.encrypt(JSON.stringify({ hash, result }), operationAad(scope.userId, scope.childId, input.operationId))]);
        if (old) await client.query("UPDATE agent_confirmations SET state='invalidated' WHERE work_id=$1 AND state IN ('waiting','asked')", [id]);
        const seq = await appendOnlineChange(client, workspaceId, "memory", scope.childId, input.values.status === "cancelled", scope.userId);
        await client.query("UPDATE agent_runs SET data_version=$2 WHERE id=$1", [runId, space.storage_epoch + ":" + seq]);
        return result;
      });
    },
    async searchHistory(userId: string, childId: string, raw: z.infer<typeof historySearchSchema>): Promise<AgentHistoryPage | null> {
      const input = historySearchSchema.parse(raw), cursor = parseCursor(input.cursor, userId, childId, input.kind, input.query);
      const table = { message: "chat_messages", private_instruction: "agent_private_notes", memory_fact: "memory_facts" }[input.kind];
      const filter = input.kind === "memory_fact" ? "(visibility='family' OR created_by=$1)" : "owner_user_id=$1";
      return access(userId, childId, false, async client => {
        const high = cursor ?? (await client.query<{ id: string; cursor_at: string }>(`SELECT id,${at} FROM ${table} WHERE ${filter} AND child_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, childId])).rows[0];
        if (!high) return { matches: [], scanned: 0, scanLimit: 100, complete: true, nextCursor: null };
        const highAt = "highAt" in high ? high.highAt : high.cursor_at, highId = "highId" in high ? high.highId : high.id;
        const columns = input.kind === "message" ? "1 AS version,role,text_encrypted AS payload_encrypted,in_reply_to"
          : "version,NULL AS role,payload_encrypted,NULL AS in_reply_to" + (input.kind === "memory_fact" ? ",created_by,source_record_id,source_record_version" : "");
        const rows = (await client.query<ScanRow>(`SELECT id,created_at,${at},${columns} FROM ${table} WHERE ${filter} AND child_id=$2
          AND (created_at,id)<=($3::timestamptz,$4::uuid) AND ($5::timestamptz IS NULL OR (created_at,id)>($5::timestamptz,$6::uuid))
          ORDER BY created_at,id LIMIT 101`, [userId, childId, highAt, highId, cursor?.afterAt ?? null, cursor?.afterId ?? null])).rows;
        const matches: AgentHistoryPage["matches"] = [], query = input.query.toLocaleLowerCase("zh-HK");
        let scanned = 0, last: ScanRow | undefined;
        for (const row of rows.slice(0, 100)) {
          scanned++; last = row;
          const context = input.kind === "message" ? `chat_messages:${row.id}:${childId}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`
            : input.kind === "private_instruction" ? `agent-private-note:${childId}:${userId}:${row.id}:${row.version}` : `memory-fact:${childId}:${row.id}:${row.version}`;
          const payload = cipher.decrypt(row.payload_encrypted, context);
          const value = input.kind === "message" ? null : JSON.parse(payload);
          const text = input.kind === "message" ? payload : input.kind === "private_instruction" ? value.title + "\n" + value.text : value.key + "\n" + value.content;
          if (text.toLocaleLowerCase("zh-HK").includes(query)) {
            matches.push({ id: row.id, kind: input.kind, version: row.version, createdAt: row.created_at.toISOString(), role: row.role,
              excerpt: text.slice(Math.max(0, text.toLocaleLowerCase("zh-HK").indexOf(query) - 100), Math.max(0, text.toLocaleLowerCase("zh-HK").indexOf(query) - 100) + 400) });
            if (matches.length === 10) break;
          }
        }
        const complete = scanned === rows.length;
        return { matches, scanned, scanLimit: 100, complete, nextCursor: !complete && last ? encode({
          v: 1, userId, childId, kind: input.kind, queryHash: digest(input.query), highAt, highId, afterAt: last.cursor_at, afterId: last.id,
        }) : null };
      });
    },
    async readHistory(userId: string, childId: string, raw: z.infer<typeof historyReadSchema>): Promise<AgentHistoryMessage | null> {
      const input = historyReadSchema.parse(raw);
      return access(userId, childId, false, async client => {
        const row = (await client.query<ScanRow>("SELECT id,role,created_at,text_encrypted AS payload_encrypted,in_reply_to FROM chat_messages WHERE id=$1 AND owner_user_id=$2 AND child_id=$3", [input.messageId, userId, childId])).rows[0];
        if (!row) throw missing();
        const text = cipher.decrypt(row.payload_encrypted, `chat_messages:${row.id}:${childId}:${userId}:${row.role}:${row.in_reply_to ?? ""}:text`);
        if (input.offset > text.length) throw new FamilyError(400, "invalid_offset");
        const end = Math.min(text.length, input.offset + input.limit);
        return { id: row.id, childId, role: row.role!, version: 1, createdAt: row.created_at.toISOString(),
          offset: input.offset, text: text.slice(input.offset, end), nextOffset: end < text.length ? end : null, totalCharacters: text.length };
      });
    },
  };
}
