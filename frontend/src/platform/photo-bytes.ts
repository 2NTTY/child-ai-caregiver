import { sha256Bytes } from "../../../src/client/blob-bytes";
export const photoSha256 = sha256Bytes;
export function photoPreview(bytes: Uint8Array<ArrayBuffer>, mimeType: string) {
  const uri = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  return { uri, dispose: () => URL.revokeObjectURL(uri) };
}
