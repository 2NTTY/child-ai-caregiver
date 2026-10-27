import { z } from "zod";
import type { CareValues } from "./care.ts";

export const PHOTO_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, childBytes: 100 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, count: 100, totalCount: 10000 });
const safeText = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
export const photoMetadataSchema = z.object({
  fileName: safeText(200).min(1), mimeType: z.enum(["image/jpeg", "image/png"]),
  bytes: z.number().int().min(1).max(PHOTO_LIMITS.bytes), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  source: safeText(200).min(1),
}).strict();
export const photoDraftSchema = z.object({
  text: safeText(5000), kind: z.enum(["note", "feeding", "sleep", "diaper", "temperature", "measurement", "appointment"]),
  rawValue: safeText(100).nullable(), unit: safeText(50).nullable(), approximate: z.boolean(),
  timeRaw: safeText(300), uncertainties: z.array(safeText(300)).max(8),
}).strict();
export type PhotoMetadata = z.infer<typeof photoMetadataSchema>;
/** Immutable original identity; extraction/record versions may advance without changing its bytes. */
export const photoMessageReferenceSchema = photoMetadataSchema.extend({ id: z.uuid(), version: z.number().int().min(1) }).strict();
export type PhotoMessageReference = z.infer<typeof photoMessageReferenceSchema>;
export const photoLinkInputSchema = z.object({ id: z.uuid(), expectedVersion: z.number().int().min(1) }).strict();
export type PhotoDraft = z.infer<typeof photoDraftSchema>;
export interface PhotoAttachment extends PhotoMetadata {
  id: string; childId: string; ownerUserId: string; createdAt: string; version: number;
  sharedSpaceId?: string; state: "reserved" | "ready"; recoveryPending?: boolean; visibility: "private" | "shared"; canManage: boolean; recordId: string | null;
  extraction: { state: "not_requested" | "running" | "available" | "failed" | "unknown"; runId: string | null;
    draft: PhotoDraft | null; stopReason: string | null; processedAt: string | null; model: string | null };
}
export interface PhotoConfirmation { expectedVersion: number; confirmShared: true; values: CareValues }
