/* Standalone fourth candidate only. The canonical site owner retains the historical original dispatcher. */
(function () {
  'use strict';
  const url = new URL(location.href);
  const modes = new Set(['ready', 'complete-profile', 'populated', 'long-content', 'empty', 'error', 'signedout', 'loading', 'no-child', 'mutation-unknown', 'unknown-age-zero-records', 'core-journeys', 'core-no-child']);
  const targets = new Set(['children', 'child-reads', 'documents']);
  const routes = Object.freeze(['(dashboard)/care', '(dashboard)/chat', '(dashboard)/contact', '(dashboard)/family', '(dashboard)/growth', '(dashboard)/guide', '(dashboard)/history', '(dashboard)/index', '(dashboard)/memory', '(dashboard)/more', '(dashboard)/photos', '(dashboard)/profile', '(dashboard)/settings', '(dashboard)/sources', '(dashboard)/summary', '(dashboard)/tasks', '+not-found', '_sitemap', 'admin', 'care', 'chat', 'contact', 'family', 'growth', 'guide', 'history', 'index', 'login', 'memory', 'more', 'photos', 'profile', 'settings', 'sources', 'summary', 'tasks']);
  for (const key of ['experiment', 'previewScenario', 'previewLoading']) if (url.searchParams.getAll(key).length > 1 || url.searchParams.has(key) && url.searchParams.get(key) === '') throw new Error('Unsupported fourth selection');
  for (const key of url.searchParams.keys()) if (key.startsWith('previewWork') || key.startsWith('initialWork')) throw new Error('Unsupported fourth work selection');
  const choice = url.searchParams.get('experiment') ?? 'uiux-upgrade';
  if (choice !== 'uiux-upgrade') throw new Error('Standalone fourth candidate: use the canonical comparison site to return to the historical original');
  const scenario = url.searchParams.get('previewScenario') ?? 'ready';
  const loading = scenario === 'loading' ? url.searchParams.get('previewLoading') ?? 'children' : null;
  if (!modes.has(scenario) || scenario === 'loading' && !targets.has(loading) || scenario !== 'loading' && url.searchParams.has('previewLoading')) throw new Error('Unsupported fourth mode');
  let route;
  try { route = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index'; } catch (_) { route = '+not-found'; }
  if (!routes.includes(route)) route = '+not-found';
  window.__YU_COMPARISON__ = Object.freeze({ version: choice, route });
  window.__YU_PREVIEW_IDENTITY__ = Object.freeze({ version: 'preview-navigation-identity-fourth-v1', variant: choice, scenario, loading, routes });
  document.write('<script src="/experiments/preview-navigation-identity-fourth-v1.js"><\/script><script src="/experiments/payload/uiux-upgrade/' + route + '.js"><\/script>');
})();
