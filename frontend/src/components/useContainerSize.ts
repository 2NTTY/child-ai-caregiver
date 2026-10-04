import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Platform, View, type LayoutChangeEvent } from "react-native";

/** Read mounted Web image geometry before paint; retain native layout updates. */
export function useContainerSize(enabled = true) {
  const ref = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const update = useCallback((width: number, height: number) => {
    setSize(current => current.width === width && current.height === height ? current : { width, height });
  }, []);
  // The container can first mount after a breakpoint or background-mode change.
  useLayoutEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (node) {
      const { width, height } = node.getBoundingClientRect();
      update(width, height);
    }
  });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (enabled) update(event.nativeEvent.layout.width, event.nativeEvent.layout.height);
  }, [enabled, update]);
  return { ref, size, onLayout: enabled ? onLayout : undefined };
}
