import type { MutableRefObject } from "react";
import type { ScrollView } from "react-native";

// Native scrolling reports reader gestures through ScrollView.onScrollBeginDrag.
export function useChatScrollIntent(_scroll: MutableRefObject<ScrollView | null>, _onReaderIntent: () => void) {}
