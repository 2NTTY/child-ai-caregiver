import { z } from 'zod';

export const socialAuthProviderSchema = z.enum(['google.com', 'apple.com']);
export type SocialAuthProvider = z.infer<typeof socialAuthProviderSchema>;
export const accountAuthProviderSchema = z.enum(['password', 'google.com', 'apple.com']);
export type AccountAuthProvider = z.infer<typeof accountAuthProviderSchema>;

/** Password remains a string for existing clients; social proof always returns to the original UID. */
export type ReauthenticationInput = string | { provider: SocialAuthProvider };

export const accountAuthMethodsSchema = z.object({
  userId: z.string().min(1).max(128),
  providers: z.array(accountAuthProviderSchema).max(3),
  currentProvider: accountAuthProviderSchema.nullable(),
}).strict();
export type AccountAuthMethods = z.infer<typeof accountAuthMethodsSchema>;

const exchangeErrors = new Set(['invitation_required', 'invitation_unavailable', 'EMAIL_NOT_VERIFIED', 'email_not_verified',
  'identity_changed', 'identity_email_changed', 'sign_out_required', 'recent_reauthentication_required',
  'auth_account_link_required', 'auth_credential_in_use', 'auth_provider_proof_required']);
export function sessionExchangeErrorCode(value: unknown): string | null {
  return typeof value === 'string' && exchangeErrors.has(value) ? value : null;
}
