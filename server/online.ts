import { createHash } from "node:crypto";
import { createTelegramStore } from "./telegram-store.ts";
import { handleTelegramRequest } from "./telegram-api.ts";
import type { TelegramServices } from "./telegram-types.ts";
import type { Pool, PoolClient } from "pg";
import type { OnlineChanges, OnlineCommand, OnlineContext, OnlineReceipt, OnlineSubmission } from "../src/shared/online.ts";
import type { FamilyRole } from "../src/shared/family.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError, READ_ROLES, withWorkspaceAccess } from "./family-access.ts";
import { createFamilyStore } from "./families.ts";
import { createCareStore } from "./care.ts";
import { createRecordStore } from "./records.ts";
import { createChatStore } from "./chat.ts";
import { createWorkspaceStore } from "./workspaces.ts";
import { handleCareRequest } from "./care-api.ts";
import { handleFamilyRequest } from "./family-api.ts";
import { handleRecordRequest } from "./record-api.ts";
import { handleChatRequest } from "./chat-api.ts";
import { handleMemoryRequest } from "./memory-api.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore, type TaskScheduling } from "./tasks.ts";
import { handleTaskRequest } from "./task-api.ts";
import { transactionPool } from "./transaction-pool.ts";
import { createWebPushStore, type WebPushServices } from "./web-push-store.ts";
import { handleWebPushRequest } from "./web-push-api.ts";
import { canonicalJson, onlineRoute } from "./online-routing.ts";
import type { OnlineRoute } from "./online-routing.ts";

interface OperationRow {
  user_id: string; op_id: string; device_id: string; workspace_id: string; storage_epoch: string;
  path: string; child_id: string | null; kind: OnlineRoute["kind"]; owner_only: boolean;
  request_hash_encrypted: string; result_encrypted: string | null; status_code: number; change_seq: string;
}
interface SpaceRow { id: string; owner_user_id: string; storage_epoch: string; access_version: number; change_seq: string }
const receiptContext = (userId: string, opId: string, field: string) => `online-operation:${userId}:${opId}:${field}`;
const missing = () => new FamilyError(404, "not_found");

