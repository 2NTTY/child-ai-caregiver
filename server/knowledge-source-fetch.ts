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
    let title: string | undefined, revision: string | null = null;
    if (definition.leafletPage) {
      const page = await transport(definition.leafletPage, exact(definition.leafletPage), signal, "text/html");
      if (page.status !== "response") return page;
      if (page.response.status === 404 || page.response.status === 410) return { status: "unavailable", httpStatus: page.response.status };
      if (page.response.status !== 200 || !/^text\/html(?:;|$)/i.test(page.response.contentType)) return { status: "failed", reason: "response" };
      const $ = load(page.response.body.toString("utf8"));
      // The FHS template passes three string literals to leafletBlock. Never run remote JavaScript.
      const matches = $("script:not([src])").map((_, el) => $(el).text().trim()).get()
        .map(script => /^leafletBlock\(\s*"([^"\\]+)"\s*,\s*"([^"\\]+)"\s*,\s*"(\d+)"\s*\);?$/u.exec(script)).filter(match => match !== null);
      const entry = matches[0];
      if (matches.length !== 1 || !entry || entry[2] === "-1" || new URL(entry[3] + ".pdf", definition.leafletPage).href !== definition.url)
        return { status: "failed", reason: "parse" };
      title = entry[1]; revision = $("#content-rev-date").text().trim() || null;
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
          const reader = adapters.pdfReader ?? extractKnowledgePdf;
          let batch = await reader(result.body, { startPage: 1, pageLimit: 8, signal });
          const { fileHash, totalPages } = batch;
          if (totalPages > 32) return { status: "failed", reason: "parse" };
          const pages = [...batch.pages];
          while (batch.nextPage !== null) {
            batch = await reader(result.body, { startPage: pages.length + 1, pageLimit: 8, expectedHash: fileHash, signal });
            if (!batch.pages.length || batch.totalPages !== totalPages) return { status: "failed", reason: "parse" };
            pages.push(...batch.pages);
          }
          if (pages.length !== totalPages || pages.some((p, i) => p.page !== i + 1)) return { status: "failed", reason: "parse" };
          return { status: "ok", original: { mimeType: "application/pdf", bytes: result.body }, items: [{
            url: definition.url, title: title!, text: pages.map(p => p.text).join("\n\n"), pages,
            sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: revision,
            extraction: { format: "text_pdf", contentHash: fileHash, extractionQuality: "requires_review",
              totalPages, pageStart: 1, pageEnd: totalPages, complete: true },
          }] };
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
