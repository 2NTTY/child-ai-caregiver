import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { FamilyError } from "../server/family-access.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { databaseAdapter } from "../server/worker-queue.ts";
import { checkedSubscription, providerResult } from "../server/web-push-gateway.ts";
import { createWebPushQueue } from "../server/web-push-queue.ts";
import { createWebPushStore, createWebPushWorker } from "../server/web-push-store.ts";
import { WEB_PUSH_QUEUE } from "../server/web-push-types.ts";

const limits = { users: 2, bindings: 3, deliveries: 8, business: 80, polls: 120, consumers: 1, scriptedSends: 3 };
const counts = { users: 0, bindings: 0, deliveries: 0, business: 0, polls: 0, consumers: 0, scriptedSends: 0, atomicEnqueues: 0 };
const results = [], users = [], bindings = new Map(), deliveryIds = new Set(), modes = new Map(), heldLocks = [];
const marker = "web_push_acceptance_" + randomBytes(6).toString("hex");
const allowedCodes = new Set(["approval_required", "local_target_required", "key_unavailable", "scope_cap", "foreign_sessions",
  "exclusive_lock_required", "migration_required", "schema_mismatch", "worker_must_be_paused", "foreign_push_work",
  "worker_control_changed", "queue_missing", "queue_error", "queue_warning", "consumer_failed", "poll_timeout",
  "scripted_enqueue_fault", "scripted_result_loss", "interrupted", "snapshot_scope_cap"]);
class AcceptanceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const failure = code => new AcceptanceError(code);
function count(key) { if (++counts[key] > limits[key]) throw failure("scope_cap"); }
function ready() { if (backgroundFailure) throw backgroundFailure; }
function business(action) { ready(); count("business"); return action(); }
async function check(code, action) {
  step = code; ready(); await action(); ready();
  results.push({ number: results.length + 1, assertion: code, passed: true });
}
function safeError(error) {
  return error instanceof assert.AssertionError ? "assertion_failed"
    : error instanceof AcceptanceError && allowedCodes.has(error.code) ? error.code : "database_or_runtime_failed";
}
async function denied(action, status, code) {
  await assert.rejects(() => business(action), error => error instanceof FamilyError && error.status === status && error.code === code);
}
async function waitFor(read, accept) {
  const deadline = Date.now() + 20000;
  do {
    ready(); count("polls"); const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) break;
    await delay(Math.min(500, deadline - Date.now()));
  } while (Date.now() <= deadline);
  throw failure("poll_timeout");
}
async function foreignSessions(databasePool = pool) {
  const value = await databasePool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
    AND (backend_type='client backend' OR backend_type IS NULL) AND pid<>pg_backend_pid()
    AND application_name IS DISTINCT FROM $1 LIMIT 1`, [marker]);
  if (value.rowCount) throw failure("foreign_sessions");
}
async function snapshot(databasePool) {
  const client = await databasePool.connect(), hashes = new Map();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const tables = (await client.query(`SELECT schemaname,tablename FROM pg_tables
      WHERE schemaname IN ('public','pgboss') ORDER BY schemaname,tablename`)).rows;
    if (tables.length > 100) throw failure("snapshot_scope_cap");
    let total = 0;
    for (const { schemaname, tablename } of tables) {
      assert.match(schemaname, /^(public|pgboss)$/); assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
      const rows = (await client.query(`SELECT row_to_json(t)::text AS value FROM "${schemaname}"."${tablename}" t LIMIT 20001`)).rows;
      total += rows.length; if (total > 20000) throw failure("snapshot_scope_cap");
      const tableHashes = new Map();
      for (const row of rows) {
        const hash = createHash("sha256").update(row.value).digest("hex");
        tableHashes.set(hash, (tableHashes.get(hash) ?? 0) + 1);
      }
      hashes.set(schemaname + "." + tablename, tableHashes);
    }
    await client.query("COMMIT"); return hashes;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
function makePool() {
  const value = new Pool({ connectionString: source.toString(), application_name: marker, max: 5,
    connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 5000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 10000 });
  value.on("error", () => { backgroundFailure ??= failure("queue_error"); });
  value.on("connect", client => client.on("error", () => { backgroundFailure ??= failure("queue_error"); }));
  return value;
}
async function setEnabled(next) {
  await foreignSessions();
  const result = await pool.query("UPDATE worker_control SET enabled=$1 WHERE id=1 AND enabled=$2 AND generation=$3 RETURNING id",
    [next, controlEnabled, originalControl.generation]);
  if (result.rowCount !== 1) throw failure("worker_control_changed");
  controlEnabled = next; controlTouched = true;
}
function registration(provider, index) {
  const key = createECDH("prime256v1"); key.generateKeys();
  return { label: "Synthetic push acceptance " + marker + " " + index, subscription: checkedSubscription({
    endpoint: provider === "fcm" ? "https://fcm.googleapis.com/fcm/send/" + marker + "-" + index
      : "https://updates.push.services.mozilla.com/wpush/v2/" + marker + "-" + index,
    keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    expirationTime: null }) };
}
async function newBinding(user, input) {
  if (counts.bindings >= limits.bindings) throw failure("scope_cap");
  const result = await business(() => store.register(user.id, input));
  if (!bindings.has(result.id)) { count("bindings"); bindings.set(result.id, { userId: user.id, input }); }
  return result;
}
async function ageSynthetic(user, ids, hours = false) {
  assert.ok(users.includes(user)); assert.ok(ids.length && ids.every(id => deliveryIds.has(id)));
  // Only this run's explicit delivery IDs; no waiting or changes to pre-existing quota rows.
  const changed = await pool.query(`UPDATE web_push_deliveries SET created_at=now()-${hours ? "interval '25 hours'" : "interval '2 minutes'"}
    WHERE user_id=$1 AND id=ANY($2::uuid[]) RETURNING id`, [user.id, ids]);
  assert.equal(changed.rowCount, ids.length);
}
async function row(id, databasePool = pool) {
  assert.ok(deliveryIds.has(id));
  return (await databasePool.query("SELECT * FROM web_push_deliveries WHERE id=$1", [id])).rows[0];
}
async function encryptedBinding(binding, databasePool = pool) {
  const fixture = bindings.get(binding.id); assert.ok(fixture);
  const saved = (await databasePool.query("SELECT * FROM web_push_subscriptions WHERE id=$1 AND user_id=$2", [binding.id, fixture.userId])).rows[0];
  assert.ok(saved); assert.match(saved.subscription_encrypted, /^yb1\./);
  const encoded = JSON.stringify(saved);
  for (const value of [fixture.input.label, fixture.input.subscription.endpoint, fixture.input.subscription.keys.auth,
    fixture.input.subscription.keys.p256dh]) assert.equal(encoded.includes(value), false);
  assert.deepEqual(JSON.parse(cipher.decrypt(saved.subscription_encrypted, "web-push:" + fixture.userId + ":" + binding.id)), fixture.input);
}
async function isolated(databaseStore, user) {
  const value = await business(() => databaseStore.status(user.id)); assert.equal(value.userId, user.id);
  for (const binding of value.bindings) assert.equal(bindings.get(binding.id)?.userId, user.id);
  for (const delivery of value.deliveries) assert.equal((await row(delivery.id)).user_id, user.id);
  const encoded = JSON.stringify(value);
  for (const fixture of bindings.values()) {
    assert.equal(encoded.includes(fixture.input.subscription.endpoint), false);
    assert.equal(encoded.includes(fixture.input.subscription.keys.auth), false);
    assert.equal(encoded.includes(fixture.input.subscription.keys.p256dh), false);
    if (fixture.userId !== user.id) assert.equal(encoded.includes(fixture.input.label), false);
  }
  return value;
}
async function stopConsumer() {
  if (consumerActive) {
    await pushQueue?.stop(); await boss.offWork(WEB_PUSH_QUEUE, { wait: true }); consumerActive = false;
  }
}
const interrupted = () => { backgroundFailure ??= failure("interrupted"); };
process.on("SIGINT", interrupted); process.on("SIGTERM", interrupted);
let source, pool, freshPool, boss, pushQueue, guard, prior, cipher, store, worker, originalControl, publicKey, services, gateway;
let controlEnabled, controlTouched = false, consumerActive = false, backgroundFailure;
let enqueueFault = false, resultLoss = false, step = "preflight", outcome;
let owner, other, acceptedBinding, unknownBinding, expiryBinding, accepted, paused, staleGeneration, revoked, expired, lost;

try {
  await check("01_approved_local_paused_preflight", async () => {
    if (process.argv.length !== 3 || process.argv[2] !== "--approved-web-push-local") throw failure("approval_required");
    try { source = new URL(process.env.TEST_DATABASE_URL); } catch { throw failure("local_target_required"); }
    if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
      || source.port !== "5434" || source.pathname !== "/yuban_s06_test" || source.search || source.hash) throw failure("local_target_required");
    // Use a numeric loopback even when the approved URL says localhost.
    if (source.hostname === "localhost") source.hostname = "127.0.0.1";
    try { const key = await readSecretKey(process.env.STORAGE_KEY_FILE); cipher = createStorageCipher(key); key.fill(0); }
    catch { throw failure("key_unavailable"); }
    pool = makePool(); await foreignSessions();
    await verifyEncryptedStorage(pool, cipher);
    guard = await pool.connect();
    for (const key of [1, 13]) {
      if (!(await guard.query("SELECT pg_try_advisory_lock(173061,$1) AS acquired", [key])).rows[0].acquired) throw failure("exclusive_lock_required");
      heldLocks.push(key);
    }
    const migration = (await pool.query("SELECT checksum FROM app_migrations WHERE id='015-web-push'")).rows[0];
    if (!migration) throw failure("migration_required");
    const sql = (await readFile(new URL("../server/migrations/015-web-push.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    assert.ok([sql, sql.replace(/\n/g, "\r\n")].some(value => createHash("sha256").update(value).digest("hex") === migration.checksum));
    if ((await pool.query("SELECT version FROM pgboss.version")).rows[0]?.version !== 42) throw failure("schema_mismatch");
    originalControl = (await pool.query("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    if (!originalControl || originalControl.enabled !== false) throw failure("worker_must_be_paused");
    controlEnabled = false;
    if ((await pool.query("SELECT 1 FROM web_push_deliveries WHERE status IN ('queued','sending') LIMIT 1")).rowCount
      || (await pool.query("SELECT 1 FROM pgboss.job WHERE name=$1 AND state NOT IN ('completed','cancelled','failed') LIMIT 1", [WEB_PUSH_QUEUE])).rowCount) throw failure("foreign_push_work");
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user'")).rows.map(value => value.column_name);
    for (const name of ["id", "name", "email", "emailVerified", "createdAt", "updatedAt"]) assert.ok(columns.includes(name));
    prior = await snapshot(pool);
    boss = new PgBoss({ db: databaseAdapter(pool), schema: "pgboss", migrate: false, supervise: false, schedule: false,
      persistWarnings: false, persistQueueStats: false });
    boss.on("error", () => { backgroundFailure ??= failure("queue_error"); });
    boss.on("warning", () => { backgroundFailure ??= failure("queue_warning"); });
    await boss.start();
    if (!await boss.getQueue(WEB_PUSH_QUEUE)) throw failure("queue_missing");
    pushQueue = createWebPushQueue(pool, boss);
    const guardedQueue = { async enqueue(client, id) {
      count("business"); count("deliveries");
      const delivery = (await client.query("SELECT user_id,subscription_id FROM web_push_deliveries WHERE id=$1", [id])).rows[0];
      assert.ok(delivery && users.some(user => user.id === delivery.user_id) && bindings.has(delivery.subscription_id));
      assert.equal((await client.query("SELECT 1 FROM pgboss.job WHERE id=$1", [id])).rowCount, 0);
      assert.equal(deliveryIds.has(id), false); deliveryIds.add(id);
      await pushQueue.queue.enqueue(client, id);
      assert.deepEqual((await client.query("SELECT data FROM pgboss.job WHERE name=$1 AND id=$2", [WEB_PUSH_QUEUE, id])).rows[0]?.data, { deliveryId: id });
      assert.equal((await pool.query("SELECT 1 FROM web_push_deliveries WHERE id=$1", [id])).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM pgboss.job WHERE name=$1 AND id=$2", [WEB_PUSH_QUEUE, id])).rowCount, 0);
      counts.atomicEnqueues++;
      if (enqueueFault) { enqueueFault = false; throw failure("scripted_enqueue_fault"); }
    } };
    const vapid = createECDH("prime256v1"); vapid.generateKeys();
    publicKey = vapid.getPublicKey().toString("base64url");
    services = { publicKey, queue: guardedQueue }; store = createWebPushStore(pool, cipher, services, false);
    gateway = { publicKey, async send(subscription, payload, signal, stillAuthorized) {
      assert.ok(deliveryIds.has(payload.deliveryId)); const fixture = bindings.get(payload.bindingId); assert.ok(fixture);
      assert.deepEqual(subscription, fixture.input.subscription); assert.equal(signal.aborted, false);
      assert.equal(await stillAuthorized(), true); count("scriptedSends");
      const mode = modes.get(payload.deliveryId); assert.ok(["accepted", "expired", "result_loss"].includes(mode));
      if (mode === "result_loss") resultLoss = true;
      return providerResult(mode === "expired" ? 410 : 201);
    } };
    worker = createWebPushWorker(pool, cipher, gateway);
  });
  await check("02_registration_idempotence_encryption_and_owner_isolation", async () => {
    for (let index = 0; index < 2; index++) {
      count("users"); const user = { id: marker + "_" + index, email: marker + "_" + index + "@example.test" };
      await pool.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
        [user.id, "Synthetic Web Push acceptance", user.email]); users.push(user);
    }
    [owner, other] = users;
    acceptedBinding = await newBinding(owner, registration("fcm", 1));
    unknownBinding = await newBinding(owner, registration("mozilla", 2));
    expiryBinding = await newBinding(other, registration("mozilla", 3));
    assert.deepEqual(await business(() => store.register(owner.id, bindings.get(acceptedBinding.id).input)), acceptedBinding);
    await denied(() => store.register(other.id, bindings.get(acceptedBinding.id).input), 409, "subscription_unavailable");
    await denied(() => store.revoke(other.id, acceptedBinding.id, acceptedBinding.version), 404, "not_found");
    for (const binding of [acceptedBinding, unknownBinding, expiryBinding]) await encryptedBinding(binding);
    assert.equal((await isolated(store, owner)).bindings.length, 2); assert.equal((await isolated(store, other)).bindings.length, 1);
  });
  await check("03_paused_version_ownership_and_real_enqueue_rollback", async () => {
    await denied(() => store.test(owner.id, acceptedBinding.id, 1), 409, "worker_paused");
    await setEnabled(true);
    await denied(() => store.test(other.id, acceptedBinding.id, 1), 404, "not_found");
    await denied(() => store.test(owner.id, acceptedBinding.id, 2), 409, "version_conflict");
    await denied(() => store.revoke(owner.id, acceptedBinding.id, 2), 409, "version_conflict");
    enqueueFault = true;
    await assert.rejects(() => business(() => store.test(owner.id, acceptedBinding.id, 1)),
      error => error instanceof AcceptanceError && error.code === "scripted_enqueue_fault");
    const ids = [...deliveryIds]; assert.equal(ids.length, 1);
    assert.equal((await pool.query("SELECT 1 FROM web_push_deliveries WHERE id=ANY($1::uuid[])", [ids])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM pgboss.job WHERE id=ANY($1::uuid[])", [ids])).rowCount, 0);
    assert.equal((await isolated(store, owner)).testsRemaining, 3);
  });
  await check("04_one_framework_consumer_201_and_no_duplicate_send", async () => {
    accepted = await business(() => store.test(owner.id, acceptedBinding.id, 1)); modes.set(accepted.id, "accepted");
    assert.equal((await row(accepted.id)).status, "queued");
    count("consumers"); consumerActive = true;
    await pushQueue.work({
      async process(id, signal) {
        try { assert.ok(deliveryIds.has(id)); return await business(() => worker.process(id, signal)); }
        catch (error) { backgroundFailure ??= failure("consumer_failed"); throw error; }
      },
      async unavailable(id) { assert.ok(deliveryIds.has(id)); return business(() => worker.unavailable(id)); },
    });
    const value = await waitFor(() => pool.query(`SELECT d.status,d.provider_status,j.state FROM web_push_deliveries d
      JOIN pgboss.job j ON j.id=d.id AND j.name=$1 WHERE d.id=$2`, [WEB_PUSH_QUEUE, accepted.id]).then(value => value.rows[0]),
      value => value?.status === "accepted" && value?.state === "completed");
    assert.equal(value.provider_status, 201); await stopConsumer();
    const sends = counts.scriptedSends;
    await business(() => worker.process(accepted.id)); await business(() => worker.process(accepted.id));
    assert.equal(counts.scriptedSends, sends); assert.equal(sends, 1);
  });
  await check("05_minute_daily_quota_and_paused_generation_fences", async () => {
    await denied(() => store.test(owner.id, unknownBinding.id, 1), 409, "test_limit");
    await ageSynthetic(owner, [accepted.id]);
    paused = await business(() => store.test(owner.id, unknownBinding.id, 1));
    await setEnabled(false); await business(() => worker.process(paused.id));
    assert.equal((await row(paused.id)).status, "stopped"); assert.equal((await row(paused.id)).reason, "worker_paused");
    await setEnabled(true); await ageSynthetic(owner, [accepted.id, paused.id]);
    staleGeneration = await business(() => store.test(owner.id, unknownBinding.id, 1));
    const changed = await pool.query("UPDATE web_push_deliveries SET worker_generation=$1 WHERE id=$2 AND user_id=$3 RETURNING id",
      [randomUUID(), staleGeneration.id, owner.id]); assert.equal(changed.rowCount, 1);
    await business(() => worker.process(staleGeneration.id));
    assert.equal((await row(staleGeneration.id)).status, "stopped"); assert.equal((await row(staleGeneration.id)).reason, "worker_paused");
    await ageSynthetic(owner, [accepted.id, paused.id, staleGeneration.id]);
    assert.equal((await isolated(store, owner)).testsRemaining, 0);
    await denied(() => store.test(owner.id, unknownBinding.id, 1), 409, "test_limit");
    assert.equal(counts.scriptedSends, 1);
  });
  await check("06_queued_revocation_410_invalidation_and_isolation", async () => {
    await ageSynthetic(owner, [accepted.id], true);
    revoked = await business(() => store.test(owner.id, acceptedBinding.id, 1));
    const binding = await business(() => store.revoke(owner.id, acceptedBinding.id, 1));
    assert.equal(binding.status, "revoked"); assert.equal(binding.version, 2);
    await business(() => worker.process(revoked.id));
    assert.equal((await row(revoked.id)).status, "stopped"); assert.equal((await row(revoked.id)).reason, "revoked");
    expired = await business(() => store.test(other.id, expiryBinding.id, 1)); modes.set(expired.id, "expired");
    await business(() => worker.process(expired.id));
    assert.equal((await row(expired.id)).status, "rejected"); assert.equal((await row(expired.id)).provider_status, 410);
    const saved = (await pool.query("SELECT status,version,endpoint_hash,subscription_encrypted FROM web_push_subscriptions WHERE id=$1", [expiryBinding.id])).rows[0];
    assert.deepEqual(saved, { status: "expired", version: 2, endpoint_hash: null, subscription_encrypted: null });
    await denied(() => store.test(other.id, expiryBinding.id, 1), 409, "version_conflict");
    await denied(() => store.test(other.id, expiryBinding.id, 2), 409, "subscription_unavailable");
    assert.equal((await isolated(store, owner)).deliveries.some(value => value.id === expired.id), false);
    assert.equal((await isolated(store, other)).deliveries.length, 1); assert.equal(counts.scriptedSends, 2);
  });
  await check("07_result_loss_sending_reentry_becomes_unknown_without_resend", async () => {
    await ageSynthetic(owner, [paused.id], true); await ageSynthetic(owner, [staleGeneration.id, revoked.id]);
    lost = await business(() => store.test(owner.id, unknownBinding.id, 1)); modes.set(lost.id, "result_loss");
    const faultPool = { query: pool.query.bind(pool), async connect() {
      if (resultLoss) { resultLoss = false; throw failure("scripted_result_loss"); }
      return pool.connect();
    } };
    const faultWorker = createWebPushWorker(faultPool, cipher, gateway);
    await assert.rejects(() => business(() => faultWorker.process(lost.id)),
      error => error instanceof AcceptanceError && error.code === "scripted_result_loss");
    assert.equal((await row(lost.id)).status, "sending"); assert.equal(counts.scriptedSends, 3);
    await business(() => worker.process(lost.id)); await business(() => worker.process(lost.id));
    const saved = await row(lost.id);
    assert.equal(saved.status, "unknown"); assert.equal(saved.reason, "worker_interrupted"); assert.equal(saved.provider_status, null);
    assert.equal(counts.scriptedSends, 3);
  });
  await check("08_fresh_pool_store_persistence", async () => {
    const before = [await isolated(store, owner), await isolated(store, other)];
    freshPool = makePool(); await foreignSessions(freshPool);
    const freshStore = createWebPushStore(freshPool, cipher, services, false);
    assert.deepEqual([await isolated(freshStore, owner), await isolated(freshStore, other)], before);
    await encryptedBinding(unknownBinding, freshPool);
    assert.equal((await row(lost.id, freshPool)).status, "unknown");
  });
  outcome = { status: "passed" };
} catch (error) {
  outcome = { status: "failed", failedAssertion: step, failureCode: safeError(error) }; process.exitCode = 1;
} finally {
  const cleanup = { ownConsumerStopped: false, controlRestored: !controlTouched, syntheticUsersRemoved: false,
    syntheticPushRowsCascaded: false, ownJobsRemoved: false, priorRowsPreserved: false, ownPoolsClosed: false };
  const cleanupFailures = [];
  const cleanupFailed = code => { cleanupFailures.push(code); process.exitCode = 1; outcome = { ...outcome, status: "failed" }; };
  let workerStopped = true;
  for (const action of [() => stopConsumer(), () => pushQueue?.stop(), () => boss?.stop({ graceful: true, timeout: 15000 })]) {
    try { await action(); } catch { workerStopped = false; cleanupFailed("own_worker_stop_failed"); }
  }
  cleanup.ownConsumerStopped = workerStopped;
  if (pool && controlTouched) {
    try {
      const changed = await pool.query("UPDATE worker_control SET enabled=$1 WHERE id=1 AND generation=$2 AND enabled=$3 RETURNING id",
        [originalControl.enabled, originalControl.generation, controlEnabled]);
      if (changed.rowCount !== 1) throw failure("worker_control_changed"); cleanup.controlRestored = true;
    } catch { cleanupFailed("control_restore_generation_failed"); }
  }
  if (pool && prior) {
    const client = await pool.connect().catch(() => null);
    if (client) {
      try {
        await client.query("BEGIN");
        for (const value of (await client.query("SELECT id,data FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[])", [WEB_PUSH_QUEUE, [...deliveryIds]])).rows) {
          assert.ok(deliveryIds.has(value.id)); assert.deepEqual(value.data, { deliveryId: value.id });
        }
        await client.query("DELETE FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[])", [WEB_PUSH_QUEUE, [...deliveryIds]]);
        const removed = await client.query('DELETE FROM "user" WHERE id=ANY($1::text[]) AND email=ANY($2::text[]) RETURNING id',
          [users.map(user => user.id), users.map(user => user.email)]); assert.equal(removed.rowCount, users.length);
        for (const table of ["web_push_subscriptions", "web_push_deliveries"]) {
          assert.equal((await client.query(`SELECT 1 FROM ${table} WHERE user_id=ANY($1::text[])`, [users.map(user => user.id)])).rowCount, 0);
        }
        assert.equal((await client.query("SELECT 1 FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[])", [WEB_PUSH_QUEUE, [...deliveryIds]])).rowCount, 0);
        await client.query("COMMIT");
        cleanup.syntheticUsersRemoved = true; cleanup.syntheticPushRowsCascaded = true; cleanup.ownJobsRemoved = true;
        await foreignSessions(); assert.deepEqual(await snapshot(pool), prior); cleanup.priorRowsPreserved = true;
        results.push({ number: results.length + 1, assertion: "09_parent_cascade_and_exact_prior_rows_preserved", passed: true });
      } catch { await client.query("ROLLBACK").catch(() => {}); cleanupFailed("synthetic_cleanup_or_preservation_failed"); }
      finally { client.release(); }
    } else cleanupFailed("synthetic_cleanup_connection_failed");
  }
  if (guard) {
    let discard = false;
    try { for (const key of heldLocks.reverse()) await guard.query("SELECT pg_advisory_unlock(173061,$1)", [key]); }
    catch { discard = true; cleanupFailed("own_lock_release_failed"); }
    finally { guard.release(discard); }
  }
  let poolsClosed = true;
  for (const databasePool of [freshPool, pool]) {
    try { await databasePool?.end(); } catch { poolsClosed = false; cleanupFailed("own_pool_close_failed"); }
  }
  cleanup.ownPoolsClosed = poolsClosed;
  process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
  if (backgroundFailure && outcome.status === "passed") {
    outcome = { status: "failed", failedAssertion: step, failureCode: safeError(backgroundFailure) }; process.exitCode = 1;
  }
  console.log(JSON.stringify({ ...outcome, results, assertionGroups: results.length, counts, limits, cleanup,
    ...(cleanupFailures.length ? { cleanupFailureCodes: cleanupFailures } : {}),
    databaseRetained: true, migrationsRun: 0, backupsRun: 0, externalHttp: 0, externalDns: 0, models: 0, taskWorkers: 0,
    realPush: false, browser: false, hardKill: false, fullServerRestart: false }));
}