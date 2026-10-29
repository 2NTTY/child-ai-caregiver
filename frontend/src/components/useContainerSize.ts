import { useCallback, useState } from "react";
import { Platform, View, type LayoutChangeEvent } from "react-native";

/** Read attachment/enable transitions and native layout, not every form edit. */
export function useContainerSize(enabled = true) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const update = useCallback((width: number, height: number) => {
    setSize(current => current.width === width && current.height === height ? current : { width, height });
  }, []);
  const ref = useCallback((node: View | null) => {
    if (enabled && Platform.OS === "web" && node) {
      const { width, height } = (node as unknown as HTMLElement).getBoundingClientRect();
      update(width, height);
    }
  }, [enabled, update]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (enabled) update(event.nativeEvent.layout.width, event.nativeEvent.layout.height);
  }, [enabled, update]);
  return { ref, size, onLayout: enabled ? onLayout : undefined };
}
