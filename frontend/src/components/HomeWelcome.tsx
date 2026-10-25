import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useFirstScreenReady } from "../startup/FirstScreenGate";
import { chineseFont, colors, radius, spacing } from "../theme";
import { HomeBackground } from "./appearance/HomeBackground";

// A stable orientation panel replaces the timed, collapsing greeting. The existing
// startup image gate and introduction acknowledgement are retained without motion.
export function HomeWelcome({ introductionPending, onIntroductionPresented, compact = false }: {
  introductionPending: boolean; onIntroductionPresented?: () => void; scopeKey: string; compact?: boolean;
}) {
  const ready = useFirstScreenReady();
  const acknowledged = useRef(false);
  useEffect(() => {
    if (!ready || !introductionPending || acknowledged.current) return;
    acknowledged.current = true;
    onIntroductionPresented?.();
  }, [ready, introductionPending, onIntroductionPresented]);
  return <View testID="home-welcome" style={[styles.card, compact && styles.compact]}>
    <View aria-hidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <HomeBackground useCustomImage={false} surface={colors.paper} containIllustration webCssFade fadeStart={compact ? 0.50 : 0.48} fadeEnd={0.91} />
    </View>
    <View style={styles.copy}>
      <Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.compactTitle]}>今日照顧</Text>
      <Text style={styles.detail}>先看重點，再安排下一步。</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { minHeight: 156, borderRadius: radius.large, overflow: "hidden", backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.softLine, justifyContent: "center" },
  compact: { minHeight: 124 }, copy: { width: "70%", gap: spacing.sm, padding: spacing.xl },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 34, lineHeight: 44, fontWeight: "700", letterSpacing: -0.6 },
  compactTitle: { fontSize: 26, lineHeight: 36 },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 23 },
});
