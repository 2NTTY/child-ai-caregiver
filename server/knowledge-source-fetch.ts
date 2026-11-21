import { load } from "cheerio";
import { createHash } from 'node:crypto';
import { platformMediaLink } from '../src/shared/platform-media.ts';
import { readLinkedOfficialPages } from './fhs-source-forms.ts';
import { oralPrint,verifiedOralExcerpts } from './fhs-verified-oral-excerpts.ts';
import { fhsPdfMediaPages, largeFhsPdf, reviewedExternalEdition, reviewedExternalOriginal } from './platform-materials.ts';
import type { SourceFetcher,SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import { parseSourceContent, parsedKnowledgePdfContent } from "./knowledge-source-parser.ts";
import { extractKnowledgePdf, KNOWLEDGE_PDF_MAX_BYTES } from "./knowledge-pdf.ts";
import { fetchPublicSourceResponse } from "./public-source-transport.ts";
export { publicSourceAddress } from "./public-source-transport.ts";

function mediaLinksFromPage($: ReturnType<typeof load>, selector: string, page: string) {
  const region = $(selector);
  if (region.length !== 1) return undefined;
  return [...new Set(region.find('a[href],iframe[src],audio[src],video[src],source[src]').toArray()
    .map(node => platformMediaLink($(node).attr('href') ?? $(node).attr('src') ?? '', page))
    .filter((link): link is string => !!link))].sort();
}

/** The official FHS catalogue emits its download control as one literal leafletBlock call. */
export function fhsLeafletControl($: ReturnType<typeof load>, landing: string) {
  if (new URL(landing).hostname !== 'www.fhs.gov.hk') return undefined;
  const scripts = $('script:not([src])').map((_, el) => $(el).text().trim()).get().filter(script => /^leafletBlock\s*\(/u.test(script));
  if (!scripts.length) return undefined;
  const values = scripts.length === 1 && /^leafletBlock\(\s*"([^"\\]+)"\s*,\s*"([^"\\]+)"\s*,\s*"(\d+)"\s*\);?$/u.exec(scripts[0]!);
  return values && values[2] !== '-1' ? { url: new URL(values[3] + '.pdf', landing).href, title: values[1]! } : null;
}

export function sourceFetchUrl(value: string, definition: SourceWatchDefinition): URL {
  const url = new URL(value), registered = new URL(definition.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || url.hostname !== registered.hostname || (reviewedExternalOriginal(definition.url) ? url.href !== definition.url
      : !["www.fhs.gov.hk","www.studenthealth.gov.hk","www.dh.gov.hk","www.chp.gov.hk","news.rthk.hk","rthk9.rthk.hk"].includes(url.hostname))) {
    throw new Error("source_url_rejected");
  }
  return url;
}

/** Re-read either a fetched or stored original through the same bounded page reader. */
export async function observeKnowledgeLeaflet(definition: SourceWatchDefinition, original: Buffer, title: string,
  revision: string | null, readMethod: string, signal: AbortSignal, reader = extractKnowledgePdf): Promise<Awaited<ReturnType<SourceFetcher>>> {
  if (!definition.leafletPage || definition.kind !== "pdf") throw Error("knowledge_pdf_source_mismatch");
  const large = original.length > KNOWLEDGE_PDF_MAX_BYTES ? largeFhsPdf(definition.url) : undefined;
  if (original.length > KNOWLEDGE_PDF_MAX_BYTES) {
    if (!large || large.sourceId !== definition.id) return { status: 'failed', reason: 'response' };
    const sha256 = createHash('sha256').update(original).digest('hex');
    if (large.bytes !== original.length || large.sha256 !== sha256)
      return { status: 'failed', reason: 'response', pdfEditionReview: { reason: 'new_fingerprint', sha256, bytes: original.length } };
  }
  if (definition.id === oralPrint.sourceId) {
    const printed = verifiedOralExcerpts(definition,createHash('sha256').update(original).digest('hex'),oralPrint.totalPages,title,revision);
    if (printed) return {status:'ok',readMethod:'fhs-independent-printed-excerpts/1',
      original:{mimeType:'application/pdf',bytes:original},items:[printed]};
  }
  let batch = await reader(original, { startPage: 1, pageLimit: 8, ...(large ? { expectedHash: large.sha256 } : {}), signal });
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
    let readMethod: string | undefined, title: string | undefined, revision: string | null = null, mediaLinks: string[] | undefined;
    if (definition.leafletPage === definition.url && pdf) {
      title = definition.title;
      if (!title) return { status: 'failed', reason: 'parse' };
      readMethod = 'catalogue-pdf-original/1';
    } else if (definition.leafletPage) {
      const page = await transport(definition.leafletPage, exact(definition.leafletPage), signal, "text/html");
      if (page.status !== "response") return page;
      if (page.response.status === 404 || page.response.status === 410) return { status: "unavailable", httpStatus: page.response.status };
      if (page.response.status !== 200 || !/^text\/html(?:;|$)/i.test(page.response.contentType)) return { status: "failed", reason: "response" };
      const $ = load(page.response.body.toString("utf8"));
      // Recover a conventional direct link only within the registered leaflet landing page.
      const legacy = fhsLeafletControl($, definition.leafletPage);
      if (legacy !== undefined) {
        if (!legacy || legacy.url !== definition.url)
          return { status: "failed", reason: "parse" };
        title = legacy.title;
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
      mediaLinks = mediaLinksFromPage($, '#content', definition.leafletPage);
    }
    const large = pdf && definition.leafletPage ? largeFhsPdf(definition.url) : undefined;
    let oversizedOfficialPdf = false;
    const fetched = await transport(definition.url, definition.leafletPage || definition.id === "chp-recent" ? exact(definition.url) : value => sourceFetchUrl(value, definition), signal,
      pdf ? "application/pdf" : definition.kind === "rss" ? "application/rss+xml, application/xml, text/xml" : "text/html",
      large && large.sourceId === definition.id ? { maxBytes: large.bytes, onBodyLimit(status, contentType) {
        oversizedOfficialPdf = status === 200 && /^application\/pdf(?:\s*;|$)/iu.test(contentType ?? '');
      } } : pdf ? { maxBytes: KNOWLEDGE_PDF_MAX_BYTES } : {});
    if (fetched.status === 'failed' && large && oversizedOfficialPdf)
      return { status: 'failed', reason: 'response', pdfEditionReview: { reason: 'download_limit', limitBytes: large.bytes } };
    if (fetched.status !== "response") return fetched;
    const result = fetched.response;
    if (result.status === 404 || result.status === 410) return { status: "unavailable", httpStatus: result.status };
    if (result.status !== 200) return { status: "failed", reason: "response" };
    try {
      if (pdf) {
        const approvedHash = reviewedExternalOriginal(definition.url);
        if (approvedHash && createHash('sha256').update(result.body).digest('hex') !== approvedHash)
          return { status: 'failed', reason: 'response' };
        if (!/^application\/pdf(?:;|$)/i.test(result.contentType) || result.body.subarray(0, 5).toString("ascii") !== "%PDF-")
          return { status: "failed", reason: "response" };
        if (definition.leafletPage) {
          if (approvedHash) revision = reviewedExternalEdition(definition.url, approvedHash)?.dateText ?? revision;
          const original = await observeKnowledgeLeaflet(definition, result.body, title!, revision, readMethod!, signal, adapters.pdfReader);
          const landing = definition.leafletPage === definition.url && fhsPdfMediaPages.get(definition.url);
          if (original.status === 'ok' && landing) {
            try {
              const page = await transport(landing, exact(landing), signal, 'text/html');
              if (page.status === 'response' && page.response.status === 200 && (page.response.url ?? landing) === landing
                && /^text\/html(?:;|$)/iu.test(page.response.contentType)) {
                const $ = load(new TextDecoder('utf-8', { fatal: true }).decode(page.response.body));
                const bound = fhsLeafletControl($, landing)?.url === definition.url || $('#content a[href]').toArray()
                  .some(node => new URL($(node).attr('href')!, landing).href === definition.url);
                if (bound) mediaLinks = mediaLinksFromPage($, '#content', landing);
              }
            } catch { signal.throwIfAborted(); }
          }
          if (original.status !== 'ok' || !mediaLinks) return original;
          try {
            const { links, pages } = await readLinkedOfficialPages(mediaLinks, transport, signal);
            return { ...original, mediaLinks: links, mediaPages: pages };
          } catch {
            signal.throwIfAborted();
            return { ...original, mediaLinks };
          }
        }
        const parsed = await (adapters.pdfReader ?? extractKnowledgePdf)(result.body, { startPage: window!.startPage,
          pageLimit: window!.endPage - window!.startPage + 1, signal });
        return { status: "ok", items: parsedKnowledgePdfContent(definition, parsed) };
      }
      if (!/^(text\/html|application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(result.contentType)) return { status: "failed", reason: "response" };
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(result.contentType)?.[1] ?? "utf-8";
      if (!["utf-8", "utf8"].includes(charset.toLowerCase())) return { status: "failed", reason: "response" };
      const html = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
      const items = parseSourceContent(definition, html);
      if (definition.kind === 'page' && definition.selector && new URL(definition.url).hostname === 'www.fhs.gov.hk'
        && (result.url ?? definition.url) === definition.url) {
        mediaLinks = mediaLinksFromPage(load(html), definition.selector, definition.url);
        if (mediaLinks?.length) {
          const { links, pages, scripts } = await readLinkedOfficialPages(mediaLinks, transport, signal);
          if (scripts.length) items[0]!.scripts = scripts;
          return { status: 'ok', mediaLinks: links, mediaPages: pages, items };
        }
      }
      return { status: "ok", ...(mediaLinks ? { mediaLinks } : {}), ...(definition.id === "chp-recent"
        ? { original: { mimeType: "application/rss+xml" as const, bytes: result.body } } : {}), items };
    } catch { return { status: "failed", reason: "parse" }; }
  };
}
export const fetchKnowledgeSource = createKnowledgeSourceFetcher();
