import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { ScrollView } from "react-native";

type WebScroll = ScrollView & { getScrollableNode(): HTMLElement };
type Anchor = { node: HTMLElement; offset: number; firstId: string | null };

export function useChatReadingAnchor(scroll: MutableRefObject<ScrollView | null>, firstId: string | null) {
  const pending = useRef<Anchor | null>(null);
  function capture() {
    const viewport = (scroll.current as WebScroll | null)?.getScrollableNode();
    if (!viewport) return;
    const top = viewport.getBoundingClientRect().top;
    const node = Array.from(viewport.querySelectorAll<HTMLElement>('[data-testid="chat-timeline-entry"]'))
      .find(item => item.getBoundingClientRect().bottom > top);
    pending.current = node ? { node, offset: node.getBoundingClientRect().top - top, firstId } : null;
  }
  useLayoutEffect(() => {
    const anchor = pending.current, viewport = (scroll.current as WebScroll | null)?.getScrollableNode();
    if (!anchor || anchor.firstId === firstId || !viewport) return;
    pending.current = null;
    if (!viewport.contains(anchor.node)) return;
    // Correct before paint, using the message itself rather than total height:
    // footer updates and spinner changes must not move the reading position.
    viewport.scrollTop += anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
  });
  return { capture, cancel() { pending.current = null; }, maintainVisibleContentPosition: undefined };
}
