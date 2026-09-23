import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const MAGIC = Buffer.from("YBG1");
export interface StorageCipher {
  encrypt(text: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}

export async function readSecretKey(path: string | undefined): Promise<Buffer> {
  try {
    if (!path) throw new Error();
    const info = await stat(path);
    if (!info.isFile() || info.size > 128 || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error();
    const encoded = (await readFile(path, "utf8")).trim();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error();
    return key;
  } catch { throw new Error("Storage key unavailable or invalid"); }
}

export function sealBuffer(plaintext: Buffer, key: Buffer, context: string): Buffer {
  if (key.length !== 32 || !context) throw new Error("Invalid encryption configuration");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([MAGIC, Buffer.from(context, "utf8")]));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function openBuffer(envelope: Buffer, key: Buffer, context: string): Buffer {
  try {
    if (key.length !== 32 || !context || envelope.length < 32 || !envelope.subarray(0, 4).equals(MAGIC)) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(4, 16), { authTagLength: 16 });
    decipher.setAAD(Buffer.concat([MAGIC, Buffer.from(context, "utf8")]));
    decipher.setAuthTag(envelope.subarray(16, 32));
    // Never return update() output until final() authenticates the entire envelope.
    return Buffer.concat([decipher.update(envelope.subarray(32)), decipher.final()]);
  } catch { throw new Error("Encrypted data could not be authenticated"); }
}

export function createStorageCipher(key: Buffer): StorageCipher {
  if (key.length !== 32) throw new Error("Invalid encryption configuration");
  const privateKey = Buffer.from(key);
  return {
    encrypt: (text, context) => `yb1.${sealBuffer(Buffer.from(text, "utf8"), privateKey, context).toString("base64")}`,
    decrypt(envelope, context) {
      if (typeof envelope !== "string" || !envelope.startsWith("yb1.")) throw new Error("Encrypted storage required");
      const body = envelope.slice(4), bytes = Buffer.from(body, "base64");
      if (bytes.toString("base64") !== body) throw new Error("Invalid encrypted envelope");
      return new TextDecoder("utf-8", { fatal: true }).decode(openBuffer(bytes, privateKey, context));
    },
  };
}
