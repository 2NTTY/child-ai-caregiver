import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { ScrollView } from "react-native";

type WebScrollView = ScrollView & { getScrollableNode(): HTMLElement; getInnerViewNode(): HTMLElement };

export function useChatInitialPosition(
  scroll: MutableRefObject<ScrollView | null>,
  canPosition: () => boolean,
  onPositioned: (metrics: { y: number; height: number; viewport: number }) => void,
) {
  const latest = useRef({ canPosition, onPositioned });
  latest.current = { canPosition, onPositioned };
  const pending = useRef(true), observer = useRef<ResizeObserver | null>(null);
  const cancel = useCallback(() => {
    pending.current = false;
    observer.current?.disconnect(); observer.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!pending.current) return;
    const view = scroll.current as WebScrollView | null;
    const viewport = view?.getScrollableNode(), content = view?.getInnerViewNode();
    if (!viewport || !content) return;
    let active = true;
    const position = () => {
      if (!active || !pending.current) return;
      if (!latest.current.canPosition()) { cancel(); return; }
      if (!viewport.isConnected || !content.isConnected || viewport.clientHeight <= 0 || content.offsetHeight <= 0) return;
      // Place the first readable frame without waiting for RN Web's async onLayout.
      const height = viewport.scrollHeight, viewportHeight = viewport.clientHeight;
      viewport.scrollTop = Math.max(0, height - viewportHeight);
      latest.current.onPositioned({ y: viewport.scrollTop, height, viewport: viewportHeight });
      cancel();
    };
    position();
    if (pending.current) {
      const Observer = viewport.ownerDocument.defaultView?.ResizeObserver;
      if (Observer) {
        const initialObserver = new Observer(position);
        observer.current = initialObserver;
        initialObserver.observe(viewport); initialObserver.observe(content);
      }
    }
    return () => {
      active = false;
      observer.current?.disconnect(); observer.current = null;
    };
  });

  return cancel;
}
