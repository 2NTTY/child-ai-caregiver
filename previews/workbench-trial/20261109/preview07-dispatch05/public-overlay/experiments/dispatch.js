/* Preview packaging identity v1. No product router, owner or network calls. */
(function () {
  'use strict';
  // Explicit, non-persistent trial choice. No old variant/default is changed.
  const trialURL = new URL(location.href);
  const trialValues = trialURL.searchParams.getAll('experiment');
  if (trialValues.includes('workbench-trial')) {
    const trialRoutes = ["/", "/login", "/guide", "/chat", "/care", "/profile", "/tasks", "/tasks/", "/summary", "/growth", "/memory", "/history", "/photos", "/sources", "/settings", "/family", "/contact", "/more", "/admin"];
    if (trialURL.origin !== "https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site" || trialURL.protocol !== 'https:' || trialURL.username || trialURL.password || trialValues.length !== 1 || !trialRoutes.includes(trialURL.pathname)) throw new Error('WORKBENCH_TRIAL_ENTRY_HOLD');
    for (const field of trialURL.search.slice(1).split('&').filter(Boolean)) {
      const part = new URLSearchParams(field);
      for (const key of part.keys()) {
        if (key === 'experiment' && field !== 'experiment=workbench-trial' || key === 'previewScenario' || key === 'previewLoading') throw new Error('WORKBENCH_TRIAL_ENTRY_HOLD');
      }
    }
    document.write("<script src=\"/experiments/workbench-trial/entry.c7e8f5ad62b540c6.js\" integrity=\"sha256-x+j1rWK1QMZjoBnzjhfQOIf2ezd73ptGNh0lsWVfnXA=\"><\/script>");
    return;
  }
  const choiceKey = 'yuban.frontend-comparison.v1';
  const tupleKey = 'yuban.frontend-comparison.identity.v1';
  const choices = new Set(['harbour', 'care', 'journal', 'uiux-upgrade']);
  const baseScenarios = new Set(['ready', 'complete-profile', 'populated', 'long-content', 'empty', 'error', 'signedout', 'loading', 'no-child', 'mutation-unknown', 'unknown-age-zero-records', 'core-journeys', 'core-no-child']);
  const scenarioExtras = Object.freeze({"harbour":[],"care":["memory-work-reading"],"journal":[],"uiux-upgrade":[]});
  const supportsScenario = (variant, value) => baseScenarios.has(value) || Object.prototype.hasOwnProperty.call(scenarioExtras, variant) && scenarioExtras[variant].includes(value);
  const loadingTargets = new Set(['children', 'child-reads', 'documents']);
  const allowed = new Set(["(dashboard)/care", "(dashboard)/chat", "(dashboard)/contact", "(dashboard)/family", "(dashboard)/growth", "(dashboard)/guide", "(dashboard)/history", "(dashboard)/index", "(dashboard)/memory", "(dashboard)/more", "(dashboard)/photos", "(dashboard)/profile", "(dashboard)/settings", "(dashboard)/sources", "(dashboard)/summary", "(dashboard)/tasks", "+not-found", "_sitemap", "admin", "care", "chat", "contact", "family", "growth", "guide", "history", "index", "login", "memory", "more", "photos", "profile", "settings", "sources", "summary", "tasks"]);
  const url = new URL(location.href);
  const single = key => { const values = url.searchParams.getAll(key); if (values.length > 1) throw new Error('Unsupported preview selection'); return values.length ? values[0] : null; };
  const requested = single('experiment'), requestedScenario = single('previewScenario'), requestedLoading = single('previewLoading');
  if (requested !== null && requested !== 'original' && !choices.has(requested) || requestedLoading !== null && !loadingTargets.has(requestedLoading)) throw new Error('Unsupported preview selection');
  let saved = null, prior = null;
  try { saved = sessionStorage.getItem(choiceKey); prior = JSON.parse(sessionStorage.getItem(tupleKey)); } catch (_) { /* Explicit URL selection still works when storage is denied. */ }
  const validTuple = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 3 && choices.has(value.variant) && supportsScenario(value.variant, value.scenario) && (value.scenario === 'loading' ? loadingTargets.has(value.loading) : value.loading === null);
  let choice = choices.has(requested) ? requested : requested === 'original' ? 'original' : choices.has(saved) ? saved : 'original';
  if (requestedScenario !== null && !supportsScenario(choice, requestedScenario)) throw new Error('Unsupported preview scenario for selected variant');
  const inherited = requested === null && validTuple(prior) && prior.variant === choice ? prior : null;
  const scenario = requestedScenario !== null ? requestedScenario : inherited ? inherited.scenario : 'ready';
  const loading = scenario === 'loading' ? requestedLoading || (requestedScenario === null && inherited ? inherited.loading : null) || 'children' : null;
  if (requestedLoading !== null && scenario !== 'loading') throw new Error('Unsupported preview selection');
  if (choice === 'uiux-upgrade') for (const key of url.searchParams.keys()) if (key.startsWith('previewWork') || key.startsWith('initialWork')) throw new Error('Unsupported fourth work selection');
  let route;
  try { route = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index'; }
  catch (_) { route = '+not-found'; }
  if (!allowed.has(route)) route = '+not-found';
  try {
    if (choice === 'original') { if (requested === 'original') { sessionStorage.removeItem(choiceKey); sessionStorage.removeItem(tupleKey); } }
    else { sessionStorage.setItem(choiceKey, choice); sessionStorage.setItem(tupleKey, JSON.stringify({ variant: choice, scenario, loading })); }
  } catch (_) { /* Persistence is optional; never change the selected explicit identity. */ }
  // Only startup metadata changes. Preserve every non-preview query byte and history state.
  const parts = url.search ? url.search.slice(1).split('&').filter(part => new URLSearchParams(part).has('experiment') === false) : [];
  if (choice !== 'original' && requestedScenario === null) parts.push('previewScenario=' + encodeURIComponent(scenario));
  if (choice !== 'original' && loading !== null && requestedLoading === null) parts.push('previewLoading=' + encodeURIComponent(loading));
  const search = parts.length ? '?' + parts.join('&') : '';
  if (search !== url.search) history.replaceState(history.state, '', url.pathname + search + url.hash);
  window.__YU_COMPARISON__ = Object.freeze({ version: choice, route });
  const identityVersion = choice === 'uiux-upgrade' ? 'preview-navigation-identity-fourth-v1' : 'preview-navigation-identity-v1-r3';
  if (choice !== 'original') window.__YU_PREVIEW_IDENTITY__ = Object.freeze({ version: identityVersion, variant: choice, scenario, loading, routes: Object.freeze([...allowed]) });
  document.write((choice === 'original' ? '' : '<script src="/experiments/' + identityVersion + '.js"><\/script>') + '<script src="/experiments/payload/' + choice + '/' + route + '.js"><\/script>');
})();
