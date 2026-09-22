import assert from "node:assert/strict";
import test from "node:test";
import { handleWorkspaceRequest } from "../server/workspace-api.ts";
import type { Workspace, WorkspaceStore } from "../server/workspaces.ts";

const workspace: Workspace = { id: "8ef67618-c092-45fb-829f-c5877d02d03c", storageEpoch: "epoch", createdAt: "2026-09-22T00:00:00.000Z" };
const store: WorkspaceStore = {
  listForUser: async (id) => id === "owner" ? [workspace] : [],
  getForUser: async (user, id) => user === "owner" && id === workspace.id ? workspace : null,
  ensureForUser: async (user) => { assert.equal(user, "owner"); return workspace; },
};

test("workspace API rejects absent sessions without querying storage", async () => {
  const unused = new Proxy({} as WorkspaceStore, { get() { throw new Error("Storage must not be accessed"); } });
  const response = await handleWorkspaceRequest(new Request("http://localhost/api/workspaces"), null, unused);
  assert.equal(response.status, 401);
});

test("workspace creation uses only the server session and returns no client ownership claims", async () => {
  const request = new Request("http://localhost/api/workspaces", { method: "POST", body: JSON.stringify({ ownerUserId: "attacker", workspaceId: "chosen" }) });
  const response = await handleWorkspaceRequest(request, "owner", store);
  assert.deepEqual(await response.json(), { workspace });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("workspace reads are scoped to the authenticated owner", async () => {
  const request = new Request(`http://localhost/api/workspaces/${workspace.id}`);
  assert.equal((await handleWorkspaceRequest(request, "owner", store)).status, 200);
  assert.equal((await handleWorkspaceRequest(request, "other", store)).status, 404);
  assert.deepEqual(await (await handleWorkspaceRequest(new Request("http://localhost/api/workspaces"), "other", store)).json(), { workspaces: [] });
});

test("workspace API rejects malformed IDs and unsupported methods", async () => {
  assert.equal((await handleWorkspaceRequest(new Request("http://localhost/api/workspaces/not-an-id"), "owner", store)).status, 404);
  assert.equal((await handleWorkspaceRequest(new Request("http://localhost/api/workspaces", { method: "DELETE" }), "owner", store)).status, 405);
});
