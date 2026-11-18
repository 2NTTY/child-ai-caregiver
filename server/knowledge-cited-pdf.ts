import { createHash } from "node:crypto";
import type { KnowledgeEvidence } from "../src/shared/knowledge.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { KNOWLEDGE_PDF_MAX_BYTES } from "./knowledge-pdf.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import { sourceFetchUrl } from "./knowledge-source-fetch.ts";
import { fetchPublicSourceResponse } from "./public-source-transport.ts";
import { apiError } from "./workspace-api.ts";

export type SavedCitationIdentity = Pick<KnowledgeEvidence, "chunkId" | "sourceId" | "versionId" | "versionHash" | "contentHash" | "url">;
export interface CitedPdf { sourceId: string; url: string; sha256: string }
export interface KnowledgeOriginalPort {
  resolve(citation: SavedCitationIdentity): Promise<CitedPdf | null>;
  read(target: CitedPdf, signal: AbortSignal): Promise<Buffer | null>;
}

// Legacy editions may have a verified file hash but no stored original. Only the catalogue can supply its address.
export async function readPublisherPdf(target: CitedPdf, signal: AbortSignal): Promise<Buffer | null> {
  const watch = SOURCE_WATCHES.find(item => item.id === target.sourceId && item.url === target.url && item.kind === "pdf");
  if (watch?.audience !== "public_noncommercial") return null;
  const result = await fetchPublicSourceResponse(watch.url, value => sourceFetchUrl(value, watch), signal,
    "application/pdf", { maxBytes: KNOWLEDGE_PDF_MAX_BYTES });
  if (result.status !== "response") throw new Error("citation_publisher_unavailable");
  if (result.response.status === 404 || result.response.status === 410) return null;
  if (result.response.status !== 200) throw new Error("citation_publisher_unavailable");
  if (!/^application\/pdf(?:\s*;|$)/iu.test(result.response.contentType)) return null;
  return result.response.body;
}

const uuid = "([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
export const citedPdfRoute = new RegExp(`^/api/children/${uuid}/agent/runs/${uuid}/citations/${uuid}/original$`, "iu");

export async function openCitedPdf(request: Request, chunkId: string,
  readRun: () => Promise<Pick<ProductAgentResult, "status" | "citations"> | null>, originals: KnowledgeOriginalPort) {
  if (request.method !== "GET") return apiError("method_not_allowed", "請重新開啟原件。", 405);
  if (new URL(request.url).search) return apiError("invalid_input", "原件位置無效。", 400);
  const saved = async () => {
    const run = await readRun();
    const cited = run?.status === "completed" && run.citations.find(item => item.chunkId === chunkId);
    return cited && cited.usageScope !== "internal_noncommercial" ? originals.resolve(cited) : null;
  };
  const unavailable = () => apiError("citation_original_unavailable", "目前無法開啟這個版本的原件。", 404);
  const target = await saved();
  if (!target) return unavailable();
  let bytes: Buffer | null;
  try { bytes = await originals.read(target, request.signal); }
  catch { return apiError("citation_original_service_unavailable", "暫時未能讀取原件，請稍後再試。", 503); }
  if (!bytes) return unavailable();
  if (bytes.length > KNOWLEDGE_PDF_MAX_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    || createHash("sha256").update(bytes).digest("hex") !== target.sha256)
    return apiError("citation_original_changed", "檔案與當時引用的版本不同。", 409);
  const current = await saved();
  if (!current || current.sourceId !== target.sourceId || current.sha256 !== target.sha256 || current.url !== target.url) return unavailable();
  return new Response(new Uint8Array(bytes), { headers: {
    "content-type": "application/pdf", "content-length": String(bytes.byteLength), "content-disposition": 'inline; filename="source.pdf"',
    "content-security-policy": "sandbox", "x-content-type-options": "nosniff", "cache-control": "private, no-store",
  } });
}
