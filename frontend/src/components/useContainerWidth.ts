import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";

/** Read the mounted Web container before paint; keep native onLayout updates. */
export function useContainerWidth() {
  const viewportWidth = useWindowDimensions().width;
  const ref = useRef<View>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const update = useCallback((width: number) => {
    if (width > 0) setMeasured(current => current === width ? current : width);
  }, []);
  // No dependency list: the measured node may first appear after data loading
  // or become visible after a tab change without remounting this hook.
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (node) update(node.getBoundingClientRect().width);
  });
  const onLayout = useCallback((event: LayoutChangeEvent) => update(event.nativeEvent.layout.width), [update]);
  return { ref, onLayout, width: measured ?? viewportWidth };
}
