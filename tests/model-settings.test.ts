import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { ModelSettingsCommand } from "../src/shared/model-settings.ts";
import { createModelSettingsStore, parseModelSettingsCommand } from "../server/model-settings.ts";
import { ModelSettingsError } from "../server/model-settings-contract.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

const key = "synthetic-key-without-provider-prefix";
const cipher = createStorageCipher(Buffer.alloc(32, 41));
const command = (changes: Partial<ModelSettingsCommand> = {}): ModelSettingsCommand => ({
  expectedVersion: 0, mode: "personal", apiKey: key, backgroundEnabled: true, dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, consent: true, ...changes,
});
type Row = { user_id: string; version: number; mode: string; background_enabled: boolean; personal_daily_limit: number; max_model_calls: number; max_query_embeddings: number;
  api_key_encrypted: string | null; updated_at: Date };
function fixture() {
  const rows = new Map<string, Row>();
  const locks = new Map<string, Promise<void>>();
  const calls: { sql: string; values: unknown[] }[] = [];
  const releases: boolean[] = [];
  const select = (sql: string, userId: string, pending?: Row) => {
    const row = pending ?? rows.get(userId);
    if (!row) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT version FROM")) return { rows: [{ version: row.version }], rowCount: 1 };
    if (sql.includes(" AS key_configured")) {
      const { api_key_encrypted, ...safe } = row;
      return { rows: [{ ...safe, key_configured: api_key_encrypted !== null }], rowCount: 1 };
    }
    return { rows: [{ ...row }], rowCount: 1 };
  };
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    assert.match(sql, /^SELECT .* FROM model_settings WHERE user_id=\$1$/);
    return select(sql, values[0] as string);
  };
  const pool = { query, async connect() {
    let unlock: (() => void) | undefined;
    let pending: Row | undefined;
    return { release(failed = false) { releases.push(failed); unlock?.(); unlock = undefined; },
      async query(sql: string, values: unknown[] = []) {
        calls.push({ sql, values });
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (sql === "COMMIT" && pending) rows.set(pending.user_id, pending);
          pending = undefined;
          unlock?.(); unlock = undefined;
          return { rows: [] };
        }
        if (sql.startsWith('SELECT id FROM "user"')) {
          assert.ok(sql.endsWith("FOR UPDATE"));
          const userId = values[0] as string;
          const previous = locks.get(userId) ?? Promise.resolve();
          const held = new Promise<void>(resolve => { unlock = resolve; });
          locks.set(userId, previous.then(() => held));
          await previous;
          return { rows: [{ id: userId }], rowCount: 1 };
        }
        if (sql.startsWith("SELECT")) {
          assert.ok(sql.endsWith("FOR UPDATE"));
          return select(sql, values[0] as string, pending);
        }
        const [userId, version, mode, background, limit, encrypted, modelCalls, queryEmbeddings] = values;
        assert.ok(sql.startsWith("INSERT INTO model_settings") || sql.startsWith("UPDATE model_settings"));
        if (sql.startsWith("UPDATE")) {
          assert.ok(sql.includes("AND version=$9"));
          assert.equal(rows.get(userId as string)?.version, values[8]);
        } else assert.equal(rows.has(userId as string), false);
        pending = { user_id: userId as string, version: version as number, mode: mode as string, background_enabled: background as boolean,
          personal_daily_limit: limit as number, max_model_calls: modelCalls as number, max_query_embeddings: queryEmbeddings as number, api_key_encrypted: encrypted as string | null, updated_at: new Date("2026-09-30T04:00:00Z") };
        return select(sql, userId as string, pending);
      },
    };
  } } as unknown as Pool;
  return { store: createModelSettingsStore(pool, cipher), pool, rows, calls, releases };
}

test("model settings commands require own allowlisted fields and bounded printable keys", () => {
  assert.equal(parseModelSettingsCommand(command()).apiKey, key);
  assert.equal(parseModelSettingsCommand(command({ apiKey: "a".repeat(20), dailyLimit: 1 })).dailyLimit, 1);
  assert.equal(parseModelSettingsCommand(command({ apiKey: "z".repeat(512), dailyLimit: 1000 })).dailyLimit, 1000);
  for (const invalid of [
    null, [], { ...command(), userId: "forged" }, { ...command(), endpoint: "https://elsewhere" },
    Object.create(command()), { ...command(), [Symbol("secret")]: "value" },
    command({ apiKey: "" }), command({ apiKey: "a".repeat(513) }), command({ apiKey: key + " " }),
    command({ apiKey: "\n" + key }), command({ apiKey: key + "\n" }), command({ apiKey: key + "\r" }), command({ apiKey: "synthetic-non-ascii-香港" }),
    command({ expectedVersion: -1 }), command({ expectedVersion: 0.5 }), command({ expectedVersion: 2147483647 }),
    command({ dailyLimit: 0 }), command({ dailyLimit: 1001 }), command({ dailyLimit: 1.5 }), command({ maxModelCalls: 0 }), command({ maxModelCalls: 13 }), command({ maxQueryEmbeddings: 0 }), command({ maxQueryEmbeddings: 7 }),
    { ...command(), apiKey: undefined }, { ...command(), removeKey: undefined },
    command({ removeKey: true }), command({ mode: "disabled", removeKey: true }),
    { ...command(), backgroundEnabled: "true" }, { ...command(), consent: undefined },
  ]) assert.throws(() => parseModelSettingsCommand(invalid), { code: "invalid_input" });
  const inherited = Object.assign(Object.create({ consent: true }), command());
  delete inherited.consent;
  assert.throws(() => parseModelSettingsCommand(inherited), { code: "invalid_input" });
  assert.throws(() => parseModelSettingsCommand(command({ consent: false })), { code: "consent_required" });
  const { apiKey: omitted, ...remove } = command({ mode: "disabled", removeKey: true });
  assert.equal(parseModelSettingsCommand(remove).backgroundEnabled, false);
  assert.equal(parseModelSettingsCommand(command({ mode: "platform" })).backgroundEnabled, false);
});

