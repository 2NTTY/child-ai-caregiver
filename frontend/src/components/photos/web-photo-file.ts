import { PHOTO_LIMITS } from "../../../../src/shared/photos.ts";

const maxBytes = PHOTO_LIMITS.bytes;
const heicTypes = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

// Local browser decoding only: no upload, remote converter, or persistent cache.
export async function prepareWebPhoto(file: File): Promise<File> {
  if (file.size < 1 || file.size > maxBytes || file.name.length > 200)
    throw new Error("每張照片最多 4 MiB，檔名最多 200 字。現有照片與草稿保留。");
  if (["image/jpeg", "image/png"].includes(file.type)) return file;
  const heic = heicTypes.includes(file.type.toLowerCase()) ||
    ((!file.type || file.type === "application/octet-stream") && /\.(heic|heif)$/iu.test(file.name));
  if (!heic) throw new Error("請選擇 JPEG／PNG，或這個瀏覽器可解碼的 HEIC 照片。現有草稿保留。");
  const uri = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error("HEIC decode unavailable")); image.src = uri;
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("HEIC dimensions unsupported");
    const canvas = document.createElement("canvas");
    try {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("HEIC canvas unavailable");
      context.drawImage(image, 0, 0);
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
        blob?.type === "image/jpeg" ? resolve(blob) : reject(new Error("HEIC JPEG unavailable")), "image/jpeg", 0.9));
      if (!jpeg.size || jpeg.size > maxBytes) throw new Error("HEIC JPEG exceeds limit");
      const name = `${(file.name.replace(/\.[^.]*$/u, "") || "photo").slice(0, 196)}.jpg`;
      return new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
    } finally { canvas.width = 0; canvas.height = 0; }
  } catch {
    throw new Error("未能在此瀏覽器將 HEIC 轉為 4 MiB 內的 JPEG。請在相片 App 匯出 JPEG／PNG 後重選；原有草稿保留。");
  } finally { image.onload = null; image.onerror = null; image.src = ""; URL.revokeObjectURL(uri); }
}
