import { z } from "zod";
import type { DocumentManifest, DocumentSnapshot, DocumentContentPage } from "../src/shared/family-documents.ts";
import { FamilyError } from "./family-access.ts";
const position = z.object({ at: z.iso.datetime({ precision: 6 }), id: z.uuid() }).strict();
const listCursorSchema = z.object({ v: z.literal(1), kind: z.literal("documents"), userId: z.string().min(1).max(128), childId: z.uuid(),
  status: z.enum(["all", "active", "archived"]), high: position, after: position }).strict();
const versionCursorSchema = z.object({ v: z.literal(1), kind: z.literal("versions"), userId: z.string().min(1).max(128), childId: z.uuid(), documentId: z.uuid(),
  high: z.number().int().min(1), after: z.number().int().min(1) }).strict();
export type DocumentListCursor = z.infer<typeof listCursorSchema>;
export type DocumentVersionCursor = z.infer<typeof versionCursorSchema>;
export function encodeDocumentCursor(value: DocumentListCursor | DocumentVersionCursor) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeDocumentCursor(raw: string, kind: "documents", userId: string, childId: string, filter: string): DocumentListCursor;
export function decodeDocumentCursor(raw: string, kind: "versions", userId: string, childId: string, filter: string): DocumentVersionCursor;
export function decodeDocumentCursor(raw: string, kind: "documents" | "versions", userId: string, childId: string, filter: string) {
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, "base64url"); if (bytes.toString("base64url") !== raw) throw new Error();
    const value = kind === "documents" ? listCursorSchema.parse(JSON.parse(bytes.toString("utf8"))) : versionCursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (value.userId !== userId || value.childId !== childId || (value.kind === "documents" ? value.status : value.documentId) !== filter) throw new Error();
    if (value.kind === "versions" && value.after > value.high) throw new Error();
    if (value.kind === "documents" && (value.after.at > value.high.at || value.after.at === value.high.at && value.after.id > value.high.id)) throw new Error();
    return value;
  } catch { throw new FamilyError(400, "invalid_input"); }
}
export function documentManifest(snapshot: DocumentSnapshot, invalidated: boolean): DocumentManifest {
  return { snapshotId: snapshot.id, snapshotVersion: snapshot.version, invalidated,
    sections: snapshot.sections.map(section => ({ id: section.id, kind: section.kind, itemIds: section.items.map(item => item.id) })) };
}
export function sliceDocumentContent(snapshot: DocumentSnapshot, valid: boolean, offset: number): Pick<DocumentContentPage, "snapshotId" | "snapshotVersion" | "offset" | "text" | "totalCharacters" | "nextOffset" | "complete" | "contentKind" | "invalidated"> {
  const serialized = JSON.stringify(valid ? snapshot : documentManifest(snapshot, true));
  if (offset > serialized.length) throw new FamilyError(400, "invalid_input");
  const text = serialized.slice(offset, offset + 4000), end = offset + text.length;
  return { snapshotId: snapshot.id, snapshotVersion: snapshot.version, offset, text, totalCharacters: serialized.length,
    nextOffset: end < serialized.length ? end : null, complete: end === serialized.length, invalidated: !valid,
    contentKind: valid ? "snapshot_json" : "redacted_manifest_json" };
}
