import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { accountEraseExecuteSchema, type AccountEraseReceipt, type AccountExportPage } from "../src/shared/account-service.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import type { ErasureIntent, ErasureJournal, JournalHead } from "./erasure-journal.ts";
import { AccountServiceError } from "./account-admission.ts";
import { appendOnlineChange } from "./online-change.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { transactionPool } from "./transaction-pool.ts";
import { createRecordStore } from "./records.ts";
import { createCareStore } from "./care.ts";
import { createMemoryStore } from "./memory.ts";
import { createAgentActionsStore } from "./agent-actions-store.ts";
import { createAgentWorkStore } from "./agent-work-store.ts";
import { createTaskStore } from "./tasks.ts";
import { createConcernStore } from "./concern-store.ts";
import { createFamilyDocumentStore } from "./family-document-store.ts";
import { createSharedInputStore } from "./shared-input-store.ts";
import { createModelSettingsStore } from "./model-settings.ts";
import { createPhotoStore } from "./photo-store.ts";
import type { PhotoFiles } from "./photo-files.ts";
import { createFamilyStore } from "./families.ts";

const LOCK = 71403501;
const receiptAad = (id: string) => "account-erasure-receipt:1:" + id;
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const equalHash = (a: string, b: string) => /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
interface Space { id: string; owner_user_id: string; access_version: number; storage_epoch: string; change_seq: string }
interface ReceiptRow { operation_id: string; user_hash: string; token_hash: string; payload_encrypted: string; state: "prepared" | "completed"; expires_at: Date }
interface PreparedPayload { token: string; scopeHash: string; childCount: number }
export interface PreparedErasure extends AccountEraseReceipt { receiptToken: string; summary: { childCount: number }; expiresAt: string }
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let failed = false;
  try { await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    const value = await action(client); await client.query("COMMIT"); return value; }
  catch (error) { try { await client.query("ROLLBACK"); } catch { failed = true; } throw error; }
  finally { client.release(failed); }
}
async function lockScope(client: PoolClient, userId: string, exclusive: boolean) {
  // Serialize against role changes first, then check membership from a fresh statement.
  const candidates = (await client.query<{ id: string }>(`SELECT w.id FROM workspaces w LEFT JOIN family_members m ON m.workspace_id=w.id AND m.user_id=$1
    WHERE w.owner_user_id=$1 OR m.user_id IS NOT NULL ORDER BY w.id LIMIT 1001`, [userId])).rows;
  if (candidates.length > 1000) throw new AccountServiceError(409, "account_scope_too_large");
  const ids = candidates.map(row => row.id);
  await client.query(`SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR ${exclusive ? "UPDATE" : "SHARE"}`, [ids]);
  const spaces = (await client.query<Space>(`SELECT w.id,w.owner_user_id,w.access_version,w.storage_epoch,w.change_seq::text FROM workspaces w
    LEFT JOIN family_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.owner_user_id=$1 OR m.user_id IS NOT NULL ORDER BY w.id LIMIT 1001`, [userId])).rows;
  if (spaces.length !== ids.length || spaces.some((row, index) => row.id !== ids[index])) throw new AccountServiceError(409, "account_scope_changed");
  const user = (await client.query<{ id: string; name: string; email: string; emailVerified: boolean; createdAt: Date; updatedAt: Date }>(
    `SELECT id,name,email,"emailVerified","createdAt","updatedAt" FROM "user" WHERE id=$1 FOR ${exclusive ? "UPDATE" : "SHARE"}`, [userId])).rows[0];
  if (!user) throw new AccountServiceError(401, "unauthorized");
  const currentIds = (await client.query<{ id: string }>(`SELECT w.id FROM workspaces w LEFT JOIN family_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.owner_user_id=$1 OR m.user_id IS NOT NULL ORDER BY w.id LIMIT 1001`, [userId])).rows;
  if (currentIds.length !== ids.length || currentIds.some((row, index) => row.id !== ids[index])) throw new AccountServiceError(409, "account_scope_changed");
  return { spaces, ids, user };
}
async function erasureScope(client: PoolClient, userId: string) {
  const scope = await lockScope(client, userId, true);
  const owned = scope.spaces.filter(row => row.owner_user_id === userId).map(row => row.id);
  if ((await client.query("SELECT 1 FROM family_members WHERE workspace_id=ANY($1::uuid[]) AND user_id<>$2 LIMIT 1", [owned, userId])).rowCount)
    throw new AccountServiceError(409, "shared_workspace_requires_resolution");
  const children = (await client.query<{ id: string; workspace_id: string; profile_version: number }>(
    "SELECT id,workspace_id,profile_version FROM children WHERE workspace_id=ANY($1::uuid[]) ORDER BY id LIMIT 10001", [scope.ids])).rows;
  if (children.length > 10000) throw new AccountServiceError(409, "account_scope_too_large");
  const settings = (await client.query("SELECT version FROM model_settings WHERE user_id=$1", [userId])).rows;
  return { ...scope, scopeHash: hash({ spaces: scope.spaces, children, settings }), childCount: children.filter(row => owned.includes(row.workspace_id)).length };
}
export function createAccountDataStore(pool: Pool, cipher: StorageCipher, journal: ErasureJournal) {
  async function pending(client: Pool | PoolClient, operationId: string) {
    return Boolean((await client.query(`SELECT 1 FROM account_erasure_photos p JOIN photo_file_deletions d ON d.id=p.photo_id WHERE p.operation_id=$1 LIMIT 1`, [operationId])).rowCount);
  }
  async function receipt(client: Pool | PoolClient, operationId: string, token: string): Promise<ReceiptRow> {
    z.uuid().parse(operationId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccountServiceError(403, "erasure_receipt_invalid");
    const row = (await client.query<ReceiptRow>("SELECT * FROM account_erasure_receipts WHERE operation_id=$1", [operationId])).rows[0];
    if (!row || !equalHash(row.token_hash, hash(token))) throw new AccountServiceError(403, "erasure_receipt_invalid");
    return row;
  }
  async function assertJournal(client: PoolClient, head: JournalHead, allowBind = false) {
    const row = (await client.query<{ journal_id: string; latest_sequence: string; latest_digest: string }>("SELECT * FROM account_erasure_journal WHERE id=1 FOR UPDATE")).rows[0];
    if (!row) {
      if (!allowBind) throw new Error("Erasure journal is not bound to this database");
      await client.query("INSERT INTO account_erasure_journal(id,journal_id,latest_sequence,latest_digest) VALUES(1,$1,0,$2)", [journal.id, head.digest]);
      return;
    }
    if (row.journal_id !== journal.id || Number(row.latest_sequence) > head.sequence || Number(row.latest_sequence) === head.sequence && row.latest_digest !== head.digest)
      throw new Error("Erasure journal identity or latest head is invalid");
    // An older database is allowed only when its exact bound head still exists in the current external chain.
    if (Number(row.latest_sequence) < head.sequence) {
      let found = Number(row.latest_sequence) === 0;
      if (found) {
        // A zero-length initial head is compared below through the encrypted journal's chain predecessor.
        const emptyHead = await initialHead(); found = emptyHead.digest === row.latest_digest;
      } else for await (const entry of journal.entries()) if (entry.head.sequence === Number(row.latest_sequence)) { found = entry.head.digest === row.latest_digest; break; }
      if (!found) throw new Error("Erasure journal latest head is unavailable");
    }
  }
  async function initialHead(): Promise<JournalHead> {
    // The initial head is supplied by inspect when empty, or by the first entry's authenticated predecessor.
    if ((await journal.inspect()).sequence === 0) return journal.inspect();
    // The public journal supplies a verified genesis accessor, without exposing any identities.
    return journal.genesis();
  }
  async function rememberHead(client: PoolClient, head: JournalHead) {
    const changed = await client.query("UPDATE account_erasure_journal SET latest_sequence=$2,latest_digest=$3 WHERE id=1 AND journal_id=$1 AND (latest_sequence<$2 OR latest_sequence=$2 AND latest_digest=$3) RETURNING id", [journal.id, head.sequence, head.digest]);
    if (!changed.rowCount) {
      const row = (await client.query<{ journal_id: string; latest_sequence: string }>("SELECT journal_id,latest_sequence::text FROM account_erasure_journal WHERE id=1")).rows[0];
      if (!row || row.journal_id !== journal.id || Number(row.latest_sequence) <= head.sequence) throw new Error("Erasure journal head conflict");
    }
  }
  async function apply(client: PoolClient, intent: ErasureIntent, head: JournalHead) {
    const old = (await client.query<{ kind: string; target_hash: string; journal_id: string }>("SELECT kind,target_hash,journal_id FROM account_erasure_applied WHERE operation_id=$1", [intent.operationId])).rows[0];
    if (old && (old.kind !== intent.kind || !equalHash(old.target_hash, hash(intent.id)) || old.journal_id !== journal.id)) throw new Error("Erasure operation identity conflict");
    // Always apply the intent, even if an old backup contains an applied receipt.
    if (intent.kind === "user") {
      const candidates = (await client.query<{ id: string; owner_user_id: string }>(`SELECT w.id,w.owner_user_id FROM workspaces w
        LEFT JOIN family_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.owner_user_id=$1 OR m.user_id IS NOT NULL ORDER BY w.id`, [intent.id])).rows;
      await client.query("SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [candidates.map(row => row.id)]);
      await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [intent.id]);
      await client.query(`INSERT INTO account_erasure_photos(operation_id,photo_id) SELECT $1,p.id FROM photo_attachments p
        JOIN children c ON c.id=p.child_id JOIN workspaces w ON w.id=c.workspace_id WHERE p.owner_user_id=$2 OR w.owner_user_id=$2 ON CONFLICT DO NOTHING`, [intent.operationId, intent.id]);
      await client.query("DELETE FROM auth_mail_outbox WHERE user_id=$1", [intent.id]);
      await client.query("DELETE FROM family_invitations WHERE created_by=$1", [intent.id]);
      await client.query('DELETE FROM "user" WHERE id=$1', [intent.id]);
      for (const space of candidates.filter(row => row.owner_user_id !== intent.id)) {
        if ((await client.query("UPDATE workspaces SET access_version=access_version+1 WHERE id=$1 RETURNING id", [space.id])).rowCount)
          await appendOnlineChange(client, space.id, "family", null, false, null, false, { suppressWorkWake: true });
      }
      await client.query("UPDATE account_erasure_receipts SET state='completed',completed_at=COALESCE(completed_at,now()) WHERE operation_id=$1", [intent.operationId]);
    } else {
      const row = (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM children WHERE id=$1", [intent.id])).rows[0];
      if (row) {
        await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [row.workspace_id]);
        await client.query("INSERT INTO account_erasure_photos(operation_id,photo_id) SELECT $1,id FROM photo_attachments WHERE child_id=$2 ON CONFLICT DO NOTHING", [intent.operationId, intent.id]);
        const removed = await client.query("DELETE FROM children WHERE id=$1 AND workspace_id=$2 RETURNING id", [intent.id, row.workspace_id]);
        if (removed.rowCount) {
          await client.query("INSERT INTO deleted_children(id,workspace_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [intent.id, row.workspace_id]);
          await appendOnlineChange(client, row.workspace_id, "children", intent.id, true, null, false, { suppressWorkWake: true });
        }
      }
    }
    await client.query("INSERT INTO account_erasure_applied(operation_id,journal_id,kind,target_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [intent.operationId, journal.id, intent.kind, hash(intent.id)]);
    await rememberHead(client, head);
  }
  async function lockIntent(client: PoolClient, intent: ErasureIntent) {
    const rows = intent.kind === "user" ? (await client.query<{ id: string }>(`SELECT w.id FROM workspaces w LEFT JOIN family_members m ON m.workspace_id=w.id AND m.user_id=$1
      WHERE w.owner_user_id=$1 OR m.user_id IS NOT NULL ORDER BY w.id`, [intent.id])).rows
      : (await client.query<{ id: string }>("SELECT workspace_id AS id FROM children WHERE id=$1", [intent.id])).rows;
    await client.query("SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [rows.map(row => row.id)]);
  }
  async function rollForward(row: ReceiptRow) {
    if (row.state === "completed") return;
    for await (const entry of journal.entries()) {
      if (entry.intent.operationId !== row.operation_id) continue;
      if (entry.intent.kind !== "user" || !equalHash(hash(entry.intent.id), row.user_hash)) throw new Error("Erasure receipt journal identity conflict");
      await transaction(pool, async client => {
        await lockIntent(client, entry.intent); await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
        await assertJournal(client, await journal.inspect()); await apply(client, entry.intent, entry.head);
      });
      return;
    }
  }
  return {
    /** Offline startup/restore gate. Explicit binding is allowed only for a new deployment or acceptance fixture. */
    async replay(options: { initializeBinding?: boolean } = {}) {
      const head = await journal.inspect();
      await transaction(pool, async client => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
        await assertJournal(client, head, options.initializeBinding && head.sequence === 0);
      });
      for await (const entry of journal.entries()) await transaction(pool, async client => {
        await lockIntent(client, entry.intent); await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]); await apply(client, entry.intent, entry.head);
      });
      await transaction(pool, async client => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]);
        const current = await journal.inspect();
        if (current.sequence !== head.sequence || current.digest !== head.digest) throw new Error("Erasure journal changed during replay; restart is required");
        await assertJournal(client, current); await rememberHead(client, current);
      });
    },
    async prepare(userId: string, operationId: string): Promise<PreparedErasure> {
      z.uuid().parse(operationId);
      return transaction(pool, async client => {
        const scope = await erasureScope(client, userId);
        const old = (await client.query<ReceiptRow>("SELECT * FROM account_erasure_receipts WHERE operation_id=$1 FOR UPDATE", [operationId])).rows[0];
        if (old) {
          if (!equalHash(old.user_hash, hash(userId))) throw new AccountServiceError(409, "erasure_operation_conflict");
          const value = JSON.parse(cipher.decrypt(old.payload_encrypted, receiptAad(operationId))) as PreparedPayload;
          if (old.state === "prepared" && old.expires_at.getTime() <= Date.now()) throw new AccountServiceError(409, "erasure_receipt_expired");
          return { operationId, state: old.state, attachmentsPending: await pending(client, operationId), receiptToken: value.token, summary: { childCount: value.childCount }, expiresAt: old.expires_at.toISOString() };
        }
        const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + 600000);
        const value: PreparedPayload = { token, scopeHash: scope.scopeHash, childCount: scope.childCount };
        await client.query("INSERT INTO account_erasure_receipts(operation_id,user_hash,token_hash,payload_encrypted,expires_at) VALUES($1,$2,$3,$4,$5)",
          [operationId, hash(userId), hash(token), cipher.encrypt(JSON.stringify(value), receiptAad(operationId)), expiresAt]);
        return { operationId, state: "prepared", attachmentsPending: false, receiptToken: token, summary: { childCount: scope.childCount }, expiresAt: expiresAt.toISOString() };
      });
    },
    status: async (operationId: string, token: string): Promise<AccountEraseReceipt> => {
      let row = await receipt(pool, operationId, token); await rollForward(row); row = await receipt(pool, operationId, token);
      return { operationId, state: row.state, attachmentsPending: await pending(pool, operationId) };
    },
    /** The API must verify the native password before calling an uncompleted operation. */
    async execute(userId: string, raw: z.infer<typeof accountEraseExecuteSchema>): Promise<AccountEraseReceipt> {
      const input = accountEraseExecuteSchema.parse(raw); let old = await receipt(pool, input.operationId, input.receiptToken);
      await rollForward(old); old = await receipt(pool, input.operationId, input.receiptToken);
      if (!equalHash(old.user_hash, hash(userId))) throw new AccountServiceError(403, "erasure_receipt_invalid");
      if (old.state === "completed") return { operationId: input.operationId, state: "completed", attachmentsPending: await pending(pool, input.operationId) };
      return transaction(pool, async client => {
        const scope = await erasureScope(client, userId);
        const row = await receipt(client, input.operationId, input.receiptToken);
        if (row.state === "completed") return { operationId: input.operationId, state: "completed", attachmentsPending: await pending(client, input.operationId) };
        const value = JSON.parse(cipher.decrypt(row.payload_encrypted, receiptAad(input.operationId))) as PreparedPayload;
        if (row.expires_at.getTime() <= Date.now()) throw new AccountServiceError(409, "erasure_receipt_expired");
        if (!equalHash(value.scopeHash, scope.scopeHash)) throw new AccountServiceError(409, "account_scope_changed");
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]); await assertJournal(client, await journal.inspect());
        const intent: ErasureIntent = { operationId: input.operationId, kind: "user", id: userId, at: new Date().toISOString() };
        const head = await journal.append(intent); // Durable intent precedes SQL. A subsequent failure must roll forward on replay.
        await apply(client, intent, head);
        return { operationId: input.operationId, state: "completed", attachmentsPending: await pending(client, input.operationId) };
      });
    },
    /** Optional RecordStore hook: existing workspace owner lock and ownership check have already succeeded. */
    async recordChildIntent(client: PoolClient, childId: string): Promise<void> {
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK]); await assertJournal(client, await journal.inspect());
      const operationId = randomUUID(), intent: ErasureIntent = { operationId, kind: "child", id: childId, at: new Date().toISOString() };
      const head = await journal.append(intent);
      await client.query("INSERT INTO account_erasure_photos(operation_id,photo_id) SELECT $1,id FROM photo_attachments WHERE child_id=$2", [operationId, childId]);
      await client.query("INSERT INTO account_erasure_applied(operation_id,journal_id,kind,target_hash) VALUES($1,$2,'child',$3)", [operationId, journal.id, hash(childId)]);
      await rememberHead(client, head);
    },
  };
}
export type AccountDataStore = ReturnType<typeof createAccountDataStore>;


