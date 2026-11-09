import { useCallback, useRef, useState } from "react";
import { Platform, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";

/** Measure attachment and real layout events, never unrelated React commits. */
export function useContainerWidth() {
  const viewportWidth = useWindowDimensions().width;
  const host = useRef<View | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const update = useCallback((width: number) => {
    if (width > 0) setMeasured(current => current === width ? current : width);
  }, []);
  const ref = useCallback((node: View | null) => {
    host.current = node;
    // A callback ref also covers the first node appearing after a read or tab mount.
    if (Platform.OS === "web" && node) update((node as unknown as HTMLElement).getBoundingClientRect().width);
  }, [update]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (Platform.OS === "web") {
      // Preserve the visual-width convention used by Settings under browser zoom.
      const node = host.current as unknown as HTMLElement | null;
      if (node) update(node.getBoundingClientRect().width);
      return;
    }
    update(event.nativeEvent.layout.width);
  }, [update]);
  return { ref, hostRef: host, onLayout, width: measured ?? viewportWidth };
}
