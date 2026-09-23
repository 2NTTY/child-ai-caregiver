import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { upgradeEncryptedStorage } from "../server/storage-upgrade.ts";
let pool;
try {
  if (!process.argv.includes("--server-stopped")) throw new Error();
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  pool = createPool(readServerConfig(process.env));
  await upgradeEncryptedStorage(pool, cipher);
  console.log("storage_encryption_upgrade_complete");
} catch { console.error("storage_encryption_upgrade_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
