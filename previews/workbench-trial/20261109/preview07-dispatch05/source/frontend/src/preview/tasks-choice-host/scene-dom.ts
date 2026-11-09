import type { SceneDOMLease, SceneDOMState, TrustedSceneDOMPort } from './scene-barrier';

type Roots = Readonly<{
  container: HTMLElement; productRoot: HTMLElement; controlsHost: HTMLElement;
  onInvalidate(reason: string): void; onReadinessChange?(): void; requestExit(): void;
}>;
const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** The sole scene DOM writer. Listeners observe gestures before any scene enters. */
export function createTasksChoiceSceneDOM({ container, productRoot, controlsHost, onInvalidate, onReadinessChange, requestExit }: Roots): TrustedSceneDOMPort & { retire(): void } {
  const doc = productRoot.ownerDocument, win = doc.defaultView;
  const stops: (() => void)[] = [], pointers = new Set<number>(), captured = new Set<number>(), touches = new Set<number>();
  const blockedPointers = new Set<number>(), blockedKeys = new Set<string>(), pressedKeys = new Set<string>();
  let live = true, failed = false, active: SceneDOMLease | null = null, focusing = false, compatibilityClick = false;
  function contains(root: HTMLElement, target: EventTarget | null): boolean {
    try { return target !== null && root.contains(target as Node); } catch { return false; }
  }
  function hiddenByAncestor(node: HTMLElement): boolean {
    for (let element: HTMLElement | null = node; element; element = element.parentElement) {
      if (element.inert === true || element.getAttribute('aria-hidden') === 'true' || element.hidden) return true;
    }
    return false;
  }
  function ready(): boolean {
    try {
      return live && !failed && !!win && productRoot !== controlsHost && productRoot.isConnected && controlsHost.isConnected
        && container.isConnected && productRoot.ownerDocument === controlsHost.ownerDocument && container.ownerDocument === doc
        && productRoot.parentElement === container && controlsHost.parentElement === container
        && !productRoot.contains(controlsHost) && !controlsHost.contains(productRoot)
        && typeof productRoot.inert === 'boolean' && !hiddenByAncestor(controlsHost);
    } catch { return false; }
  }
  const gestureActive = () => pointers.size > 0 || captured.size > 0 || touches.size > 0 || pressedKeys.size > 0;
  function read(): SceneDOMState {
    const available = ready();
    return Object.freeze({ ready: available, gestureActive: gestureActive(),
      controlsHost: live ? controlsHost : null, refusal: available ? null : 'ROOT_UNAVAILABLE' });
  }
  function invalidate(reason: string) {
    // Coordinator retires callback authority before this lease is restored. The
    // fallback also restores if its consumer is absent or throws.
    try { onInvalidate(reason); } catch { failed = true; }
    finally { active?.revoke(); }
  }
  function usable(node: HTMLElement) {
    try {
      const style = win?.getComputedStyle(node);
      return node.isConnected && node.tabIndex >= 0 && !node.hasAttribute('disabled')
        && node.getAttribute('aria-disabled') !== 'true' && !hiddenByAncestor(node)
        && node.getClientRects().length > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
    } catch { return false; }
  }
  function items() { return [...controlsHost.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(usable); }
  function focusControls(target?: HTMLElement) {
    if (focusing) return;
    focusing = true;
    try { (target ?? items()[0] ?? controlsHost).focus({ preventScroll: true }); }
    finally { focusing = false; }
  }
  function stop(event: Event) { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); }
  function isProduct(target: EventTarget | null) { return contains(container, target) && !contains(controlsHost, target); }
  function captureEvent(event: Event) {
    if (!live) return;
    const product = isProduct(event.target), pointer = event as PointerEvent;
    const keyIdentity = (event as KeyboardEvent).code || (event as KeyboardEvent).key;
    if (event.type === 'pointerdown' && product) {
      if (!active && blockedPointers.size === 0) compatibilityClick = false;
      if (!active) pointers.add(pointer.pointerId);
      if (active) { blockedPointers.add(pointer.pointerId); compatibilityClick = true; }
    }
    if (event.type === 'gotpointercapture' && product && !active) captured.add(pointer.pointerId);
    if (event.type === 'lostpointercapture') captured.delete(pointer.pointerId);
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      pointers.delete(pointer.pointerId); captured.delete(pointer.pointerId);
      if (blockedPointers.delete(pointer.pointerId)) { compatibilityClick = true; stop(event); return; }
    }
    if (event.type === 'touchstart' && product) {
      if (!active) for (const touch of Array.from((event as TouchEvent).changedTouches ?? [])) touches.add(touch.identifier);
      if (active) compatibilityClick = true;
    }
    if (event.type === 'touchend' || event.type === 'touchcancel') {
      for (const touch of Array.from((event as TouchEvent).changedTouches ?? [])) touches.delete(touch.identifier);
    }
    if (event.type === 'keydown' && product && !active) pressedKeys.add(keyIdentity);
    if (event.type === 'keyup') {
      pressedKeys.delete(keyIdentity);
      if (blockedKeys.delete(keyIdentity)) { stop(event); return; }
    }
    if (!active) {
      // A blocked press must not become a delayed product activation after Exit.
      if (product && event.type === 'click' && compatibilityClick) { compatibilityClick = false; stop(event); }
      return;
    }
    if (!active.current()) { invalidate('DOM_LEASE_CHANGED'); return; }
    if (event.type === 'focusin') {
      if (!contains(controlsHost, event.target)) { stop(event); focusControls(); }
      return;
    }
    if (event.type === 'keydown') {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') { stop(event); requestExit(); return; }
      if (key.key === 'Tab') {
        stop(event); const list = items(), index = list.indexOf(doc.activeElement as HTMLElement);
        const next = key.shiftKey ? (index <= 0 ? list.length - 1 : index - 1) : (index + 1) % list.length;
        focusControls(list[next]); return;
      }
      if (product) blockedKeys.add(keyIdentity);
    }
    if (product) stop(event);
  }
  function observeEvent(event: Event) {
    const wasActive = active !== null, before = gestureActive();
    try { captureEvent(event); }
    catch { failed = true; invalidate('DOM_EVENT_FAILED'); }
    finally {
      if (!wasActive && !active && before !== gestureActive()) {
        try { onReadinessChange?.(); } catch { failed = true; invalidate('DOM_OBSERVER_FAILED'); }
      }
    }
  }
  function listen(target: EventTarget | null, type: string, fn: EventListener, capture = false) {
    if (!target) return;
    target.addEventListener(type, fn, { capture, passive: false });
    stops.push(() => target.removeEventListener(type, fn, capture));
  }
  for (const type of ['pointerdown','pointerup','pointercancel','pointermove','gotpointercapture','lostpointercapture',
    'touchstart','touchmove','touchend','touchcancel','click','auxclick','contextmenu','keydown','keyup','focusin']) {
    listen(doc, type, observeEvent, true);
  }
  listen(win, 'blur', event => { if (event.target === win) invalidate('WINDOW_BLUR'); });
  listen(win, 'pagehide', () => invalidate('PAGE_HIDDEN'));
  listen(doc, 'visibilitychange', () => { if (doc.visibilityState !== 'visible') invalidate('DOCUMENT_HIDDEN'); });
  listen(win, 'resize', () => invalidate('VIEWPORT_CHANGED'));
  listen(win?.visualViewport ?? null, 'resize', () => invalidate('VIEWPORT_CHANGED'));
  listen(win?.visualViewport ?? null, 'scroll', () => invalidate('VIEWPORT_CHANGED'));
  // No popstate, beforeunload, online/offline or window-focus interception.
  const Resize = (win as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver;
  if (Resize) {
    let previous = productRoot.getBoundingClientRect();
    const observer = new Resize(() => {
      const next = productRoot.getBoundingClientRect();
      if (previous.width !== next.width || previous.height !== next.height) invalidate('ROOT_RESIZED');
      previous = next;
    });
    observer.observe(productRoot); stops.push(() => observer.disconnect());
  }
  function suppress(stillCurrent: () => boolean = () => true): SceneDOMLease | null {
    if (active || !read().ready || read().gestureActive || !stillCurrent()) return null;
    // Focus is not an acquired suppression lease. It may open a product overlay.
    try {
      if (!contains(controlsHost, doc.activeElement)) focusControls();
      if (!ready() || !stillCurrent() || !contains(controlsHost, doc.activeElement)
        || productRoot.inert || productRoot.getAttribute('aria-hidden') === 'true') return null;
    } catch { failed = true; return null; }
    const previousInert = productRoot.getAttribute('inert'), previousAria = productRoot.getAttribute('aria-hidden');
    const previousPointer = productRoot.style.getPropertyValue('pointer-events'), previousPriority = productRoot.style.getPropertyPriority('pointer-events');
    let held = true, ownsInert = false, ownsAria = false, ownsPointer = false;
    const restoreAttribute = (name: string, written: string, previous: string | null) => {
      if (productRoot.getAttribute(name) !== written) return;
      if (previous === null) productRoot.removeAttribute(name); else productRoot.setAttribute(name, previous);
    };
    const lease: SceneDOMLease = Object.freeze({
      current() {
        return held && active === lease && ready() && productRoot.inert === true
          && productRoot.getAttribute('inert') === '' && productRoot.getAttribute('aria-hidden') === 'true'
          && productRoot.style.getPropertyValue('pointer-events') === 'none'
          && productRoot.style.getPropertyPriority('pointer-events') === 'important';
      },
      revoke() {
        if (!held) return; held = false; if (active === lease) active = null;
        // No cleanup focus. Preserve values another overlay/owner changed.
        if (ownsInert) restoreAttribute('inert', '', previousInert);
        if (ownsAria) restoreAttribute('aria-hidden', 'true', previousAria);
        if (ownsPointer && productRoot.style.getPropertyValue('pointer-events') === 'none' && productRoot.style.getPropertyPriority('pointer-events') === 'important') {
          if (previousPointer) productRoot.style.setProperty('pointer-events', previousPointer, previousPriority);
          else productRoot.style.removeProperty('pointer-events');
        }
      },
    });
    try {
      productRoot.setAttribute('inert', ''); ownsInert = true;
      productRoot.setAttribute('aria-hidden', 'true'); ownsAria = true;
      productRoot.style.setProperty('pointer-events', 'none', 'important'); ownsPointer = true; active = lease;
      if (!lease.current()) { lease.revoke(); return null; }
      return lease;
    } catch { failed = true; lease.revoke(); return null; }
  }
  return Object.freeze({ read, suppress, retire() {
    if (!live) return; live = false; active?.revoke();
    for (const stopListener of stops.splice(0)) { try { stopListener(); } catch { failed = true; } }
    pointers.clear(); captured.clear(); touches.clear(); blockedPointers.clear(); blockedKeys.clear(); pressedKeys.clear(); compatibilityClick = false;
  } });
}
