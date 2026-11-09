import type { MutableRefObject } from "react";
import type { ScrollView } from "react-native";

const cancel = () => {};

// Native timelines keep their existing layout/content-size positioning path.
export function useChatInitialPosition(
  _scroll: MutableRefObject<ScrollView | null>,
  _canPosition: () => boolean,
  _onPositioned: (metrics: { y: number; height: number; viewport: number }) => void,
) { return cancel; }
