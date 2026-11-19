import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { KnowledgeClass } from '../src/shared/knowledge.ts';
import type {
  LiveProductSpec,
  LiveSearchLimitation,
  LiveSourceCaution,
  LiveSourceCitation,
  LiveSourceKind,
} from '../src/shared/live-source-citation.ts';
import { FamilyError } from './family-access.ts';
import { domainReject } from './firestore-domain-data.ts';
import { assertPublicKnowledgeQuery } from './knowledge-query-minimization.ts';
import { knowledgeTokens } from './knowledge-ranking.ts';
import type { LiveSearchDetailedResult, LiveSourceRead, LiveSourceReader } from './live-source-citation.ts';
import { fetchPublicSourceResponse } from './public-source-transport.ts';

export interface ApprovedLiveDomainPolicy {
  readonly id: string;
  readonly host: string;
  readonly publisher: string;
  readonly sourceKind: LiveSourceKind;
  readonly termsUrl: string;
  readonly classification?: KnowledgeClass;
  readonly allowedPathPrefixes?: readonly string[];
  readonly maxStaleDays?: number;
}

export interface LiveDiscoveryCandidate {
  readonly url: string;
  readonly title?: string | null;
  readonly snippet?: string | null;
  readonly publisher?: string | null;
  readonly sourceDate?: string | null;
}

export interface LiveCommunityProductSearchOptions {
  readonly approvedDomains?: readonly ApprovedLiveDomainPolicy[];
  readonly discover: (minimizedQuery: string, signal: AbortSignal) => Promise<readonly LiveDiscoveryCandidate[]>;
  readonly mayReadDomain?: (domainId: string) => Promise<boolean>;
  readonly transport?: typeof fetchPublicSourceResponse;
  readonly maxCandidates?: number;
  readonly now?: () => Date;
  readonly knownPrivateIdentifiers?: readonly string[];
}

/** Reviewed public domains for C-class on-demand reading; never triggers bulk forum scraping. */
export const DEFAULT_LIVE_COMMUNITY_PRODUCT_DOMAINS: readonly ApprovedLiveDomainPolicy[] = [
  {
    id: 'bk-public-forum',
    host: 'www.baby-kingdom.com',
    publisher: '親子王國 Baby Kingdom',
    sourceKind: 'community_discussion',
    termsUrl: 'https://www.baby-kingdom.com/terms.php',
    classification: 'recent_information',
    maxStaleDays: 365,
  },
  {
    id: 'consumer-hk-public',
    host: 'www.consumer.org.hk',
    publisher: '消費者委員會',
    sourceKind: 'product_spec',
    termsUrl: 'https://www.consumer.org.hk/tc/terms-and-conditions',
    classification: 'recent_information',
    maxStaleDays: 730,
  },
  {
    id: 'cfs-hk-public',
    host: 'www.cfs.gov.hk',
    publisher: '食物環境衞生署食物安全中心',
    sourceKind: 'public_news',
    termsUrl: 'https://www.cfs.gov.hk/tc_chi/important/important.html',
    classification: 'recent_information',
    maxStaleDays: 365,
  },
];

