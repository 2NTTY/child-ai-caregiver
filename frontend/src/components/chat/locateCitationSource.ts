import type { ScrollView, View } from "react-native";

function innerView(scroll: ScrollView) {
  return (scroll as ScrollView & { getInnerViewRef?(): View | null }).getInnerViewRef?.() ?? scroll.getInnerViewNode();
}
export function locateCitationSource(target: View | null, scroll: ScrollView | null, horizontalScroll?: ScrollView | null, verticalTarget?: View | null) {
  if (!target) return;
  if (horizontalScroll) {
    const inner = innerView(horizontalScroll);
    if (inner) target.measureLayout(inner, x => horizontalScroll.scrollTo({ x: Math.max(0, x - 12), animated: false }), () => {});
  }
  if (scroll) {
    const inner = innerView(scroll);
    if (inner) (verticalTarget ?? target).measureLayout(inner, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: false }), () => {});
  }
}
