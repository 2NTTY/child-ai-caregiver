import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";

/** Read the mounted Web container before paint; keep native onLayout updates. */
export function useContainerWidth() {
  const viewportWidth = useWindowDimensions().width;
  const ref = useRef<View>(null);
  const measuredNode = useRef<{ node: HTMLElement | null; viewportWidth: number } | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const update = useCallback((width: number) => {
    if (width > 0) setMeasured(current => current === width ? current : width);
  }, []);
  // Object refs are also used by composed-ref callers. Check attachment cheaply
  // each commit, but read geometry only for a new node or viewport width. RNW
  // already owns ResizeObserver and supplies later size/visibility via onLayout.
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    const previous = measuredNode.current;
    if (previous?.node === node && previous.viewportWidth === viewportWidth) return;
    measuredNode.current = { node, viewportWidth };
    if (node) update(node.getBoundingClientRect().width);
  });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (Platform.OS === "web") {
      // RN Web reports offsetWidth; keep the same visual width as the prepaint read.
      const node = ref.current as unknown as HTMLElement | null;
      if (node) update(node.getBoundingClientRect().width);
      return;
    }
    update(event.nativeEvent.layout.width);
  }, [update]);
  return { ref, onLayout, width: measured ?? viewportWidth, hasMeasuredWidth: measured !== null };
}
