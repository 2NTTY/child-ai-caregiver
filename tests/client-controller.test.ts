import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, type RecordsApi, type SessionUser } from "../src/client/records-api.ts";
import { RecordsController } from "../src/client/records-controller.ts";
import type { Child, TextRecord } from "../src/shared/records.ts";

const alice = { id: "alice", name: "測試甲", email: "alice@example.test" };
const bob = { id: "bob", name: "測試乙", email: "bob@example.test" };
const first = { id: "669fc3c0-1734-42c9-b541-3b7f55f584e1", workspaceId: "workspace-alice", displayName: "小晴", createdAt: "2026-09-22T00:00:00.000Z" };
const second = { ...first, id: "7a640e02-926b-4b0a-a812-799776883e02", displayName: "小朗" };
const bobChild = { ...first, id: "a06a5b0e-f278-43cd-97f6-23798c94854c", workspaceId: "workspace-bob", displayName: "孩子乙" };
const original = "  昨晚大約八點，飲咗約 120 ml 奶。\n今日精神幾好。  ";

function makeRecord(childId = first.id, text = original, authorUserId = alice.id, id = "record-1"): TextRecord {
  return { id, childId, authorUserId, text, createdAt: "2026-09-22T01:00:00.000Z" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const values = {
    user: alice as SessionUser | null,
    children: [first, second] as Child[],
    records: [] as TextRecord[],
    writes: 0,
    childWrites: 0,
    signOuts: 0,
  };
  const api: RecordsApi = {
    getSession: async () => values.user,
    authenticate: async () => {},
    signOut: async () => { values.signOuts += 1; values.user = null; },
    listChildren: async () => values.children,
    createChild: async displayName => { values.childWrites += 1; return { ...first, id: "new-child", displayName }; },
    listRecords: async childId => ({ records: values.records.filter(record => record.childId === childId), limit: 100 }),
    createRecord: async (childId, text) => { values.writes += 1; return makeRecord(childId, text); },
  };
  return { values, api, controller: new RecordsController(api) };
}

test("record saving needs explicit confirmation and only clears exact input after the server confirms", async () => {
  const { api, controller, values } = fixture();
  const pending = deferred<TextRecord>();
  const started = deferred<void>();
  api.createRecord = async (childId, text) => {
    values.writes += 1;
    assert.equal(childId, first.id);
    assert.equal(text, original);
    started.resolve();
    return pending.promise;
  };
  await controller.restoreSession();
  controller.setRecordText(original);
  await controller.confirmRecord();
  assert.equal(values.writes, 0);
  controller.reviewRecord();
  const saving = controller.confirmRecord();
  await started.promise;
  await controller.confirmRecord();
  assert.equal(values.writes, 1);
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  assert.equal(controller.getSnapshot().drafts[first.id].receipt, null);
  pending.resolve(makeRecord());
  await saving;
  const state = controller.getSnapshot();
  assert.equal(state.drafts[first.id].text, "");
  assert.equal(state.drafts[first.id].receipt?.id, "record-1");
  assert.equal(state.records[0].text, original);
  assert.equal(controller.hasUnsavedInput(), false);
});

test("switching children keeps separate drafts and ignores a late response for the previous child", async () => {
  const { api, controller } = fixture();
  await controller.restoreSession();
  controller.setRecordText(original);
  const late = deferred<{ records: TextRecord[]; limit: number }>();
  api.listRecords = async id => id === first.id ? late.promise : { records: [makeRecord(second.id, "第二位孩子")], limit: 100 };
  const oldRead = controller.reloadRecords();
  await controller.selectChild(second.id);
  controller.setRecordText("第二位孩子的草稿");
  late.resolve({ records: [makeRecord()], limit: 100 });
  await oldRead;
  assert.equal(controller.getSnapshot().selectedChildId, second.id);
  assert.equal(controller.getSnapshot().records[0].childId, second.id);
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  await controller.selectChild(first.id);
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  assert.equal(controller.getSnapshot().drafts[second.id].text, "第二位孩子的草稿");
});

test("unknown writes retain input, block repeated writes, and require a successful read and explicit reconciliation", async () => {
  const { api, controller, values } = fixture();
  await controller.restoreSession();
  api.createRecord = async () => { values.writes += 1; throw new ClientApiError(); };
  controller.setRecordText(original);
  controller.reviewRecord();
  await controller.confirmRecord();
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "unknown");
  controller.setOnline(false);
  controller.setOnline(true);
  controller.reviewRecord();
  await controller.confirmRecord();
  assert.equal(values.writes, 1);
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  controller.resolveUnknownRecord(false);
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "unknown");
  api.listRecords = async () => { throw new ClientApiError(); };
  await controller.reloadRecords();
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "unknown");
  api.listRecords = async () => ({ records: [makeRecord()], limit: 100 });
  await controller.reloadRecords();
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "checked");
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  controller.resolveUnknownRecord(true);
  assert.equal(controller.getSnapshot().drafts[first.id].text, "");
  assert.equal(values.writes, 1);
});

