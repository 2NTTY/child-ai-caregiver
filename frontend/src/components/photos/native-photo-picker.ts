import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { PHOTO_LIMITS } from "../../../../src/shared/photos";
import { photoOriginalFromBytes } from "../../production/photo-original";
import type { PhotoOriginal } from "../../photo-view-model";

async function pickPhoto(camera: boolean): Promise<PhotoOriginal | null> {
  if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("Camera permission denied");
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false,
    base64: false, exif: false, quality: 1 };
  const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || !asset.uri.startsWith("file://")) throw new Error("Photo unavailable");
  const file = new File(asset.uri);
  if (!file.exists || file.size <= 0 || file.size > PHOTO_LIMITS.bytes) throw new Error("Photo exceeds limit");
  const bytes = await file.bytes();
  // The returned file bytes are authoritative; extensions and picker metadata are only hints.
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? "image/png" : "";
  if (!mime) throw new Error("Only JPEG and PNG photos are supported");
  const name = (asset.fileName || `photo.${mime === "image/png" ? "png" : "jpg"}`).replace(/[\/\\\u0000-\u001f]/gu, "_").slice(0, 200);
  // Do not delete the system picker source or copy it into a persistent business cache.
  return await photoOriginalFromBytes(bytes, name, mime);
}
export const selectNativePhoto = () => pickPhoto(false);
export const captureNativePhoto = () => pickPhoto(true);
