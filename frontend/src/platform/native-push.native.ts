import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { ANDROID_PUSH_CHANNEL, nativePushTokenSchema, parseNativePushData } from "../../../src/shared/native-push.ts";
import type { NativePushEvents, NativePushPermission } from "./native-push.ts";

export const nativePushSupported = () => Platform.OS === "android";
export async function nativePushPermission(): Promise<NativePushPermission> {
  if (!nativePushSupported()) return "unavailable";
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted ? "granted" : permission.canAskAgain ? "undetermined" : "denied";
}
/** Call only from the explicit enable action. Token retrieval grants no product contact authority. */
export async function requestNativePushToken(): Promise<string> {
  if (!nativePushSupported()) throw new Error("native_push_unavailable");
  await Notifications.setNotificationChannelAsync(ANDROID_PUSH_CHANNEL, {
    name: "育有方本人提示", importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("native_push_permission_denied");
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== "android") throw new Error("native_push_token_invalid");
  return nativePushTokenSchema.parse(token.data);
}
/** The owner must reauthorize this opaque reference with the Server before navigation. */
export function listenNativePush(events: NativePushEvents): () => void {
  if (!nativePushSupported()) return () => {};
  let active = true;
  const seen = new Set<string>();
  const open = (response: Notifications.NotificationResponse) => {
    if (!active || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const reference = parseNativePushData(response.notification.request.content.data);
    if (!reference || seen.has(reference.deliveryId)) return;
    if (seen.size >= 20) seen.delete(seen.values().next().value!);
    seen.add(reference.deliveryId); events.opened(reference);
  };
  const tokens = Notifications.addPushTokenListener(token => {
    if (!active || token.type !== "android") return;
    const checked = nativePushTokenSchema.safeParse(token.data);
    // Never call getDevicePushTokenAsync in this callback: Expo would trigger it again.
    if (checked.success) events.tokenChanged(checked.data);
  });
  const responses = Notifications.addNotificationResponseReceivedListener(open);
  const initial = Notifications.getLastNotificationResponse();
  if (initial) queueMicrotask(() => open(initial));
  return () => { active = false; seen.clear(); tokens.remove(); responses.remove(); };
}
export function clearNativePushOpen(): void {
  if (nativePushSupported()) Notifications.clearLastNotificationResponse();
}
