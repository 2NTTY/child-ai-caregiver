import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { StorageCipher } from "./storage-crypto.ts";

const VERSION = "account-erasure-journal:1";
const MAX_LINE = 8192;
const headerSchema = z.object({ version: z.literal(1), journalId: z.uuid() }).strict();
const intentSchema = z.object({ operationId: z.uuid(), kind: z.enum(["user", "child"]), id: z.string().min(1).max(128), at: z.iso.datetime() }).strict();
const entrySchema = z.object({ sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), previous: z.string().regex(/^[a-f0-9]{64}$/), intent: intentSchema }).strict();
export type ErasureIntent = z.infer<typeof intentSchema>;
export interface JournalHead { sequence: number; digest: string }
export interface ErasureJournal {
  readonly id: string;
  inspect(): Promise<JournalHead>;
  genesis(): Promise<JournalHead>;
  entries(): AsyncGenerator<{ intent: ErasureIntent; head: JournalHead }>;
  /** Caller holds the database advisory transaction lock, after all workspace locks. */
  append(intent: ErasureIntent): Promise<JournalHead>;
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
async function* lines(path: string): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 4096 })) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    let end: number;
    while ((end = pending.indexOf(10)) >= 0) {
      if (end < 1 || end > MAX_LINE) throw new Error("Erasure journal is invalid");
      const line = pending.subarray(0, end);
      if (line.includes(13)) throw new Error("Erasure journal is invalid");
      yield new TextDecoder("utf-8", { fatal: true }).decode(line);
      pending = pending.subarray(end + 1);
    }
    if (pending.length > MAX_LINE) throw new Error("Erasure journal is invalid");
  }
  if (pending.length) throw new Error("Erasure journal is incomplete");
}
async function noLinks(path: string) {
  let current = resolve(path);
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Erasure journal links are forbidden");
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
async function syncDirectory(path: string) {
  let file;
  try { file = await open(path, "r"); await file.sync(); }
  catch (error) { if (process.platform !== "win32" || !["EISDIR", "EPERM", "EACCES", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  finally { await file?.close(); }
}
export async function openErasureJournal(options: { directory: string; repositoryPath: string; cipher: StorageCipher;
  initialize?: boolean; assertProtectedDirectory?: (directory: string) => Promise<void> }): Promise<ErasureJournal> {
  if (!isAbsolute(options.directory) || !isAbsolute(options.repositoryPath)) throw new Error("Erasure journal requires absolute paths");
  const directory = resolve(options.directory), repository = resolve(options.repositoryPath), inside = relative(repository, directory);
  if (!inside || inside !== ".." && !inside.startsWith(".." + sep) && !isAbsolute(inside)) throw new Error("Erasure journal must be outside the repository");
  if (options.initialize) {
    await noLinks(dirname(directory));
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  await noLinks(directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Erasure journal directory is not protected");
  if (process.platform === "win32" && !options.assertProtectedDirectory) throw new Error("Erasure journal ACL verification is required");
  await options.assertProtectedDirectory?.(directory);
  const path = join(directory, "intents.enc");
  if (options.initialize) {
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(options.cipher.encrypt(JSON.stringify({ version: 1, journalId: randomUUID() }), VERSION + ":header") + "\n"); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(directory);
  }
  await noLinks(path);
  const fileInfo = await lstat(path);
  if (!fileInfo.isFile() || fileInfo.nlink !== 1 || process.platform !== "win32" && (fileInfo.mode & 0o077)) throw new Error("Erasure journal file is not protected");
  await options.assertProtectedDirectory?.(path);
  let header: string | undefined;
  for await (const line of lines(path)) { header = line; break; }
  if (!header) throw new Error("Erasure journal header is missing");
  const { journalId } = headerSchema.parse(JSON.parse(options.cipher.decrypt(header, VERSION + ":header")));
  const headerDigest = digest(header);
  async function* entries() {
    let first = true, head = { sequence: 0, digest: headerDigest };
    for await (const line of lines(path)) {
      if (first) { first = false; if (line !== header) throw new Error("Erasure journal identity changed"); continue; }
      const entry = entrySchema.parse(JSON.parse(options.cipher.decrypt(line, VERSION + ":" + journalId + ":entry")));
      if (entry.sequence !== head.sequence + 1 || entry.previous !== head.digest) throw new Error("Erasure journal chain is invalid");
      head = { sequence: entry.sequence, digest: digest(line) };
      yield { intent: entry.intent, head };
    }
    if (first) throw new Error("Erasure journal header is missing");
  }
  const journal: ErasureJournal = { id: journalId, entries, genesis: async () => ({ sequence: 0, digest: headerDigest }),
    async inspect() { let head = { sequence: 0, digest: headerDigest }; for await (const entry of entries()) head = entry.head; return head; },
    async append(raw) {
      const intent = intentSchema.parse(raw); if (intent.kind === "child") z.uuid().parse(intent.id);
      await noLinks(path);
      const previous = await journal.inspect();
      const envelope = options.cipher.encrypt(JSON.stringify({ sequence: previous.sequence + 1, previous: previous.digest, intent }), VERSION + ":" + journalId + ":entry");
      if (Buffer.byteLength(envelope) > MAX_LINE) throw new Error("Erasure journal entry is too large");
      const file = await open(path, "a");
      try { await file.writeFile(envelope + "\n"); await file.sync(); } finally { await file.close(); }
      await syncDirectory(directory);
      return { sequence: previous.sequence + 1, digest: digest(envelope) };
    },
  };
  await journal.inspect();
  return journal;
}
