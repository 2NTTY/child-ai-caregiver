import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import { createEncryptedBackup, restoreEncryptedBackup, type PgTools } from "./backup.ts";
import { decodePhoto, photoFileContext, photoFileName, photoHash } from "./photo-files.ts";
import { openBuffer, sealBuffer, type StorageCipher } from "./storage-crypto.ts";
import { verifyEncryptedStorage } from "./storage-upgrade.ts";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const MAX_PHOTOS = 10000;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024 + 32;
const MAX_ORIGINAL_BYTES = PHOTO_LIMITS.bytes * 2 + 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MANIFEST_CONTEXT = "yuban-photo-backup-manifest:v1";
const MANIFEST_FILE = "manifest.enc";
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const EMPTY_DATABASE_QUERY = "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1";
const PHOTO_QUERY = "SELECT id::text, mime_type, byte_size, sha256, relative_path, state FROM public.photo_attachments ORDER BY id LIMIT 10001";

interface PhotoBackupEntry {
  id: string;
  mimeType: "image/jpeg" | "image/png";
  byteSize: number;
  sha256: string;
  relativePath: string;
  state: "reserved" | "ready";
}
interface PhotoBackupManifest {
  version: 1;
  databaseSha256: string;
  photos: PhotoBackupEntry[];
}
interface PhotoRow {
  id: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  relative_path: string;
  state: string;
}
export interface PhotoBackupOptions extends PgTools {
  pool: Pool;
  cipher: StorageCipher;
  attachmentsDirectory: string;
}

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fileContext = (databaseSha256: string, id: string) => `yuban-photo-backup:v1:${databaseSha256}:${id}`;
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
function within(path: string, directory: string): boolean {
  const part = relative(directory, path);
  return part === "" || !isAbsolute(part) && part !== ".." && !part.startsWith(".." + sep);
}
function hasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validatePhotos(value: unknown): PhotoBackupEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) throw new Error("Unsupported photo manifest");
  const photos: PhotoBackupEntry[] = [];
  let previousId = "", totalBytes = 0;
  for (const entry of value) {
    if (!hasKeys(entry, ["id", "mimeType", "byteSize", "sha256", "relativePath", "state"])
      || typeof entry.id !== "string" || entry.id <= previousId
      || entry.mimeType !== "image/jpeg" && entry.mimeType !== "image/png"
      || typeof entry.byteSize !== "number" || !Number.isSafeInteger(entry.byteSize)
      || entry.byteSize < 1 || entry.byteSize > PHOTO_LIMITS.bytes
      || typeof entry.sha256 !== "string" || !HASH_PATTERN.test(entry.sha256)
      || typeof entry.relativePath !== "string" || entry.relativePath !== photoFileName(entry.id)
      || entry.state !== "reserved" && entry.state !== "ready") throw new Error("Unsupported photo manifest");
    totalBytes += entry.byteSize;
    if (totalBytes > PHOTO_LIMITS.totalBytes) throw new Error("Photo backup capacity exceeded");
    photos.push({ id: entry.id, mimeType: entry.mimeType,
      byteSize: entry.byteSize, sha256: entry.sha256, relativePath: entry.relativePath,
      state: entry.state });
    previousId = entry.id;
  }
  return photos;
}
function parseManifest(bytes: Buffer): PhotoBackupManifest {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!hasKeys(value, ["version", "databaseSha256", "photos"]) || value.version !== 1
    || typeof value.databaseSha256 !== "string" || !HASH_PATTERN.test(value.databaseSha256)) {
    throw new Error("Unsupported photo manifest");
  }
  return { version: 1, databaseSha256: value.databaseSha256, photos: validatePhotos(value.photos) };
}
async function photoSnapshot(pool: Pool): Promise<PhotoBackupEntry[]> {
  const result = await pool.query<PhotoRow>(PHOTO_QUERY);
  return validatePhotos(result.rows.map(row => ({ id: row.id, mimeType: row.mime_type, byteSize: row.byte_size,
    sha256: row.sha256, relativePath: row.relative_path, state: row.state })));
}
function requireSamePhotos(expected: PhotoBackupEntry[], actual: PhotoBackupEntry[]): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Photo metadata changed");
}

