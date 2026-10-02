import type { ScrollView, View } from "react-native";

export function locateCitationSource(target: View | null, _scroll: ScrollView | null) {
  if (!target) return;
  const element = target as unknown as HTMLElement;
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  element.focus({ preventScroll: true });
}
