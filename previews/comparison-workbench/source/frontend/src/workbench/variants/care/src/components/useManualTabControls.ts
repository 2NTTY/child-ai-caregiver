import { useRef } from "react";
import { Platform, type View } from "react-native";

type KeyEvent = { key: string; preventDefault(): void };

/** All tab presentations share manual activation; only the caller can accept selection. */
export function useManualTabControls<T extends string>(items: ReadonlyArray<{ key: T }>, onChange: (key: T) => void, orientation: "horizontal" | "vertical" = "horizontal") {
  const controls = useRef(new Map<T, View>());
  const space = useRef<T | null>(null);
  const activate = (key: T) => { space.current = null; onChange(key); };
  function props(key: T, index: number) {
    return {
      ref: (node: View | null) => { if (node) controls.current.set(key, node); else controls.current.delete(key); },
      dataSet: { tabKey: key },
      onPress: () => activate(key),
      onBlur: () => { if (space.current === key) space.current = null; },
      ...(Platform.OS === "web" ? {
        onKeyDown: (event: KeyEvent) => {
          if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); space.current = key; return; }
          const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
          const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
          const indexToFocus = event.key === nextKey ? (index + 1) % items.length : event.key === previousKey ? (index + items.length - 1) % items.length
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
          if (indexToFocus === null || !items[indexToFocus]) return;
          event.preventDefault();
          (controls.current.get(items[indexToFocus].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
        },
        onKeyUp: (event: KeyEvent) => {
          if (event.key !== " " && event.key !== "Spacebar") return;
          event.preventDefault();
          const armed = space.current === key; space.current = null;
          if (armed) onChange(key);
        },
      } : {}),
    };
  }
  return { controls, props };
}