export const ACCOUNT_EXPORT_SECTIONS = ["manifest", "account", "children", "notification_deliveries", "notification_bindings",
  "profile", "profile_history", "care", "care_history", "chat", "instructions", "instruction_history", "agent_policy", "agent_work", "agent_runs", "agent_receipts",
  "memory_facts", "memory_fact_history", "memory_topics", "memory_topic_history", "summary", "summary_history", "tasks", "task_history", "concerns",
  "documents", "document_versions", "document_content", "private_sources", "private_source_history", "photos", "photo_content", "preparation", "preparation_history"] as const;
export type AccountExportSection = typeof ACCOUNT_EXPORT_SECTIONS[number];
const GLOBAL = new Set<AccountExportSection>(["manifest", "account", "children", "notification_deliveries", "notification_bindings"]);
const exportQuerySchema = z.object({ section: z.enum(ACCOUNT_EXPORT_SECTIONS), childId: z.uuid().optional(), scopeVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), cursor: z.string().min(1).max(16000).optional() }).strict();
export type AccountExportQuery = z.infer<typeof exportQuerySchema>;
const continuationSchema = z.object({ v: z.literal(1), userId: z.string().min(1).max(128), section: z.enum(ACCOUNT_EXPORT_SECTIONS), childId: z.uuid().nullable(), scopeVersion: z.string().regex(/^[a-f0-9]{64}$/), state: z.record(z.string(), z.unknown()) }).strict();
interface ExportKey { id: string; version?: number; secondary_id?: string }
/** Fixed sections and SQL selection. No caller can select a table, column or encryption context. */
export function createAccountExportStore(pool: Pool, cipher: StorageCipher, options: { photoFiles: PhotoFiles }) {
  function decodeCursor(raw: string | undefined, userId: string, query: AccountExportQuery) {
    if (!raw) return {} as Record<string, unknown>;
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const bytes = Buffer.from(raw, "base64url"); if (bytes.toString("base64url") !== raw) throw new Error();
      const cursor = continuationSchema.parse(JSON.parse(cipher.decrypt(bytes.toString("utf8"), "account-export-cursor:1:" + userId)));
      if (cursor.userId !== userId || cursor.section !== query.section || cursor.childId !== (query.childId ?? null) || cursor.scopeVersion !== query.scopeVersion) throw new Error();
      return cursor.state;
    } catch { throw new AccountServiceError(400, "invalid_export_cursor"); }
  }
  return {
    async page(userId: string, raw: AccountExportQuery): Promise<AccountExportPage> {
      const query = exportQuerySchema.parse(raw);
      if (GLOBAL.has(query.section) === Boolean(query.childId) || query.cursor && !query.scopeVersion) throw new AccountServiceError(400, "invalid_export_scope");
      const state = decodeCursor(query.cursor, userId, query);
      return transaction(pool, async client => {
        // Existing document readers take UPDATE locks. Hold all parent locks in a stable order first.
        const scope = await lockScope(client, userId, true), borrowed = transactionPool(client), local = borrowed.pool;
        const preferences = await createFamilyStore(local, cipher).preferences(userId), model = await createModelSettingsStore(local, cipher).get(userId);
        const deliveryVersions = (await client.query(`SELECT 'push' AS kind,count(*)::text AS count,max(created_at)::text AS created,max(attempted_at)::text AS attempted,max(finished_at)::text AS finished,
          count(*) FILTER(WHERE status='queued')::text AS queued,count(*) FILTER(WHERE status='unknown')::text AS unknown FROM web_push_deliveries WHERE user_id=$1
          UNION ALL SELECT 'telegram',count(*)::text,max(created_at)::text,max(attempted_at)::text,max(finished_at)::text,
          count(*) FILTER(WHERE status='queued')::text,count(*) FILTER(WHERE status='unknown')::text FROM telegram_deliveries WHERE user_id=$1
          UNION ALL SELECT 'contact',count(*)::text,max(attempted_at)::text,max(attempted_at)::text,max(finished_at)::text,
          count(*) FILTER(WHERE status='sending')::text,count(*) FILTER(WHERE status='unknown')::text FROM contact_attempts WHERE recipient_user_id=$1
          UNION ALL SELECT 'mail',count(*)::text,max(created_at)::text,max(updated_at)::text,max(updated_at)::text,
          count(*) FILTER(WHERE state='queued')::text,count(*) FILTER(WHERE state='unknown')::text FROM auth_mail_outbox WHERE user_id=$1`, [userId])).rows;
        const scopeVersion = hash({ user: scope.user, spaces: scope.spaces, preferences, model, deliveryVersions });
        if (query.scopeVersion && query.scopeVersion !== scopeVersion) throw new AccountServiceError(409, "export_scope_changed");
        if (query.childId && !(await client.query("SELECT 1 FROM children WHERE id=$1 AND workspace_id=ANY($2::uuid[])", [query.childId, scope.ids])).rowCount)
          throw new AccountServiceError(403, "export_scope_changed");
        const child = query.childId!, notices: string[] = [];
        let items: unknown[] = [], next: Record<string, unknown> | null = null;
        const care = createCareStore(local, cipher), memory = createMemoryStore(local, cipher), actions = createAgentActionsStore(local, cipher), work = createAgentWorkStore(local, cipher);
        const docs = createFamilyDocumentStore(local, cipher), sources = createSharedInputStore(local, cipher), photos = createPhotoStore(local, cipher, options.photoFiles);
        const textState = (name: string) => typeof state[name] === "string" ? state[name] as string : undefined;
        const numberState = (name: string) => typeof state[name] === "number" ? state[name] as number : undefined;
        async function ids(table: string, filter = "", limit = 10): Promise<ExportKey[]> {
          const rows = (await client.query<ExportKey>(`SELECT id FROM ${table} WHERE child_id=$1 AND $2::text IS NOT NULL ${filter}
            AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`, [child, userId, textState("after") ?? null, limit + 1])).rows;
          if (rows.length > limit) next = { after: rows[limit - 1].id };
          return rows.slice(0, limit);
        }
        async function revisions(sql: string, read: (row: ExportKey & Record<string, unknown>) => unknown): Promise<void> {
          const rows = (await client.query<ExportKey & Record<string, unknown>>(sql, [child, userId, textState("after") ?? null, numberState("version") ?? 0])).rows;
          if (rows.length > 10) next = { after: rows[9].id, version: rows[9].version };
          items = rows.slice(0, 10).map(read);
        }
        async function documentKey(): Promise<ExportKey | null> {
          const after = textState("after") ?? null;
          return (await client.query<ExportKey>("SELECT id FROM family_documents WHERE child_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 1", [child, after])).rows[0] ?? null;
        }
        const moreDocument = (id: string) => ({ after: id });
        switch (query.section) {
          case "manifest":
            items = [{ format: "yuban-personal-data:1", sections: ACCOUNT_EXPORT_SECTIONS.filter(value => value !== "manifest").map(section => ({ section, childScoped: !GLOBAL.has(section), required: true })),
              coverage: "Complete only after every global section and every section for each authorized child has reached complete=true.",
              historicalContent: "Unavailable historical content is identified with a reason; revoked or changed sources remain masked.", photoContent: "Original attachments are read through the existing authorized store." }]; break;
          case "account": items = [{ profile: scope.user, modelSettings: model, notificationPreferences: preferences }]; break;
          case "children": {
            const rows = (await client.query<{ id: string }>("SELECT id FROM children WHERE workspace_id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 11", [scope.ids, textState("after") ?? null])).rows;
            if (rows.length > 10) next = { after: rows[9].id };
            for (const row of rows.slice(0, 10)) items.push(await createRecordStore(local, cipher).getChildForUser(userId, row.id)); break;
          }
          case "profile": items = [await care.profile(userId, child)]; break;
          case "profile_history": {
            const page = await care.profileHistory(userId, child, numberState("before")); items = page?.revisions ?? [];
            if (page?.nextBeforeVersion) next = { before: page.nextBeforeVersion }; break;
          }
          case "care": for (const row of await ids("text_records")) items.push(await care.get(userId, child, row.id)); break;
          case "care_history": await revisions(`SELECT r.record_id AS id,r.version,r.payload_encrypted FROM text_record_revisions r JOIN text_records p ON p.id=r.record_id
            WHERE p.child_id=$1 AND (r.record_id,r.version)>(COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'),$4::integer) AND $2::text IS NOT NULL ORDER BY r.record_id,r.version LIMIT 11`, row => ({ recordId: row.id, version: row.version,
              revision: JSON.parse(cipher.decrypt(row.payload_encrypted as string, `care-history:${child}:${row.id}:${row.version}`)) })); break;
          case "chat": {
            const row = (await ids("chat_messages", "AND owner_user_id=$2", 1))[0];
            if (row) {
              const page = await work.readHistory(userId, child, { messageId: row.id, offset: numberState("offset") ?? 0, limit: 4000 }); items = page ? [page] : [];
              if (page?.nextOffset !== null && page?.nextOffset !== undefined) next = { after: textState("after") ?? null, offset: page.nextOffset };
            } break;
          }
          case "instructions": {
            const page = await actions.notes(userId, child, "", textState("after")); items = page?.items ?? [];
            if (page?.nextAfterId) next = { after: page.nextAfterId }; break;
          }
          case "instruction_history": await revisions(`SELECT r.note_id AS id,r.version,r.payload_encrypted FROM agent_private_note_revisions r
            JOIN agent_private_notes n ON n.id=r.note_id WHERE n.child_id=$1 AND n.owner_user_id=$2 AND r.owner_user_id=$2
            AND (r.note_id,r.version)>(COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'),$4::integer) ORDER BY r.note_id,r.version LIMIT 11`, row => ({ noteId: row.id, version: row.version,
              revision: JSON.parse(cipher.decrypt(row.payload_encrypted as string, `agent-private-note:${child}:${userId}:${row.id}:${row.version}`)) })); break;
          case "agent_policy": items = [await actions.policy(userId, child)]; break;
          case "agent_work": {
            const page = await work.readWork(userId, child, { workId: null, cursor: textState("cursor") ?? null }); items = page?.items ?? [];
            if (page?.nextCursor) next = { cursor: page.nextCursor }; break;
          }
          case "agent_runs": {
            const rows = await ids("agent_runs", "AND owner_user_id=$2", 5);
            for (const key of rows) {
              const row = (await client.query<{ id: string; child_id: string; owner_user_id: string; state: string; stop_reason: string | null; result_encrypted: string | null; authorization_version: string; data_version: string; created_at: Date; updated_at: Date }>(
                "SELECT id,child_id,owner_user_id,state,stop_reason,result_encrypted,authorization_version::text,data_version,created_at,updated_at FROM agent_runs WHERE id=$1 AND child_id=$2 AND owner_user_id=$3", [key.id, child, userId])).rows[0];
              const space = scope.spaces.find(value => value.id === (scope.ids.length === 1 ? scope.ids[0] : undefined)) ?? (await client.query<Space>("SELECT w.id,w.owner_user_id,w.access_version,w.storage_epoch,w.change_seq::text FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1", [child])).rows[0];
              const current = row.authorization_version === String(space.access_version) && row.data_version === space.storage_epoch + ":" + space.change_seq;
              const saved = row.result_encrypted && current ? JSON.parse(cipher.decrypt(row.result_encrypted, `agent-run:${child}:${userId}:${row.id}`)) as Record<string, unknown> : null;
              items.push({ runId: row.id, status: row.state, stopReason: row.stop_reason, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
                result: saved ? { text: saved.text, citations: saved.citations, tools: saved.tools, counts: saved.counts, countsKnown: saved.countsKnown, provenance: saved.provenance, retrievalMode: saved.retrievalMode } : null,
                unavailableReason: row.result_encrypted && !current ? "source_scope_changed" : !row.result_encrypted ? "result_not_saved" : null,
                proposals: (await client.query("SELECT id,version,state,created_at,expires_at FROM agent_proposals WHERE run_id=$1 ORDER BY created_at,id LIMIT 9", [row.id])).rows, proposalContentOmitted: true });
            } break;
          }
          case "agent_receipts": {
            for (const key of await ids("agent_action_receipts", "AND owner_user_id=$2")) {
              const row = (await client.query<{ run_id: string; payload_encrypted: string }>("SELECT run_id,payload_encrypted FROM agent_action_receipts WHERE id=$1 AND child_id=$2 AND owner_user_id=$3", [key.id, child, userId])).rows[0];
              const value = JSON.parse(cipher.decrypt(row.payload_encrypted, `agent-action:${child}:${userId}:${row.run_id}:${key.id}`)); items.push(value.receipt);
            } break;
          }
          case "memory_facts": {
            const page = await memory.facts(userId, child, textState("after")); items = page?.items ?? []; if (page?.nextAfterId) next = { after: page.nextAfterId }; break;
          }
          case "memory_topics": {
            const page = await memory.topics(userId, child, textState("after")); items = page?.items ?? []; if (page?.nextAfterId) next = { after: page.nextAfterId }; break;
          }
          case "memory_fact_history": case "memory_topic_history": {
            const fact = query.section === "memory_fact_history", name = fact ? "fact" : "topic";
            const rows = (await client.query<ExportKey>(`SELECT r.${name}_id AS id,r.version FROM memory_${name}_revisions r JOIN memory_${name}s p ON p.id=r.${name}_id
              WHERE p.child_id=$1 AND (p.visibility='family' OR p.created_by=$2) ${fact ? "AND (p.created_by=$2 OR r.visibility='family')" : ""}
              AND (r.${name}_id,r.version)>(COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'),$4::integer) ORDER BY r.${name}_id,r.version LIMIT 11`, [child, userId, textState("after") ?? null, numberState("version") ?? 0])).rows;
            if (rows.length > 10) next = { after: rows[9].id, version: rows[9].version };
            for (const row of rows.slice(0, 10)) { const page = await memory.history(userId, child, fact ? "facts" : "topics", row.id, row.version! + 1);
              const revision = page?.revisions.find(value => value.version === row.version); if (revision) items.push({ id: row.id, version: row.version, revision }); }
            break;
          }
          case "summary": {
            const result = await memory.summary(userId, child); items = [{ childId: child, summary: result?.summary ?? null, unavailableReason: result?.summary ? null : "no_current_authoritative_summary" }]; break;
          }
          case "summary_history": {
            const rows = (await client.query<{ id: string; version: number; previous_id: string | null; created_at: Date }>("SELECT id,version,previous_id,created_at FROM conversation_summaries WHERE child_id=$1 AND owner_user_id=$2 AND ($3::integer IS NULL OR version>$3) ORDER BY version LIMIT 11", [child, userId, numberState("version") ?? null])).rows;
            items = rows.slice(0, 10).map(row => ({ id: row.id, version: row.version, previousId: row.previous_id, createdAt: row.created_at.toISOString(), contentAvailable: false, unavailableReason: "historical_summary_not_current_authority" }));
            if (rows.length > 10) next = { version: rows[9].version }; break;
          }
          case "tasks": for (const row of await ids("care_tasks")) items.push(await createTaskStore(local, cipher).get(userId, child, row.id)); break;
          case "task_history": await revisions(`SELECT r.task_id AS id,r.version,r.payload_encrypted FROM task_revisions r JOIN care_tasks t ON t.id=r.task_id WHERE t.child_id=$1 AND $2::text IS NOT NULL
            AND (r.task_id,r.version)>(COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'),$4::integer) ORDER BY r.task_id,r.version LIMIT 11`, row => ({ taskId: row.id, version: row.version,
              revision: JSON.parse(cipher.decrypt(row.payload_encrypted as string, `care-task:${child}:${row.id}:${row.version}:revision`)) })); break;
          case "concerns": {
            const after = textState("after"); const page = await createConcernStore(local, cipher).reportPage(userId, child, after ? { id: after, sequence: numberState("sequence") ?? 0 } : undefined);
            items = page?.items ?? []; if (page?.next) next = { after: page.next.id, sequence: page.next.sequence }; break;
          }
          case "documents": {
            const page = await docs.list(userId, child, { status: "all", limit: 5, cursor: textState("cursor") ?? null });
            // Full content and all retained versions use separate bounded sections below.
            items = page?.items.map(({ current: _current, history: _history, ...item }) => ({ ...item, contentIn: "document_content", versionsIn: "document_versions" })) ?? [];
            if (page?.nextCursor) next = { cursor: page.nextCursor }; break;
          }
          case "document_versions": {
            const key = await documentKey(); if (!key) break;
            const page = await docs.listVersions(userId, child, key.id, textState("cursor") ?? null);
            items = page?.items.map(item => ({ documentId: key.id, ...item, unavailableReason: item.invalidated ? "source_scope_changed" : null })) ?? [];
            next = page?.nextCursor ? { after: textState("after") ?? null, cursor: page.nextCursor } : moreDocument(key.id); break;
          }
          case "document_content": {
            const key = await documentKey(); if (!key) break;
            const version = (await client.query<{ id: string; version: number }>("SELECT id,version FROM family_document_snapshots WHERE document_id=$1 AND ($2::integer IS NULL OR version>$2) ORDER BY version LIMIT 1", [key.id, numberState("version") ?? null])).rows[0];
            if (!version) { next = moreDocument(key.id); break; }
            const page = await docs.readContent(userId, child, key.id, { snapshotId: version.id, snapshotVersion: version.version, offset: numberState("offset") ?? 0 });
            items = page ? [{ ...page, unavailableReason: page.invalidated ? "source_scope_changed" : null }] : [];
            next = page?.nextOffset !== null && page?.nextOffset !== undefined ? { after: textState("after") ?? null, version: numberState("version") ?? null, offset: page.nextOffset }
              : { after: textState("after") ?? null, version: version.version }; break;
          }
          case "private_sources": for (const row of await ids("shared_inputs", "AND owner_user_id=$2")) items.push(await sources.get(userId, child, row.id)); break;
          case "private_source_history": await revisions(`SELECT r.input_id AS id,r.version,r.changed_at,r.payload_encrypted FROM shared_input_management_revisions r JOIN shared_inputs p ON p.id=r.input_id
            WHERE p.child_id=$1 AND p.owner_user_id=$2 AND r.owner_user_id=$2 AND (r.input_id,r.version)>(COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'),$4::integer) ORDER BY r.input_id,r.version LIMIT 11`, row => {
              const value = JSON.parse(cipher.decrypt(row.payload_encrypted as string, `shared-input:${row.id}:${child}:${userId}:management:${row.version}`));
              return { inputId: row.id, version: row.version, changedAt: (row.changed_at as Date).toISOString(), reason: value.reason, management: value.management, historicalSourceTextAvailable: false, unavailableReason: "source_text_history_not_retained" }; }); break;
          case "photos": for (const row of await ids("photo_attachments", "AND (owner_user_id=$2 OR visibility='shared')")) items.push(await photos.get(userId, child, row.id)); break;
          case "photo_content": {
            const row = (await ids("photo_attachments", "AND (owner_user_id=$2 OR visibility='shared') AND state='ready'", 1))[0];
            if (row) { const content = await photos.content(userId, child, row.id); if (content) items = [{ photoId: row.id, mimeType: content.mimeType, base64: content.base64 }]; } break;
          }
          case "preparation": case "preparation_history": {
            const table = query.section === "preparation" ? "visit_preparations" : "visit_preparation_revisions";
            const rows = (await client.query<{ version: number; payload_encrypted: string }>(`SELECT version,payload_encrypted FROM ${table} WHERE child_id=$1 AND ($2::integer IS NULL OR version>$2) ORDER BY version LIMIT 11`, [child, numberState("version") ?? null])).rows;
            items = rows.slice(0, 10).map(row => ({ childId: child, version: row.version, preparation: JSON.parse(cipher.decrypt(row.payload_encrypted, `visit-preparation:${child}:${row.version}`)) }));
            if (rows.length > 10) next = { version: rows[9].version }; break;
          }
          case "notification_bindings": case "notification_deliveries": {
            const bindings = query.section === "notification_bindings", channel = textState("channel") ?? "push";
            const sql = bindings ? channel === "push" ? "SELECT id,version,status,provider,created_at,updated_at FROM web_push_subscriptions"
              : "SELECT id,version,status,created_at,updated_at FROM telegram_bindings"
              : channel === "push" ? "SELECT id,subscription_id AS binding_id,status,reason,provider_status,created_at,attempted_at,finished_at FROM web_push_deliveries"
              : "SELECT id,binding_id,status,reason,provider_status,created_at,attempted_at,finished_at,acknowledged_at FROM telegram_deliveries";
            const rows = channel === "contact" && !bindings
              ? (await client.query<{ id: string }>(`SELECT a.id,a.request_id,a.channel,a.status,a.reason,a.provider_status,a.attempted_at,a.finished_at,a.acknowledged_at FROM contact_attempts a
                JOIN contact_requests r ON r.id=a.request_id JOIN children c ON c.id=r.child_id WHERE a.recipient_user_id=$1 AND c.workspace_id=ANY($3::uuid[])
                AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT 11`, [userId, textState("after") ?? null, scope.ids])).rows
              : channel === "mail" && !bindings
                ? (await client.query<{ id: string }>("SELECT id,kind,state,created_at,updated_at,expires_at FROM auth_mail_outbox WHERE user_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 11", [userId, textState("after") ?? null])).rows
                : (await client.query<{ id: string }>(sql + " WHERE user_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 11", [userId, textState("after") ?? null])).rows;
            items = rows.slice(0, 10).map(row => ({ channel, ...row }));
            next = rows.length > 10 ? { channel, after: rows[9].id } : channel === "push" ? { channel: "telegram" } : !bindings && channel === "telegram" ? { channel: "contact" } : !bindings && channel === "contact" ? { channel: "mail" } : null; break;
          }
        }
        borrowed.assertReleased();
        if (items.some(item => item === null)) throw new AccountServiceError(409, "export_scope_changed");
        const nextCursor = next ? Buffer.from(cipher.encrypt(JSON.stringify({ v: 1, userId, section: query.section, childId: query.childId ?? null, scopeVersion, state: next }), "account-export-cursor:1:" + userId)).toString("base64url") : null;
        return { section: query.section, items, nextCursor, complete: nextCursor === null, scopeVersion, notices };
      });
    },
  };
}
export type AccountExportStore = ReturnType<typeof createAccountExportStore>;
