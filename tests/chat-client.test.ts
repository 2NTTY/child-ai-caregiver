import assert from "node:assert/strict";
import test from "node:test";
import { ChatApiError, type ChatApi } from "../src/client/chat-api.ts";
import { ChatController } from "../src/client/chat-controller.ts";
import type { ChatMessage, ChatPage } from "../src/shared/chat.ts";

const alice = { id: "alice", name: "測試甲", email: "alice@example.test" };
const bob = { id: "bob", name: "測試乙", email: "bob@example.test" };
const firstChild = "669fc3c0-1734-42c9-b541-3b7f55f584e1";
const secondChild = "7a640e02-926b-4b0a-a812-799776883e02";
const original = "合成資料：今晚飲奶約 120 ml，想了解一般注意事項。";

function userMessage(childId = firstChild, text = original, id = "message-1", authorUserId = alice.id): ChatMessage {
  return { id, childId, authorUserId, role: "user", text, inReplyTo: null, createdAt: "2026-09-23T01:00:00.000Z" };
}

function modelMessage(childId = firstChild, inReplyTo = "message-1"): ChatMessage {
  return { id: "reply-1", childId, authorUserId: null, role: "model", text: "合成回覆", inReplyTo, createdAt: "2026-09-23T01:01:00.000Z" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

test("online receipt recovery uses the original message identity and does not infer from equal text", async () => {
  const { values, api, controller } = fixture();
  let pending = false;
  api.hasPendingOnline = () => pending;
  api.saveMessage = async () => { values.saves++; pending = true; throw new ChatApiError(); };
  api.reconcilePending = async () => {
    pending = false;
    return { state: "confirmed", path: `/api/children/${firstChild}/messages`, statusCode: 201, changeSeq: "1", result: { message: userMessage(firstChild, original, "actual-message") },
      operation: { opId: firstChild, deviceId: firstChild, workspaceId: firstChild, storageEpoch: firstChild } };
  };
  controller.syncContext(alice.id, true, firstChild); await settle(); controller.setText(original); await controller.send();
  values.messages = [userMessage(firstChild, original, "unrelated-identical-text")];
  await controller.reloadMessages();
  const draft = controller.getSnapshot().drafts[firstChild];
  assert.equal(draft.savedUserMessageId, "actual-message"); assert.equal(draft.phase, "reply_failed");
  assert.equal(draft.candidateMessageId, null); assert.equal(values.saves, 1); assert.equal(values.replies, 0); controller.dispose();
});

test("revoked child access clears saved chat and unsent page draft", async () => {
  const { values, api, controller } = fixture();
  values.messages = [userMessage()];
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText("unsent private text");
  api.listMessages = async () => { throw new ChatApiError(404, "not_found"); };
  await controller.reloadMessages();
  assert.deepEqual(controller.getSnapshot().messages, []);
  assert.equal(controller.getSnapshot().drafts[firstChild], undefined);
  assert.equal(controller.getSnapshot().selectedChildId, null);
  controller.dispose();
});

test("a fresh authorized child list restores regranted access without restoring old drafts", async () => {
  const { values, controller } = fixture();
  values.messages = [userMessage()];
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText("discard this old draft");
  controller.forgetChild(firstChild);
  controller.syncContext(alice.id, true, firstChild);
  assert.equal(controller.getSnapshot().selectedChildId, null);
  controller.reconcileChildren([firstChild], null);
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  assert.equal(controller.getSnapshot().selectedChildId, firstChild);
  assert.equal(controller.getSnapshot().messages[0].text, original);
  assert.equal(controller.getSnapshot().drafts[firstChild], undefined);
  controller.dispose();
});

function fixture() {
  const values = { user: alice as typeof alice | null, messages: [] as ChatMessage[], saves: 0, replies: 0 };
  const api: ChatApi = {
    getSession: async () => values.user,
    listMessages: async childId => ({ messages: values.messages.filter(item => item.childId === childId), limit: 100 }),
    saveMessage: async (childId, text) => {
      values.saves += 1;
      const saved = userMessage(childId, text);
      values.messages.push(saved);
      return saved;
    },
    requestReply: async (childId, messageId) => {
      values.replies += 1;
      const reply = modelMessage(childId, messageId);
      values.messages.push(reply);
      return reply;
    },
    getStatus: async () => true,
    getUsage: async () => ({ day: "2026-09-23", attempts: values.replies,
      inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  };
  return { values, api, controller: new ChatController(api) };
}

test("a confirmed user message survives AI failure and retry does not save it again", async () => {
  const { values, api, controller } = fixture();
  api.requestReply = async () => { values.replies += 1; throw new ChatApiError(503, "ai_unavailable"); };
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText(original);
  await controller.send();
  assert.equal(values.saves, 1);
  assert.equal(values.replies, 1);
  assert.equal(controller.getSnapshot().messages[0].text, original);
  assert.equal(controller.getSnapshot().drafts[firstChild].text, original);
  assert.equal(controller.getSnapshot().drafts[firstChild].savedUserMessageId, "message-1");
  assert.equal(controller.getSnapshot().drafts[firstChild].phase, "reply_failed");
  api.requestReply = async (childId, messageId) => { values.replies += 1; return modelMessage(childId, messageId); };
  await controller.requestReply("message-1");
  assert.equal(values.saves, 1);
  assert.equal(values.replies, 2);
  assert.equal(controller.getSnapshot().messages[1].role, "model");
  assert.equal(controller.getSnapshot().drafts[firstChild].text, "");
});

test("an unknown save never resends automatically and a reload can identify the saved message", async () => {
  const { values, api, controller } = fixture();
  api.saveMessage = async (childId, text) => {
    values.saves += 1;
    values.messages.push(userMessage(childId, text));
    throw new ChatApiError();
  };
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText(original);
  await controller.send();
  assert.equal(controller.getSnapshot().drafts[firstChild].phase, "save_unknown");
  assert.deepEqual(controller.getSnapshot().messages, []);
  await controller.send();
  assert.equal(values.saves, 1);
  await controller.reloadMessages();
  assert.equal(controller.getSnapshot().drafts[firstChild].phase, "checked");
  assert.equal(controller.getSnapshot().drafts[firstChild].savedUserMessageId, null);
  controller.confirmFoundMessage();
  assert.equal(controller.getSnapshot().drafts[firstChild].savedUserMessageId, "message-1");
  await controller.requestReply("message-1");
  assert.equal(values.saves, 1);
  assert.equal(values.replies, 1);
});

test("child and account switches isolate drafts and ignore late history", async () => {
  const { api, controller } = fixture();
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText("第一位孩子草稿");
  const late = deferred<ChatPage>();
  const started = deferred<void>();
  api.listMessages = async childId => {
    if (childId === firstChild) {
      started.resolve();
      return late.promise;
    }
    return { messages: [userMessage(secondChild, "第二位孩子舊訊息", "message-2")], limit: 100 };
  };
  const oldRead = controller.reloadMessages();
  await started.promise;
  controller.syncContext(alice.id, true, secondChild);
  await settle();
  controller.setText("第二位孩子草稿");
  late.resolve({ messages: [userMessage()], limit: 100 });
  await oldRead;
  assert.equal(controller.getSnapshot().selectedChildId, secondChild);
  assert.deepEqual(controller.getSnapshot().messages.map(item => item.childId), [secondChild]);
  assert.equal(controller.getSnapshot().drafts[firstChild].text, "第一位孩子草稿");
  controller.syncContext(bob.id, true, secondChild);
  assert.deepEqual(controller.getSnapshot().messages, []);
  assert.deepEqual(controller.getSnapshot().drafts, {});
  assert.equal(controller.hasUnsavedInput(), false);
  controller.syncContext(null, true, null);
  assert.equal(controller.getSnapshot().userId, null);
});

test("offline submission keeps the current child's draft and makes no request", async () => {
  const { values, controller } = fixture();
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText(original);
  controller.syncContext(alice.id, false, firstChild);
  await controller.send();
  assert.equal(values.saves, 0);
  assert.equal(values.replies, 0);
  assert.equal(controller.getSnapshot().drafts[firstChild].text, original);
  assert.equal(controller.hasUnsavedInput(), true);
});


test("a session-check outage after a confirmed save keeps its message identity without reposting", async () => {
  const { api, values, controller } = fixture();
  controller.syncContext(alice.id, true, firstChild);
  await settle();
  controller.setText(original);
  const save = api.saveMessage;
  api.saveMessage = async (...args) => {
    const saved = await save(...args);
    api.getSession = async () => { throw new ChatApiError(); };
    return saved;
  };
  await controller.send();
  assert.equal(controller.getSnapshot().busy, null);
  assert.equal(controller.getSnapshot().drafts[firstChild].phase, "reply_failed");
  assert.equal(controller.getSnapshot().drafts[firstChild].savedUserMessageId, "message-1");
  assert.equal(controller.getSnapshot().drafts[firstChild].text, original);
  assert.equal(values.saves, 1);
  assert.equal(values.replies, 0);
  api.getSession = async () => alice;
  await controller.reloadMessages();
  await controller.requestReply("message-1");
  assert.equal(values.saves, 1);
  assert.equal(values.replies, 1);
  assert.equal(controller.getSnapshot().drafts[firstChild].text, "");
});


test('live progress recovers the same saved reply and drops late events after a child switch', async () => {
  const {values,api,controller}=fixture();let reads=0;
  api.getReplyState=async()=>{reads++;return 'completed';};
  api.requestReply=async(childId,messageId,_signal,_userId,progress)=>{
    values.replies++;progress?.({runId:firstChild,messageId,phase:'reading'});
    assert.equal(controller.getSnapshot().feedback?.phase,'reading');
    values.messages.push(modelMessage(childId,messageId));throw new ChatApiError();
  };
  controller.syncContext(alice.id,true,firstChild);await settle();controller.setText(original);await controller.send();
  assert.equal(values.replies,1);assert.equal(reads,1);assert.ok(controller.getSnapshot().messages.some(m=>m.role==='model'));
  assert.equal(controller.getSnapshot().feedback,null);
  const gate=deferred<ChatMessage>();let late:Parameters<ChatApi['requestReply']>[4];
  api.requestReply=async(_childId,_messageId,_signal,_userId,progress)=>{late=progress;return gate.promise;};
  controller.syncContext(alice.id,true,secondChild);await settle();controller.setText('另一個孩子');const pending=controller.send();await settle();
  controller.syncContext(alice.id,true,firstChild);late?.({runId:secondChild,messageId:'message-1',phase:'help',card:'medical-consult-hk-v1'});
  gate.resolve(modelMessage(secondChild));await pending;
  assert.equal(controller.getSnapshot().feedback,null);assert.equal(controller.getSnapshot().selectedChildId,firstChild);controller.dispose();
});


test("chat submission trims boundary blank lines and recovers the same normalized message", async () => {
  const { values, api, controller } = fixture();
  const raw = "\n \n在不在\n\n\n  \n第二段\n第三行\n\n ";
  const expected = "在不在\n\n第二段\n第三行";
  api.saveMessage = async (childId, text) => {
    values.saves++; assert.equal(text, expected);
    values.messages.push(userMessage(childId, text));
    throw new ChatApiError();
  };
  controller.syncContext(alice.id, true, firstChild); await settle(); controller.setText(raw);
  assert.equal(controller.getSnapshot().drafts[firstChild].text, raw);
  await controller.send();
  assert.equal(controller.getSnapshot().drafts[firstChild].text, expected);
  assert.equal(controller.getSnapshot().drafts[firstChild].phase, "save_unknown");
  await controller.send(); assert.equal(values.saves, 1);
  await controller.reloadMessages();
  assert.equal(controller.getSnapshot().drafts[firstChild].candidateMessageId, "message-1");
  assert.equal(values.replies, 0); controller.dispose();
});
