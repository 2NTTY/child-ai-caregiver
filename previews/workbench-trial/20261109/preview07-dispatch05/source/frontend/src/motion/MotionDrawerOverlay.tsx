import { Modal, StyleSheet, View, useWindowDimensions } from "react-native";
import { MotionDrawerRight } from "./MotionDrawerRight";
import { colors } from "../theme";
import type { DrawerOverlayProps } from "./DrawerOverlay.types";

// Native Modal owns platform focus and closes immediately. It cannot retain an
// exit surface while releasing that focus through its public API.
export function MotionDrawerOverlay({ open, scopeKey, label, children, onRequestClose }: DrawerOverlayProps) {
  const width = Math.min(useWindowDimensions().width * 0.92, 370);
  return <Modal visible={open} transparent animationType="none" onRequestClose={onRequestClose}>
    <View style={styles.overlay}>
      <MotionDrawerRight open={open} width={width} mode="overlay" scopeKey={scopeKey} animateOnMount
        onBackdropPress={onRequestClose}
        accessibilityViewIsModal accessibilityLabel={label} style={styles.surface}>{children}</MotionDrawerRight>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, flexDirection: "row", justifyContent: "flex-end", overflow: "hidden" }, surface: { backgroundColor: colors.sidebar } });
