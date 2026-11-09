import type { ScrollView, View } from "react-native";

export function locateCitationSource(target: View | null, _scroll: ScrollView | null, _horizontalScroll?: ScrollView | null, verticalTarget?: View | null) {
  if (!target) return;
  const element = target as unknown as HTMLElement;
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  // Inline returns keep their surrounding text visible; source panels retain top alignment.
  if (verticalTarget) (verticalTarget as unknown as HTMLElement).scrollIntoView({
    block: verticalTarget === target ? "center" : "start", inline: "nearest", behavior: "instant",
  });
  element.focus({ preventScroll: true });
}
