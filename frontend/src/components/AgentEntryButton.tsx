import { useState } from "react";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { StyleSheet, View } from "react-native";
import { Text, TouchableRipple } from "react-native-paper";
import { AppIcon } from "./AppIcon";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

export function AgentEntryButton({ active }: { active: boolean }) {
  const [focused, setFocused] = useState(false);
  return <PreviewLink href="/chat"><TouchableRipple
    testID="agent-entry"
    accessibilityRole="link"
    accessibilityLabel="育兒助手：提問、記錄與安排"
    accessibilityHint="前往對話，提問或整理照顧事項"
    accessibilityState={{ selected: active }}
    aria-current={active ? "page" : undefined}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    theme={{ colors: { onSurface: colors.white } }}
    style={StyleSheet.flatten([styles.button, (active || focused) && styles.highlighted])}
  >
    <View style={styles.content}>
      <View style={styles.icon}><AppIcon name="star-four-points" size={23} color={colors.white} /></View>
      <View style={styles.copy}>
        <Text style={styles.label}>育兒助手</Text>
        <Text style={styles.hint}>提問・記錄・安排</Text>
      </View>
      <AppIcon name="chevron-right" size={16} color={colors.white} />
    </View>
  </TouchableRipple></PreviewLink>;
}

const styles = StyleSheet.create({
  button: { width: "100%", backgroundColor: colors.teal, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.teal, overflow: "hidden" },
  highlighted: { borderColor: colors.ink, outlineColor: colors.ink, outlineWidth: 2, outlineOffset: 3 },
  content: { minHeight: 72, paddingHorizontal: 10, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  icon: { width: 36, height: 36, flexShrink: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.deepTeal, borderRadius: radius.small },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontFamily: chineseFont, color: colors.white, fontSize: 16, fontWeight: "700", lineHeight: 24 },
  hint: { fontFamily: chineseFont, color: colors.white, fontSize: typeScale.caption, lineHeight: 18 },
});
