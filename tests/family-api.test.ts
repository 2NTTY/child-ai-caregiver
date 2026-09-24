import assert from "node:assert/strict";
import test from "node:test";
import { handleFamilyRequest } from "../server/family-api.ts";
import { FamilyError } from "../server/family-access.ts";
import type { FamilyStore } from "../server/families.ts";
import type { RecordStore } from "../server/records.ts";

const familyId = "5980663d-3bea-46fa-b63d-42d937026710";
const inviteId = "bdbccdaa-2876-4ed9-bc84-50aad7975bc2";
const token = "A".repeat(43);
const invitation = { id: inviteId, email: "helper@example.test", role: "caregiver" as const, expiresAt: "2026-10-01T00:00:00.000Z", status: "pending" as const };
const family = { id: familyId, ownerName: "家長", role: "owner" as const, version: 2,
  members: [{ userId: "owner", name: "家長", role: "owner" as const }], invitations: [invitation] };
const preferences = { timeZone: "Asia/Hong_Kong", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, version: 0 };
const preview = { workspaceId: familyId, ownerName: "家長", role: "caregiver" as const, expiresAt: invitation.expiresAt };
const child = { id: "79081f55-9e30-4ee5-91fb-71982b20d6f7", workspaceId: familyId, displayName: "小豆", createdAt: "2026-09-24T00:00:00.000Z" };
type Records = Pick<RecordStore, "createChildForUser">;

function request(path: string, body?: unknown, expectedUserId = "owner"): Request {
  return new Request(`http://localhost${path}?userId=forged`, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-expected-user-id": expectedUserId },
    body: JSON.stringify(body),
  });
}
function storeWith(overrides: Partial<FamilyStore> = {}): FamilyStore {
  return {
    list: async () => [family], invite: async () => ({ invitation, token }), preview: async () => preview,
    accept: async () => undefined, revokeInvite: async () => undefined, setMember: async () => undefined,
    preferences: async () => preferences, savePreferences: async () => ({ ...preferences, version: 1 }),
    ...overrides,
  } as FamilyStore;
}
function recordsWith(overrides: Partial<Records> = {}): Records {
  return { createChildForUser: async () => child, ...overrides };
}
function unusedStore(): FamilyStore {
  return new Proxy({} as FamilyStore, { get() { throw new Error("Unexpected family storage access"); } });
}
function unusedRecords(): Records {
  return new Proxy({} as Records, { get() { throw new Error("Unexpected child storage access"); } });
}

