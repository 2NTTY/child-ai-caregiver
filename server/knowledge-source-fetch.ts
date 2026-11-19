import { load } from "cheerio";
import type { SourceFetcher,SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import { parseSourceContent, parsedKnowledgePdfContent } from "./knowledge-source-parser.ts";
import { extractKnowledgePdf, KNOWLEDGE_PDF_MAX_BYTES } from "./knowledge-pdf.ts";
import { fetchPublicSourceResponse } from "./public-source-transport.ts";
export { publicSourceAddress } from "./public-source-transport.ts";

export function sourceFetchUrl(value: string, definition: SourceWatchDefinition): URL {
  const url = new URL(value), registered = new URL(definition.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || url.hostname !== registered.hostname || !["www.fhs.gov.hk","www.studenthealth.gov.hk","www.dh.gov.hk","www.chp.gov.hk","news.rthk.hk","rthk9.rthk.hk"].includes(url.hostname)) {
    throw new Error("source_url_rejected");
  }
  return url;
}

/** Re-read either a fetched or stored original through the same bounded page reader. */
export async function observeKnowledgeLeaflet(definition: SourceWatchDefinition, original: Buffer, title: string,
  revision: string | null, readMethod: string, signal: AbortSignal, reader = extractKnowledgePdf): Promise<Awaited<ReturnType<SourceFetcher>>> {
  if (!definition.leafletPage || definition.kind !== "pdf") throw Error("knowledge_pdf_source_mismatch");
  let batch = await reader(original, { startPage: 1, pageLimit: 8, signal });
  const { fileHash, totalPages } = batch;
  const windowed = (): Awaited<ReturnType<SourceFetcher>> => ({
    status: "ok", readMethod, original: { mimeType: "application/pdf", bytes: original }, items: [{
      url: definition.url, title, text: "", nativeWindowMethod: "native-pdf-window/1",
      sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: revision,
      extraction: { format: "text_pdf", contentHash: fileHash, extractionQuality: "requires_review",
        totalPages, pageStart: 1, pageEnd: totalPages, complete: false },
    }],
  });
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || !batch.pages.length) return { status: "failed", reason: "parse" };
  if (totalPages > 32 || batch.pages.some(p => p.status !== "text") || batch.pages.reduce((n, p) => n + p.text.length, 0) > 60000)
    return windowed();
  const pages = [...batch.pages];
  while (batch.nextPage !== null) {
    batch = await reader(original, { startPage: pages.length + 1, pageLimit: 8, expectedHash: fileHash, signal });
    if (!batch.pages.length || batch.totalPages !== totalPages) return { status: "failed", reason: "parse" };
    if (batch.pages.some(p=>p.status!=="text")) return windowed();
    pages.push(...batch.pages);
    if (pages.reduce((sum,p)=>sum+p.text.length,0)>60000) return windowed();
  }
  if (pages.length !== totalPages || pages.some((p, i) => p.page !== i + 1)) return { status: "failed", reason: "parse" };
  return { status: "ok", readMethod, original: { mimeType: "application/pdf", bytes: original }, items: [{
    url: definition.url, title, text: pages.map(p => p.text).join("\n\n"), pages,
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: revision,
    extraction: { format: "text_pdf", contentHash: fileHash, extractionQuality: "requires_review",
      totalPages, pageStart: 1, pageEnd: totalPages, complete: true },
  }] };
}

