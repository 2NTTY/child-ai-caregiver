import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const sectionId = z.string().trim().min(1).max(80), itemId = z.string().trim().min(1).max(100);
const domain = z.enum(["profile", "body_life", "abilities_interests", "concerns", "changes_support"]).nullable();
export const documentPeriodSchema = z.object({ from: day, to: day }).strict().refine(value => value.from <= value.to);
export const documentRequestSchema = z.object({
  kind: z.enum(["preparation", "growth_report"]), purpose: z.enum(["appointment", "school", "outing", "handoff", "family"]),
  title: z.string().trim().min(1).max(160), eventDate: day.nullable(), period: documentPeriodSchema,
}).strict().refine(value => value.kind !== "preparation" || value.purpose !== "family");
export type DocumentRequest = z.infer<typeof documentRequestSchema>;
const metadataEdit = z.object({ op: z.literal("set_metadata"), title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().max(2000).optional(), eventDate: day.nullable().optional() }).strict()
  .refine(value => value.title !== undefined || value.summary !== undefined || value.eventDate !== undefined);
export const documentEditSchema = z.discriminatedUnion("op", [
  metadataEdit,
  z.object({ op: z.literal("upsert_section"), sectionId, title: z.string().trim().min(1).max(160).optional(),
    kind: z.enum(["notes", "questions", "checklist"]).optional(), domain: domain.optional() }).strict(),
  z.object({ op: z.literal("remove_section"), sectionId }).strict(),
  z.object({ op: z.literal("move_section"), sectionId, beforeId: sectionId.nullable() }).strict(),
  z.object({ op: z.literal("upsert_item"), sectionId, itemId, text: z.string().min(1).max(4000).optional(),
    sourceIds: z.array(z.string().min(1).max(160)).max(140).optional() }).strict(),
  z.object({ op: z.literal("remove_item"), sectionId, itemId }).strict(),
  z.object({ op: z.literal("move_item"), sectionId, itemId, beforeId: itemId.nullable() }).strict(),
]);
export type DocumentEdit = z.infer<typeof documentEditSchema>;
export const documentPatchSchema = z.object({ action: z.literal("patch"), expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128), edits: z.array(documentEditSchema).min(1).max(12) }).strict();
export type DocumentPatch = z.infer<typeof documentPatchSchema>;
export const documentChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh"), expectedVersion: z.number().int().min(1), authorityVersion: z.string().max(128) }).strict(),
  z.object({ action: z.enum(["archive", "restore"]), expectedVersion: z.number().int().min(1), authorityVersion: z.string().max(128) }).strict(),
  z.object({ action: z.literal("check_item"), expectedVersion: z.number().int().min(1), authorityVersion: z.string().max(128), sectionId, itemId, checked: z.boolean() }).strict(),
  documentPatchSchema.extend({ confirmShared: z.literal(true) }),
]);
export type DocumentChange = z.infer<typeof documentChangeSchema>;
export interface DocumentSource {
  id: string; resourceId: string; kind: "profile" | "record" | "fact" | "task" | "concern";
  version: number; label: string; text: string; at: string | null;
}
export interface DocumentSection {
  id: string; title: string; kind: "notes" | "questions" | "checklist";
  domain: "profile" | "body_life" | "abilities_interests" | "concerns" | "changes_support" | null;
  items: { id: string; text: string; sourceIds: string[]; checked?: boolean }[];
}
export interface DocumentSnapshot {
  id: string; version: number; generatedAt: string; sourceBasis: string;
  title: string; summary: string; ageLabel: string; period: { from: string; to: string };
  eventDate: string | null; coverageNote: string; sections: DocumentSection[]; sources: DocumentSource[]; changes: string[];
  editProtection?: { sectionIds: string[]; removedSectionIds: string[]; metadataFields: ("title" | "summary" | "eventDate")[] };
}
export interface DocumentManifest {
  snapshotId: string; snapshotVersion: number; invalidated: boolean;
  sections: { id: string; kind: DocumentSection["kind"]; itemIds: string[] }[];
}
export interface FamilyDocument {
  id: string; childId: string; kind: DocumentRequest["kind"]; purpose: DocumentRequest["purpose"];
  version: number; status: "active" | "archived"; archivedAt: string | null;
  current: DocumentSnapshot | null; history: DocumentSnapshot[]; manifest?: DocumentManifest;
  readState: "ready" | "stale" | "invalidated"; autoRefresh: boolean;
}
export const documentListQuerySchema = z.object({ cursor: z.string().max(2048).nullable().default(null),
  status: z.enum(["all", "active", "archived"]).default("all"), limit: z.number().int().min(1).max(50).default(50) }).strict();
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export interface DocumentPage { authorityVersion: string; canManage: boolean; items: FamilyDocument[]; hasMore: boolean; nextCursor?: string | null }
export const documentContentQuerySchema = z.object({ snapshotId: z.uuid(), snapshotVersion: z.number().int().positive(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) }).strict();
export type DocumentContentQuery = z.infer<typeof documentContentQuerySchema>;
export interface DocumentContentPage {
  documentId: string; documentVersion: number; authorityVersion: string; snapshotId: string; snapshotVersion: number;
  offset: number; text: string; totalCharacters: number; nextOffset: number | null; complete: boolean;
  contentKind: "snapshot_json" | "redacted_manifest_json"; invalidated: boolean;
}
export interface DocumentVersionPage {
  documentId: string; authorityVersion: string; items: { snapshotId: string; snapshotVersion: number; generatedAt: string; invalidated: boolean }[];
  nextCursor: string | null;
}
export const documentExportSchema = z.object({
  snapshotId: z.uuid(), snapshotVersion: z.number().int().positive(), authorityVersion: z.string().max(128),
  purpose: z.enum(["family", "appointment", "handoff", "school"]), includeSources: z.boolean(), includeRevision: z.boolean(),
}).strict();
export type DocumentExport = z.infer<typeof documentExportSchema>;
