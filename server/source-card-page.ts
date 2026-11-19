import { load } from 'cheerio';
import { personalSourceUrl } from './personal-source-fetch.ts';
import { fhsLeafletControl } from './knowledge-source-fetch.ts';
import { classifyGate, downloadLabel, fileLink, mutation, nextLabel } from './source-card-controls.mjs';

export interface SourceCardInput {
  cardId: string; entryUrl: string; kind: 'document' | 'directory' | 'bulletin'; allowedPath?: string;
  login?: { url: string; submitUrl?: string };
}
export type UserAction = 'login' | 'mfa' | 'captcha' | 'purchase';

function cleanPath(path: string) {
  if (/%(?:2e|2f|5c|25|3f|23)|[\\;\u0000-\u001f]/iu.test(path)) throw Error('scope');
  const decoded = decodeURIComponent(path);
  if (decoded.split('/').some(part => part === '.' || part === '..') || /[\\;\u0000-\u001f]/u.test(decoded)) throw Error('scope');
  return decoded;
}
export function sourceCardScope(input: SourceCardInput) {
  if (!input.cardId || input.cardId.length > 200 || !['document','directory','bulletin'].includes(input.kind)) throw Error('scope');
  const entry = personalSourceUrl(input.entryUrl, input.entryUrl);
  const prefix = input.allowedPath ?? entry.pathname;
  if (!prefix.startsWith('/') || prefix.startsWith('//') || /[?#]/u.test(prefix)) throw Error('scope');
  cleanPath(prefix);
  const root = new URL(prefix, entry.origin).pathname.replace(/\/+$/u, '');
  const validate = (value: string) => {
    if (value.length > 4096 || /[\\\u0000-\u001f]/u.test(value)) throw Error('scope');
    const url = personalSourceUrl(value, entry.origin), path = cleanPath(url.pathname);
    if (url.href !== entry.href && (input.kind === 'document' || (url.pathname !== root && !url.pathname.startsWith(root + '/')))) throw Error('scope');
    // Signed or credential-bearing links must never become persistent source locators.
    if ([...url.searchParams.keys()].some(key => /token|secret|passw|credential|signature|^sig$|^key$|^auth$|session|api[-_]?key|^x-amz-|^x-goog-/iu.test(key))) throw Error('scope');
    if (url.href !== entry.href && (mutation.test(path) || [...url.searchParams].some(([key, val]) => mutation.test(key) || mutation.test(val)))) throw Error('scope');
    return url;
  };
  validate(input.entryUrl);
  return validate;
}

export function inspectSourcePage(html: string, url: string) {
  const $ = load(html);
  const title = $('title,h1').first().text();
  const notice = [title, $('h1,h2,[role=alert],form').slice(0, 8).text()].join(' ').slice(0, 2400);
  const gate: UserAction | null = classifyGate(notice, !!$('[autocomplete=one-time-code]').length,
    !!$('[data-sitekey],iframe[src*="captcha" i],input[name*="captcha" i]').length, !!$('input[type=password]').length);
  const links = new Set<string>();
  const leaflet = fhsLeafletControl($, url);
  if (leaflet) return { gate, links: [leaflet.url], dynamic: false };
  const main = $('main,article,[role=main],#content').first();
  const region = main.length ? main : $('body');
  let dynamic = false;
  const base = new URL($('base[href]').first().attr('href') ?? url, url);
  for (const node of region.find('a,button,[role=button],input[type=button],input[type=submit]').add($('a[rel~=next],link[rel~=next]')).toArray()) {
    const element = $(node), href = element.attr('href');
    const label = (element.attr('aria-label') || element.attr('value') || element.text()).trim();
    const meaningful = element.is('[download],[rel~=next]') || downloadLabel.test(label) || nextLabel.test(label);
    if (href && !/^(?:#|javascript:)/iu.test(href)) {
      if (meaningful || fileLink.test(href) || (main.length && element.is('a') && label && !element.closest('nav,header,footer,form').length))
        try { links.add(new URL(href, base).href); } catch { /* Malformed link. */ }
    } else if (meaningful) dynamic = true;
    if (meaningful && element.attr('onclick')) dynamic = true;
  }
  // Script-rendered catalogue shells may initially contain no controls or text.
  if ($('script').length && !links.size && (region.text().replace(/\s/gu,'').length < 100 || !region.find('p,article').length)) dynamic = true;
  return { gate, links: [...links], dynamic };
}