test("definite rejection preserves the draft without claiming a saved receipt", async () => {
  const { api, controller } = fixture();
  await controller.restoreSession();
  api.createRecord = async () => { throw new ClientApiError(422); };
  controller.setRecordText(original);
  controller.reviewRecord();
  await controller.confirmRecord();
  const draft = controller.getSnapshot().drafts[first.id];
  assert.equal(draft.text, original);
  assert.equal(draft.outcome, "draft");
  assert.equal(draft.receipt, null);
  assert.equal(controller.getSnapshot().records.length, 0);
});

test("expired authentication hides private data and restores page input only for the same account", async () => {
  const { api, controller, values } = fixture();
  await controller.restoreSession();
  controller.setRecordText(original);
  controller.setChildName("未建立的孩子");
  api.createRecord = async () => { throw new ClientApiError(401); };
  controller.reviewRecord();
  await controller.confirmRecord();
  assert.equal(controller.getSnapshot().auth, "signedOut");
  assert.deepEqual(controller.getSnapshot().drafts, {});
  assert.deepEqual(controller.getSnapshot().children, []);
  assert.equal(controller.getSnapshot().childName, "");
  assert.equal(controller.hasUnsavedInput(), true);
  await controller.restoreSession();
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  assert.equal(controller.getSnapshot().childName, "未建立的孩子");
  values.user = bob;
  values.children = [bobChild];
  await controller.restoreSession();
  assert.equal(controller.getSnapshot().user?.id, bob.id);
  assert.deepEqual(controller.getSnapshot().drafts, {});
  assert.equal(controller.getSnapshot().childName, "");
  assert.equal(controller.hasUnsavedInput(), false);
});

test("a late write from an old account cannot change a new account or its draft", async () => {
  const { api, controller, values } = fixture();
  const pending = deferred<TextRecord>();
  const started = deferred<void>();
  await controller.restoreSession();
  api.createRecord = async () => { started.resolve(); return pending.promise; };
  controller.setRecordText(original);
  controller.reviewRecord();
  const oldWrite = controller.confirmRecord();
  await started.promise;
  values.user = bob;
  values.children = [bobChild];
  await controller.restoreSession();
  controller.setRecordText("帳號乙的草稿");
  pending.resolve(makeRecord());
  await oldWrite;
  const state = controller.getSnapshot();
  assert.equal(state.user?.id, bob.id);
  assert.equal(state.drafts[bobChild.id].text, "帳號乙的草稿");
  assert.equal(state.drafts[first.id], undefined);
  assert.deepEqual(state.records, []);
});

test("a changed cookie session blocks a write before sending the old account draft", async () => {
  const { controller, values } = fixture();
  await controller.restoreSession();
  controller.setRecordText(original);
  controller.reviewRecord();
  values.user = bob;
  await controller.confirmRecord();
  assert.equal(values.writes, 0);
  assert.equal(controller.getSnapshot().auth, "signedOut");
  assert.deepEqual(controller.getSnapshot().drafts, {});
});

test("offline actions preserve page input and reconnecting never replays writes", async () => {
  const { controller, values } = fixture();
  await controller.restoreSession();
  controller.setChildName("第三位孩子");
  controller.setRecordText(original);
  controller.reviewRecord();
  controller.setOnline(false);
  await controller.createChild();
  await controller.confirmRecord();
  assert.equal(values.childWrites, 0);
  assert.equal(values.writes, 0);
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  assert.equal(controller.getSnapshot().childName, "第三位孩子");
  controller.setOnline(true);
  assert.equal(values.writes, 0);
  assert.equal(values.childWrites, 0);
});

test("unknown child creation also requires a read and deliberate reconciliation", async () => {
  const { api, controller, values } = fixture();
  await controller.restoreSession();
  controller.setChildName("  第三位孩子  ");
  api.createChild = async displayName => { assert.equal(displayName, "第三位孩子"); values.childWrites += 1; throw new ClientApiError(500); };
  await controller.createChild();
  assert.equal(controller.getSnapshot().childName, "  第三位孩子  ");
  assert.equal(controller.getSnapshot().childOutcome, "unknown");
  await controller.createChild();
  assert.equal(values.childWrites, 1);
  await controller.reloadChildren();
  assert.equal(controller.getSnapshot().childOutcome, "checked");
  controller.resolveUnknownChild(false);
  assert.equal(controller.getSnapshot().childOutcome, "draft");
  assert.equal(values.childWrites, 1);
});

