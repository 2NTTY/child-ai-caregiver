import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Input capability is independent of the available pane width.
export function useInteractionDensity() {
  const [touch, setTouch] = useState(() => Platform.OS !== "web" || typeof window === "undefined"
    || typeof window.matchMedia !== "function" || window.matchMedia("(any-pointer: coarse)").matches);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(any-pointer: coarse)");
    const update = () => setTouch(query.matches);
    update(); query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return touch;
}
