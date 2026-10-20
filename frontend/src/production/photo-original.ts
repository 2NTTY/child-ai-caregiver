import { fromByteArray, toByteArray } from "base64-js";
import { PHOTO_LIMITS, photoMetadataSchema } from "../../../src/shared/photos";
import type { PhotoOriginal } from "../photo-view-model";
import { photoPreview, photoSha256 } from "../platform/photo-bytes";

export async function photoOriginalFromBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string, mimeType: string): Promise<PhotoOriginal> {
  if (!bytes.length || bytes.length > PHOTO_LIMITS.bytes || !["image/jpeg", "image/png"].includes(mimeType)) throw new Error("Unsupported photo");
  const hash = await photoSha256(bytes);
  const metadata = photoMetadataSchema.parse({ fileName, mimeType, bytes: bytes.length, sha256: hash, source: "照片" });
  const preview = photoPreview(bytes, mimeType);
  let encoded: string | null = fromByteArray(bytes);
  return { fileName: metadata.fileName, mimeType: metadata.mimeType, bytes: metadata.bytes, sha256: hash, imageSource: { uri: preview.uri },
    readBase64: async () => { if (encoded === null) throw new Error("Original released"); return encoded; },
    dispose: () => { encoded = null; preview.dispose(); } };
}
export async function copyPhotoOriginal(original: PhotoOriginal): Promise<PhotoOriginal> {
  if (!original.readBase64) throw new Error("Original unavailable");
  const encoded = await original.readBase64();
  if (encoded.length > Math.ceil(PHOTO_LIMITS.bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw new Error("Invalid original");
  const copy = await photoOriginalFromBytes(new Uint8Array(toByteArray(encoded)), original.fileName, original.mimeType);
  if (copy.bytes !== original.bytes || copy.sha256 !== original.sha256) { copy.dispose?.(); throw new Error("Original changed"); }
  return copy;
}
