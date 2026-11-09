import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Platform } from "react-native";
import { toByteArray } from "base64-js";
import { PHOTO_LIMITS } from "../../../../src/shared/photos";
import { photoOriginalFromBytes } from "../../production/photo-original";
import type { PhotoOriginal } from "../../photo-view-model";

function photoMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "" {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? "image/png" : "";
}

function jpegCopy(encoded: string | null | undefined): Uint8Array<ArrayBuffer> {
  if (!encoded || encoded.length > Math.ceil(PHOTO_LIMITS.bytes / 3) * 4 || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error("Invalid JPEG copy");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const size = encoded.length / 4 * 3 - padding;
  if (size <= 0 || size > PHOTO_LIMITS.bytes) throw new Error("Photo exceeds limit");
  const bytes = new Uint8Array(toByteArray(encoded));
  if (bytes.length !== size || bytes.length > PHOTO_LIMITS.bytes || photoMime(bytes) !== "image/jpeg") throw new Error("Invalid JPEG copy");
  return bytes;
}

async function pickPhoto(camera: boolean): Promise<PhotoOriginal | null> {
  if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("Camera permission denied");
  const ios = Platform.OS === "ios";
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false,
    base64: ios, exif: false, quality: 1,
    ...(ios ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible } : {}) };
  const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error("Photo unavailable");
  let bytes: Uint8Array<ArrayBuffer>, mime: ReturnType<typeof photoMime>;
  try {
    if (!asset.uri.startsWith("file://")) throw new Error("Photo unavailable");
    const file = new File(asset.uri);
    if (!file.exists || file.size <= 0 || file.size > PHOTO_LIMITS.bytes) throw new Error("Photo exceeds limit");
    bytes = await file.bytes();
    if (!bytes.length || bytes.length > PHOTO_LIMITS.bytes) throw new Error("Photo exceeds limit");
    // Prefer actual JPEG/PNG bytes. iOS can retain HEIC even in compatible mode.
    mime = photoMime(bytes);
    if (!mime && ios) { bytes = jpegCopy(asset.base64); mime = "image/jpeg"; }
    if (!mime) throw new Error("Only JPEG and PNG photos are supported");
  } finally {
    // The returned original owns its encoded copy; release the picker's extra allocation.
    asset.base64 = null;
  }
  let name = (asset.fileName || `photo.${mime === "image/png" ? "png" : "jpg"}`).replace(/[\/\\\u0000-\u001f]/gu, "_").slice(0, 200);
  if (ios) name = `${(name.replace(/\.[^.]*$/u, "") || "photo").slice(0, 196)}.${mime === "image/png" ? "png" : "jpg"}`;
  // Do not delete the system picker source or copy it into a persistent business cache.
  return await photoOriginalFromBytes(bytes, name, mime);
}
export const selectNativePhoto = () => pickPhoto(false);
export const captureNativePhoto = () => pickPhoto(true);
