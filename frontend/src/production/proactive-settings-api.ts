import { z } from "zod";

export const proactiveSettingsSchema = z.object({ enabled: z.boolean(), timeZone: z.string().min(1).max(100), version: z.number().int().nonnegative() }).strict();
export type ProactiveSettings = z.infer<typeof proactiveSettingsSchema>;
export type ProactiveSettingsUpdate = Omit<ProactiveSettings, "version"> & { expectedVersion: number; opId: string };
export class ProactiveSettingsError extends Error {
  status: number;
  constructor(status = 0) { super("Proactive settings request could not be confirmed"); this.status = status; }
}
export function firstEnableTimeZone(current: ProactiveSettings, detected = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (current.version !== 0) return current.timeZone;
  try { new Intl.DateTimeFormat("en", { timeZone: detected }); return detected; } catch { return current.timeZone; }
}
export function createProactiveSettingsApi(baseUrl: string, fetcher: typeof fetch) {
  const base = baseUrl.replace(/\/$/u, ""), api = base.endsWith("/api") ? base : base + "/api";
  async function request(childId: string, userId: string, signal: AbortSignal, input?: ProactiveSettingsUpdate): Promise<ProactiveSettings> {
    const abort = new AbortController(), cancel = () => abort.abort();
    signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    const timer = setTimeout(cancel, 20_000);
    try {
      const response = await fetcher(api + "/children/" + encodeURIComponent(childId) + "/proactive-settings", {
        method: input ? "POST" : "GET", cache: "no-store", credentials: "include", signal: abort.signal,
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(input ? { "Content-Type": "application/json" } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (!response.ok) throw new ProactiveSettingsError(response.status);
      const value = proactiveSettingsSchema.parse(await response.json());
      if (abort.signal.aborted) throw new ProactiveSettingsError();
      return value;
    } catch (error) { throw error instanceof ProactiveSettingsError ? error : new ProactiveSettingsError(); }
    finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  }
  return { read: (childId: string, userId: string, signal: AbortSignal) => request(childId, userId, signal),
    save: (childId: string, userId: string, signal: AbortSignal, input: ProactiveSettingsUpdate) => request(childId, userId, signal, input) };
}
