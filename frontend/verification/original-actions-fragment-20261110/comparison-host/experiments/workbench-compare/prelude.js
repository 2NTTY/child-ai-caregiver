/* Must run before historical safety/fixtures. No persistent or native network authority. */
(function () {
  'use strict';
  const deny = () => { throw new TypeError('Historical comparison is read-only'); };
  function memoryStorage() {
    const values = new Map();
    return Object.freeze({get length() { return values.size; }, getItem(key) { return values.get(String(key)) ?? null; }, setItem(key, value) { values.set(String(key), String(value)); }, removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); }, key(index) { return [...values.keys()][index] ?? null; }});
  }
  function lock(target, key, value) { Object.defineProperty(target, key, {configurable: false, enumerable: true, get: () => value, set() { /* Legacy deny guards may assign; they cannot restore authority. */ }}); }
  lock(window, 'localStorage', memoryStorage()); lock(window, 'sessionStorage', memoryStorage());
  lock(window, 'indexedDB', Object.freeze({open: deny, deleteDatabase: deny}));
  lock(window, 'caches', Object.freeze({open: deny, match: deny, keys: deny, delete: deny}));
  Object.defineProperty(document, 'cookie', {configurable: false, get: () => '', set: deny});
  for (const key of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection']) lock(window, key, class { constructor() { deny(); } });
  lock(window, 'open', deny); lock(navigator, 'sendBeacon', () => false);
  if (navigator.serviceWorker) {
    // A real registration can already exist on this origin. Never expose its
    // controller, active worker or PushManager to historical startup/cleanup.
    const localWorkers = {};
    lock(localWorkers, 'controller', null);
    lock(localWorkers, 'register', deny);
    lock(localWorkers, 'getRegistration', async () => undefined);
    lock(localWorkers, 'getRegistrations', async () => []);
    lock(navigator, 'serviceWorker', Object.freeze(localWorkers));
  }
  if (window.__HISTORICAL_COMPARE_CONFIG__?.caseKey === 'signedout' && navigator.credentials) {
    for (const key of ['get', 'create', 'store', 'preventSilentAccess']) lock(navigator.credentials, key, deny);
  }
  if (navigator.mediaDevices) { lock(navigator.mediaDevices, 'getUserMedia', deny); lock(navigator.mediaDevices, 'getDisplayMedia', deny); }
  if (navigator.clipboard) { lock(navigator.clipboard, 'write', deny); lock(navigator.clipboard, 'writeText', deny); }
  // Real historical chat/photo renderers may create detached file inputs. Deny at
  // the native entrypoint, before any legacy safety guard can replace this lock.
  for (const key of ['showOpenFilePicker', 'showDirectoryPicker', 'showSaveFilePicker']) if (window[key]) lock(window, key, deny);
  if (navigator.share) lock(navigator, 'share', deny);
  if (window.Notification) lock(window.Notification, 'requestPermission', deny);
  for (const key of ['click', 'showPicker']) {
    const native = HTMLInputElement.prototype[key];
    if (native) lock(HTMLInputElement.prototype, key, function (...args) { if (this.type === 'file') return deny(); return native.apply(this, args); });
  }
  const stopFiles = event => {
    if (event.target?.type !== 'file' && !event.dataTransfer?.files?.length && !event.clipboardData?.files?.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'change' && event.target?.type === 'file') event.target.value = '';
  };
  for (const type of ['click', 'change', 'drop', 'paste']) document.addEventListener(type, stopFiles, true);
  const config = window.__HISTORICAL_COMPARE_CONFIG__;
  const NativeDate = window.Date;
  const fixed = NativeDate.parse(config.asOf);
  if (!Number.isFinite(fixed)) throw new Error('COMPARISON_CLOCK_REQUIRED');
  const Clock = new Proxy(NativeDate, {
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixed], newTarget); },
    apply() { return new NativeDate(fixed).toString(); },
    get(target, key) { return key === 'now' ? () => fixed : Reflect.get(target, key); },
  });
  lock(window, 'Date', Clock);
  let index = 0, failed = false, prior = null;
  const stages = config.historicalChain;
  Object.defineProperty(window, '__HISTORICAL_CHAIN__', {value:Object.freeze({
    record(path, digest) {
      const expected = stages[index];
      if (failed || !expected || expected.path !== path || expected.sha256 !== digest || typeof window.fetch !== 'function') { failed=true; return; }
      if (index === 0) {
        const fixture = config.variant === 'original' ? window.__YUY_QA__ : window.__YU_PREVIEW__;
        if (window.fetch !== fixture?.transport) { failed=true; return; }
      } else if (expected.transition === 'wrap' ? window.fetch === prior : window.fetch !== prior) { failed=true; return; }
      prior=window.fetch; index++;
    },
    snapshot() { return Object.freeze({complete:index===stages.length,failed,transport:prior,index}); },
  }), configurable:false});
  window.fetch = async () => { throw new TypeError('Comparison fixture not installed'); };
})();
