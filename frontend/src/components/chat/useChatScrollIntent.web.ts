import { useEffect, useRef, type MutableRefObject } from "react";
import type { ScrollView } from "react-native";

type WebScroll = ScrollView & { getScrollableNode(): HTMLElement };
export function useChatScrollIntent(scroll: MutableRefObject<ScrollView | null>, onReaderIntent: () => void) {
  const latest = useRef(onReaderIntent); latest.current = onReaderIntent;
  useEffect(() => {
    const viewport = (scroll.current as WebScroll | null)?.getScrollableNode(), host = viewport?.parentElement;
    if (!viewport || !host) return;
    const read = () => latest.current();
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, button, [role='button'], [role='tab']") || target.isContentEditable) return;
      // A no-op End cannot emit the scroll event that would restore following at the bottom.
      if (event.key === "End" && target === viewport && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) read();
    };
    const thumb = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".os-scrollbar")?.closest("[data-overlayscrollbars]") === host) read();
    };
    viewport.addEventListener("wheel", read, { passive: true });
    viewport.addEventListener("touchmove", read, { passive: true });
    viewport.addEventListener("keydown", key);
    host.addEventListener("pointerdown", thumb, true);
    return () => {
      viewport.removeEventListener("wheel", read); viewport.removeEventListener("touchmove", read);
      viewport.removeEventListener("keydown", key); host.removeEventListener("pointerdown", thumb, true);
    };
  }, [scroll]);
}
