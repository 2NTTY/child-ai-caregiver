import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { openErasureJournal } from "../server/erasure-journal.ts";
import { createAccountDataStore } from "../server/account-data.ts";
import { assertPrivatePath } from "../server/private-path.ts";
let pool;
try {
  const command = process.argv[2];
  if (!["initialize", "bind", "replay"].includes(command) || process.argv.length !== 3) throw new Error();
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  const directory = process.env.ACCOUNT_ERASURE_JOURNAL_DIR ?? "";
  if (command === "initialize") await assertPrivatePath(dirname(directory));
  const journal = await openErasureJournal({ directory, cipher, initialize: command === "initialize",
    repositoryPath: resolve(dirname(fileURLToPath(import.meta.url)), ".."), assertProtectedDirectory: assertPrivatePath });
  if (command !== "initialize") {
    pool = createPool(readServerConfig(process.env));
    await createAccountDataStore(pool, cipher, journal).replay({ initializeBinding: command === "bind" });
  }
  console.info(JSON.stringify({ state: command === "initialize" ? "initialized" : "replayed" }));
} catch { console.error("account_erasure_journal_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
