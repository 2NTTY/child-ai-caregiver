import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEncryptedBackup } from "../server/backup.ts";
import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createKnowledgeRefreshStore, observationHash, observationId } from "../server/knowledge-refresh-store.ts";
import { KNOWLEDGE_REFRESH_QUEUE, REFRESH_JOB_OPTIONS, refreshCron } from "../server/knowledge-refresh-types.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { fetchKnowledgeSource } from "../server/knowledge-source-fetch.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { createWorkerQueue } from "../server/worker-queue.ts";

// A fresh approval is single-use in this protected directory. There is no automatic retry/resume.
const limits = Object.freeze({ watches: 4, sources: 6, business: 120, polls: 180, workers: 1,
  sourceFetchCalls: 6, publicHttpRequestsMaximum: 18, cronMilliseconds: 100000, totalMilliseconds: 480000 });
const counts = { watches: 0, sources: 0, business: 0, polls: 0, workers: 0, sourceFetchCalls: 0, syntheticEmbeddingCallbacks: 0 };
const repository = resolve(fileURLToPath(new URL("../", import.meta.url)));
const prefix = `kr-${randomBytes(6).toString("hex")}`, operator = "knowledge-refresh-acceptance";
const started = Date.now(), controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.totalMilliseconds)]);
const passed = [], registered = new Set(), imported = new Set(), observed = new Set();
const scheduled = new Set(), pendingJobs = new Set(), publicSources = [], queueEvidence = {};
const vector = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);
let pool, guard, producer, child, directory, config, environment, baseline, backupName, backgroundFailure;
let step = "preflight", outcome, controlTouched = false, finishing = false, evidenceWritten = false, backupCreated = false;

