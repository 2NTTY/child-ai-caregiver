import { z } from "zod";
import { resolveApiBaseUrl } from "../config/api-base-url.ts";
import { documentChangeSchema, documentExportSchema, documentPeriodSchema, documentRequestSchema, documentContentQuerySchema, documentListQuerySchema, reportCoverageSchema, reportProgressSchema,
  type DocumentContentPage, type DocumentContentQuery, type DocumentVersionPage, type DocumentListQuery, type DocumentChange, type DocumentExport, type DocumentPage, type DocumentRequest, type FamilyDocument } from "../shared/family-documents.ts";

export class FamilyDocumentApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status = 0, code: string | null = null) {
    super("Document request could not be confirmed"); this.name = "FamilyDocumentApiError";
    this.status = status; this.code = code;
  }
}
export const requiresFreshDocumentConfirmation = (error: FamilyDocumentApiError) => error.status >= 400 && error.status < 500;
const uuid = z.uuid(), version = z.number().int().positive(), timestamp = z.iso.datetime({ offset: true });
const sourceSchema = z.object({ id: z.string(), resourceId: z.string(), kind: z.enum(["profile", "record", "fact", "task", "concern"]),
  version: z.number().int().nonnegative(), label: z.string(), text: z.string(), at: z.string().nullable() }).strict();
const sectionSchema = z.object({ id: z.string(), title: z.string(), kind: z.enum(["notes", "questions", "checklist"]),
  domain: z.enum(["profile", "body_life", "abilities_interests", "concerns", "changes_support"]).nullable(),
  items: z.array(z.object({ id: z.string(), text: z.string(), sourceIds: z.array(z.string()), checked: z.boolean().optional() }).strict()) }).strict();
const snapshotSchema = z.object({ id: uuid, version, generatedAt: timestamp, sourceBasis: z.string(), title: z.string(), summary: z.string(),
  ageLabel: z.string(), period: documentPeriodSchema, eventDate: z.string().nullable(), coverageNote: z.string(),
  sections: z.array(sectionSchema), sources: z.array(sourceSchema), changes: z.array(z.string()), reportCoverage: reportCoverageSchema.optional(),
  editProtection: z.object({ sectionIds: z.array(z.string()), removedSectionIds: z.array(z.string()), metadataFields: z.array(z.enum(["title", "summary", "eventDate"])) }).strict().optional() }).strict();
const manifestSchema = z.object({ snapshotId: uuid, snapshotVersion: version, invalidated: z.boolean(),
  sections: z.array(z.object({ id: z.string(), kind: z.enum(["notes", "questions", "checklist"]), itemIds: z.array(z.string()) }).strict()) }).strict();
const contentPageSchema = z.object({ documentId: uuid, documentVersion: version, authorityVersion: z.string(), snapshotId: uuid, snapshotVersion: version,
  offset: z.number().int().nonnegative(), text: z.string().max(4000), totalCharacters: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(), complete: z.boolean(), invalidated: z.boolean(), contentKind: z.enum(["snapshot_json", "redacted_manifest_json"]) }).strict();
const versionPageSchema = z.object({ documentId: uuid, authorityVersion: z.string(), items: z.array(z.object({ snapshotId: uuid,
  snapshotVersion: version, generatedAt: timestamp, invalidated: z.boolean() }).strict()).max(10), nextCursor: z.string().max(2048).nullable() }).strict();
const itemSchema = z.object({ id: uuid, childId: uuid, kind: z.enum(["preparation", "growth_report"]),
  purpose: z.enum(["appointment", "school", "outing", "handoff", "family"]), version, status: z.enum(["active", "archived"]),
  archivedAt: timestamp.nullable(), current: snapshotSchema.nullable(), history: z.array(snapshotSchema),
  readState: z.enum(["ready", "stale", "invalidated"]), autoRefresh: z.boolean(), manifest: manifestSchema.optional(), report: reportProgressSchema.optional() }).strict();