test("logout needs consent to discard drafts, unknown logout is gated, and successful logout clears page input", async () => {
  const { api, controller, values } = fixture();
  await controller.restoreSession();
  controller.setRecordText(original);
  await controller.signOut();
  assert.equal(controller.getSnapshot().logoutConfirmation, true);
  assert.equal(values.signOuts, 0);
  api.signOut = async () => { throw new ClientApiError(); };
  await controller.signOut(true);
  assert.equal(controller.getSnapshot().auth, "unavailable");
  assert.equal(controller.getSnapshot().hasRetainedInput, true);
  assert.deepEqual(controller.getSnapshot().drafts, {});
  await controller.restoreSession();
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
  api.signOut = async () => { values.signOuts += 1; values.user = null; };
  await controller.signOut(true);
  assert.equal(controller.getSnapshot().auth, "signedOut");
  assert.equal(controller.hasUnsavedInput(), false);
  assert.deepEqual(controller.getSnapshot().records, []);
});

test("a new page instance restores server data without persisting page drafts", async () => {
  const { api, controller, values } = fixture();
  values.records = [makeRecord()];
  await controller.restoreSession();
  controller.setRecordText("只留在舊頁面的內容");
  const reopened = new RecordsController(api);
  await reopened.restoreSession();
  assert.equal(reopened.getSnapshot().records[0].text, original);
  assert.deepEqual(reopened.getSnapshot().drafts, {});
});

test("switching children while the old identity check is being cancelled keeps the new view authenticated", async () => {
  const { api, controller } = fixture();
  await controller.restoreSession();
  const started = deferred<void>();
  let oldCheck = true;
  api.getSession = async signal => {
    if (!oldCheck) return alice;
    oldCheck = false;
    started.resolve();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ClientApiError()), { once: true }));
  };
  api.listRecords = async id => ({ records: [makeRecord(id)], limit: 100 });
  const oldRead = controller.reloadRecords();
  await started.promise;
  await controller.selectChild(second.id);
  await oldRead;
  assert.equal(controller.getSnapshot().auth, "signedIn");
  assert.equal(controller.getSnapshot().selectedChildId, second.id);
  assert.equal(controller.getSnapshot().records[0].childId, second.id);
});

test("server session-conflict rejection hides and retains the original account input for both write routes", async () => {
  for (const operation of ["child", "record"]) {
    const { api, controller, values } = fixture();
    await controller.restoreSession();
    controller.setChildName("尚未建立的孩子");
    controller.setRecordText(original);
    const rejectChangedSession = (expectedUserId: string) => {
      assert.equal(expectedUserId, alice.id);
      values.user = bob;
      throw new ClientApiError(409);
    };
    api.createChild = async (_name, _signal, expectedUserId) => rejectChangedSession(expectedUserId);
    api.createRecord = async (_childId, _text, _signal, expectedUserId) => rejectChangedSession(expectedUserId);
    if (operation === "child") await controller.createChild();
    else {
      controller.reviewRecord();
      await controller.confirmRecord();
    }
    assert.equal(controller.getSnapshot().auth, "signedOut");
    assert.deepEqual(controller.getSnapshot().drafts, {});
    assert.equal(controller.getSnapshot().childName, "");
    assert.equal(controller.getSnapshot().hasRetainedInput, true);
    values.user = alice;
    await controller.restoreSession();
    assert.equal(controller.getSnapshot().drafts[first.id].text, original);
    assert.equal(controller.getSnapshot().childName, "尚未建立的孩子");
  }
});

test("a failed fresh read cannot unlock an earlier unknown write using stale reconciliation", async () => {
  const { api, controller } = fixture();
  await controller.restoreSession();
  controller.setRecordText(original);
  controller.reviewRecord();
  api.createRecord = async () => { throw new ClientApiError(); };
  await controller.confirmRecord();
  await controller.reloadRecords();
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "checked");
  api.listRecords = async () => { throw new ClientApiError(); };
  await controller.reloadRecords();
  controller.resolveUnknownRecord(false);
  assert.equal(controller.getSnapshot().drafts[first.id].outcome, "unknown");
  assert.equal(controller.getSnapshot().drafts[first.id].text, original);
});