const MAX_READS = 6;
const MAX_EXCERPT_CHARS = 800;
const MIN_READABLE_TEXT_CHARS = 20;
const LOGIN_OR_RESTRICTED_PATH_PATTERN = /(?:^|\/)(?:login|logging|signin|sign-in|register|member|members|account|checkout|cart|oauth|auth|ucp)(?:\.[A-Za-z0-9]+)?(?:\/|$|\?)/iu;
const LOGIN_OR_PAYWALL_TEXT_PATTERN = /(?:請先登入|需要登入|登入後(?:方)?可?(?:瀏覽|查看|閱讀|繼續)|會員專享|僅限會員|members?\s+only|sign\s+in\s+to\s+(?:view|continue|read)|please\s+log\s*in|subscribe\s+to\s+read|access\s+denied|captcha\s+verification)/iu;
const PROMOTIONAL_CUE_PATTERN = /(?:廣告|贊助|特約分享|合作試用|邀請試用|業配|優惠碼|折扣碼|團購連結|推廣連結|限時團購|sponsored|advertorial|affiliate|#ad\b|paid\s+partnership)/iu;
const POSITIVE_EXPERIENCE_CUE = /(?:好用|滿意|推薦|無紅疹|無敏感|無過敏|易溶|便便正常|大便正常|順暢|肯飲)/iu;
const NEGATIVE_EXPERIENCE_CUE = /(?:唔啱|不適合|敏感|過敏|紅疹|便秘|肚瀉|腹瀉|難溶|結塊|唔肯飲|拒飲|反效果|不適|漏尿)/iu;
const NEGATION_PREFIX_PATTERN = /(?:不能|不可|不應|不會|不代表|不作|不算|不構成|並不|並非|並無|沒有|沒|未能|未有|切勿|勿|無從)\s*[\u4e00-\u9fffA-Za-z0-9]{0,8}$/iu;
const sentenceSegmenter = new Intl.Segmenter('zh-HK', { granularity: 'sentence' });

function shortDocumentId(domainId: string, url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `${domainId}:${hash}`.slice(0, 255);
}

function classifyApprovedUrl(
  rawUrl: string,
  approvedDomains: readonly ApprovedLiveDomainPolicy[],
): { ok: true; url: URL; domain: ApprovedLiveDomainPolicy } | { ok: false; reason: 'unapproved_host' | 'login_or_access_restricted'; detail: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'unapproved_host', detail: '來源網址格式無效，未通過公開白名單核對。' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { ok: false, reason: 'unapproved_host', detail: '來源網址須為無認證資訊之標準 HTTPS 公開頁面。' };
  }
  url.hash = '';
  const hostname = url.hostname.toLowerCase();
  const domain = approvedDomains.find(item => item.host.toLowerCase() === hostname);
  if (!domain) {
    return { ok: false, reason: 'unapproved_host', detail: `網域 ${hostname} 不在已核准即時讀取白名單內。` };
  }
  if (domain.allowedPathPrefixes?.length && !domain.allowedPathPrefixes.some(prefix => url.pathname.startsWith(prefix))) {
    return { ok: false, reason: 'unapproved_host', detail: '來源路徑超出該網站已登記的公開讀取範圍。' };
  }
  if (LOGIN_OR_RESTRICTED_PATH_PATTERN.test(`${url.pathname}${url.search}`)) {
    return { ok: false, reason: 'login_or_access_restricted', detail: '該連結屬於登入或會員受限頁面，系統不會繞過存取限制。' };
  }
  return { ok: true, url, domain };
}

export function validateApprovedLiveUrl(
  rawUrl: string,
  approvedDomains: readonly ApprovedLiveDomainPolicy[] = DEFAULT_LIVE_COMMUNITY_PRODUCT_DOMAINS,
): { url: URL; domain: ApprovedLiveDomainPolicy } {
  const checked = classifyApprovedUrl(rawUrl, approvedDomains);
  if (!checked.ok) throw new Error(checked.reason === 'login_or_access_restricted' ? 'restricted_live_url' : 'unapproved_live_url');
  return { url: checked.url, domain: checked.domain };
}

function bestLivePassage(text: string, tokens: ReadonlySet<string>): { start: number; end: number } {
  let best: { score: number; start: number; end: number } | null = null;
  if (tokens.size > 0) {
    for (const sentence of sentenceSegmenter.segment(text)) {
      const lower = sentence.segment.normalize('NFKC').toLowerCase();
      let score = 0;
      let first = lower.length;
      for (const token of tokens) {
        const offset = lower.indexOf(token);
        if (offset >= 0) {
          score += 1;
          first = Math.min(first, offset);
        }
      }
      if (!score || (best && score <= best.score)) continue;
      const start = sentence.index + Math.max(0, first - 160);
      const end = Math.min(text.length, Math.max(sentence.index + sentence.segment.length, start + 1), start + MAX_EXCERPT_CHARS);
      if (end > start && end - start <= MAX_EXCERPT_CHARS) {
        best = { score, start, end };
      }
    }
  }
  if (best) return { start: best.start, end: best.end };
  return { start: 0, end: Math.min(text.length, MAX_EXCERPT_CHARS) };
}

