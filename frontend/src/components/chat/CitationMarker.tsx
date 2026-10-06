import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors } from "../../theme";
import type { Ref } from "react";

export function CitationMarker({ number, label, onPress, ref }: { number: number; label: string; onPress(): void; ref?: Ref<View> }) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.slot, { width: (23 + String(number).length * 6) * fontScale, height: 16 * fontScale }]}>
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={styles.marker}>
      <Text style={styles.text}>【{number}】</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  slot: { transform: [{ translateY: -4 }] }, marker: { alignItems: "center", justifyContent: "center" },
  text: { textDecorationLine: "underline", fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
