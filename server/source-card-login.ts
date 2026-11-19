import { load } from 'cheerio';
import { parseSetCookie } from 'set-cookie-parser';
import { fetchPublicSourceResponse, submitSourceLogin } from './public-source-transport.ts';
import { personalSourceUrl } from './personal-source-fetch.ts';
import { inspectSourcePage, type UserAction } from './source-card-page.ts';

export interface SourceCardCredential { origin: string; username: string; password: string }

/** Cookies live for this acquisition only; a Domain attribute can never broaden the card origin. */
export function siteCookieJar(origin: string, secrets: Set<string>) {
  const jar = new Map<string, { name: string; value: string; path: string; expires: number }>();
  const header = (url: URL) => {
    if (url.origin !== origin) throw Error('scope');
    return [...jar.values()].filter(c => c.expires > Date.now() && (url.pathname === c.path ||
      url.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')))
      .sort((a,b) => b.path.length - a.path.length).map(c => c.name + '=' + c.value).join('; ');
  };
  const receive = (url: URL, headers: string[]) => {
    if (url.origin !== origin || headers.length > 32) throw Error('scope');
    for (const c of parseSetCookie(headers, { decodeValues: false, silent: true })) {
      if (!/^[\w!#$%&'*+.^_|~-]+$/u.test(c.name) || /[;\s\u0000-\u001f\u007f]/u.test(c.value) || c.value.length > 4096) continue;
      if (c.domain && c.domain.replace(/^\./u,'').toLowerCase() !== url.hostname) continue;
      const path = c.path?.startsWith('/') ? c.path : url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
      const expires = c.maxAge !== undefined ? Date.now() + c.maxAge * 1000 : c.expires?.getTime() ?? Infinity;
      const key = c.name + '\n' + path;
      if (!c.value || expires <= Date.now()) { jar.delete(key); continue; }
      if (jar.size >= 32 && !jar.has(key)) throw Error('limit');
      secrets.add(c.value);
      jar.set(key, { name: c.name, value: c.value, path, expires });
    }
  };
  return { header, receive };
}

export async function loginSourceCard(login: { url: string; submitUrl?: string }, origin: string,
  credential: SourceCardCredential, jar: ReturnType<typeof siteCookieJar>, current: () => Promise<void>, signal: AbortSignal): Promise<UserAction | null> {
  const pageUrl = personalSourceUrl(login.url, origin), action = personalSourceUrl(login.submitUrl ?? login.url, origin);
  if (pageUrl.search || action.search || pageUrl.hash || action.hash) throw Error('scope');
  const exact = (value: string) => { if (value !== pageUrl.href) throw Error('scope'); return pageUrl; };
  const options = { maxBytes: 512 * 1024, followRedirects: false, receiveCookies: jar.receive,
    sessionForGet: async (url: URL) => { await current(); return { cookie: jar.header(url) }; } };
  const page = await fetchPublicSourceResponse(pageUrl.href, exact, signal, 'text/html', options);
  await current();
  if (page.status !== 'response') throw Error('unavailable');
  if (page.response.status !== 200 || !/^text\/html(?:;|$)/iu.test(page.response.contentType)) return page.response.status === 402 ? 'purchase' : 'login';
  const html = page.response.body.toString('utf8'), $ = load(html);
  const gate = inspectSourcePage(html, pageUrl.href).gate;
  if (gate && gate !== 'login') return gate;
  const passwords = $('form input[type=password][name]:not([disabled])');
  if (passwords.length !== 1 || passwords.is('[autocomplete=new-password]')) return 'login';
  const form = passwords.closest('form');
  const base = new URL($('base[href]').first().attr('href') ?? pageUrl.href, pageUrl);
  if (form.attr('method')?.toUpperCase() !== 'POST' || (form.attr('enctype') ?? 'application/x-www-form-urlencoded').toLowerCase() !== 'application/x-www-form-urlencoded' ||
      new URL(form.attr('action') || pageUrl.href, base).href !== action.href || form.find('[formaction],[formmethod],input[type=file]').length) return 'login';
  const names = form.find('input[name]:not([disabled])').filter((_, el) => {
    const type = ($(el).attr('type') || 'text').toLowerCase(); return ['email','text'].includes(type);
  });
  if (names.length !== 1) return 'login';
  const username = names.attr('name')!, password = passwords.attr('name')!;
  if (username === password) return 'login';
  const body = new URLSearchParams();
  for (const el of form.find('input[type=hidden][name]:not([disabled])').toArray()) {
    const name = $(el).attr('name')!, value = $(el).attr('value') ?? '';
    if (name === username || name === password || /^_?method$/iu.test(name) || body.size >= 32 || value.length > 4096) return 'login';
    body.append(name, value);
  }
  body.set(username, credential.username); body.set(password, credential.password);
  const posted = await submitSourceLogin(action, body, signal, options);
  await current();
  if (posted.status !== 'response') throw Error('unavailable');
  const { status, location, body: bytes } = posted.response;
  if (status === 402) return 'purchase';
  if ([301,302,303].includes(status) && location) {
    const target = new URL(location, action);
    if (target.origin !== origin) return 'login';
    if (/captcha/iu.test(target.pathname)) return 'captcha';
    if (/\b(?:mfa|otp|2fa|challenge|verification)\b/iu.test(target.pathname)) return 'mfa';
    if (/\b(?:paywall|checkout|purchase)\b/iu.test(target.pathname)) return 'purchase';
    return null; // The broker independently GETs the registered entry with the new session.
  }
  if (status !== 200 && status !== 204) return 'login';
  return status === 200 ? inspectSourcePage(bytes.toString('utf8'), action.href).gate : null;
}
