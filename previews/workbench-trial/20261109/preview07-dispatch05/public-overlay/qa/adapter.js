/* H629 QA only: storage unavailable. Original product scripts remain unchanged. */
(function () {
  'use strict';
  const realm = globalThis;
  const doc = realm.document;
  const MAIN_PATH = '/_expo/static/js/web/index-497a6f7e4c4eabdb035d072d879ddcd4.js';
  const MAIN_SHA = '4f052435a02e2a47ebc877314c68adcb3964d346a0112d0aed299e6e6d7494c2';
  const ROUTES = ['/', '/login', '/guide', '/chat', '/care', '/profile', '/tasks', '/tasks/', '/summary', '/growth', '/memory', '/history', '/photos', '/sources', '/settings', '/family', '/contact', '/more', '/admin', '/scene-observer-qa', '/scene-observer-qa/'];
  const status = doc && doc.getElementById('h629-qa-status');
  const overlay = doc && doc.getElementById('h629-qa-hold');
  const root = doc && doc.getElementById('root');
  const configNode = doc && doc.getElementById('h629-qa-config');
  const adapterURL = doc && doc.currentScript && doc.currentScript.src;
  let blocked = false;
  let mainAppended = status && status.getAttribute('data-main-appended') === '1' ? 1 : 0;
  let phase = 'preflight';
  let reason = null;
  let mainURL = null;
  let ownedProcess = null;
  let ownedEnv = null;
  let presenceTimer = null;
  const denied = {localStorage: 0, sessionStorage: 0, indexedDB: 0, cookieStore: 0, caches: 0, cookieGet: 0, cookieSet: 0, storageEvent: 0};
  const originals = {setTimeout: realm.setTimeout, clearTimeout: realm.clearTimeout};
  function count(key) { denied[key] = Math.min(65535, denied[key] + 1); }
  function render() {
    if (status) status.textContent = JSON.stringify({phase, reason, mainAppended, storage: 'unavailable', denied});
  }
  function hold(code) {
    if (!blocked) reason = code;
    blocked = true; phase = 'hold';
    if (presenceTimer !== null) { Reflect.apply(originals.clearTimeout, realm, [presenceTimer]); presenceTimer = null; }
    if (root) root.inert = true;
    if (overlay) { overlay.hidden = false; overlay.setAttribute('aria-modal', 'true'); }
    render();
  }
  if (!status || !overlay || !root || !configNode) return;
  if (status.getAttribute('data-started') === '1') { hold('DUPLICATE_START'); return; }
  status.setAttribute('data-started', '1');
  render();

  function exactKeys(object, expected) {
    return !!object && typeof object === 'object' && !Array.isArray(object) &&
      Object.keys(object).length === expected.length && expected.every(key => Object.hasOwn(object, key));
  }
  function dataMethod(object, key) {
    for (let at = object; at; at = Object.getPrototypeOf(at)) {
      const descriptor = Object.getOwnPropertyDescriptor(at, key);
      if (descriptor) return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function' ? descriptor.value : null;
    }
    return null;
  }
  function config() {
    if (typeof configNode.textContent !== 'string' || configNode.textContent.length > 4096) return null;
    let value;
    try { value = JSON.parse(configNode.textContent); } catch { return null; }
    if (!exactKeys(value, ['schemaVersion', 'mode', 'expectedOrigin', 'main', 'allowedRoutes']) || value.schemaVersion !== 1 || value.mode !== 'storage-unavailable') return null;
    if (!exactKeys(value.main, ['src', 'sha256']) || value.main.src !== MAIN_PATH || value.main.sha256 !== MAIN_SHA) return null;
    if (!Array.isArray(value.allowedRoutes) || value.allowedRoutes.length !== ROUTES.length || !ROUTES.every((route, index) => value.allowedRoutes[index] === route)) return null;
    if (typeof value.expectedOrigin !== 'string') return null;
    try {
      const origin = new realm.URL(value.expectedOrigin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.expectedOrigin || origin.username || origin.password) return null;
    } catch { return null; }
    return value;
  }
  // This classification never permits native access. Every accessor below throws.
  function expectedCaller(kind) {
    let stack;
    try { stack = new realm.Error().stack; } catch { return false; }
    if (typeof stack !== 'string' || stack.length > 4096) return false;
    const lines = stack.split('\n');
    if (lines.length < 2 || lines.length > 20) return false;
    for (const line of lines.slice(1)) {
      const match = line.trim().match(/^at (?:.*? \()?((?:https?:\/\/)[^\s()]+):(\d+):(\d+)\)?$/);
      if (!match) return false;
      if (match[1] === adapterURL) continue;
      return match[1] === mainURL && ((kind === 'localStorage' && match[2] === '1094') || (kind === 'indexedDB' && match[2] === '2095'));
    }
    return false;
  }
  function deny(kind, isSetter) {
    return function () {
      count(kind);
      const expected = !isSetter && (kind === 'localStorage' || kind === 'indexedDB') && expectedCaller(kind);
      if (!expected) hold(kind === 'cookieGet' || kind === 'cookieSet' ? 'COOKIE_ACCESS_DENIED' : 'UNREVIEWED_STORAGE_ACCESS');
      else render();
      throw new realm.DOMException('QA storage is unavailable', 'SecurityError');
    };
  }
  function storagePatches() {
    const patches = [];
    function collect(object, key, getKind, setKind) {
      let found = false;
      for (let at = object; at; at = Object.getPrototypeOf(at)) {
        const descriptor = Object.getOwnPropertyDescriptor(at, key);
        if (!descriptor) continue;
        found = true;
        // Never call or preserve the native getter, and never shadow a reachable one.
        if (!descriptor.configurable || Object.hasOwn(descriptor, 'value')) return false;
        patches.push({owner: at, key, enumerable: descriptor.enumerable, getKind, setKind});
      }
      if (!found) {
        if (!Object.isExtensible(object)) return false;
        patches.push({owner: object, key, enumerable: true, getKind, setKind});
      }
      return true;
    }
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'cookieStore', 'caches']) if (!collect(realm, key, key, key)) return null;
    if (!collect(doc, 'cookie', 'cookieGet', 'cookieSet')) return null;
    return patches;
  }
  function envIntact() {
    const processDescriptor = Object.getOwnPropertyDescriptor(realm, 'process');
    const envDescriptor = Object.getOwnPropertyDescriptor(ownedProcess, 'env');
    const defaultsDescriptor = Object.getOwnPropertyDescriptor(ownedEnv, '__FIREBASE_DEFAULTS__');
    const modeDescriptor = Object.getOwnPropertyDescriptor(ownedEnv, 'NODE_ENV');
    return processDescriptor && Object.hasOwn(processDescriptor, 'value') && processDescriptor.value === ownedProcess &&
      envDescriptor && Object.hasOwn(envDescriptor, 'value') && envDescriptor.value === ownedEnv &&
      defaultsDescriptor && Object.hasOwn(defaultsDescriptor, 'value') && defaultsDescriptor.value === '{}' &&
      modeDescriptor && Object.hasOwn(modeDescriptor, 'value') && modeDescriptor.value === 'production' && !('__FIREBASE_DEFAULTS__' in realm);
  }
  function install(patches) {
    ownedEnv = Object.create(null);
    Object.defineProperties(ownedEnv, {
      __FIREBASE_DEFAULTS__: {value: '{}', writable: false, configurable: false, enumerable: true},
      NODE_ENV: {value: 'production', writable: false, configurable: false, enumerable: true}
    });
    ownedProcess = Object.create(null);
    Object.defineProperty(ownedProcess, 'env', {value: ownedEnv, writable: true, configurable: false, enumerable: true});
    Object.defineProperty(realm, 'process', {value: ownedProcess, writable: true, configurable: false, enumerable: true});
    for (const patch of patches) Object.defineProperty(patch.owner, patch.key, {
      configurable: false, enumerable: patch.enumerable,
      get: deny(patch.getKind, false), set: deny(patch.setKind, true)
    });
    realm.addEventListener('storage', event => {
      event.stopImmediatePropagation(); count('storageEvent'); hold('STORAGE_EVENT_BLOCKED');
    }, true);
    for (const type of ['error', 'unhandledrejection']) realm.addEventListener(type, () => hold('BROWSER_ERROR'), true);
    for (const type of ['click', 'pointerdown', 'keydown', 'submit']) realm.addEventListener(type, event => {
      if (blocked) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  async function swAdmission(sw, registrations) {
    const controllerChanged = () => hold('SERVICE_WORKER_CHANGE');
    sw.addEventListener('controllerchange', controllerChanged);
    let presence;
    try {
      presence = await new realm.Promise(resolve => {
        let settled = false;
        const finish = allowed => {
          if (settled) return;
          settled = true;
          if (presenceTimer !== null) { Reflect.apply(originals.clearTimeout, realm, [presenceTimer]); presenceTimer = null; }
          resolve(allowed);
        };
        presenceTimer = Reflect.apply(originals.setTimeout, realm, [() => { hold('SERVICE_WORKER_TIMEOUT'); finish(false); }, 1500]);
        let promise;
        try { promise = Reflect.apply(registrations, sw, []); }
        catch { hold('SERVICE_WORKER_CHECK_FAILED'); finish(false); return; }
        realm.Promise.resolve(promise).then(rows => {
          if (!Array.isArray(rows) || rows.length !== 0 || sw.controller) { hold('SERVICE_WORKER_PRESENT'); finish(false); return; }
          finish(true);
        }, () => { hold('SERVICE_WORKER_CHECK_FAILED'); finish(false); });
      });
    } catch { hold('SERVICE_WORKER_CHECK_FAILED'); return false; }
    return presence && !blocked;
  }
  async function start() {
    realm.addEventListener('pageshow', event => { if (event.persisted) hold('BFCACHE_RESUME'); }, true);
    const value = config();
    if (!value) { hold('CONFIG_NOT_ADMITTED'); return; }
    if (realm.window !== realm || realm.self !== realm || realm.top !== realm || realm.opener) { hold('DOCUMENT_NOT_OWNED'); return; }
    if (realm.location.origin !== value.expectedOrigin || adapterURL !== value.expectedOrigin + '/qa/adapter.js') { hold('ORIGIN_NOT_ADMITTED'); return; }
    if (!ROUTES.includes(realm.location.pathname)) { hold('ROUTE_NOT_ADMITTED'); return; }
    if ('process' in realm || '__FIREBASE_DEFAULTS__' in realm || '__REACT_DEVTOOLS_GLOBAL_HOOK__' in realm) { hold('FOREIGN_CONFIGURATION'); return; }
    if (!Object.isExtensible(realm) || typeof root.inert !== 'boolean') { hold('UNSUPPORTED_REALM'); return; }
    if (!storagePatches()) { hold('UNSUPPORTED_STORAGE_DESCRIPTOR'); return; }
    const sw = realm.navigator && realm.navigator.serviceWorker;
    const registrations = sw && dataMethod(sw, 'getRegistrations');
    if (!sw || !registrations || typeof sw.addEventListener !== 'function') { hold('SERVICE_WORKER_API_UNSUPPORTED'); return; }
    if (sw.controller) { hold('SERVICE_WORKER_PRESENT'); return; }
    mainURL = value.expectedOrigin + MAIN_PATH;
    if (!await swAdmission(sw, registrations) || blocked) return;
    if ('process' in realm || '__FIREBASE_DEFAULTS__' in realm || '__REACT_DEVTOOLS_GLOBAL_HOOK__' in realm) { hold('FOREIGN_CONFIGURATION'); return; }
    const patches = storagePatches();
    if (!patches) { hold('UNSUPPORTED_STORAGE_DESCRIPTOR'); return; }
    try { install(patches); } catch { hold('BOUNDARY_INSTALL_FAILED'); return; }
    if (blocked || !envIntact()) { hold('OWNED_ENV_CHANGED'); return; }
    const script = doc.createElement('script');
    script.src = MAIN_PATH; script.defer = true; script.async = false;
    script.integrity = 'sha256-' + realm.btoa(MAIN_SHA.match(/../g).map(hex => String.fromCharCode(parseInt(hex, 16))).join(''));
    script.onload = () => {
      if (blocked) return;
      if (!envIntact()) { hold('OWNED_ENV_CHANGED'); return; }
      phase = 'main-loaded'; render();
    };
    script.onerror = () => hold('MAIN_LOAD_FAILED');
    phase = 'loading-main'; render();
    try {
      doc.body.appendChild(script);
      mainAppended = 1; status.setAttribute('data-main-appended', '1'); render();
    } catch { hold('MAIN_APPEND_FAILED'); }
  }
  void start().catch(() => hold('PRELUDE_FAILED'));
}());
