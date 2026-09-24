import assert from "node:assert/strict";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createEncryptedBackup, restoreEncryptedBackup } from "../server/backup.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";

let sourcePool, restoredPool, restoreName, step = "preflight";
const omitted = ["session", "verification", "ai_attempts", "ai_daily_usage", "embedding_attempts", "app_migrations"];
async function digestTables(pool, names) {
  const result = {};
  await pool.query("SET TIME ZONE 'UTC'");
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unsupported table identifier");
    const rows = (await pool.query(`SELECT row_to_json(t)::text AS value FROM public."${name}" t ORDER BY row_to_json(t)::text`)).rows;
    result[name] = { rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows.map(row => row.value))).digest("hex") };
  }
  return result;
}
try {
  if (!process.argv.includes("--approved-knowledge-storage")) throw new Error("Approval required");
  const mode = process.argv[2];
  if (!["capture", "restore"].includes(mode)) throw new Error("Invalid mode");
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(source.pathname.slice(1)) || source.search || source.hash) throw new Error("Synthetic local DB required");
  const directory = process.env.KNOWLEDGE_ACCEPTANCE_DIR;
  const repository = resolve(fileURLToPath(new URL("../", import.meta.url)));
  if (!directory || !isAbsolute(directory) || resolve(directory).toLowerCase().startsWith(repository.toLowerCase())) throw new Error("Use a private directory outside the repository");
  const storageKey = await readSecretKey(process.env.STORAGE_KEY_FILE);
  const cipher = createStorageCipher(storageKey);
  const backupKey = await readSecretKey(process.env.BACKUP_KEY_FILE);
  assert.equal(timingSafeEqual(storageKey, backupKey), false);
  const config = url => readServerConfig({ ...process.env, DATABASE_URL: url.toString(), AI_ENABLED: "false", NODE_ENV: "test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099" });
  sourcePool = createPool(config(source));
  await verifyEncryptedStorage(sourcePool, cipher);
  const tools = url => ({ databaseUrl: url.toString(), container: process.env.PG_TOOL_CONTAINER });
  const names = (await sourcePool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  if (mode === "capture") {
    step = "before_image_snapshot_and_encrypted_backup";
    const prior = await digestTables(sourcePool, names.filter(name => !omitted.includes(name) && !name.startsWith("knowledge_")));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await createEncryptedBackup(tools(source), join(directory, "before-vector.ybak"), backupKey);
    await writeFile(join(directory, "private-table-hashes.json"), JSON.stringify(prior), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ event: "knowledge_storage_preimage_saved", privateTables: Object.keys(prior).length }));
  } else {
    step = "existing_private_data_unchanged";
    const before = JSON.parse(await readFile(join(directory, "private-table-hashes.json"), "utf8"));
    assert.deepEqual(await digestTables(sourcePool, Object.keys(before)), before);
    assert.equal((await sourcePool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion, "0.8.6");
    const preserved = names.filter(name => !["session", "verification"].includes(name));
    const expected = await digestTables(sourcePool, preserved);
    step = "vector_backup_and_empty_database_restore";
    const backup = join(directory, "with-vector.ybak");
    await createEncryptedBackup(tools(source), backup, backupKey);
    restoreName = `yuban_s06_test_rag_restore_${randomBytes(6).toString("hex")}`;
    const target = new URL(source); target.pathname = "/" + restoreName;
    assert.notEqual(target.pathname, source.pathname);
    await sourcePool.query(`CREATE DATABASE "${restoreName}"`);
    restoredPool = createPool(config(target));
    assert.equal((await restoredPool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount, 0);
    await restoreEncryptedBackup(tools(target), backup, backupKey);
    await verifyEncryptedStorage(restoredPool, cipher);
    assert.equal((await restoredPool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion, "0.8.6");
    assert.deepEqual(await digestTables(restoredPool, preserved), expected);
    assert.equal((await restoredPool.query('SELECT count(*)::integer AS n FROM session')).rows[0].n, 0);
    const nearest = await restoredPool.query("SELECT input_hash FROM knowledge_vectors ORDER BY embedding <=> (SELECT embedding FROM knowledge_vectors ORDER BY input_hash LIMIT 1) LIMIT 1");
    assert.equal(nearest.rowCount, 1);
    step = "cleanup_only_new_restore_database";
    await restoredPool.end(); restoredPool = undefined;
    if (!/^yuban_s06_test_rag_restore_[0-9a-f]{12}$/.test(restoreName) || restoreName === source.pathname.slice(1)) throw new Error("Unsafe restore cleanup");
    await sourcePool.query(`DROP DATABASE "${restoreName}"`); restoreName = undefined;
    console.log(JSON.stringify({ event: "knowledge_storage_restore_passed", restoredTables: preserved.length, privateDataPreserved: true, extension: "0.8.6", temporaryRestoreRemoved: true }));
  }
} catch { console.error(JSON.stringify({ event: "knowledge_storage_failed", step, temporaryRestoreRetained: Boolean(restoreName) })); process.exitCode = 1; }
finally { await restoredPool?.end(); await sourcePool?.end(); }
