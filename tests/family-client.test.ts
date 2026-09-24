import assert from "node:assert/strict";
import test from "node:test";
import { createFamilyApi, FamilyApiError } from "../src/client/family-api.ts";

const signal = () => new AbortController().signal;
const family = {
  id: "family-1", ownerName: "家長", role: "owner", version: 3,
  members: [{ userId: "alice", name: "家長", role: "owner" }], invitations: [],
};
const preferences = { timeZone: "Asia/Hong_Kong", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, version: 2 };
const invitation = { id: "invite-1", email: "helper@example.test", role: "caregiver", expiresAt: "2026-10-01T00:00:00.000Z", status: "pending" };
const preview = { workspaceId: family.id, ownerName: family.ownerName, role: "viewer", expiresAt: invitation.expiresAt };
const child = { id: "child-1", workspaceId: family.id, displayName: "小朋友", createdAt: "2026-09-24T00:00:00.000Z" };

test("family client uses cookie credentials, no-store and an account header for every write", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const responses: Record<string, unknown> = {
    "/auth/get-session": { user: { id: "alice", name: "家長", email: "alice@example.test" }, session: { token: "private" } },
    "/families": { families: [family] },
    "/notification-preferences": { preferences },
    "/families/family-1/invitations": { invitation, token: "one-time-secret" },
    "/families/family-1/invitations/invite-1/revoke": { updated: true },
    "/families/family-1/members/bob": { updated: true },
    "/families/invitations/preview": { invitation: preview },
    "/families/invitations/accept": { joined: true },
    "/families/family-1/children": { child },
  };
  const api = createFamilyApi("http://localhost:3001", async (input, init) => {
    const path = new URL(String(input)).pathname.replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), method === "POST" ? "alice" : null);
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(responses[path]);
  });
  assert.equal(await api.getSession(signal()), "alice");
  assert.deepEqual(await api.listFamilies(signal()), [family]);
  assert.deepEqual(await api.getPreferences(signal()), preferences);
  const preferenceInput = { timeZone: preferences.timeZone, quietStart: preferences.quietStart, quietEnd: preferences.quietEnd, allowAppointmentDuringQuiet: preferences.allowAppointmentDuringQuiet, expectedVersion: 2 };
  assert.deepEqual(await api.savePreferences(preferenceInput, signal(), "alice"), preferences);
  assert.deepEqual(await api.createInvitation(family.id, invitation.email, "caregiver", 3, signal(), "alice"), { invitation, token: "one-time-secret" });
  await api.revokeInvitation(family.id, invitation.id, 3, signal(), "alice");
  await api.changeMember(family.id, "bob", "viewer", 3, signal(), "alice");
  assert.deepEqual(await api.previewInvitation("one-time-secret", signal(), "alice"), preview);
  await api.acceptInvitation("one-time-secret", family.id, signal(), "alice");
  assert.deepEqual(await api.createChild(family.id, child.displayName, signal(), "alice"), child);
  assert.deepEqual(calls.slice(3).map(item => [item.path, item.body]), [
    ["/notification-preferences", preferenceInput],
    ["/families/family-1/invitations", { email: invitation.email, role: "caregiver", expectedVersion: 3 }],
    ["/families/family-1/invitations/invite-1/revoke", { expectedVersion: 3 }],
    ["/families/family-1/members/bob", { role: "viewer", expectedVersion: 3 }],
    ["/families/invitations/preview", { token: "one-time-secret" }],
    ["/families/invitations/accept", { token: "one-time-secret", confirmWorkspaceId: family.id }],
    ["/families/family-1/children", { displayName: child.displayName }],
  ]);
});

test("family client rejects malformed payloads and hides remote error details", async () => {
  for (const payload of [{ families: [{ ...family, members: [{ userId: "alice", name: "家長", role: "admin" }] }] }, { families: "private" }]) {
    await assert.rejects(createFamilyApi("/api", async () => Response.json(payload)).listFamilies(signal()), FamilyApiError);
  }
  await assert.rejects(createFamilyApi("/api", async () => Response.json({ child: { ...child, workspaceId: "another-family" } }))
    .createChild(family.id, child.displayName, signal(), "alice"), FamilyApiError);
  for (const status of [401, 403, 409, 500]) {
    await assert.rejects(createFamilyApi("/api", async () => new Response("PRIVATE DETAIL", { status })).listFamilies(signal()), error =>
      error instanceof FamilyApiError && error.status === status && !error.message.includes("PRIVATE"));
  }
  await assert.rejects(createFamilyApi("/api", async () => { throw new Error("PRIVATE NETWORK DETAIL"); }).listFamilies(signal()), error =>
    error instanceof FamilyApiError && error.status === 0 && !error.message.includes("PRIVATE"));
});
