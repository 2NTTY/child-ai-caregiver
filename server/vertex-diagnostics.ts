import { ApiError } from "@google/genai";

/** Failure-only metadata. Never inspect or serialize provider messages, bodies, or request context. */
export function logVertexFailure(error: unknown, signal: AbortSignal): void {
  const status = error instanceof ApiError ? error.status : undefined;
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status : null;
  const category = httpStatus === 400 ? "invalid_request"
    : httpStatus === 401 ? "unauthenticated"
    : httpStatus === 403 ? "permission_denied"
    : httpStatus === 404 ? "not_found"
    : httpStatus === 408 || httpStatus === 504 ? "timeout"
    : httpStatus === 429 ? "rate_limited"
    : httpStatus !== null && httpStatus >= 500 ? "provider_unavailable"
    : httpStatus !== null ? "http_error"
    : signal.aborted ? "aborted" : "unknown";
  console.warn(JSON.stringify({ event: "vertex_generate_failure", httpStatus, category }));
}
