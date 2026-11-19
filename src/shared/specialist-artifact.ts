import { z } from "zod";

/**
 * Policy identifier for REQ-008 complex family artifact specialist runs
 * and isolated post-build verification reports.
 */
export const SPECIALIST_ARTIFACT_POLICY_VERSION = "req008-specialist-artifact/1";

/** Server-enforced ceiling for automated rebuild-and-reverify repair loops. */
export const SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS = 2;

/** Reported whenever no isolated pixel/screenshot renderer ran on the artifact. */
export const PIXEL_SCREENSHOT_UNVERIFIED_CHECK = "pixel_screenshot_render";

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);

export const specialistArtifactFormatSchema = z.enum(["pdf", "html"]);
export type SpecialistArtifactFormat = z.infer<typeof specialistArtifactFormatSchema>;

export const specialistArtifactDefectKindSchema = z.enum([
  "overflow",
  "overlap",
  "clipping",
  "missing_glyph",
  "empty_page",
  "unsafe_link",
  "unreadable_text",
  "render_error",
]);
export type SpecialistArtifactDefectKind = z.infer<typeof specialistArtifactDefectKindSchema>;

export const specialistArtifactStatusSchema = z.enum(["verified", "partial", "blocked"]);
export type SpecialistArtifactStatus = z.infer<typeof specialistArtifactStatusSchema>;

export const specialistArtifactDefectSchema = z.object({
  kind: specialistArtifactDefectKindSchema,
  page: z.number().int().min(1).optional(),
  message: z.string().trim().min(1).max(500),
}).strict();
export type SpecialistArtifactDefect = z.infer<typeof specialistArtifactDefectSchema>;

export const specialistArtifactInputSchema = z.object({
  documentId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128),
  format: specialistArtifactFormatSchema.default("pdf"),
  sourceQuote: z.string().trim().min(1).max(200),
  intent: z.string().trim().min(1).max(400),
  includeRevision: z.boolean().default(false),
  includeSources: z.boolean().default(true),
}).strict();
export type SpecialistArtifactInput = z.infer<typeof specialistArtifactInputSchema>;

export const specialistArtifactVerificationReportSchema = z.object({
  policyVersion: z.literal(SPECIALIST_ARTIFACT_POLICY_VERSION),
  format: specialistArtifactFormatSchema,
  artifactVersion: z.number().int().min(1),
  artifactHash: sha256Hex,
  passed: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  defects: z.array(specialistArtifactDefectSchema).max(64),
  unverifiedChecks: z.array(z.string().trim().min(1).max(80)).max(16),
  extractedTextSample: z.string().max(500),
}).strict();
export type SpecialistArtifactVerificationReport = z.infer<typeof specialistArtifactVerificationReportSchema>;

export const specialistArtifactMetadataSchema = z.object({
  artifactId: z.string().min(1).max(128),
  documentId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128),
  artifactVersion: z.number().int().min(1),
  artifactHash: sha256Hex,
  format: specialistArtifactFormatSchema,
  mimeType: z.enum(["application/pdf", "text/html"]),
  byteLength: z.number().int().positive(),
  pageCount: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
}).strict();
export type SpecialistArtifactMetadata = z.infer<typeof specialistArtifactMetadataSchema>;

export const specialistArtifactResultSchema = z.object({
  policyVersion: z.literal(SPECIALIST_ARTIFACT_POLICY_VERSION),
  status: specialistArtifactStatusSchema,
  repairIterations: z.number().int().min(0).max(SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS),
  stopReason: z.enum([
    "verified",
    "repair_limit_reached",
    "tool_limit",
    "model_limit",
    "deadline",
    "source_quote_mismatch",
    "version_mismatch",
    "document_not_ready",
    "render_error",
  ]),
  formalSave: z.literal(false),
  published: z.literal(false),
  requiresFormalConfirmation: z.literal(true),
  artifact: specialistArtifactMetadataSchema.nullable(),
  verification: specialistArtifactVerificationReportSchema.nullable(),
}).strict();
export type SpecialistArtifactResult = z.infer<typeof specialistArtifactResultSchema>;
