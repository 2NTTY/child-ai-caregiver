import { z } from "zod";
import { pushDeliverySchema } from "./web-push.ts";

/** Fixed app identifier; registration never chooses another FCM project or package. */
export const ANDROID_PUSH_PACKAGE = "org.yuyoufang.app";
export const ANDROID_PUSH_CHANNEL = "yuyoufang-reminders";
export const nativePushTokenSchema = z.string().min(20).max(4096).regex(/^[\x21-\x7e]+$/u);
export const nativePushReferenceSchema = z.object({
  v: z.literal(1), kind: z.enum(["test", "care"]), bindingId: z.uuid(),
  bindingVersion: z.number().int().positive(), deliveryId: z.uuid(),
}).strict();
export type NativePushReference = z.infer<typeof nativePushReferenceSchema>;
export const nativePushContent = Object.freeze({
  test: { title: "育有方渠道測試", body: "這是本人 Android 通知測試，沒有孩子資料。" },
  care: { title: "育有方有新的提示", body: "請開啟育有方查看實際事項。收到提示不代表照護事項完成。" },
});

/** FCM string data is untrusted: no URL, account selection or operation command is accepted. */
export function parseNativePushData(raw: unknown): NativePushReference | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !["v", "kind", "bindingId", "bindingVersion", "deliveryId"].includes(key))
    || value.v !== "1" || typeof value.bindingVersion !== "string" || !/^[1-9][0-9]{0,9}$/u.test(value.bindingVersion)) return null;
  const parsed = nativePushReferenceSchema.safeParse({ ...value, v: 1, bindingVersion: Number(value.bindingVersion) });
  return parsed.success ? parsed.data : null;
}

export const nativePushBindingSchema = z.object({
  id: z.uuid(), version: z.number().int().positive(), tokenRevision: z.number().int().positive(),
  status: z.enum(["active", "revoked", "expired"]), label: z.string().max(80),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export type NativePushBinding = z.infer<typeof nativePushBindingSchema>;
export const nativePushRegistrationSchema = z.object({
  token: nativePushTokenSchema, label: z.string().trim().min(1).max(80),
  bindingId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional(),
  expectedTokenRevision: z.number().int().positive().optional(),
}).strict().refine(v => [v.bindingId, v.expectedVersion, v.expectedTokenRevision].filter(x => x !== undefined).length % 3 === 0);
export type NativePushRegistration = z.infer<typeof nativePushRegistrationSchema>;

export const nativePushStatusSchema = z.object({
  userId: z.string().min(1).max(128), available: z.boolean(), workerEnabled: z.boolean(), currentBindingId: z.uuid().nullable(),
  bindings: z.array(nativePushBindingSchema).max(20), deliveries: z.array(pushDeliverySchema).max(20),
  testsRemaining: z.number().int().min(0).max(3), nextTestAt: z.iso.datetime().nullable(),
}).strict();
export type NativePushStatus = z.infer<typeof nativePushStatusSchema>;
