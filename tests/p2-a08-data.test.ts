import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Pool } from "pg";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { openErasureJournal } from "../server/erasure-journal.ts";
import { createAccountDataStore, createAccountExportStore } from "../server/account-data.ts";
import { handleAccountDataRequest } from "../server/account-data-api.ts";
import { createAccountApi } from "../src/client/account-api.ts";
const userId = "a08-synthetic-parent", workspaceId = "00000000-0000-4000-8000-000000000101";
const childId = "00000000-0000-4000-8000-000000000102";
const cipher = createStorageCipher(randomBytes(32));
const noPhotoFiles = { read: async () => { throw new Error("Unexpected photo read"); }, write: async () => {}, remove: async () => {} };
function fakePool() {
  let state = { exists: true, sequence: 1, shared: false, journal: null as any, receipts: new Map<string, any>(), applied: new Map<string, any>(), photosPending: false };
  let failDelete = false; const queries: { sql: string; values: any[] }[] = [];
  const children = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i + 102).padStart(12, "0")}`);
  const space = () => ({ id: workspaceId, owner_user_id: userId, access_version: 1, storage_epoch: "00000000-0000-4000-8000-000000000103", change_seq: String(state.sequence) });
  async function query(sql: string, values: any[] = []): Promise<any> {
    sql = sql.replace(/\s+/g, " ").trim(); queries.push({ sql, values }); let rows: any[] = [];
    if (sql.includes("FROM workspaces w LEFT JOIN family_members")) rows = state.exists && values[0] === userId ? [space()] : [];
    else if (sql.includes('SELECT id,name,email,"emailVerified"')) rows = state.exists && values[0] === userId ? [{ id: userId, name: "Synthetic parent", email: "synthetic@example.test", emailVerified: true, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") }] : [];
    else if (sql.startsWith("SELECT 1 FROM family_members WHERE workspace_id")) rows = state.shared ? [{}] : [];
    else if (sql.includes("SELECT id,workspace_id,profile_version FROM children")) rows = state.exists ? [{ id: childId, workspace_id: workspaceId, profile_version: 1 }] : [];
    else if (sql.startsWith("SELECT version FROM model_settings")) rows = [{ version: 1 }];
    else if (sql.includes("FROM model_settings WHERE user_id")) rows = [{ version: 1, mode: "personal", background_enabled: false, personal_daily_limit: 1, max_model_calls: 1, max_query_embeddings: 1, updated_at: new Date("2026-10-01"), key_configured: true, api_key_encrypted: "PRIVATE-KEY-MUST-NOT-RETURN" }];
    else if (sql.includes("SELECT * FROM account_erasure_journal") || sql.startsWith("SELECT journal_id,latest_sequence")) rows = state.journal ? [{ ...state.journal }] : [];
    else if (sql.startsWith("INSERT INTO account_erasure_journal")) state.journal = { journal_id: values[0], latest_sequence: "0", latest_digest: values[1] };
    else if (sql.startsWith("UPDATE account_erasure_journal")) {
      if (state.journal?.journal_id === values[0] && (Number(state.journal.latest_sequence) < values[1] || Number(state.journal.latest_sequence) === values[1] && state.journal.latest_digest === values[2])) {
        state.journal = { journal_id: values[0], latest_sequence: String(values[1]), latest_digest: values[2] }; rows = [{ id: 1 }];
      }
    } else if (sql.startsWith("SELECT * FROM account_erasure_receipts")) rows = state.receipts.has(values[0]) ? [state.receipts.get(values[0])] : [];
    else if (sql.startsWith("INSERT INTO account_erasure_receipts")) state.receipts.set(values[0], { operation_id: values[0], user_hash: values[1], token_hash: values[2], payload_encrypted: values[3], expires_at: values[4], state: "prepared" });
    else if (sql.startsWith("UPDATE account_erasure_receipts")) { const row = state.receipts.get(values[0]); if (row) row.state = "completed"; }
    else if (sql.startsWith("SELECT kind,target_hash,journal_id FROM account_erasure_applied")) rows = state.applied.has(values[0]) ? [state.applied.get(values[0])] : [];
    else if (sql.startsWith("INSERT INTO account_erasure_applied")) state.applied.set(values[0], { journal_id: values[1], kind: values[2], target_hash: values[3] });
    else if (sql.startsWith('DELETE FROM "user"')) { if (failDelete) { failDelete = false; throw new Error("Synthetic SQL failure after durable intent"); } state.exists = false; rows = [{}]; }
    else if (sql.includes("account_erasure_photos p JOIN photo_file_deletions")) rows = state.photosPending ? [{}] : [];
    else if (sql.startsWith("SELECT id FROM children WHERE workspace_id")) rows = children.filter(id => !values[1] || id > values[1]).slice(0, 11).map(id => ({ id }));
    else if (sql.startsWith("SELECT workspace_id FROM children")) rows = [{ workspace_id: workspaceId }];
    else if (sql.startsWith("SELECT owner_user_id, access_version")) rows = [{ owner_user_id: userId, access_version: 1 }];
    else if (sql.startsWith("SELECT 1 FROM children")) rows = children.includes(values[0]) ? [{}] : [];
    else if (sql.includes("child.display_name_encrypted AS display_name")) rows = [{ id: values[0], workspace_id: workspaceId, display_name: cipher.encrypt("Synthetic child", `children:${values[0]}:${userId}:display_name`), created_at: new Date("2026-10-01") }];
    else if (sql.startsWith("SELECT owner_user_id FROM workspaces")) rows = [{ owner_user_id: userId }];
    return { rows: structuredClone(rows), rowCount: rows.length };
  }
  const pool = { query, async connect() { let snapshot: typeof state | null = null; return { async query(sql: string, values?: any[]) {
    if (sql === "BEGIN") snapshot = structuredClone(state); if (sql === "ROLLBACK" && snapshot) state = snapshot;
    return query(sql, values);
  }, release() {} }; } } as unknown as Pool;
  return { pool, queries, state: () => state, stale: () => { state.sequence++; }, failDelete: () => { failDelete = true; }, children };
}

test("A08 export scope, safe columns, complete cursors and client identity cancellation", async () => {
  const fake = fakePool(), exporter = createAccountExportStore(fake.pool, cipher, { photoFiles: noPhotoFiles });
  const account = await exporter.page(userId, { section: "account" });
  assert.equal(account.complete, true); assert.equal(JSON.stringify(account).includes("PRIVATE-KEY-MUST-NOT-RETURN"), false);
  assert.equal(fake.queries.some(row => row.sql.includes("api_key_encrypted") && !row.sql.includes("IS NOT NULL")), false);
  const first = await exporter.page(userId, { section: "children", scopeVersion: account.scopeVersion });
  assert.equal(first.items.length, 10); assert.equal(first.complete, false); assert.ok(first.nextCursor);
  const last = await exporter.page(userId, { section: "children", scopeVersion: first.scopeVersion, cursor: first.nextCursor! });
  assert.equal(last.items.length, 1); assert.equal(last.complete, true);
  await assert.rejects(exporter.page("other-parent", { section: "children", scopeVersion: first.scopeVersion, cursor: first.nextCursor! }), /invalid_export_cursor/);
  await assert.rejects(exporter.page(userId, { section: "profile", childId: randomUUID(), scopeVersion: first.scopeVersion }), /export_scope_changed/);
  fake.stale(); await assert.rejects(exporter.page(userId, { section: "children", scopeVersion: first.scopeVersion, cursor: first.nextCursor! }), /export_scope_changed/);
  const abort = new AbortController(); let resolveFetch!: (response: Response) => void;
  const api = createAccountApi("http://localhost:3000", () => new Promise<Response>(resolve => { resolveFetch = resolve; }));
  api.setIdentity(userId); const pending = api.exportPage(userId, { section: "account" }, abort.signal);
  api.setIdentity("other-parent"); resolveFetch(Response.json(account)); await assert.rejects(pending, /Account request could not be confirmed/);
  const originalOperation = randomUUID(), token = randomBytes(32).toString("base64url"); let checkedState: "prepared" | "completed" = "prepared";
  const deletion = createAccountApi("http://localhost:3000", async (url, init) => {
    if (String(url).endsWith("/account/delete")) throw new TypeError("Synthetic lost response");
    if (String(url).endsWith("/deletion/prepare")) {
      assert.equal(JSON.parse(init!.body as string).operationId, originalOperation);
      return Response.json({ operationId: originalOperation, state: "prepared", attachmentsPending: false, receiptToken: token, summary: { childCount: 1 }, expiresAt: new Date(Date.now() + 600000).toISOString() });
    }
    return Response.json({ operationId: originalOperation, state: checkedState, attachmentsPending: false });
  });
  deletion.setIdentity(userId); const prepared = await deletion.prepareDeletion(userId, abort.signal, originalOperation);
  await assert.rejects(deletion.executeDeletion(userId, { password: "Synthetic-password", confirmation: "永久刪除我的帳戶" }, abort.signal));
  await assert.rejects(deletion.discardPreparedDeletion(userId, abort.signal));
  await assert.rejects(deletion.prepareDeletion(userId, abort.signal, randomUUID()));
  deletion.setIdentity("other-parent"); deletion.setIdentity(userId);
  assert.equal((await deletion.prepareDeletion(userId, abort.signal)).operationId, originalOperation);
  await assert.rejects(deletion.discardPreparedDeletion(userId, abort.signal));
  checkedState = "completed"; assert.equal((await deletion.deletionStatus(prepared, abort.signal)).state, "completed");
});

test("A08 authenticated journal, stable receipt, irreversible recovery and monotonic replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a08-erasure-unit-")), file = join(directory, "intents.enc"), asserted: string[] = [];
  const openOptions = { directory, repositoryPath: resolve("."), cipher, assertProtectedDirectory: async (path: string) => { asserted.push(path); } };
  try {
    await assert.rejects(openErasureJournal(openOptions));
    const journal = await openErasureJournal({ ...openOptions, initialize: true });
    assert.ok(asserted.includes(file));
    const fake = fakePool(), data = createAccountDataStore(fake.pool, cipher, journal);
    await data.replay({ initializeBinding: true }); const operationId = randomUUID();
    const prepared = await data.prepare(userId, operationId), repeated = await data.prepare(userId, operationId);
    assert.equal(prepared.receiptToken, repeated.receiptToken); assert.equal(prepared.receiptToken.length, 43);
    assert.equal(fake.state().receipts.get(operationId).payload_encrypted.includes(prepared.receiptToken), false);
    await assert.rejects(data.status(operationId, randomBytes(32).toString("base64url")), /erasure_receipt_invalid/);
    fake.state().shared = true; await assert.rejects(data.prepare(userId, randomUUID()), /shared_workspace_requires_resolution/); fake.state().shared = false;
    fake.stale(); await assert.rejects(data.execute(userId, { operationId, receiptToken: prepared.receiptToken, password: "Synthetic-password", confirmation: "永久刪除我的帳戶" }), /account_scope_changed/);
    assert.equal((await journal.inspect()).sequence, 0); fake.state().sequence = 1;
    fake.failDelete();
    await assert.rejects(data.execute(userId, { operationId, receiptToken: prepared.receiptToken, password: "Synthetic-password", confirmation: "永久刪除我的帳戶" }), /Synthetic SQL failure/);
    assert.equal((await journal.inspect()).sequence, 1); assert.equal(fake.state().exists, true);
    const completed = await data.status(operationId, prepared.receiptToken); assert.equal(completed.state, "completed"); assert.equal(fake.state().exists, false);
    assert.deepEqual(Object.keys(completed).sort(), ["attachmentsPending", "operationId", "state"]);
    assert.ok(fake.queries.some(row => row.sql === "DELETE FROM auth_mail_outbox WHERE user_id=$1"));
    const completedAgain = await data.status(operationId, prepared.receiptToken); assert.deepEqual(completedAgain, completed);
    await journal.append({ operationId: randomUUID(), kind: "child", id: childId, at: new Date().toISOString() });
    fake.state().journal = { journal_id: journal.id, latest_sequence: "2", latest_digest: (await journal.inspect()).digest };
    await data.replay(); assert.equal(fake.state().journal.latest_sequence, "2");
    const recordedHeads = fake.queries.filter(row => row.sql.startsWith("UPDATE account_erasure_journal"));
    assert.ok(recordedHeads.every(row => row.sql.includes("latest_sequence<$2")), "replay must never overwrite a newer database head");
    const original = await readFile(file, "utf8"); assert.equal(original.includes(userId), false);
    const tampered = original.split("\n"); tampered[1] = tampered[1].slice(0, -4) + "AAAA"; await writeFile(file, tampered.join("\n"));
    await assert.rejects(openErasureJournal(openOptions)); await writeFile(file, original);
    await writeFile(file, original.slice(0, -1)); await assert.rejects(openErasureJournal(openOptions), /incomplete/); await writeFile(file, original);
    await writeFile(file, original.split("\n")[0] + "\n");
    const truncated = await openErasureJournal(openOptions); await assert.rejects(createAccountDataStore(fake.pool, cipher, truncated).replay(), /latest head/); await writeFile(file, original);
    fake.state().journal.journal_id = randomUUID(); await assert.rejects(data.replay(), /identity/);
    const request = new Request("http://localhost:3000/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json", "x-expected-user-id": userId }, body: JSON.stringify({ operationId: randomUUID(), receiptToken: randomBytes(32).toString("base64url"), password: "Synthetic-password", confirmation: "永久刪除我的帳戶" }) });
    let passwords = 0; const response = await handleAccountDataRequest(request, userId, { data, exporter: createAccountExportStore(fake.pool, cipher, { photoFiles: noPhotoFiles }), verifyPassword: async () => { passwords++; return false; } });
    assert.equal(response.status, 403); assert.equal(passwords, 0);
    let executed = 0, verified = 0;
    const rateServices = { data: { ...data, status: async () => ({ operationId, state: "prepared" as const, attachmentsPending: false }), execute: async () => { executed++; return completed; } },
      exporter: createAccountExportStore(fake.pool, cipher, { photoFiles: noPhotoFiles }), verifyPassword: async () => { verified++; return false; } };
    for (let attempt = 0; attempt < 4; attempt++) {
      const request = new Request("http://localhost:3000/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json", "x-expected-user-id": "a08-password-rate" }, body: JSON.stringify({ operationId, receiptToken: prepared.receiptToken, password: "Synthetic-password", confirmation: "永久刪除我的帳戶" }) });
      assert.equal((await handleAccountDataRequest(request, "a08-password-rate", rateServices)).status, attempt < 3 ? 403 : 429);
    }
    assert.equal(verified, 3); assert.equal(executed, 0);
  } finally { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(basename(directory), /^a08-erasure-unit-/); await rm(directory, { recursive: true, force: true }); }
});
