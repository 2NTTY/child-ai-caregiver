import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "../../theme";

// Concave menisci meet the left/content-bottom edges tangentially around the
// rounded camera body. The decorative reach never enlarges the 56px hit target.
export function CornerCaptureSurface() {
  return <View testID="mobile-quick-camera-surface" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.surface}>
    <Svg width={72} height={72} viewBox="0 0 72 72" pointerEvents="none" aria-hidden>
      <Path d="M 0 0 C 0 12 8 16 28 16 A 28 28 0 0 1 56 44 C 56 64 60 72 72 72 H 0 Z" fill={colors.accent} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  surface: { position: "absolute", left: 0, bottom: 0, width: 72, height: 72 },
});
