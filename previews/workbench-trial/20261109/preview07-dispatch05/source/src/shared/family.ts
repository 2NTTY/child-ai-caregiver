export type FamilyRole = "owner" | "caregiver" | "viewer";
export type MemberRole = Exclude<FamilyRole, "owner">;
export interface FamilyMember { userId: string; name: string; role: FamilyRole }
export interface FamilyInvitation { id: string; email: string; role: MemberRole; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" }
export interface FamilySpace {
  id: string; ownerName: string; role: FamilyRole; version: number;
  members: FamilyMember[]; invitations: FamilyInvitation[];
}
export interface InvitationPreview { workspaceId: string; ownerName: string; role: MemberRole; expiresAt: string }
export interface NotificationPreferences {
  timeZone: string; quietStart: string; quietEnd: string; allowAppointmentDuringQuiet: boolean; version: number;
}
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  timeZone: "Asia/Hong_Kong", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, version: 0,
};
