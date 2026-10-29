import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { ScrollView } from "react-native";

type WebScroll = { getScrollableNode(): HTMLElement };
type Anchor = { node: HTMLElement; offset: number; firstId: string | null };

function viewportScale(viewport: HTMLElement, visualHeight: number) {
  const style = viewport.ownerDocument.defaultView?.getComputedStyle(viewport);
  if (!style) return 1;
  let height = parseFloat(style.height);
  if (style.boxSizing !== "border-box") {
    height += parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  }
  // Rects include ancestor zoom/scaling; scrollTop uses layout pixels. Keep the
  // fractional used height: offsetHeight/clientHeight round and introduce drift.
  return height > 0 && visualHeight > 0 ? visualHeight / height : 1;
}

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
    const bounds = viewport.getBoundingClientRect();
    const delta = anchor.node.getBoundingClientRect().top - bounds.top - anchor.offset;
    viewport.scrollTop += delta / viewportScale(viewport, bounds.height);
  });
  return { capture, cancel() { pending.current = null; }, maintainVisibleContentPosition: undefined };
}
