import assert from "node:assert/strict";
import test from "node:test";
import { applyFamilyManagement, createFamilyFixtures, createIncomingInvitation, createJoinedFamily } from "../src/preview/family-fixture.ts";

test("synthetic member writes protect the owner, role, scope, and expected version", () => {
  const family = createFamilyFixtures("owner", "Preview parent")[0];
  const draft = { kind: "member", basis: family, scopeConfirmed: true, userId: "preview-caregiver", name: "Preview caregiver", previousRole: "caregiver", role: "viewer" };
  const updated = applyFamilyManagement(family, draft, 1);
  assert.equal(updated.version, 8);
  assert.equal(updated.members.find(member => member.userId === draft.userId).role, "viewer");
  assert.equal(family.version, 7);
  assert.equal(applyFamilyManagement(family, { ...draft, userId: "preview-owner" }, 1), null);
  assert.equal(applyFamilyManagement({ ...family, role: "viewer" }, draft, 1), null);
  assert.equal(applyFamilyManagement(family, { ...draft, scopeConfirmed: false }, 1), null);
  assert.equal(applyFamilyManagement({ ...family, version: 8 }, draft, 1), null);
  assert.equal(applyFamilyManagement(family, { ...draft, role: "revoked" }, 1).members.some(member => member.userId === draft.userId), false);
});

test("synthetic invitation lists never contain codes and only pending invitations can be revoked", () => {
  const family = createFamilyFixtures("owner", "Preview parent")[0];
  const draft = { kind: "invite", basis: family, scopeConfirmed: true, values: { email: "new@example.test", role: "caregiver" } };
  const updated = applyFamilyManagement(family, draft, 1);
  assert.deepEqual(Object.keys(updated.invitations[0]).sort(), ["email", "expiresAt", "id", "role", "status"]);
  assert.equal(updated.invitations[0].email, draft.values.email);
  assert.equal(applyFamilyManagement(updated, { ...draft, basis: updated }, 2), null);
  const revoke = { kind: "revoke", basis: family, scopeConfirmed: true, invitationId: "preview-invite-pending", email: "relative@example.test" };
  assert.equal(applyFamilyManagement(family, revoke, 1).invitations.find(invite => invite.id === revoke.invitationId).status, "revoked");
  assert.equal(applyFamilyManagement(family, { ...revoke, invitationId: "preview-invite-expired" }, 1), null);
  assert.deepEqual(createFamilyFixtures("caregiver", "Preview parent")[0].invitations, []);
  assert.deepEqual(createFamilyFixtures("access_lost", "Preview parent"), []);
});

test("synthetic acceptance requires scope confirmation and rejects expired or revoked invitations", () => {
  const draft = { kind: "accept", invitation: createIncomingInvitation("pending"), scopeConfirmed: true };
  assert.equal(createJoinedFamily(draft, "preview-self").role, "viewer");
  assert.equal(createJoinedFamily({ ...draft, scopeConfirmed: false }, "preview-self"), null);
  for (const status of ["expired", "revoked"]) {
    assert.equal(createJoinedFamily({ ...draft, invitation: createIncomingInvitation(status) }, "preview-self"), null);
  }
});
