import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Pool } from "pg";
import { createChatStore } from "../server/chat.ts";
import type { StorageCipher } from "../server/storage-crypto.ts";

mock.module("../server/agent-account-directory.ts", {
  namedExports: { displayAccountMessage: async (message: unknown) => message },
});
const { handleChatRequest } = await import("../server/chat-api.ts");

const userId = "user-1";
const childId = "7c6386cd-f503-4e49-bc45-e2508290ac72";
const createdAt = new Date("2026-11-21T10:00:00Z");

function legacyStore() {
  let inserts = 0;
  let ledgerWrites = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) {
        return { rows: [{ owner_user_id: userId, access_version: 1 }] };
      }
      if (sql.startsWith("SELECT 1 FROM children")) return { rows: [{}], rowCount: 1 };
      if (sql.includes("FROM chat_messages m")) return { rows: [] };
      if (sql.includes("INSERT INTO chat_messages")) {
        inserts++;
        return { rows: [{
          id: params[0], child_id: childId, role: "user", author_user_id: userId,
          text: params[3], in_reply_to: null, created_at: createdAt,
        }] };
      }
      if (sql.startsWith("UPDATE workspaces SET change_seq")) return { rows: [{ change_seq: "1" }] };
      if (sql.startsWith("INSERT INTO online_changes")) ledgerWrites++;
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query() { return { rows: [{ workspace_id: "workspace-1" }] }; },
    async connect() { return client; },
  };
  const cipher = {
    encrypt: (text: string) => text,
    decrypt: (text: string) => text,
  };
  const store = createChatStore(pool as unknown as Pool, cipher as StorageCipher, true);
  const post = (payload: object) => handleChatRequest(new Request(
    `https://caregiver.example/api/children/${childId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Expected-User-Id": userId },
      body: JSON.stringify(payload),
    },
  ), userId, store);
  return { store, post, writes: () => ({ inserts, ledgerWrites }) };
}

test("legacy PostgreSQL rejects chat-only before inserting or publishing an online change", async () => {
  const fixture = legacyStore();
  const response = await fixture.post({ text: "Just chat", chatMode: "chat_only" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "chat_mode_unavailable");
  assert.deepEqual(fixture.writes(), { inserts: 0, ledgerWrites: 0 });
  await assert.rejects(fixture.store.createUserMessageForUser(userId, childId, "Direct send", "chat_only"),
    { name: "LegacyChatModeUnsupportedError" });
  assert.deepEqual(fixture.writes(), { inserts: 0, ledgerWrites: 0 });
});

test("ordinary legacy assistant sends still write and return the original response shape", async () => {
  const fixture = legacyStore();
  for (const mode of [undefined, "assistant"]) {
    const response = await fixture.post({ text: "Usual send", chatMode: mode });
    assert.equal(response.status, 201);
    const { message } = await response.json();
    assert.equal(message.text, "Usual send");
    assert.equal(message.chatMode, undefined);
  }
  assert.deepEqual(fixture.writes(), { inserts: 2, ledgerWrites: 2 });
});
