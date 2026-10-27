import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { ANDROID_PUSH_CHANNEL, apnsPushTokenSchema, nativePushTokenSchema, parseNativePushData, type NativePushPlatform } from "../../../src/shared/native-push.ts";
import type { NativePushEvents, NativePushPermission } from "./native-push.ts";

// Only fixed product references may display a foreground preview; no payload action is executed.
if (Platform.OS === "android" || Platform.OS === "ios") Notifications.setNotificationHandler({ handleNotification: async notification => {
  const visible = parseNativePushData(notification.request.content.data) !== null;
  return { shouldShowBanner: visible, shouldShowList: visible, shouldPlaySound: false, shouldSetBadge: false };
} });
export const nativePushPlatform = (): NativePushPlatform | null => Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : null;
export const nativePushSupported = () => nativePushPlatform() !== null;
function granted(permission: Notifications.NotificationPermissionsStatus): boolean {
  return permission.granted || Platform.OS === "ios" && (permission.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED
    || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    || permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL);
}
export async function nativePushPermission(): Promise<NativePushPermission> {
  if (!nativePushSupported()) return "unavailable";
  const permission = await Notifications.getPermissionsAsync();
  return granted(permission) ? "granted" : permission.ios?.status === Notifications.IosAuthorizationStatus.DENIED || !permission.canAskAgain ? "denied" : "undetermined";
}
/** Call only from the explicit enable action. Token retrieval grants no product contact authority. */
export async function requestNativePushToken(): Promise<string> {
  if (!nativePushSupported()) throw new Error("native_push_unavailable");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(ANDROID_PUSH_CHANNEL, {
    name: "育有方本人提示", importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  const existing = await Notifications.getPermissionsAsync();
  const denied = existing.ios?.status === Notifications.IosAuthorizationStatus.DENIED || !existing.canAskAgain;
  const permission = granted(existing) || denied ? existing : await Notifications.requestPermissionsAsync();
  if (!granted(permission)) throw new Error("native_push_permission_denied");
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== Platform.OS) throw new Error("native_push_token_invalid");
  return (Platform.OS === "ios" ? apnsPushTokenSchema : nativePushTokenSchema).parse(token.data);
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
    if (!active || token.type !== Platform.OS) return;
    const checked = (Platform.OS === "ios" ? apnsPushTokenSchema : nativePushTokenSchema).safeParse(token.data);
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
