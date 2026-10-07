import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { groundedRecordQuantity } from "../server/agent-record-quantity.ts";
import { agentDirectActionSchema } from "../src/shared/agent-actions.ts";
import { emptyCareDetails } from "../src/shared/care.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { Pool } from "pg";
import type { AgentDirectAction } from "../src/shared/agent-actions.ts";
import type { CareDetails, CareValues } from "../src/shared/care.ts";

const quantity = (rawValue: string, unit: string, precision: "exact" | "approximate" = "exact") => ({ rawValue, unit, precision });
test("automatic quantities require one exact supported source phrase without inventing counts or units", () => {
  for (const source of ["他把藍色繪本放回書架。", "2026年10月7日香港時間13:20，他把書放回書架。"])
    assert.deepEqual(groundedRecordQuantity(quantity("1", "次"), null, source, source), { quantity: null, status: "removed" });
  for (const [raw, unit, source] of [["2", "次", "換了2次尿片"], ["半", "杯", "喝了半杯"], ["一", "啖", "吃了一啖"],
    ["三十", "分鐘", "睡了三十分鐘"], ["1/2", "杯", "喝了1/2杯"], ["１２", "mL", "喝了１２ mL"]]) {
    const evidence = source.slice(source.indexOf(raw), source.indexOf(unit, source.indexOf(raw)) + unit.length);
    assert.deepEqual(groundedRecordQuantity(quantity(raw, unit), evidence, source, source),
      { quantity: quantity(raw, unit), status: "source_supported" });
  }
  for (const [raw, unit, evidence, source] of [["10", "月", "10月", "10月8日"], ["20", "ml", "20ml", "13:20ml"],
    ["1", "次", "1次", "11次"], ["120", "ml", "120ml", "喝100ml和20ml"], ["120", "毫升", "120ml", "喝120ml"]])
    assert.equal(groundedRecordQuantity(quantity(raw, unit), evidence, source, source).quantity, null);
});

test("approximation cannot be stripped from the original source or upgraded by a model", () => {
  for (const source of ["約120ml", "120ml左右", "大約 120ml", "about 120ml", "近120ml", "接近120ml"]) {
    const value = groundedRecordQuantity(quantity("120", "ml"), "120ml", "120ml", source);
    assert.equal(value.quantity?.precision, "approximate");
  }
  assert.deepEqual(groundedRecordQuantity(quantity("約120", "ml"), "約120ml", "約120ml", "約120ml").quantity,
    quantity("約120", "ml", "approximate"));
  for (const source of ["100至120ml", "100-120ml"]) assert.equal(groundedRecordQuantity(quantity("120", "ml"), "120ml", source, source).quantity, null);
  assert.equal(groundedRecordQuantity(quantity("2", "次", "approximate"), "2次", "2次", "2次").quantity?.precision, "approximate");
  assert.equal(groundedRecordQuantity(quantity("2", "次"), "2次", "2次", "其他原文").quantity, null);
  for (const raw of ["一兩", "兩三", "三四"]) {
    const source = `今日換了${raw}次尿片`;
    assert.equal(groundedRecordQuantity(quantity(raw, "次"), raw + "次", source, source).quantity?.precision, "approximate");
  }
  for (const source of ["100或120ml", "少於120ml", "至少120ml", "120ml以上", "120ml或100ml", "估計120ml"])
    assert.equal(groundedRecordQuantity(quantity("120", "ml"), "120ml", source, source).quantity, null, source);
  for (const [raw, unit, evidence, source] of [["2", "l", "2l", "重2lb"], ["2", "克", "2克", "重2克拉"],
    ["2", "ml", "2ml", "喝了2mls"], ["2", "次", "2次", "2次方"]])
    assert.equal(groundedRecordQuantity(quantity(raw, unit), evidence, source, source).quantity, null, source);
});

test("legacy action shape stays valid while absent evidence conservatively removes a generated quantity", () => {
  const action = { kind: "save_record", text: "原文", sourceQuote: "原文", expectedPolicyVersion: 1,
    details: { ...emptyCareDetails(), kind: "note", quantity: quantity("1", "次") } };
  assert.equal(agentDirectActionSchema.safeParse(action).success, true);
  assert.equal(agentDirectActionSchema.safeParse({ ...action, quantityEvidence: null }).success, true);
  assert.equal(agentDirectActionSchema.safeParse({ ...action, quantityEvidence: "1次", forged: true }).success, false);
});

