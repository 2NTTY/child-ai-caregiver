import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import type { ServerConfig } from "./config.ts";

export function createAuth(config: ServerConfig, pool: Pool) {
  return betterAuth({
    database: pool,
    secret: config.authSecret,
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    trustedOrigins: [...new Set([config.publicOrigin, config.webOrigin])],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
    },
    session: {
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      // Session reads validate an existing cookie; keep brute-force limits on auth mutations.
      customRules: { "/get-session": false },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    logger: { disabled: true },
  });
}
