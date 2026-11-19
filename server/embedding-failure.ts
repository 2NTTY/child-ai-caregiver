export class EmbeddingFailure extends Error {
  readonly code: "unavailable" | "invalid_response" | "invalid_input" | "cancelled" | "quota_exceeded" | "unauthorized" | "disabled";
  constructor(code: EmbeddingFailure["code"]) { super(`Embedding ${code}`); this.code = code; }
}

/** Only returned when daily admission refused before any provider request. */
export class EmbeddingAdmissionDeferred extends EmbeddingFailure {
  constructor() { super("quota_exceeded"); }
}
