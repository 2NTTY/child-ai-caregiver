import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";

const CHECK_CONTEXT = "storage_security:1:key_check";
const CHECK_VALUE = "yuban-storage-v1";
export async function verifyEncryptedStorage(pool: Pool, cipher: StorageCipher): Promise<void> {
  const result = await pool.query<{ version: number; key_check: string }>("SELECT version, key_check FROM storage_security WHERE id = 1");
  const row = result.rows[0];
  if (!row || row.version !== 1 || cipher.decrypt(row.key_check, CHECK_CONTEXT) !== CHECK_VALUE) {
    throw new Error("Encrypted storage upgrade required");
  }
}

/** Run with the old Server stopped; commit conversion and plaintext rejection together. */
export async function upgradeEncryptedStorage(pool: Pool, cipher: StorageCipher): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("LOCK TABLE storage_security, children, text_records, chat_messages IN ACCESS EXCLUSIVE MODE");
    const state = await client.query<{ key_check: string }>("SELECT key_check FROM storage_security WHERE id = 1");
    if (state.rows[0]) {
      if (cipher.decrypt(state.rows[0].key_check, CHECK_CONTEXT) !== CHECK_VALUE) throw new Error();
      await client.query("COMMIT");
      return;
    }
    const targets = [
      { table: "children", plain: "display_name", encrypted: "display_name_encrypted",
        query: "SELECT child.id, child.display_name AS plain, workspace.owner_user_id AS owner FROM children child JOIN workspaces workspace ON workspace.id = child.workspace_id WHERE child.display_name_encrypted IS NULL LIMIT 100",
        context: (row: Record<string, string>) => `children:${row.id}:${row.owner}:display_name` },
      { table: "text_records", plain: "text", encrypted: "text_encrypted",
        query: "SELECT id, child_id, author_user_id, text AS plain FROM text_records WHERE text_encrypted IS NULL LIMIT 100",
        context: (row: Record<string, string>) => `text_records:${row.id}:${row.child_id}:${row.author_user_id}:text` },
      { table: "chat_messages", plain: "text", encrypted: "text_encrypted",
        query: "SELECT id, child_id, owner_user_id, role, in_reply_to, text AS plain FROM chat_messages WHERE text_encrypted IS NULL LIMIT 100",
        context: (row: Record<string, string>) => `chat_messages:${row.id}:${row.child_id}:${row.owner_user_id}:${row.role}:${row.in_reply_to ?? ""}:text` },
    ];
    for (const target of targets) {
      const partial = await client.query(`SELECT 1 FROM ${target.table} WHERE ${target.encrypted} IS NOT NULL LIMIT 1`);
      if (partial.rows.length) throw new Error("Unexpected partial encryption state");
      while (true) {
        const rows = await client.query<Record<string, string>>(target.query);
        if (!rows.rows.length) break;
        for (const row of rows.rows) {
          if (typeof row.plain !== "string") throw new Error();
          const encrypted = cipher.encrypt(row.plain, target.context(row));
          if (cipher.decrypt(encrypted, target.context(row)) !== row.plain) throw new Error();
          await client.query(`UPDATE ${target.table} SET ${target.encrypted} = $1, ${target.plain} = NULL WHERE id = $2`, [encrypted, row.id]);
        }
      }
      await client.query(`ALTER TABLE ${target.table} ALTER COLUMN ${target.encrypted} SET NOT NULL`);
      await client.query(`ALTER TABLE ${target.table} ADD CONSTRAINT ${target.table}_plaintext_absent CHECK (${target.plain} IS NULL)`);
    }
    await client.query("INSERT INTO storage_security (id, version, key_check) VALUES (1, 1, $1)", [cipher.encrypt(CHECK_VALUE, CHECK_CONTEXT)]);
    await client.query("COMMIT");
  } catch {
    failed = true;
    try { await client.query("ROLLBACK"); } catch { /* Discard the connection. */ }
    throw new Error("Encrypted storage upgrade failed");
  } finally { client.release(failed); }
}
