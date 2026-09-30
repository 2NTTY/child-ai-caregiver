import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, link, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorageCipher } from "./storage-crypto.ts";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";

export function decodePhoto(base64: string, mimeType: string): Buffer {
  if (base64.length > Math.ceil(PHOTO_LIMITS.bytes / 3) * 4 || /[^A-Za-z0-9+/=]/u.test(base64)) throw new Error("Invalid image");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > PHOTO_LIMITS.bytes || bytes.toString("base64") !== base64) throw new Error("Invalid image");
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii",12,16)==="IHDR";
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(mimeType === "image/png" && png || mimeType === "image/jpeg" && jpeg)) throw new Error("Invalid image");
  return bytes;
}
export const photoHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const photoFileContext = (id: string) => "photo-original:v1:" + id;
export const photoFileName = (id: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id)) throw new Error("Invalid photo id");
  return id + ".enc";
};
/** Dedicated, non-public directory. Filenames never contain user input. */
export async function createPhotoFiles(directory: string, cipher: StorageCipher) {
  if (!isAbsolute(directory)) throw new Error("Absolute attachment directory required");
  const root = resolve(directory);
  const repository=resolve(fileURLToPath(new URL("../",import.meta.url)));
  const within=relative(repository,root);
  const parent=relative(root,repository);
  const nested=(part:string)=>!part||!isAbsolute(part)&&part!==".."&&!part.startsWith(".."+sep);
  if(nested(within)||nested(parent))throw new Error("Attachment directory must be outside the repository");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid attachment directory");
  const file = (id: string) => join(root, photoFileName(id));
  return {
    async read(id: string) {
      const path = file(id), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > PHOTO_LIMITS.bytes * 2 + 1024) throw new Error("Invalid attachment");
      return cipher.decrypt(await readFile(path, "utf8"), photoFileContext(id));
    },
    async write(id: string, base64: string) {
      const target = file(id), temporary = join(root, randomUUID() + ".tmp");
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(cipher.encrypt(base64, photoFileContext(id)), "utf8");
          await handle.sync();
        } finally { await handle.close(); }
        // Immutable destination: a replay cannot replace an already stored original.
        try { await link(temporary, target); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (await this.read(id) !== base64) throw new Error("Attachment content conflict"); }
        if(process.platform!=="win32"){const directoryHandle=await open(root,"r");try{await directoryHandle.sync();}finally{await directoryHandle.close();}}
      } finally { await unlink(temporary).catch(() => {}); }
    },
    async remove(id: string) {
      try { await unlink(file(id)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}
export type PhotoFiles = Awaited<ReturnType<typeof createPhotoFiles>>;
