import type { ContactAttempt, ContactGrant, ContactRequest } from "../../contact-view-model";
import type { AppStatusTone } from "../AppStatusBadge";

export const contactRequestTones: Record<ContactRequest["state"], AppStatusTone> = {
  pending: "warning", accepted: "info", rejected: "error", unknown: "warning", stopped: "neutral", coalesced: "neutral",
};
export const contactAttemptTones: Record<ContactAttempt["status"], AppStatusTone> = {
  sending: "info", accepted: "info", rejected: "error", unknown: "warning", stopped: "neutral",
};
export function contactGrantStatus(grant: ContactGrant | undefined, taskVersion: number, now = Date.now()): { label: string; tone: AppStatusTone } {
  if (!grant) return { label: "尚無已保存授權", tone: "neutral" };
  if (!grant.enabled) return { label: "已撤回授權", tone: "neutral" };
  const until = Date.parse(grant.validUntil);
  if (!Number.isFinite(until) || until <= now || grant.taskVersion !== taskVersion) return { label: "授權期限或任務版本待更新", tone: "warning" };
  return { label: "已有保存授權，請核對範圍", tone: "info" };
}
