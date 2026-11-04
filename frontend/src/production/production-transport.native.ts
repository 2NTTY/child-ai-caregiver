import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { createNativeSessionTransport } from "../../../src/client/native-session-transport";
import type { ProductionTransport } from "./production-transport";
import { packageCacheBodyPath } from "../platform/package-cache-body.native";

export function createProductionTransport(apiBaseUrl: string): ProductionTransport {
  const origin = new URL(apiBaseUrl).origin;
  const key = "yuban.native.session.v1." + encodeURIComponent(origin).replace(/%/g, "_");
  const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const fetcher: typeof fetch = (input, init) => {
    if (init && 'cacheFileBody' in init) throw new Error('invalid_package_file');
    const path = packageCacheBodyPath(init?.body);
    if (path === null) return (expoFetch as typeof fetch)(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== origin || url.search || url.hash || init?.method !== 'POST'
      || !/^\/api\/account\/package-uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/u.test(url.pathname)
      || init.credentials !== 'omit' || init.redirect !== 'error' || new Headers(init.headers).get('content-type') !== 'application/zip')
      throw new Error('invalid_package_file');
    const prepared = { ...init, body: null, cacheFileBody: path };
    return (expoFetch as typeof fetch)(url.href, prepared);
  };
  const native = createNativeSessionTransport({ apiBaseUrl,
    fetcher,
    store: { read: () => SecureStore.getItemAsync(key, options), write: value => SecureStore.setItemAsync(key, value, options),
      remove: () => SecureStore.deleteItemAsync(key, options) } });
  return { platform: "native", publicOrigin: origin, fetcher: native.fetcher, nativeSession: native };
}
