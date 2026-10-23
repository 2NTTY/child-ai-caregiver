import type { NotificationMessageContent } from '../src/shared/notification-messages.ts';
import type { PoolClient } from "pg";
import type { WebPushSubscription, PushPayload, PushDelivery } from "../src/shared/web-push.ts";

export const WEB_PUSH_QUEUE = "web-push-delivery-v1";
export const WEB_PUSH_JOB_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 90, retryLimit: 1, retryDelay: 5,
  retryBackoff: false, retentionSeconds: 86400, deleteAfterSeconds: 7 * 86400 };
export interface VapidConfig { publicKey: string; privateKey: string; subject: string }
export interface WebPushQueue { enqueue(client: PoolClient, deliveryId: string): Promise<void> }
export interface PushSendResult {
  status: "accepted" | "rejected" | "unknown" | "stopped";
  reason: PushDelivery["reason"];
  providerStatus: number | null;
  message?: NotificationMessageContent;
}
export interface WebPushGateway {
  publicKey: string | null;
  send(subscription: WebPushSubscription, payload: PushPayload, signal: AbortSignal,
    stillAuthorized: () => Promise<boolean>): Promise<PushSendResult>;
}
