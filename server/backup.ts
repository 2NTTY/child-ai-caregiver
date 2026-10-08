import { execFile } from "node:child_process";
import { open, readFile, stat } from "node:fs/promises";
import { openBuffer, sealBuffer } from "./storage-crypto.ts";

const MAX_DUMP_BYTES = 64 * 1024 * 1024;
const CONTEXT = "yuban-postgresql-backup:v1";
export interface PgTools { databaseUrl: string; container?: string }

async function runPgTool(options: PgTools, tool: "pg_dump" | "pg_restore" | "psql", args: string[], input?: Buffer): Promise<Buffer> {
  const url = new URL(options.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid backup database");
  if (!/^[A-Za-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1)))
    || [...url.searchParams.keys()].some(name => name !== "sslmode")) throw new Error("Unsupported backup connection options");
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10", PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer" };
  let command: string = tool, commandArgs = args;
  if (options.container) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.container)
      || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Invalid local PostgreSQL container");
    env.PGHOST = "127.0.0.1"; env.PGPORT = "5432";
    command = "docker";
    commandArgs = ["exec", "-i", ...["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGCONNECT_TIMEOUT", "PGSSLMODE"].flatMap(name => ["--env", name]), options.container, tool, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = execFile(command, commandArgs, { env, encoding: "buffer", maxBuffer: MAX_DUMP_BYTES,
      timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (error || stderr.length) reject(new Error("PostgreSQL backup tool failed"));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export async function createEncryptedBackup(options: PgTools, outputPath: string, backupKey: Buffer): Promise<void> {
  const dump = await runPgTool(options, "pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-privileges",
    "--exclude-table-data=public.session", "--exclude-table-data=public.verification", "--exclude-table-data=public.auth_mail_outbox"]);
  if (!dump.subarray(0, 5).equals(Buffer.from("PGDMP"))) throw new Error("Invalid PostgreSQL archive");
  const encrypted = sealBuffer(dump, backupKey, CONTEXT);
  const output = await open(outputPath, "wx", 0o600);
  try { await output.writeFile(encrypted); await output.sync(); }
  finally { await output.close(); }
}

export async function restoreEncryptedBackup(options: PgTools, inputPath: string, backupKey: Buffer): Promise<void> {
  const info = await stat(inputPath);
  if (!info.isFile() || info.size > MAX_DUMP_BYTES + 32) throw new Error("Unsupported backup size");
  const dump = openBuffer(await readFile(inputPath), backupKey, CONTEXT);
  if (!dump.subarray(0, 5).equals(Buffer.from("PGDMP"))) throw new Error("Invalid PostgreSQL archive");
  // Only authenticated bytes reach pg_restore. The caller must verify an empty, stopped target.
  const database = decodeURIComponent(new URL(options.databaseUrl).pathname.slice(1));
  await runPgTool(options, "pg_restore", ["--no-password", "--dbname", database,
    "--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges"], dump);
  // The stopped target must never replay the backup's old jobs on first startup.
  // Failure here is a failed restore: keep both API and worker stopped.
  await runPgTool(options, "psql", ["--no-password", "-X", "-q", "-v", "ON_ERROR_STOP=1"], Buffer.from(`
DO $restore$ BEGIN
  IF to_regclass('public.worker_control') IS NOT NULL THEN
    UPDATE public.worker_control SET enabled=false,generation=gen_random_uuid() WHERE id=1;
  END IF;
END $restore$;
`));
}
