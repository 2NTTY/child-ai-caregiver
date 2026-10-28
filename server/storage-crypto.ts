import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat, open, rm, type FileHandle } from "node:fs/promises";
import { createReadStream, type ReadStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("YBG1");
export interface StorageCipher {
  encrypt(text: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}
export interface StorageFileInput {
  source: string; directory: string; context: string; maxBytes: number; signal?: AbortSignal;
}
export interface StorageFileResult { path: string; bytes: number; sha256: string; sourceSha256: string }
export interface StorageFileCipher {
  encrypt(input: StorageFileInput): Promise<StorageFileResult>;
  decrypt(input: StorageFileInput): Promise<StorageFileResult>;
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

/** Same YBG1 envelope as sealBuffer/openBuffer; temporary paths must stay inside a private server spool. */
function createStorageFileCipher(key: Buffer): StorageFileCipher {
  async function transform(input: StorageFileInput, decrypt: boolean): Promise<StorageFileResult> {
    if (!input.context || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) throw new Error('Invalid file encryption configuration');
    const signal = AbortSignal.any([AbortSignal.timeout(300000), ...(input.signal ? [input.signal] : [])]);
    signal.throwIfAborted();
    let source: FileHandle | undefined, destination: FileHandle | undefined, ownedPath: string | undefined;
    let reader: ReadStream | undefined, writer: WriteStream | undefined;
    try {
      source = await open(input.source, 'r');
      const info = await source.stat(), maximum = input.maxBytes + (decrypt ? 32 : 0);
      if (!info.isFile() || info.size > maximum || decrypt && info.size < 32) throw new Error('Invalid encrypted file size');
      const header = Buffer.alloc(32);
      if (decrypt) {
        const { bytesRead } = await source.read(header, 0, header.length, 0);
        if (bytesRead !== 32 || !header.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid encrypted file');
      } else { MAGIC.copy(header); randomBytes(12).copy(header, 4); }
      const aad = Buffer.concat([MAGIC, Buffer.from(input.context, 'utf8')]);
      const crypt = decrypt ? createDecipheriv('aes-256-gcm', key, header.subarray(4, 16), { authTagLength: 16 })
        : createCipheriv('aes-256-gcm', key, header.subarray(4, 16), { authTagLength: 16 });
      crypt.setAAD(aad);
      if (decrypt) (crypt as ReturnType<typeof createDecipheriv> & { setAuthTag(tag: Buffer): void }).setAuthTag(header.subarray(16, 32));
      const path = join(input.directory, `${randomUUID()}.${decrypt ? 'plain' : 'sealed'}`);
      destination = await open(path, 'wx+', 0o600); ownedPath = path;
      if (!decrypt) await destination.write(header, 0, header.length, 0);
      let plaintextBytes = 0; const sourceDigest = createHash('sha256');
      if (decrypt) sourceDigest.update(header);
      const trackSource = new Transform({ transform(chunk: Buffer, _encoding, callback) { sourceDigest.update(chunk); callback(null, chunk); } });
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        plaintextBytes += chunk.length;
        callback(plaintextBytes > input.maxBytes ? new Error('File exceeds encryption limit') : null, chunk);
      } });
      reader = source.createReadStream({ start: decrypt ? 32 : 0, autoClose: false });
      writer = destination.createWriteStream({ start: decrypt ? 0 : 32, autoClose: false });
      if (decrypt) await pipeline(reader, trackSource, crypt, bound, writer, { signal });
      else await pipeline(reader, trackSource, bound, crypt, writer, { signal });
      // Destroying a FileHandle stream closes its descriptor even with autoClose:false.
      // Patch the tag first, then release both streams before awaiting FileHandle.close().
      if (!decrypt) {
        const tag = (crypt as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer }).getAuthTag();
        await destination.write(tag, 0, tag.length, 16);
      }
      reader.destroy(); writer.destroy();
      await destination.close(); destination = undefined;
      await source.close(); source = undefined;
      // Authentication succeeded before returning a plaintext path. Hash the exact completed on-disk envelope/content.
      const digest = createHash('sha256'); let bytes = 0;
      const completed = createReadStream(path), cancelled = () => completed.destroy(new Error('File encryption cancelled'));
      signal.addEventListener('abort', cancelled, { once: true });
      try { for await (const chunk of completed) { signal.throwIfAborted(); bytes += chunk.length; digest.update(chunk); } }
      finally { signal.removeEventListener('abort', cancelled); completed.destroy(); }
      if (bytes !== plaintextBytes + (decrypt ? 0 : 32)) throw new Error('Encrypted file changed');
      return { path, bytes, sha256: digest.digest('hex'), sourceSha256: sourceDigest.digest('hex') };
    } catch {
      reader?.destroy(); writer?.destroy();
      await destination?.close().catch(() => {}); destination = undefined;
      if (ownedPath) await rm(ownedPath, { force: true });
      throw new Error('File data could not be authenticated or saved');
    } finally { await source?.close().catch(() => {}); await destination?.close().catch(() => {}); }
  }
  return { encrypt: input => transform(input, false), decrypt: input => transform(input, true) };
}

export function createStorageCipher(key: Buffer): StorageCipher & { files: StorageFileCipher } {
  if (key.length !== 32) throw new Error("Invalid encryption configuration");
  const privateKey = Buffer.from(key);
  return {
    files: createStorageFileCipher(privateKey),
    encrypt: (text, context) => `yb1.${sealBuffer(Buffer.from(text, "utf8"), privateKey, context).toString("base64")}`,
    decrypt(envelope, context) {
      if (typeof envelope !== "string" || !envelope.startsWith("yb1.")) throw new Error("Encrypted storage required");
      const body = envelope.slice(4), bytes = Buffer.from(body, "base64");
      if (bytes.toString("base64") !== body) throw new Error("Invalid encrypted envelope");
      return new TextDecoder("utf-8", { fatal: true }).decode(openBuffer(bytes, privateKey, context));
    },
  };
}
