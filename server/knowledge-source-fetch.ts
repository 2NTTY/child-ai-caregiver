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
    if (pdf && (!window || !Number.isSafeInteger(window.startPage) || !Number.isSafeInteger(window.endPage)
      || window.startPage < 1 || window.endPage < window.startPage || window.endPage - window.startPage >= 8)) return { status: "failed", reason: "parse" };
    const fetched = await (adapters.transport ?? fetchPublicSourceResponse)(definition.url, value => sourceFetchUrl(value, definition), signal,
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
        const parsed = await (adapters.pdfReader ?? extractKnowledgePdf)(result.body, { startPage: window!.startPage,
          pageLimit: window!.endPage - window!.startPage + 1, signal });
        return { status: "ok", items: parsedKnowledgePdfContent(definition, parsed) };
      }
      if (!/^(text\/html|application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(result.contentType)) return { status: "failed", reason: "response" };
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(result.contentType)?.[1] ?? "utf-8";
      if (!["utf-8", "utf8"].includes(charset.toLowerCase())) return { status: "failed", reason: "response" };
      return { status: "ok", items: parseSourceContent(definition, new TextDecoder("utf-8", { fatal: true }).decode(result.body)) };
    } catch { return { status: "failed", reason: "parse" }; }
  };
}
export const fetchKnowledgeSource = createKnowledgeSourceFetcher();
