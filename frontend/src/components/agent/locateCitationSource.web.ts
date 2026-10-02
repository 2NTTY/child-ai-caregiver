import type { ScrollView, View } from "react-native";

export function locateCitationSource(target: View | null, _scroll: ScrollView | null, _horizontalScroll?: ScrollView | null, verticalTarget?: View | null) {
  if (!target) return;
  const element = target as unknown as HTMLElement;
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  if (verticalTarget) (verticalTarget as unknown as HTMLElement).scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
  element.focus({ preventScroll: true });
}
