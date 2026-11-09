/** Public deployment configuration only. Never pass provider credentials here. */
export function resolveApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || "/api";
  if (candidate === "/api") return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Invalid API base URL configuration");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username || url.password || candidate.includes("?") || candidate.includes("#") ||
    (url.pathname !== "/" && url.pathname !== "/api" && url.pathname !== "/api/")
  ) {
    throw new Error("Invalid API base URL configuration");
  }
  return url.href.replace(/\/$/, "");
}
