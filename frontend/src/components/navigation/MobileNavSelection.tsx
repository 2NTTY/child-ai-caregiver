import { StyleSheet, View } from "react-native";
import { colors } from "../../theme";

// The current page stays visible after release, independently of press feedback.
export function MobileNavSelection() {
  return <View testID="mobile-current-page" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.surface}>
    <View style={styles.marker} />
  </View>;
}

const styles = StyleSheet.create({
  surface: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.selectedNav, alignItems: "center" },
  marker: { width: 24, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: colors.deepTeal },
});
