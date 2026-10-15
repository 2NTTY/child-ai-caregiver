export const ONLINE_REFRESH_EVENT = "yuban-online-refresh";

// Only an invalidation signal, never business data. Native has a window alias
// but no browser event methods; keep the existing Web event contract intact.
const nativeListeners = new Set<() => void>();
function browserEvents() {
  return typeof window !== "undefined" && typeof window.addEventListener === "function"
    && typeof window.removeEventListener === "function" && typeof window.dispatchEvent === "function" ? window : null;
}
export function subscribeOnlineRefresh(listener: () => void): () => void {
  const target = browserEvents();
  if (target) {
    target.addEventListener(ONLINE_REFRESH_EVENT, listener);
    return () => target.removeEventListener(ONLINE_REFRESH_EVENT, listener);
  }
  nativeListeners.add(listener);
  return () => { nativeListeners.delete(listener); };
}
export function publishOnlineRefresh() {
  const target = browserEvents();
  if (target) target.dispatchEvent(new Event(ONLINE_REFRESH_EVENT));
  else nativeListeners.forEach(listener => listener());
}
