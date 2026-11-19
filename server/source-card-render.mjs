import { chromium } from 'playwright-core';
import { classifyGate, downloadLabel, fileLink, mutation, nextLabel } from './source-card-controls.mjs';

const controls = 'a,button,[role=button],input[type=button],input[type=submit]';
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'";

/** Routes are answered entirely from a finite snapshot. Missing GETs are hints for the broker. */
export async function renderCatalogue(input, signal) {
  const snapshots = new Map(input.resources.map(r => [r.url, r]));
  const browser = await chromium.launch({ chromiumSandbox: true, headless: true, timeout: 10_000 });
  const abort = () => { void browser.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, permissions: [] });
    const page = await context.newPage(), links = new Set(), assets = new Set();
    let interactions = 0, requests = 0, limited = false, unresolved = false, gate = null, action = '', observed = 0;
    const allowed = raw => {
      try { const parsed = new URL(raw); return parsed.protocol === 'https:' && parsed.origin === new URL(input.url).origin &&
        parsed.href.length <= 3000 && !mutation.test(parsed.pathname); } catch { return false; }
    };
    const collect = (set, url) => {
      if (allowed(url) && set.size < 64) { set.add(url); observed++; }
      else if (set.size >= 64) limited = true;
    };
    await context.routeWebSocket('**/*', ws => ws.close());
    await context.route('**/*', async route => {
      const req = route.request(), url = req.url(), type = req.resourceType();
      if (++requests > 96) limited = true;
      if (limited || req.method() !== 'GET' || !allowed(url)) return route.abort();
      if (req.isNavigationRequest() && url !== input.url) {
        collect(links, url);
        return route.fulfill({ status: 204 });
      }
      const item = snapshots.get(url);
      if (item) return route.fulfill({ status: 200, headers: { 'content-type': item.mime,
        'content-security-policy': csp, 'x-content-type-options': 'nosniff' }, body: Buffer.from(item.body, 'base64') });
      if (type === 'script' || type === 'fetch' || type === 'xhr') {
        collect(assets, url);
      } else if (action === 'download' && (type === 'other' || fileLink.test(url))) collect(links, url);
      return route.fulfill({ status: 404, body: '' });
    });
    const onDownload = download => {
      collect(links, download.url());
      void download.cancel().catch(() => {});
    };
    page.on('download', onDownload);
    context.on('page', popup => { popup.on('download', onDownload); });
    await page.goto(input.url, { waitUntil: 'networkidle', timeout: 7000 });
    const states = new Set();
    while (!limited) {
      const text = (await page.locator('title,h1,h2,[role=alert],form').allTextContents()).join(' ').slice(0, 2400);
      gate = classifyGate(text, await page.locator('[autocomplete=one-time-code]').count(),
        await page.locator('[data-sitekey],iframe[src*="captcha" i],input[name*="captcha" i]').count(),
        await page.locator('input[type=password]').count());
      if (gate) break;
      const elements = page.locator(controls);
      const items = await elements.evaluateAll(nodes => nodes.slice(0, 250).map(el => ({
        label: (el.getAttribute('aria-label') || el.value || el.textContent || '').trim().slice(0, 180),
        href: el.tagName === 'A' && !el.getAttribute('href')?.startsWith('#') ? el.href : null,
        download: el.hasAttribute('download'), next: el.rel?.split(/\s+/).includes('next'),
        blocked: el.matches(':disabled,[aria-disabled=true]') || !!el.closest('form'),
      })));
      const state = JSON.stringify(items) + (await page.locator('body').innerText()).slice(0, 4096);
      if (states.has(state)) break;
      states.add(state);
      let next;
      for (const [index, item] of items.entries()) {
        if (item.blocked || mutation.test(item.label)) continue;
        const href = item.href && allowed(item.href) && item.href !== input.url;
        if (href && (item.download || item.next || fileLink.test(item.href) || downloadLabel.test(item.label) || nextLabel.test(item.label))) {
          collect(links, item.href);
        } else if (item.next || nextLabel.test(item.label)) next ??= elements.nth(index);
        else if (downloadLabel.test(item.label)) {
          if (++interactions > 16) { limited = true; break; }
          const button = elements.nth(index);
          if (!await button.isVisible()) continue;
          action = 'download';
          const before = observed;
          const visibleLinks = () => page.locator('a[href]').evaluateAll(nodes => nodes.slice(0, 250).map(el => el.href));
          const prior = new Set(await visibleLinks());
          await button.click({ timeout: 1800 });
          await page.waitForLoadState('networkidle', { timeout: 3000 });
          for (const link of await visibleLinks()) if (!prior.has(link)) collect(links, link);
          if (observed === before && !assets.size) {
            // Event handlers can schedule a download after the click has completed.
            const until = Date.now() + 1000;
            while (observed === before && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 40));
          }
          if (observed === before) unresolved = true;
          action = '';
        }
      }
      if (limited || !next || !await next.isVisible()) break;
      if (++interactions > 16 || states.size >= 6) { limited = true; break; }
      await next.click({ timeout: 1800 });
      await page.waitForLoadState('networkidle', { timeout: 3000 });
    }
    await context.close();
    return { links: [...links], assets: [...assets], gate, limited, unresolved };
  } finally { signal.removeEventListener('abort', abort); await browser.close(); }
}
