import assert from "node:assert/strict";
import test from "node:test";
import { retainCareScope } from "../src/client/care-scope.ts";
import type { RecordsState } from "../src/client/records-controller.ts";
const child = { id: "child", workspaceId: "family", displayName: "合成孩子", createdAt: "2026-09-01", accessRole: "owner" as const };
const scope = { userId: "owner", child };
const state = (patch: Partial<RecordsState>) => ({ auth: "signedIn", user: { id: "owner" }, children: [child], selectedChildId: child.id,
  childrenLoading: false, childrenLoadedAt: "2026-09-24", ...patch } as RecordsState);
test("session rechecks retain the hidden page draft until the same child is authorized again", () => {
  assert.equal(retainCareScope(scope, state({ auth: "checking", user: null, children: [] })), scope);
  assert.equal(retainCareScope(scope, state({ auth: "unavailable", user: null, children: [] })), scope);
  assert.equal(retainCareScope(scope, state({ children: [], childrenLoading: true })), scope);
  assert.deepEqual(retainCareScope(scope, state({})), scope);
});
test("logout, account changes and fresh revocation discard the old page scope", () => {
  assert.equal(retainCareScope(scope, state({ auth: "signedOut" })), null);
  assert.equal(retainCareScope(scope, state({ user: { id: "other", email: "other@example.test", name: "Other" }, children: [], childrenLoading: true })), null);
  assert.equal(retainCareScope(scope, state({ children: [], selectedChildId: null })), null);
  const viewer = { ...child, accessRole: "viewer" as const };
  assert.equal(retainCareScope(scope, state({ children: [viewer] }))?.child.accessRole, "viewer");
});
