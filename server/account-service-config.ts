import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertPrivatePath } from "./private-path.ts";

const smtpSchema = z.object({
  host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/u),
  port: z.number().int().min(1).max(65535), secure: z.boolean(),
  user: z.string().min(1).max(320).optional(), password: z.string().min(1).max(2048).optional(),
  from: z.email().max(320),
}).strict().refine(value => (value.user === undefined) === (value.password === undefined));
export interface AccountSmtpConfig extends z.infer<typeof smtpSchema> { allowInsecureLoopback: boolean }
export interface AccountServiceConfig { enabled: boolean; production: boolean; smtp: AccountSmtpConfig | null }
export function isSmtpLoopback(host: string): boolean { return ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase()); }

export function parseAccountSmtpConfig(value: unknown, production: boolean, allowInsecureLoopback = false): AccountSmtpConfig {
  const parsed = smtpSchema.safeParse(value);
  if (!parsed.success || (allowInsecureLoopback && (production || !isSmtpLoopback(parsed.data.host))))
    throw new Error("account_smtp_configuration_invalid");
  return { ...parsed.data, allowInsecureLoopback };
}

export async function readAccountServiceConfig(env: Record<string, string | undefined>): Promise<AccountServiceConfig> {
  const production = env.NODE_ENV === "production";
  const mode = env.SERVICE_MODE;
  if (mode !== undefined && mode !== "" && mode !== "trial" && mode !== "invited") throw new Error("account_service_mode_invalid");
  const enabled = mode === "invited";
  const insecure = env.ACCOUNT_SMTP_ALLOW_INSECURE_LOOPBACK;
  if (insecure !== undefined && insecure !== "true" && insecure !== "false") throw new Error("account_smtp_configuration_invalid");
  let smtp: AccountSmtpConfig | null = null;
  if (env.ACCOUNT_SMTP_CONFIG_FILE) {
    try {
      const path = env.ACCOUNT_SMTP_CONFIG_FILE;
      if (!isAbsolute(path)) throw new Error();
      const actual = await realpath(path);
      const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
      const inside = relative(root, actual);
      if (!(inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside))) throw new Error();
      await assertPrivatePath(actual);
      const info = await stat(actual);
      if (!info.isFile() || info.size > 8192 || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error();
      smtp = parseAccountSmtpConfig(JSON.parse(await readFile(actual, "utf8")), production, insecure === "true");
    } catch { throw new Error("account_smtp_configuration_invalid"); }
  } else if (insecure === "true") throw new Error("account_smtp_configuration_invalid");
  if (enabled && production && !smtp) throw new Error("account_smtp_required");
  return { enabled, production, smtp };
}