function parseSourceDateMs(sourceDate: string | null): number | null {
  if (!sourceDate) return null;
  const normalized = sourceDate.normalize('NFKC').trim();
  const cjk = /^((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日號]?$/u.exec(normalized);
  if (cjk) {
    const ms = Date.UTC(Number(cjk[1]), Number(cjk[2]) - 1, Number(cjk[3]));
    return Number.isFinite(ms) ? ms : null;
  }
  const isoDate = /^((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})$/u.exec(normalized);
  if (isoDate) {
    const ms = Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractLiveProductSpec(text: string): LiveProductSpec | undefined {
  const normalized = text.normalize('NFKC');
  const brand = /(?:品牌|牌子|Brand)\s*[:：=]?\s*([A-Za-z0-9\u4e00-\u9fff&.'-]{2,30})/iu.exec(normalized)?.[1]?.trim() ?? null;
  const model = /(?:型號|款式|Model)\s*[:：=]?\s*([A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff._/-]{1,40})/iu.exec(normalized)?.[1]?.trim() ?? null;
  const variantOrStage = /(第?[1-4一二三四]\s*號|Stage\s*[1-4]|Step\s*[1-4]|\b\d+(?:\.\d+)?\s*(?:ml|g|克|毫升|片|條)(?:\s*[x×*]\s*\d+)?\b)/iu.exec(normalized)?.[1]?.trim() ?? null;
  const regionVersion = /(香港版|港版|原廠行貨|行貨|平行進口|水貨|歐版|荷蘭版|澳洲版|日版|台版|HK\s*version|EU\s*version)/iu.exec(normalized)?.[1]?.trim() ?? null;
  const batchCode = /(?:批次(?:編號|號)?|Batch(?:\s*(?:No\.?|Code))?|Lot(?:\s*No\.?)?)\s*[:：#=]?\s*([A-Za-z0-9-]{3,32})/iu.exec(normalized)?.[1]?.trim() ?? null;
  const priceText = /((?:HK\$|MOP\$|US\$|\$)\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/iu.exec(normalized)?.[1]?.trim() ?? null;
  if (!brand && !model && !variantOrStage && !regionVersion && !batchCode && !priceText) return undefined;
  return {
    ...(brand ? { brand: brand.slice(0, 80) } : {}),
    ...(model ? { model: model.slice(0, 120) } : {}),
    ...(variantOrStage ? { variantOrStage: variantOrStage.slice(0, 80) } : {}),
    ...(regionVersion ? { regionVersion: regionVersion.slice(0, 80) } : {}),
    ...(batchCode ? { batchCode: batchCode.slice(0, 80) } : {}),
    ...(priceText ? { priceText: priceText.slice(0, 80) } : {}),
  };
}

function appendCaution(cautions: LiveSourceCaution[], caution: LiveSourceCaution): void {
  if (!cautions.includes(caution) && cautions.length < 5) cautions.push(caution);
}

function detectConflictingLiveReads(reads: LiveSourceRead[]): void {
  if (reads.length < 2) return;
  const polarities = reads.map(read => {
    const pos = POSITIVE_EXPERIENCE_CUE.test(read.original);
    const neg = NEGATIVE_EXPERIENCE_CUE.test(read.original);
    return { pos, neg };
  });
  const hasPos = polarities.some(item => item.pos);
  const hasNeg = polarities.some(item => item.neg);
  const distinctRegions = new Set(reads.map(r => r.productSpec?.regionVersion?.toLowerCase()).filter(Boolean));
  const distinctModels = new Set(reads.map(r => r.productSpec?.model?.toLowerCase()).filter(Boolean));
  const distinctPrices = new Set(reads.map(r => r.productSpec?.priceText?.replace(/\s+/gu, '').toLowerCase()).filter(Boolean));
  const hasConflict = (hasPos && hasNeg) || distinctRegions.size > 1 || distinctModels.size > 1 || distinctPrices.size > 1;
  if (!hasConflict) return;
  for (const read of reads) {
    const next = [...(read.cautions ?? [])];
    appendCaution(next, 'conflicting_claims');
    (read as { cautions?: LiveSourceCaution[] }).cautions = next;
  }
}

function parseLiveHtmlPage(html: string, fallbackTitle?: string | null, fallbackDate?: string | null):
  | { ok: true; title: string; section: string | null; sourceDate: string | null; text: string }
  | { ok: false; reason: 'login_or_access_restricted' | 'original_unreadable'; detail: string } {
  const $ = load(html);
  const pageTitle = $('title').first().text().replace(/\s+/gu, ' ').trim();
  const heading = $('main h1, article h1, h1').first().text().replace(/\s+/gu, ' ').trim();
  const section = $('nav[aria-label*="breadcrumb" i], .breadcrumb, article h2, main h2').first().text().replace(/\s+/gu, ' ').trim().slice(0, 240) || null;
  const rawDate =
    $('time[datetime]').first().attr('datetime')?.trim()
    || $('meta[property="article:published_time"]').first().attr('content')?.trim()
    || $('meta[property="article:modified_time"]').first().attr('content')?.trim()
    || $('meta[name="pubdate"], meta[name="publishdate"]').first().attr('content')?.trim()
    || $('time, .post-date, .published-at, [data-published-at]').first().text().replace(/\s+/gu, ' ').trim()
    || fallbackDate?.trim()
    || null;
  const sourceDate = rawDate ? rawDate.slice(0, 120) : null;

  $('script, style, nav, footer, header, aside, iframe, noscript, form').remove();
  $('br, hr').replaceWith(' ');
  $('h1, h2, h3, h4, h5, h6, p, li, div, article, section, td, th, blockquote').each((_, node) => {
    $(node).prepend(' ').append(' ');
  });
  const bodyRoot = $('article, main, #mainContent, #content, body').first();
  const text = bodyRoot.text().replace(/\s+/gu, ' ').trim();

  if (LOGIN_OR_PAYWALL_TEXT_PATTERN.test(pageTitle) || (LOGIN_OR_PAYWALL_TEXT_PATTERN.test(text) && text.length < 240)) {
    return {
      ok: false,
      reason: 'login_or_access_restricted',
      detail: '頁面顯示登入或會員瀏覽限制，系統不會繞過限制，亦不會以搜尋摘要代為回答。',
    };
  }
  if (!text || text.length < MIN_READABLE_TEXT_CHARS) {
    return {
      ok: false,
      reason: 'original_unreadable',
      detail: '頁面缺乏可核對的有效正文，無法確認原文內容。',
    };
  }
  const title = (heading || pageTitle || fallbackTitle?.trim() || '即時搜尋公開來源').slice(0, 300);
  return { ok: true, title, section, sourceDate, text };
}

function hasUnnegatedMatch(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(global)) {
    const start = match.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 20), start);
    if (!NEGATION_PREFIX_PATTERN.test(prefix)) return true;
  }
  return false;
}

const FABRICATED_AGGREGATE_STATS_PATTERN = /(?:(?:整體|全港|普遍|大部分|絕大多數|多數)?(?:家長|媽媽|父母|用家|使用者|網友|網民).{0,12}(?:使用率|滿意度|好評率|推薦率|成功率)|(?:\d+(?:\.\d+)?\s*%|[\d一二三四五六七八九十兩百]+\s*成).{0,16}(?:家長|媽媽|父母|用家|使用者|寶寶|BB)(?:都|均|表示|認為|推薦|滿意|選用|適合|無問題))/iu;
const COMMERCIAL_ENDORSEMENT_PATTERN = /(?:最值得(?:買|購買|入手)|首選(?:推薦)?購買|必買(?:推薦|之選)?|最(?:好|佳|靚|抵買)(?:嘅|的)?(?:奶粉|牌子|品牌|產品|型號|尿片|護膚品|用品)|強烈推薦(?:購買|選購|入手)|推薦(?:你|大家|家長)?(?:購買|買呢款|選購)|建議(?:立即|直接|優先)?(?:購買|入手|落單))/iu;
const UNVERIFIED_PROOF_CLAIM_PATTERN = /(?:已獲?(?:臨床|官方|平台)?驗證(?:購買|真實使用|療效)|論壇(?:帖子|用家|網民)?證實(?:有效|安全無虞|100%\s*安全)|熱度(?:高|第一)代表(?:品質|安全|有效))/iu;

/** Rejects commercial endorsements, fabricated overall statistics, and verified-proof claims on C-class live citations. */
export function validateLiveSourceClaims(
  paragraphs: readonly { kind?: string; text: string; citationIds: readonly string[] }[],
  _defaultKind: string,
  liveEvidence: ReadonlyMap<string, LiveSourceCitation>,
  hasOfficialCitationInParagraph: (citationIds: readonly string[]) => boolean,
): void {
  for (const paragraph of paragraphs) {
    const citedLive = paragraph.citationIds
      .map(id => liveEvidence.get(id))
      .filter((item): item is LiveSourceCitation => Boolean(item));
    if (!citedLive.length) continue;
    const touchesCommunityOrProduct = citedLive.some(item =>
      item.sourceKind === 'community_discussion'
      || item.sourceKind === 'product_spec'
      || (item.classification === 'recent_information' && !hasOfficialCitationInParagraph(paragraph.citationIds)));
    if (!touchesCommunityOrProduct) continue;

    if (
      hasUnnegatedMatch(paragraph.text, FABRICATED_AGGREGATE_STATS_PATTERN)
      || hasUnnegatedMatch(paragraph.text, COMMERCIAL_ENDORSEMENT_PATTERN)
      || hasUnnegatedMatch(paragraph.text, UNVERIFIED_PROOF_CLAIM_PATTERN)
    ) {
      throw new FamilyError(400, 'unsupported_live_claim');
    }
  }
}

function buildConditionsList(domain: ApprovedLiveDomainPolicy, cautions: readonly LiveSourceCaution[]): string[] {
  const conditions: string[] = [];
  if (domain.sourceKind === 'community_discussion') {
    conditions.push('家長社群自述，屬未經獨立核實之個別經驗');
  } else if (domain.sourceKind === 'product_spec') {
    conditions.push('公開商品或測試資料，非商業推薦或整體統計');
  } else {
    conditions.push('按需即時讀取之公開網頁，非長期資料庫');
  }
  if (cautions.includes('stale_source')) conditions.push('來源日期較舊，請核對現行資料');
  if (cautions.includes('suspected_promotional')) conditions.push('原文含疑似宣傳或贊助字眼');
  if (cautions.includes('partial_read')) conditions.push('僅擷取與提問相關段落');
  return conditions.slice(0, 8);
}

/**
 * On-demand C-class reader: enforces outbound query minimization, checks domain/terms allowlist,
 * reads actual original pages (never using search snippets as evidence), extracts product specs and
 * qualitative cautions, and reports explicit limitations when pages are unreadable or restricted.
 */
export function createLiveCommunityProductSearch(options: LiveCommunityProductSearchOptions): LiveSourceReader {
  const domains = options.approvedDomains ?? DEFAULT_LIVE_COMMUNITY_PRODUCT_DOMAINS;
  const transport = options.transport ?? fetchPublicSourceResponse;
  const maxCandidates = Math.max(1, Math.min(MAX_READS, options.maxCandidates ?? MAX_READS));
  const now = options.now ?? (() => new Date());
  const classifications = [...new Set(domains.map(item => item.classification ?? ('recent_information' as KnowledgeClass)))];

  async function searchDetailed(
    query: string,
    signal: AbortSignal,
    classification: KnowledgeClass,
  ): Promise<LiveSearchDetailedResult> {
    signal.throwIfAborted();
    if (!classifications.includes(classification)) return { reads: [], limitations: [] };
    // Re-enforce REQ-001 §4.1 minimization boundary even if called directly outside product-agent-tools.
    const minimizedQuery = assertPublicKnowledgeQuery(query, options.knownPrivateIdentifiers);
    const tokens = knowledgeTokens(minimizedQuery, true);
    const rawCandidates = await options.discover(minimizedQuery, signal);
    signal.throwIfAborted();

    const seenUrls = new Set<string>();
    const boundedCandidates: LiveDiscoveryCandidate[] = [];
    for (const candidate of rawCandidates) {
      const normalizedKey = candidate.url.split('#')[0] ?? candidate.url;
      if (seenUrls.has(normalizedKey)) continue;
      seenUrls.add(normalizedKey);
      boundedCandidates.push(candidate);
      if (boundedCandidates.length >= maxCandidates) break;
    }

    const reads: LiveSourceRead[] = [];
    const limitations: LiveSearchLimitation[] = [];

    for (const candidate of boundedCandidates) {
      signal.throwIfAborted();
      const checked = classifyApprovedUrl(candidate.url, domains);
      if (!checked.ok) {
        limitations.push({
          url: /^https:\/\//iu.test(candidate.url) ? candidate.url.split('#')[0]! : null,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: candidate.publisher?.trim().slice(0, 160) || null,
          reason: checked.reason,
          detail: checked.detail,
        });
        continue;
      }
      const { url, domain } = checked;
      if ((domain.classification ?? 'recent_information') !== classification) continue;
      if (options.mayReadDomain && !await options.mayReadDomain(domain.id)) {
        limitations.push({
          url: url.href,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'login_or_access_restricted',
          detail: '此公開來源目前未獲讀取授權，未取得原文。',
        });
        continue;
      }

      const fetched = await transport(
        url.href,
        target => validateApprovedLiveUrl(target, domains).url,
        signal,
        'text/html',
        { maxBytes: 512 * 1024, followRedirects: true, readGateBody: true },
      );
      signal.throwIfAborted();

      if (fetched.status !== 'response') {
        limitations.push({
          url: url.href,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'original_unreadable',
          detail: '無法連線或逾時讀取原網頁，不可只憑搜尋結果摘要下結論。',
        });
        continue;
      }

      const { status, contentType, body } = fetched.response;
      const finalUrl = fetched.response.url ?? url.href;
      if ([401, 403, 429].includes(status)) {
        limitations.push({
          url: finalUrl,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'login_or_access_restricted',
          detail: `原網站拒絕或限制存取（HTTP ${status}），系統不繞過存取限制，亦不以搜尋摘要充當證據。`,
        });
        continue;
      }
      if (status !== 200 || !/^text\/html(?:;|$)/iu.test(contentType)) {
        limitations.push({
          url: finalUrl,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'original_unreadable',
          detail: '原網頁非可讀取之 HTML 正文或狀態異常，無法核對全文。',
        });
        continue;
      }

      const charset = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType)?.[1] ?? 'utf-8';
      if (!['utf-8', 'utf8'].includes(charset.toLowerCase())) {
        limitations.push({
          url: finalUrl,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'original_unreadable',
          detail: `原網頁編碼（${charset}）暫未能以 UTF-8 安全解析。`,
        });
        continue;
      }

      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch {
        limitations.push({
          url: finalUrl,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: 'original_unreadable',
          detail: '原網頁內容編碼損壞，未能讀取原文。',
        });
        continue;
      }

      const parsed = parseLiveHtmlPage(html, candidate.title, candidate.sourceDate);
      if (!parsed.ok) {
        limitations.push({
          url: finalUrl,
          title: candidate.title?.trim().slice(0, 300) || null,
          publisher: domain.publisher,
          reason: parsed.reason,
          detail: parsed.detail,
        });
        continue;
      }

      const passage = bestLivePassage(parsed.text, tokens);
      const fetchedDate = now();
      const fetchedAt = fetchedDate.toISOString();
      const cautions: LiveSourceCaution[] = [];
      if (domain.sourceKind === 'community_discussion') {
        appendCaution(cautions, 'self_reported_unverified');
      }
      if (PROMOTIONAL_CUE_PATTERN.test(`${parsed.title}\n${parsed.text}`)) {
        appendCaution(cautions, 'suspected_promotional');
      }
      const publishedMs = parseSourceDateMs(parsed.sourceDate);
      const maxStaleDays = domain.maxStaleDays ?? 365;
      if (publishedMs !== null && fetchedDate.getTime() - publishedMs > maxStaleDays * 86_400_000) {
        appendCaution(cautions, 'stale_source');
      }
      if (passage.end - passage.start < parsed.text.length) {
        appendCaution(cautions, 'partial_read');
      }

      const productSpec = extractLiveProductSpec(`${parsed.title} ${parsed.text}`);
      const read: LiveSourceRead = {
        documentId: shortDocumentId(domain.id, finalUrl),
        classification,
        sourceKind: domain.sourceKind,
        title: parsed.title,
        publisher: domain.publisher,
        url: finalUrl,
        termsUrl: domain.termsUrl,
        fetchedAt,
        version: null,
        sourceDate: parsed.sourceDate,
        section: parsed.section,
        page: null,
        conditions: buildConditionsList(domain, cautions),
        ...(productSpec ? { productSpec } : {}),
        ...(cautions.length ? { cautions } : {}),
        rights: 'retain_excerpt',
        original: parsed.text,
        start: passage.start,
        end: passage.end,
      };
      reads.push(read);
    }

    detectConflictingLiveReads(reads);

    if (reads.length > 0 && reads.every(item => item.cautions?.includes('stale_source'))) {
      limitations.push({
        url: null,
        title: null,
        publisher: null,
        reason: 'stale_only',
        detail: '本次取得的可讀即時來源日期均較舊，建議核對較近期資料或官方發布。',
      });
    }
    if (reads.length > 0 && reads.every(item => item.cautions?.includes('suspected_promotional'))) {
      limitations.push({
        url: null,
        title: null,
        publisher: null,
        reason: 'suspected_promotional_only',
        detail: '本次取得來源均含疑似宣傳或贊助線索，請審慎區分廣告與真實使用體驗。',
      });
    }
    if (!reads.length && !limitations.length) {
      limitations.push({
        url: null,
        title: null,
        publisher: null,
        reason: 'no_matching_results',
        detail: '即時搜尋未找到符合範圍且可讀取原文的公開來源。',
      });
    }

    return { reads, limitations };
  }

  return {
    classifications,
    async search(query, signal, classification) {
      return (await searchDetailed(query, signal, classification)).reads;
    },
    searchDetailed,
    async mayUse(citation, signal) {
      signal.throwIfAborted();
      const checked = classifyApprovedUrl(citation.url, domains);
      if (!checked.ok) return false;
      const { domain } = checked;
      if ((domain.classification ?? 'recent_information') !== citation.classification) return false;
      if (domain.publisher !== citation.publisher || domain.termsUrl !== citation.termsUrl) return false;
      if (citation.rights !== 'retain_excerpt') return false;
      if (options.mayReadDomain && !await options.mayReadDomain(domain.id)) return false;
      return true;
    },
  };
}

/** Composes multiple LiveSourceReaders (e.g. A/official live pages + C/community-product live search). */
export function composeLiveSourceReaders(...readers: readonly LiveSourceReader[]): LiveSourceReader {
  const classifications = [...new Set(readers.flatMap(reader => reader.classifications))];

  async function searchDetailed(
    query: string,
    signal: AbortSignal,
    classification: KnowledgeClass,
  ): Promise<LiveSearchDetailedResult> {
    signal.throwIfAborted();
    const matching = readers.filter(reader => reader.classifications.includes(classification));
    if (!matching.length) {
      domainReject('live_source_unavailable', 503);
    }
    const outcomes = await Promise.all(matching.map(async reader => {
      try {
        const result = reader.searchDetailed
          ? await reader.searchDetailed(query, signal, classification)
          : { reads: await reader.search(query, signal, classification), limitations: [] as LiveSearchLimitation[] };
        return { ok: true as const, result };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof FamilyError) throw error;
        return { ok: false as const, error };
      }
    }));

    const reads: LiveSourceRead[] = [];
    const limitations: LiveSearchLimitation[] = [];
    const seenUrls = new Set<string>();
    let succeeded = 0;
    for (const outcome of outcomes) {
      if (!outcome.ok) continue;
      succeeded += 1;
      for (const read of outcome.result.reads) {
        if (seenUrls.has(read.url) || reads.length >= MAX_READS) continue;
        seenUrls.add(read.url);
        reads.push(read);
      }
      limitations.push(...outcome.result.limitations);
    }
    if (succeeded === 0) {
      const firstError = outcomes.find(item => !item.ok);
      if (firstError && !firstError.ok) throw firstError.error;
      domainReject('live_source_unavailable', 503);
    }
    return { reads, limitations };
  }

  return {
    classifications,
    async search(query, signal, classification) {
      return (await searchDetailed(query, signal, classification)).reads;
    },
    searchDetailed,
    async mayUse(citation, signal) {
      signal.throwIfAborted();
      for (const reader of readers) {
        if (!reader.classifications.includes(citation.classification)) continue;
        if (await reader.mayUse(citation, signal)) return true;
      }
      return false;
    },
  };
}
