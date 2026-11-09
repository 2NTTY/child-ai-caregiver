import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import { fromByteArray } from "base64-js";
export async function photoSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function photoPreview(bytes: Uint8Array<ArrayBuffer>, mimeType: string) {
  // Bounded, in-memory preview; no private original is written to a second store.
  return { uri: `data:${mimeType};base64,${fromByteArray(bytes)}`, dispose: () => {} };
}
