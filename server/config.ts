import { isIP } from "node:net";

export interface ServerConfig {
  databaseUrl: string;
  authSecret: string;
  publicOrigin: string;
  webOrigin: string;
  host: string;
  port: number;
  production: boolean;
  trustedProxyIp?: string;
}

function invalidConfig(name: string): never {
  throw new Error(`Invalid ${name} configuration`);
}

function readDatabaseUrl(value: string | undefined): string {
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f#]/u.test(value)) {
    invalidConfig("DATABASE_URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidConfig("DATABASE_URL");
  }
  if (!url.hostname || (url.protocol !== "postgres:" && url.protocol !== "postgresql:")) {
    invalidConfig("DATABASE_URL");
  }
  return value;
}

function readAuthSecret(value: string | undefined): string {
  const normalized = value?.toLowerCase().replace(/[\s_-]/gu, "") ?? "";
  const placeholder = /^(?:betterauthsecret|yoursecret|yourauthsecret|replace|changeme|changethis|example|developmentsecret|testsecret)/u.test(normalized);
  if (!value || Array.from(value).length < 32 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value) || /^(.)\1+$/u.test(value) || placeholder) {
    invalidConfig("BETTER_AUTH_SECRET");
  }
  return value;
}

function readOrigin(value: string | undefined, name: "SERVER_ORIGIN" | "WEB_ORIGIN", production: boolean): string {
  // Check the raw value too: URL parsing normalizes paths and empty ?/# suffixes.
  if (!value || !/^https?:\/\/[^/?#\\@\s\u0000-\u001f\u007f]+$/iu.test(value)) {
    invalidConfig(name);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidConfig(name);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  const secure = url.protocol === "https:";
  if (url.hostname.includes("*") || (!secure && (production || url.protocol !== "http:" || !loopback))) {
    invalidConfig(name);
  }
  return url.origin;
}

export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const production = env.NODE_ENV === "production";
  const databaseUrl = readDatabaseUrl(env.DATABASE_URL);
  const authSecret = readAuthSecret(env.BETTER_AUTH_SECRET);
  const publicOrigin = readOrigin(env.SERVER_ORIGIN ?? (production ? undefined : "http://localhost:3001"), "SERVER_ORIGIN", production);
  const webOrigin = readOrigin(env.WEB_ORIGIN ?? (production ? publicOrigin : "http://localhost:8081"), "WEB_ORIGIN", production);
  const host = env.HOST ?? "127.0.0.1";
  if (!host || /[\s\u0000-\u001f\u007f]/u.test(host)) {
    invalidConfig("HOST");
  }
  const portValue = env.PORT ?? "3001";
  const port = Number(portValue);
  if (!/^\d+$/u.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    invalidConfig("PORT");
  }

  const trustedProxyIp = env.TRUSTED_PROXY_IP || undefined;
  // P1 has one explicitly addressed IPv4 ingress proxy; never trust a whole private range.
  if (trustedProxyIp && isIP(trustedProxyIp) !== 4) invalidConfig("TRUSTED_PROXY_IP");
  return { databaseUrl, authSecret, publicOrigin, webOrigin, host, port, production,
    ...(trustedProxyIp ? { trustedProxyIp } : {}) };
}
