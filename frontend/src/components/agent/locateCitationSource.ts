import type { ScrollView, View } from "react-native";

export function locateCitationSource(target: View | null, scroll: ScrollView | null) {
  if (!target || !scroll) return;
  const inner = (scroll as ScrollView & { getInnerViewRef?(): View | null }).getInnerViewRef?.() ?? scroll.getInnerViewNode();
  if (!inner) return;
  target.measureLayout(inner, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: true }), () => {});
}
