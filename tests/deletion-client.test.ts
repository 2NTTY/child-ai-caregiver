import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, createRecordsApi, type RecordsApi } from "../src/client/records-api.ts";
import { RecordsController } from "../src/client/records-controller.ts";
import { ChatController } from "../src/client/chat-controller.ts";
import type { ChatApi } from "../src/client/chat-api.ts";
import type { Child } from "../src/shared/records.ts";
import type { RecordList } from "../src/shared/records.ts";
import type { ChatMessage } from "../src/shared/chat.ts";
import type { ChatPage } from "../src/shared/chat.ts";

const user = { id: "owner", name: "照顧者", email: "owner@example.test" };
const first: Child = { id: "669fc3c0-1734-42c9-b541-3b7f55f584e1", workspaceId: "space",
  displayName: "小晴", createdAt: "2026-09-23T00:00:00.000Z" };
const second: Child = { ...first, id: "7a640e02-926b-4b0a-a812-799776883e02", displayName: "小朗" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

function fixture() {
  const values = { children: [first, second], deletes: 0 };
  const recordApi: RecordsApi = {
    getSession: async () => user,
    authenticate: async () => {},
    signOut: async () => {},
    listChildren: async () => values.children,
    createChild: async () => first,
    deleteChild: async childId => { values.deletes += 1; values.children = values.children.filter(child => child.id !== childId); },
    listRecords: async () => ({ records: [], limit: 100 }),
    createRecord: async () => { throw new Error("Unexpected record write"); },
  };
  const chatApi: ChatApi = {
    getSession: async () => user,
    listMessages: async () => ({ messages: [], limit: 100 }),
    saveMessage: async () => { throw new Error("Unexpected chat write"); },
    requestReply: async () => { throw new Error("Unexpected AI request"); },
    getStatus: async () => true,
    getUsage: async () => ({ day: "2026-09-23", attempts: 0, inputTokens: 0,
      outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  };
  const chat = new ChatController(chatApi);
  const records = new RecordsController(recordApi, true, {
    begin: childId => chat.beginChildDeletion(childId),
    release: childId => chat.releaseChildDeletion(childId),
    forget: childId => chat.forgetChild(childId),
    reconcile: (childIds, pendingDeletionId) => chat.reconcileChildren(childIds, pendingDeletionId),
  });
  return { values, recordApi, chatApi, records, chat };
}

test("delete API sends the selected ID and expected account and requires a matching receipt", async () => {
  const sentRequests: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sentRequests.push(new Request(input, init));
    if (String(input).endsWith("/online/context")) return Response.json({ workspaceId: first.id, storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" });
    const body = JSON.parse(String(init?.body));
    return Response.json({ state: "confirmed", operation: body.operation, changeSeq: "1", statusCode: 200,
      result: { deleted: true, childId: first.id } });
  }) as typeof fetch;
  const api = createRecordsApi("http://localhost", fetcher);
  await api.deleteChild(first.id, new AbortController().signal, user.id);
  assert.equal(sentRequests[0].url, "http://localhost/api/online/context");
  assert.deepEqual(await sentRequests[0].json(), { path: `/api/children/${first.id}/delete`, payload: { confirmChildId: first.id } });
  const sent = sentRequests[1];
  assert.ok(sent);
  assert.equal(sent.url, "http://localhost/api/online/submit");
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers.get("x-expected-user-id"), user.id);
  const submission = await sent.json();
  assert.equal(submission.path, `/api/children/${first.id}/delete`);
  assert.deepEqual(submission.payload, { confirmChildId: first.id });

  const invalid = createRecordsApi("http://localhost", (async (input, init) => {
    if (String(input).endsWith("/online/context")) return Response.json({ workspaceId: first.id, storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" });
    const operation = JSON.parse(String(init?.body)).operation;
    return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 200,
      result: { deleted: true, childId: second.id } });
  }) as typeof fetch);
  await assert.rejects(invalid.deleteChild(first.id, new AbortController().signal, user.id), ClientApiError);
});

test("confirmed deletion clears only the selected child's records and chat drafts", async () => {
  const { records, chat, recordApi, chatApi, values } = fixture();
  await records.restoreSession();
  records.setRecordText("小晴記錄草稿");
  chat.syncContext(user.id, true, first.id);
  await settle();
  chat.setText("小晴聊天草稿");
  await records.selectChild(second.id);
  records.setRecordText("小朗記錄草稿");
  chat.syncContext(user.id, true, second.id);
  await settle();
  chat.setText("小朗聊天草稿");
  await records.selectChild(first.id);
  chat.syncContext(user.id, true, first.id);
  await settle();
  const lateRecords = deferred<RecordList>();
  const lateChat = deferred<ChatPage>();
  const listRecords = recordApi.listRecords;
  recordApi.listRecords = async (childId, signal) => childId === first.id
    ? lateRecords.promise : listRecords(childId, signal);
  chatApi.listMessages = async () => lateChat.promise;
  const recordRead = records.reloadRecords();
  const chatRead = chat.reloadMessages();
  await settle();

  await records.confirmDeleteChild();
  assert.equal(values.deletes, 0);
  records.reviewDeleteChild();
  assert.equal(records.getSnapshot().deletion?.phase, "confirm");
  await records.confirmDeleteChild();
  assert.equal(values.deletes, 1);
  assert.deepEqual(records.getSnapshot().children.map(child => child.id), [second.id]);
  assert.equal(records.getSnapshot().drafts[first.id], undefined);
  assert.equal(chat.getSnapshot().drafts[first.id], undefined);
  assert.equal(records.getSnapshot().drafts[second.id].text, "小朗記錄草稿");
  assert.equal(chat.getSnapshot().drafts[second.id].text, "小朗聊天草稿");
  lateRecords.resolve({ records: [{ id: "old-record", childId: first.id, authorUserId: user.id,
    text: "已刪記錄", createdAt: "2026-09-23T01:00:00.000Z" }], limit: 100 });
  lateChat.resolve({ messages: [{ id: "old-message", childId: first.id, authorUserId: user.id,
    role: "user", text: "已刪聊天", inReplyTo: null, createdAt: "2026-09-23T01:00:00.000Z" }], limit: 100 });
  await Promise.all([recordRead, chatRead]);
  chat.syncContext(user.id, true, first.id);
  assert.equal(chat.getSnapshot().selectedChildId, null);
  assert.deepEqual(chat.getSnapshot().messages, []);
  assert.deepEqual(records.getSnapshot().records, []);
});

test("unknown deletion needs a fresh child list and clears stale drafts if another tab removed the child", async () => {
  const { records, chat, recordApi, values } = fixture();
  await records.restoreSession();
  records.setRecordText("待刪孩子草稿");
  chat.syncContext(user.id, true, first.id);
  await settle();
  chat.setText("待刪孩子聊天");
  await records.selectChild(second.id);
  records.setRecordText("其他孩子草稿");
  await records.selectChild(first.id);
  recordApi.deleteChild = async () => { values.deletes += 1; throw new ClientApiError(); };

  records.reviewDeleteChild();
  await records.confirmDeleteChild();
  assert.equal(records.getSnapshot().deletion?.phase, "unknown");
  assert.equal(records.getSnapshot().children.length, 2);
  assert.notEqual(records.getSnapshot().notice?.includes("Server 已確認永久刪除"), true);
  records.reviewDeleteChild();
  await records.confirmDeleteChild();
  assert.equal(values.deletes, 1);
  values.children = [second];
  await records.reloadChildren();
  assert.equal(records.getSnapshot().deletion, null);
  assert.deepEqual(records.getSnapshot().children.map(child => child.id), [second.id]);
  assert.equal(records.getSnapshot().drafts[first.id], undefined);
  assert.equal(chat.getSnapshot().drafts[first.id], undefined);
  assert.equal(records.getSnapshot().drafts[second.id].text, "其他孩子草稿");
  assert.equal(values.deletes, 1);
});

test("an in-flight AI reply prevents opening child deletion", async () => {
  const { records, chat, chatApi, values } = fixture();
  await records.restoreSession();
  const message: ChatMessage = { id: "message-1", childId: first.id, authorUserId: user.id,
    role: "user", text: "合成聊天", inReplyTo: null, createdAt: "2026-09-23T01:00:00.000Z" };
  chatApi.listMessages = async () => ({ messages: [message], limit: 100 });
  chat.syncContext(user.id, true, first.id);
  await settle();
  const pending = deferred<ChatMessage>();
  chatApi.requestReply = async () => pending.promise;
  const reply = chat.requestReply(message.id);
  await settle();
  assert.equal(chat.getSnapshot().busy, "reply");
  records.reviewDeleteChild();
  assert.equal(records.getSnapshot().deletion, null);
  assert.equal(values.deletes, 0);
  pending.resolve({ ...message, id: "reply-1", role: "model", authorUserId: null, inReplyTo: message.id, text: "合成回覆" });
  await reply;
});


test("opening deletion synchronously blocks stale chat actions and cancellation preserves the draft", async () => {
  const { records, chat } = fixture();
  await records.restoreSession();
  chat.syncContext(user.id, true, first.id);
  await settle();
  chat.setText("未發送合成草稿");
  records.reviewDeleteChild();
  assert.equal(chat.getSnapshot().selectedChildId, null);
  await chat.send();
  assert.equal(chat.getSnapshot().drafts[first.id].text, "未發送合成草稿");
  records.cancelDeleteChild();
  chat.syncContext(user.id, true, first.id);
  await settle();
  assert.equal(chat.getSnapshot().selectedChildId, first.id);
  assert.equal(chat.getSnapshot().drafts[first.id].text, "未發送合成草稿");
});
