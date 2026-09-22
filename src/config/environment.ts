import { resolveApiBaseUrl } from "./api-base-url";

// Expo replaces this literal public environment variable during bundling.
export const environment = {
  apiBaseUrl: resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL),
} as const;
