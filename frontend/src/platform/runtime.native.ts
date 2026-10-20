import { getRandomValues, randomUUID } from "expo-crypto";

// Supply only the secure-random methods used by shared operation IDs and Firebase.
// Never replace an existing implementation or fall back to Math.random.
const runtimeCrypto = globalThis.crypto ?? {};
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: runtimeCrypto, configurable: true });
if (typeof runtimeCrypto.randomUUID !== "function") Object.defineProperty(runtimeCrypto, "randomUUID", { value: randomUUID });
if (typeof runtimeCrypto.getRandomValues !== "function") Object.defineProperty(runtimeCrypto, "getRandomValues", { value: getRandomValues });
