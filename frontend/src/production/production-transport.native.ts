import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { createNativeSessionTransport } from "../../../src/client/native-session-transport";
import type { ProductionTransport } from "./production-transport";

export function createProductionTransport(apiBaseUrl: string): ProductionTransport {
  const origin = new URL(apiBaseUrl).origin;
  const key = "yuban.native.session.v1." + encodeURIComponent(origin).replace(/%/g, "_");
  const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const native = createNativeSessionTransport({ apiBaseUrl,
    fetcher: expoFetch as typeof fetch,
    store: { read: () => SecureStore.getItemAsync(key, options), write: value => SecureStore.setItemAsync(key, value, options),
      remove: () => SecureStore.deleteItemAsync(key, options) } });
  return { platform: "native", publicOrigin: origin, fetcher: native.fetcher, nativeSession: native };
}
