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
