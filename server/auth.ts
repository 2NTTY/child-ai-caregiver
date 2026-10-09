import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Pool } from "pg";
import type { ServerConfig } from "./config.ts";
import { AccountServiceError, type AccountAdmission } from "./account-admission.ts";
import { accountAuthCallbackUrls, validateAuthCallback, type AuthMail } from "./auth-mail.ts";
import type { ServerAuthPort, ServerAuthSession, ServerAuthSessionWithHeaders } from "./auth-port.ts";

export function createBetterAuthPort(rawAuth: {
  handler: ServerAuthPort["handler"];
  api: Pick<ServerAuthPort, "getSession">;
}): ServerAuthPort {
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  function getSession(options: { headers: Headers; returnHeaders?: false } | { headers: Headers; returnHeaders: true }) {
    if (options.returnHeaders === true) return rawAuth.api.getSession(options);
    return rawAuth.api.getSession(options);
  }
  return { handler: request => rawAuth.handler(request), getSession, fromNodeHeaders };
}

export function createAuth(config: ServerConfig, pool: Pool, services: { admission?: AccountAdmission; mail?: AuthMail } = {}) {
  const invited = services.admission?.enabled === true;
  if (invited && !services.mail) throw new Error("account_auth_mail_required");
  const callbacks = accountAuthCallbackUrls(config);
  return betterAuth({
    database: pool,
    secret: config.authSecret,
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    trustedOrigins: [...new Set([config.publicOrigin, config.webOrigin])],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      ...(invited ? { requireEmailVerification: true, resetPasswordTokenExpiresIn: 3600,
        revokeSessionsOnPasswordReset: true, sendResetPassword: services.mail!.sendResetPassword } : {}),
    },
    ...(invited ? { emailVerification: { sendOnSignUp: true, sendOnSignIn: false, expiresIn: 3600,
      sendVerificationEmail: services.mail!.sendVerificationEmail },
      hooks: { before: createAuthMiddleware(async context => {
        const verify = ["/sign-up/email", "/send-verification-email", "/sign-in/email"].includes(context.path ?? "");
        const reset = context.path === "/request-password-reset";
        if (!verify && !reset) return;
        const field = reset ? "redirectTo" : "callbackURL";
        try { validateAuthCallback(context.body?.[field], config); }
        catch { throw new APIError("BAD_REQUEST", { code: "account_auth_callback_invalid", message: "account_auth_callback_invalid" }); }
        if (context.body) context.body[field] = reset ? callbacks.reset : callbacks.verify;
      }) },
    } : {}),
    user: { deleteUser: { enabled: false }, ...(invited ? {
      async validateUserInfo({ user, source }) {
        if (source.action !== "create-user") return;
        if (typeof user.email !== "string") return { error: "invitation_required" };
        try { await services.admission!.assertCanRegister(user.email); }
        catch (error) {
          if (error instanceof AccountServiceError) return { error: "invitation_required" };
          throw new APIError("SERVICE_UNAVAILABLE", { code: "account_admission_unavailable", message: "account_admission_unavailable" });
        }
      },
    } : {}) },
    ...(services.admission ? { databaseHooks: {
      user: { create: { after: async user => { await services.admission!.admit(user.id, user.email); } } },
      ...(invited ? { session: { create: { before: async session => {
        try { await services.admission!.assertSessionAdmission(session.userId); }
        catch { throw new APIError("FORBIDDEN", { code: "invitation_required", message: "invitation_required" }); }
      } } } } : {}),
    } } : {}),
    session: {
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      // Session reads validate an existing cookie; keep brute-force limits on auth mutations.
      customRules: { "/get-session": false, ...(invited ? {
        "/sign-up/email": { window: 60, max: 3 }, "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 }, "/reset-password": { window: 60, max: 3 },
      } : {}) },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    logger: { disabled: true },
  });
}