const pageSchema = z.object({ authorityVersion: z.string(), canManage: z.boolean(), items: z.array(itemSchema), hasMore: z.boolean(), nextCursor: z.string().max(2048).nullable().optional() }).strict();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const unique = (values: string[]) => new Set(values).size === values.length;
function checkedItem(value: unknown, childId: string, id?: string): FamilyDocument {
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success || parsed.data.childId !== childId || id !== undefined && parsed.data.id !== id) throw new FamilyDocumentApiError();
  const item = parsed.data;
  if (item.kind === "preparation" && item.purpose === "family" || item.readState === "invalidated" && item.current) throw new FamilyDocumentApiError();
  const snapshots = [...(item.current ? [item.current] : []), ...item.history];
  if (!unique(snapshots.map(snapshot => snapshot.id + ":" + snapshot.version))) throw new FamilyDocumentApiError();
  for (const snapshot of snapshots) {
    if (!unique(snapshot.sources.map(source => source.id)) || !unique(snapshot.sections.map(section => section.id))) throw new FamilyDocumentApiError();
    for (const section of snapshot.sections) {
      if (!unique(section.items.map(entry => entry.id)) || section.items.some(entry => !unique(entry.sourceIds) || entry.sourceIds.some(id => !snapshot.sources.some(source => source.id === id)))) throw new FamilyDocumentApiError();
    }
  }
  return item;
}
interface PendingWrite { kind: "create" | "change"; childId: string; userId: string; id: string; payload: string; body: string; reviewed: boolean; reconfirm: boolean; everUnknown: boolean; opId: string }
export function createFamilyDocumentsApi(baseUrl = "", fetcher: typeof fetch = fetch) {
  const base = resolveApiBaseUrl(baseUrl), apiUrl = base.endsWith("/api") ? base : base + "/api";
  let pending: PendingWrite | null = null, activeScope = "";
  function scope(childId: string, userId: string) {
    if (!uuid.safeParse(childId).success || !/^[A-Za-z0-9_-]{1,128}$/u.test(userId)) throw new FamilyDocumentApiError(400, "invalid_input");
    const next = userId + ":" + childId;
    if (activeScope !== next) { pending = null; activeScope = next; }
  }
  const path = (childId: string) => "/children/" + encodeURIComponent(childId) + "/documents";
  async function request(url: string, signal: AbortSignal, userId: string, body?: string, pdf = false): Promise<unknown> {
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const timeout = setTimeout(abort, pdf ? 30_000 : body === undefined ? 15_000 : 20_000);
    try {
      if (controller.signal.aborted) throw new FamilyDocumentApiError();
      const response = await fetcher(apiUrl + url, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: pdf ? "application/pdf" : "application/json", "x-expected-user-id": userId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body }), signal: controller.signal });
      if (!response.ok) {
        let code: string | null = null;
        try { const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string" && /^[a-z_]{1,80}$/u.test(value.error.code)) code = value.error.code;
        } catch { /* Preserve the HTTP status without exposing a response body. */ }
        if (controller.signal.aborted) throw new FamilyDocumentApiError();
        throw new FamilyDocumentApiError(response.status, code);
      }
      if (pdf && !/^application\/pdf(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) throw new FamilyDocumentApiError();
      const value: unknown = pdf ? await response.blob() : await response.json();
      if (controller.signal.aborted || pdf && (!(value instanceof Blob) || !value.size)) throw new FamilyDocumentApiError();
      return value;
    } catch (error) { if (error instanceof FamilyDocumentApiError) throw error; throw new FamilyDocumentApiError(); }
    finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  }
  function begin(kind: PendingWrite["kind"], childId: string, id: string, userId: string, input: DocumentRequest | DocumentChange) {
    const payload = JSON.stringify(input);
    if (pending) {
      if (!pending.reviewed || pending.kind !== kind || pending.childId !== childId || pending.id !== id || pending.userId !== userId || pending.payload !== payload)
        throw new FamilyDocumentApiError(0, "check_original_document");
      pending.reviewed = false; return pending;
    }
    const opId = crypto.randomUUID(), body = JSON.stringify({ opId, [kind === "create" ? "request" : "change"]: input });
    return pending = { kind, childId, id, userId, payload, body, opId, reviewed: false, reconfirm: false, everUnknown: false };
  }
  async function write(kind: PendingWrite["kind"], childId: string, id: string, userId: string, input: DocumentRequest | DocumentChange, signal: AbortSignal) {
    const attempt = begin(kind, childId, id, userId, input);
    try {
      const value = await request(path(childId) + (kind === "change" ? "/" + encodeURIComponent(id) + "/actions" : ""), signal, userId, attempt.body);
      const item = checkedItem(object(value) ? value.item : null, childId, kind === "change" ? id : undefined);
      if (item.version !== ("expectedVersion" in input ? input.expectedVersion + 1 : 1)
        || "action" in input && (input.action === "archive" && item.status !== "archived" || input.action === "restore" && item.status !== "active")) throw new FamilyDocumentApiError();
      if (pending === attempt) pending = null;
      return item;
    } catch (error) {
      if (pending === attempt && error instanceof FamilyDocumentApiError) {
        attempt.everUnknown ||= !requiresFreshDocumentConfirmation(error);
        // A later rejection does not settle an earlier request with an unknown outcome.
        attempt.reconfirm = requiresFreshDocumentConfirmation(error) && !attempt.everUnknown;
      }
      throw error;
    }
  }
  return {
    reset() { pending = null; activeScope = ""; },
    pendingReference() { return pending?.opId ?? null; },
    hasUnknownOriginal() { return pending?.everUnknown === true; },
    async getPage(childId: string, signal: AbortSignal, userId: string, options: Partial<DocumentListQuery> = {}): Promise<DocumentPage> {
      scope(childId, userId);
      const input = documentListQuerySchema.safeParse(options); if (!input.success) throw new FamilyDocumentApiError(400, "invalid_input");
      const query = new URLSearchParams({ status: input.data.status, limit: String(input.data.limit) });
      if (input.data.cursor) query.set("cursor", input.data.cursor);
      const value = await request(path(childId) + (Object.keys(options).length ? "?" + query : ""), signal, userId), parsed = pageSchema.safeParse(object(value) ? value.page : null);
      if (!parsed.success || !unique(parsed.data.items.map(item => item.id))) throw new FamilyDocumentApiError();
      const page: DocumentPage = { ...parsed.data, items: parsed.data.items.map(item => checkedItem(item, childId)) };
      if (pending) {
        if (pending.reconfirm) pending = null;
        else pending.reviewed = pending.kind === "create" || page.items.some(item => item.id === pending!.id);
      }
      return page;
    },
    async getItem(childId: string, id: string, signal: AbortSignal, userId: string) {
      scope(childId, userId); if (!uuid.safeParse(id).success) throw new FamilyDocumentApiError(400, "invalid_input");
      const value = await request(path(childId) + "/" + encodeURIComponent(id), signal, userId);
      const item = checkedItem(object(value) ? value.item : null, childId, id);
      if (pending?.kind === "change" && pending.id === id && !pending.reconfirm) pending.reviewed = true;
      return item;
    },
    async readContent(childId: string, id: string, raw: DocumentContentQuery, signal: AbortSignal, userId: string): Promise<DocumentContentPage> {
      scope(childId, userId); const input = documentContentQuerySchema.safeParse(raw);
      if (!uuid.safeParse(id).success || !input.success) throw new FamilyDocumentApiError(400, "invalid_input");
      const query = new URLSearchParams({ snapshotId: input.data.snapshotId, snapshotVersion: String(input.data.snapshotVersion), offset: String(input.data.offset) });
      const value = await request(path(childId) + "/" + encodeURIComponent(id) + "/content?" + query, signal, userId);
      const parsed = contentPageSchema.safeParse(object(value) ? value.page : null);
      if (!parsed.success || parsed.data.documentId !== id || parsed.data.snapshotId !== input.data.snapshotId || parsed.data.snapshotVersion !== input.data.snapshotVersion
        || parsed.data.offset !== input.data.offset)
        throw new FamilyDocumentApiError();
      const page = parsed.data, end = page.offset + page.text.length;
      if (page.invalidated !== (page.contentKind === "redacted_manifest_json") || end > page.totalCharacters
        || page.complete !== (end === page.totalCharacters) || page.nextOffset !== (page.complete ? null : end)) throw new FamilyDocumentApiError();
      return page;
    },
    async getVersions(childId: string, id: string, signal: AbortSignal, userId: string, cursor: string | null = null): Promise<DocumentVersionPage> {
      scope(childId, userId);
      if (!uuid.safeParse(id).success || cursor !== null && !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new FamilyDocumentApiError(400, "invalid_input");
      const value = await request(path(childId) + "/" + encodeURIComponent(id) + "/versions" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), signal, userId);
      const parsed = versionPageSchema.safeParse(object(value) ? value.page : null);
      if (!parsed.success || parsed.data.documentId !== id || !unique(parsed.data.items.map(item => item.snapshotId)) || !unique(parsed.data.items.map(item => String(item.snapshotVersion)))) throw new FamilyDocumentApiError();
      return parsed.data;
    },
    async create(childId: string, raw: DocumentRequest, signal: AbortSignal, userId: string) {
      scope(childId, userId); const parsed = documentRequestSchema.safeParse(raw);
      if (!parsed.success) throw new FamilyDocumentApiError(400, "invalid_input");
      return write("create", childId, "", userId, parsed.data, signal);
    },
    async change(childId: string, id: string, raw: DocumentChange, signal: AbortSignal, userId: string) {
      scope(childId, userId); const parsed = documentChangeSchema.safeParse(raw);
      if (!uuid.safeParse(id).success || !parsed.success) throw new FamilyDocumentApiError(400, "invalid_input");
      return write("change", childId, id, userId, parsed.data, signal);
    },
    async exportPdf(childId: string, id: string, raw: DocumentExport, signal: AbortSignal, userId: string): Promise<Blob> {
      scope(childId, userId); const parsed = documentExportSchema.safeParse(raw);
      if (!uuid.safeParse(id).success || !parsed.success) throw new FamilyDocumentApiError(400, "invalid_input");
      return await request(path(childId) + "/" + encodeURIComponent(id) + "/pdf", signal, userId, JSON.stringify(parsed.data), true) as Blob;
    },
  };
}