test("family routes reject absent or changed sessions before storage", async () => {
  assert.equal((await handleFamilyRequest(request("/api/families"), null, unusedStore(), unusedRecords())).status, 401);
  const missing = new Request(`http://localhost/api/families/${familyId}/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await handleFamilyRequest(missing, "owner", unusedStore(), unusedRecords())).status, 428);
  const changed = await handleFamilyRequest(request(`/api/families/${familyId}/invitations`, {}, "other"), "owner", unusedStore(), unusedRecords());
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "session_changed");
});

test("family reads and writes use session identity and return fixed route contracts", async () => {
  const calls: unknown[][] = [];
  const store = storeWith({
    list: async userId => { calls.push(["list", userId]); return [family]; },
    preferences: async userId => { calls.push(["preferences", userId]); return preferences; },
    savePreferences: async (userId, values, version) => { calls.push(["savePreferences", userId, values, version]); return { ...values, version: 1 }; },
    invite: async (userId, workspaceId, email, role, version) => { calls.push(["invite", userId, workspaceId, email, role, version]); return { invitation, token }; },
    revokeInvite: async (userId, workspaceId, id, version) => { calls.push(["revokeInvite", userId, workspaceId, id, version]); },
    setMember: async (userId, workspaceId, memberId, role, version) => { calls.push(["setMember", userId, workspaceId, memberId, role, version]); },
    preview: async (userId, value) => { calls.push(["preview", userId, value]); return preview; },
    accept: async (userId, value, workspaceId) => { calls.push(["accept", userId, value, workspaceId]); },
  });
  const records = recordsWith({ createChildForUser: async (userId, input, workspaceId) => {
    calls.push(["createChild", userId, input, workspaceId]); return child;
  } });
  const getFamilies = await handleFamilyRequest(request("/api/families"), "owner", store, records);
  assert.deepEqual(await getFamilies.json(), { families: [family] });
  assert.equal(getFamilies.headers.get("cache-control"), "no-store");
  assert.deepEqual(await (await handleFamilyRequest(request("/api/notification-preferences"), "owner", store, records)).json(), { preferences });
  const preferenceInput = { timeZone: "Asia/Hong_Kong", quietStart: "23:00", quietEnd: "07:00", allowAppointmentDuringQuiet: true, expectedVersion: 0 };
  assert.deepEqual(await (await handleFamilyRequest(request("/api/notification-preferences", preferenceInput), "owner", store, records)).json(),
    { preferences: { timeZone: preferenceInput.timeZone, quietStart: preferenceInput.quietStart, quietEnd: preferenceInput.quietEnd,
      allowAppointmentDuringQuiet: preferenceInput.allowAppointmentDuringQuiet, version: 1 } });
  const invite = await handleFamilyRequest(request(`/api/families/${familyId}/invitations`, { email: " HELPER@example.test ", role: "caregiver", expectedVersion: 2 }), "owner", store, records);
  assert.equal(invite.status, 201);
  assert.deepEqual(await invite.json(), { invitation, token });
  assert.deepEqual(await (await handleFamilyRequest(request(`/api/families/${familyId}/invitations/${inviteId}/revoke`, { expectedVersion: 2 }), "owner", store, records)).json(), { updated: true });
  assert.deepEqual(await (await handleFamilyRequest(request(`/api/families/${familyId}/members/helper`, { role: "revoked", expectedVersion: 2 }), "owner", store, records)).json(), { updated: true });
  assert.deepEqual(await (await handleFamilyRequest(request("/api/families/invitations/preview", { token }), "owner", store, records)).json(), { invitation: preview });
  assert.deepEqual(await (await handleFamilyRequest(request("/api/families/invitations/accept", { token, confirmWorkspaceId: familyId }), "owner", store, records)).json(), { joined: true });
  const created = await handleFamilyRequest(request(`/api/families/${familyId}/children`, { displayName: child.displayName }), "owner", store, records);
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { child });
  assert.deepEqual(calls, [
    ["list", "owner"], ["preferences", "owner"],
    ["savePreferences", "owner", { timeZone: "Asia/Hong_Kong", quietStart: "23:00", quietEnd: "07:00", allowAppointmentDuringQuiet: true }, 0],
    ["invite", "owner", familyId, "HELPER@example.test", "caregiver", 2],
    ["revokeInvite", "owner", familyId, inviteId, 2], ["setMember", "owner", familyId, "helper", "revoked", 2],
    ["preview", "owner", token], ["accept", "owner", token, familyId],
    ["createChild", "owner", { displayName: child.displayName }, familyId],
  ]);
});

test("family routes reject unknown fields, invalid roles, identifiers, tokens and quiet hours", async () => {
  const invalid: [string, unknown][] = [
    [`/api/families/${familyId}/invitations`, { email: "helper@example.test", role: "owner", expectedVersion: 2 }],
    [`/api/families/${familyId}/invitations`, { email: "helper@example.test", role: "viewer", expectedVersion: 2, userId: "forged" }],
    [`/api/families/${familyId}/members/helper`, { role: "owner", expectedVersion: 2 }],
    [`/api/families/${familyId}/members/helper`, { role: "viewer", expectedVersion: 0 }],
    ["/api/families/invitations/preview", { token: "short" }],
    ["/api/families/invitations/accept", { token, confirmWorkspaceId: "wrong-id" }],
    ["/api/notification-preferences", { ...preferences, expectedVersion: 0 }],
    ["/api/notification-preferences", { timeZone: "Invalid/Zone", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, expectedVersion: 0 }],
    ["/api/notification-preferences", { timeZone: "Asia/Hong_Kong", quietStart: "24:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, expectedVersion: 0 }],
    ["/api/notification-preferences", { timeZone: "Asia/Hong_Kong", quietStart: "08:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, expectedVersion: 0 }],
    [`/api/families/${familyId}/children`, { displayName: child.displayName, ownerUserId: "forged" }],
  ];
  for (const [path, body] of invalid) {
    const response = await handleFamilyRequest(request(path, body), "owner", unusedStore(), unusedRecords());
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error.code, "invalid_input");
  }
  assert.equal((await handleFamilyRequest(request("/api/families/not-a-uuid/invitations", { email: "helper@example.test", role: "viewer", expectedVersion: 2 }), "owner", unusedStore(), unusedRecords())).status, 404);
  assert.equal((await handleFamilyRequest(request(`/api/families/${familyId}/invitations/not-a-uuid/revoke`, { expectedVersion: 2 }), "owner", unusedStore(), unusedRecords())).status, 404);
});

test("family store access and conflict errors have fixed safe messages", async () => {
  const hidden = await handleFamilyRequest(request("/api/families"), "owner", storeWith({ list: async () => { throw new FamilyError(404, "not_found"); } }), unusedRecords());
  assert.deepEqual(await hidden.json(), { error: { code: "not_found", message: "找不到獲授權資料或輸入無效。" } });
  const conflict = await handleFamilyRequest(request(`/api/families/${familyId}/members/helper`, { role: "viewer", expectedVersion: 2 }), "owner",
    storeWith({ setMember: async () => { throw new FamilyError(409, "version_conflict"); } }), unusedRecords());
  assert.deepEqual(await conflict.json(), { error: { code: "version_conflict", message: "資料或權限已改變，請重新讀取後確認。" } });
});
