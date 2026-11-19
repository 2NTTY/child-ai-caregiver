import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors } from "../../theme";
import type { Ref } from "react";

export function CitationMarker({ number, label, onPress, ref, markerText, live }: { number: number; label: string; onPress(): void; ref?: Ref<View>; markerText?: string; live?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const displayText = markerText ?? (live ? `【${number}·即時】` : `【${number}】`);
  return <View style={[styles.slot, { width: (markerText ? markerText.length * 11 : (live ? 48 : 23) + String(number).length * 6) * fontScale, height: 16 * fontScale }]}>
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={[styles.marker, live && styles.liveMarker]}>
      <Text style={[styles.text, live && styles.liveText]}>{displayText}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  slot: { transform: [{ translateY: -4 }] }, marker: { alignItems: "center", justifyContent: "center" },
  liveMarker: { backgroundColor: colors.paleAmber, borderWidth: 1, borderColor: colors.statusWarmLine, borderRadius: 4, paddingHorizontal: 2 },
  text: { textDecorationLine: "underline", fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  liveText: { color: colors.warningInk },
});
