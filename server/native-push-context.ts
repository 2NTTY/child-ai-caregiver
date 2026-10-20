import type { DeviceSessionKey } from "./firestore-device-sessions.ts";
/** Server-created identity proof, never parsed from a mutation payload. */
export interface NativeRequestContext { nativeSession: DeviceSessionKey | null }
