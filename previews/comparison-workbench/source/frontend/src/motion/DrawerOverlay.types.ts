import type { ReactNode, RefObject } from "react";
import type { View } from "react-native";

export interface DrawerOverlayProps {
  open: boolean; scopeKey: string; label: string; children: ReactNode;
  onRequestClose: () => void; restoreFocusOnClose?: boolean;
  backgroundRef?: RefObject<View | null>; returnFocusRef?: RefObject<View | null>;
}
