import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, type ScrollView, type ScrollViewProps, type View } from "react-native";
import { useReaderPosition } from "./ReaderPosition";

/** Reading position only; content bytes, selected identity and drafts stay with their owner. */
export function useReaderReturn({ scopeKey, selectedId, listRef, readerRef, scrollRef, enabled = true }: {
  scopeKey: string; selectedId: string | null; enabled?: boolean; listRef: RefObject<View | null>; readerRef: RefObject<View | null>; scrollRef: RefObject<ScrollView | null>;
}) {
  const rows = useRef(new Map<string, View>());
  const returnFocusRef = useRef<View | null>(null);
  const { actions: position, meta: { isCurrent } } = useReaderPosition();
  const offset = useRef(0);
  const pendingScroll = useRef<{ scopeKey: string; target: View; offset: number } | null>(null);
  const mountedSelection = useRef<string | null>(null);
  const latest = useRef({ scopeKey, selectedId, enabled }); latest.current = { scopeKey, selectedId, enabled };
  useLayoutEffect(() => {
    pendingScroll.current = null;
    if (!enabled) return;
    if (!isCurrent()) { position.write(null); return; }
    const before = position.read();
    const sameScope = before?.scopeKey === scopeKey;
    const origin = sameScope ? before.origin : null;
    returnFocusRef.current = origin && (!selectedId || origin.id === selectedId) ? rows.current.get(origin.id) ?? null : null;
    position.write({ scopeKey, selectedId, origin: selectedId && origin?.id !== selectedId ? null : origin, focusNode: sameScope ? before.focusNode : null, indexRequested: !selectedId && sameScope ? before.indexRequested : undefined });
    const sameSelection = mountedSelection.current === selectedId; mountedSelection.current = selectedId;
    if (!sameScope) offset.current = 0;
    if (sameSelection && (selectedId || !sameScope || !before.selectedId)) return;
    if (Platform.OS === "web" && before?.focusNode && document.activeElement !== document.body && document.activeElement !== before.focusNode) return;
    if (selectedId) {
      const node = readerRef.current;
      if (Platform.OS === "web") {
        const element = node as unknown as HTMLElement | null;
        element?.focus({ preventScroll: true }); element?.scrollIntoView?.({ block: "start", inline: "nearest" });
      } else node?.focus();
    } else if (sameScope && before.selectedId) {
      const remembered = origin;
      const restore = () => {
        const row = remembered ? rows.current.get(remembered.id) : null;
        for (const target of [row, listRef.current]) {
          if (!target) continue;
          if (Platform.OS === "web") {
            const element = target as unknown as HTMLElement;
            if (!element.isConnected || element.getAttribute("aria-disabled") === "true" || element.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
            const style = window.getComputedStyle(element);
            if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)) continue;
            try { element.focus({ preventScroll: true }); } catch { continue; }
            if (document.activeElement !== element) continue;
          } else target.focus();
          const scrollOffset = target === row && remembered ? remembered.scrollOffset : 0;
          if (scrollRef.current) scrollRef.current.scrollTo({ y: scrollOffset, animated: false });
          else pendingScroll.current = { scopeKey, target, offset: scrollOffset };
          return true;
        }
        return false;
      };
      if (restore() || Platform.OS !== "web" || typeof requestAnimationFrame !== "function") return;
      // A single post-layout retry only when both original and fallback refused
      // focus; never recapture focus after an intervening user action.
      let moved = false;
      const onFocus = () => { moved = true; };
      document.addEventListener("focusin", onFocus, true);
      const frame = requestAnimationFrame(() => {
        document.removeEventListener("focusin", onFocus, true);
        const current = latest.current;
        if (!moved && isCurrent() && current.enabled && current.scopeKey === scopeKey && !current.selectedId && document.activeElement === document.body) restore();
      });
      return () => { cancelAnimationFrame(frame); document.removeEventListener("focusin", onFocus, true); };
    }
  }, [enabled, scopeKey, selectedId, listRef, readerRef, scrollRef, position, isCurrent]);
  useEffect(() => {
    // A nested reader can finish layout before its new ancestor ScrollView ref
    // attaches. Consume only that accepted return after the commit, not a timer.
    const receipt = pendingScroll.current; pendingScroll.current = null;
    if (!receipt || !enabled || selectedId || receipt.scopeKey !== scopeKey || !isCurrent()) return;
    if (Platform.OS === "web") {
      const target = receipt.target as unknown as HTMLElement;
      if (!target.isConnected || document.activeElement !== target) return;
    }
    scrollRef.current?.scrollTo({ y: receipt.offset, animated: false });
  }, [enabled, scopeKey, selectedId, scrollRef, isCurrent]);
  const onScroll: NonNullable<ScrollViewProps["onScroll"]> = event => { if (!selectedId) offset.current = event.nativeEvent.contentOffset.y; };
  return {
    onScroll,
    // A modal editor can hand its own onClosed restoration to the same live row.
    // This is a host ref only; the position port remains the single origin owner.
    returnFocusRef,
    remember(id: string, scrollOffset = offset.current) { returnFocusRef.current = rows.current.get(id) ?? null; position.write({ scopeKey, selectedId, origin: { id, scrollOffset }, focusNode: Platform.OS === "web" ? document.activeElement as HTMLElement : null }); },
    returning() { const before = position.read(); if (before?.scopeKey === scopeKey) position.write({ ...before, indexRequested: true, focusNode: Platform.OS === "web" ? document.activeElement as HTMLElement : null }); },
    rowRef(id: string, node: View | null) {
      const previous = rows.current.get(id), saved = position.read();
      if (node) rows.current.set(id, node); else rows.current.delete(id);
      if (returnFocusRef.current === previous || saved?.scopeKey === scopeKey && saved.origin?.id === id) returnFocusRef.current = node;
    },
  };
}