/** Check every directory component; only the final restore directory may be absent. */
async function directoryExists(path: string, allowMissing: boolean): Promise<boolean> {
  const paths = [path];
  while (dirname(paths[paths.length - 1]) !== paths[paths.length - 1]) paths.push(dirname(paths[paths.length - 1]));
  for (const candidate of paths.reverse()) {
    let info;
    try { info = await lstat(candidate); }
    catch (error) { if (allowMissing && candidate === path && isMissing(error)) return false; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid backup directory");
  }
  return true;
}
async function attachmentRoot(directory: string, allowMissing: boolean): Promise<string> {
  if (!isAbsolute(directory)) throw new Error("Absolute attachment directory required");
  const root = resolve(directory);
  if (within(root, PROJECT_ROOT) || within(PROJECT_ROOT, root)) throw new Error("Attachment directory must be outside the project");
  await directoryExists(root, allowMissing);
  return root;
}
function requireSeparatePaths(backupPath: string, sidecar: string, attachments: string): void {
  if (within(backupPath, PROJECT_ROOT) || within(sidecar, PROJECT_ROOT)) throw new Error("Backup must be outside the project");
  if (within(backupPath, attachments) || within(sidecar, attachments) || within(attachments, sidecar)) {
    throw new Error("Backup and original directories must be separate");
  }
}
async function requireMissing(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) { if (isMissing(error)) return; throw error; }
  throw new Error("Backup target already exists");
}
async function requireEmptyAttachmentDirectory(directory: string): Promise<boolean> {
  const exists = await directoryExists(directory, true);
  if (exists && (await readdir(directory)).length) throw new Error("Empty attachment target required");
  return exists;
}
async function requireEmptyTarget(pool: Pool, directory: string): Promise<void> {
  if ((await pool.query(EMPTY_DATABASE_QUERY)).rows.length) throw new Error("Empty database target required");
  await requireEmptyAttachmentDirectory(directory);
}

/** Bounded reads reject links and any observed replacement or modification. */
async function readRegularFile(path: string, maximum: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) throw new Error("Unsupported backup file");
  const handle = await open(path, "r");
  const unchanged = (info: typeof before) => info.isFile() && !info.isSymbolicLink()
    && info.dev === before.dev && info.ino === before.ino && info.size === before.size
    && info.mtimeMs === before.mtimeMs && info.ctimeMs === before.ctimeMs;
  try {
    if (!unchanged(await handle.stat())) throw new Error("Backup file changed");
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < bytes.length) {
      const result = await handle.read(bytes, position, bytes.length - position, position);
      if (!result.bytesRead) throw new Error("Backup file changed");
      position += result.bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, position)).bytesRead
      || !unchanged(await handle.stat()) || !unchanged(await lstat(path))) throw new Error("Backup file changed");
    return bytes;
  } finally { await handle.close(); }
}
async function writeNewFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
function validateOriginal(original: Buffer, entry: PhotoBackupEntry, cipher: StorageCipher): void {
  const encrypted = new TextDecoder("utf-8", { fatal: true }).decode(original);
  const bytes = decodePhoto(cipher.decrypt(encrypted, photoFileContext(entry.id)), entry.mimeType);
  if (bytes.length !== entry.byteSize || photoHash(bytes) !== entry.sha256) throw new Error("Photo original integrity failed");
}
async function authenticatedOriginal(sidecar: string, manifest: PhotoBackupManifest, entry: PhotoBackupEntry,
  backupKey: Buffer, cipher: StorageCipher): Promise<Buffer> {
  const encrypted = await readRegularFile(join(sidecar, photoFileName(entry.id)), MAX_ORIGINAL_BYTES + 32);
  const original = openBuffer(encrypted, backupKey, fileContext(manifest.databaseSha256, entry.id));
  if (original.length > MAX_ORIGINAL_BYTES) throw new Error("Unsupported photo original size");
  validateOriginal(original, entry, cipher);
  return original;
}

