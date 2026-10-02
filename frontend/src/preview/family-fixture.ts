import type { FamilyDraft, FamilyManagementDraft, FamilyPerspective, FamilySpace, IncomingInvitationCondition, IncomingInvitationView } from "../family-view-model";

export const syntheticIncomingCode = "PREVIEW-ONLY-INVALID-INCOMING";
export const previewSelfIds = { owner: "preview-owner", caregiver: "preview-caregiver", viewer: "preview-viewer", access_lost: "preview-owner" } as const;

export function createFamilyFixtures(perspective: FamilyPerspective, ownerName: string): FamilySpace[] {
  if (perspective === "access_lost") return [];
  return [{
    id: "preview-family-home", ownerName, role: perspective, version: 7,
    members: [
      { userId: "preview-owner", name: `${ownerName}（合成）`, role: "owner" },
      { userId: "preview-caregiver", name: "陳爸爸（合成）", role: "caregiver" },
      { userId: "preview-viewer", name: "陳婆婆（合成）", role: "viewer" },
    ],
    invitations: perspective === "owner" ? [
      { id: "preview-invite-pending", email: "relative@example.test", role: "caregiver", expiresAt: "2026-10-06T12:00:00+08:00", status: "pending" },
      { id: "preview-invite-expired", email: "expired@example.test", role: "viewer", expiresAt: "2026-09-20T12:00:00+08:00", status: "expired" },
      { id: "preview-invite-revoked", email: "revoked@example.test", role: "viewer", expiresAt: "2026-10-06T12:00:00+08:00", status: "revoked" },
    ] : [],
  }];
}

export function createIncomingInvitation(status: IncomingInvitationCondition): IncomingInvitationView {
  return { workspaceId: "preview-family-joined", ownerName: "林姨姨（合成）", role: "viewer", expiresAt: status === "expired" ? "2026-09-20T12:00:00+08:00" : "2026-10-06T12:00:00+08:00", status };
}

export function applyFamilyManagement(family: FamilySpace, draft: FamilyManagementDraft, serial: number): FamilySpace | null {
  if (family.role !== "owner" || draft.basis.id !== family.id || draft.basis.version !== family.version || !draft.scopeConfirmed) return null;
  if (draft.kind === "member") {
    const target = family.members.find(member => member.userId === draft.userId);
    if (!target || target.role === "owner") return null;
    return { ...family, version: family.version + 1, members: draft.role === "revoked"
      ? family.members.filter(member => member.userId !== draft.userId)
      : family.members.map(member => member.userId === draft.userId ? { ...member, role: draft.role as "caregiver" | "viewer" } : member) };
  }
  if (draft.kind === "revoke") {
    if (!family.invitations.some(invite => invite.id === draft.invitationId && invite.status === "pending")) return null;
    return { ...family, version: family.version + 1, invitations: family.invitations.map(invite => invite.id === draft.invitationId ? { ...invite, status: "revoked" } : invite) };
  }
  const pending = family.invitations.filter(invite => invite.status === "pending");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.values.email) || pending.length >= 20 || pending.some(invite => invite.email.toLowerCase() === draft.values.email.toLowerCase())) return null;
  return { ...family, version: family.version + 1, invitations: [{ id: `preview-invite-created-${serial}`, email: draft.values.email, role: draft.values.role, expiresAt: "2026-10-06T12:00:00+08:00", status: "pending" }, ...family.invitations] };
}

export function createJoinedFamily(draft: Extract<FamilyDraft, { kind: "accept" }>, selfUserId: string): FamilySpace | null {
  if (!draft.scopeConfirmed || draft.invitation.status !== "pending") return null;
  return { id: draft.invitation.workspaceId, ownerName: draft.invitation.ownerName, role: draft.invitation.role, version: 2,
    members: [{ userId: "preview-joined-owner", name: draft.invitation.ownerName, role: "owner" }, { userId: selfUserId, name: "本人（合成）", role: draft.invitation.role }], invitations: [] };
}

export function createLatestFamily(family: FamilySpace, draft: FamilyDraft): FamilySpace {
  const changed = family.members.find(member => member.role !== "owner" && (draft.kind !== "member" || member.userId !== draft.userId));
  return { ...family, version: family.version + 1, members: family.members.map(member => member.userId === changed?.userId ? { ...member, role: member.role === "viewer" ? "caregiver" : "viewer" } : member) };
}
