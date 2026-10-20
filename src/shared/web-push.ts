import { z } from "zod";

const uuid = z.uuid().transform(value => value.toLowerCase());
const instant = z.iso.datetime();
export const pushSubscriptionInput = z.object({
  endpoint: z.string().min(1).max(2048),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict(),
  expirationTime: z.number().finite().int().positive().nullable(),
}).strict();
export type WebPushSubscription = z.infer<typeof pushSubscriptionInput>;
export const pushRegistrationInput = z.object({ subscription: pushSubscriptionInput, label: z.string().trim().min(1).max(80) }).strict();
export type PushRegistrationInput = z.infer<typeof pushRegistrationInput>;
export const pushVersionInput = z.object({ expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
export const pushTestInput = pushVersionInput.extend({ confirmImmediate: z.literal(true) }).strict();
export const pushBindingSchema = z.object({
  id: uuid, version: z.number().int().positive(), status: z.enum(["active", "revoked", "expired"]),
  provider: z.enum(["fcm", "mozilla"]), label: z.string().max(80),
  endpointHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), vapidPublicKey: z.string(),
  expiresAt: instant.nullable(), createdAt: instant, updatedAt: instant,
}).strict();
export type PushBinding = z.infer<typeof pushBindingSchema>;
export const pushDeliverySchema = z.object({
  id: uuid, bindingId: uuid, status: z.enum(["queued", "sending", "accepted", "rejected", "unknown", "stopped"]),
  reason: z.enum(["subscription_expired", "provider_rejected", "rate_limited", "transport_unknown", "revoked",
    "worker_paused", "configuration_unavailable", "request_invalid", "worker_interrupted", "local_preview_not_sent"]).nullable(),
  providerStatus: z.number().int().min(100).max(599).nullable(), createdAt: instant,
  attemptedAt: instant.nullable(), finishedAt: instant.nullable(),
}).strict();
export type PushDelivery = z.infer<typeof pushDeliverySchema>;
export const webPushStatusSchema = z.object({
  userId: z.string().min(1).max(128), available: z.boolean(), workerEnabled: z.boolean(),
  publicKey: z.string().nullable(), supportedProviders: z.array(z.enum(["fcm", "mozilla"])),
  bindings: z.array(pushBindingSchema).max(20), deliveries: z.array(pushDeliverySchema).max(20),
  testsRemaining: z.number().int().min(0).max(3), nextTestAt: instant.nullable(),
}).strict();
export type WebPushStatus = z.infer<typeof webPushStatusSchema>;
/** Fixed, non-sensitive wake-up reference. Never include family/chat text or a navigation URL. */
export interface PushPayload { v: 1; kind?: "test" | "care"; bindingId: string; bindingVersion: number; deliveryId: string }
export interface PushBrowserBinding { userId: string; id: string; version: number }
