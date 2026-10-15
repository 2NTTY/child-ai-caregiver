/** Native credentials are explicit bearer capabilities, never ambient browser cookies. */
export const NATIVE_SESSION_PREFIX = "yuban-native-v1.";
export function nativeRequestContext(headers: Headers): boolean {
  return !headers.has("origin") && !headers.has("cookie")
    && !["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].some(key => headers.has(key));
}
export function nativeSessionCredential(headers: Headers): string | null {
  if (!nativeRequestContext(headers)) return null;
  const value = headers.get("authorization");
  if (!value?.startsWith("Bearer " + NATIVE_SESSION_PREFIX)) return null;
  const cookie = value.slice(7 + NATIVE_SESSION_PREFIX.length);
  return cookie.length > 0 && cookie.length <= 16 * 1024 && /^[A-Za-z0-9._~-]+$/.test(cookie) ? cookie : null;
}
/** This is only a request-shape gate. Every business route must still authenticate the credential. */
export function requestOriginAllowed(headers: Headers, publicOrigin: string): boolean {
  return headers.has("authorization") ? nativeSessionCredential(headers) !== null : headers.get("origin") === publicOrigin;
}
