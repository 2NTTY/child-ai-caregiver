import type { NativePushPlatform, NativePushReference } from "../../../src/shared/native-push.ts";
export type NativePushPermission = "granted" | "denied" | "undetermined" | "unavailable";
export interface NativePushEvents {
  tokenChanged(token: string): void;
  opened(reference: NativePushReference): void;
}
export const nativePushSupported = () => false;
export const nativePushPlatform = (): NativePushPlatform | null => null;
export async function nativePushPermission(): Promise<NativePushPermission> { return "unavailable"; }
export async function requestNativePushToken(): Promise<string> { throw new Error("native_push_unavailable"); }
export function listenNativePush(_events: NativePushEvents): () => void { return () => {}; }
export function clearNativePushOpen(): void {}
