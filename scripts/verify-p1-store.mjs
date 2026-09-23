import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { upgradeEncryptedStorage } from "../server/storage-upgrade.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createAuth } from "../server/auth.ts";
import { createRecordStore } from "../server/records.ts";
import { createChatStore } from "../server/chat.ts";
import { createAiUsageStore } from "../server/ai-usage.ts";

// Run only after approval. Restrict all writes to the existing local synthetic DB.
let pool;
let step = "preflight";
try {
  if (!process.argv.includes("--approved-local")) throw new Error("Approval required");
  const value = process.env.TEST_DATABASE_URL;
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(decodeURIComponent(url.pathname.slice(1)))
    || url.search || url.hash) throw new Error("Local synthetic DB required");
  const env = {
    ...process.env, DATABASE_URL: value, AI_ENABLED: "false",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099",
    NODE_ENV: "test",
  };
  step = "additive_migrations";
  execFileSync(process.execPath, [fileURLToPath(new URL("../server/migrate.ts", import.meta.url))],
    { env, cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "ignore", windowsHide: true, timeout: 30000 });
  const config = readServerConfig(env);
  pool = createPool(config);
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  await upgradeEncryptedStorage(pool, cipher);
  const auth = createAuth(config, pool);
  const accounts = [];
  step = "synthetic_accounts";
  for (let index = 0; index < 2; index++) {
    const account = await auth.api.signUpEmail({
      body: { name: "Synthetic P1 check", email: `p1-${randomUUID()}@example.test`, password: randomBytes(24).toString("hex") },
      headers: new Headers({ origin: config.publicOrigin }),
    });
    accounts.push(account.user.id);
  }
  const [owner, other] = accounts;
  const child = await createRecordStore(pool, cipher).createChildForUser(owner, { displayName: "合成聊天驗收" });
  const chats = createChatStore(pool, cipher);
  const raw = "  合成文字：大約 3 點。\n🙂  ";
  step = "chat_original_and_roles";
  const message = await chats.createUserMessageForUser(owner, child.id, raw);
  assert.equal(message?.text, raw);
  assert.equal(message?.authorUserId, owner);
  const reply = await chats.createModelMessageForUser(owner, child.id, message.id, "合成回答，沒有呼叫模型。");
  assert.equal(reply?.authorUserId, null);
  assert.equal(reply?.role, "model");
  assert.equal(reply?.inReplyTo, message.id);
  assert.equal(await chats.createModelMessageForUser(owner, child.id, message.id, "重複"), null);
  step = "private_isolation";
  assert.equal(await chats.listForUser(other, child.id), null);
  assert.equal(await chats.createUserMessageForUser(other, child.id, raw), null);
  assert.equal(await chats.createModelMessageForUser(other, child.id, message.id, raw), null);
  step = "atomic_quota";
  const quota = createAiUsageStore(pool);
  const before = await pool.query("SELECT attempts FROM ai_daily_usage WHERE day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AND scope_key = 'global'");
  const globalLimit = (before.rows[0]?.attempts ?? 0) + 3;
  const attempts = await Promise.all(Array.from({ length: 5 }, () => quota.reserve(owner, 3, globalLimit)));
  assert.equal(attempts.filter(Boolean).length, 3);
  assert.equal(await quota.reserve(other, 3, globalLimit), false);
  await quota.record({ userId: owner, childId: child.id, model: "synthetic", outcome: "succeeded",
    inputTokens: null, outputTokens: null, cachedTokens: null, durationMs: 1 });
  await pool.end();
  pool = createPool(config);
  step = "reopen_persistence";
  const page = await createChatStore(pool, cipher).listForUser(owner, child.id);
  assert.equal(page.messages.length, 2);
  assert.equal(page.messages.find(row => row.id === message.id)?.text, raw);
  assert.equal(await createAiUsageStore(pool).reserve(owner, 3, globalLimit), false);
  console.log(JSON.stringify({ result: "passed", checks: 6, syntheticOnly: true, realModelCalls: 0,
    preservedExistingData: true, scope: "migration, original text/roles, isolation, atomic quota, metadata, new pool persistence" }));
} catch {
  console.error(JSON.stringify({ result: "failed", step }));
  process.exitCode = 1;
} finally {
  await pool?.end();
}