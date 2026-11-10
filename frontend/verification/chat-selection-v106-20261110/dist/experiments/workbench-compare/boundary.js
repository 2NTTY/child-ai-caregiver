/* Read-only, document-local boundary. Existing historical fixture transports remain the readers.
 * No native Tasks bridge, shared owner, real transport, persistent storage or command receiver.
 */
(function () {
  'use strict';
  const config = window.__HISTORICAL_COMPARE_CONFIG__;
  const epoch = window.name.split(':').at(-1);
  if (!config || !/^[a-f0-9]{32}$/.test(epoch)) throw new Error('COMPARISON_IDENTITY_REQUIRED');
  const fixture = window.__HISTORICAL_SHARED_READER__;
  const fixtureTransport = fixture?.transport;
  if (typeof fixtureTransport !== 'function' || window.fetch !== fixtureTransport || fixture.caseKey !== config.caseKey || fixture.caseId !== config.caseId || fixture.caseSha256 !== config.caseSha256) throw new TypeError('PINNED_FIXTURE_REQUIRED');
  const transport = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = String(init?.method ?? (typeof input === 'object' ? input.method : undefined) ?? 'GET').toUpperCase();
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new TypeError('Comparison blocks non-fixture requests');
    const response = await fixtureTransport(input, init);
    if (response.headers.get('x-comparison-operation') === 'blocked-write') { edited = true; observe(); }
    return response;
  };
  Object.defineProperty(window, 'fetch', {configurable: false, get: () => transport, set() { /* Later assignments cannot replace the read-only wrapper. */ }});
  const documentId = crypto.randomUUID().replaceAll('-', '');
  let sequence = 0, edited = false;
  const message = () => ({protocol: 'historical-comparison-observation-v2', side: config.side, variant: config.variant, epoch, documentId, caseKey: config.caseKey, caseId: config.caseId, caseSha256: config.caseSha256, mainSha256: config.mainSha256, sequence, route: location.pathname + location.search, edited});
  // Parent uses actual iframe load plus this read-only document token to exclude late,
  // previously unseen messages from a retired document. This is not a native guard.
  Object.defineProperty(window, '__HISTORICAL_COMPARE_OBSERVATION__', {configurable: false, get: () => Object.freeze(message())});
  function observe() {
    if (sequence >= 1000000) return;
    sequence++;
    parent.postMessage(message(), config.parentOrigin);
  }
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  document.addEventListener('submit', stop, true);
  document.addEventListener('click', event => {
    const target = event.target;
    if (target?.closest?.('input[type="file"],a[download]')) { stop(event); return; }
    const link = target?.closest?.('a[href]');
    if (!link) return;
    let url; try { url = new URL(link.href, location.href); } catch { stop(event); return; }
    const route = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index';
    if (url.origin !== location.origin || link.target && link.target !== '_self' || !config.routes.includes(route)) stop(event);
  }, true);
  document.addEventListener('beforeinput', () => { edited = true; observe(); }, true);
  for (const method of ['pushState', 'replaceState']) {
    const native = history[method].bind(history);
    history[method] = function (...args) { const result = native(...args); observe(); return result; };
  }
  window.addEventListener('popstate', observe); window.addEventListener('load', observe);
  Object.defineProperty(window, '__HISTORICAL_COMPARE_READY__', {value:{epoch,main:config.main,mainSha256:config.mainSha256,caseKey:config.caseKey,caseId:config.caseId,caseSha256:config.caseSha256,loaded:false},configurable:false});
})();
