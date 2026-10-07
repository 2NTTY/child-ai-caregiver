import { load, type CheerioAPI } from "cheerio";
import type { ObservedContent, SourceWatchDefinition } from "./knowledge-refresh-types.ts";

const MAX_INPUT_LENGTH = 1024 * 1024;
const MAX_PAGE_LENGTH = 64_000;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 300;
const MAX_DATE_LENGTH = 200;
const MAX_FEED_ITEMS = 50;
const NOISE_SELECTOR = "script,style,nav,footer,iframe,#qrcode-block-wrapper,#related-sections,#print-version,#content-rev-date";
const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,ul,ol,div,section,article,blockquote,pre,table,tr,th,td,dl,dt,dd,figcaption";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NAMED_OFFSETS: Readonly<Record<string, number>> = {
  UT: 0, UTC: 0, GMT: 0, EST: -300, EDT: -240, CST: -360, CDT: -300,
  MST: -420, MDT: -360, PST: -480, PDT: -420,
};

function invalidContent(): never {
  throw new Error("Invalid source content");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function checkLength(value: string, limit: number): void {
  if (value.length > limit) invalidContent();
}

function readHtmlText($: CheerioAPI, selector: string): string {
  const content = $(selector);
  content.find(NOISE_SELECTOR).remove();
  content.find("br,hr").replaceWith(" ");
  content.find(BLOCK_SELECTOR).each((_, node) => { $(node).prepend(" ").append(" "); });
  return normalizeWhitespace(content.text());
}

function parsePage(definition: SourceWatchDefinition, body: string): ObservedContent[] {
  if (!definition.selector) invalidContent();
  const $ = load(body);
  const content = $(definition.selector);
  if (content.length !== 1) invalidContent();
  const dateText = normalizeWhitespace(content.find("#content-rev-date").first().text());
  checkLength(dateText, MAX_DATE_LENGTH);
  const text = readHtmlText($, definition.selector);
  const title = normalizeWhitespace(content.find("h2").first().text());
  checkLength(title, MAX_TITLE_LENGTH);
  checkLength(text, MAX_PAGE_LENGTH);
  if (!title || !text) invalidContent();
  return [{ url: definition.url, title, text, sourcePublishedAt: null, sourceUpdatedAt: null,
    sourceDateText: dateText || null }];
}

function parseOffset(value: string): number | null {
  if (value === "Z") return 0;
  const named = NAMED_OFFSETS[value.toUpperCase()];
  if (named !== undefined) return named;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function timestamp(year: number, month: number, day: number, hour: number, minute: number,
  second: number, offset: number, fraction?: string, weekday?: string): string | null {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!
    || hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (weekday && WEEKDAYS[local.getUTCDay()] !== weekday.toLowerCase()) return null;
  const utc = new Date(local.getTime() - offset * 60_000);
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) return null;
  const result = utc.toISOString();
  return fraction ? result.replace(/\.000Z$/, `.${fraction}Z`) : result;
}

function publishedTimestamp(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (iso) {
    const offset = parseOffset(iso[8]!);
    return offset === null ? null : timestamp(Number(iso[1]), Number(iso[2]), Number(iso[3]),
      Number(iso[4]), Number(iso[5]), Number(iso[6] ?? 0), offset, iso[7]);
  }
  const rfc = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),? )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? ([+-]\d{4}|UT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i.exec(value);
  if (!rfc) return null;
  const offset = parseOffset(rfc[8]!);
  return offset === null ? null : timestamp(Number(rfc[4]), MONTHS.indexOf(rfc[3]!.toLowerCase()) + 1,
    Number(rfc[2]), Number(rfc[5]), Number(rfc[6]), Number(rfc[7] ?? 0), offset, undefined, rfc[1]);
}

function itemUrl(link: string, definition: SourceWatchDefinition): string | null {
  if (/[\u0000-\u0020\u007f\\]/u.test(link)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\/[^/]/i.test(link)) return null;
  if (link.startsWith("//") && !/^\/\/[^/]/.test(link)) return null;
  try {
    const url = new URL(link, definition.url);
    const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(link)?.[1];
    if (authority && (authority.includes("@") || (authority.includes(":") && !/^\[[^\]]+\]$/.test(authority)))) return null;
    const hosts = definition.itemHosts ?? [new URL(definition.url).hostname];
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.port
      || !hosts.some(host => host.toLowerCase() === url.hostname.toLowerCase())) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function parseRss(definition: SourceWatchDefinition, body: string): ObservedContent[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body)) invalidContent();
  const $ = load(body, { xml: true });
  const root = $.root().children();
  if (root.length !== 1 || root.get(0)?.name !== "rss") invalidContent();
  const channel = root.children("channel");
  if (channel.length !== 1) invalidContent();
  const sourceItems = channel.children("item").slice(0, MAX_FEED_ITEMS);
  const items = new Map<string, ObservedContent>();
  sourceItems.each((_, node) => {
    const source = $(node);
    const title = normalizeWhitespace(source.children("title").first().text());
    const link = source.children("link").first().text().trim();
    if (!title || !link) return;
    const url = itemUrl(link, definition);
    if (!url) return;
    const description = source.children("description").first().text();
    const html = load(description);
    const text = readHtmlText(html, "body") || title;
    const dateText = normalizeWhitespace(source.children("pubDate").first().text());
    checkLength(title, MAX_TITLE_LENGTH);
    checkLength(text, MAX_DESCRIPTION_LENGTH);
    checkLength(dateText, MAX_DATE_LENGTH);
    const item: ObservedContent = { url, title, text, sourcePublishedAt: publishedTimestamp(dateText),
      sourceUpdatedAt: null, sourceDateText: dateText || null };
    const previous = items.get(url);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) invalidContent();
    items.set(url, item);
  });
  if (sourceItems.length && !items.size) invalidContent();
  return [...items.values()].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

/** Parses reviewed source text only; no requests or page scripts are executed. */
export function parseSourceContent(definition: SourceWatchDefinition, body: string): ObservedContent[] {
  try {
    checkLength(body, MAX_INPUT_LENGTH);
    if (definition.kind === "page") return parsePage(definition, body);
    if (definition.kind === "rss") return parseRss(definition, body);
    return invalidContent();
  } catch {
    return invalidContent();
  }
}

/** Preserve the selected original page texts and full-file identity without claiming full-book coverage. */
export function parsedKnowledgePdfContent(definition: SourceWatchDefinition, result: import("./knowledge-pdf.ts").KnowledgePdfResult): ObservedContent[] {
  const window = definition.pdfPages;
  if (definition.kind !== "pdf" || !window || !Number.isSafeInteger(window.startPage) || !Number.isSafeInteger(window.endPage)
    || window.startPage < 1 || window.endPage < window.startPage || window.endPage - window.startPage >= 8
    || result.startPage !== window.startPage || result.pages.length !== window.endPage - window.startPage + 1
    || result.pages.some((page, index) => page.page !== window.startPage + index || page.status === "unreadable" || page.text.length > 32000)
    || !result.pages.some(page => page.status === "text" && page.text.trim())) throw new Error("knowledge_pdf_selected_pages_incomplete");
  return [{ url: definition.url, title: definition.title ?? definition.id,
    text: result.pages.map(page => page.text).join("\n\n"), sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
    pages: result.pages, extraction: { format: "text_pdf", extractionQuality: result.extractionQuality, contentHash: result.fileHash, totalPages: result.totalPages,
      pageStart: window.startPage, pageEnd: window.endPage, complete: result.complete && window.startPage === 1
        && result.pages.every(page => page.status === "text") } }];
}