test("the authorized store saves grounded quantity, persists its receipt and replays without another write", async context => {
  const userId = "synthetic-user", childId = randomUUID(), runId = randomUUID(), messageId = randomUUID(), workspaceId = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: "epoch:1" };
  const cipher = createStorageCipher(Buffer.alloc(32, 37));
  let original = "13:20，他把藍色繪本放回書架。", writes = 0;
  let savedDetails: CareDetails | undefined;
  let priorQuantity: CareDetails["quantity"] = quantity("1", "次");
  context.mock.module("../server/care.ts", { namedExports: { createCareStore: () => ({
    create: async (_u: string, _c: string, values: CareValues) => { writes++; savedDetails = values.details; return { id: randomUUID(), version: 1 }; },
    get: async () => ({ id: randomUUID(), version: 1, authorUserId: userId, details: { ...emptyCareDetails(), kind: "note", quantity: priorQuantity } }),
    revise: async (_u: string, _c: string, _id: string, values: CareValues) => { writes++; savedDetails = values.details; return { id: randomUUID(), version: 2 }; },
  }) } });
  const { createAgentActionsStore } = await import("../server/agent-actions-store.ts");
  const receipts: Record<string, unknown>[] = [], mappings = new Map<string, unknown>();
  const client = { release() {}, async query(sql: string, params: unknown[] = []) {
    const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (sql.startsWith("SELECT workspace_id")) return result([{ workspace_id: workspaceId }]);
    if (sql.startsWith("SELECT owner_user_id")) return result([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith("SELECT 1 FROM children")) return result([{}]);
    if (sql.startsWith("SELECT id,access_version")) return result([{ id: workspaceId, access_version: 1, storage_epoch: "epoch", change_seq: "1" }]);
    if (sql.includes("FROM agent_runs")) return result([{ id: runId, child_id: childId, owner_user_id: userId, source_message_id: messageId,
      trigger_kind: "interactive", state: "running", unexpired: true, authorization_version: "1", data_version: "epoch:1" }]);
    if (sql.includes("FROM agent_action_receipts")) return result(receipts);
    if (sql.includes("FROM agent_action_calls")) return result(mappings.has(String(params[1])) ? [{ receipt_id: mappings.get(String(params[1])) }] : []);
    if (sql.includes("FROM chat_messages")) return result([{ text_encrypted: cipher.encrypt(original, `chat_messages:${messageId}:${childId}:${userId}:user::text`) }]);
    if (sql.includes("FROM agent_operation_policies")) return result([{ version: 1, payload_encrypted: cipher.encrypt(JSON.stringify({
      value: { recordKinds: ["note"], allowRecordCorrections: true, version: 1 }, accessVersion: 1, storageEpoch: "epoch",
    }), `agent-policy:${childId}:${userId}:1`) }]);
    if (sql.startsWith("INSERT INTO agent_action_receipts")) receipts.push({ id: params[0], run_id: params[1], child_id: params[2], owner_user_id: params[3],
      source_message_id: params[4], request_encrypted: params[5], payload_encrypted: params[6] });
    if (sql.startsWith("INSERT INTO agent_action_calls")) mappings.set(String(params[1]), params[2]);
    return result([]);
  } };
  const store = createAgentActionsStore({ query: client.query, connect: async () => client } as unknown as Pool, cipher);
  const action: Extract<AgentDirectAction, { kind: "save_record" }> = { kind: "save_record", text: original, sourceQuote: original, expectedPolicyVersion: 1,
    details: { ...emptyCareDetails(), kind: "note", quantity: quantity("1", "次") } };
  const first = await store.execute(scope, runId, "save", action);
  assert.equal(savedDetails?.quantity, null); assert.equal(first?.quantityGrounding?.status, "removed");
  assert.deepEqual(await store.execute(scope, runId, "save", action), first);
  assert.deepEqual(await store.execute(scope, runId, "equivalent-call", action), first); assert.equal(writes, 1);
  original = "只改文字說明";
  const revision: Extract<AgentDirectAction, { kind: "revise_record" }> = { kind: "revise_record", text: original, sourceQuote: original, expectedPolicyVersion: 1,
    recordId: randomUUID(), expectedVersion: 1, reason: "更新文字", details: { ...emptyCareDetails(), kind: "note", quantity: priorQuantity } };
  const revised = await store.execute(scope, runId, "revise", revision);
  assert.deepEqual(savedDetails?.quantity, priorQuantity); assert.equal(revised?.quantityGrounding?.status, "unchanged");
  original = "改成約2次";
  const changed = await store.execute(scope, runId, "change-quantity", { ...revision, text: original, sourceQuote: original,
    quantityEvidence: "2次", details: { ...revision.details, quantity: quantity("2", "次") } });
  assert.deepEqual(savedDetails?.quantity, quantity("2", "次", "approximate"));
  assert.equal(changed?.quantityGrounding?.status, "source_supported"); assert.equal(writes, 3);
  assert.ok(!JSON.stringify(changed).includes(original), "Receipt must not retain the private source quote");
  savedDetails = undefined;
  const persisted = await store.receipts(userId, childId, runId);
  assert.ok(persisted!.every(receipt => Object.keys(receipt.quantityGrounding!).join() === "status"));
  assert.ok(!/rawValue|unit|quantityEvidence/u.test(JSON.stringify(persisted)),
    "Reading retained receipts cannot recover a measurement after its canonical record is removed");
});
