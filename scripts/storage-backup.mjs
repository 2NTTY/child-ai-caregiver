import { timingSafeEqual } from "node:crypto";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { createEncryptedBackup, restoreEncryptedBackup } from "../server/backup.ts";

let pool;
let operation;
let requiresPhotoBackup = false;
async function refusePhotoAttachments(pool) {
  const table = await pool.query("SELECT to_regclass('public.photo_attachments') IS NOT NULL AS present");
  if (table.rows[0]?.present && (await pool.query("SELECT 1 FROM public.photo_attachments LIMIT 1")).rows.length) {
    requiresPhotoBackup = true;
    throw new Error();
  }
}
try {
  const file = process.argv[3];
  operation = process.argv[2];
  if (!["backup", "restore"].includes(operation) || !file) throw new Error();
  if (operation === "restore" && !process.argv.includes("--empty-target-server-stopped")) throw new Error();
  const storageKey = await readSecretKey(process.env.STORAGE_KEY_FILE);
  const backupKey = await readSecretKey(process.env.BACKUP_KEY_FILE);
  if (timingSafeEqual(storageKey, backupKey)) throw new Error();
  const config = readServerConfig(process.env);
  const cipher = createStorageCipher(storageKey);
  const options = { databaseUrl: config.databaseUrl, container: process.env.PG_TOOL_CONTAINER };
  pool = createPool(config);
  if (operation === "backup") {
    await refusePhotoAttachments(pool);
    await verifyEncryptedStorage(pool, cipher);
    await createEncryptedBackup(options, file, backupKey);
  } else {
    const objects = await pool.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
    if (objects.rows.length) throw new Error();
    await restoreEncryptedBackup(options, file, backupKey);
    await refusePhotoAttachments(pool);
    await verifyEncryptedStorage(pool, cipher);
    // Restored targets stay offline; sessions/verification codes are excluded from new backups.
  }
  console.log(operation === "backup" ? "encrypted_backup_created" : "encrypted_backup_restored_keep_server_stopped_until_review");
} catch {
  console.error(requiresPhotoBackup
    ? operation === "restore" ? "encrypted_restore_failed_use_photos_backup_keep_target_stopped" : "encrypted_backup_failed_use_photos_backup"
    : operation === "restore" ? "encrypted_restore_failed_keep_target_stopped" : "encrypted_backup_operation_failed");
  process.exitCode = 1;
}
finally { await pool?.end(); }
