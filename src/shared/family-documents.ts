import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const documentPeriodSchema = z.object({ from: day, to: day }).strict().refine(value => value.from <= value.to);
export const documentRequestSchema = z.object({
  kind: z.enum(["preparation", "growth_report"]),
  purpose: z.enum(["appointment", "school", "outing", "handoff", "family"]),
  title: z.string().trim().min(1).max(160), eventDate: day.nullable(), period: documentPeriodSchema,
}).strict().refine(value => value.kind !== "preparation" || value.purpose !== "family");
export type DocumentRequest = z.infer<typeof documentRequestSchema>;
export const documentChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh"), expectedVersion: z.number().int().positive(), authorityVersion: z.string().max(128) }).strict(),
  z.object({ action: z.enum(["archive", "restore"]), expectedVersion: z.number().int().positive(), authorityVersion: z.string().max(128) }).strict(),
  z.object({ action: z.literal("check_item"), expectedVersion: z.number().int().positive(), authorityVersion: z.string().max(128), sectionId: z.string().max(80), itemId: z.string().max(100), checked: z.boolean() }).strict(),
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
  eventDate: string | null; coverageNote: string; sections: DocumentSection[]; sources: DocumentSource[];
  changes: string[];
}
export interface FamilyDocument {
  id: string; childId: string; kind: DocumentRequest["kind"]; purpose: DocumentRequest["purpose"];
  version: number; status: "active" | "archived"; archivedAt: string | null;
  current: DocumentSnapshot | null; history: DocumentSnapshot[];
  readState: "ready" | "stale" | "invalidated"; autoRefresh: boolean;
}
export interface DocumentPage { authorityVersion: string; canManage: boolean; items: FamilyDocument[]; hasMore: boolean }
export const documentExportSchema = z.object({
  snapshotId: z.uuid(), snapshotVersion: z.number().int().positive(), authorityVersion: z.string().max(128),
  purpose: z.enum(["family", "appointment", "handoff", "school"]), includeSources: z.boolean(), includeRevision: z.boolean(),
}).strict();
export type DocumentExport = z.infer<typeof documentExportSchema>;
