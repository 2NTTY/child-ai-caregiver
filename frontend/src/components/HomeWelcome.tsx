import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useFirstScreenReady } from "../startup/FirstScreenGate";
import { chineseFont, colors, radius, spacing } from "../theme";
import { HomeBackground } from "./appearance/HomeBackground";

// Keep the brand illustration, but give daily care content the first-screen space.
// Introduction acknowledgement still follows the real data-readiness boundary.
export function HomeWelcome({ introductionPending, onIntroductionPresented, compact = false, childName }: {
  introductionPending: boolean; onIntroductionPresented?: () => void; scopeKey: string; compact?: boolean; childName?: string;
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
      {childName ? <Text style={styles.context}>{childName} · {new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric" }).format(new Date())}</Text> : null}
      <Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.compactTitle]}>今日照顧</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  card: { minHeight: 104, borderRadius: radius.medium, overflow: "hidden", backgroundColor: colors.paper, justifyContent: "center" },
  compact: { minHeight: 80 }, copy: { width: "70%", padding: spacing.lg, gap: spacing.xs },
  context: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 20 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 30, lineHeight: 40, fontWeight: "700", letterSpacing: -0.5 },
  compactTitle: { fontSize: 24, lineHeight: 32 },
});
