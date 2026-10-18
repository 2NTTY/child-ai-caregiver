import { z } from "zod";

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
