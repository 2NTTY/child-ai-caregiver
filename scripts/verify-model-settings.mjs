import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

class VerificationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireThat = (condition, code = "assertion_failed") => { if (!condition) throw new VerificationError(code); };
const repository = fileURLToPath(new URL("../", import.meta.url));
const limits = { http: 20, stores: 40, accounts: 2 };
const accounts = [], completedChecks = [];
let pool, server, reportFile, restoreFetch;
let step = "preflight", requests = 0, storeCalls = 0, blockedExternalRequests = 0;
let result = "running", failureCode = null, existingDataPreserved = false, syntheticCleanupCompleted = false;
const metadata = () => ({ result, step, code: failureCode, completedChecks, httpRequests: requests, storeCalls,
  limits, syntheticAccounts: accounts.map(({ id, email }) => ({ ...(id ? { id } : {}), email })),
  existingDataPreserved, syntheticCleanupCompleted, migration: "024-personal-model-settings",
  modelCalls: 0, notificationCalls: 0, blockedExternalRequests, childrenCreated: 0,
  backupPerformedByScript: false, bodiesLogged: false, secretsLogged: false });
async function persistReport() {
  if (!reportFile) return;
  const bytes = Buffer.from(JSON.stringify(metadata(), null, 2) + "\n");
  let offset = 0;
  while (offset < bytes.length) {
    const written = await reportFile.write(bytes, offset, bytes.length - offset, offset);
    requireThat(written.bytesWritten > 0, "report_write_failed"); offset += written.bytesWritten;
  }
  await reportFile.truncate(bytes.length); await reportFile.sync();
}
async function check(name, action) {
  step = name; await persistReport(); await action(); completedChecks.push(name); await persistReport();
}
function consumeStore() {
  requireThat(storeCalls < limits.stores, "store_limit_reached"); storeCalls++;
}
function countStore(store) {
  for (const [name, method] of Object.entries(store)) if (typeof method === "function") {
    store[name] = async (...args) => { consumeStore(); return method.apply(store, args); };
  }
  return store;
}
async function snapshot(database, ids = []) {
  const ownedCounters = ids.flatMap(id => ["user:" + id, "personal:user:" + id]);
  const tables = [
    ["user", "id", ids], ["model_settings", "user_id", ids], ["ai_daily_usage", "scope_key", ownedCounters],
    ["ai_attempts", "user_id", ids], ["embedding_attempts", "actor_id", ids], ["online_operations", "user_id", ids],
    ["children"], ["text_records"], ["chat_messages"],
  ];
  const rows = [];
  for (const [table, column, excluded = []] of tables) {
    const where = column ? ` WHERE NOT (t.${column}=ANY($1::text[]))` : "";
    const sql = `SELECT count(*)::text AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS digest FROM "${table}" t${where}`;
    rows.push([table, (await database.query(sql, column ? [excluded] : [])).rows[0]]);
  }
  // Content and ciphertext stay in PostgreSQL; these aggregate comparisons are never reported.
  return JSON.stringify(rows);
}

