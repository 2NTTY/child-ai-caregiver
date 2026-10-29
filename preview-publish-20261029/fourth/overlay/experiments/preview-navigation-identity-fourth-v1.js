/* Preview-owned URL carrier only. Native events, product props and history remain owned by the app/browser. */
(function () {
  'use strict';
  const context = window.__YU_PREVIEW_IDENTITY__, comparison = window.__YU_COMPARISON__;
  const variants = new Set(['uiux-upgrade']);
  const scenarios = new Set(['ready', 'complete-profile', 'populated', 'long-content', 'empty', 'error', 'signedout', 'loading', 'no-child', 'mutation-unknown', 'unknown-age-zero-records', 'core-journeys', 'core-no-child']);
  const loadingTargets = new Set(['children', 'child-reads', 'documents']);
  if (!context || !Object.isFrozen(context) || context.version !== 'preview-navigation-identity-fourth-v1' || !variants.has(context.variant) || !scenarios.has(context.scenario) || (context.scenario === 'loading' ? !loadingTargets.has(context.loading) : context.loading !== null) || !comparison || !Object.isFrozen(comparison) || comparison.version !== context.variant || !Array.isArray(context.routes) || !Object.isFrozen(context.routes) || !context.routes.includes(comparison.route)) return;
  const decorated = new WeakMap();
  const routes = new Set(context.routes), keys = ['experiment', 'previewScenario', 'previewLoading'];
  function decorate(anchor) {
    if (!anchor || anchor.localName !== 'a') return;
    const raw = anchor.getAttribute('href'), previous = decorated.get(anchor);
    if (previous && raw !== previous.output) decorated.delete(anchor);
    if (anchor.hasAttribute('download')) {
      if (previous && raw === previous.output) { decorated.delete(anchor); anchor.setAttribute('href', previous.input); }
      return;
    }
    if (!anchor.hasAttribute('href')) return;
    // Do not reinterpret whitespace, controls, fragments, unsafe schemes or credentials.
    if (!raw || raw.trim() !== raw || /[\u0000-\u0020\u007f\\]/.test(raw) || raw[0] === '#') return;
    let target, route;
    try { target = new URL(raw, location.href); route = decodeURIComponent(target.pathname).replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index'; } catch (_) { return; }
    if (!['http:', 'https:'].includes(target.protocol) || target.origin !== location.origin || target.username || target.password || !routes.has(route)) return;
    const values = keys.map(key => target.searchParams.getAll(key));
    if (values.some(value => value.length > 1)) return;
    const [variant, scenario, loading] = values.map(value => value.length ? value[0] : null);
    if (variant !== null && variant !== context.variant || scenario !== null && !scenarios.has(scenario) || loading !== null && !loadingTargets.has(loading)) return;
    // An explicitly different scenario is its own entry intent; never add the current scenario to it.
    const selectedScenario = scenario === null ? context.scenario : scenario;
    if (loading !== null && selectedScenario !== 'loading') return;
    const additions = [];
    if (variant === null) additions.push('experiment=' + encodeURIComponent(context.variant));
    if (scenario === null) additions.push('previewScenario=' + encodeURIComponent(context.scenario));
    if (selectedScenario === 'loading' && loading === null) additions.push('previewLoading=' + encodeURIComponent(scenario === null ? context.loading : 'children'));
    if (!additions.length) return;
    const split = raw.indexOf('#'), head = split < 0 ? raw : raw.slice(0, split), fragment = split < 0 ? '' : raw.slice(split);
    const separator = head.includes('?') ? /[?&]$/.test(head) ? '' : '&' : '?';
    const output = head + separator + additions.join('&') + fragment;
    decorated.set(anchor, { input: raw, output });
    anchor.setAttribute('href', output);
  }
  function scan(node) {
    decorate(node);
    if (node.querySelectorAll) for (const anchor of node.querySelectorAll('a[href]')) decorate(anchor);
  }
  // Observe the Document, not a replaceable root. No focus, node replacement, polling or activation handlers.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') decorate(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'download'] });
  scan(document);
})();
