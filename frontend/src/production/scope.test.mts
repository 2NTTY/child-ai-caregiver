import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientApiError, type RecordsApi } from "../../../src/client/records-api.ts";
import type { ChatApi } from "../../../src/client/chat-api.ts";
import { ProductAgentApiError, type ProductAgentApi } from "../../../src/client/product-agent-api.ts";
import type { ProductAgentResult } from "../../../src/shared/product-agent.ts";
import { mayRetryOriginal } from "../agent-view-model.ts";
import { ProductAgentOwner } from "./ProductAgentOwner.ts";
import { ProductionOwner } from "./ProductionOwner.ts";
import { confirmedUserId, productionScopeKey } from "./scope.ts";
import { projectProductionHome } from "./home-projection.ts";

const user = { id: "user-a", name: "Caregiver", email: "test@example.invalid" };
const children = [
  { id: "child-a", workspaceId: "workspace-a", displayName: "A", createdAt: "2026-10-06T00:00:00Z", accessRole: "owner" as const },
  { id: "child-b", workspaceId: "workspace-a", displayName: "B", createdAt: "2026-10-06T00:00:00Z", accessRole: "viewer" as const },
];

function fakeChatApi(): ChatApi {
  return { getSession: async () => user, listMessages: async () => ({ messages: [], limit: 100 }),
    getStatus: async () => true, getUsage: async () => ({ day: "2026-10-06", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
    saveMessage: async () => { throw new Error("No writes in this check"); }, requestReply: async () => { throw new Error("No model calls in this check"); } };
}
function fakeApi(): RecordsApi {
  return {
    getSession: async () => user,
    authenticate: async () => {}, signOut: async () => {},
    listChildren: async () => children,
    listRecords: async () => ({ records: [], limit: 100 }),
    createChild: async () => { throw new Error("No writes in this check"); },
    deleteChild: async () => { throw new Error("No writes in this check"); },
    createRecord: async () => { throw new Error("No writes in this check"); },
  };
}

test("production scope uses server, stable identity, generation, child and role, and gates logout", async () => {
  const owner = new ProductionOwner("/api", true, fakeApi(), fakeChatApi());
  try {
    await owner.controller.restoreSession();
    const state = owner.controller.getSnapshot();
    const scope = productionScopeKey("/api", state, 1);
    assert.ok(scope);
    assert.equal(productionScopeKey("/api", { ...state, user: { ...user, name: "Renamed" } }, 1), scope);
    assert.notEqual(productionScopeKey("https://other.example/api", state, 1), scope);
    assert.notEqual(productionScopeKey("/api", state, 2), scope);
    assert.notEqual(productionScopeKey("/api", { ...state, selectedChildId: "child-b" }, 1), scope);
    assert.notEqual(productionScopeKey("/api", { ...state, children: [{ ...children[0], accessRole: "viewer" }] }, 1), scope);
    for (const auth of ["checking", "signedOut", "unavailable"] as const) assert.equal(productionScopeKey("/api", { ...state, auth }, 1), null);
    assert.equal(confirmedUserId({ ...state, busy: "logout" }), null);
    assert.equal(productionScopeKey("/api", { ...state, selectedChildId: "missing" }, 1), null);
  } finally { owner.dispose(); }
});

test("child change releases local photo resources and identity uncertainty conceals private projections", async () => {
  const api = fakeApi();
  let sessionUnavailable = false;
  api.getSession = async () => { if (sessionUnavailable) throw new ClientApiError(); return user; };
  const owner = new ProductionOwner("/api", true, api, fakeChatApi());
  let disposed = 0;
  try {
    await owner.controller.restoreSession();
    const first = owner.getSnapshot();
    owner.chatController.setText("Private draft A");
    owner.draftOwner.add(first.scopeKey, { id: "photo-a", kind: "photo", fileName: "a.png", mimeType: "image/png", bytes: 1, dispose: () => { disposed += 1; } });
    owner.markHomeIntroductionPresented();
    await owner.controller.selectChild("child-b");
    assert.equal(disposed, 1);
    assert.equal(owner.draftOwner.getSnapshot().text, "");
    assert.equal(owner.getSnapshot().homeIntroductionPending, false);
    await owner.controller.selectChild("child-a");
    assert.equal(owner.getSnapshot().chat.drafts["child-a"]?.text, "Private draft A");
    sessionUnavailable = true;
    const restore = owner.controller.restoreSession();
    const gated = owner.getSnapshot();
    assert.equal(gated.scopeKey, null);
    assert.equal(gated.identityKey, null);
    assert.equal(gated.records.user, null);
    assert.deepEqual(gated.records.children, []);
    assert.deepEqual(projectProductionHome(gated).records, []);
    assert.equal(owner.draftOwner.getSnapshot().text, "");
    assert.equal(owner.queryClient.getQueryCache().getAll().length, 0);
    await restore;
    assert.equal(owner.getSnapshot().records.auth, "unavailable");
  } finally { owner.dispose(); }
});

test("unconnected home feeds remain unavailable and logout unknown never exposes old identity", async () => {
  const api = fakeApi();
  api.signOut = async () => { throw new ClientApiError(); };
  const owner = new ProductionOwner("/api", true, api, fakeChatApi());
  try {
    await owner.controller.restoreSession();
    const home = projectProductionHome(owner.getSnapshot());
    assert.equal(home.overview?.agentImportant?.state, "unavailable");
    assert.equal(home.overview?.ongoing.state, "unavailable");
    assert.equal(home.overview?.attention.state, "unavailable");
    await owner.controller.signOut();
    assert.equal(owner.getSnapshot().records.auth, "unavailable");
    assert.equal(owner.getSnapshot().identityKey, null);
    assert.equal(owner.getSnapshot().scopeKey, null);
    assert.equal(owner.getSnapshot().records.user, null);
    assert.deepEqual(owner.getSnapshot().records.children, []);
  } finally { owner.dispose(); }
});

test("production original decision requires reread and renewed sharing, then reuses exact input", async () => {
  const scope = { key: "server/user/child/generation", userId: "user-a", childId: "child-a" };
  const proposal = { id: "proposal-a", runId: "run-a", childId: "child-a", version: 3, status: "pending" as const,
    createdAt: "2026-10-06T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", targetLabel: "Caregiver",
    value: { kind: "task_create" as const, values: { title: "Check routine", details: "Original details", kind: "ordinary" as const,
      assigneeUserId: "user-a", dueAt: "2098-01-01T00:00:00Z", timeZone: "Asia/Hong_Kong" } }, result: null };
  let latest: ProductAgentResult = { runId: "run-a", provenance: null, status: "completed", stopReason: null, text: "Saved answer",
    citations: [], retrievalMode: "not_used", tools: [], countsKnown: false, counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [proposal] };
  let readFails = false, writeFails = true, savedCount = 0;
  const attempts: { runId: string; proposalId: string; input: unknown }[] = [];
  const api: ProductAgentApi = {
    getPendingProposals: async () => { throw new Error("Out of this slice"); },
    getRun: async (childId, runId, _signal, userId) => {
      assert.equal(childId, scope.childId); assert.equal(runId, "run-a"); assert.equal(userId, scope.userId);
      if (readFails) throw new ProductAgentApiError(); return latest;
    },
    decideProposal: async (childId, runId, proposalId, input, _signal, userId) => {
      assert.equal(childId, scope.childId); assert.equal(userId, scope.userId);
      attempts.push({ runId, proposalId, input: { ...input } });
      if (writeFails) throw new ProductAgentApiError();
      const saved = { ...proposal, status: "accepted" as const, version: 4, result: { kind: "task" as const, id: "task-a", version: 1 } };
      latest = { ...latest, proposals: [saved] }; return saved;
    },
  };
  const owner = new ProductAgentOwner("/api", true, () => { throw new Error("Unexpected access loss"); }, () => { savedCount++; }, () => api);
  const idle = async () => {
    if (!owner.getSnapshot().model.busy) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { stop(); reject(new Error("Owner did not finish")); }, 1000);
      const stop = owner.subscribe(() => { if (!owner.getSnapshot().model.busy) { clearTimeout(timeout); stop(); resolve(); } });
    });
  };
  try {
    owner.syncContext(scope, true); owner.selectRun("run-a"); await idle();
    assert.equal(owner.getSnapshot().model.run?.createdAt, null);
    assert.equal(owner.getSnapshot().model.run?.counts, null);
    assert.ok(owner.getSnapshot().model.run?.proposals[0].details.some(row => row.value === proposal.value.values.dueAt));
    owner.setSharedConfirmation("proposal-a", true); owner.decide("proposal-a", "accept"); await idle();
    const original = owner.getSnapshot().model.pendingDecision;
    assert.deepEqual(original?.input, { expectedVersion: 3, decision: "accept", confirmShared: true });
    assert.equal(owner.getSnapshot().inbox.locked, true);
    owner.decide("proposal-a", "dismiss"); owner.selectRun("other-run"); owner.collapseInbox(); owner.retryOriginal();
    assert.equal(attempts.length, 1); assert.equal(owner.getSnapshot().model.pendingDecision?.runId, "run-a");
    readFails = true; await owner.refresh();
    assert.equal(owner.getSnapshot().model.readState, "failed");
    assert.equal(owner.getSnapshot().model.pendingDecision?.reviewed, false); assert.equal(mayRetryOriginal(owner.getSnapshot().model), false);
    readFails = false; await owner.refresh();
    assert.equal(owner.getSnapshot().model.pendingDecision?.reviewed, true);
    assert.deepEqual(owner.getSnapshot().model.sharedConfirmed, {}); assert.equal(mayRetryOriginal(owner.getSnapshot().model), false);
    owner.setSharedConfirmation("proposal-a", true); writeFails = false; owner.retryOriginal(); await idle();
    assert.deepEqual(attempts[1], attempts[0]); assert.equal(owner.getSnapshot().model.pendingDecision, null);
    assert.equal(owner.getSnapshot().model.run?.proposals[0].status, "accepted"); assert.equal(savedCount, 1);
    owner.syncContext({ ...scope, key: "other-child", childId: "child-b" }, true);
    assert.deepEqual(owner.getSnapshot().runs, {}); assert.equal(owner.getSnapshot().model.run, null);
  } finally { owner.dispose(); }
});
