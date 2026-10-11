import type { FamilyRole, FamilySpace, InvitationPreview, MemberRole } from "../../src/shared/family";

// Presentation-only models. Shared family types and Server authorization remain authoritative.
export type { FamilyRole, FamilySpace, MemberRole };
export type FamilyPerspective = FamilyRole | "access_lost";
export type IncomingInvitationCondition = "pending" | "expired" | "revoked";
export type FamilyWriteState = "none" | "needs_confirmation" | "saving" | "saved" | "failed" | "unknown" | "conflict";

export const familyRoleLabels = { owner: "擁有者", caregiver: "照顧者", viewer: "檢視者", revoked: "撤銷權限" } as const;
export const familyScopeText = "加入後可查看這個家庭的全部孩子及共享照顧記錄；不包括其他人的私人 AI 聊天。日後新增到這個家庭的孩子及共享記錄，亦屬同一共享範圍。";
export const familyRoleOptions = [{ value: "caregiver", label: "照顧者" }, { value: "viewer", label: "檢視者" }] as const;

export interface FamilyInviteValues { email: string; role: MemberRole }
export interface IncomingInvitationView extends InvitationPreview { status: IncomingInvitationCondition }
interface DraftBase { basis: FamilySpace; scopeConfirmed: boolean }
export type FamilyManagementDraft =
  | (DraftBase & { kind: "invite"; values: FamilyInviteValues })
  | (DraftBase & { kind: "member"; userId: string; name: string; previousRole: MemberRole; role: MemberRole | "revoked" })
  | (DraftBase & { kind: "revoke"; invitationId: string; email: string });
export type FamilyDraft = FamilyManagementDraft | { kind: "accept"; invitation: IncomingInvitationView; scopeConfirmed: boolean };

export interface FamilyViewModel {
  families: { id: string; ownerName: string; role: FamilyRole; loadedChildNames?: readonly string[] }[];
  family: FamilySpace | null;
  selfUserId: string;
  children: { id: string; displayName: string; ageLabel: string }[];
  online: boolean;
  loadState: "ready" | "loading" | "lost";
  canManage: boolean;
  canStartAction: boolean;
  locked: boolean;
  draft: FamilyDraft | null;
  latest: FamilySpace | null;
  incoming: IncomingInvitationView | null;
  incomingError: string | null;
  oneTimeCode: string | null;
  inviteFormKey: number;
  operation: { state: FamilyWriteState; message: string; reference: string | null };
  notice: string | null;
}

export interface FamilyActions {
  selectFamily(id: string): void;
  refresh(): void;
  editInvite(): void;
  reviewInvite(values: FamilyInviteValues): void;
  stageMember(userId: string, role: MemberRole | "revoked"): void;
  stageRevokeInvitation(id: string): void;
  editIncoming(): void;
  previewIncoming(code: string): void;
  stageAccept(): void;
  confirmScope(checked: boolean): void;
  reviewCurrent(): void;
  submit(): void;
  // Runs synchronously only after the local cancellation guard accepts cleanup.
  cancel(onCancelled?: () => void): void;
  useLatest(): void;
  dismissCode(): void;
  openProfile(): void;
}
