import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import type { PickBackgroundImage } from "../background-view-model";
import { backgroundImageMime } from "./background-image";
import { backgroundMaxBytes } from "./background-storage";

export const pickBackgroundImage: PickBackgroundImage = async () => {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false, base64: false, exif: false, quality: 1 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri.startsWith("file://") || !asset.width || !asset.height || asset.width * asset.height > 16_000_000) throw new Error("Invalid background dimensions");
  const file = new File(asset.uri);
  if (!file.exists || file.size <= 0 || file.size > backgroundMaxBytes) throw new Error("Background exceeds limit");
  const bytes = await file.bytes();
  if (!backgroundImageMime(bytes)) throw new Error("Unsupported background type");
  // Do not delete the system picker source. Storage copies only after successful validation.
  return { uri: asset.uri, filename: "自選圖片", dispose() {} };
};
