import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth.ts";
import { readServerConfig } from "./config.ts";
import { createPool } from "./database.ts";

let pool: ReturnType<typeof createPool> | undefined;
try {
  const config = readServerConfig(process.env);
  pool = createPool(config);
  const auth = createAuth(config, pool);
  const client = await pool.connect();
  let discardClient = false;
  let transactionStarted = false;
  try {
    // One migration process at a time; auth tables are owned by the pinned adapter.
    await client.query("SELECT pg_advisory_lock(173061, 1)");
    const authMigration = await getMigrations(auth.options);
    await authMigration.runMigrations();
    const sql = await readFile(new URL("./migrations/001-workspaces.sql", import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query<{ checksum: string }>("SELECT checksum FROM app_migrations WHERE id = $1", ["001-workspaces"]);
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) throw new Error("Migration checksum mismatch");
    } else {
      await client.query(sql);
      await client.query("INSERT INTO app_migrations (id, checksum) VALUES ($1, $2)", ["001-workspaces", checksum]);
    }
    await client.query("COMMIT");
    transactionStarted = false;
    console.info("database_migrations_applied");
  } catch {
    discardClient = true;
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { /* Release still destroys the client. */ }
    }
    throw new Error("Migration failed");
  } finally {
    try {
      if (!discardClient) await client.query("SELECT pg_advisory_unlock(173061, 1)");
    } catch {
      discardClient = true;
      throw new Error("Migration cleanup failed");
    } finally {
      // Destroying a failed connection also releases its session advisory lock.
      client.release(discardClient);
    }
  }
} catch {
  console.error("database_migration_failed");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