export function createKnowledgeSourceFetcher(adapters: { transport?: typeof fetchPublicSourceResponse; pdfReader?: typeof extractKnowledgePdf } = {}): SourceFetcher {
  return async (definition, signal) => {
    const pdf = definition.kind === "pdf", window = definition.pdfPages;
    if (pdf && !definition.leafletPage && (!window || !Number.isSafeInteger(window.startPage) || !Number.isSafeInteger(window.endPage)
      || window.startPage < 1 || window.endPage < window.startPage || window.endPage - window.startPage >= 8)) return { status: "failed", reason: "parse" };
    const transport = adapters.transport ?? fetchPublicSourceResponse;
    const exact = (expected: string) => (value: string) => {
      const url = sourceFetchUrl(value, definition);
      if (url.href !== expected) throw new Error("source_url_rejected");
      return url;
    };
    let readMethod: string | undefined, title: string | undefined, revision: string | null = null;
    if (definition.leafletPage) {
      const page = await transport(definition.leafletPage, exact(definition.leafletPage), signal, "text/html");
      if (page.status !== "response") return page;
      if (page.response.status === 404 || page.response.status === 410) return { status: "unavailable", httpStatus: page.response.status };
      if (page.response.status !== 200 || !/^text\/html(?:;|$)/i.test(page.response.contentType)) return { status: "failed", reason: "response" };
      const $ = load(page.response.body.toString("utf8"));
      // Recover a conventional direct link only within the registered leaflet landing page.
      const scripts = $("script:not([src])").map((_, el) => $(el).text().trim()).get()
        .filter(script => /^leafletBlock\s*\(/u.test(script));
      if (scripts.length) {
        const legacy = scripts.length === 1 && /^leafletBlock\(\s*"([^"\\]+)"\s*,\s*"([^"\\]+)"\s*,\s*"(\d+)"\s*\);?$/u.exec(scripts[0]!);
        if (!legacy || legacy[2] === "-1" || new URL(legacy[3] + ".pdf", definition.leafletPage).href !== definition.url)
          return { status: "failed", reason: "parse" };
        title = legacy[1];
        readMethod = "fhs-leaflet-block/1";
      } else {
        const region = $("#content, main, article").first();
        const matches = region.find("a[href]").filter((_, a) => {
          try { return new URL($(a).attr("href")!, definition.leafletPage).href === definition.url; }
          catch { return false; }
        });
        const heading = region.find("h1,h2").first().text().trim();
        if (matches.length !== 1 || !heading || !matches.text().trim()) return { status: "failed", reason: "parse" };
        title = heading;
        readMethod = "fhs-registered-pdf-anchor/1";
      }
      revision = $("#content-rev-date").text().trim() || null;
    }
    const fetched = await transport(definition.url, definition.leafletPage || definition.id === "chp-recent" ? exact(definition.url) : value => sourceFetchUrl(value, definition), signal,
      pdf ? "application/pdf" : definition.kind === "rss" ? "application/rss+xml, application/xml, text/xml" : "text/html",
      pdf ? { maxBytes: KNOWLEDGE_PDF_MAX_BYTES } : {});
    if (fetched.status !== "response") return fetched;
    const result = fetched.response;
    if (result.status === 404 || result.status === 410) return { status: "unavailable", httpStatus: result.status };
    if (result.status !== 200) return { status: "failed", reason: "response" };
    try {
      if (pdf) {
        if (!/^application\/pdf(?:;|$)/i.test(result.contentType) || result.body.subarray(0, 5).toString("ascii") !== "%PDF-")
          return { status: "failed", reason: "response" };
        if (definition.leafletPage) {
          return await observeKnowledgeLeaflet(definition, result.body, title!, revision, readMethod!, signal, adapters.pdfReader);
        }
        const parsed = await (adapters.pdfReader ?? extractKnowledgePdf)(result.body, { startPage: window!.startPage,
          pageLimit: window!.endPage - window!.startPage + 1, signal });
        return { status: "ok", items: parsedKnowledgePdfContent(definition, parsed) };
      }
      if (!/^(text\/html|application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(result.contentType)) return { status: "failed", reason: "response" };
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(result.contentType)?.[1] ?? "utf-8";
      if (!["utf-8", "utf8"].includes(charset.toLowerCase())) return { status: "failed", reason: "response" };
      return { status: "ok", ...(definition.id === "chp-recent" ? { original: { mimeType: "application/rss+xml" as const, bytes: result.body } } : {}), items: parseSourceContent(definition, new TextDecoder("utf-8", { fatal: true }).decode(result.body)) };
    } catch { return { status: "failed", reason: "parse" }; }
  };
}
export const fetchKnowledgeSource = createKnowledgeSourceFetcher();
