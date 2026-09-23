import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAuth } from "../server/auth.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createRecordStore } from "../server/records.ts";
import { createChatStore } from "../server/chat.ts";
import { createAiUsageStore } from "../server/ai-usage.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { upgradeEncryptedStorage, verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { restoreEncryptedBackup } from "../server/backup.ts";

let pool, restoredPool;
let step = "preflight";
const repository = fileURLToPath(new URL("../", import.meta.url));
function run(script, args, env) {
  execFileSync(process.execPath, [script, ...args], { cwd: repository, env, stdio: "ignore", windowsHide: true, timeout: 120000 });
}
async function snapshot(pool, cipher, upgraded) {
  const select = upgraded ? ", display_name_encrypted" : "";
  const children = (await pool.query(`SELECT child.id, display_name${select}, workspace.owner_user_id FROM children child JOIN workspaces workspace ON workspace.id=child.workspace_id ORDER BY child.id`)).rows;
  const records = (await pool.query(`SELECT id, child_id, author_user_id, text${upgraded ? ", text_encrypted" : ""} FROM text_records ORDER BY id`)).rows;
  const chats = (await pool.query(`SELECT id, child_id, owner_user_id, role, in_reply_to, text${upgraded ? ", text_encrypted" : ""} FROM chat_messages ORDER BY id`)).rows;
  return {
    children: children.map(row => [row.id, row.owner_user_id, upgraded ? cipher.decrypt(row.display_name_encrypted, `children:${row.id}:${row.owner_user_id}:display_name`) : row.display_name]),
    records: records.map(row => [row.id, row.child_id, row.author_user_id, upgraded ? cipher.decrypt(row.text_encrypted, `text_records:${row.id}:${row.child_id}:${row.author_user_id}:text`) : row.text]),
    chats: chats.map(row => [row.id, row.child_id, row.owner_user_id, row.role, row.in_reply_to, upgraded ? cipher.decrypt(row.text_encrypted, `chat_messages:${row.id}:${row.child_id}:${row.owner_user_id}:${row.role}:${row.in_reply_to ?? ""}:text`) : row.text]),
  };
}
try {
  if (!process.argv.includes("--approved-local-encryption")) throw new Error();
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(source.pathname.slice(1)) || source.search || source.hash) throw new Error();
  const env = { ...process.env, DATABASE_URL: source.toString(), AI_ENABLED: "false", NODE_ENV: "test",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099" };
  const config = readServerConfig(env);
  const cipher = createStorageCipher(await readSecretKey(env.STORAGE_KEY_FILE));
  pool = createPool(config);
  const exists = (await pool.query("SELECT to_regclass('public.storage_security') IS NOT NULL AS present")).rows[0].present;
  const upgraded = exists && (await pool.query("SELECT 1 FROM storage_security WHERE id=1")).rows.length === 1;
  const before = await snapshot(pool, cipher, upgraded);
  step = "additive_migration_and_atomic_conversion";
  run("server/migrate.ts", [], env);
  await upgradeEncryptedStorage(pool, cipher);
  await verifyEncryptedStorage(pool, cipher);
  assert.deepEqual(await snapshot(pool, cipher, true), before);
  await assert.rejects(verifyEncryptedStorage(pool, createStorageCipher(randomBytes(32))));
  for (const [table, column] of [["children", "display_name"], ["text_records", "text"], ["chat_messages", "text"]]) {
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} IS NOT NULL`)).rows[0].count, 0);
  }
  step = "new_encrypted_writes_and_isolation";
  const auth = createAuth(config, pool), accounts = [];
  for (let index = 0; index < 2; index++) {
    const credentials = { name: "Synthetic storage check", email: `storage-${randomUUID()}@example.test`, password: randomBytes(24).toString("hex") };
    const account = await auth.api.signUpEmail({ body: credentials, headers: new Headers({ origin: config.publicOrigin }) });
    accounts.push({ id: account.user.id, ...credentials });
  }
  const records = createRecordStore(pool, cipher), chats = createChatStore(pool, cipher);
  const child = await records.createChildForUser(accounts[0].id, { displayName: "合成加密孩子" });
  const raw = "  合成原文：大約 3 點。\n🙂  ";
  const record = await records.createRecordForUser(accounts[0].id, { childId: child.id, text: raw });
  const message = await chats.createUserMessageForUser(accounts[0].id, child.id, raw);
  await chats.createModelMessageForUser(accounts[0].id, child.id, message.id, "合成模型回覆，沒有呼叫真模型。");
  assert.equal(record.text, raw);
  assert.equal((await chats.listForUser(accounts[0].id, child.id)).messages[0].text, raw);
  assert.equal(await chats.listForUser(accounts[1].id, child.id), null);
  step = "scoped_synthetic_deletion";
  const disposable = await records.createChildForUser(accounts[0].id, { displayName: "只供刪除驗收的新合成孩子" });
  await records.createRecordForUser(accounts[0].id, { childId: disposable.id, text: raw });
  const disposableMessage = await chats.createUserMessageForUser(accounts[0].id, disposable.id, raw);
  await chats.createModelMessageForUser(accounts[0].id, disposable.id, disposableMessage.id, "合成回覆");
  const usage = createAiUsageStore(pool);
  assert.equal(await usage.reserve(accounts[0].id, 3, 1000), true);
  await usage.record({ userId: accounts[0].id, childId: disposable.id, model: "synthetic", outcome: "succeeded", inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 0 });
  assert.equal(await records.deleteChildForUser(accounts[1].id, disposable.id), false);
  assert.equal(await records.deleteChildForUser(accounts[0].id, disposable.id), true);
  for (const table of ["text_records", "chat_messages", "ai_attempts"]) {
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE child_id=$1`, [disposable.id])).rows[0].count, 0);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM deleted_children WHERE id=$1", [disposable.id])).rows[0].count, 1);
  assert.equal((await usage.getForUser(accounts[0].id)).attempts, 1);
  assert.ok(await records.getChildForUser(accounts[0].id, child.id));
  const expected = await snapshot(pool, cipher, true);
  step = "encrypted_backup";
  const directory = new URL("../backups/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const backup = fileURLToPath(new URL(`s05-${randomUUID()}.ybak`, directory));
  run("scripts/storage-backup.mjs", ["backup", backup], env);
  const targetName = `yuban_s06_test_restore_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`);
  const target = new URL(source); target.pathname = `/${targetName}`;
  const targetConfig = readServerConfig({ ...env, DATABASE_URL: target.toString() });
  restoredPool = createPool(targetConfig);
  step = "tampered_backup_rejected_before_restore";
  const corrupt = Buffer.from(await readFile(backup)); corrupt[corrupt.length - 1] ^= 1;
  const damaged = `${backup}.damaged`;
  await writeFile(damaged, corrupt, { flag: "wx", mode: 0o600 });
  await assert.rejects(restoreEncryptedBackup({ databaseUrl: target.toString(), container: env.PG_TOOL_CONTAINER }, damaged, await readSecretKey(env.BACKUP_KEY_FILE)));
  assert.equal((await restoredPool.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0);
  step = "empty_target_restore_and_authenticated_read";
  run("scripts/storage-backup.mjs", ["restore", backup, "--empty-target-server-stopped"], { ...env, DATABASE_URL: target.toString() });
  assert.deepEqual(await snapshot(restoredPool, cipher, true), expected);
  assert.equal((await restoredPool.query('SELECT count(*)::int AS count FROM session')).rows[0].count, 0);
  const recovered = await createAuth(targetConfig, restoredPool).api.signInEmail({ body: { email: accounts[0].email, password: accounts[0].password }, headers: new Headers({ origin: targetConfig.publicOrigin }) });
  assert.equal(recovered.user.id, accounts[0].id);
  assert.equal((await createRecordStore(restoredPool, cipher).listRecordsForUser(accounts[0].id, child.id)).records[0].text, raw);
  assert.equal((await createAiUsageStore(restoredPool).getForUser(accounts[0].id)).attempts, 1);
  step = "nonempty_restore_refused";
  assert.throws(() => run("scripts/storage-backup.mjs", ["restore", backup, "--empty-target-server-stopped"], { ...env, DATABASE_URL: target.toString() }));
  assert.deepEqual(await snapshot(restoredPool, cipher, true), expected);
  console.log(JSON.stringify({ result: "passed", checks: 7, syntheticOnly: true, realModelCalls: 0,
    preservedLegacyRows: { children: before.children.length, records: before.records.length, chats: before.chats.length },
    plaintextBusinessColumnsRemaining: 0, existingDataDeleted: false, deletedOnlyNewSyntheticChild: true,
    targetDatabase: targetName, encryptedBackup: backup, restoredSessionCountBeforeLogin: 0,
    restoredBodiesEqual: true, restoredAuthentication: true, credentialsAndBodiesLogged: false }));
} catch { console.error(JSON.stringify({ result: "failed", step, credentialsAndBodiesLogged: false })); process.exitCode = 1; }
finally { await restoredPool?.end(); await pool?.end(); }
