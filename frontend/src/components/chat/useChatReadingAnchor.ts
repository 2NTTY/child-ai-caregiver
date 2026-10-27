import type { MutableRefObject } from "react";
import type { ScrollView } from "react-native";

const position = { minIndexForVisible: 1 };
// RN keeps the visible message in place before drawing inserted history. The
// first child is the fixed history status slot, never a message anchor.
export function useChatReadingAnchor(_scroll: MutableRefObject<ScrollView | null>, _firstId: string | null) {
  return { capture() {}, cancel() {}, maintainVisibleContentPosition: position };
}
