import type { CheerioAPI } from 'cheerio';
import type { DocumentCategories } from '../src/shared/source-card-reading.ts';

function label(value: string) {
  const text = value.trim().replace(/\s+/gu, ' ');
  return text.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : '';
}

export function publisherSections($: CheerioAPI, url: string): string[] {
  const sections = new Set<string>();
  function add(value: string) {
    const text = label(value);
    if (text && sections.size < 12) sections.add(text);
  }
  for (const node of $('head meta[property="article:section"],[itemprop~="articleSection"],article a[rel~=category],main a[rel~=category]').toArray()) {
    const item = $(node);
    if (!item.closest('aside,footer,[hidden],[aria-hidden=true]').length &&
        (!item.closest('article').length || $('article').length === 1)) add(item.attr('content') ?? item.text());
  }
  const location = new URL(url);
  for (const node of $('nav[aria-label], [itemtype$="/BreadcrumbList"]').toArray()) {
    const nav = $(node);
    if (!nav.is('[itemtype$="/BreadcrumbList"]') && !/^(?:breadcrumbs?|麵包屑(?:導覽)?|所在位置|網站路徑)$/iu.test(nav.attr('aria-label')?.trim() ?? '')) continue;
    for (const link of nav.find('li a[href]').toArray()) {
      const anchor = $(link);
      try {
        const target = new URL(anchor.attr('href')!, location);
        if (target.origin === location.origin && target.pathname !== '/' && target.pathname !== location.pathname &&
            !anchor.closest('[aria-current],[hidden],[aria-hidden=true]').length && !/^(?:home|首頁|主頁)$/iu.test(anchor.text().trim())) add(anchor.text());
      } catch { /* Ignore malformed navigation. */ }
    }
  }
  return [...sections].sort();
}

export function listingSections($: CheerioAPI, base: URL) {
  const result = new Map<string, string[]>();
  for (const node of $('main section,article section,[role=main] section').toArray()) {
    const section = $(node);
    const heading = section.children('h2,h3,h4').first();
    const name = label(heading.text());
    if (!name || !heading.length) continue;
    for (const link of section.find('ul a[href],ol a[href],dl dd a[href],table td a[href]').toArray()) {
      const anchor = $(link);
      if (anchor.closest('section')[0] !== node || anchor.closest('nav,aside,footer,form,[hidden],[aria-hidden=true]').length) continue;
      try {
        const url = new URL(anchor.attr('href')!, base);
        url.hash = '';
        const sections = result.get(url.href) ?? [];
        if (!sections.includes(name) && sections.length < 12) result.set(url.href, [...sections, name].sort());
      } catch { /* Ignore a malformed catalogue item. */ }
    }
  }
  return result;
}

// Navigation topics only. Keep the word in the document that justifies each fallback.
const topics: readonly [string, RegExp][] = [
  ['生長與發展', /生長圖表|成長發展|兒童發展|語言發展|成長里程碑|growth charts?|child development|developmental milestones?/iu],
  ['飲食與餵哺', /母乳|餵哺|輔食|固體食物|幼兒飲食|breastfeeding|weaning|solid foods?|infant feeding/iu],
  ['健康與安全', /家居安全|保護兒童|預防意外|接種疫苗|潔手|兒童安全|child protection|child safety|vaccination|hand hygiene/iu],
  ['日常照顧', /睡眠|如廁|洗澡|刷牙|sleep|toilet training|bathing|toothbrushing/iu],
  ['情緒與相處', /情緒|親子溝通|社交技巧|分離焦慮|emotional development|social skills|separation anxiety/iu],
  ['學習與活動', /閱覽室|圖書館|展覽|親子活動|reading room|library|exhibition|family activities/iu],
];
export function documentCategories(sections: string[], title: string, text: string): DocumentCategories {
  if (sections.length) return { basis: 'publisher', labels: [...new Set(sections)].sort() };
  const matchesFrom = (value: string) => topics.map(([name, pattern]) => ({ name, word: pattern.exec(value)?.[0] })).filter(item => item.word);
  const titleMatches = matchesFrom(title);
  const matches = titleMatches.length ? titleMatches : matchesFrom(text.slice(0, 2400));
  return matches.length
    ? { basis: 'document', labels: matches.map(m => m.name), evidence: matches.map(m => m.word!).join('、') }
    : { basis: 'unclassified', labels: [] };
}

export function declaredPrintCopies($: CheerioAPI, base: URL) {
  const articles = $('article,[itemprop~=articleBody]').filter((_, el) => !$(el).parents('article,[itemprop~=articleBody]').length);
  if (articles.length > 1) return new Set<string>();
  const region = articles.length ? articles : $('main,[role=main],#content').first();
  if (/^(?:目錄|章節目錄|contents|table of contents|directory)$/iu.test(region.find('h1').first().text().trim())) return new Set<string>();
  const paragraphs = region.find('p').filter((_, el) => !$(el).closest('nav,aside,footer,form,[hidden],[aria-hidden=true]').length);
  const current = /^(?:This (?:web\s?page|page|online (?:edition|version)) is the (?:current|up[- ]to[- ]date|latest) (?:text|version|edition)|(?:本網頁|本頁|本網頁內容|此網頁)(?:為|是)(?:現行|最新)(?:正文|版本|內容)|(?:如|若)(?:網上版與印刷版|印刷版與網上版)(?:內容)?(?:有差異|有任何差異|不同)[，,]\s*(?:請)?以網上版為準)(?:[.。!！]|$)/iu;
  const declaration = paragraphs.toArray().map(el => $(el).text().trim()).find(value => current.test(value));
  // A contents page with a version banner and download links is still a directory.
  const bodyParagraphs = paragraphs.toArray().filter(el => {
    const paragraph = $(el).clone();
    paragraph.find('a,button,script,style').remove();
    const body = paragraph.text().trim();
    return body.length >= 24 && !current.test(body);
  });
  if (!declaration || bodyParagraphs.length < (articles.length ? 1 : 2)) return new Set<string>();
  const copies = new Set<string>(), otherLinks = new Set<string>();
  const alternatives = new Set<string>();
  for (const el of $('head link[rel~=alternate][type="application/pdf"][media="print"][href]').toArray()) {
    const link = $(el);
    if (link.attr('hreflang') && link.attr('hreflang') !== $('html').attr('lang')) continue;
    try { alternatives.add(new URL(link.attr('href')!, base).href); } catch { /* Invalid alternate. */ }
  }
  for (const node of region.find('a[href]').toArray()) {
    const anchor = $(node);
    if (anchor.closest('aside,nav,footer,form,[hidden],[aria-hidden=true]').length) continue;
    const text = anchor.text().replace(/\s+/gu, ' ').trim();
    const print = /^(?:(?:PDF )?print(?:able)? (?:edition|version|copy) of this (?:page|article)|(?:本頁|本網頁|本文)(?:的)?(?:列印|打印|印刷)版)(?:\s*[（(]PDF[)）])?$/iu.test(text);
    try {
      const target = new URL(anchor.attr('href')!, base);
      const alternate = alternatives.has(target.href) && /^(?:(?:下載|download)\s*)?PDF$/iu.test(text);
      if (/\.pdf$/iu.test(target.pathname) || anchor.attr('type') === 'application/pdf' || alternate)
        (print || alternate ? copies : otherLinks).add(target.href);
    } catch { /* Only an individually identified print link can be omitted. */ }
  }
  for (const url of otherLinks) copies.delete(url);
  return copies;
}
