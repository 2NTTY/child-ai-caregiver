import { timingSafeEqual } from "node:crypto";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { createEncryptedPhotoBackup, restoreEncryptedPhotoBackup } from "../server/photo-backup.ts";

let pool;
let operation;
try {
  const [requestedOperation, file, ...flags] = process.argv.slice(2);
  operation = requestedOperation;
  const stoppedFlag = operation === "backup" ? "--server-stopped" : "--empty-target-server-stopped";
  if (!["backup", "restore"].includes(operation) || !file || flags.length !== 1 || flags[0] !== stoppedFlag
    || !process.env.ATTACHMENTS_DIR) throw new Error();
  const storageKey = await readSecretKey(process.env.STORAGE_KEY_FILE);
  const backupKey = await readSecretKey(process.env.BACKUP_KEY_FILE);
  if (timingSafeEqual(storageKey, backupKey)) throw new Error();
  const config = readServerConfig(process.env);
  pool = createPool(config);
  const options = { databaseUrl: config.databaseUrl, container: process.env.PG_TOOL_CONTAINER,
    pool, cipher: createStorageCipher(storageKey), attachmentsDirectory: process.env.ATTACHMENTS_DIR };
  if (operation === "backup") await createEncryptedPhotoBackup(options, file, backupKey);
  else await restoreEncryptedPhotoBackup(options, file, backupKey);
  console.log(operation === "backup" ? "encrypted_photo_backup_created"
    : "encrypted_photo_backup_restored_keep_server_stopped_until_review");
} catch {
  console.error(operation === "restore" ? "encrypted_photo_restore_failed_keep_target_stopped" : "encrypted_photo_backup_operation_failed");
  process.exitCode = 1;
} finally { await pool?.end(); }