function within(root, path) { const part = relative(root, path); return !part || part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part); }
function budget(key) {
  if (!finishing && (Date.now() - started > limits.totalMilliseconds || backgroundFailure)) throw new Error("knowledge_refresh_acceptance_stopped");
  // Reserve cleanup operations within the same 120-operation cap.
  const maximum = key === "business" && !finishing ? limits.business - 12 : limits[key];
  if (counts[key] >= maximum) throw new Error("knowledge_refresh_acceptance_scope_cap");
  counts[key]++;
}
function business(action) { budget("business"); return action(); }
function tracked(store) { return new Proxy(store, { get(target, name) {
  const value = target[name]; return typeof value === "function" ? (...args) => business(() => value.apply(target, args)) : value;
} }); }
async function check(name, action) { step = name; await action(); passed.push(name); }
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("knowledge_refresh_acceptance_timeout")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(read, accept, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  do {
    budget("polls"); const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) break;
    await delay(Math.min(1000, deadline - Date.now()), undefined, { signal });
  } while (Date.now() <= deadline);
  throw new Error("knowledge_refresh_acceptance_timeout");
}
function protectedAcl(path, kind) {
  if (process.platform !== "win32") return;
  const childEnv = { ...process.env, KNOWLEDGE_REFRESH_SECURE_PATH: path, KNOWLEDGE_REFRESH_SECURE_DIRECTORY: kind === "directory" ? "1" : "0" };
  for (const name of Object.keys(childEnv)) if (name.toLowerCase() === "psmodulepath") delete childEnv[name];
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:KNOWLEDGE_REFRESH_SECURE_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if($env:KNOWLEDGE_REFRESH_SECURE_DIRECTORY -eq '1' -and -not $acl.AreAccessRulesProtected){exit 1}; foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18')){exit 1}}"],
  { env: childEnv, stdio: "ignore", timeout: 10000, windowsHide: true });
}
async function protectedPath(requested, kind) {
  if (!requested || !isAbsolute(requested)) throw new Error("knowledge_refresh_acceptance_protected_path_required");
  const path = await realpath(requested), repo = await realpath(repository), info = await stat(path);
  if (within(repo, path) || (kind === "directory" ? !info.isDirectory() : !info.isFile())
    || process.platform !== "win32" && (info.mode & 0o077)) throw new Error("knowledge_refresh_acceptance_path_unprotected");
  protectedAcl(path, kind); return path;
}
async function foreignSessions() {
  const rows = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
    AND (backend_type='client backend' OR backend_type IS NULL) AND pid<>pg_backend_pid()
    AND application_name IS DISTINCT FROM $1`, [prefix]);
  assert.equal(rows.rowCount, 0);
}
async function snapshot(names) {
  const client = await pool.connect(), result = new Map();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); await client.query("SET LOCAL TIME ZONE 'UTC'");
    names ??= (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
      .map(row => row.tablename).filter(name => name !== "worker_control" && name !== "app_migrations");
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("knowledge_refresh_acceptance_table_invalid");
      const rows = (await client.query(`SELECT row_to_json(t)::text AS value FROM public."${name}" t`)).rows, hashes = new Map();
      for (const row of rows) { const hash = createHash("sha256").update(row.value).digest("hex"); hashes.set(hash, (hashes.get(hash) ?? 0) + 1); }
      result.set(name, hashes);
    }
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
function manifest(value) { return Object.fromEntries([...value].map(([table, hashes]) => [table, {
  rows: [...hashes.values()].reduce((sum, n) => sum + n, 0),
  sha256: createHash("sha256").update(JSON.stringify([...hashes].sort(([a], [b]) => a.localeCompare(b)))).digest("hex"),
}])); }
function preserve(before, after, additions = false) {
  for (const [table, hashes] of before) {
    assert.ok(after.has(table));
    for (const [hash, n] of hashes) assert.ok((after.get(table).get(hash) ?? 0) >= n);
    if (!additions || !table.startsWith("knowledge_")) assert.deepEqual(after.get(table), hashes);
  }
}
async function control(enabled, rotate = false) {
  controlTouched = true;
  await business(() => pool.query(`UPDATE worker_control SET enabled=$1${rotate ? ",generation=gen_random_uuid()" : ""} WHERE id=1`, [enabled]));
}
const observation = id => pool.query("SELECT * FROM knowledge_observations WHERE source_id=$1", [id]).then(result => result.rows[0]);
const watch = id => pool.query("SELECT * FROM knowledge_watches WHERE id=$1", [id]).then(result => result.rows[0]);
const checkRow = id => pool.query("SELECT * FROM knowledge_source_checks WHERE job_id=$1", [id]).then(result => result.rows[0]);
async function processCheck(store, data, result, fetcher) {
  if (result?.status === "ok") for (const item of result.items) {
    const sourceId = observationId(definitions.find(definition => definition.id === data.watchId), item);
    if (!observed.has(sourceId)) { budget("sources"); observed.add(sourceId); }
  }
  const id = randomUUID(), value = await store.process(data, id, fetcher ?? (async () => result), signal);
  return { id, value };
}
const iso = milliseconds => new Date(Date.now() - milliseconds).toISOString();
const definitions = [
  { id: `${prefix}-guidance`, url: `https://www.fhs.gov.hk/tc_chi/health_info/child/${prefix}-guidance.html`, kind: "page",
    classification: "official_guidance", publisher: "Synthetic official publisher", termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html", audience: "public_noncommercial", selector: "#content" },
  { id: `${prefix}-recent`, url: `https://www.chp.gov.hk/rss/${prefix}.xml`, kind: "rss", classification: "recent_information",
    publisher: "Synthetic internal publisher", termsUrl: "https://www.chp.gov.hk/tc/static/24027.html", audience: "internal_noncommercial", itemHosts: ["www.chp.gov.hk"] },
  { id: `${prefix}-guard`, url: `https://www.fhs.gov.hk/tc_chi/health_info/child/${prefix}-guard.html`, kind: "page",
    classification: "official_guidance", publisher: "Synthetic guard publisher", termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html", audience: "public_noncommercial", selector: "#content" },
];
const [guidance, recent, guarded] = definitions;
const guideItem = { url: guidance.url, title: `${prefix} guidance`, text: "Synthetic section one.\nSynthetic section two.",
  sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
const changedItem = { ...guideItem, text: "Synthetic section one changed.\nSynthetic section two." };
const guardItem = { url: guarded.url, title: `${prefix} guard`, text: "Synthetic queue and fencing observation.",
  sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
const recentItems = [
  { name: "fresh", published: iso(3600000) }, { name: "within-seven-days", published: iso(6.5 * 86400000) },
  { name: "outside-seven-days", published: iso(8 * 86400000) }, { name: "unknown-date", published: null },
].map(item => ({ url: `https://www.chp.gov.hk/tc/features/${prefix}-${item.name}.html`, title: `${prefix} ${item.name}`,
  text: `Synthetic recent fixture ${item.name}.`, sourcePublishedAt: item.published, sourceUpdatedAt: null,
  sourceDateText: item.published === null ? "September 2026 (month only)" : null }));
function sourceDocument(definition, item, text = item.text) {
  return { sourceId: observationId(definition, item), url: item.url, title: item.title, publisher: definition.publisher,
    classification: definition.classification, sourcePublishedAt: item.sourcePublishedAt, sourceUpdatedAt: item.sourceUpdatedAt,
    sourceDateText: item.sourceDateText, fetchedAt: iso(1000), termsUrl: definition.termsUrl,
    chunks: text.split("\n").map((part, index) => ({ key: `section-${index + 1}`, section: `Synthetic section ${index + 1}`,
      sourceExcerpt: part, text: part, keywords: [prefix], applicability: { region: "HK", ageBasis: "any",
        minAgeMonths: null, maxAgeMonths: null, topics: [prefix], conditions: ["Synthetic acceptance fixture only"] } })) };
}
const filter = classification => ({ region: "HK", classification, age: null, topics: [prefix] });
async function embedMissing(store, versionId) {
  const missing = await store.missingDocuments(versionId);
  for (const document of missing) await store.embedDocument(document, async () => { counts.syntheticEmbeddingCallbacks++; return vector; });
  return missing;
}
async function register(store, id) {
  if (!registered.has(id)) { budget("watches"); registered.add(id); }
  await store.register(id, operator);
}
async function startFixture(data) {
  budget("workers");
  const processChild = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/knowledge-refresh-worker.mjs", import.meta.url)), "--knowledge-refresh-fixture", "--approved-knowledge-refresh"],
    { cwd: repository, env: { ...environment, KNOWLEDGE_REFRESH_PREFIX: prefix, KNOWLEDGE_REFRESH_TARGET: data.watchId,
      KNOWLEDGE_REFRESH_DEFINITIONS: JSON.stringify(definitions) }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
  const entry = { process: processChild, events: [], expectedExit: false, exited: false };
  entry.send = message => {
    try { processChild.send(message, error => { if (error) backgroundFailure = new Error("knowledge_refresh_fixture_protocol_failed"); }); }
    catch { backgroundFailure = new Error("knowledge_refresh_fixture_protocol_failed"); }
  };
  entry.finished = new Promise(resolveFinished => {
    processChild.once("exit", (code, exitSignal) => {
      entry.exited = true; entry.exit = { code, signal: exitSignal };
      if (!entry.expectedExit || code !== 0 || exitSignal) backgroundFailure = new Error("knowledge_refresh_fixture_exit_failed");
      resolveFinished();
    });
    processChild.once("error", () => { entry.exited = true; backgroundFailure = new Error("knowledge_refresh_fixture_start_failed"); resolveFinished(); });
  });
  processChild.on("message", message => {
    if (!message || typeof message !== "object") { backgroundFailure = new Error("knowledge_refresh_fixture_protocol_failed"); return; }
    if (message.type === "call") {
      try {
        assert.equal(message.watchId, guarded.id); assert.match(message.requestId ?? "", /^[0-9a-f-]{36}$/i);
        budget("business"); entry.send({ type: "grant", requestId: message.requestId });
      } catch { backgroundFailure = new Error("knowledge_refresh_fixture_scope_failed"); entry.send({ type: "deny", requestId: message.requestId }); }
    } else if (message.type === "fetch") {
      if (message.watchId !== guarded.id) { backgroundFailure = new Error("knowledge_refresh_fixture_scope_failed"); return; }
      entry.send({ type: "fetched", requestId: message.requestId, result: { status: "ok", items: [guardItem] } });
    } else if (message.type === "ready" || message.type === "handled") entry.events.push(message);
    else backgroundFailure = new Error("knowledge_refresh_fixture_failed");
  });
  child = entry;
  await waitFor(() => entry.events, events => events.some(event => event.type === "ready"));
  return entry;
}
async function stopFixture() {
  if (!child || child.exited) return;
  child.expectedExit = true; child.send({ type: "stop" });
  try { await bounded(child.finished, 20000); assert.equal(child.exit?.code, 0); assert.equal(child.exit?.signal, null); }
  catch { child.process.kill("SIGKILL"); await bounded(child.finished, 10000).catch(() => {}); throw new Error("knowledge_refresh_fixture_stop_failed"); }
}
async function schedule(definition, data, cron = refreshCron(definition)) {
  scheduled.add(definition.id);
  await business(() => producer.boss.schedule(KNOWLEDGE_REFRESH_QUEUE, cron, data,
    { ...REFRESH_JOB_OPTIONS, tz: "Asia/Hong_Kong", key: definition.id, missed: "once", singletonKey: definition.id }));
}
async function unschedule(key) { await business(() => producer.boss.unschedule(KNOWLEDGE_REFRESH_QUEUE, key)); scheduled.delete(key); }

try {
  if (process.argv.length !== 3 || process.argv[2] !== "--approved-knowledge-refresh") throw new Error("knowledge_refresh_acceptance_approval_required");
  step = "preflight_local_target";
  const source = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || source.pathname !== "/yuban_s06_test" || source.search || source.hash || source.port === "5433"
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(process.env.PG_TOOL_CONTAINER ?? "")) throw new Error("knowledge_refresh_acceptance_local_target_required");
  directory = await protectedPath(process.env.KNOWLEDGE_REFRESH_ACCEPTANCE_DIR, "directory");
  await writeFile(join(directory, "knowledge-refresh-approval.claim"), JSON.stringify({ prefix, limits }) + "\n", { flag: "wx", mode: 0o600 });
  step = "preflight_keys";
  const storagePath = await protectedPath(process.env.STORAGE_KEY_FILE, "file"), backupPath = await protectedPath(process.env.BACKUP_KEY_FILE, "file");
  if (within(directory, storagePath) || within(directory, backupPath)) throw new Error("knowledge_refresh_acceptance_keys_must_be_separate");
  const storageKey = await readSecretKey(storagePath), backupKey = await readSecretKey(backupPath);
  assert.equal(timingSafeEqual(storageKey, backupKey), false);
  const cipher = createStorageCipher(storageKey), tagged = new URL(source); tagged.searchParams.set("application_name", prefix);
  // DATABASE_URL from the caller is never used as the target. No real model is enabled.
  environment = { ...process.env, TEST_DATABASE_URL: source.toString(), DATABASE_URL: tagged.toString(), NODE_ENV: "test", AI_ENABLED: "false",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099" };
  config = readServerConfig(environment); pool = createPool(config);
  step = "preflight_existing_state"; await foreignSessions();
  guard = await pool.connect(); assert.equal((await guard.query("SELECT pg_try_advisory_lock(173061,13) AS acquired")).rows[0].acquired, true);
  assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled, false);
  if ((await pool.query("SELECT to_regclass('public.knowledge_watches') AS present")).rows[0].present) {
    assert.equal((await pool.query("SELECT 1 FROM knowledge_watches WHERE enabled LIMIT 1")).rowCount, 0);
  }
  assert.equal((await pool.query("SELECT 1 FROM pgboss.job WHERE state NOT IN ('completed','cancelled','failed') LIMIT 1")).rowCount, 0);
  // Timekeeper does not consult worker_control. Reject pre-existing schedules before starting it.
  assert.equal((await pool.query("SELECT 1 FROM pgboss.schedule LIMIT 1")).rowCount, 0);
  baseline = await snapshot(); const priorManifest = manifest(baseline);
  assert.ok(["children", "text_records", "chat_messages"].some(table => priorManifest[table]?.rows > 0));
  for (const table of ["knowledge_sources", "knowledge_versions", "knowledge_chunks", "knowledge_vectors"]) assert.ok(priorManifest[table]?.rows > 0);
  const priorMigrations = (await pool.query("SELECT id,checksum FROM app_migrations ORDER BY id")).rows;
  await writeFile(join(directory, `${prefix}-before-hashes.json`), JSON.stringify(priorManifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await check("encrypted_prechange_backup", async () => {
    backupName = `${prefix}-before.ybak`;
    await createEncryptedBackup({ databaseUrl: source.toString(), container: process.env.PG_TOOL_CONTAINER }, join(directory, backupName), backupKey);
    backupCreated = true;
  });
  await check("migration_014_and_existing_private_and_public_rows", async () => {
    execFileSync(process.execPath, ["server/migrate.ts"], { cwd: repository, env: environment, stdio: "ignore", timeout: 60000, windowsHide: true });
    await verifyEncryptedStorage(pool, cipher); await foreignSessions();
    const sql = (await readFile(new URL("../server/migrations/014-knowledge-refresh.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(sql).digest("hex"), windowsHash = createHash("sha256").update(sql.replace(/\n/g, "\r\n")).digest("hex");
    const applied = (await pool.query("SELECT checksum FROM app_migrations WHERE id='014-knowledge-refresh'")).rows;
    assert.equal(applied.length, 1); assert.ok([hash, windowsHash].includes(applied[0].checksum));
    for (const row of priorMigrations) assert.deepEqual((await pool.query("SELECT id,checksum FROM app_migrations WHERE id=$1", [row.id])).rows[0], row);
    for (const name of ["knowledge_watches", "knowledge_observations", "knowledge_source_checks"]) {
      assert.equal((await pool.query("SELECT to_regclass($1) AS present", [`public.${name}`])).rows[0].present, name);
    }
    assert.equal((await pool.query("SELECT version FROM pgboss.version")).rows[0].version, 42);
    preserve(baseline, await snapshot([...baseline.keys()]));
    producer = createWorkerQueue(pool, "producer"); await producer.start();
    assert.equal((await producer.boss.getQueue(KNOWLEDGE_REFRESH_QUEUE)).policy, "exclusive");
    queueEvidence.migration014 = true; queueEvidence.originalTables = Object.keys(priorManifest).length;
  });
  const refresh = tracked(createKnowledgeRefreshStore(pool, definitions));
  const publicStore = tracked(createKnowledgeStore(pool)), internalStore = tracked(createKnowledgeStore(pool, { audience: "internal" }));
  await control(true, true);
  for (const definition of definitions) await register(refresh, definition.id);
  let jobs = await refresh.jobs();
  const data = definition => { const value = jobs.find(job => job.definition.id === definition.id); assert.ok(value); return value.data; };
  let firstEdition, secondEdition, firstDocuments;
  await check("first_observation_pending_exact_hash_and_version_review", async () => {
    const first = await processCheck(refresh, data(guidance), { status: "ok", items: [guideItem] }); assert.equal(first.value.status, "changed");
    const observedFirst = await refresh.inspect(guidance.id); assert.equal(observedFirst.approved_hash, null);
    const document = sourceDocument(guidance, guideItem); imported.add(document.sourceId);
    firstEdition = await publicStore.importSource(document); await publicStore.review(firstEdition.versionId, firstEdition.hash, operator);
    firstDocuments = await embedMissing(publicStore, firstEdition.versionId); assert.equal(firstDocuments.length, 2);
    await assert.rejects(publicStore.publish(firstEdition.versionId, firstEdition.hash));
    for (const args of [["0".repeat(64), firstEdition.versionId, firstEdition.hash],
      [observedFirst.content_hash, randomUUID(), firstEdition.hash], [observedFirst.content_hash, firstEdition.versionId, "0".repeat(64)]]) {
      await assert.rejects(refresh.approve(guidance.id, ...args, operator));
    }
    await refresh.approve(guidance.id, observedFirst.content_hash, firstEdition.versionId, firstEdition.hash, operator);
    await publicStore.publish(firstEdition.versionId, firstEdition.hash);
    assert.equal((await publicStore.candidates(filter("official_guidance"), vector)).length, 2);
  });
  await check("unchanged_hash_vector_reuse_and_same_job_unique_result", async () => {
    const beforeVector = counts.syntheticEmbeddingCallbacks, prior = await observation(guidance.id);
    const same = await processCheck(refresh, data(guidance), { status: "ok", items: [guideItem] }); assert.equal(same.value.status, "unchanged");
    const reused = await publicStore.importSource({ ...sourceDocument(guidance, guideItem), fetchedAt: iso(2000) });
    assert.equal(reused.unchanged, true); assert.equal(reused.versionId, firstEdition.versionId);
    assert.equal((await publicStore.missingDocuments(firstEdition.versionId)).length, 0);
    assert.deepEqual(await publicStore.embedDocument(firstDocuments[0], async () => { counts.syntheticEmbeddingCallbacks++; throw new Error("unexpected_embedding_callback"); }), { reused: true });
    assert.equal(counts.syntheticEmbeddingCallbacks, beforeVector);
    const after = await observation(guidance.id); assert.equal(after.content_hash, prior.content_hash); assert.equal(after.approved_version_id, firstEdition.versionId);
    let fetchedAgain = false;
    assert.equal((await refresh.process(data(guidance), same.id, async () => { fetchedAgain = true; throw new Error("unexpected_duplicate_fetch"); }, signal)).status, "already_recorded");
    assert.equal(fetchedAgain, false); assert.equal((await pool.query("SELECT 1 FROM knowledge_source_checks WHERE job_id=$1", [same.id])).rowCount, 1);
  });
  await check("one_changed_chunk_invalidates_old_citation_and_embeds_once", async () => {
    const value = await processCheck(refresh, data(guidance), { status: "ok", items: [changedItem] }); assert.equal(value.value.changed, 1);
    assert.equal((await publicStore.candidates(filter("official_guidance"), vector)).length, 0);
    await assert.rejects(refresh.approve(guidance.id, observationHash(guideItem), firstEdition.versionId, firstEdition.hash, operator));
    secondEdition = await publicStore.importSource(sourceDocument(guidance, changedItem)); await publicStore.review(secondEdition.versionId, secondEdition.hash, operator);
    const callbacks = counts.syntheticEmbeddingCallbacks, missing = await embedMissing(publicStore, secondEdition.versionId);
    assert.equal(missing.length, 1); assert.equal(counts.syntheticEmbeddingCallbacks - callbacks, 1);
    await refresh.approve(guidance.id, observationHash(changedItem), secondEdition.versionId, secondEdition.hash, operator);
    await publicStore.publish(secondEdition.versionId, secondEdition.hash);
    const visible = await publicStore.candidates(filter("official_guidance"), vector); assert.ok(visible.every(chunk => chunk.versionId === secondEdition.versionId)); assert.equal(visible.length, 2);
    const vectors = (await pool.query(`SELECT c.section_key,c.embedding_hash,e.embedding::text AS embedding FROM knowledge_chunks c
      JOIN knowledge_vectors e ON e.input_hash=c.embedding_hash WHERE c.version_id=ANY($1::uuid[]) ORDER BY c.version_id,c.section_key`, [[firstEdition.versionId, secondEdition.versionId]])).rows;
    assert.equal(vectors.length, 4); assert.equal(new Set(vectors.filter(row => row.section_key === "section-2").map(row => row.embedding_hash)).size, 1);
    queueEvidence.incrementalEmbedding = { mode: "synthetic_vector_fixture_no_vertex", unchangedCallbacks: 0, changedCallbacks: 1 };
  });
  await check("temporary_failure_keeps_last_success_and_404_410_require_new_approval", async () => {
    const before = await observation(guidance.id), beforeWatch = await watch(guidance.id);
    const failed = await processCheck(refresh, data(guidance), { status: "failed", reason: "network" }); assert.equal(failed.value.status, "failed");
    assert.equal((await checkRow(failed.id)).failure_code, "network");
    assert.deepEqual(await observation(guidance.id), before); assert.deepEqual((await watch(guidance.id)).last_successful_check_at, beforeWatch.last_successful_check_at);
    for (const httpStatus of [404, 410]) {
      const gone = await processCheck(refresh, data(guidance), { status: "unavailable", httpStatus }); assert.equal(gone.value.status, "unavailable");
      assert.equal((await checkRow(gone.id)).http_status, httpStatus);
      assert.equal((await publicStore.candidates(filter("official_guidance"), vector)).length, 0);
      const returned = await processCheck(refresh, data(guidance), { status: "ok", items: [changedItem] }); assert.equal(returned.value.status, "changed");
      assert.equal((await observation(guidance.id)).approved_hash, null);
      await assert.rejects(publicStore.publish(secondEdition.versionId, secondEdition.hash));
      await refresh.approve(guidance.id, observationHash(changedItem), secondEdition.versionId, secondEdition.hash, operator);
      await publicStore.publish(secondEdition.versionId, secondEdition.hash);
    }
  });
  await check("recent_unknown_seven_days_24h_and_internal_public_isolation", async () => {
    await processCheck(refresh, data(recent), { status: "ok", items: recentItems });
    for (const item of recentItems) {
      const document = sourceDocument(recent, item); imported.add(document.sourceId);
      const edition = await internalStore.importSource(document); await internalStore.review(edition.versionId, edition.hash, operator);
      assert.equal((await embedMissing(internalStore, edition.versionId)).length, 1);
      await refresh.approve(document.sourceId, observationHash(item), edition.versionId, edition.hash, operator);
      if (item === recentItems[0]) await assert.rejects(publicStore.publish(edition.versionId, edition.hash));
      await internalStore.publish(edition.versionId, edition.hash);
    }
    const freshId = observationId(recent, recentItems[0]), sevenId = observationId(recent, recentItems[1]);
    const internal = await internalStore.candidates(filter("recent_information"), vector);
    assert.deepEqual(new Set(internal.map(chunk => chunk.sourceId)), new Set([freshId, sevenId])); assert.ok(internal.every(chunk => chunk.usageScope === "internal_noncommercial"));
    assert.equal((await publicStore.candidates(filter("recent_information"), vector)).length, 0);
    assert.ok((await internalStore.candidates(filter("official_guidance"), vector)).every(chunk => chunk.sourceId === guidance.id));
    // Only this run's synthetic observation is aged. No fabricated clock affects production logic.
    await business(() => pool.query("UPDATE knowledge_observations SET last_successful_check_at=now()-interval '25 hours' WHERE source_id=$1 AND watch_id=$2", [freshId, recent.id]));
    assert.deepEqual((await internalStore.candidates(filter("recent_information"), vector)).map(chunk => chunk.sourceId), [sevenId]);
    await processCheck(refresh, data(recent), { status: "ok", items: recentItems });
  });
  await check("disabled_watch_inflight_configuration_pause_and_old_generation_fences", async () => {
    await processCheck(refresh, data(guarded), { status: "ok", items: [guardItem] }); const before = await observation(guarded.id);
    const stopped = await processCheck(refresh, data(guarded), null, async () => { await refresh.disable(guarded.id); return { status: "ok", items: [{ ...guardItem, text: "Must never replace the observation" }] }; });
    assert.equal(stopped.value.status, "superseded"); assert.deepEqual(await observation(guarded.id), before);
    await register(refresh, guarded.id); jobs = await refresh.jobs();
    const changedCatalog = tracked(createKnowledgeRefreshStore(pool, definitions.map(definition => definition.id === guarded.id ? { ...definition, publisher: "Synthetic changed configuration" } : definition)));
    const changed = await processCheck(refresh, data(guarded), null, async () => { await changedCatalog.register(guarded.id, operator); return { status: "ok", items: [{ ...guardItem, text: "Must never replace the observation" }] }; });
    assert.equal(changed.value.status, "superseded"); assert.deepEqual(await observation(guarded.id), before);
    await register(refresh, guarded.id); jobs = await refresh.jobs(); const previousData = data(guarded);
    const paused = await processCheck(refresh, previousData, null, async () => { await control(false, true); return { status: "ok", items: [{ ...guardItem, text: "Must never replace the observation" }] }; });
    assert.equal(paused.value.status, "superseded"); assert.deepEqual(await observation(guarded.id), before); assert.deepEqual(await refresh.jobs(), []);
    await control(true); jobs = await refresh.jobs();
    let staleFetch = false;
    assert.equal((await refresh.process(previousData, randomUUID(), async () => { staleFetch = true; throw new Error("unexpected_old_generation_fetch"); }, signal)).status, "inactive"); assert.equal(staleFetch, false);
    await refresh.disable(guidance.id); assert.equal((await publicStore.candidates(filter("official_guidance"), vector)).length, 0);
    await register(refresh, guidance.id); jobs = await refresh.jobs();
  });
  await check("native_schedules_and_queued_metadata_survive_producer_restart", async () => {
    for (const definition of [guidance, recent]) await schedule(definition, data(definition));
    const jobId = randomUUID(); pendingJobs.add(jobId);
    assert.equal(await business(() => producer.boss.send(KNOWLEDGE_REFRESH_QUEUE, data(guarded), { ...REFRESH_JOB_OPTIONS, id: jobId, singletonKey: guarded.id })), jobId);
    const before = await producer.boss.getJobById(KNOWLEDGE_REFRESH_QUEUE, jobId); assert.equal(before.state, "created");
    await producer.stop(); producer = createWorkerQueue(pool, "producer"); await producer.start();
    const after = await producer.boss.getJobById(KNOWLEDGE_REFRESH_QUEUE, jobId);
    for (const key of ["id", "state", "retryLimit", "retryCount", "retryDelay", "retryBackoff", "expireInSeconds", "heartbeatSeconds", "singletonKey", "createdOn", "startAfter", "keepUntil", "data"]) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(Object.keys(after.data).sort(), ["revision", "watchId", "workerGeneration"]); assert.deepEqual(after.data, data(guarded));
    for (const definition of [guidance, recent]) {
      const value = await producer.boss.getSchedule(KNOWLEDGE_REFRESH_QUEUE, definition.id);
      assert.equal(value.cron, refreshCron(definition)); assert.equal(value.timezone, "Asia/Hong_Kong"); assert.equal(value.options.missed, "once"); assert.deepEqual(value.data, data(definition));
      await unschedule(definition.id);
    }
    queueEvidence.restart = { mode: "producer_reconnect_then_separate_worker_process", jobId, referenceOnly: true, persistedMetadata: true };
    await startFixture(data(guarded));
    await waitFor(() => producer.boss.getJobById(KNOWLEDGE_REFRESH_QUEUE, jobId), row => row?.state === "completed");
    assert.equal((await pool.query("SELECT 1 FROM knowledge_source_checks WHERE job_id=$1", [jobId])).rowCount, 1);
    pendingJobs.delete(jobId);
  });
  await check("real_native_minute_cron_timekeeper_and_direct_handler", async () => {
    const scheduledAt = Date.now(); await schedule(guarded, data(guarded), "* * * * *");
    const due = await waitFor(() => pool.query(`SELECT j.id,j.state FROM pgboss.job j JOIN knowledge_source_checks c ON c.job_id=j.id
      WHERE j.name=$1 AND j.data->>'watchId'=$2 AND j.created_on >= $3 AND j.state='completed' ORDER BY j.created_on LIMIT 1`,
    [KNOWLEDGE_REFRESH_QUEUE, guarded.id, new Date(scheduledAt)]).then(result => result.rows[0]), row => Boolean(row),
    Math.max(1, limits.cronMilliseconds - (Date.now() - scheduledAt)));
    const elapsedMilliseconds = Date.now() - scheduledAt; assert.ok(elapsedMilliseconds <= limits.cronMilliseconds);
    await unschedule(guarded.id);
    assert.equal((await pool.query("SELECT 1 FROM knowledge_source_checks WHERE job_id=$1", [due.id])).rowCount, 1);
    queueEvidence.minuteCron = { jobId: due.id, elapsedMilliseconds, actualTimekeeper: true,
      weeklyIntervalActuallyWaited: false, handler: "synthetic_fetch_direct_store_process" };
    await stopFixture(); await control(false, true);
  });
  await check("six_real_public_source_fetches_without_content_persistence", async () => {
    assert.deepEqual(SOURCE_WATCHES.map(definition => definition.id).sort(), ["chp-recent", "fhs-child-vision", "fhs-preschool-development", "fhs-solid-food", "fhs-toddler-development", "rthk-recent"]);
    for (const definition of SOURCE_WATCHES) {
      budget("sourceFetchCalls");
      const result = await fetchKnowledgeSource(definition, signal);
      publicSources.push({ id: definition.id, kind: definition.kind, status: result.status,
        ...(result.status === "ok" ? { items: result.items.length, itemsWithPublicationDate: result.items.filter(item => item.sourcePublishedAt !== null).length }
          : result.status === "failed" ? { reason: result.reason } : { httpStatus: result.httpStatus }) });
      assert.equal(result.status, "ok"); assert.ok(result.items.length > 0);
    }
  });
  outcome = { status: "passed" };
} catch {
  outcome = { status: "failed", stoppedStep: step, failureCode: "knowledge_refresh_acceptance_failed" }; process.exitCode = 1;
} finally {
  finishing = true; controller.abort();
  const failCleanup = () => { outcome = { ...outcome, status: "failed", cleanupFailed: true }; process.exitCode = 1; };
  await stopFixture().catch(failCleanup);
  if (pool && controlTouched) {
    await control(false, true).catch(failCleanup);
    const refresh = tracked(createKnowledgeRefreshStore(pool, definitions)), store = tracked(createKnowledgeStore(pool, { audience: "internal" }));
    for (const id of registered) await refresh.disable(id).catch(failCleanup);
    for (const id of imported) await store.disable(id, "Synthetic knowledge refresh acceptance finished").catch(failCleanup);
    if (producer) {
      for (const key of [...scheduled]) await unschedule(key).catch(failCleanup);
      try {
        const rows = (await pool.query("SELECT id FROM pgboss.job WHERE name=$1 AND data->>'watchId'=ANY($2::text[]) AND state IN ('created','retry','active')", [KNOWLEDGE_REFRESH_QUEUE, [...registered]])).rows;
        if (rows.length) await business(() => producer.boss.cancel(KNOWLEDGE_REFRESH_QUEUE, rows.map(row => row.id)));
      } catch { failCleanup(); }
    }
    try {
      preserve(baseline, await snapshot([...baseline.keys()]), true);
      assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0].enabled, false);
      assert.equal((await pool.query("SELECT 1 FROM knowledge_watches WHERE id=ANY($1::text[]) AND enabled", [[...registered]])).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM knowledge_sources WHERE id=ANY($1::text[]) AND enabled", [[...imported]])).rowCount, 0);
      outcome = { ...outcome, existingRowsPreserved: true, globalWorkerPaused: true, syntheticSourcesDisabled: true };
    } catch { failCleanup(); }
  }
  await producer?.stop().catch(failCleanup);
  if (guard) { await guard.query("SELECT pg_advisory_unlock(173061,13)").catch(failCleanup); guard.release(); }
  await pool?.end().catch(failCleanup);
  if (backgroundFailure) { outcome = { ...outcome, status: "failed", fixtureFailed: true }; process.exitCode = 1; }
  outcome = { event: "knowledge_refresh_acceptance", ...outcome, step, checks: passed, counts, limits, prefix, backup: backupName ?? null, backupCreated,
    elapsedMilliseconds: Date.now() - started, queueEvidence, publicSources,
    publicHttpRequests: { exactlyMeasured: false, maximum: counts.sourceFetchCalls * 3, redirectsPerFetchMaximum: 2 },
    syntheticScope: { watchIds: [...registered], observationIds: [...observed], knowledgeSourceIds: [...imported], pendingJobIds: [...pendingJobs] },
    originalDatabaseRetained: true, realEmbeddingCalls: 0, modelCalls: 0, taskHandlerStarted: false, restoredDatabase: false, deployed: false,
    recovery: "Keep the source worker paused and all databases/backups. Inspect this run's synthetic references and failed step. Do not rerun or reset this approval claim. Obtain a focused follow-up approval; restore only to a separate empty stopped database if needed." };
  if (directory) {
    try { await writeFile(join(directory, `${prefix}-checks.json`), JSON.stringify(outcome, null, 2) + "\n", { flag: "wx", mode: 0o600 }); evidenceWritten = true; }
    catch { outcome.status = "failed"; outcome.evidenceWriteFailed = true; process.exitCode = 1; }
  }
  console.log(JSON.stringify({ ...outcome, evidenceWritten }));
}
