import assert from "node:assert/strict";
import test from "node:test";
import { RecordsController } from "../src/client/records-controller.ts";
import { ClientApiError, type RecordsApi, type SessionUser } from "../src/client/records-api.ts";
import type { Child } from "../src/shared/records.ts";
import type { ChildSelectionPreferences } from "../src/client/child-selection.ts";
import { createWebChildSelectionPreferences } from "../frontend/src/production/child-selection.ts";
import "./helpers/frontend-source-loader.mjs";
import { createAccountApi } from "../src/client/account-api.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import type { ChatApi } from "../src/client/chat-api.ts";
import { handoverSourceHistoryKey } from "../frontend/src/production/HandoverImportOwner.ts";

const { ProductionOwner } = await import("../frontend/src/production/ProductionOwner.ts");

const alice = { id: "alice", name: "A", email: "a@example.invalid" };
const bob = { ...alice, id: "bob" };
const children: Child[] = ["A", "B"].map(id => ({ id, workspaceId: "family", displayName: id, createdAt: "2026-10-07T00:00:00Z", accessRole: "owner" }));
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function fixture(preferences?: ChildSelectionPreferences) {
  const state = { user: alice as SessionUser | null, children: [...children], reads: [] as string[] };
  const api: RecordsApi = {
    getSession: async () => state.user, authenticate: async () => {}, signOut: async () => { state.user = null; },
    listChildren: async () => state.children, listRecords: async id => { state.reads.push(id); return { records: [], limit: 100 }; },
    createChild: async () => { throw Error("No writes"); }, deleteChild: async () => { throw Error("No writes"); }, createRecord: async () => { throw Error("No writes"); },
  };
  return { state, api, controller: new RecordsController(api, true, undefined, true, preferences) };
}
test("fresh controller restores B before any private read and persists only navigation IDs", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store);
  const first = fixture(pref); await first.controller.restoreSession(); await first.controller.selectChild("B");
  first.controller.setRecordText("Private draft stays in memory"); first.controller.dispose();
  const next = fixture(pref); await next.controller.restoreSession();
  assert.equal(next.controller.getSnapshot().selectedChildId, "B"); assert.deepEqual(next.state.reads, ["B"]);
  assert.deepEqual(JSON.parse([...store.values.values()][0]), { childId: "B", workspaceId: "family" });
  assert.deepEqual(next.controller.getSnapshot().drafts, {}); next.controller.dispose();
});
test("ProductionOwner's first non-null child scope is B, never A", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store);
  const f = fixture(), selected: string[] = [], messageReads: string[] = [];
  // Production avatar lanes validate child UUIDs even when they are only disposed.
  const childIds = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  f.state.children = children.map((child, index) => ({ ...child, id: childIds[index] }));
  const childB = f.state.children[1];
  pref.write(alice.id, { childId: childB.id, workspaceId: childB.workspaceId });
  const chat: ChatApi = { getSession: async () => alice,
    listMessages: async id => { messageReads.push(id); return { messages: [], limit: 100 }; },
    getStatus: async () => true, getUsage: async () => ({ day: "2026-10-07", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
    saveMessage: async () => { throw Error("No writes"); }, requestReply: async () => { throw Error("No models"); } };
  const account = createAccountApi("/api", async (input, init) => {
    assert.equal(input, "/api/account"); assert.equal(init?.method, "GET");
    const expectedUserId = new Headers(init?.headers).get("x-expected-user-id");
    assert.ok(expectedUserId === null || expectedUserId === alice.id);
    return Response.json({ enabled: true, registration: "invite", mailConfigured: false,
      policyVersion: SERVICE_POLICY_VERSION, notice: "Synthetic account status",
      user: expectedUserId === null ? null : { id: alice.id, emailVerified: true, acknowledged: true, acknowledgementVersion: SERVICE_POLICY_VERSION } });
  });
  const unexpectedFetches: string[] = [];
  const owner = new ProductionOwner("/api", true, f.api, chat, pref, { api: account }, {
    platform: "web", publicOrigin: "https://example.invalid", fetcher: async input => {
      unexpectedFetches.push(String(input)); throw Error("Unexpected network request");
    },
  });
  try {
    owner.subscribe(() => { const s = owner.getSnapshot(); if (s.scopeKey && s.records.selectedChildId) selected.push(s.records.selectedChildId); });
    await owner.controller.restoreSession(); await new Promise<void>(done => setImmediate(done));
    assert.equal(owner.getSnapshot().records.selectedChildId, childB.id); assert.ok(selected.length);
    assert.ok(selected.every(id => id === childB.id)); assert.ok(messageReads.every(id => id === childB.id));
  } finally { owner.dispose(); }
  assert.deepEqual(unexpectedFetches, []);
});
test("ProductionOwner invalidates shared import reading without discarding the account operation", async () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, f = fixture();
  f.state.children = [{ ...children[0], id: uuid(1) }];
  const spaceId = uuid(2), childId = uuid(3), sourceChildId = uuid(4), documentId = uuid(5), snapshotId = uuid(6), batchId = uuid(7);
  const at = "2026-10-30T00:00:00Z", hash = "a".repeat(64);
  const batch = { id: batchId, version: 1, uploadId: uuid(8), packageId: uuid(9), packageVersion: 1, manifestSha256: hash, integrity: "trusted",
    targets: [{ sourceChildId, target: { childId, spaceId }, sections: ["documents"] }], state: "failed", totalItems: 1, processedItems: 1,
    counts: { created: 1, updated: 0, skipped: 0, conflict: 0 }, error: "package_import_failed", createdAt: at, updatedAt: at };
  const result = { id: uuid(10), batchId, sourceChildId, module: "documents", resourceSection: "documents", sourceResourceId: uuid(11), sourceVersion: 1,
    sourceSection: null, at, outcome: "created", reason: null, recordedResource: { id: documentId, version: 1 }, currentResource: null, availableResolution: null };
  const history = { format: "yuyoufang-source-revision:1", childId, resource: { id: documentId, version: 1 }, evidence: { module: "documents",
    value: { documentId, snapshotId, snapshotVersion: 1, generatedAt: at, invalidated: false }, source: { current: {
      source: { serverId: "https://source.invalid", accountId: "external", childId: sourceChildId, section: "documents", resourceId: uuid(11), resourceVersion: 1,
        authorUserId: null, createdAt: at, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
      sourceHash: hash, packageId: batch.packageId, packageVersion: 1, manifestSha256: hash, integrity: "trusted", importedBy: alice.id, importedAt: at }, previous: [] } } };
  const snapshot = { id: snapshotId, version: 1, generatedAt: at, sourceBasis: hash, title: "Private source document", summary: "Private original body",
    ageLabel: "", period: { from: "2026-10-01", to: "2026-10-31" }, eventDate: null, coverageNote: "", sections: [], sources: [], changes: [] };
  const text = JSON.stringify(snapshot), content = { page: { documentId, documentVersion: 12, authorityVersion: "current-authority", snapshotId, snapshotVersion: 1,
    offset: 0, text, totalCharacters: text.length, nextOffset: null, complete: true, invalidated: false, contentKind: "snapshot_json" } };
  let hold = false, bodySignal: AbortSignal | null = null, release!: (response: Response) => void;
  const chat: ChatApi = { getSession: async () => alice, listMessages: async () => ({ messages: [], limit: 100 }), getStatus: async () => true,
    getUsage: async () => ({ day: "2026-10-30", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
    saveMessage: async () => { throw Error("No writes"); }, requestReply: async () => { throw Error("No models"); } };
  const account = createAccountApi("/api", async (_input, init) => Response.json({ enabled: true, registration: "invite", mailConfigured: false,
    policyVersion: SERVICE_POLICY_VERSION, notice: "Synthetic account status", user: new Headers(init?.headers).get("x-expected-user-id") === null ? null
      : { id: alice.id, emailVerified: true, acknowledged: true, acknowledgementVersion: SERVICE_POLICY_VERSION } }));
  const owner = new ProductionOwner("/api", true, f.api, chat, undefined, { api: account }, { platform: "web", publicOrigin: "https://example.invalid",
    fetcher: async (input, init) => {
      const url = new URL(String(input), "https://example.invalid");
      assert.equal(new Headers(init?.headers).get("x-expected-user-id"), alice.id);
      if (url.pathname === `/api/shared-spaces/${spaceId}/children/${childId}`) return Response.json({ spaceId, spaceName: "Family", childId, childName: "Shared child",
        role: "caregiver", modules: ["documents"], basis: { spaceVersion: 1, membershipVersion: 1, shareVersion: 1, actorAuthorizationVersion: "1", sourceAuthorizationVersion: "1" } });
      if (url.pathname.endsWith("/content")) { assert.equal(url.searchParams.get("spaceId"), spaceId); assert.equal(url.searchParams.get("snapshotId"), snapshotId);
        if (hold) { bodySignal = init!.signal as AbortSignal; return new Promise<Response>(done => { release = done; }); } return Response.json(content); }
      if (url.pathname.endsWith("/items")) return Response.json({ batchId, sourceChildId, module: "documents", items: [result], nextCursor: null, complete: true });
      if (url.pathname.endsWith("/source-history")) return Response.json({ items: [history], nextCursor: null, complete: true });
      if (url.pathname.endsWith("/resume")) return Response.json({ error: { code: "handover_unavailable" } }, { status: 503 });
      if (url.pathname === "/api/account/package-imports") return Response.json({ items: [batch], nextCursor: null });
      throw Error(`Unexpected request ${url.pathname}`);
    } });
  try {
    await owner.controller.restoreSession(); await new Promise<void>(done => setImmediate(done));
    await owner.selectSharedChild(spaceId, childId); assert.ok(owner.getSnapshot().scopeKey);
    const identity = owner.getSnapshot().identityKey, imports = owner.handoverImportOwner;
    const open = async () => { await imports.load(); imports.selectResults(batchId, sourceChildId, "documents"); await imports.readResults();
      await imports.openSourceHistory(result.id);
      assert.ok(imports.getSnapshot().sourceHistory, JSON.stringify({ notice: imports.getSnapshot().notice, results: imports.getSnapshot().results }));
      await imports.openDocumentContent(handoverSourceHistoryKey(imports.getSnapshot().sourceHistory!.items[0])); };
    await open(); assert.equal(imports.getSnapshot().sourceHistory?.documentContent?.snapshot?.summary, snapshot.summary);
    owner.sharedChild.invalidate(); const completedCleared = imports.getSnapshot().sourceHistory === null;
    await owner.sharedChild.refresh(); hold = true; const pendingRead = open(); await new Promise<void>(done => setImmediate(done)); assert.ok(bodySignal);
    owner.sharedChild.invalidate(); const aborted = (bodySignal as AbortSignal).aborted, readingCleared = imports.getSnapshot().sourceHistory === null;
    release(Response.json(content)); await pendingRead; const lateIgnored = imports.getSnapshot().sourceHistory === null;
    await owner.sharedChild.refresh(); await imports.control(batchId, "resume"); const pending = imports.getSnapshot().pending; assert.equal(pending?.kind, "resume");
    owner.sharedChild.invalidate();
    assert.deepEqual({ completedCleared, aborted, readingCleared, lateIgnored, pendingPreserved: imports.getSnapshot().pending === pending,
      identityPreserved: owner.getSnapshot().identityKey === identity },
    { completedCleared: true, aborted: true, readingCleared: true, lateIgnored: true, pendingPreserved: true, identityPreserved: true });
  } finally { owner.dispose(); }
});

test("account and endpoint preferences stay isolated without generation keys", async () => {
  const store = storage(), a = createWebChildSelectionPreferences("/api", () => store), other = createWebChildSelectionPreferences("https://other.example/api", () => store);
  a.write(alice.id, { childId: "B", workspaceId: "family" });
  assert.equal(a.read(bob.id), null); assert.equal(other.read(alice.id), null);
  const f = fixture(a); f.state.user = bob; await f.controller.restoreSession(); assert.equal(f.controller.getSnapshot().selectedChildId, "A");
  assert.equal(a.read(alice.id)?.childId, "B"); f.controller.dispose();
});
for (const kind of ["missing", "workspace"] as const) test(`authoritative ${kind} mismatch falls back before reading a child`, async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store);
  pref.write(alice.id, { childId: kind === "missing" ? "gone" : "B", workspaceId: kind === "workspace" ? "old-family" : "family" });
  const f = fixture(pref); await f.controller.restoreSession(); assert.deepEqual(f.state.reads, ["A"]);
  assert.deepEqual(pref.read(alice.id), { childId: "A", workspaceId: "family" }); f.controller.dispose();
});
test("an authoritative empty child list clears an inaccessible hint", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); pref.write(alice.id, { childId: "B", workspaceId: "family" });
  const f = fixture(pref); f.state.children = []; await f.controller.restoreSession();
  assert.equal(pref.read(alice.id), null); assert.deepEqual(f.state.reads, []); f.controller.dispose();
});
test("temporary list or auth failure preserves B until a successful retry", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); pref.write(alice.id, { childId: "B", workspaceId: "family" });
  const f = fixture(pref); f.api.listChildren = async () => { throw new ClientApiError(503); };
  await f.controller.restoreSession(); assert.equal(pref.read(alice.id)?.childId, "B"); assert.deepEqual(f.state.reads, []);
  f.api.getSession = async () => { throw new ClientApiError(503); }; await f.controller.restoreSession(); assert.equal(pref.read(alice.id)?.childId, "B");
  f.api.getSession = async () => alice; f.api.listChildren = async () => children; await f.controller.restoreSession();
  assert.deepEqual(f.state.reads, ["B"]); f.controller.dispose();
});
test("late child list from A cannot restore or rewrite navigation after switching to B's account", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); pref.write(alice.id, { childId: "B", workspaceId: "family" });
  const f = fixture(pref); let resolve!: (value: Child[]) => void, calls = 0;
  const delayed = new Promise<Child[]>(done => { resolve = done; });
  f.api.listChildren = async () => ++calls === 1 ? delayed : [{ ...children[0], id: "bob-child", workspaceId: "bob-family" }];
  const pending = f.controller.restoreSession(); await new Promise<void>(done => setImmediate(done));
  f.state.user = bob; await f.controller.restoreSession(); resolve(children); await pending;
  assert.equal(f.controller.getSnapshot().selectedChildId, "bob-child"); assert.deepEqual(f.state.reads, ["bob-child"]);
  assert.equal(pref.read(alice.id)?.childId, "B"); f.controller.dispose();
});
test("corrupt content, disabled storage and throwing ports do not prevent login", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); pref.write(alice.id, { childId: "B", workspaceId: "family" });
  store.values.set([...store.values.keys()][0], "not-json");
  const fail = () => { throw Error("Storage disabled"); };
  for (const preference of [pref, createWebChildSelectionPreferences("/api", fail), { read: fail, write: fail, clear: fail }]) {
    const f = fixture(preference); await f.controller.restoreSession(); assert.equal(f.controller.getSnapshot().selectedChildId, "A");
    await f.controller.signOut(); assert.equal(f.controller.getSnapshot().auth, "signedOut"); f.controller.dispose();
  }
});
test("cancelled logout and disposal keep B; confirmed logout clears only its account", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); const f = fixture(pref);
  pref.write(bob.id, { childId: "B", workspaceId: "family" }); await f.controller.restoreSession(); await f.controller.selectChild("B"); f.controller.setRecordText("draft");
  await f.controller.signOut(); assert.equal(f.controller.getSnapshot().logoutConfirmation, true); f.controller.cancelLogout(); assert.equal(pref.read(alice.id)?.childId, "B");
  f.controller.dispose(); assert.equal(pref.read(alice.id)?.childId, "B"); await f.controller.signOut(true);
  assert.equal(pref.read(alice.id), null); assert.equal(pref.read(bob.id)?.childId, "B");
});
test("unknown logout never clears the navigation hint", async () => {
  const store = storage(), pref = createWebChildSelectionPreferences("/api", () => store); const f = fixture(pref);
  await f.controller.restoreSession(); await f.controller.selectChild("B"); f.api.signOut = async () => { throw new ClientApiError(); };
  await f.controller.signOut(); assert.equal(f.controller.getSnapshot().auth, "unavailable"); assert.equal(pref.read(alice.id)?.childId, "B"); f.controller.dispose();
});
