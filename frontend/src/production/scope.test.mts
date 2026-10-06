import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientApiError, type RecordsApi } from "../../../src/client/records-api.ts";
import { ProductionOwner } from "./ProductionOwner.ts";
import { confirmedUserId, productionScopeKey } from "./scope.ts";
import { projectProductionHome } from "./home-projection.ts";

const user = { id: "user-a", name: "Caregiver", email: "test@example.invalid" };
const children = [
  { id: "child-a", workspaceId: "workspace-a", displayName: "A", createdAt: "2026-10-06T00:00:00Z", accessRole: "owner" as const },
  { id: "child-b", workspaceId: "workspace-a", displayName: "B", createdAt: "2026-10-06T00:00:00Z", accessRole: "viewer" as const },
];

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
  const owner = new ProductionOwner("/api", true, fakeApi());
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
  const owner = new ProductionOwner("/api", true, api);
  let disposed = 0;
  try {
    await owner.controller.restoreSession();
    const first = owner.getSnapshot();
    owner.draftOwner.setText(first.scopeKey, "Private draft A");
    owner.draftOwner.add(first.scopeKey, { id: "photo-a", kind: "photo", fileName: "a.png", mimeType: "image/png", bytes: 1, dispose: () => { disposed += 1; } });
    owner.markHomeIntroductionPresented();
    await owner.controller.selectChild("child-b");
    assert.equal(disposed, 1);
    assert.equal(owner.draftOwner.getSnapshot().text, "");
    assert.equal(owner.getSnapshot().homeIntroductionPending, false);
    await owner.controller.selectChild("child-a");
    assert.equal(owner.draftOwner.getSnapshot().text, "Private draft A");
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
  const owner = new ProductionOwner("/api", true, api);
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
