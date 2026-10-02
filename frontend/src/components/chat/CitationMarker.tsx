import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors } from "../../theme";

export function CitationMarker({ number, label, onPress }: { number: number; label: string; onPress(): void }) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.slot, { width: (23 + String(number).length * 6) * fontScale, height: 16 * fontScale }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={styles.marker}>
      <Text style={styles.text}>【{number}】</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  slot: { transform: [{ translateY: -4 }] }, marker: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
