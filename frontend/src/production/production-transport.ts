import type { NativeSessionExchange } from "../../../src/client/native-session-transport";
export interface ProductionTransport {
  platform: "web" | "native";
  publicOrigin: string;
  fetcher: typeof fetch;
  nativeSession?: NativeSessionExchange;
}
export function createProductionTransport(_apiBaseUrl: string): ProductionTransport {
  return { platform: "web", publicOrigin: typeof window === "undefined" ? "" : window.location.origin,
    fetcher: (...args) => fetch(...args) };
}
