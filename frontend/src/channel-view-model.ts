// Presentation projections of the reviewed S13-W05/W06 contracts, not HTTP payloads.
export type ChannelReadState = "ready" | "loading" | "failed" | "session_changed";
export type ChannelPermission = "default" | "granted" | "denied" | "unsupported";
export type ChannelDeliveryState = "queued" | "sending" | "accepted" | "rejected" | "unknown" | "stopped";
interface ChannelDeliveryBase {
  id: string; bindingId: string; label: string; status: ChannelDeliveryState;
  reasonLabel: string | null; createdAt: string;
}
export type PushDeliveryView = ChannelDeliveryBase;
export interface TelegramDeliveryView extends ChannelDeliveryBase { acknowledgedAt: string | null }
export type ChannelDeliveryView = PushDeliveryView | TelegramDeliveryView;
export interface ChannelReview {
  kind: "enable" | "begin" | "confirm" | "revoke" | "test";
  targetLabel: string; expectedVersion: number | null; confirmed: boolean;
}
interface ChannelSettingsBase {
  online: boolean; readState: ChannelReadState; locked: boolean; conflict: boolean;
  notice: string | null; workerEnabled: boolean; review: ChannelReview | null;
}
export interface PushBindingView {
  id: string; version: number; label: string; status: "active" | "revoked" | "expired";
  providerLabel: string; expiresAt: string | null;
}
export interface PushSettingsModel extends ChannelSettingsBase {
  platform?: "web" | "android";
  available: boolean; browserSupported: boolean; permission: ChannelPermission;
  currentBindingId: string | null; bindings: PushBindingView[];
  deliveries: PushDeliveryView[]; testsRemaining: number; nextTestAt: string | null;
}
interface ChannelReviewActions {
  refresh(): void; confirmReview(checked: boolean): void;
  submit(): void; cancel(): void; useLatest(): void;
}
export interface PushSettingsActions extends ChannelReviewActions {
  stageEnable(label: string): void; stageRevoke(id: string): void; stageTest(id: string): void;
}
export interface TelegramBindingView {
  id: string; version: number; label: string; chatIdHint: string;
  status: "active" | "revoked" | "blocked";
}
export interface TelegramChallengeView {
  id: string; version: number; state: "waiting" | "seen"; expiresAt: string;
  candidate: { label: string; chatIdHint: string } | null;
}
export interface TelegramSettingsModel extends ChannelSettingsBase {
  configured: boolean; binding: TelegramBindingView | null;
  challenge: TelegramChallengeView | null; deliveries: TelegramDeliveryView[];
}
export interface TelegramSettingsActions extends ChannelReviewActions {
  stageBegin(): void; stageConfirm(): void; stageRevoke(): void; stageTest(): void;
  openStartLink(): void;
}

export const channelDeliveryLabels: Record<ChannelDeliveryState, string> = {
  queued: "排隊中", sending: "正在嘗試發送", accepted: "渠道已接受",
  rejected: "渠道已拒絕", unknown: "投遞結果未知", stopped: "已停止",
};
export function channelTime(value: string): string {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function pushTestAllowed(
  status: Pick<PushSettingsModel, "available" | "workerEnabled" | "testsRemaining" | "nextTestAt">,
  binding: PushBindingView | null, now = Date.now(),
): boolean {
  return status.available && status.workerEnabled && status.testsRemaining > 0
    && (status.nextTestAt === null || Date.parse(status.nextTestAt) <= now)
    && binding?.status === "active";
}
export function pushDeliveryNeedsReview(deliveries: PushDeliveryView[], bindingId: string): boolean {
  return deliveries.some(item => item.bindingId === bindingId &&
    (item.status === "queued" || item.status === "sending" || item.status === "unknown"));
}
export function telegramBeginAllowed(status: Pick<TelegramSettingsModel, "configured" | "binding" | "challenge">): boolean {
  return status.configured && (!status.binding || status.binding.status === "revoked");
}
export function blocksAnotherTelegramTest(deliveries: TelegramDeliveryView[], bindingId: string): boolean {
  return deliveries.some(item => item.bindingId === bindingId &&
    (item.status === "queued" || item.status === "sending" || item.status === "unknown" && item.acknowledgedAt === null));
}
