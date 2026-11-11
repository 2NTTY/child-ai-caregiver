import { z } from "zod";
import { taskTimeZoneSchema } from "./tasks.ts";

export type FamilyRole = "owner" | "caregiver" | "viewer";
export type MemberRole = Exclude<FamilyRole, "owner">;
export interface FamilyMember { userId: string; name: string; role: FamilyRole }
export interface FamilyInvitation { id: string; email: string; role: MemberRole; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" }
export interface FamilySpace {
  id: string; ownerName: string; role: FamilyRole; version: number;
  members: FamilyMember[]; invitations: FamilyInvitation[];
}
export interface InvitationPreview { workspaceId: string; ownerName: string; role: MemberRole; expiresAt: string }
const clockTime = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u);
export const notificationPreferencesSchema = z.object({
  timeZone: taskTimeZoneSchema, quietStart: clockTime, quietEnd: clockTime,
  allowAppointmentDuringQuiet: z.boolean(), version: z.number().int().nonnegative().max(2147483647),
}).strict();
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  timeZone: "Asia/Hong_Kong", quietStart: "22:00", quietEnd: "08:00", allowAppointmentDuringQuiet: false, version: 0,
};
