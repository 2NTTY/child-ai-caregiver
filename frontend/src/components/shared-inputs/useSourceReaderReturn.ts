import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, type ScrollView, type View } from "react-native";

type Origin = { scopeKey: string; id: string; scrollOffset: number };
// Ephemeral reading context only: never an input, draft, permission or operation.
export function useSourceReaderReturn({ scopeKey, selectedId, listVisible, listRef }: {
  scopeKey: string; selectedId: string | null; listVisible: boolean; listRef: RefObject<View | null>;
}) {
  const scrollRef = useRef<ScrollView>(null), readerRef = useRef<View>(null);
  const rows = useRef(new Map<string, View>()), scrollOffset = useRef(0);
  const origin = useRef<Origin | null>(null), proposed = useRef<Origin | null>(null);
  const previous = useRef({ scopeKey, selectedId: null as string | null, listVisible: true });
  const rowRef = useCallback((id: string, node: View | null) => {
    if (node) rows.current.set(id, node); else rows.current.delete(id);
  }, []);
  function focus(node: View | null | undefined, reveal = false) {
    if (!node) return false;
    if (Platform.OS === "web") {
      const element = node as unknown as HTMLElement;
      if (!element.isConnected || element.closest('[inert],[aria-hidden="true"]') || element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled")) return false;
      element.focus({ preventScroll: true });
      if (reveal) element.scrollIntoView?.({ block: "start", behavior: "instant" });
      return element.contains(document.activeElement);
    }
    node.focus(); return true;
  }
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { scopeKey, selectedId, listVisible };
    if (before.scopeKey !== scopeKey) { origin.current = null; proposed.current = null; return; }
    if (selectedId && !listVisible && (before.selectedId !== selectedId || before.listVisible)) {
      origin.current = proposed.current?.scopeKey === scopeKey && proposed.current.id === selectedId
        ? proposed.current : { scopeKey, id: selectedId, scrollOffset: 0 };
      proposed.current = null;
      if (Platform.OS !== "web") scrollRef.current?.scrollTo({ y: 0, animated: false });
      focus(readerRef.current, true);
    } else if (listVisible && !before.listVisible) {
      const saved = origin.current;
      if (!saved || saved.scopeKey !== scopeKey) return;
      scrollRef.current?.scrollTo({ y: saved.scrollOffset, animated: false });
      if (!focus(rows.current.get(saved.id))) focus(listRef.current);
    }
  }, [scopeKey, selectedId, listVisible, listRef]);
  return { scrollRef, readerRef, rowRef,
    remember(id: string) { proposed.current = { scopeKey, id, scrollOffset: scrollOffset.current }; },
    onScroll(y: number) { scrollOffset.current = y; },
  };
}
