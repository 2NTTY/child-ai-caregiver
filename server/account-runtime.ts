import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { StorageCipher } from "./storage-crypto.ts";
import { AccountAdmissionError, createAccountAdmission } from "./account-admission.ts";
import { readAccountServiceConfig } from "./account-service-config.ts";
import { createAccountDataStore } from "./account-data.ts";
import { openErasureJournal } from "./erasure-journal.ts";
import { assertPrivatePath } from "./private-path.ts";

/** API and worker must replay the current independent erasure journal before serving work. */
export async function openAccountRuntime(pool: Pool, cipher: StorageCipher, env: Record<string, string | undefined>) {
  const config = await readAccountServiceConfig(env);
  const ready = (await pool.query("SELECT id FROM app_migrations WHERE id IN ('034-account-admission','035-account-data-exit')")).rows;
  if (ready.length === 0 && !config.enabled && !env.ACCOUNT_ERASURE_JOURNAL_DIR) return undefined;
  if (ready.length !== 2) throw new Error("account_migrations_required");
  const journal = await openErasureJournal({ directory: env.ACCOUNT_ERASURE_JOURNAL_DIR ?? "",
    repositoryPath: resolve(dirname(fileURLToPath(import.meta.url)), ".."), cipher, assertProtectedDirectory: assertPrivatePath });
  const data = createAccountDataStore(pool, cipher, journal);
  await data.replay();
  const admission = createAccountAdmission(pool, { enabled: config.enabled, mailConfigured: Boolean(config.smtp) });
  const allowed = async (userId: string) => {
    try { await admission.assertUsable(userId); return true; }
    catch (error) { if (error instanceof AccountAdmissionError) return false; throw error; }
  };
  return { config, admission, data, allowed };
}