test("account settings stay encrypted, compare versions and explicitly remove retained keys", async () => {
  const f = fixture();
  const initial = await f.store.get("owner");
  assert.equal(initial.version, 0); assert.equal(initial.mode, "platform"); assert.equal(initial.keyConfigured, false);
  assert.equal(initial.dailyLimit, 100); assert.equal(initial.updatedAt, null); assert.equal(initial.maxModelCalls, 4); assert.equal(initial.maxQueryEmbeddings, 2);
  assert.equal(await f.store.isCurrent("owner", 0), true);
  const saved = await f.store.save("owner", command());
  assert.equal(saved.version, 1); assert.equal(saved.backgroundEnabled, true); assert.equal(saved.keyConfigured, true);
  assert.doesNotMatch(JSON.stringify(saved), /synthetic-key|yb1\.|apiKey|api_key/);
  const firstEnvelope = f.rows.get("owner")!.api_key_encrypted!;
  assert.ok(firstEnvelope.startsWith("yb1.")); assert.ok(!firstEnvelope.includes(key));
  assert.deepEqual(await f.store.resolve("owner"), { settings: saved, apiKey: key });
  assert.equal((await f.store.get("another")).keyConfigured, false);
  assert.equal((await f.store.resolve("another")).apiKey, null);
  assert.equal(await f.store.isCurrent("owner", 0), false);
  await assert.rejects(f.store.save("owner", command()), { code: "version_conflict", status: 409 });
  assert.equal(f.rows.get("owner")!.api_key_encrypted, firstEnvelope);
  const { apiKey: omitted, ...retained } = command({ expectedVersion: 1, mode: "platform", maxModelCalls: 6, maxQueryEmbeddings: 3 });
  const switched = await f.store.save("owner", retained);
  assert.equal(switched.version, 2); assert.equal(switched.backgroundEnabled, false); assert.equal(switched.keyConfigured, true); assert.equal(switched.maxModelCalls, 6); assert.equal(switched.maxQueryEmbeddings, 3);
  assert.notEqual(f.rows.get("owner")!.api_key_encrypted, firstEnvelope);
  assert.equal((await f.store.resolve("owner")).apiKey, key);
  const removed = await f.store.save("owner", { ...retained, expectedVersion: 2, mode: "disabled", removeKey: true });
  assert.equal(removed.version, 3); assert.equal(removed.keyConfigured, false); assert.equal(removed.backgroundEnabled, false);
  assert.equal(f.rows.get("owner")!.api_key_encrypted, null);
  assert.equal((await f.store.resolve("owner")).apiKey, null);
  await assert.rejects(f.store.save("owner", { ...retained, expectedVersion: 3, mode: "personal" }), { code: "key_required" });
  assert.equal(f.rows.get("owner")!.version, 3);
  assert.ok(f.calls.every(call => !call.values.includes(key)));
});

test("concurrent initial settings writes serialize at the account and reject one stale version", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.store.save("owner", command()), f.store.save("owner", command({ dailyLimit: 50 }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(failed.reason.code, "version_conflict"); assert.equal(failed.reason.status, 409);
  assert.equal(f.rows.get("owner")!.version, 1);
  assert.equal(f.calls.filter(call => call.sql.startsWith("INSERT INTO model_settings")).length, 1);
  assert.ok(f.releases.every(failed => !failed));
});

test("key ciphertext binds account and version while metadata reads never decrypt", async () => {
  const f = fixture();
  await f.store.save("owner", command());
  const original = { ...f.rows.get("owner")! };
  f.rows.set("another", { ...original, user_id: "another" });
  await assert.rejects(f.store.resolve("another"), { code: "unavailable", status: 503, message: "unavailable" });
  f.rows.set("owner", { ...original, version: 2 });
  await assert.rejects(f.store.resolve("owner"), { code: "unavailable", status: 503 });
  const { apiKey: omitted, ...retained } = command({ expectedVersion: 2 });
  await assert.rejects(f.store.save("owner", retained), { code: "unavailable", status: 503 });
  assert.equal(f.rows.get("owner")!.version, 2);
  assert.equal(f.releases.at(-1), true);
  const noDecrypt = createModelSettingsStore(f.pool, { ...cipher, decrypt() { throw new Error("Must not decrypt metadata"); } });
  assert.equal((await noDecrypt.get("owner")).version, 2);
  assert.equal(await noDecrypt.isCurrent("owner", 2), true);
  const failure = async () => { throw new Error("raw-database-error-with-synthetic-secret"); };
  const unavailableStore = createModelSettingsStore({ query: failure, connect: failure } as unknown as Pool, cipher);
  for (const operation of [() => unavailableStore.get("owner"), () => unavailableStore.resolve("owner"),
    () => unavailableStore.isCurrent("owner", 0), () => unavailableStore.save("owner", command())]) {
    await assert.rejects(operation(), error => error instanceof ModelSettingsError && error.message === "unavailable" && error.status === 503);
  }
});
