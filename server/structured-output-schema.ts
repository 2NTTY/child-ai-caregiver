import { z } from "zod";

const STRIPPED_SCHEMA_KEYS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "maximum",
  "minimum",
]);

/**
 * Project a Zod schema into a bounded provider-compatible JSON Schema.
 * Keeps the provider grammar compact while preserving full local Zod validation.
 */
export function nativeResponseSchema(shape: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(shape, { io: "input", reused: "ref" });
  return JSON.parse(
    JSON.stringify(schema, (key, value) => (STRIPPED_SCHEMA_KEYS.has(key) ? undefined : value)),
  ) as Record<string, unknown>;
}