export function createOnlineStore(pool: Pool, cipher: StorageCipher, taskScheduling?: TaskScheduling, pushServices?: WebPushServices, telegram?: TelegramServices) {
  async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect(); let discard = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
      const result = await operation(client);
      await client.query("COMMIT"); return result;
    } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
    finally { client.release(discard); }
  }
  async function lockSpace(client: PoolClient, id: string, exclusive: boolean): Promise<SpaceRow> {
    const row = (await client.query<SpaceRow>(`SELECT id,owner_user_id,storage_epoch,access_version,change_seq::text FROM workspaces WHERE id=$1 FOR ${exclusive ? "UPDATE" : "SHARE"}`, [id])).rows[0];
    if (!row) throw missing(); return row;
  }
  async function roleFor(client: PoolClient, userId: string, space: SpaceRow): Promise<FamilyRole | undefined> {
    return space.owner_user_id === userId ? "owner" : (await client.query<{ role: FamilyRole }>(
      "SELECT role FROM family_members WHERE workspace_id=$1 AND user_id=$2", [space.id, userId])).rows[0]?.role;
  }
  async function resolveWorkspace(client: PoolClient, userId: string, route: OnlineRoute): Promise<string> {
    if (route.scope === "workspace" || route.scope === "invitation") return route.targetId!;
    const row = route.scope === "child"
      ? (await client.query<{ id: string }>("SELECT workspace_id AS id FROM children WHERE id=$1", [route.targetId])).rows[0]
      : (await client.query<{ id: string }>("SELECT id FROM workspaces WHERE owner_user_id=$1", [userId])).rows[0];
    if (!row && route.scope === "personal") {
      const borrowed = transactionPool(client);
      const workspace = await createWorkspaceStore(borrowed.pool).ensureForUser(userId);
      borrowed.assertReleased(); return workspace.id;
    }
    if (!row) throw missing(); return row.id;
  }
  async function authorize(client: PoolClient, userId: string, space: SpaceRow, route: OnlineRoute, command: OnlineCommand | null, replay: boolean) {
    if(command?.path.startsWith("/api/telegram/") && (!telegram || !(await client.query("SELECT 1 FROM app_migrations WHERE id='018-telegram-channel'")).rowCount))throw missing();
    if (route.kind === "memory" && !(await client.query("SELECT 1 FROM app_migrations WHERE id='011-memory-online'")).rowCount) throw missing();
    if (route.kind === "tasks" && !(await client.query("SELECT 1 FROM app_migrations WHERE id='012-task-ledger'")).rowCount) throw missing();
    if (command?.path.startsWith("/api/web-push/") && (!pushServices || !(await client.query("SELECT 1 FROM app_migrations WHERE id='015-web-push'")).rowCount)) throw missing();
    const role = await roleFor(client, userId, space);
    if (route.scope === "invitation" && !replay && command) {
      const borrowed = transactionPool(client);
      const preview = await createFamilyStore(borrowed.pool, cipher).preview(userId, (command.payload as { token: string }).token);
      borrowed.assertReleased();
      if (preview.workspaceId !== space.id) throw missing();
    } else if (!role || !route.roles.includes(role)) throw missing();
    if (route.scope === "personal" && space.owner_user_id !== userId) throw missing();
    if ((route.scope === "workspace" || route.scope === "invitation") && route.targetId !== space.id) throw missing();
    if (route.scope === "child") {
      const child = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM children WHERE id=$1", [route.targetId])).rows[0];
      if (child && child.workspace_id !== space.id || !child && !replay) throw missing();
    }
  }
  async function currentReceipt(client: PoolClient, userId: string, row: OperationRow): Promise<OnlineReceipt> {
    const space = await lockSpace(client, row.workspace_id, false);
    // Deletion may redact the receipt while this request waits for the parent lock.
    row = (await client.query<OperationRow>("SELECT *,change_seq::text FROM online_operations WHERE user_id=$1 AND op_id=$2", [userId, row.op_id])).rows[0];
    if (!row) throw missing();
    if (space.storage_epoch !== row.storage_epoch) throw new FamilyError(409, "storage_epoch_changed");
    // The invitation token is intentionally not stored in plaintext or needed for a receipt.
    const route = row.path === "/api/families/invitations/accept"
      ? { kind: "family", scope: "invitation", targetId: row.workspace_id, roles: READ_ROLES, privateResult: true, deleted: false } as const
      : onlineRoute({ path: row.path, payload: {} });
    await authorize(client, userId, space, route, null, true);
    const childExists = !row.child_id || Boolean((await client.query("SELECT 1 FROM children WHERE id=$1 AND workspace_id=$2", [row.child_id, row.workspace_id])).rowCount);
    return { state: "confirmed", path: row.path, operation: { opId: row.op_id, deviceId: row.device_id, workspaceId: row.workspace_id, storageEpoch: row.storage_epoch },
      changeSeq: row.change_seq, statusCode: row.status_code,
      result: childExists && row.result_encrypted ? JSON.parse(cipher.decrypt(row.result_encrypted, receiptContext(userId, row.op_id, "result"))) : null };
  }
  async function dispatch(client: PoolClient, userId: string, command: OnlineCommand): Promise<Response> {
    const borrowed = transactionPool(client), records = createRecordStore(borrowed.pool, cipher, true);
    const request = new Request(`http://online.internal${command.path}`, { method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": userId }, body: JSON.stringify(command.payload) });
    const response = command.path.startsWith("/api/web-push/") && pushServices
      ? await handleWebPushRequest(request, userId, createWebPushStore(borrowed.pool, cipher, pushServices, true), true)
      : command.path.startsWith("/api/telegram/") && telegram
      ? await handleTelegramRequest(request, userId, createTelegramStore(borrowed.pool, cipher, telegram), true)
      : /^\/api\/children\/[^/]+\/tasks(\/|$)/u.test(command.path)
      ? await handleTaskRequest(request, userId, createTaskStore(borrowed.pool, cipher, taskScheduling), true)
      : /^\/api\/children\/[^/]+\/memory\//u.test(command.path)
      ? await handleMemoryRequest(request, userId, createMemoryStore(borrowed.pool, cipher, true))
      : /^\/api\/children\/[^/]+\/(care|profile)(\/|$)/u.test(command.path)
      ? await handleCareRequest(request, userId, createCareStore(borrowed.pool, cipher, true))
      : command.path.startsWith("/api/families/") || command.path === "/api/notification-preferences"
      ? await handleFamilyRequest(request, userId, createFamilyStore(borrowed.pool, cipher, true), records)
      : command.path.endsWith("/messages") ? await handleChatRequest(request, userId, createChatStore(borrowed.pool, cipher, true))
      : await handleRecordRequest(request, userId, records);
    borrowed.assertReleased(); return response;
  }
  return {
    spaces: (userId: string) => createWorkspaceStore(pool).listForUser(userId),
    async context(userId: string, command: OnlineCommand): Promise<OnlineContext> {
      const route = onlineRoute(command);
      return transaction(async client => {
        const id = await resolveWorkspace(client, userId, route);
        // Invitation validation also takes UPDATE; take it up front to avoid lock upgrades.
        const space = await lockSpace(client, id, route.scope === "invitation");
        await authorize(client, userId, space, route, command, false);
        return { workspaceId: id, storageEpoch: space.storage_epoch };
      });
    },
    async submit(userId: string, submission: OnlineSubmission): Promise<OnlineReceipt | Response> {
      const { operation, path, payload } = submission, command = { path, payload }, route = onlineRoute(command);
      return transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,178107))", [`${userId}:${operation.opId}`]);
        const prior = (await client.query<OperationRow>("SELECT *,change_seq::text FROM online_operations WHERE user_id=$1 AND op_id=$2", [userId, operation.opId])).rows[0];
        const space = await lockSpace(client, operation.workspaceId, true);
        if (space.storage_epoch !== operation.storageEpoch) throw new FamilyError(409, "storage_epoch_changed");
        await authorize(client, userId, space, route, command, Boolean(prior));
        const fingerprint = createHash("sha256").update(canonicalJson(command)).digest("hex");
        if (prior) {
          if (prior.device_id !== operation.deviceId || prior.workspace_id !== operation.workspaceId || prior.storage_epoch !== operation.storageEpoch
            || cipher.decrypt(prior.request_hash_encrypted, receiptContext(userId, operation.opId, "hash")) !== fingerprint) throw new FamilyError(409, "operation_mismatch");
          return currentReceipt(client, userId, prior);
        }
        // Refuse commands whose resolved resource differs from the provided scope.
        if (await resolveWorkspace(client, userId, route) !== operation.workspaceId) throw missing();
        await client.query("SAVEPOINT online_dispatch");
        const response = await dispatch(client, userId, command);
        if (!response.ok) {
          await client.query("ROLLBACK TO SAVEPOINT online_dispatch");
          await client.query("RELEASE SAVEPOINT online_dispatch"); return response;
        }
        await client.query("RELEASE SAVEPOINT online_dispatch");
        const result = await response.json();
        const childId = route.scope === "child" ? route.targetId! : route.kind === "children" ? result.child.id as string : null;
        const seq = (await client.query<{ change_seq: string }>("SELECT change_seq::text FROM workspaces WHERE id=$1", [space.id])).rows[0].change_seq;
        const ownerOnly = route.roles.length === 1 && route.roles[0] === "owner" && route.scope !== "personal";
        const row = (await client.query<OperationRow>(`INSERT INTO online_operations(user_id,op_id,device_id,workspace_id,storage_epoch,path,child_id,kind,owner_only,request_hash_encrypted,result_encrypted,status_code,change_seq)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *,change_seq::text`,
        [userId, operation.opId, operation.deviceId, space.id, space.storage_epoch, path, childId, route.kind, ownerOnly,
          cipher.encrypt(fingerprint, receiptContext(userId, operation.opId, "hash")), cipher.encrypt(JSON.stringify(result), receiptContext(userId, operation.opId, "result")), response.status, seq])).rows[0];
        return { state: "confirmed", path, operation, changeSeq: seq, statusCode: row.status_code, result };
      });
    },
    async lookup(userId: string, opId: string): Promise<OnlineReceipt | { state: "unconfirmed" }> {
      return transaction(async client => {
        const row = (await client.query<OperationRow>("SELECT *,change_seq::text FROM online_operations WHERE user_id=$1 AND op_id=$2", [userId, opId])).rows[0];
        return row ? currentReceipt(client, userId, row) : { state: "unconfirmed" };
      });
    },
    async changes(userId: string, workspaceId: string, epoch: string, cursor: string): Promise<OnlineChanges> {
      return withWorkspaceAccess(pool, userId, workspaceId, READ_ROLES, async (client, role, accessVersion) => {
        const space = await lockSpace(client, workspaceId, false);
        if (space.storage_epoch !== epoch) throw new FamilyError(409, "storage_epoch_changed");
        if (BigInt(cursor) > BigInt(space.change_seq)) throw new FamilyError(409, "cursor_invalid");
        const rows = (await client.query<{ change_seq: string; kind: OnlineRoute["kind"]; child_id: string | null; deleted: boolean }>(
          `SELECT change_seq::text,kind,child_id,deleted FROM online_changes WHERE workspace_id=$1 AND change_seq>$2 AND change_seq<=$3
           AND (private_user_id IS NULL OR private_user_id=$4) AND (NOT owner_only OR $5)
           ORDER BY change_seq LIMIT 101`, [workspaceId, cursor, space.change_seq, userId, role === "owner"])).rows;
        const hasMore = rows.length > 100, page = rows.slice(0, 100);
        return { workspaceId, storageEpoch: epoch, accessVersion, cursor: hasMore ? page[99].change_seq : space.change_seq, hasMore,
          changes: page.map(row => ({ changeSeq: row.change_seq, kind: row.kind, childId: row.child_id, deleted: row.deleted })) };
      });
    },
  };
}
export type OnlineStore = ReturnType<typeof createOnlineStore>;
