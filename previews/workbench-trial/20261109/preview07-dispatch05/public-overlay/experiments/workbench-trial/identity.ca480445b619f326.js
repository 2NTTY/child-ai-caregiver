/* Workbench trial URL identity only. Product/history state stays browser-owned. */
(function () {
  'use strict';
  const ORIGIN = "https://yuyoufang-fe37-private-qa.ec002se.chatgpt.site";
  const ROUTES = ["/", "/login", "/guide", "/chat", "/care", "/profile", "/tasks", "/tasks/", "/summary", "/growth", "/memory", "/history", "/photos", "/sources", "/settings", "/family", "/contact", "/more", "/admin"];
  const MARKER = 'workbench-trial';
  const ADAPTER_SRI = "sha256-/B1ewnkbyXZwz6p+U9h6XCdNzmLtdo0a7voPbPNC9hM=";
  const doc = document;
  const root = doc.getElementById('root');
  const overlay = doc.getElementById('h629-qa-hold');
  const status = doc.getElementById('h629-qa-status');
  let stopped = false;
  function hold() {
    stopped = true;
    if (root) root.inert = true;
    if (overlay) { overlay.hidden = false; overlay.setAttribute('aria-modal', 'true'); }
    if (status) status.textContent = 'WORKBENCH_TRIAL_URL_HOLD';
    throw new Error('WORKBENCH_TRIAL_URL_HOLD');
  }
  function destination(raw, requireMarker) {
    if (stopped || typeof raw !== 'string' || !raw || raw.trim() !== raw || /[\u0000-\u0020\u007f\\]/.test(raw)) return hold();
    let url;
    try { url = new URL(raw, location.href); } catch (_) { return hold(); }
    if (url.origin !== ORIGIN || url.protocol !== 'https:' || url.username || url.password || !ROUTES.includes(url.pathname)) return hold();
    const values = url.searchParams.getAll('experiment');
    if (values.length > 1 || values.length === 1 && values[0] !== MARKER || requireMarker && values.length !== 1) return hold();
    // Reserved identity fields cannot be encoded, duplicated or borrowed from v96.
    for (const field of url.search.slice(1).split('&').filter(Boolean)) {
      const part = new URLSearchParams(field);
      for (const key of part.keys()) {
        if (key === 'experiment' && field !== 'experiment=workbench-trial') return hold();
        if (key === 'previewScenario' || key === 'previewLoading') return hold();
      }
    }
    return url.href;
  }
  function method(object, key) {
    for (let at = object; at; at = Object.getPrototypeOf(at)) {
      const descriptor = Object.getOwnPropertyDescriptor(at, key);
      if (descriptor) return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function' ? descriptor.value : null;
    }
    return null;
  }
  function wrapHistory(key) {
    const original = method(history, key);
    const own = Object.getOwnPropertyDescriptor(history, key);
    if (!original || own && (!Object.hasOwn(own, 'value') || !own.configurable && !own.writable) || !own && !Object.isExtensible(history)) return hold();
    const wrapped = function () {
      if (this !== history || stopped) return hold();
      const args = Array.from(arguments);
      if (args.length < 3 || args[2] === undefined || args[2] === null) destination(location.href, false);
      else destination(args[2], false);
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(history, key, own ? {...own, value: wrapped} : {value: wrapped, writable: true, configurable: true});
  }
  function anchorFor(target) {
    return target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
  }
  function decorate(anchor) {
    if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return false;
    const raw = anchor.getAttribute('href');
    if (!raw) return false;
    // Mere rendering of an external/help link must not activate or HOLD it.
    let proposed;
    try { proposed = new URL(raw, location.href); } catch (_) { return false; }
    if (proposed.origin !== ORIGIN || !ROUTES.includes(proposed.pathname)) return false;
    destination(raw, false);
    return true;
  }
  function intercept(event) {
    const anchor = anchorFor(event.target);
    if (!anchor) return;
    try {
      if (stopped || event.type === 'auxclick' || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !decorate(anchor)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    } catch (_) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  try {
    if (!root || !overlay || !status || location.origin !== ORIGIN) return hold();
    destination(location.href, true);
    wrapHistory('pushState');
    wrapHistory('replaceState');
    addEventListener('popstate', function (event) {
      try { destination(location.href, false); } catch (_) { event.stopImmediatePropagation(); }
    }, true);
    addEventListener('hashchange', function (event) {
      try { destination(location.href, false); } catch (_) { event.stopImmediatePropagation(); }
    }, true);
    addEventListener('pageshow', function (event) {
      if (event.persisted) { try { hold(); } catch (_) { event.stopImmediatePropagation(); } }
    }, true);
    doc.addEventListener('click', intercept, true);
    doc.addEventListener('auxclick', intercept, true);
    doc.addEventListener('contextmenu', function (event) {
      const anchor = anchorFor(event.target);
      if (!anchor) return;
      try { if (!decorate(anchor)) event.preventDefault(); } catch (_) { event.preventDefault(); }
    }, true);
    doc.addEventListener('dragstart', function (event) {
      const anchor = anchorFor(event.target);
      if (!anchor) return;
      try { if (!decorate(anchor)) event.preventDefault(); } catch (_) { event.preventDefault(); }
    }, true);
    // Parser-time adapter insertion is fail-closed: failed identity never loads it.
    doc.write('<script src="/qa/adapter.js" integrity="' + ADAPTER_SRI + '"><\/script>');
  } catch (_) { /* No adapter/product fallthrough after a failed initial guard. */ }
})();