try {
  requireThat(process.argv.includes("--approved-personal-model"), "approval_required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  requireThat(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && /^yuban_s06_test[A-Za-z0-9_]*$/u.test(url.pathname.slice(1)) && !url.search && !url.hash, "synthetic_local_database_required");
  requireThat(process.env.STORAGE_KEY_FILE && process.env.BACKUP_KEY_FILE
    && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(process.env.PG_TOOL_CONTAINER ?? ""), "storage_backup_configuration_required");
  requireThat(isAbsolute(process.env.TEST_REPORT_FILE ?? ""), "external_report_file_required");
  const reportPath = resolve(process.env.TEST_REPORT_FILE);
  const physicalParent = await realpath(dirname(reportPath));
  const physicalRepository = await realpath(repository);
  const reportRelative = relative(physicalRepository, resolve(physicalParent, basename(reportPath)));
  requireThat(reportRelative !== "" && (isAbsolute(reportRelative) || reportRelative === ".." || reportRelative.startsWith(".." + sep)), "report_must_be_outside_repository");
  // A fresh exclusive file keeps recovery metadata out of the repository and avoids following an existing symlink.
  reportFile = await open(reportPath, "wx", 0o600); await persistReport();
  const [databaseModule, configModule, authModule, appModule, workspaceModule, recordModule, onlineModule,
    cipherModule, upgradeModule, routingModule, aiModule, settingsModule, usageModule, transactionModule] = await Promise.all([
    import("../server/database.ts"), import("../server/config.ts"), import("../server/auth.ts"), import("../server/app.ts"),
    import("../server/workspaces.ts"), import("../server/records.ts"), import("../server/online.ts"),
    import("../server/storage-crypto.ts"), import("../server/storage-upgrade.ts"), import("../server/model-routing.ts"),
    import("../server/ai-config.ts"), import("../server/model-settings.ts"), import("../server/ai-usage.ts"), import("../server/transaction-pool.ts"),
  ]);
  const cipher = cipherModule.createStorageCipher(await cipherModule.readSecretKey(process.env.STORAGE_KEY_FILE));
  await cipherModule.readSecretKey(process.env.BACKUP_KEY_FILE);
  const origin = "http://127.0.0.1:3097";
  const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: origin, WEB_ORIGIN: origin, PORT: "3097", HOST: "127.0.0.1", TRUSTED_PROXY_IP: undefined };
  const config = configModule.readServerConfig(env);
  pool = databaseModule.createPool(config);
  await check("migration_already_applied_and_storage_authenticated", async () => {
    requireThat((await pool.query("SELECT 1 FROM app_migrations WHERE id='024-personal-model-settings'")).rowCount === 1, "migration_024_required");
    await upgradeModule.verifyEncryptedStorage(pool, cipher);
  });
  const before = await snapshot(pool);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== origin) { blockedExternalRequests++; throw new VerificationError("external_http_forbidden"); }
    return originalFetch(input, options);
  };
  restoreFetch = () => { globalThis.fetch = originalFetch; };
  const aiConfig = aiModule.readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-byok-validation", AI_MAX_ATTEMPTS: "1" });
  const routing = routingModule.createModelRouting(pool, cipher, aiConfig);
  countStore(routing.settings);
  const view = routing.view.bind(routing);
  routing.view = async userId => {
    // view's two usage reads are additional store calls; its settings read is counted by the wrapper above.
    consumeStore(); consumeStore(); return view(userId);
  };
  const auth = authModule.createAuth(config, pool);
  const handler = appModule.createRequestHandler({ config, auth, modelRouting: routing,
    workspaces: workspaceModule.createWorkspaceStore(pool), records: recordModule.createRecordStore(pool, cipher),
    online: onlineModule.createOnlineStore(pool, cipher), checkDatabase: async () => { await pool.query("SELECT 1"); } });
  server = createServer((request, response) => { void handler(request, response); });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(3097, "127.0.0.1", accept); });
  const syntheticKey = "synthetic-local-only-" + randomBytes(24).toString("hex");
  async function request(account, path, body, expected = 200, expectedUserId = account?.id) {
    requireThat(requests < limits.http, "http_limit_reached"); requests++;
    const response = await fetch(origin + "/api" + path, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { origin, ...(account ? { cookie: account.cookie, "x-expected-user-id": expectedUserId } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    requireThat(!text.includes(syntheticKey) && !text.includes("yb1."), "secret_exposed_in_http_response");
    requireThat(response.status === expected, "unexpected_http_status");
    let data; try { data = JSON.parse(text); } catch { throw new VerificationError("invalid_http_json"); }
    return { data, headers: response.headers };
  }
  await check("two_synthetic_authenticated_accounts", async () => {
    for (let index = 0; index < limits.accounts; index++) {
      const account = { email: "personal-model-" + randomUUID() + "@example.test" };
      accounts.push(account); await persistReport();
      const response = await request(null, "/auth/sign-up/email", { name: "合成模型設定驗收 " + index,
        email: account.email, password: randomBytes(24).toString("hex") });
      requireThat(typeof response.data.user?.id === "string" && /^[A-Za-z0-9_-]{1,160}$/u.test(response.data.user.id), "synthetic_account_id_invalid");
      account.id = response.data.user.id;
      account.cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
      requireThat(Boolean(account.cookie), "auth_cookie_required"); await persistReport();
    }
  });
  const [owner, other] = accounts;
  const baseCommand = { expectedVersion: 0, mode: "personal", backgroundEnabled: true, dailyLimit: 100,
    maxModelCalls: 6, maxQueryEmbeddings: 3, consent: true };
  let version;
  await check("initial_settings_direct_write_and_secret_free_get", async () => {
    const initial = (await request(owner, "/ai/settings")).data.settings;
    requireThat(initial.version === 0 && initial.mode === "platform" && !initial.keyConfigured && !initial.backgroundEnabled
      && initial.maxModelCalls === 4 && initial.maxQueryEmbeddings === 2);
    const saved = (await request(owner, "/ai/settings", { ...baseCommand, apiKey: syntheticKey })).data;
    version = saved.version;
    requireThat(version === 1 && saved.mode === "personal" && saved.keyConfigured && saved.backgroundEnabled
      && saved.maxModelCalls === 6 && saved.maxQueryEmbeddings === 3);
    const read = (await request(owner, "/ai/settings")).data;
    requireThat(read.settings.version === version && read.settings.keyConfigured && read.settings.maxModelCalls === 6 && read.settings.maxQueryEmbeddings === 3);
    requireThat(!/(?:apiKey|api_key|ciphertext|keyHash|keyHint)/u.test(JSON.stringify(read)), "secret_field_in_settings_response");
  });
  await check("account_isolation_session_binding_and_version_conflict", async () => {
    const isolated = (await request(other, "/ai/settings")).data.settings;
    requireThat(isolated.version === 0 && isolated.mode === "platform" && !isolated.keyConfigured);
    await request(owner, "/ai/settings", { ...baseCommand, expectedVersion: version, mode: "disabled", consent: false }, 403, other.id);
    const stale = await request(owner, "/ai/settings", baseCommand, 409);
    requireThat(stale.data.error?.code === "version_conflict");
  });
  await check("personal_and_platform_quotas_separate_then_roll_back", async () => {
    const client = await pool.connect(); let failed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
      const adapter = transactionModule.transactionPool(client);
      const usage = { platform: countStore(usageModule.createAiUsageStore(adapter.pool)), personal: countStore(usageModule.createAiUsageStore(adapter.pool, "personal")) };
      const keys = ["global", "user:" + owner.id, "personal:global", "personal:user:" + owner.id];
      const counters = async () => new Map((await client.query("SELECT scope_key,attempts FROM ai_daily_usage WHERE day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date AND scope_key=ANY($1::text[])", [keys])).rows.map(row => [row.scope_key, row.attempts]));
      const initial = await counters();
      requireThat(!initial.has(keys[1]) && !initial.has(keys[3]), "new_account_counter_not_empty");
      requireThat(await usage.personal.reserve(owner.id, 1, (initial.get(keys[2]) ?? 0) + 1));
      requireThat(await usage.platform.reserve(owner.id, 2, (initial.get(keys[0]) ?? 0) + 2));
      requireThat(!await usage.personal.reserve(owner.id, 1, (initial.get(keys[2]) ?? 0) + 1));
      requireThat(await usage.platform.reserve(owner.id, 2, (initial.get(keys[0]) ?? 0) + 2));
      const current = await counters();
      requireThat(current.get(keys[0]) === (initial.get(keys[0]) ?? 0) + 2 && current.get(keys[1]) === 2
        && current.get(keys[2]) === (initial.get(keys[2]) ?? 0) + 1 && current.get(keys[3]) === 1);
      const platform = await usage.platform.getForUser(owner.id), personal = await usage.personal.getForUser(owner.id);
      requireThat(platform.attempts === 2 && platform.billingSource === "platform" && personal.attempts === 1 && personal.billingSource === "personal");
      adapter.assertReleased(); await client.query("ROLLBACK");
    } catch (error) {
      failed = true; try { await client.query("ROLLBACK"); } catch { /* Destroy the transaction connection. */ } throw error;
    } finally { client.release(failed); }
  });
  await check("changed_settings_revoke_snapshots_and_disable_worker", async () => {
    const interactive = await routing.resolve(owner.id, "interactive"), worker = await routing.resolve(owner.id, "worker");
    requireThat(interactive.config.enabled && worker.config.enabled && await interactive.authorize() && await worker.authorize());
    const disabled = (await request(owner, "/ai/settings", { ...baseCommand, expectedVersion: version, mode: "disabled", consent: false })).data;
    requireThat(disabled.version === version + 1 && disabled.mode === "disabled" && !disabled.backgroundEnabled); version = disabled.version;
    requireThat(!await interactive.authorize() && !await worker.authorize());
    const disabledWorker = await routing.resolve(owner.id, "worker");
    requireThat(!disabledWorker.config.enabled && !await disabledWorker.authorize());
  });
  await check("remove_key_has_no_fallback_and_reconnect_preserves_limits", async () => {
    const removed = (await request(owner, "/ai/settings", { ...baseCommand, expectedVersion: version, mode: "disabled", removeKey: true, consent: false })).data;
    requireThat(removed.version === version + 1 && !removed.keyConfigured && !removed.backgroundEnabled); version = removed.version;
    const resolved = await routing.settings.resolve(owner.id);
    requireThat(resolved.apiKey === null && resolved.settings.mode === "disabled");
    const disabled = await routing.resolve(owner.id, "interactive");
    requireThat(!disabled.config.enabled && !await disabled.authorize() && !await routing.available(owner.id));
    const reconnectedPool = databaseModule.createPool(config);
    try {
      const reconnected = countStore(settingsModule.createModelSettingsStore(reconnectedPool, cipher));
      const current = await reconnected.get(owner.id), secret = await reconnected.resolve(owner.id);
      requireThat(current.version === version && current.mode === "disabled" && !current.keyConfigured && !current.backgroundEnabled
        && current.maxModelCalls === 6 && current.maxQueryEmbeddings === 3 && secret.apiKey === null);
    } finally { await reconnectedPool.end(); }
  });
  await check("settings_bypass_online_receipts_and_preserve_original_rows", async () => {
    const ids = accounts.map(account => account.id);
    requireThat(Number((await pool.query("SELECT count(*)::text AS count FROM online_operations WHERE user_id=ANY($1::text[])", [ids])).rows[0].count) === 0, "settings_entered_online_receipts");
    requireThat(await snapshot(pool, ids) === before, "existing_data_changed"); existingDataPreserved = true;
  });
  await check("delete_only_synthetic_accounts_and_their_counter_rows", async () => {
    const client = await pool.connect(); let failed = false;
    try {
      await client.query("BEGIN");
      const ids = accounts.map(account => account.id), keys = ids.flatMap(id => ["user:" + id, "personal:user:" + id]);
      await client.query("DELETE FROM ai_daily_usage WHERE scope_key=ANY($1::text[])", [keys]);
      requireThat((await client.query('DELETE FROM "user" WHERE id=ANY($1::text[]) AND email=ANY($2::text[]) RETURNING id', [ids, accounts.map(account => account.email)])).rowCount === limits.accounts, "synthetic_account_cleanup_incomplete");
      requireThat(await snapshot(client) === before, "cleanup_changed_existing_data");
      await client.query("COMMIT"); syntheticCleanupCompleted = true;
    } catch (error) {
      failed = true; try { await client.query("ROLLBACK"); } catch { /* Retain synthetic accounts after a failed cleanup. */ } throw error;
    } finally { client.release(failed); }
  });
  result = "passed";
} catch (error) {
  result = "failed"; failureCode = error instanceof VerificationError ? error.code : "verification_unavailable"; process.exitCode = 1;
} finally {
  if (server) {
    try { await new Promise(accept => { server.close(accept); server.closeAllConnections(); }); }
    catch { result = "failed"; failureCode = "server_cleanup_failed"; process.exitCode = 1; }
  }
  try { await pool?.end(); } catch { result = "failed"; failureCode = "database_cleanup_failed"; process.exitCode = 1; }
  restoreFetch?.();
}
let reportSaved = false;
try { await persistReport(); reportSaved = Boolean(reportFile); await reportFile?.close(); }
catch { result = "failed"; failureCode = "report_write_failed"; process.exitCode = 1; }
const summary = { result, step, code: failureCode, checks: completedChecks.length, httpRequests: requests, storeCalls,
  accountsCreated: accounts.filter(account => account.id).length, existingDataPreserved, syntheticCleanupCompleted,
  reportSaved, modelCalls: 0, notificationCalls: 0, blockedExternalRequests, bodiesLogged: false, secretsLogged: false };
(result === "passed" ? console.log : console.error)(JSON.stringify(summary));