/** The caller must keep both API and worker stopped throughout the operation. */
export async function createEncryptedPhotoBackup(options: PhotoBackupOptions, outputPath: string, backupKey: Buffer): Promise<void> {
  const originals = await attachmentRoot(options.attachmentsDirectory, false);
  const databasePath = resolve(outputPath), sidecar = databasePath + ".attachments";
  requireSeparatePaths(databasePath, sidecar, originals);
  await directoryExists(dirname(databasePath), false);
  await requireMissing(databasePath);
  await requireMissing(sidecar);
  await verifyEncryptedStorage(options.pool, options.cipher);
  const photos = await photoSnapshot(options.pool);
  await mkdir(sidecar, { mode: 0o700 });
  await createEncryptedBackup(options, databasePath, backupKey);
  const manifest: PhotoBackupManifest = { version: 1, databaseSha256: hash(await readRegularFile(databasePath, MAX_DATABASE_BYTES)), photos };
  const originalsCopied = new Map<string, string>();
  for (const entry of photos) {
    if (entry.state !== "ready") continue;
    const original = await readRegularFile(join(originals, photoFileName(entry.id)), MAX_ORIGINAL_BYTES);
    validateOriginal(original, entry, options.cipher);
    await writeNewFile(join(sidecar, photoFileName(entry.id)), sealBuffer(original, backupKey, fileContext(manifest.databaseSha256, entry.id)));
    originalsCopied.set(entry.id, hash(original));
  }
  requireSamePhotos(photos, await photoSnapshot(options.pool));
  for (const [id, originalHash] of originalsCopied) {
    if (hash(await readRegularFile(join(originals, photoFileName(id)), MAX_ORIGINAL_BYTES)) !== originalHash) {
      throw new Error("Photo original changed");
    }
  }
  if (hash(await readRegularFile(databasePath, MAX_DATABASE_BYTES)) !== manifest.databaseSha256) throw new Error("Database backup changed");
  const encoded = Buffer.from(JSON.stringify(manifest), "utf8");
  if (encoded.length > MAX_MANIFEST_BYTES) throw new Error("Unsupported photo manifest size");
  // The manifest is the last file: incomplete backups cannot be restored successfully.
  await writeNewFile(join(sidecar, MANIFEST_FILE), sealBuffer(encoded, backupKey, MANIFEST_CONTEXT));
}

/** Existing restore reads only our private copy of the verified ciphertext. */
async function restoreVerifiedDatabase(options: PgTools, databaseCiphertext: Buffer, backupKey: Buffer): Promise<void> {
  const temporaryDirectory = join(resolve(tmpdir()), "yuban-photo-restore-" + randomUUID());
  const temporaryPath = join(temporaryDirectory, randomUUID() + ".enc");
  await mkdir(temporaryDirectory, { mode: 0o700 });
  let fileCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    fileCreated = true;
    try { await handle.writeFile(databaseCiphertext); await handle.sync(); }
    finally { await handle.close(); }
    await restoreEncryptedBackup(options, temporaryPath, backupKey);
  } finally {
    try { if (fileCreated) await unlink(temporaryPath); }
    finally { await rmdir(temporaryDirectory); }
  }
}
/** Any failure leaves the target stopped and may require a fresh empty target. */
export async function restoreEncryptedPhotoBackup(options: PhotoBackupOptions, inputPath: string, backupKey: Buffer): Promise<void> {
  const target = await attachmentRoot(options.attachmentsDirectory, true);
  const databasePath = resolve(inputPath), sidecar = databasePath + ".attachments";
  requireSeparatePaths(databasePath, sidecar, target);
  await directoryExists(dirname(databasePath), false);
  await directoryExists(sidecar, false);
  await requireEmptyTarget(options.pool, target);
  const manifest = parseManifest(openBuffer(await readRegularFile(join(sidecar, MANIFEST_FILE), MAX_MANIFEST_BYTES + 32), backupKey, MANIFEST_CONTEXT));
  const databaseCiphertext = await readRegularFile(databasePath, MAX_DATABASE_BYTES);
  if (hash(databaseCiphertext) !== manifest.databaseSha256) throw new Error("Database backup does not match photos");
  // Every envelope and storage-key original authenticates before pg_restore receives any bytes.
  for (const entry of manifest.photos) {
    if (entry.state === "ready") await authenticatedOriginal(sidecar, manifest, entry, backupKey, options.cipher);
  }
  await requireEmptyTarget(options.pool, target);
  await restoreVerifiedDatabase(options, databaseCiphertext, backupKey);
  if (!(await requireEmptyAttachmentDirectory(target))) await mkdir(target, { mode: 0o700 });
  for (const entry of manifest.photos) {
    if (entry.state !== "ready") continue;
    // Authenticate again so a changed source cannot be copied after the preflight.
    await writeNewFile(join(target, photoFileName(entry.id)), await authenticatedOriginal(sidecar, manifest, entry, backupKey, options.cipher));
  }
  requireSamePhotos(manifest.photos, await photoSnapshot(options.pool));
  await verifyEncryptedStorage(options.pool, options.cipher);
}
